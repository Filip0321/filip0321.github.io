// Windkanal mit der Gitter-Boltzmann-Methode (Lattice Boltzmann, D2Q9), auf der Grafikkarte mit WebGL2.
//
// Die Strömung (/projekte/stroemung) rechnet mit den Navier-Stokes-Gleichungen: Geschwindigkeit und Druck als
// Felder. Lattice Boltzmann geht einen Schritt tiefer, zu den Teilchen: In jeder Zelle sitzen Pakete von Luftteilchen,
// die in 9 Richtungen unterwegs sind (D2Q9: 2 Dimensionen, 9 Richtungen: stehen, 4 gerade, 4 schräg). f_i ist, wie
// viel in Richtung i fliegt. Ein Schritt hat nur zwei Teile:
//
//   Strömen   jedes Paket hüpft eine Zelle weiter in seine Richtung:  f_i(x + c_i) ← f_i(x)
//   Stoßen    in jeder Zelle nähern sich die Pakete dem Gleichgewicht, das zu Dichte und Geschwindigkeit dort passt
//             (BGK, Bhatnagar-Gross-Krook 1954):  f_i ← f_i + ω (f_i^eq − f_i)
//
//   Dichte ρ = Σ f_i,   Geschwindigkeit u = Σ f_i c_i / ρ
//   f_i^eq = w_i ρ (1 + 3 c_i·u + 4,5 (c_i·u)² − 1,5 u²)       Gewichte w: 4/9 (stehen), 1/9 (gerade), 1/36 (schräg)
//
// Daraus kommen (Chapman-Enskog-Entwicklung) im Großen wieder die Navier-Stokes-Gleichungen heraus, mit der Zähigkeit
// ν = (1/ω − 1/2) / 3. Jede Zelle braucht nur ihre Nachbarn: perfekt für die Grafikkarte. Und Hindernisse sind fast
// geschenkt: ein Paket, das gegen eine feste Zelle fliegt, kommt einfach umgekehrt zurück („Bounce-back“). So bekommt
// eine Wand von selbst die Haftbedingung (Luft klebt an der Oberfläche), aus der hinter einem Zylinder die
// Kármánsche Wirbelstraße wird.
//
// Speicher: 9 Zahlen pro Zelle in drei RGBA32F-Texturen, alle in einem Durchgang geschrieben (mehrere Ziele, MRT):
//   A = f0 f1 f2 f3,  B = f4 f5 f6 f7,  C = f8 ρ ux uy   (ρ und u gleich mit, fürs Bild)
// „Ziehen“ statt „Schieben“: jede Zelle holt sich f_i von x − c_i (ein Fragment-Shader kann nur sein eigenes Pixel
// schreiben). Ränder: links strömt Luft mit u = (U, 0) ein (Gleichgewicht), rechts fließt sie ab (Wert vom Nachbarn),
// oben und unten gleiten sie an glatten Wänden entlang (gespiegelt).
//
// Rauch: eine eigene Textur, die mit u mitgenommen wird (semi-Lagrange wie in der Strömung) und links in Fäden
// nachgefüllt wird. So sieht man die Stromlinien wie im echten Windkanal mit Rauchsonden.

const ECKE = `#version 300 es
layout(location = 0) in vec2 lage;
void main() { gl_Position = vec4(lage, 0.0, 1.0); }`;

// Richtungen c_i und Gewichte w_i
const KOPF = `#version 300 es
precision highp float;
const ivec2 C[9] = ivec2[9](ivec2(0,0), ivec2(1,0), ivec2(0,1), ivec2(-1,0), ivec2(0,-1), ivec2(1,1), ivec2(-1,1), ivec2(-1,-1), ivec2(1,-1));
const float W[9] = float[9](4.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0);
const int GEGEN[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);   // umgekehrte Richtung (Bounce-back)
const int SPIEGEL[9] = int[9](0, 1, 4, 3, 2, 8, 7, 6, 5); // oben/unten gespiegelt (glatte Wand)
float feq(int i, float rho, vec2 u) {
  float cu = dot(vec2(C[i]), u);
  return W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * dot(u, u));
}`;

