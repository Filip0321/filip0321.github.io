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
  if (kam.z > -0.05 || clip.x < -rand || clip.x > rand || clip.y < -rand || clip.y > rand) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  uvec4 b = texelFetch(daten, ort(i + 1u), 0);
  uvec4 c = texelFetch(daten, ort(i + 2u), 0);
  vec3 s1 = uintBitsToFloat(b.xyz), s2 = uintBitsToFloat(c.xyz);
  mat3 V = mat3(s1.x, s1.y, s1.z, s1.y, s2.x, s2.y, s1.z, s2.y, s2.z);
  float z = -kam.z;
  // Ableitung von (fx · x / z, fy · y / z) nach (x, y, z); dritte Zeile 0 (Spalten zuerst geschrieben)
  mat3 J = mat3(fokus.x / z, 0.0, 0.0, 0.0, fokus.y / z, 0.0, fokus.x * kam.x / (z * z), fokus.y * kam.y / (z * z), 0.0);
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
  gl_Position = vec4(clip.xy / clip.w + versatz * 2.0 / groesse, 0.0, 1.0);
  lage = ecke;
  farbe = vec4(float(a.w & 255u), float((a.w >> 8) & 255u), float((a.w >> 16) & 255u), float(a.w >> 24)) / 255.0;
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

export function erstelleZeichner(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  const p = gl.createProgram();
  for (const [typ, text] of [[gl.VERTEX_SHADER, ECKE], [gl.FRAGMENT_SHADER, FLECK]]) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const ort = (n) => gl.getUniformLocation(p, n);
  const u = { daten: ort("daten"), ansicht: ort("ansicht"), projektion: ort("projektion"), fokus: ort("fokus"), groesse: ort("groesse"), hervor: ort("hervor"), leuchten: ort("leuchten") };

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

  // k: Kamera aus kamera.js; hintergrund [r, g, b]; hervor [x, y, z, radius] oder null
  function zeichne(k, hintergrund, hervor = null, leuchten = 0.3) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(hintergrund[0], hintergrund[1], hintergrund[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!sortiert) return;
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
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(sortiert, anzahl));
  }

  return { setzeSzene, setzeReihenfolge, zeichne };
}
