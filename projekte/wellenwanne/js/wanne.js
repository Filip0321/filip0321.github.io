// Die Wellenwanne auf der Grafikkarte: die Wellengleichung auf einem Gitter, Bild für Bild weitergerechnet
// (Ping-Pong: aus Textur A wird B gerechnet, dann aus B wieder A).
//
// ---------- Die Gleichung ----------
//   ∂²u/∂t² = c² ∇²u
// u ist die Auslenkung der Wasseroberfläche, c die Geschwindigkeit der Wellen. ∇²u (Laplace) misst, wie sehr ein
// Punkt unter oder über dem Mittel seiner Nachbarn liegt; genau dorthin wird er beschleunigt. Auf dem Gitter:
//   ∇²u ≈ (u_links + u_rechts + u_oben + u_unten − 4u) / h²
// und für die Zeit das Leapfrog-Verfahren (die zweite Ableitung aus drei Zeitpunkten):
//   u_neu = 2u − u_alt + (c Δt / h)² · ∇²u · h²
// Darum steht in jeder Zelle u UND u_alt (Kanal R und G). Stabil ist das nur, wenn eine Welle pro Schritt höchstens
// etwa eine Zelle weit kommt (Courant-Friedrichs-Lewy): c Δt / h ≤ 1/√2 in 2D. Hier ist es 0,5, also (cΔt/h)² = 0,25.
//
// ---------- Wände, Glas, Rand ----------
// Medium-Textur (aus medium.js, auf der CPU gemalt): R = Wand, G = Brechzahl n (c wird zu c/n: im Glas langsamer, so
// biegt eine Linse die Wellen), B = Dämpfung. Eine Wand hält die Oberfläche fest (u = 0): die Welle wird dort mit
// umgedrehtem Vorzeichen zurückgeworfen. Am Bildrand soll sie dagegen verschwinden wie ins offene Meer; ein Rand,
// der einfach endet, würde sie zurückwerfen. Darum ein Schwamm: in einem Streifen am Rand wird die GESCHWINDIGKEIT
// der Oberfläche (u − u_alt) bei jedem Schritt ein wenig gebremst, allmählich zunehmend (sonst wirft schon der Sprung
// in der Dämpfung zurück):  u_neu = u + (1 − d)(u − u_alt) + (cΔt/h)² · (Laplace)
// Nachgemessen (numpy, ein Wellenpaket, 256 × 256): so bleiben 0,1 % der Energie im Feld zurück. Die erste Fassung
// dämpfte stattdessen u selbst ((2u − u_alt + …) · (1 − d)); das warf ein Viertel zurück, und man sah ein Schachbrett.
//
// ---------- Quellen ----------
// Punktquellen schwingen mit A · sin(2π f t + φ) und werden weich eingeprägt (eine kleine Glocke, damit keine
// Gitterkanten entstehen). Eine ebene Welle kommt von links: dort schwingt die ganze erste Spalte.
//
// ---------- Intensität ----------
// Das Muster hinter einem Doppelspalt sieht man in der Auslenkung nur flüchtig. Der Mittelwert von u² über die Zeit
// (Kanal B, gleitend: I ← I + (u² − I) / τ) zeigt die hellen und dunklen Streifen ruhig an, wie ein Schirm.

const ECKE = `#version 300 es
layout(location = 0) in vec2 lage;
out vec2 uv;
void main() {
  uv = lage * 0.5 + 0.5;
  gl_Position = vec4(lage, 0.0, 1.0);
}`;

const MAX_QUELLEN = 16;

