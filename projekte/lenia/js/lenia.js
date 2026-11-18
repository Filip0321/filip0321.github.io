// Lenia (Bert Chan, 2019): ein Zellularautomat wie Conways Game of Life, nur stetig. Jede Zelle hat einen Wert A
// zwischen 0 und 1 statt tot/lebendig, Nachbarschaft ist ein weicher Ring statt der acht Nachbarn, und die Zeit läuft
// in kleinen Schritten dt statt in Sprüngen. Dabei entstehen „Lebewesen“, die sich bewegen, drehen, teilen.
//
//   U = K * A                     Faltung: gewichtetes Mittel über den Ring um jede Zelle (Radius R)
//   A ← clip(A + dt · G(U), 0, 1) Wachstum
//   G(U) = 2 · exp(−(U − μ)² / (2σ²)) − 1
//
// G ist eine Glocke um μ: liegt das gewichtete Mittel der Nachbarn nahe bei μ (Breite σ), wächst die Zelle (bis +1),
// sonst schrumpft sie (bis −1). Der Ring K (Kern) ist eine weiche Beule über dem Abstand r = d / R:
//   K(r) = exp(4 − 1 / (r (1 − r)))  für 0 < r < 1, sonst 0, und normiert (Summe 1)
// Mit μ = 0,15, σ = 0,015, R = 13, dt = 0,1 lebt darin das „Orbium“, Lenias Gleiter.
//
// Zwei Wege, die Faltung U = K * A zu rechnen (Runde 16):
//
// direkt  jede Zelle liest (2R+1)² Nachbarn, bei R = 13 sind das 729. Bei 1024² Zellen 765 Millionen Lesezugriffe
//         pro Schritt: zu langsam. Der Aufwand wächst mit R², ein großer Kern ist teuer.
// FFT     Faltungssatz: die Fourier-Transformation macht aus einer Faltung ein Malnehmen,
//             F(K * A) = F(K) · F(A)    also    U = F⁻¹( F(K) · F(A) )
//         F(K) ändert sich nur mit dem Kern, wird also einmal gerechnet. Pro Schritt: A hin (F), malnehmen,
//         zurück (F⁻¹). Eine schnelle Fourier-Transformation (FFT) braucht für N Werte nur log2(N) Durchgänge;
//         in 2D erst alle Zeilen, dann alle Spalten. Bei N = 1024: 4 · 10 + 2 = 42 Durchgänge, jeder liest pro
//         Pixel 2 Werte. Unabhängig von R: auch ein Kern mit Radius 60 kostet nicht mehr.
//         Die FFT rechnet „periodisch“: was rechts hinausläuft, kommt links wieder herein. Genau das ist unsere
//         Welt (ein Torus), es passt also ohne Ränder.
//
// Die FFT hier ist die „Stockham“-Form (wie in vielen WebGL-Ozeanen): in Durchgang s werden Paare im Abstand N/2
// gelesen und mit einem Drehfaktor e^(∓2πi·k/L) verrechnet (L = 2, 4, 8 … N, die Länge der Teil-Transformation).
// Sie braucht kein Umsortieren der Indizes (Bit-Umkehr), darum passt sie gut in einen Fragment-Shader:
//   gerade = ⌊k / L⌋ · L/2 + (k mod L/2)
//   aus[k] = ein[gerade] + e^(∓2πi·k/L) · ein[gerade + N/2]
// Komplexe Zahlen stehen in r (Realteil) und g (Imaginärteil). Hin mit −, zurück mit + und am Ende durch N².

const ECKE = `#version 300 es
layout(location = 0) in vec2 lage;
out vec2 uv;
void main() { uv = lage * 0.5 + 0.5; gl_Position = vec4(lage, 0.0, 1.0); }`;

// Wachstum, gemeinsam für beide Wege: aus A und U das neue A, dazu malen
const WACHSEN = `
uniform float mu, sigma, dt;
uniform vec2 zelle;
uniform vec4 pinsel; // x, y (0 … 1), Radius (Zellen), Wert (−1: aus)
float wachse(float a, float u, vec2 uv) {
  float g = 2.0 * exp(-(u - mu) * (u - mu) / (2.0 * sigma * sigma)) - 1.0;
  a = clamp(a + dt * g, 0.0, 1.0);
  // malen: im Pinsel auf den Wert setzen (0 radiert)
  if (pinsel.w >= 0.0 && distance(uv / zelle, pinsel.xy / zelle) < pinsel.z) a = pinsel.w;
  return a;
}`;

