// Wie liegt ein Video in der Textur? Handyvideos werden oft quer gespeichert, mit einer Drehung in den Metadaten
// (90°, 180°, 270°). Chrome und Safari drehen das Bild beim Hochladen in WebGL (texImage2D) selbst zurecht,
// Firefox (und damit Zen) nicht immer, meldet aber trotzdem die gedrehte Größe (videoWidth, videoHeight). Dann
// stimmen Inhalt und Seitenverhältnis nicht zusammen: das Bild liegt schief UND gestreckt, und Drehen von Hand
// tauscht nur wieder Breite und Höhe, das Strecken bleibt.
//
// Statt zu raten, welcher Browser was macht, wird nachgesehen:
//   1. Mediabunny liest Drehung und echte Größe aus der Datei und dekodiert ein Bild selbst, richtig gedreht
//      (das ist die Vorlage, so muss es aussehen).
//   2. Dasselbe Bild aus dem <video> wird in WebGL hochgeladen und in allen vier Drehungen klein gezeichnet.
//   3. Die Drehung, die der Vorlage am ähnlichsten ist, ist die, die der Browser NICHT gemacht hat.
// Das Ergebnis passt zu gedreht(uv, d) in den Shadern von Video zu Ton (Viertel im Uhrzeigersinn) und zu
// UNPACK_FLIP_Y_WEBGL = true (y = 0 unten).

const N = 24; // so klein genügt zum Vergleichen

const VERTEX = `#version 300 es
in vec2 ecke;
void main() { gl_Position = vec4(ecke, 0.0, 1.0); }`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D video;
uniform int drehung;
out vec4 farbe;
vec2 gedreht(vec2 uv, int d) {
  if (d == 1) return vec2(1.0 - uv.y, uv.x);
  if (d == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (d == 3) return vec2(uv.y, 1.0 - uv.x);
  return uv;
}
void main() { farbe = texture(video, gedreht(gl_FragCoord.xy / ${N}.0, drehung)); }`;

// video: ein <video>, das an der Stelle zeit (Sekunden) steht; datei: dieselbe Datei als Blob
// zurück: { drehung (Viertel, die der Shader noch drehen muss), breite, hoehe (echte Größe, aufrecht) } oder null
export async function erkenneDrehung(video, datei, zeit = 0) {
  if (typeof Mediabunny === "undefined" || typeof VideoDecoder === "undefined") return null;
  try {
    const eingabe = new Mediabunny.Input({ formats: Mediabunny.ALL_FORMATS, source: new Mediabunny.BlobSource(datei) });
    const spur = await eingabe.getPrimaryVideoTrack();
    if (!spur) return null;
    const breite = await spur.getDisplayWidth();
    const hoehe = await spur.getDisplayHeight();
    if (((await spur.getRotation()) ?? 0) === 0) return { drehung: 0, breite, hoehe }; // nichts zu drehen
    // Vorlage: Mediabunny dreht selbst richtig (CanvasSink wendet die Drehung aus den Metadaten an)
    const senke = new Mediabunny.CanvasSink(spur, { width: N, height: N, fit: "fill" });
    const vorlage = await senke.getCanvas((await spur.getFirstTimestamp()) + zeit);
    if (!vorlage) return { drehung: 0, breite, hoehe };
    const soll = vorlage.canvas.getContext("2d").getImageData(0, 0, N, N).data;

    // das <video> in WebGL, in vier Drehungen
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const gl = c.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) return { drehung: 0, breite, hoehe };
    const programm = gl.createProgram();
    for (const [art, text] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
      const s = gl.createShader(art);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      gl.attachShader(programm, s);
    }
    gl.linkProgram(programm);
    gl.useProgram(programm);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const ort = gl.getAttribLocation(programm, "ecke");
    gl.enableVertexAttribArray(ort);
    gl.vertexAttribPointer(ort, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // wie in Video zu Ton
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    const ist = new Uint8Array(N * N * 4);
    const fehler = [];
    for (let d = 0; d < 4; d++) {
      gl.uniform1i(gl.getUniformLocation(programm, "drehung"), d);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, ist);
      // readPixels liefert die unterste Zeile zuerst, die Vorlage die oberste
      let summe = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const a = ((N - 1 - y) * N + x) * 4;
          const b = (y * N + x) * 4;
          for (let k = 0; k < 3; k++) summe += Math.abs(ist[a + k] - soll[b + k]);
        }
      }
      fehler.push(summe);
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    const beste = fehler.indexOf(Math.min(...fehler));
    // kaum Unterschied (z. B. ein schwarzes Bild): lieber nicht drehen
    const sortiert = [...fehler].sort((a, b) => a - b);
    if (sortiert[1] - sortiert[0] < sortiert[0] * 0.15) return { drehung: 0, breite, hoehe, unsicher: true };
    return { drehung: beste, breite, hoehe };
  } catch (fehler) {
    console.warn("Drehung nicht erkannt:", fehler);
    return null;
  }
}
