// Stable Fluids nach Jos Stam (1999), auf der Grafikkarte mit WebGL2.
//
// (Die erste Fassung lief mit WebGPU und hat bei dir den Browser abstürzen lassen. WebGL2 kann hier alles, was
// gebraucht wird: jeder Schritt ist „ein Bild malen“, das in eine Textur geht. Es läuft in jedem Browser, auch auf
// dem Handy, und ich kann es hier richtig testen. WebGPU lohnt sich erst, wo viele an dieselbe Stelle schreiben,
// wie bei Physarum.)
//
// Eine Flüssigkeit, die man nicht zusammendrücken kann (Wasser, Rauch, langsame Luft), gehorcht den
// Navier-Stokes-Gleichungen:
//   ∂u/∂t = −(u · ∇)u − ∇p + ν∇²u + f      (Geschwindigkeit u: wird mitgetragen, Druck p schiebt, Kraft f)
//   ∇ · u = 0                                (nirgends entsteht oder verschwindet Flüssigkeit)
// Stam löst das in Schritten, jeder für sich einfach:
//   1. Mitnehmen (Advektion), „semi-Lagrange“: jede Zelle fragt, woher ihr Inhalt kam: x − dt · u(x), und holt dort
//      den Wert (bilinear). Das ist bei jedem Zeitschritt stabil, daher „Stable Fluids“. Preis: es verwischt etwas.
//   2. Kräfte: Maus, Strahlen, Musik (als weiche Kleckse, Gauß-förmig).
//   3. Wirbel verstärken (vorticity confinement, Fedkiw 2001): man misst, wo es sich dreht (Rotation ω), und schiebt
//      ein wenig in Drehrichtung nach; das gibt die kleinen Wirbel zurück, die Schritt 1 verwischt.
//   4. Projektion: Druck p aus ∇²p = ∇ · u (Poisson, mit Jacobi-Schritten), dann u ← u − ∇p. Was bleibt, ist
//      quellenfrei (Helmholtz-Zerlegung).
//   5. Die Tinte wird mit dem neuen Feld mitgenommen (wieder Schritt 1) und verblasst langsam.
//
// Texturen (RGBA16F, halbe Gleitkommazahlen: genau genug, lassen sich überall weich abtasten), alle doppelt, weil
// eine Textur nicht gleichzeitig gelesen und beschrieben werden kann (Ping-Pong):
//   geschw   rg = Geschwindigkeit in Zellen pro Sekunde
//   tinte    rgb = Farbe mal Menge, a = Menge (so groß wie das Bild, feiner als das Gitter)
//   druck, div, rot   (nur r)

const KLECKSE = 16;

const VOLL = `#version 300 es
in vec2 lage;
out vec2 uv;
void main() {
  uv = lage * 0.5 + 0.5;
  gl_Position = vec4(lage, 0.0, 1.0);
}`;