const SCHRITT = `#version 300 es
precision highp float;
uniform sampler2D zustand, medium;
uniform vec2 zelle;               // 1 / Gittergröße
uniform float zeit, tau;
uniform int anzahl;
uniform vec4 quellen[${MAX_QUELLEN}]; // x, y (0 … 1), Frequenz (Schwingungen pro Schritt), Phase
uniform vec2 staerken[${MAX_QUELLEN}]; // Amplitude, Radius (Zellen)
uniform vec3 ebene;               // ebene Welle von links: an (0/1), Frequenz, Amplitude
in vec2 uv;
out vec4 aus;
void main() {
  vec4 z = texture(zustand, uv);
  vec4 m = texture(medium, uv);
  if (m.r > 0.5) { aus = vec4(0.0, 0.0, z.b * (1.0 - 1.0 / tau), 0.0); return; } // Wand
  float u = z.r, alt = z.g;
  // Nachbarn; eine Wand als Nachbar zählt mit u = 0
  float l = texture(zustand, uv - vec2(zelle.x, 0.0)).r * (1.0 - step(0.5, texture(medium, uv - vec2(zelle.x, 0.0)).r));
  float r = texture(zustand, uv + vec2(zelle.x, 0.0)).r * (1.0 - step(0.5, texture(medium, uv + vec2(zelle.x, 0.0)).r));
  float o = texture(zustand, uv + vec2(0.0, zelle.y)).r * (1.0 - step(0.5, texture(medium, uv + vec2(0.0, zelle.y)).r));
  float n = texture(zustand, uv - vec2(0.0, zelle.y)).r * (1.0 - step(0.5, texture(medium, uv - vec2(0.0, zelle.y)).r));
  float lap = l + r + o + n - 4.0 * u;
  float brech = max(1.0, m.g * 3.0);   // gespeichert als n / 3
  float c2 = 0.25 / (brech * brech);
  float neu = u + (1.0 - m.b) * (u - alt) + c2 * lap;
  // Punktquellen
  vec2 px = uv / zelle;
  for (int i = 0; i < ${MAX_QUELLEN}; i++) {
    if (i >= anzahl) break;
    vec4 q = quellen[i];
    float d = distance(px, q.xy / zelle);
    float glocke = exp(-0.5 * d * d / (staerken[i].y * staerken[i].y));
    neu += glocke * staerken[i].x * sin(6.2831853 * q.z * zeit + q.w) * c2;
  }
  // ebene Welle: die ersten Spalten links (hinter dem Schwamm)
  if (ebene.x > 0.5 && px.x < 14.0 && px.x > 12.0) neu = ebene.z * sin(6.2831853 * ebene.y * zeit);
  float inten = z.b + (neu * neu - z.b) / tau;
  aus = vec4(neu, u, inten, 0.0);
}`;

