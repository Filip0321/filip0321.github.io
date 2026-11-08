// Die Rechnung auf der Grafikkarte: zwei Stoffe U (Futter) und V (Fresser) in einer Float-Textur (Rot = U,
// Grün = V). Jeder Schritt liest die eine Textur und schreibt die andere (Ping-Pong: eine Textur kann nicht
// gleichzeitig gelesen und beschrieben werden). Gray-Scott:
//   U += Du · ∇²U − U · V² + F · (1 − U)
//   V += Dv · ∇²V + U · V² − (F + k) · V
// mit Du = 1, Dv = 0,5, dt = 1 und dem Laplace-Kern von Karl Sims (Seiten 0,2, Ecken 0,05, Mitte −1).
//
// Richtung (Anisotropie): statt gleich in alle Richtungen breitet sich der Stoff längs eines Winkels stärker aus
// als quer dazu. Gemischt wird Sims' Kern mit einer Diffusion nur längs des Winkels (zweite Ableitung in die
// vier Gitterrichtungen, nach Nähe zum Winkel gewichtet). Die Muster werden gestreckt wie Maserung.
//
// Grenze: außerhalb des Kreises (Radius in Anteilen der kürzeren Seite) wird U = 1, V = 0 gesetzt: dort kann
// nichts leben. Davor ein weicher Rand, in dem k ansteigt (siehe unten). Drinnen geht es endlos weiter, aber es
// wird nie größer. Ohne Grenze laufen die Ränder herum
// (die Textur wiederholt sich: was rechts hinausläuft, kommt links wieder).
//
// F und k pro Stelle (art):
//   0  überall gleich
//   1  Verlauf: F wächst nach oben, k nach rechts, je ± spanne um den gewählten Punkt (alle Muster auf einmal)
//   2  Foto: die Helligkeit mischt zwischen „Muster im Dunkeln“ und „Muster im Hellen“

const VOLL = `#version 300 es
in vec2 lage;
out vec2 uv;
void main() {
  uv = lage * 0.5 + 0.5;
  gl_Position = vec4(lage, 0.0, 1.0);
}`;

// Keime: gesät wird nur in Kästchen von 8 × 8 Zellen auf einem Raster von 10, und davon nur in 60 % (fester
// Zufall je Kästchen). Warum: eine geschlossene Fläche oder ein glatter Ring aus V stirbt bei den Punkt-Mustern
// (Zellteilung, Pulsieren) ganz aus, innen verhungert der Fresser, und ein glatter Rand bricht nicht auf.
// Einzelne Kästchen mit Lücken dazwischen überleben und teilen sich (in numpy durchprobiert: Kreis voll
// 0 %, als Kästchen 5 % bei Zellteilung nach 3000 Schritten). Die Muster, die wuchern (Korallen, Labyrinth),
// schließen die Lücken in ein paar hundert Schritten von selbst.
const KEIM = `
float keim(vec2 zelle) {
  vec2 k = floor(zelle / 10.0);
  vec2 r = mod(zelle, 10.0);
  float z = fract(sin(dot(k, vec2(12.9898, 78.233))) * 43758.5453);
  return (r.x < 8.0 && r.y < 8.0 && z < 0.6) ? 1.0 : 0.0;
}`;

const SCHRITT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
uniform sampler2D zustand;
uniform sampler2D foto;
uniform vec2 gitter;       // Zellen in x und y
uniform vec2 fk;           // F, k (überall gleich, Mitte des Verlaufs)
uniform vec4 fkFoto;       // F, k im Dunkeln (xy) und im Hellen (zw)
uniform float art;         // 0 gleich, 1 Verlauf, 2 Foto
uniform float spanne;      // Verlauf: ± so viel um F und k
uniform float radius;      // Grenze: Anteil der kürzeren Seite, 0 = keine
uniform float rand;        // weicher Rand: so ein Anteil des Radius, in dem k ansteigt (0 = harte Kante)
uniform float richtung;    // Stärke der Richtung, 0 = gleich in alle Richtungen
uniform float winkel;      // Richtung in Bogenmaß
uniform vec4 pinsel;       // x, y (0 bis 1), Radius (Anteil der Breite), Art (1 säen, −1 löschen, 0 nichts)

vec2 hol(vec2 d) { return texture(zustand, uv + d / gitter).rg; }
${KEIM}