const KOPF = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
uniform vec2 texel;      // 1 / Größe des Gitters
uniform float rand;      // 0 Wände, 1 läuft herum
`;

const ADVEKTION = `${KOPF}
uniform sampler2D geschw;
uniform sampler2D quelle;
uniform float dt;
uniform float verlust;
void main() {
  // woher kam der Inhalt? (Geschwindigkeit in Zellen pro Sekunde, mal Zellgröße = Anteil des Bildes)
  vec2 her = uv - dt * texture(geschw, uv).xy * texel;
  farbe = texture(quelle, her) / (1.0 + verlust * dt);
}`;

const KLECKS = `${KOPF}
uniform sampler2D quelle;
uniform vec4 kleckse[${KLECKSE}];  // x, y (0 bis 1, y nach oben), Radius
uniform vec4 werte[${KLECKSE}];
uniform int anzahl;
uniform float seite;
void main() {
  vec4 wert = texture(quelle, uv);
  for (int i = 0; i < ${KLECKSE}; i++) {
    if (i >= anzahl) break;
    vec2 d = uv - kleckse[i].xy;
    if (rand > 0.5) d -= round(d); // herumlaufend: der kürzere Weg über den Rand
    d.x *= seite;
    wert += werte[i] * exp(-dot(d, d) / (kleckse[i].z * kleckse[i].z));
  }
  farbe = wert;
}`;

// Nachbarn: links, rechts, unten, oben
const NACHBARN = `
vec2 L() { return uv - vec2(texel.x, 0.0); }
vec2 R() { return uv + vec2(texel.x, 0.0); }
vec2 U() { return uv - vec2(0.0, texel.y); }
vec2 O() { return uv + vec2(0.0, texel.y); }
`;

const ROTATION = `${KOPF}${NACHBARN}
uniform sampler2D geschw;
void main() {
  float l = texture(geschw, L()).y, r = texture(geschw, R()).y;
  float u = texture(geschw, U()).x, o = texture(geschw, O()).x;
  farbe = vec4(0.5 * ((r - l) - (o - u)), 0.0, 0.0, 1.0); // ω = ∂v/∂x − ∂u/∂y
}`;

const WIRBEL = `${KOPF}${NACHBARN}
uniform sampler2D geschw;
uniform sampler2D rot;
uniform float wirbel;
uniform float dt;
void main() {
  float l = abs(texture(rot, L()).x), r = abs(texture(rot, R()).x);
  float u = abs(texture(rot, U()).x), o = abs(texture(rot, O()).x);
  float c = texture(rot, uv).x;
  // N zeigt dorthin, wo die Drehung stärker wird; die Kraft steht senkrecht dazu, in Drehrichtung
  vec2 n = 0.5 * vec2(r - l, o - u);
  n /= length(n) + 1e-5;
  vec2 v = texture(geschw, uv).xy + wirbel * c * vec2(n.y, -n.x) * dt;
  farbe = vec4(v, 0.0, 1.0);
}`;

const DIVERGENZ = `${KOPF}${NACHBARN}
uniform sampler2D geschw;
void main() {
  float l = texture(geschw, L()).x, r = texture(geschw, R()).x;
  float u = texture(geschw, U()).y, o = texture(geschw, O()).y;
  // Wände: die Wand spiegelt die Geschwindigkeit, es fließt nichts hinaus
  if (rand < 0.5) {
    vec2 m = texture(geschw, uv).xy;
    if (L().x < 0.0) l = -m.x;
    if (R().x > 1.0) r = -m.x;
    if (U().y < 0.0) u = -m.y;
    if (O().y > 1.0) o = -m.y;
  }
  farbe = vec4(0.5 * (r - l + o - u), 0.0, 0.0, 1.0);
}`;

const JACOBI = `${KOPF}${NACHBARN}
uniform sampler2D druck;
uniform sampler2D div;
void main() {
  float l = texture(druck, L()).x, r = texture(druck, R()).x;
  float u = texture(druck, U()).x, o = texture(druck, O()).x;
  // ∇²p = div, nach der Mitte aufgelöst: p = (Summe der Nachbarn − div) / 4
  farbe = vec4((l + r + u + o - texture(div, uv).x) * 0.25, 0.0, 0.0, 1.0);
}`;

const GEFAELLE = `${KOPF}${NACHBARN}
uniform sampler2D druck;
uniform sampler2D geschw;
void main() {
  float l = texture(druck, L()).x, r = texture(druck, R()).x;
  float u = texture(druck, U()).x, o = texture(druck, O()).x;
  vec2 v = texture(geschw, uv).xy - 0.5 * vec2(r - l, o - u);
  if (rand < 0.5) {
    if (L().x < 0.0 || R().x > 1.0) v.x = 0.0;
    if (U().y < 0.0 || O().y > 1.0) v.y = 0.0;
  }
  farbe = vec4(v, 0.0, 1.0);
}`;

// einfach malnehmen (Druck vom letzten Bild als Anfang, etwas schwächer) oder kopieren (faktor 1)
const MAL = `${KOPF}
uniform sampler2D quelle;
uniform float faktor;
void main() { farbe = texture(quelle, uv) * faktor; }`;

// Anzeige. art: 0 Tinte, 1 Strömung als Farbe (Richtung = Farbton, Tempo = Sättigung),
// 2 bis 4: Strömungslinien mit Line Integral Convolution (LIC, Cabral und Leedom 1993):
//   Jeder Pixel läuft ein Stück die Stromlinie entlang, vorwärts und rückwärts, und mittelt dabei ein Rauschen.
//   Pixel auf derselben Stromlinie sehen fast dasselbe Rauschen und werden gleich hell, quer dazu wechselt es:
//   es entstehen Striche genau in Strömungsrichtung, wie Eisenfeilspäne am Magneten.
//   Die Gewichte entlang der Linie sind eine wandernde Welle (Forssell 1995): so fließen die Striche sichtbar.
//   Der Schritt entlang der Linie: Mittelpunktsregel (erst einen halben Schritt, dort die Richtung neu messen).
//   (2: Linien allein, 3: Linien in der Tinte, 4: Linien mit der Richtung als Farbe)
// 5: Schlieren (Toepler 1864): wo sich die Menge der Tinte (hier: die Dichte) ändert, wird Licht abgelenkt; eine
//   Messerschneide fängt die Ablenkung zur einen Seite ab (dunkel), zur anderen nicht (hell), ohne Ablenkung grau.
//   Farbig: die Richtung der Ablenkung wählt die Farbe; Dunkelfeld: nur abgelenktes Licht kommt durch.
const ANZEIGE = `${KOPF}
uniform sampler2D tinte;
uniform sampler2D geschw;
uniform vec3 grund;
uniform float art;
uniform float staerke;
uniform vec2 bildGroesse;
uniform float laenge, koernung, zeit;
uniform float schlierenArt, schlierenStaerke, messerWinkel;
vec3 farbton(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}
float rauschen(vec2 p) {
  vec2 q = floor(p * bildGroesse / koernung);
  return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
}
float lic(vec2 start) {
  float summe = rauschen(start);
  float gewicht = 1.0;
  for (int r = -1; r <= 1; r += 2) {
    vec2 p = start;
    for (int i = 1; i <= 60; i++) {
      if (float(i) > laenge) break;
      vec2 v = texture(geschw, p).xy;
      if (dot(v, v) < 1e-6) break;
      vec2 m = texture(geschw, p + normalize(v) * float(r) * 0.5 / bildGroesse).xy;
      if (dot(m, m) < 1e-6) break;
      p += normalize(m) * float(r) / bildGroesse;
      float w = 0.5 + 0.5 * cos(3.14159 * float(i * r) / laenge - zeit * 4.0);
      summe += rauschen(p) * w;
      gewicht += w;
    }
  }
  // gemittelt wird das Rauschen grau: Kontrast wieder hochziehen (mit der Wurzel der Zahl der Proben)
  return clamp((summe / gewicht - 0.5) * sqrt(gewicht) * 0.9 + 0.5, 0.0, 1.0);
}
void main() {
  vec2 v = texture(geschw, uv).xy;
  float tempo = 1.0 - exp(-length(v) * staerke * 0.01);
  vec3 richtung = farbton(atan(v.y, v.x) / 6.2831853 + 0.5);
  if (art > 0.5 && art < 1.5) {
    farbe = vec4(mix(grund, richtung, tempo), 1.0);
    return;
  }
  vec4 t = texture(tinte, uv);
  if (art > 4.5) {
    vec2 e = 1.0 / bildGroesse;
    vec2 d = vec2(texture(tinte, uv + vec2(e.x, 0.0)).a - texture(tinte, uv - vec2(e.x, 0.0)).a,
                  texture(tinte, uv + vec2(0.0, e.y)).a - texture(tinte, uv - vec2(0.0, e.y)).a) * schlierenStaerke * 4.0;
    vec3 s;
    if (schlierenArt < 0.5) s = vec3(clamp(0.5 + dot(d, vec2(cos(messerWinkel), sin(messerWinkel))), 0.0, 1.0));
    else if (schlierenArt < 1.5) s = mix(vec3(0.5), farbton(atan(d.y, d.x) / 6.2831853 + 0.5), clamp(length(d) * 2.0, 0.0, 1.0));
    else s = vec3(clamp(length(d), 0.0, 1.0));
    farbe = vec4(s, 1.0);
    return;
  }
  // Menge a deckt den Grund ab (1 − e^(−a), sanft gegen 1), die Farbe ist rgb / a
  float deckt = 1.0 - exp(-max(t.a, 0.0) * staerke);
  vec3 f = clamp(t.rgb / max(t.a, 1e-4), 0.0, 1.0);
  vec3 tinteBild = mix(grund, f, deckt);
  if (art < 0.5) {
    farbe = vec4(tinteBild, 1.0);
    return;
  }
  float l = lic(uv);
  float sichtbar = smoothstep(0.0, 0.15, length(v) * 0.05); // wo es steht, gibt es keine Linien
  if (art < 2.5) farbe = vec4(mix(grund, vec3(l), sichtbar * (0.25 + 0.75 * tempo)), 1.0);
  else if (art < 3.5) farbe = vec4(tinteBild * mix(1.0, 0.35 + 1.1 * l, sichtbar * deckt), 1.0);
  else farbe = vec4(mix(grund, richtung * (0.25 + 0.95 * l), sichtbar * (0.3 + 0.7 * tempo)), 1.0);
}`;

export async function erstelleFluid(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, alpha: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) {
    throw new Error("Diese Grafikkarte kann in keine Float-Textur rechnen.");
  }

  function programm(quelle) {
    const p = gl.createProgram();
    for (const [typ, text] of [[gl.VERTEX_SHADER, VOLL], [gl.FRAGMENT_SHADER, quelle]]) {
      const s = gl.createShader(typ);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "lage");
    gl.linkProgram(p);
    const orte = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace("[0]", "");
      orte[name] = gl.getUniformLocation(p, name);
    }
    return { p, orte };
  }
  const P = {
    advektion: programm(ADVEKTION), klecks: programm(KLECKS), rotation: programm(ROTATION), wirbel: programm(WIRBEL),
    divergenz: programm(DIVERGENZ), jacobi: programm(JACOBI), gefaelle: programm(GEFAELLE), mal: programm(MAL), anzeige: programm(ANZEIGE),
  };

  const viereck = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, viereck);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  let gb = 0, gh = 0, tb = 0, th = 0, rand = 0;
  let geschw, tinte, druck, div, rot, gemerkt = null;

  // eine Zieltextur mit Framebuffer; wrap: REPEAT (herum) oder CLAMP_TO_EDGE (Wände)
  function ziel(b, h, wrap) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, b, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, fb, b, h };
  }
  const weg = (z) => z && (gl.deleteTexture(z.t), gl.deleteFramebuffer(z.fb));
  const paar = (b, h, wrap) => [ziel(b, h, wrap), ziel(b, h, wrap)];

  function neu(gitterB, gitterH, bildB, bildH, herum) {
    for (const z of [...(geschw ?? []), ...(tinte ?? []), ...(druck ?? []), div, rot, ...(gemerkt ?? [])]) weg(z);
    gemerkt = null;
    gb = gitterB; gh = gitterH; tb = bildB; th = bildH; rand = herum ? 1 : 0;
    canvas.width = tb;
    canvas.height = th;
    const wrap = herum ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    geschw = paar(gb, gh, wrap);
    tinte = paar(tb, th, wrap);
    druck = paar(gb, gh, wrap);
    div = ziel(gb, gh, wrap);
    rot = ziel(gb, gh, wrap);
  }

  // ein Durchgang: Programm, Ziel (oder null = Bildschirm), Texturen { name: textur }, Zahlen { name: wert }
  function lauf(prog, nach, texturen, zahlen = {}) {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, nach ? nach.fb : null);
    gl.viewport(0, 0, nach ? nach.b : canvas.width, nach ? nach.h : canvas.height);
    let einheit = 0;
    for (const [name, z] of Object.entries(texturen)) {
      gl.activeTexture(gl.TEXTURE0 + einheit);
      gl.bindTexture(gl.TEXTURE_2D, z.t);
      gl.uniform1i(prog.orte[name], einheit++);
    }
    const o = prog.orte;
    if (o.texel) gl.uniform2f(o.texel, 1 / gb, 1 / gh);
    if (o.rand) gl.uniform1f(o.rand, rand);
    for (const [name, wert] of Object.entries(zahlen)) {
      if (!o[name]) continue;
      if (Array.isArray(wert) || wert instanceof Float32Array) {
        if (wert.length === 3) gl.uniform3fv(o[name], wert);
        else gl.uniform4fv(o[name], wert);
      } else if (name === "anzahl") gl.uniform1i(o[name], wert);
      else gl.uniform1f(o[name], wert);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // Kleckse für den Shader: y umdrehen (die Seite rechnet y nach unten, Texturen nach oben)
  function kleckse(liste) {
    const k = new Float32Array(KLECKSE * 4);
    const w = new Float32Array(KLECKSE * 4);
    liste.slice(0, KLECKSE).forEach((x, i) => {
      k.set([x.x, 1 - x.y, x.r, 0], i * 4);
      w.set([x.wert[0], -x.wert[1], x.wert[2], x.wert[3]], i * 4);
    });
    return { kleckse: k, werte: w, anzahl: Math.min(liste.length, KLECKSE), seite: tb / th };
  }
  // Farbkleckse: die Werte sind Farben, da wird nichts umgedreht
  function farbKleckse(liste) {
    const k = kleckse(liste);
    liste.slice(0, KLECKSE).forEach((x, i) => k.werte.set(x.wert, i * 4));
    return k;
  }

  // ein Zeitschritt. w: { dt, verblassen, bremsen, wirbel, jacobi, druckBehalten, kraft: [Kleckse], farbe: [Kleckse] }
  function schritt(w) {
    // 1. Geschwindigkeit mit sich selbst mitnehmen
    lauf(P.advektion, geschw[1], { geschw: geschw[0], quelle: geschw[0] }, { dt: w.dt, verlust: w.bremsen });
    // 2. Kräfte
    lauf(P.klecks, geschw[0], { quelle: geschw[1] }, kleckse(w.kraft));
    // 3. Wirbel verstärken
    lauf(P.rotation, rot, { geschw: geschw[0] });
    lauf(P.wirbel, geschw[1], { geschw: geschw[0], rot }, { wirbel: w.wirbel, dt: w.dt });
    // 4. Projektion
    lauf(P.divergenz, div, { geschw: geschw[1] });
    lauf(P.mal, druck[1], { quelle: druck[0] }, { faktor: w.druckBehalten });
    let d = 1;
    for (let i = 0; i < w.jacobi; i++) {
      lauf(P.jacobi, druck[1 - d], { druck: druck[d], div });
      d = 1 - d;
    }
    lauf(P.gefaelle, geschw[0], { druck: druck[d], geschw: geschw[1] });
    if (d === 1) druck.reverse(); // der aktuelle Druck liegt danach in druck[0]
    // 5. Tinte: Kleckse dazu, dann mitnehmen
    lauf(P.klecks, tinte[1], { quelle: tinte[0] }, farbKleckse(w.farbe));
    lauf(P.advektion, tinte[0], { geschw: geschw[0], quelle: tinte[1] }, { dt: w.dt, verlust: w.verblassen });
  }

  // a: { grund [r, g, b], art (0 Tinte, 1 Geschwindigkeit, 2 bis 4 Linien), staerke, laenge, koernung, zeit }
  function zeige(a) {
    gl.useProgram(P.anzeige.p);
    gl.uniform2f(P.anzeige.orte.bildGroesse, tb, th);
    lauf(P.anzeige, null, { tinte: tinte[0], geschw: geschw[0] }, {
      grund: a.grund, art: a.art, staerke: a.staerke, laenge: a.laenge ?? 20, koernung: a.koernung ?? 1, zeit: a.zeit ?? 0,
      schlierenArt: a.schlierenArt ?? 0, schlierenStaerke: a.schlierenStaerke ?? 1, messerWinkel: ((a.messerWinkel ?? 0) * Math.PI) / 180,
    });
  }

  // ein Bild als Tinte (füllend), z. B. ein Foto, das dann zerfließt
  function bildAlsTinte(quelle) {
    const c = new OffscreenCanvas(tb, th);
    const k = c.getContext("2d");
    const f = Math.max(tb / quelle.width, th / quelle.height);
    k.drawImage(quelle, (tb - quelle.width * f) / 2, (th - quelle.height * f) / 2, quelle.width * f, quelle.height * f);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    lauf(P.mal, tinte[0], { quelle: { t } }, { faktor: 1 });
    gl.deleteTexture(t);
  }

  // Zustand merken und zurückholen (Vorschau im Export-Fenster): in Ersatztexturen kopieren
  function merke() {
    const quellen = [geschw[0], tinte[0], druck[0]];
    if (!gemerkt) gemerkt = quellen.map((z) => ziel(z.b, z.h, rand ? gl.REPEAT : gl.CLAMP_TO_EDGE));
    quellen.forEach((z, i) => lauf(P.mal, gemerkt[i], { quelle: z }, { faktor: 1 }));
    const kopien = gemerkt;
    return () => {
      if (kopien !== gemerkt) return; // inzwischen neu angelegt
      [geschw[0], tinte[0], druck[0]].forEach((z, i) => lauf(P.mal, z, { quelle: kopien[i] }, { faktor: 1 }));
    };
  }

  return { neu, schritt, zeige, bildAlsTinte, merke, groesse: () => ({ gb, gh, tb, th }) };
}