const SCHRITT = `${KOPF}
uniform sampler2D A, B, Cc, fest;
uniform ivec2 N;
uniform float omega, U;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
layout(location = 2) out vec4 oC;
float lies(ivec2 p, int i) {
  if (i < 4) return texelFetch(A, p, 0)[i];
  if (i < 8) return texelFetch(B, p, 0)[i - 4];
  return texelFetch(Cc, p, 0).x;
}
bool istFest(ivec2 p) { return texelFetch(fest, p, 0).r > 0.5; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float f[9];
  if (istFest(p)) {
    for (int i = 0; i < 9; i++) f[i] = feq(i, 1.0, vec2(0.0));
    oA = vec4(f[0], f[1], f[2], f[3]); oB = vec4(f[4], f[5], f[6], f[7]); oC = vec4(f[8], 1.0, 0.0, 0.0);
    return;
  }
  if (p.x == 0) {
    // Einlass: Gleichgewicht mit der Windgeschwindigkeit
    for (int i = 0; i < 9; i++) f[i] = feq(i, 1.0, vec2(U, 0.0));
  } else {
    // Strömen (ziehen): f_i kommt von p − c_i
    for (int i = 0; i < 9; i++) {
      ivec2 q = p - C[i];
      if (q.y < 0 || q.y >= N.y) {
        // glatte Wand oben/unten: das Paket kommt gespiegelt von der Seite
        ivec2 s = ivec2(q.x, p.y);
        s.x = clamp(s.x, 0, N.x - 1);
        f[i] = lies(s, SPIEGEL[i]);
      } else if (q.x >= N.x) {
        f[i] = lies(ivec2(N.x - 1, q.y), i); // Auslass: wie der letzte Nachbar
      } else if (istFest(q)) {
        f[i] = lies(p, GEGEN[i]); // Bounce-back: kam gegen die Wand, fliegt zurück
      } else {
        f[i] = lies(q, i);
      }
    }
  }
  // Stoßen
  float rho = 0.0; vec2 u = vec2(0.0);
  for (int i = 0; i < 9; i++) { rho += f[i]; u += f[i] * vec2(C[i]); }
  u /= rho;
  // Sicherung: über etwa 0,35 wird das Verfahren instabil (die Gleichgewichtsformel gilt nur für kleine u)
  float l = length(u);
  if (l > 0.35) u *= 0.35 / l;
  for (int i = 0; i < 9; i++) f[i] += omega * (feq(i, rho, u) - f[i]);
  oA = vec4(f[0], f[1], f[2], f[3]); oB = vec4(f[4], f[5], f[6], f[7]); oC = vec4(f[8], rho, u);
}`;

// Rauch mitnehmen: woher kam er? x − u · dt. Der Rauch ist doppelt so fein wie das Gitter (F = 2) und wird nur alle
// paar Schritte mitgenommen, dafür um die Strecke mehrerer Schritte. Warum: jedes Mitnehmen mischt beim weichen
// Abtasten (bilinear) Nachbarn hinein, und bei 0,1 Zellen pro Schritt wären die Fäden nach ein paar hundert Schritten
// zu Nebel verwischt. Seltener und weiter heißt: viel weniger Mischen für dieselbe Strecke.
const RAUCH = `#version 300 es
precision highp float;
uniform sampler2D rauch, Cc, fest;
uniform vec2 N;
uniform float F, dt, abstand, breite, verblassen;
out vec4 aus;
void main() {
  vec2 p = gl_FragCoord.xy, zelle = p / F;
  ivec2 z = ivec2(zelle);
  vec2 u = texelFetch(Cc, z, 0).zw;
  float r = texture(rauch, (p - u * dt * F) / (N * F)).r * verblassen;
  if (zelle.x < 2.0 && mod(zelle.y + abstand * 0.5, abstand) < breite) r = 1.0;
  if (texelFetch(fest, z, 0).r > 0.5) r = 0.0;
  aus = vec4(r, 0.0, 0.0, 1.0);
}`;

const BILD = `#version 300 es
precision highp float;
uniform sampler2D Cc, rauch, fest, verlauf;
uniform vec2 N, leinwand;
uniform int art, mitVerlauf;
uniform float U, staerke;
uniform vec3 hell, dunkel, wandFarbe;
uniform vec3 sonde; // xy in Zellen, z = an
out vec4 aus;
vec4 c(vec2 p) { return texture(Cc, p / N); }
void main() {
  vec2 uv = gl_FragCoord.xy / leinwand;
  vec2 p = uv * N;
  vec2 px = 1.5 / leinwand; // 1,5 Bildpunkte
  if (texture(fest, uv).r > 0.5) {
    // Hindernisse beim Rauch voll, sonst nur der Umriss: sonst verschwimmen helle Wirbel mit der Wand
    bool rand = texture(fest, uv + vec2(px.x, 0)).r < 0.5 || texture(fest, uv - vec2(px.x, 0)).r < 0.5
             || texture(fest, uv + vec2(0, px.y)).r < 0.5 || texture(fest, uv - vec2(0, px.y)).r < 0.5;
    aus = vec4(art == 0 || rand ? wandFarbe : dunkel, 1.0);
    return;
  }
  float v, signiert = 0.0;
  if (art == 0) v = texture(rauch, uv).r;
  else if (art == 1) v = length(c(p).zw) / (U * 1.6);
  else if (art == 2) {
    // Wirbelstärke ω = ∂uy/∂x − ∂ux/∂y (zentrale Differenzen)
    float w = (c(p + vec2(1, 0)).w - c(p - vec2(1, 0)).w - c(p + vec2(0, 1)).z + c(p - vec2(0, 1)).z) * 0.5;
    signiert = clamp(w / U * 8.0 * staerke, -1.0, 1.0);
    v = abs(signiert);
  } else {
    // Druck: in LBM ist p = ρ / 3; gezeigt die Abweichung vom Mittel
    signiert = clamp((c(p).y - 1.0) * 40.0 * staerke, -1.0, 1.0);
    v = abs(signiert);
  }
  v = clamp(v * (art == 0 ? staerke : 1.0), 0.0, 1.0);
  vec3 farbe;
  if (mitVerlauf == 1) farbe = texture(verlauf, vec2(art >= 2 ? signiert * 0.5 + 0.5 : v, 0.5)).rgb;
  else {
    // zwei Farben und ein Vorzeichen (Drehsinn, Über-/Unterdruck): positiv voll, negativ schraffiert
    if (signiert < 0.0) v *= step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 6.0));
    farbe = mix(dunkel, hell, v);
  }
  if (sonde.z > 0.5) {
    float r = length(p - sonde.xy);
    if (abs(r - 3.0) < 0.6 * N.x / leinwand.x + 0.4) farbe = wandFarbe; // kleiner Ring
  }
  aus = vec4(farbe, 1.0);
}`;