const SCHRITT_DIREKT = `#version 300 es
precision highp float;
uniform sampler2D welt, kern;
uniform int R;
${WACHSEN}
in vec2 uv;
out vec4 aus;
void main() {
  float u = 0.0;
  for (int dy = -R; dy <= R; dy++)
    for (int dx = -R; dx <= R; dx++) {
      float w = texelFetch(kern, ivec2(dx + R, dy + R), 0).r;
      if (w == 0.0) continue;
      u += w * texture(welt, uv + vec2(dx, dy) * zelle).r;
    }
  aus = vec4(wachse(texture(welt, uv).r, u, uv), u, 0.0, 1.0);
}`;

const SCHRITT_FFT = `#version 300 es
precision highp float;
uniform sampler2D welt, faltung; // faltung.r: U aus der FFT
${WACHSEN}
in vec2 uv;
out vec4 aus;
void main() {
  float u = texture(faltung, uv).r;
  aus = vec4(wachse(texture(welt, uv).r, u, uv), u, 0.0, 1.0);
}`;

const FFT = `#version 300 es
precision highp float;
uniform sampler2D quelle, dreh; // dreh: N × 1, (cos, sin) von 2π·m/N, auf der CPU gerechnet
uniform float N, L, vorzeichen, skal;
uniform int waagrecht, echt; // echt: Eingang ist reell (A im Kanal r), sonst komplex (r, g)
out vec4 aus;
vec2 lies(vec2 p) {
  vec4 t = texelFetch(quelle, ivec2(p), 0);
  return echt == 1 ? vec2(t.r, 0.0) : t.rg;
}
void main() {
  vec2 pix = floor(gl_FragCoord.xy);
  float k = waagrecht == 1 ? pix.x : pix.y;
  float gerade = floor(k / L) * (L * 0.5) + mod(k, L * 0.5);
  vec2 pg = pix, pu = pix;
  if (waagrecht == 1) { pg.x = gerade; pu.x = gerade + N * 0.5; }
  else { pg.y = gerade; pu.y = gerade + N * 0.5; }
  vec2 a = lies(pg), b = lies(pu);
  // Drehfaktor e^(∓2πi·k/L) = e^(∓2πi·m/N) mit m = (k mod L) · N/L: aus einer Tabelle statt sin/cos im Shader.
  // Grafikkarten rechnen sin und cos oft nur auf etwa 4 Stellen genau; gemessen war U damit um 2·10⁻⁴ daneben.
  vec2 d = texelFetch(dreh, ivec2(int(mod(k, L) * (N / L)), 0), 0).rg;
  d.y *= -vorzeichen; // Tabelle hat −sin (vorwärts); rückwärts das andere Vorzeichen
  vec2 r = a + vec2(d.x * b.x - d.y * b.y, d.x * b.y + d.y * b.x);
  aus = vec4(r * skal, 0.0, 1.0);
}`;

const MAL = `#version 300 es
precision highp float;
uniform sampler2D a, b;
in vec2 uv;
out vec4 aus;
void main() {
  vec2 x = texture(a, uv).rg, y = texture(b, uv).rg;
  aus = vec4(x.x * y.x - x.y * y.y, x.x * y.y + x.y * y.x, 0.0, 1.0);
}`;