const BILD = `#version 300 es
precision highp float;
uniform sampler2D zustand, medium;
uniform int art;           // 0 Auslenkung, 1 Intensität, 2 beides
uniform float verstaerkung;
uniform vec3 hell, dunkel, wand;
in vec2 uv;
out vec4 aus;
void main() {
  vec4 z = texture(zustand, uv);
  vec4 m = texture(medium, uv);
  float wert;
  if (art == 1) wert = sqrt(z.b) * verstaerkung * 1.4;
  else if (art == 0) wert = 0.5 + 0.5 * z.r * verstaerkung;
  else wert = 0.5 * (0.5 + 0.5 * z.r * verstaerkung) + 0.5 * sqrt(z.b) * verstaerkung * 1.4;
  wert = clamp(wert, 0.0, 1.0);
  vec3 farbe = mix(dunkel, hell, wert);
  // Glas: etwas heller unterlegt, damit man die Linse sieht
  farbe = mix(farbe, hell, step(1.01, m.g * 3.0) * 0.08);
  if (m.r > 0.5) farbe = wand;
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
  const orte = {};
  return { p, ort: (n) => (orte[n] ??= gl.getUniformLocation(p, n)) };
}

export function erstelleWanne(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  // in Fließkomma-Texturen rechnen dürfen (sonst nur 8 Bit: die Wellen würden sofort zerbröseln)
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float"))
    throw new Error("Dieser Browser kann nicht in Fließkomma-Texturen rechnen (EXT_color_buffer_float fehlt).");
  const schritt = programm(gl, ECKE, SCHRITT);
  const bild = programm(gl, ECKE, BILD);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const puffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  let B = 0, H = 0, ziele = [], lesen = 0, mediumTex = null, zeit = 0;

  function textur(b, h, intern, format, typ, daten = null) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, intern, b, h, 0, format, typ, daten);
    for (const [a, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, v);
    return t;
  }

  function groesse(b, h) {
    for (const z of ziele) {
      gl.deleteTexture(z.tex);
      gl.deleteFramebuffer(z.fb);
    }
    B = b;
    H = h;
    ziele = [0, 1].map(() => {
      const tex = textur(b, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    });
    leeren();
  }

  function leeren() {
    for (const z of ziele) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, z.fb);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    zeit = 0;
  }

  // Medium aus medium.js: Uint8Array RGBA, so groß wie das Gitter (Zeile 0 = unten, wie in WebGL)
  function setzeMedium(daten) {
    if (mediumTex) gl.deleteTexture(mediumTex);
    mediumTex = textur(B, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, daten);
  }

  // n Schritte; quellen: [{ x, y, f, phase, a, r }], ebene: { an, f, a }; tau: Gedächtnis der Intensität (Schritte)
  function rechne(n, { quellen, ebene, tau }) {
    gl.useProgram(schritt.p);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, B, H);
    gl.uniform2f(schritt.ort("zelle"), 1 / B, 1 / H);
    gl.uniform1f(schritt.ort("tau"), tau);
    const q = quellen.slice(0, MAX_QUELLEN);
    gl.uniform1i(schritt.ort("anzahl"), q.length);
    if (q.length) {
      gl.uniform4fv(schritt.ort("quellen"), q.flatMap((s) => [s.x, s.y, s.f, s.phase ?? 0]));
      gl.uniform2fv(schritt.ort("staerken"), q.flatMap((s) => [s.a, s.r]));
    }
    gl.uniform3f(schritt.ort("ebene"), ebene.an ? 1 : 0, ebene.f, ebene.a);
    gl.uniform1i(schritt.ort("zustand"), 0);
    gl.uniform1i(schritt.ort("medium"), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mediumTex);
    for (let i = 0; i < n; i++) {
      const von = ziele[lesen], nach = ziele[1 - lesen];
      gl.uniform1f(schritt.ort("zeit"), zeit);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, von.tex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, nach.fb);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lesen = 1 - lesen;
      zeit += 1;
    }
  }

  function zeichne({ art, verstaerkung, hell, dunkel, wand }) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(bild.p);
    gl.bindVertexArray(vao);
    gl.uniform1i(bild.ort("art"), { auslenkung: 0, intensitaet: 1, beides: 2 }[art] ?? 0);
    gl.uniform1f(bild.ort("verstaerkung"), verstaerkung);
    gl.uniform3fv(bild.ort("hell"), hell);
    gl.uniform3fv(bild.ort("dunkel"), dunkel);
    gl.uniform3fv(bild.ort("wand"), wand);
    gl.uniform1i(bild.ort("zustand"), 0);
    gl.uniform1i(bild.ort("medium"), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ziele[lesen].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mediumTex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // einen Wert an einer Stelle lesen (für das Mikrofon in der Wanne): Auslenkung und Intensität
  const pixel = new Float32Array(4);
  function lies(x, y) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, ziele[lesen].fb);
    gl.readPixels(Math.floor(x * B), Math.floor(y * H), 1, 1, gl.RGBA, gl.FLOAT, pixel);
    return { u: pixel[0], i: pixel[2] };
  }

  // Zustand sichern und zurückholen (Export-Vorschau: „merke“)
  function sichere() {
    const daten = new Float32Array(B * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ziele[lesen].fb);
    gl.readPixels(0, 0, B, H, gl.RGBA, gl.FLOAT, daten);
    const z = zeit, l = lesen;
    return () => {
      zeit = z;
      lesen = l;
      // alt aus derselben Sicherung: G steckt mit drin
      gl.bindTexture(gl.TEXTURE_2D, ziele[lesen].tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, B, H, gl.RGBA, gl.FLOAT, daten);
    };
  }

  return { groesse, leeren, setzeMedium, rechne, zeichne, lies, sichere, get zeit() { return zeit; }, get breite() { return B; }, get hoehe() { return H; } };
}