function programm(gl, b) {
  const p = gl.createProgram();
  for (const [typ, text] of [[gl.VERTEX_SHADER, ECKE], [gl.FRAGMENT_SHADER, b]]) {
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

export function erstelleWindkanal(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Dieser Browser kann nicht in Fließkomma-Texturen rechnen.");
  const weich = Boolean(gl.getExtension("OES_texture_float_linear"));
  const schritt = programm(gl, SCHRITT), rauchP = programm(gl, RAUCH), bild = programm(gl, BILD);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  let NX = 512, NY = 256, zustand = [], rauch = [], lesen = 0, rLesen = 0;
  const festTex = gl.createTexture(), verlaufTex = gl.createTexture();
  let mitVerlauf = false;

  function tex(b, h, intern, format, typ, daten, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, intern, b, h, 0, format, typ, daten);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }

  // überall schon Wind U (der Kanal läuft schon), dazu eine winzige Querbewegung: ein vollkommen symmetrischer
  // Anfang würde lange symmetrisch bleiben, und die Wirbelstraße käme erst spät (wenn Rundungsfehler sie anstoßen)
  function groesse(nx, ny, U = 0.08) {
    for (const z of [...zustand, ...rauch]) {
      [].concat(z.t).forEach((t) => gl.deleteTexture(t));
      gl.deleteFramebuffer(z.fb);
    }
    NX = nx;
    NY = ny;
    const w = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
    const cx = [0, 1, 0, -1, 0, 1, -1, -1, 1], cy = [0, 0, 1, 0, -1, 1, 1, -1, -1];
    const d = [new Float32Array(nx * ny * 4), new Float32Array(nx * ny * 4), new Float32Array(nx * ny * 4)];
    const f = new Float32Array(9);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const ux = U, uy = 0.01 * U * Math.sin((x / nx) * Math.PI * 6), uu = ux * ux + uy * uy;
        for (let i = 0; i < 9; i++) {
          const cu = cx[i] * ux + cy[i] * uy;
          f[i] = w[i] * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * uu);
        }
        const k = (y * nx + x) * 4;
        d[0].set(f.subarray(0, 4), k);
        d[1].set(f.subarray(4, 8), k);
        d[2].set([f[8], 1, ux, uy], k);
      }
    }
    zustand = [0, 1].map(() => {
      // C (mit ρ und u) weich abtastbar fürs Bild, falls der Browser das bei Fließkomma kann; das Rechnen liest mit
      // texelFetch und ist davon unberührt
      const t = d.map((x, i) => tex(nx, ny, gl.RGBA32F, gl.RGBA, gl.FLOAT, x, i === 2 && weich ? gl.LINEAR : gl.NEAREST));
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      t.forEach((x, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, x, 0));
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      return { t, fb };
    });
    rauch = [0, 1].map(() => {
      const t = tex(nx * 2, ny * 2, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, fb };
    });
    lesen = rLesen = 0;
  }

  // Hindernisse: ein Canvas NX × NY, weiß = fest (main.js malt darauf)
  function setzeFest(maske) {
    gl.bindTexture(gl.TEXTURE_2D, festTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // Canvas-Zeile 0 ist oben, Textur-Zeile 0 unten
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, maske);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
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
  }

  const binde = (einheit, t) => {
    gl.activeTexture(gl.TEXTURE0 + einheit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  };

  // n Schritte. omega aus der Zähigkeit: ν = (1/ω − 1/2) / 3  →  ω = 1 / (3ν + 1/2)
  let seitRauch = 0;
  const RAUCH_ALLE = 6;
  function rechne(n, { nu, U, rauchAbstand = 12, rauchBreite = 2 }) {
    const omega = 1 / (3 * nu + 0.5);
    for (let k = 0; k < n; k++) {
      gl.viewport(0, 0, NX, NY);
      gl.useProgram(schritt.p);
      const von = zustand[lesen];
      binde(0, von.t[0]);
      binde(1, von.t[1]);
      binde(2, von.t[2]);
      binde(3, festTex);
      gl.uniform1i(schritt.ort("A"), 0);
      gl.uniform1i(schritt.ort("B"), 1);
      gl.uniform1i(schritt.ort("Cc"), 2);
      gl.uniform1i(schritt.ort("fest"), 3);
      gl.uniform2i(schritt.ort("N"), NX, NY);
      gl.uniform1f(schritt.ort("omega"), omega);
      gl.uniform1f(schritt.ort("U"), U);
      gl.bindFramebuffer(gl.FRAMEBUFFER, zustand[1 - lesen].fb);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lesen = 1 - lesen;
      if (++seitRauch < RAUCH_ALLE && k < n - 1) continue;
      // Rauch mit dem neuen u, um seitRauch Schritte auf einmal
      gl.viewport(0, 0, NX * 2, NY * 2);
      gl.useProgram(rauchP.p);
      binde(0, rauch[rLesen].t);
      binde(1, zustand[lesen].t[2]);
      binde(2, festTex);
      gl.uniform1i(rauchP.ort("rauch"), 0);
      gl.uniform1i(rauchP.ort("Cc"), 1);
      gl.uniform1i(rauchP.ort("fest"), 2);
      gl.uniform2f(rauchP.ort("N"), NX, NY);
      gl.uniform1f(rauchP.ort("F"), 2);
      gl.uniform1f(rauchP.ort("dt"), seitRauch);
      gl.uniform1f(rauchP.ort("abstand"), rauchAbstand);
      gl.uniform1f(rauchP.ort("breite"), rauchBreite);
      gl.uniform1f(rauchP.ort("verblassen"), 0.99995 ** seitRauch);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rauch[1 - rLesen].fb);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rLesen = 1 - rLesen;
      seitRauch = 0;
    }
  }

  const ARTEN = { rauch: 0, tempo: 1, wirbel: 2, druck: 3 };
  function zeichne({ art = "rauch", U = 0.08, staerke = 1, hell, dunkel, wand, sonde = null }) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(bild.p);
    binde(0, zustand[lesen].t[2]);
    binde(1, rauch[rLesen].t);
    binde(2, festTex);
    binde(3, verlaufTex);
    gl.uniform1i(bild.ort("Cc"), 0);
    gl.uniform1i(bild.ort("rauch"), 1);
    gl.uniform1i(bild.ort("fest"), 2);
    gl.uniform1i(bild.ort("verlauf"), 3);
    gl.uniform2f(bild.ort("N"), NX, NY);
    gl.uniform2f(bild.ort("leinwand"), canvas.width, canvas.height);
    gl.uniform1i(bild.ort("art"), ARTEN[art]);
    gl.uniform1i(bild.ort("mitVerlauf"), mitVerlauf ? 1 : 0);
    gl.uniform1f(bild.ort("U"), U);
    gl.uniform1f(bild.ort("staerke"), staerke);
    gl.uniform3fv(bild.ort("hell"), hell);
    gl.uniform3fv(bild.ort("dunkel"), dunkel);
    gl.uniform3fv(bild.ort("wandFarbe"), wand);
    gl.uniform3f(bild.ort("sonde"), sonde?.x ?? 0, sonde ? NY - 1 - sonde.y : 0, sonde ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // eine Zelle lesen (Sonde): ρ, ux, uy
  const eins = new Float32Array(4);
  function sonde(x, y) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, zustand[lesen].fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    gl.readPixels(Math.round(x), Math.round(NY - 1 - y), 1, 1, gl.RGBA, gl.FLOAT, eins);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    return { rho: eins[1], ux: eins[2], uy: eins[3] };
  }

  function sichere() {
    const kopie = zustand[lesen].t.map((t) => {
      const d = new Float32Array(NX * NY * 4);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.readPixels(0, 0, NX, NY, gl.RGBA, gl.FLOAT, d);
      gl.deleteFramebuffer(fb);
      return d;
    });
    const l = lesen;
    return () => {
      lesen = l;
      zustand[lesen].t.forEach((t, i) => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NX, NY, gl.RGBA, gl.FLOAT, kopie[i]);
      });
    };
  }

  return { groesse, setzeFest, setzeVerlauf, rechne, zeichne, sonde, sichere, get nx() { return NX; }, get ny() { return NY; } };
}