void main() {
  vec2 m = hol(vec2(0.0));
  vec2 l = hol(vec2(-1.0, 0.0)), r = hol(vec2(1.0, 0.0)), o = hol(vec2(0.0, 1.0)), u = hol(vec2(0.0, -1.0));
  vec2 lo = hol(vec2(-1.0, 1.0)), ro = hol(vec2(1.0, 1.0)), lu = hol(vec2(-1.0, -1.0)), ru = hol(vec2(1.0, -1.0));
  vec2 lap;
  // gleich in alle Richtungen: Sims' Kern
  lap = 0.2 * (l + r + o + u) + 0.05 * (lo + ro + lu + ru) - m;
  if (richtung > 0.001) {
    // Richtung: zweite Ableitungen längs der vier Gitterrichtungen (0°, 45°, 90°, 135°; die Diagonalen sind
    // √2 lang, daher halb), gewichtet nach der Nähe zum Winkel. Alle Gewichte sind positiv und die Mitte
    // bekommt höchstens 1: so bleibt es stabil (ein Tensor mit Kreuzterm uxy hat negative Gewichte und
    // schaukelt sich auf, das war der erste Versuch)
    vec4 d = vec4(l.r + r.r - 2.0 * m.r, 0.5 * (ro.r + lu.r - 2.0 * m.r), o.r + u.r - 2.0 * m.r, 0.5 * (lo.r + ru.r - 2.0 * m.r));
    vec4 dv = vec4(l.g + r.g - 2.0 * m.g, 0.5 * (ro.g + lu.g - 2.0 * m.g), o.g + u.g - 2.0 * m.g, 0.5 * (lo.g + ru.g - 2.0 * m.g));
    vec4 w = max(vec4(0.0), cos(2.0 * (winkel - vec4(0.0, 0.785398, 1.570796, 2.356194))));
    w /= dot(w, vec4(1.0));
    // 0,5 · zweite Ableitung längs: Mitte −1 wie bei Sims, also gleich stark
    vec2 laengs = 0.5 * vec2(dot(w, d), dot(w, dv));
    lap = mix(lap, laengs, richtung);
  }
  vec2 hier = fk;
  if (art > 0.5 && art < 1.5) hier = fk + spanne * vec2(uv.y - 0.5, uv.x - 0.5) * 2.0 * vec2(1.0, 0.4);
  if (art > 1.5) {
    float h = dot(texture(foto, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
    hier = mix(fkFoto.xy, fkFoto.zw, h);
  }
  // weicher Rand: zum Kreis hin steigt k um bis zu 0,05, weit über die Linie, auf der Muster leben können.
  // Die Muster lösen sich dort in Punkte auf und verschwinden, statt an einer Wand zu enden. An einer harten
  // Wand fließt von draußen volles Futter herein, daran wächst ein heller Ring (in numpy verglichen)
  float abstand = length((uv - 0.5) * gitter / min(gitter.x, gitter.y));
  if (radius > 0.0 && rand > 0.0) hier.y += 0.05 * smoothstep(radius * 0.5 * (1.0 - rand), radius * 0.5, abstand);
  float U = m.r, V = m.g;
  float uvv = U * V * V;
  U += 1.0 * lap.r - uvv + hier.x * (1.0 - U);
  V += 0.5 * lap.g + uvv - (hier.x + hier.y) * V;
  // Pinsel: säen (wie die Saat, nur in den Keim-Kästchen) oder löschen
  vec2 seite = vec2(gitter.x / gitter.y, 1.0);
  if (pinsel.w != 0.0 && length((uv - pinsel.xy) * seite) < pinsel.z * seite.x) {
    if (pinsel.w > 0.0) { if (keim(floor(uv * gitter)) > 0.5) { V = 1.0; U = 0.5; } } else { V = 0.0; U = 1.0; }
  }
  // Grenze: draußen lebt nichts
  if (radius > 0.0 && abstand > radius * 0.5) { U = 1.0; V = 0.0; }
  farbe = vec4(clamp(U, 0.0, 1.0), clamp(V, 0.0, 1.0), 0.0, 1.0);
}`;

// aus einer Saat (Graustufenbild, hell = säen) den Anfang machen; die Keim-Kästchen brechen die Symmetrie
const SAAT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
uniform sampler2D saat;
uniform vec2 gitter;
${KEIM}
void main() {
  vec3 s = texture(saat, uv).rgb;
  // weiß: säen, wo ein Keim-Kästchen liegt; rein grün: genau dort säen (die Punkte von „Kreis“ sind schon
  // getrennte Flecken). U = 0,5, V = 1 wie bei Karl Sims (V = 0,25 wie bei Pearson stirbt bei Zellteilung und
  // Würmern öfter aus)
  float an = s.r > 0.5 ? keim(floor(uv * gitter)) : (s.g > 0.5 ? 1.0 : 0.0);
  farbe = vec4(1.0 - 0.5 * an, an, 0.0, 1.0);
}`;

// anzeigen: V (oder U − V) durch eine Farbtabelle, wahlweise als beleuchtetes Relief
const ANZEIGE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
uniform sampler2D zustand;
uniform sampler2D tabelle;  // 256 × 1, die Farbskala
uniform vec2 gitter;
uniform float wert;         // 0: V, 1: U − V (zeigt auch das Futter)
uniform float kontrast;
uniform float verschieben;  // die Skala wandert (Musik)
uniform float relief;       // 0 aus, sonst Höhe des Reliefs
uniform float licht;        // Richtung der Lampe in Bogenmaß
uniform float umkehren;
uniform float kante;        // 0 weich, 1 ganz scharf (eine Linie bei der Hälfte, geglättet über ein Pixel)

// bilinear selbst (Float-Texturen lassen sich nicht überall linear filtern)
vec2 fein(vec2 p) {
  vec2 q = p * gitter - 0.5;
  vec2 i = floor(q), f = q - i;
  vec2 a = texture(zustand, (i + vec2(0.5, 0.5)) / gitter).rg, b = texture(zustand, (i + vec2(1.5, 0.5)) / gitter).rg;
  vec2 c = texture(zustand, (i + vec2(0.5, 1.5)) / gitter).rg, d = texture(zustand, (i + vec2(1.5, 1.5)) / gitter).rg;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float hoehe(vec2 p) {
  vec2 z = fein(p);
  return wert > 0.5 ? z.r - z.g : z.g;
}
void main() {
  float h = hoehe(uv);
  float t = wert > 0.5 ? clamp((h + 0.1) * 0.9, 0.0, 1.0) : clamp(h * 2.5, 0.0, 1.0);
  t = clamp((t - 0.5) * kontrast + 0.5, 0.0, 1.0);
  // Kante: aus dem weichen Verlauf eine Grenzlinie machen. fwidth(t) ist, wie stark t sich von einem Pixel zum
  // nächsten ändert: so breit wird mindestens geglättet, sonst wird die Kante treppig. So bleibt sie bei jeder
  // Bildgröße sauber, auch wenn das Bild viel feiner ist als das Gitter
  if (kante > 0.0) {
    float w = max(0.5 * (1.0 - kante), fwidth(t));
    t = smoothstep(0.5 - w, 0.5 + w, t);
  }
  if (umkehren > 0.5) t = 1.0 - t;
  vec3 f = texture(tabelle, vec2(fract(t * 0.998 + verschieben) * 0.996 + 0.002, 0.5)).rgb;
  if (relief > 0.0) {
    // Höhe aus V, Neigung aus den Nachbarn; Licht von schräg oben in Richtung „licht“
    vec2 e = 1.0 / gitter;
    float dx = hoehe(uv + vec2(e.x, 0.0)) - hoehe(uv - vec2(e.x, 0.0));
    float dy = hoehe(uv + vec2(0.0, e.y)) - hoehe(uv - vec2(0.0, e.y));
    vec3 n = normalize(vec3(-dx * relief * 20.0, -dy * relief * 20.0, 1.0));
    vec3 l = normalize(vec3(cos(licht), sin(licht), 0.8));
    float diffus = max(dot(n, l), 0.0);
    float glanz = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
    f = f * (0.35 + 0.75 * diffus) + vec3(glanz * 0.35);
  }
  farbe = vec4(f, 1.0);
}`;

export function erstelleSim(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  // Float-Texturen als Ziel: mit EXT_color_buffer_float in voller Genauigkeit (32 Bit), sonst halbe (16 Bit)
  const voll = gl.getExtension("EXT_color_buffer_float");
  const halb = voll || gl.getExtension("EXT_color_buffer_half_float");
  if (!halb) throw new Error("Diese Grafikkarte kann in keine Float-Textur rechnen.");
  const FORMAT = voll ? gl.RGBA32F : gl.RGBA16F;
  const TYP = voll ? gl.FLOAT : gl.HALF_FLOAT;

  const puffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

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
      const name = gl.getActiveUniform(p, i).name;
      orte[name] = gl.getUniformLocation(p, name);
    }
    return { p, orte };
  }
  const schrittP = programm(SCHRITT);
  const saatP = programm(SAAT);
  const anzeigeP = programm(ANZEIGE);

  function textur(b, h, format, typ, daten = null, filter = gl.NEAREST) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, b, h, 0, gl.RGBA, typ, daten);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  const bildTextur = (quelle) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // Canvas: oben zuerst; Textur: unten zuerst
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  let b = 0;
  let h = 0;
  let zustaende = []; // zwei { t, fb }
  let jetzt = 0; // welche gerade gilt
  let fotoT = textur(1, 1, gl.RGBA8, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]), gl.LINEAR);
  let tabelleT = textur(256, 1, gl.RGBA8, gl.UNSIGNED_BYTE, null, gl.LINEAR);

  function zeichneVoll(p) {
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // neue Größe des Gitters; danach säen
  function groesse(breite, hoehe) {
    for (const z of zustaende) {
      gl.deleteTexture(z.t);
      gl.deleteFramebuffer(z.fb);
    }
    b = breite;
    h = hoehe;
    zustaende = [0, 1].map(() => {
      const t = textur(b, h, FORMAT, TYP);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, fb };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // saatCanvas: so groß wie das Gitter, weiß = säen
  function saeen(saatCanvas) {
    const t = bildTextur(saatCanvas);
    gl.bindFramebuffer(gl.FRAMEBUFFER, zustaende[0].fb);
    gl.viewport(0, 0, b, h);
    gl.useProgram(saatP.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(saatP.orte.saat, 0);
    gl.uniform2f(saatP.orte.gitter, b, h);
    zeichneVoll(saatP.p);
    gl.deleteTexture(t);
    jetzt = 0;
  }

  function setzeFoto(quelle) {
    gl.deleteTexture(fotoT);
    fotoT = bildTextur(quelle);
  }
  function setzeTabelle(zahlen) {
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) rgba.set([zahlen[i * 3], zahlen[i * 3 + 1], zahlen[i * 3 + 2], 255], i * 4);
    gl.bindTexture(gl.TEXTURE_2D, tabelleT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  // n Schritte; w: { F, k, fkFoto: [Fd, kd, Fh, kh], art, spanne, radius, rand, richtung, winkel, pinsel: [x, y, r, art] }
  function schritte(n, w) {
    const o = schrittP.orte;
    gl.useProgram(schrittP.p);
    gl.viewport(0, 0, b, h);
    gl.uniform2f(o.gitter, b, h);
    gl.uniform2f(o.fk, w.F, w.k);
    gl.uniform4f(o.fkFoto, ...w.fkFoto);
    gl.uniform1f(o.art, w.art);
    gl.uniform1f(o.spanne, w.spanne);
    gl.uniform1f(o.radius, w.radius);
    gl.uniform1f(o.rand, w.rand);
    gl.uniform1f(o.richtung, w.richtung);
    gl.uniform1f(o.winkel, w.winkel);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fotoT);
    gl.uniform1i(o.foto, 1);
    gl.uniform1i(o.zustand, 0);
    for (let i = 0; i < n; i++) {
      // der Pinsel nur im ersten Schritt (sonst malt er n-mal an dieselbe Stelle, das ist gleich, kostet aber nichts)
      gl.uniform4f(o.pinsel, ...(i === 0 ? w.pinsel : [0, 0, 0, 0]));
      const von = zustaende[jetzt];
      const nach = zustaende[1 - jetzt];
      gl.bindFramebuffer(gl.FRAMEBUFFER, nach.fb);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, von.t);
      zeichneVoll(schrittP.p);
      jetzt = 1 - jetzt;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // a: { wert, kontrast, verschieben, relief, licht, umkehren, kante }
  function zeige(a) {
    const o = anzeigeP.orte;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(anzeigeP.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, zustaende[jetzt].t);
    gl.uniform1i(o.zustand, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tabelleT);
    gl.uniform1i(o.tabelle, 1);
    gl.uniform2f(o.gitter, b, h);
    for (const name of ["wert", "kontrast", "verschieben", "relief", "licht", "umkehren", "kante"]) gl.uniform1f(o[name], a[name]);
    zeichneVoll(anzeigeP.p);
  }

  // Zustand merken und zurück (Vorschau im Export-Fenster rechnet von hier aus)
  function merke() {
    const daten = new Float32Array(b * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, zustaende[jetzt].fb);
    gl.readPixels(0, 0, b, h, gl.RGBA, gl.FLOAT, daten);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return () => {
      gl.bindTexture(gl.TEXTURE_2D, zustaende[jetzt].t);
      if (TYP === gl.FLOAT) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, b, h, gl.RGBA, gl.FLOAT, daten);
      else gl.texImage2D(gl.TEXTURE_2D, 0, FORMAT, b, h, 0, gl.RGBA, gl.FLOAT, daten);
    };
  }

  return { groesse, saeen, setzeFoto, setzeTabelle, schritte, zeige, merke, genau: voll ? 32 : 16, groesseJetzt: () => [b, h] };
}
