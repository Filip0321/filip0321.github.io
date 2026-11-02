// Die Shader von „Tiefe aus Fotos“. Theorie im LIESMICH.
//
// Alle Texturen liegen „wie im Canvas“: Zeile 0 ist die oberste (ohne UNPACK_FLIP_Y hochgeladen).
// Rechnen in eigenen Texturen geht damit Zeile für Zeile wie auf der CPU; nur beim Zeigen auf dem
// Bildschirm (gl_FragCoord.y wächst nach oben) wird einmal gespiegelt.

export const VOLLBILD = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------- Block Matching ----------
// Für jeden Pixel des Referenzbildes: alle Disparitäten d von dMin bis dMax ausprobieren und die nehmen,
// bei der das Fenster um den Pixel dem Fenster im anderen Bild am ähnlichsten ist.
//   Kosten = Summe über das Fenster von min(|Referenz − Anderes|, abschneiden)
//   „abschneiden“: ein einzelner sehr falscher Pixel (Spiegelung, Verdeckung) soll nicht alles bestimmen.
// Die Bilder kommen schon als „Helligkeit minus Umgebungsmittel“ (stereo.js): verschieden helle Fotos
// stören dann nicht.
// Mit drittem Bild (Multi-Baseline, Okutomi und Kanade 1993): Referenz ist das mittlere Foto, das rechte
// wird bei x − d gelesen, das linke bei x + d, und die Kosten beider Paare werden addiert. Ein Muster,
// das sich wiederholt (Zaun, Fliesen), passt in einem Paar bei mehreren d, in beiden zusammen fast nur
// beim richtigen.
// Ausgabe: r = beste Disparität (mit Kommastelle), g = beste Kosten, b = zweitbeste Kosten (Eindeutigkeit)
export const MATCH = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D referenz;
uniform sampler2D anderes;   // bei x − d·richtung
uniform sampler2D drittes;   // bei x + d (nur mit drei Fotos)
uniform int richtung;        // 1: Referenz ist links (oder Mitte), −1: Referenz ist rechts (für die Prüfung)
uniform int mitDrittem;
uniform int dMin;
uniform int dMax;
uniform int radius;          // Fenster (2r+1)², höchstens r = 6
uniform float abschneiden;
uniform int besseresPaar;    // drei Fotos: 1 = nur das besser passende Paar zählt (gegen Verdeckungen)
out vec4 farbe;

ivec2 grenze;

float kosten(ivec2 p, int d) {
  float s = 0.0;  // Kosten mit dem anderen Foto
  float s3 = 0.0; // mit dem dritten
  for (int j = -6; j <= 6; j++) {
    if (j < -radius || j > radius) continue;
    for (int i = -6; i <= 6; i++) {
      if (i < -radius || i > radius) continue;
      ivec2 q = clamp(p + ivec2(i, j), ivec2(0), grenze);
      float r = texelFetch(referenz, q, 0).r;
      ivec2 qa = clamp(q - ivec2(d * richtung, 0), ivec2(0), grenze);
      s += min(abs(r - texelFetch(anderes, qa, 0).r), abschneiden);
      if (mitDrittem == 1) {
        ivec2 qb = clamp(q + ivec2(d, 0), ivec2(0), grenze);
        s3 += min(abs(r - texelFetch(drittes, qb, 0).r), abschneiden);
      }
    }
  }
  if (mitDrittem == 0) return s;
  // Ein Punkt neben einer Kante ist oft nur in EINEM der beiden äußeren Fotos zu sehen. Addiert man
  // beide Paare, verdirbt das verdeckte Paar die Summe; nimmt man das bessere, stört es nicht.
  return besseresPaar == 1 ? 2.0 * min(s, s3) : s + s3;
}