const BILD = `#version 300 es
precision highp float;
uniform sampler2D welt, verlauf;
uniform vec3 hell, dunkel;
uniform int art; // 0 Zellen A, 1 Nachbarschaft U
uniform int mitVerlauf; // 1: Farbe aus dem Verlauf (256 × 1), sonst zwischen dunkel und hell
uniform vec3 kopf; // Lesekopf: x = Lage (0 … 1), y = 0 Spalte / 1 Zeile, z = 1 an
uniform float strich; // halbe Breite des Strichs (0 … 1): eine halbe Zelle, aber mindestens gut ein Bildschirmpixel
in vec2 uv;
out vec4 aus;
// Die Welt hat wenige Zellen (128 … 1024) auf viel Bildschirm: von Hand bilinear zwischen den vier nächsten Zellen
// mischen (die Textur selbst bleibt NEAREST, damit das Rechnen jede Zelle genau trifft)
float wert(vec2 p) {
  vec4 z = texture(welt, p);
  return art == 0 ? z.r : clamp(z.g * 4.0, 0.0, 1.0);
}
void main() {
  vec2 n = vec2(textureSize(welt, 0)), p = uv * n - 0.5, f = fract(p), z = (floor(p) + 0.5) / n;
  float v = mix(mix(wert(z), wert(z + vec2(1, 0) / n), f.x), mix(wert(z + vec2(0, 1) / n), wert(z + 1.0 / n), f.x), f.y);
  if (kopf.z > 0.5) {
    float an = kopf.y < 0.5 ? uv.x : uv.y;
    if (abs(an - kopf.x) < strich) v = max(v, 0.35);
  }
  vec3 farbe = mitVerlauf == 1 ? texture(verlauf, vec2(v, 0.5)).rgb : mix(dunkel, hell, v);
  aus = vec4(farbe, 1.0);
}`;

function programm(gl, a, b) {
  const p = gl.createProgram();
  for (const [typ, text] of [[gl.VERTEX_SHADER, a], [gl.FRAGMENT_SHADER, b]]) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const o = {};
  return { p, ort: (n) => (o[n] ??= gl.getUniformLocation(p, n)) };
}

const istZweierpotenz = (n) => n > 0 && (n & (n - 1)) === 0;

