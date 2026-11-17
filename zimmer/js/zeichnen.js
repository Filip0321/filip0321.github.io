// Gaussian Splats zeichnen (WebGL2), wie im Paper von Kerbl, Kopanas, Leimkühler, Drettakis (SIGGRAPH 2023),
// nur ohne Kacheln: jeder Splat ist ein Rechteck aus zwei Dreiecken, das ein Shader zur Ellipse macht.
//
// Für jeden Splat (Vertex-Shader):
//   1. Mitte in die Kamera und auf den Bildschirm
//   2. Die 3D-Kovarianz Σ auf den Bildschirm projizieren: Σ' = J W Σ Wᵀ Jᵀ (EWA-Splatting, Zwicker 2001)
//      W dreht in die Kamera, J ist die Ableitung der Perspektive an der Mitte (Perspektive ist nicht linear, aber
//      für einen kleinen Fleck reicht die Näherung). Σ' ist 2 × 2: eine Ellipse in Pixeln.
//      + 0,3 auf der Diagonale: kein Fleck ist kleiner als etwa ein halbes Pixel (sonst flimmert es)
//   3. Achsen der Ellipse aus den Eigenwerten λ₁, λ₂ und dem Eigenvektor von Σ'; das Rechteck reicht 3 σ weit
// Pro Pixel (Fragment-Shader): Deckkraft · e^(−½ r²), r in Einheiten von σ. Ab r = 3 nichts mehr.
// Gemalt wird von hinten nach vorn (sortieren.js liefert die Reihenfolge), mit vormultipliziertem Alpha:
//   Ergebnis = Farbe · α + Vorher · (1 − α)
//
// Die Daten liegen in einer Textur (RGBA32UI, 2048 breit), drei Texel pro Splat:
//   [x, y, z, Farbe RGBA8]  [Σxx, Σxy, Σxz, 0]  [Σyy, Σyz, Σzz, 0]   (Kommazahlen als Bits: uintBitsToFloat)
// Pro Instanz kommt nur die Nummer des Splats (in der sortierten Reihenfolge) als Attribut.
//
// Orthografisch (Bearbeiten, kamera.js): dann ist die Abbildung linear, (x, y) → s · (x, y), und J ist einfach
//   J = [[s, 0, 0], [0, s, 0]]   (keine Tiefe, keine Verzerrung zum Rand hin)
//
// Flächen mit Video oder Bild (dinge.js) sind echte Objekte in der Szene, mit Tiefe:
//   1. erst die Flächen zeichnen, deckend, und dabei die Tiefe jedes Pixels merken (Tiefenpuffer)
//   2. dann die Splats, mit Tiefentest: ein Splat hinter der Fläche fällt weg, einer davor wird darüber gemalt.
//      Splats schreiben selbst keine Tiefe (sie sind halb durchsichtig und kommen schon sortiert).
//   Die Tiefe eines Splats ist die seiner Mitte (das Rechteck liegt flach in dieser Tiefe). Die Splats, aus denen der
//   Bildschirm im Scan selbst besteht, liegen genau auf der Fläche; damit sie nicht halb durchflimmern, wird die
//   Fläche um ein paar Millimeter zum Betrachter vorgezogen (dinge.js).
//
// Werkzeuge zum Bearbeiten (alles Uniforms, wirkt sofort):
//   nah       Splats näher als so viele Meter vor der Kamera weglassen (Schnitt: in einen Schrank hineinsehen)
//   kugel     nur Splats in einer Kugel um die Auswahl zeigen (w = Radius, 0: aus)
//   roentgen  Deckkraft aller Splats mal diesen Faktor (durchsichtig: sehen, was dahinter liegt)
//   ebene     nur Splats VOR einer Ebene (n · p + d > 0), für die Maske über einer Seite im Fenster

const BREITE = 2048;

const ECKE = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D daten;
uniform mat4 ansicht, projektion;
uniform vec2 fokus;    // Brennweite in Pixeln (fx, fy)
uniform vec2 groesse;  // Bildschirm in Pixeln
uniform vec4 hervor;   // Mitte und Radius eines Gegenstands, der leuchten soll (w = 0: keiner)
uniform float leuchten;
uniform float schnitt;  // Draufsicht: alles über dieser Höhe weglassen (die Decke)
uniform float ortho;    // > 0: orthografisch, Pixel pro Meter
uniform float nah;      // Schnitt vor der Kamera (Meter)
uniform vec4 kugel;     // nur in dieser Kugel zeigen (w = 0: aus)
uniform float roentgen; // Faktor für die Deckkraft
uniform vec4 ebene;     // nur vor dieser Ebene (xyz = 0: aus)
in vec2 ecke;          // −3 … 3
in uint nummer;
out vec4 farbe;
out vec2 lage;