void main() {
  grenze = textureSize(referenz, 0) - 1;
  ivec2 p = ivec2(gl_FragCoord.xy);
  float beste = 1e9;
  float zweit = 1e9;
  int bd = dMin;
  for (int k = 0; k < 1024; k++) {
    int d = dMin + k;
    if (d > dMax) break;
    float c = kosten(p, d);
    if (c < beste) {
      if (abs(d - bd) > 1) zweit = beste; // der alte Beste wird Zweiter, wenn er nicht direkt daneben liegt
      beste = c;
      bd = d;
    } else if (c < zweit && abs(d - bd) > 1) {
      zweit = c;
    }
  }
  // Kommastelle: durch die Kosten links und rechts vom Besten eine Parabel legen, ihr Tiefpunkt
  float komma = 0.0;
  if (bd > dMin && bd < dMax) {
    float links = kosten(p, bd - 1);
    float rechts = kosten(p, bd + 1);
    float n = links - 2.0 * beste + rechts;
    if (n > 0.0) komma = clamp(0.5 * (links - rechts) / n, -0.5, 0.5);
  }
  farbe = vec4(float(bd) + komma, beste, zweit, 1.0);
}`;

// ---------- Ansichten (auf den Bildschirm) ----------
// tiefe: die fertige Disparität, schon auf 0 (fern) bis 1 (nah) gebracht, als R16F (lässt sich filtern)
export const ANSICHT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D links;    // Farbbild links (Referenz)
uniform sampler2D rechts;   // rechtes Foto, schon ausgerichtet
uniform sampler2D tiefe;
uniform sampler2D verlauf;  // Farbskala 256 × 1 (farben.js)
uniform sampler2D extra;    // fertiges Bild (Autostereogramm)
uniform int modus;          // 0 Anaglyph, 1 Tiefenkarte, 2 Schärfentiefe, 3 Nebel, 4 Farbe nach Tiefe, 5 extra
uniform float fokus, staerke, mischung;
uniform vec3 nebelFarbe;
uniform vec2 aufloesung;
out vec4 farbe;

float hell(vec3 f) { return dot(f, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 uv = vec2(gl_FragCoord.x / aufloesung.x, 1.0 - gl_FragCoord.y / aufloesung.y); // Zeile 0 oben
  vec3 f = texture(links, uv).rgb;
  float t = texture(tiefe, uv).r;
  if (modus == 0) {
    // rot aus dem linken Auge, grün und blau aus dem rechten: mit Rot-Cyan-Brille räumlich,
    // ohne Brille sieht man farbige Säume, wo die Fotos noch nicht deckungsgleich sind
    farbe = vec4(hell(f), hell(texture(rechts, uv).rgb), hell(texture(rechts, uv).rgb), 1.0);
  } else if (modus == 1) {
    farbe = vec4(mischung > 0.5 ? texture(verlauf, vec2(t, 0.5)).rgb : vec3(t), 1.0);
  } else if (modus == 2) {
    // Schärfentiefe: jeder Pixel wird so unscharf, wie weit er von der Fokustiefe weg ist.
    // Gesammelt wird in einer Spirale; eine Stichprobe zählt nur, wenn SIE selbst unscharf genug ist,
    // um bis hierher zu reichen. Sonst würde ein scharfer Vordergrund in den Hintergrund ausbluten.
    float rMax = staerke * aufloesung.y * 0.03;
    float r = abs(t - fokus) * rMax;
    vec3 summe = vec3(0.0);
    float gewicht = 0.0;
    for (int i = 0; i < 64; i++) {
      float w = float(i) * 2.39996;
      float a = sqrt((float(i) + 0.5) / 64.0);
      vec2 o = vec2(cos(w), sin(w)) * a * r;
      vec2 q = uv + o / aufloesung;
      float rq = abs(texture(tiefe, q).r - fokus) * rMax;
      float g = smoothstep(length(o) - 1.0, length(o) + 1.0, rq + 0.5) + (i == 0 ? 1.0 : 0.0);
      summe += texture(links, q).rgb * g;
      gewicht += g;
    }
    farbe = vec4(summe / max(gewicht, 1e-4), 1.0);
  } else if (modus == 3) {
    float n = 1.0 - exp(-(1.0 - t) * staerke * 3.0);
    farbe = vec4(mix(f, nebelFarbe, n), 1.0);
  } else if (modus == 4) {
    vec3 v = texture(verlauf, vec2(t, 0.5)).rgb;
    farbe = vec4(mix(f, v * (0.4 + hell(f) * 1.2), mischung), 1.0);
  } else {
    farbe = vec4(texture(extra, uv).rgb, 1.0);
  }
}`;

// ---------- Punktwolke ----------
// Kein Puffer mit Punkten: jeder Punkt holt sich aus seiner Nummer (gl_VertexID) seinen Pixel, daraus
// die Tiefe und die Farbe. Aus Pixel und Tiefe wird ein Punkt im Raum, wie bei einer Lochkamera:
//   Z = 1 / Disparität (bis auf einen Faktor, der von Brennweite und Abstand der Fotos abhängt)
//   X = (x − Mitte) / f · Z,  Y = (y − Mitte) / f · Z
// „Relief“ nimmt stattdessen die Disparität direkt als Höhe: weniger echt, aber ruhiger.
export const WOLKE_VERTEX = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D links;
uniform sampler2D tiefe;
uniform mat4 vp;
uniform int schritt;        // nur jeder k-te Pixel
uniform float brennweite;   // in Bildhöhen (f in Pixeln / Höhe in Pixeln; Kleinbild: f in mm / 24)
uniform float relief;       // 0 = Perspektive, 1 = Relief
uniform float tiefenFaktor; // wie stark die Tiefe zählt
uniform float groesse;
uniform float bildschirmHoehe;
out vec3 punktFarbe;
void main() {
  ivec2 g = textureSize(tiefe, 0);
  int spalten = (g.x + schritt - 1) / schritt;
  ivec2 p = ivec2(gl_VertexID % spalten, gl_VertexID / spalten) * schritt;
  float t = texelFetch(tiefe, p, 0).r;
  punktFarbe = texelFetch(links, p, 0).rgb;
  if (t < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // ungültig: aus dem Bild
  float seite = float(g.x) / float(g.y);
  vec2 q = (vec2(p) + 0.5) / vec2(g) - 0.5; // −0,5 bis 0,5
  q.y = -q.y;                               // Zeile 0 oben, im Raum ist oben +y
  vec3 pos;
  if (relief > 0.5) {
    pos = vec3(q.x * seite, q.y, (t - 0.5) * tiefenFaktor);
  } else {
    // Z ~ 1 / Disparität; t = 0,5 liegt bei Z = 1 (dort ist die Mitte der Drehung)
    float z = 1.0 / mix(1.0, 0.25 + 1.5 * t, tiefenFaktor);
    pos = vec3(q.x * seite / brennweite * z, q.y / brennweite * z, 1.0 - z);
  }
  gl_Position = vp * vec4(pos, 1.0);
  gl_PointSize = max(1.0, groesse * float(schritt) * bildschirmHoehe / float(g.y) / gl_Position.w);
}`;

export const WOLKE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 punktFarbe;
out vec4 farbe;
void main() {
  farbe = vec4(punktFarbe, 1.0);
}`;