export function erstelleLenia(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Dieser Browser kann nicht in Fließkomma-Texturen rechnen.");
  const direkt = programm(gl, ECKE, SCHRITT_DIREKT), mitFft = programm(gl, ECKE, SCHRITT_FFT);
  const fft = programm(gl, ECKE, FFT), mal = programm(gl, ECKE, MAL), bild = programm(gl, ECKE, BILD);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  let N = 256, welt = [], lesen = 0, kernTex = null, R = 13;
  let hilf = [], kernSpektrum = null, kernBild = null; // für die FFT
  let weg = "auto"; // "auto", "direkt", "fft"
  let drehTex = null;
  const verlaufTex = gl.createTexture();
  let mitVerlauf = false;

  function tex(b, h, daten, filter, wrap) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, b, h, 0, gl.RGBA, gl.FLOAT, daten);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  function ziel(t) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, fb };
  }
  const weg_ = (liste) => liste.forEach((z) => { gl.deleteTexture(z.t); gl.deleteFramebuffer(z.fb); });

  // Welt: N × N, A im Kanal r (32 Bit, damit kleine dt-Schritte nicht in der Rundung verschwinden), U in g
  function groesse(n, start = null) {
    weg_(welt);
    weg_(hilf);
    if (kernSpektrum) weg_([kernSpektrum]);
    kernSpektrum = null;
    N = n;
    welt = [0, 1].map(() => ziel(tex(n, n, start, gl.NEAREST, gl.REPEAT)));
    hilf = istZweierpotenz(n) ? [0, 1].map(() => ziel(tex(n, n, null, gl.NEAREST, gl.REPEAT))) : [];
    // Drehfaktoren e^(−2πi·m/N) für m = 0 … N−1, mit 64 Bit gerechnet, als (cos, −sin) gespeichert
    if (drehTex) gl.deleteTexture(drehTex);
    const t = new Float32Array(n * 4);
    for (let m = 0; m < n; m++) {
      t[m * 4] = Math.cos((2 * Math.PI * m) / n);
      t[m * 4 + 1] = -Math.sin((2 * Math.PI * m) / n);
    }
    drehTex = tex(n, 1, t, gl.NEAREST, gl.CLAMP_TO_EDGE);
    lesen = 0;
    if (kernBild) baueKernSpektrum();
  }

  // Kern: Beule über dem Ring, normiert (Summe 1). Zweimal abgelegt: klein (2R+1)² für den direkten Weg, und als
  // Bild N × N, den Mittelpunkt bei (0, 0) und negative Versätze ans andere Ende gewickelt (−1 → N − 1): so
  // erwartet ihn die periodische FFT.
  function setzeKern(r) {
    R = r;
    const s = 2 * R + 1, w = new Float32Array(s * s * 4);
    let summe = 0;
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        const q = Math.hypot(x, y) / R;
        const k = q > 0 && q < 1 ? Math.exp(4 - 1 / (q * (1 - q))) : 0;
        w[((y + R) * s + (x + R)) * 4] = k;
        summe += k;
      }
    for (let i = 0; i < w.length; i += 4) w[i] /= summe;
    if (kernTex) gl.deleteTexture(kernTex);
    kernTex = tex(s, s, w, gl.NEAREST, gl.CLAMP_TO_EDGE);
    kernBild = w;
    baueKernSpektrum();
  }

  function baueKernSpektrum() {
    if (!istZweierpotenz(N) || 2 * R + 1 > N) return;
    const s = 2 * R + 1, d = new Float32Array(N * N * 4);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) d[((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4] = kernBild[((y + R) * s + (x + R)) * 4];
    const roh = tex(N, N, d, gl.NEAREST, gl.REPEAT);
    if (!kernSpektrum) kernSpektrum = ziel(tex(N, N, null, gl.NEAREST, gl.REPEAT));
    transformiere(roh, -1, kernSpektrum, 1);
    gl.deleteTexture(roh);
  }

  // 2D-FFT von quelle (Textur) nach ziel ({ t, fb }): erst alle Zeilen, dann alle Spalten, je log2(N) Durchgänge,
  // im Wechsel durch die beiden Hilfstexturen; der letzte Durchgang schreibt ins Ziel
  function transformiere(quelle, vorzeichen, ziel, skal = 1, echt = true) {
    gl.useProgram(fft.p);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, N, N);
    gl.uniform1f(fft.ort("N"), N);
    gl.uniform1f(fft.ort("vorzeichen"), vorzeichen);
    gl.uniform1i(fft.ort("quelle"), 0);
    gl.uniform1i(fft.ort("dreh"), 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, drehTex);
    gl.activeTexture(gl.TEXTURE0);
    const stufen = Math.log2(N);
    let von = quelle, h = 0;
    for (const waagrecht of [1, 0])
      for (let s = 1; s <= stufen; s++) {
        const letzter = waagrecht === 0 && s === stufen;
        const nach = letzter ? ziel : hilf[h];
        gl.uniform1i(fft.ort("waagrecht"), waagrecht);
        gl.uniform1i(fft.ort("echt"), echt && von === quelle ? 1 : 0);
        gl.uniform1f(fft.ort("L"), 2 ** s);
        gl.uniform1f(fft.ort("skal"), letzter ? skal : 1);
        gl.bindTexture(gl.TEXTURE_2D, von);
        gl.bindFramebuffer(gl.FRAMEBUFFER, nach.fb);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        von = nach.t;
        h = 1 - h;
      }
  }

  const nimmFft = () => kernSpektrum && hilf.length && (weg === "fft" || (weg === "auto" && (2 * R + 1) ** 2 > 100));

  function rechne(n, { mu, sigma, dt, pinsel = null }) {
    const viaFft = nimmFft();
    // FFT braucht Platz für F(A) und U: die Welt-Textur, die gerade nicht gelesen wird („frei“), dazu hilf[0] und [1]
    for (let i = 0; i < n; i++) {
      let p;
      if (viaFft) {
        const frei = welt[1 - lesen];
        transformiere(welt[lesen].t, -1, frei, 1, true); // F(A) nach „frei“
        gl.useProgram(mal.p); // F(A) · F(K) nach hilf[0]
        gl.viewport(0, 0, N, N);
        gl.uniform1i(mal.ort("a"), 0);
        gl.uniform1i(mal.ort("b"), 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, frei.t);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, kernSpektrum.t);
        gl.bindFramebuffer(gl.FRAMEBUFFER, hilf[0].fb);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        transformiereZurueck(frei); // F⁻¹: hilf[0] → frei, darin steht danach U
        p = mitFft;
        gl.useProgram(p.p);
        gl.uniform1i(p.ort("faltung"), 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, frei.t);
      } else {
        p = direkt;
        gl.useProgram(p.p);
        gl.uniform1i(p.ort("R"), R);
        gl.uniform1i(p.ort("kern"), 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, kernTex);
      }
      gl.viewport(0, 0, N, N);
      gl.uniform2f(p.ort("zelle"), 1 / N, 1 / N);
      gl.uniform1f(p.ort("mu"), mu);
      gl.uniform1f(p.ort("sigma"), sigma);
      gl.uniform1f(p.ort("dt"), dt);
      gl.uniform1i(p.ort("welt"), 0);
      gl.uniform4fv(p.ort("pinsel"), i === 0 && pinsel ? pinsel : [0, 0, 0, -1]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, welt[lesen].t);
      // FFT-Weg: „frei“ hält U und ist zugleich das Ziel; das darf nicht sein (lesen und schreiben in dieselbe
      // Textur). Darum schreibt er nach hilf[1] und tauscht danach die Rollen.
      if (viaFft) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, hilf[1].fb);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        [welt[1 - lesen], hilf[1]] = [hilf[1], welt[1 - lesen]];
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, welt[1 - lesen].fb);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      lesen = 1 - lesen;
    }
  }

  // F⁻¹ von hilf[0] nach ziel, mit 1/N² am Ende. Die Durchgänge wechseln zwischen hilf[1] und ziel als Zwischenlager
  // (ziel wird erst ganz am Ende gebraucht), damit Quelle und Ziel eines Durchgangs nie dieselbe Textur sind.
  function transformiereZurueck(endziel) {
    gl.useProgram(fft.p);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, N, N);
    gl.uniform1f(fft.ort("N"), N);
    gl.uniform1f(fft.ort("vorzeichen"), 1);
    gl.uniform1i(fft.ort("quelle"), 0);
    gl.uniform1i(fft.ort("echt"), 0);
    gl.uniform1i(fft.ort("dreh"), 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, drehTex);
    gl.activeTexture(gl.TEXTURE0);
    const stufen = Math.log2(N), gesamt = 2 * stufen;
    const lager = [hilf[1], endziel];
    let von = hilf[0].t, zaehler = 0;
    for (const waagrecht of [1, 0])
      for (let s = 1; s <= stufen; s++) {
        zaehler++;
        // abwechselnd hilf[1] und endziel; die Anzahl ist gerade (2 · stufen), also landet der letzte im endziel
        const nach = lager[(zaehler - 1) % 2];
        gl.uniform1i(fft.ort("waagrecht"), waagrecht);
        gl.uniform1f(fft.ort("L"), 2 ** s);
        gl.uniform1f(fft.ort("skal"), zaehler === gesamt ? 1 / (N * N) : 1);
        gl.bindTexture(gl.TEXTURE_2D, von);
        gl.bindFramebuffer(gl.FRAMEBUFFER, nach.fb);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        von = nach.t;
      }
  }

  function setzeVerlauf(tabelle) {
    mitVerlauf = Boolean(tabelle);
    if (!tabelle) return;
    gl.bindTexture(gl.TEXTURE_2D, verlaufTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, tabelle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // kopf: { lage (0 … 1), zeile (true: waagrechter Strich) } oder null; spalte (alt, Patch-Wand): Lage einer Spalte
  function zeichne({ hell = [0.867, 0.867, 0.867], dunkel = [0.067, 0.067, 0.067], art = "zellen", spalte = -1, kopf = null }) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(bild.p);
    gl.bindVertexArray(vao);
    gl.uniform3fv(bild.ort("hell"), hell);
    gl.uniform3fv(bild.ort("dunkel"), dunkel);
    gl.uniform1i(bild.ort("art"), art === "nachbarn" ? 1 : 0);
    gl.uniform1i(bild.ort("mitVerlauf"), mitVerlauf ? 1 : 0);
    const k = kopf ?? (spalte >= 0 ? { lage: spalte, zeile: false } : null);
    gl.uniform3f(bild.ort("kopf"), k?.lage ?? 0, k?.zeile ? 1 : 0, k ? 1 : 0);
    gl.uniform1f(bild.ort("strich"), Math.max(0.5 / N, 1.2 / canvas.width));
    gl.uniform1i(bild.ort("welt"), 0);
    gl.uniform1i(bild.ort("verlauf"), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, welt[lesen].t);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, verlaufTex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function lies() {
    const d = new Float32Array(N * N * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, welt[lesen].fb);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, d);
    return d;
  }
  function schreib(d) {
    gl.bindTexture(gl.TEXTURE_2D, welt[lesen].t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, d);
  }
  function sichere() {
    const d = lies();
    return () => schreib(d);
  }
  // Welt auf der CPU ändern (Wesen setzen): ganz auslesen, fn ändert das Feld, wieder hochladen.
  // Bei 256² sind das 1 MB hin und zurück, bei 1024² 16 MB: für einen Klick egal, für jedes Bild zu viel.
  function bearbeite(fn) {
    const d = lies();
    fn(d, N);
    schreib(d);
  }

  // eine Spalte (oder Zeile) auslesen, für den Lesekopf: N Werte A, nur 1 × N Zellen, viel billiger als die Welt
  // Spalte: von unten nach oben; Zeile: von links nach rechts
  function spalte(x, zeile = false) {
    const d = new Float32Array(N * 4), a = new Float32Array(N);
    gl.bindFramebuffer(gl.FRAMEBUFFER, welt[lesen].fb);
    if (zeile) gl.readPixels(0, x, N, 1, gl.RGBA, gl.FLOAT, d);
    else gl.readPixels(x, 0, 1, N, gl.RGBA, gl.FLOAT, d);
    for (let i = 0; i < N; i++) a[i] = d[i * 4];
    return a;
  }

  return {
    groesse, setzeKern, rechne, zeichne, sichere, bearbeite, spalte, setzeVerlauf,
    setzeWeg: (w) => (weg = w),
    weg: () => (nimmFft() ? "FFT" : "direkt"),
    get n() { return N; },
  };
}