ivec2 ort(uint i) { return ivec2(int(i % ${BREITE}u), int(i / ${BREITE}u)); }

void main() {
  uint i = nummer * 3u;
  uvec4 a = texelFetch(daten, ort(i), 0);
  vec3 p = uintBitsToFloat(a.xyz);
  vec4 kam = ansicht * vec4(p, 1.0);
  vec4 clip = projektion * kam;
  float rand = 1.2 * clip.w;
  // hinter der Kamera oder weit außerhalb: weg (alle vier Ecken an dieselbe Stelle, nichts wird gemalt)
  bool weg = p.y > schnitt || kam.z > -0.05 || -kam.z < nah || clip.x < -rand || clip.x > rand || clip.y < -rand || clip.y > rand;
  weg = weg || (kugel.w > 0.0 && distance(p, kugel.xyz) > kugel.w) || (dot(ebene.xyz, ebene.xyz) > 0.0 && dot(ebene.xyz, p) + ebene.w <= 0.0);
  if (weg) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  uvec4 b = texelFetch(daten, ort(i + 1u), 0);
  uvec4 c = texelFetch(daten, ort(i + 2u), 0);
  vec3 s1 = uintBitsToFloat(b.xyz), s2 = uintBitsToFloat(c.xyz);
  mat3 V = mat3(s1.x, s1.y, s1.z, s1.y, s2.x, s2.y, s1.z, s2.y, s2.z);
  float z = -kam.z;
  // Ableitung von (fx · x / z, fy · y / z) nach (x, y, z); dritte Zeile 0 (Spalten zuerst geschrieben)
  mat3 J = ortho > 0.0 ? mat3(ortho, 0.0, 0.0, 0.0, ortho, 0.0, 0.0, 0.0, 0.0)
    : mat3(fokus.x / z, 0.0, 0.0, 0.0, fokus.y / z, 0.0, fokus.x * kam.x / (z * z), fokus.y * kam.y / (z * z), 0.0);
  mat3 T = J * mat3(ansicht);
  mat3 S = T * V * transpose(T);
  float sa = S[0][0] + 0.3, sb = S[0][1], sd = S[1][1] + 0.3;
  // Eigenwerte und Achsen der Ellipse
  float mitte = 0.5 * (sa + sd);
  float r = length(vec2(0.5 * (sa - sd), sb));
  float l1 = mitte + r, l2 = max(mitte - r, 0.1);
  // Eigenvektor zu λ₁: (b, λ₁ − a); ist b = 0, liegt die Ellipse schon an den Achsen
  vec2 richtung = abs(sb) < 1e-9 ? (sa >= sd ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) : normalize(vec2(sb, l1 - sa));
  vec2 gross = min(sqrt(l1), 1024.0) * richtung;
  vec2 klein = min(sqrt(l2), 1024.0) * vec2(richtung.y, -richtung.x);
  vec2 versatz = ecke.x * gross + ecke.y * klein; // Pixel
  // z: Tiefe der Mitte, für den Tiefentest gegen die Flächen
  gl_Position = vec4(clip.xy / clip.w + versatz * 2.0 / groesse, clip.z / clip.w, 1.0);
  lage = ecke;
  farbe = vec4(float(a.w & 255u), float((a.w >> 8) & 255u), float((a.w >> 16) & 255u), float(a.w >> 24)) / 255.0;
  farbe.a *= roentgen;
  // Gegenstand unter der Maus: heller und etwas wärmer
  if (hervor.w > 0.0 && distance(p, hervor.xyz) < hervor.w) farbe.rgb = mix(farbe.rgb, vec3(1.0, 0.92, 0.75), leuchten);
}`;

const FLECK = `#version 300 es
precision highp float;
in vec4 farbe;
in vec2 lage;
out vec4 aus;
void main() {
  float r2 = dot(lage, lage);
  if (r2 > 9.0) discard;
  float a = farbe.a * exp(-0.5 * r2);
  if (a < 1.0 / 255.0) discard;
  aus = vec4(farbe.rgb * a, a);
}`;

// Flächen: Dreiecke mit Lage und Bildkoordinate (u, v); das Bild (Video oder Foto) als Textur
const FL_ECKE = `#version 300 es
uniform mat4 ansicht, projektion;
in vec3 lage;
in vec2 uv;
out vec2 bild;
void main() {
  gl_Position = projektion * ansicht * vec4(lage, 1.0);
  bild = uv;
}`;
const FL_FARBE = `#version 300 es
precision highp float;
uniform sampler2D textur;
uniform vec4 ausschnitt; // „cover“: welcher Teil des Bildes auf die Fläche passt (Versatz xy, Größe zw)
in vec2 bild;
out vec4 aus;
void main() {
  aus = vec4(texture(textur, ausschnitt.xy + bild * ausschnitt.zw).rgb, 1.0);
}`;

function programm(gl, ecke, farbe) {
  const p = gl.createProgram();
  for (const [typ, text] of [[gl.VERTEX_SHADER, ecke], [gl.FRAGMENT_SHADER, farbe]]) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function erstelleZeichner(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, depth: true });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  const p = programm(gl, ECKE, FLECK);
  const ort = (n) => gl.getUniformLocation(p, n);
  const u = {};
  for (const n of ["daten", "ansicht", "projektion", "fokus", "groesse", "hervor", "leuchten", "schnitt", "ortho", "nah", "kugel", "roentgen", "ebene"]) u[n] = ort(n);
  const fp = programm(gl, FL_ECKE, FL_FARBE);
  const fu = {};
  for (const n of ["ansicht", "projektion", "textur", "ausschnitt"]) fu[n] = gl.getUniformLocation(fp, n);
  const flVao = gl.createVertexArray();
  gl.bindVertexArray(flVao);
  const flPuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, flPuffer);
  const flLage = gl.getAttribLocation(fp, "lage"), flUv = gl.getAttribLocation(fp, "uv");
  gl.enableVertexAttribArray(flLage);
  gl.vertexAttribPointer(flLage, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(flUv);
  gl.vertexAttribPointer(flUv, 2, gl.FLOAT, false, 20, 12);
  const texturen = new Map(); // Bild- oder Video-Element → Textur

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const eckPuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, eckPuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-3, -3, 3, -3, -3, 3, 3, 3]), gl.STATIC_DRAW);
  const eckOrt = gl.getAttribLocation(p, "ecke");
  gl.enableVertexAttribArray(eckOrt);
  gl.vertexAttribPointer(eckOrt, 2, gl.FLOAT, false, 0, 0);
  const nummerPuffer = gl.createBuffer();
  const nummerOrt = gl.getAttribLocation(p, "nummer");
  gl.bindBuffer(gl.ARRAY_BUFFER, nummerPuffer);
  gl.enableVertexAttribArray(nummerOrt);
  gl.vertexAttribIPointer(nummerOrt, 1, gl.UNSIGNED_INT, 0, 0);
  gl.vertexAttribDivisor(nummerOrt, 1);

  const textur = gl.createTexture();
  let anzahl = 0;
  let sortiert = 0; // so viele Nummern liegen im Puffer

  function setzeSzene({ anzahl: n, lage, kov, farbe }) {
    anzahl = n;
    const hoehe = Math.ceil((n * 3) / BREITE);
    const daten = new Uint32Array(BREITE * hoehe * 4);
    const f = new Float32Array(daten.buffer);
    const farben = new Uint32Array(farbe.buffer, farbe.byteOffset, n);
    for (let i = 0; i < n; i++) {
      const o = i * 12;
      f[o] = lage[3 * i];
      f[o + 1] = lage[3 * i + 1];
      f[o + 2] = lage[3 * i + 2];
      daten[o + 3] = farben[i];
      f[o + 4] = kov[6 * i];
      f[o + 5] = kov[6 * i + 1];
      f[o + 6] = kov[6 * i + 2];
      f[o + 8] = kov[6 * i + 3];
      f[o + 9] = kov[6 * i + 4];
      f[o + 10] = kov[6 * i + 5];
    }
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, BREITE, hoehe, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, daten);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    sortiert = 0;
  }

  function setzeReihenfolge(reihenfolge) {
    gl.bindBuffer(gl.ARRAY_BUFFER, nummerPuffer);
    gl.bufferData(gl.ARRAY_BUFFER, reihenfolge, gl.DYNAMIC_DRAW);
    sortiert = reihenfolge.length;
  }

  // ein Bild oder Video auf die Grafikkarte (Video: in jedem Bild neu, solange es läuft)
  function bildTextur(quelle) {
    let t = texturen.get(quelle);
    const bereit = quelle instanceof HTMLVideoElement ? quelle.readyState >= 2 : quelle.complete && quelle.naturalWidth > 0;
    if (!bereit) return null;
    if (!t) {
      t = { tex: gl.createTexture(), geladen: false };
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
      texturen.set(quelle, t);
    }
    if (!t.geladen || quelle instanceof HTMLVideoElement) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // Bilder fangen oben an, Texturen unten
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      t.geladen = true;
    }
    return t.tex;
  }
  const vergiss = (quelle) => {
    const t = texturen.get(quelle);
    if (t) gl.deleteTexture(t.tex);
    texturen.delete(quelle);
  };

  // k: Kamera aus kamera.js; hintergrund [r, g, b]; hervor [x, y, z, radius] oder null
  // extra: { flaechen: [{ dreiecke (Float32Array x y z u v), quelle (Bild/Video), ausschnitt }], nah, kugel, roentgen,
  //          ebene, maske (true: nur Splats vor der Ebene, durchsichtiger Hintergrund) }
  function zeichne(k, hintergrund, hervor = null, leuchten = 0, schnitt = 1e9, extra = {}) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (extra.maske) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(hintergrund[0], hintergrund[1], hintergrund[2], 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // 1. Flächen (deckend, schreiben Tiefe)
    if (!extra.maske) {
      gl.disable(gl.BLEND);
      gl.useProgram(fp);
      gl.bindVertexArray(flVao);
      gl.uniformMatrix4fv(fu.ansicht, false, k.ansicht);
      gl.uniformMatrix4fv(fu.projektion, false, k.projektion);
      gl.uniform1i(fu.textur, 1);
      for (const f of extra.flaechen ?? []) {
        const t = bildTextur(f.quelle);
        if (!t) continue;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform4fv(fu.ausschnitt, f.ausschnitt ?? [0, 0, 1, 1]);
        gl.bindBuffer(gl.ARRAY_BUFFER, flPuffer);
        gl.bufferData(gl.ARRAY_BUFFER, f.dreiecke, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, f.dreiecke.length / 5);
      }
    }
    if (!sortiert) return;
    // 2. Splats (Tiefentest an, aber selbst keine Tiefe schreiben)
    gl.depthMask(false);
    gl.useProgram(p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.uniform1i(u.daten, 0);
    gl.uniformMatrix4fv(u.ansicht, false, k.ansicht);
    gl.uniformMatrix4fv(u.projektion, false, k.projektion);
    gl.uniform2f(u.fokus, k.fokus, k.fokus);
    gl.uniform2f(u.groesse, canvas.width, canvas.height);
    gl.uniform4fv(u.hervor, hervor ?? [0, 0, 0, 0]);
    gl.uniform1f(u.leuchten, leuchten);
    gl.uniform1f(u.schnitt, schnitt);
    gl.uniform1f(u.ortho, k.ortho ? k.massstab : 0);
    gl.uniform1f(u.nah, extra.nah ?? 0);
    gl.uniform4fv(u.kugel, extra.kugel ?? [0, 0, 0, 0]);
    gl.uniform1f(u.roentgen, extra.roentgen ?? 1);
    gl.uniform4fv(u.ebene, extra.ebene ?? [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(sortiert, anzahl));
  }

  // Deckung der Splats vor einer Ebene, als Alphawerte (für die Maske über einer Seite im Fenster): einmal mit
  // durchsichtigem Hintergrund nur diese Splats zeichnen und die Pixel auslesen. Beim Mischen mit
  // (1, 1 − α) wird Alpha zu 1 − Π(1 − αᵢ), das ist die Deckung, unabhängig von der Reihenfolge.
  function deckungVor(k, ebene) {
    zeichne(k, [0, 0, 0], null, 0, 1e9, { maske: true, ebene });
    const pixel = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { pixel, breite: canvas.width, hoehe: canvas.height }; // Zeilen von unten nach oben
  }

  return { setzeSzene, setzeReihenfolge, zeichne, deckungVor, vergiss };
}