// Anfang: „Ursuppe“ aus zufälligen Flecken (Zufall mit Startwert, mulberry32, damit ein Video wiederholbar ist)
export function ursuppe(N, saat, dichte = 0.5, flecken = 12) {
  let s = saat | 0;
  const zufall = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const d = new Float32Array(N * N * 4);
  for (let f = 0; f < flecken; f++) {
    const cx = zufall() * N, cy = zufall() * N, r = N * (0.04 + zufall() * 0.06);
    for (let y = Math.floor(cy - r); y < cy + r; y++)
      for (let x = Math.floor(cx - r); x < cx + r; x++) {
        if (Math.hypot(x - cx, y - cy) > r || zufall() > dichte) continue;
        const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
        d[i * 4] = zufall();
      }
  }
  return d;
}

// Muster (aus wesen.js entpackt) gedreht und vergrößert an (mx, my) in die Welt d schreiben. Für jede Zielzelle
// rückwärts fragen, woher sie im Muster kommt (Drehung um −winkel, geteilt durch den Maßstab), und die nächste
// Musterzelle nehmen: so bleibt das Bild ohne Löcher. Lenia-Wesen vertragen das, weil der Kern rund ist; die Regel
// hat keine Lieblingsrichtung.
// Nicht bilinear mischen: das verwischt die Spitzen um eine halbe Zelle, und bei manchen Winkeln stirbt das Orbium
// daran (gemessen: 2 von 16 Winkeln tot, mit der nächsten Zelle 0 von 16). Darum auch der ganzzahlige Mittelpunkt.
// massstab: ein Wesen für Radius R lebt auch bei Radius q · R, wenn es q-mal so groß ist (Lenia ist im Grenzfall
// feiner Zellen maßstabsfrei); das vergrößerte Muster ist anfangs eckig und rundet sich in den ersten Schritten.
export function setzeMuster(d, N, muster, mx, my, winkel, massstab = 1) {
  const { breite: b, hoehe: h, wert } = muster;
  const q = massstab;
  const c = Math.cos(winkel), s = Math.sin(winkel), r = Math.ceil((q * Math.hypot(b, h)) / 2 + 1);
  const bm = Math.floor(b / 2), hm = Math.floor(h / 2);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      // Muster-Zeile 0 ist oben, Textur-Zeile 0 unten: darum −dy
      const ux = Math.round((c * dx + s * dy) / q) + bm, uy = Math.round((s * dx - c * dy) / q) + hm;
      if (ux < 0 || uy < 0 || ux >= b || uy >= h) continue;
      const v = wert(ux, uy);
      if (v <= 0) continue;
      const x = (((Math.round(mx) + dx) % N) + N) % N, y = (((Math.round(my) + dy) % N) + N) % N;
      d[(y * N + x) * 4] = Math.max(d[(y * N + x) * 4], v);
    }
}
