// Pixel und Druck: Rasterdruck, Bayer-Dithering, Paletten, ASCII, Posterize, Risodruck.
// (Pixel Sorting, Atkinson und Blue Noise rechnen auf der CPU, sie stehen in linien.js)

import { gl } from "../webgl.js";
import { farbTextur, hex } from "./hilfen.js";

const GRUPPE = "Pixel und Druck";

// ---------- Rasterdruck ----------
// Eine Druckmaschine kann nur „Farbe oder keine“. Grautöne entstehen aus Punkten verschiedener Größe
// in einem festen Raster: dunkel = große Punkte. Bei Farbe vier Raster (Cyan, Magenta, Gelb, Schwarz),
// jedes in einem anderen Winkel, sonst entstehen Moiré-Muster. Die Winkel 15°, 75°, 0°, 45° sind die
// klassischen: Gelb (am wenigsten sichtbar) bekommt den Winkel, der am ehesten stört.
const RASTER = {
  id: "raster",
  name: "Rasterdruck",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float zelle, winkel, farbig, papier;
// Anteil der Zelle, den ein Punkt mit Deckung d (0 bis 1) im Raster mit diesem Winkel bedeckt
float punkt(vec2 px, float w, out vec2 mitte) {
  mat2 dreh = mat2(cos(w), -sin(w), sin(w), cos(w));
  vec2 q = dreh * px / zelle;           // in Rasterkoordinaten
  vec2 z = floor(q) + 0.5;              // Mitte der Zelle
  mitte = transpose(dreh) * z * zelle;  // zurück in Pixel
  return length(q - z);                 // Abstand zur Mitte, in Zellen
}
float deckung(float d, float abstand) {
  float r = sqrt(clamp(d, 0.0, 1.0)) * 0.7071; // Fläche ~ r², ganz voll bei der halben Diagonale
  float kante = 1.0 / zelle;                    // eine Pixelbreite weich, gegen Treppen
  return smoothstep(r + kante, r - kante, abstand);
}
void main() {
  vec2 px = uv * aufloesung;
  float w0 = radians(winkel);
  vec3 papierFarbe = mix(vec3(1.0), vec3(0.96, 0.93, 0.86), papier);
  if (farbig < 0.5) {
    vec2 m;
    float a = punkt(px, w0 + radians(45.0), m);
    float d = 1.0 - hell(texture(bild, m / aufloesung).rgb);
    farbe = vec4(papierFarbe * (1.0 - deckung(d, a)), 1.0);
    return;
  }
  vec3 tinte = papierFarbe;
  float winkelCMYK[4] = float[4](15.0, 75.0, 0.0, 45.0);
  for (int k = 0; k < 4; k++) {
    vec2 m;
    float a = punkt(px, w0 + radians(winkelCMYK[k]), m);
    vec3 c = texture(bild, m / aufloesung).rgb;
    float schwarz = 1.0 - max(c.r, max(c.g, c.b));
    vec3 cmy = (1.0 - c - schwarz) / max(1.0 - schwarz, 0.001);
    float d = k < 3 ? cmy[k] : schwarz;
    float bedeckt = deckung(d, a);
    // jede Tinte nimmt dem Papier eine Farbe weg (subtraktiv): Cyan schluckt Rot usw.
    vec3 schluckt = k == 0 ? vec3(0.0, 0.65, 0.95) : k == 1 ? vec3(0.92, 0.0, 0.55) : k == 2 ? vec3(1.0, 0.92, 0.0) : vec3(0.1);
    tinte *= mix(vec3(1.0), schluckt, bedeckt);
  }
  farbe = vec4(tinte, 1.0);
}`,
  regler: [
    {
      gruppe: "Raster",
      regler: [
        { name: "zelle", text: "Rasterweite (px)", min: 3, max: 40, schritt: 1, wert: 8 },
        { name: "winkel", text: "Winkel", min: 0, max: 90, schritt: 1, wert: 0 },
        { name: "farbig", text: "Farbe", auswahl: ["schwarz", "CMYK"], wert: 1 },
        { name: "papier", text: "Papierton", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
      ],
    },
  ],
};

// ---------- Bayer-Dithering ----------
// Statt Fehler weiterzureichen (Floyd-Steinberg, unter „Dithering“ oben) bekommt jeder Pixel eine eigene
// Schwelle aus einer festen 8 × 8-Matrix. Die Matrix ist so gebaut, dass nah beieinander liegende
// Schwellen weit auseinander stehen: jede Graustufe wird zu einem gleichmäßigen Muster. Typisch für
// alte Spiele und Drucker, und anders als Floyd-Steinberg flackert es im Video nicht (jeder Pixel für sich).
const BAYER = {
  id: "bayer",
  name: "Bayer-Dithering",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float stufen, groesse, grau;
void main() {
  vec2 px = floor(uv * aufloesung / groesse);
  vec3 f = texture(bild, (px + 0.5) * groesse / aufloesung).rgb;
  if (grau > 0.5) f = vec3(hell(f));
  float s = max(stufen - 1.0, 1.0);
  float schwelle = bayer8(px) - 0.5;
  f = floor(f * s + schwelle + 0.5) / s;
  farbe = vec4(clamp(f, 0.0, 1.0), texture(bild, uv).a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "stufen", text: "Stufen", min: 2, max: 8, schritt: 1, wert: 2 },
        { name: "groesse", text: "Pixelgröße", min: 1, max: 8, schritt: 1, wert: 2 },
        { name: "grau", text: "Farbe", auswahl: ["bunt", "grau"], wert: 1 },
      ],
    },
  ],
};

// ---------- Paletten ----------
// Alte Geräte hatten nur wenige Farben. Jeder Pixel nimmt die nächste Farbe der Palette (kleinster
// Abstand im RGB-Würfel, Grün etwas stärker gewichtet, weil das Auge dort feiner unterscheidet).
// Mit Dithering wird vorher ein Bayer-Muster addiert, dann mischen sich die Farben optisch.
const PALETTEN = [
  ["Game Boy", ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]],
  ["CGA", ["#000000", "#55ffff", "#ff55ff", "#ffffff"]],
  ["PICO-8", ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"]],
  ["Teletext", ["#000000", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"]],
  ["Macintosh (1 Bit)", ["#000000", "#ffffff"]],
  ["Sepia", ["#2b1d0e", "#6b4a2b", "#b08d57", "#efe0c0"]],
];
const palettenTexturen = [];

const PALETTE = {
  id: "palette",
  name: "Palette",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform sampler2D farben;
uniform float anzahl, dither, groesse;
void main() {
  vec2 px = floor(uv * aufloesung / groesse);
  vec3 f = texture(bild, (px + 0.5) * groesse / aufloesung).rgb;
  f += (bayer8(px) - 0.5) * dither * 0.35;
  vec3 beste = vec3(0.0);
  float abstand = 1e9;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= anzahl) break;
    vec3 p = texture(farben, vec2((float(i) + 0.5) / anzahl, 0.5)).rgb;
    vec3 d = (f - p) * vec3(0.30, 0.59, 0.11);
    float a = dot(d, d);
    if (a < abstand) { abstand = a; beste = p; }
  }
  farbe = vec4(beste, texture(bild, uv).a);
}`,
  einstellungen(w) {
    const n = Math.round(w.palette);
    palettenTexturen[n] ??= farbTextur(PALETTEN[n][1].map(hex));
    return { farben: palettenTexturen[n], anzahl: PALETTEN[n][1].length, dither: w.dither, groesse: w.groesse };
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "palette", text: "Palette", auswahl: PALETTEN.map(([n]) => n), wert: 0 },
        { name: "dither", text: "Dithering", min: 0, max: 1, schritt: 0.01, wert: 0.6 },
        { name: "groesse", text: "Pixelgröße", min: 1, max: 12, schritt: 1, wert: 3 },
      ],
    },
  ],
};

// ---------- ASCII ----------
// Das Bild in Zellen; jede Zelle bekommt ein Zeichen, dessen Tinte so viel Fläche bedeckt, wie die Zelle
// dunkel (oder hell) ist. Die Zeichen liegen in einer Textur (einmal mit Canvas gezeichnet), der Shader
// sucht sich das richtige aus und liest darin an der Stelle des Pixels innerhalb der Zelle.
const ZEICHENSAETZE = [" .:-=+*#%@", " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$", " ░▒▓█"];
const ZEICHEN_PLATZ = 32; // Pixel pro Zeichen in der Textur
const zeichenTexturen = [];

function zeichenTextur(satz) {
  const zeichen = [...satz];
  const c = document.createElement("canvas");
  c.width = zeichen.length * ZEICHEN_PLATZ;
  c.height = ZEICHEN_PLATZ;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff";
  ctx.font = `${ZEICHEN_PLATZ * 0.9}px "Courier New", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  zeichen.forEach((z, i) => ctx.fillText(z, (i + 0.5) * ZEICHEN_PLATZ, ZEICHEN_PLATZ / 2));
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // wie das Bild: v = 0 unten
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { textur: t, anzahl: zeichen.length };
}

const ASCII = {
  id: "ascii",
  name: "ASCII",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform sampler2D zeichen;
uniform float anzahl, zelle, modus, umkehren;
void main() {
  vec2 px = uv * aufloesung;
  vec2 z = floor(px / vec2(zelle * 0.6, zelle)); // Zeichen sind schmaler als hoch
  vec2 groesse = vec2(zelle * 0.6, zelle);
  vec3 f = texture(bild, (z + 0.5) * groesse / aufloesung).rgb;
  float h = hell(f);
  if (umkehren > 0.5) h = 1.0 - h;
  float n = min(floor(h * anzahl), anzahl - 1.0);
  vec2 innen = fract(px / groesse);
  innen.x = 0.2 + innen.x * 0.6; // nur die Mitte des Zeichenplatzes, dort ist das Zeichen
  float tinte = texture(zeichen, vec2((n + innen.x) / anzahl, innen.y)).r;
  vec3 aus = modus < 0.5 ? vec3(tinte) : modus < 1.5 ? f * tinte : mix(vec3(0.96, 0.94, 0.88), vec3(0.1), tinte);
  farbe = vec4(aus, 1.0);
}`,
  einstellungen(w) {
    if (!gl) return {};
    const n = Math.round(w.satz);
    zeichenTexturen[n] ??= zeichenTextur(ZEICHENSAETZE[n]);
    return { zeichen: zeichenTexturen[n].textur, anzahl: zeichenTexturen[n].anzahl, zelle: w.zelle, modus: w.modus, umkehren: w.modus > 1.5 ? 1 - w.umkehren : w.umkehren };
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "zelle", text: "Zeichengröße (px)", min: 6, max: 48, schritt: 1, wert: 12 },
        { name: "satz", text: "Zeichen", auswahl: ["kurz", "lang", "Blöcke"], wert: 0 },
        { name: "modus", text: "Farbe", auswahl: ["weiß auf schwarz", "farbig", "schwarz auf Papier"], wert: 0 },
        { name: "umkehren", text: "Umkehren", auswahl: ["nein", "ja"], wert: 0 },
      ],
    },
  ],
};

// ---------- Posterize ----------
// Jeder Farbkanal nur noch in wenigen Stufen. Mit Gamma vorher, damit die Stufen in den Schatten nicht
// alle zu Schwarz verschmelzen (das Auge sieht Helligkeit nicht linear).
const POSTERIZE = {
  id: "posterize",
  name: "Posterize",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float stufen, gamma;
void main() {
  vec4 o = texture(bild, uv);
  vec3 f = pow(o.rgb, vec3(1.0 / gamma));
  f = floor(f * stufen) / max(stufen - 1.0, 1.0);
  farbe = vec4(pow(clamp(f, 0.0, 1.0), vec3(gamma)), o.a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "stufen", text: "Stufen", min: 2, max: 16, schritt: 1, wert: 4 },
        { name: "gamma", text: "Gamma", min: 0.4, max: 2.5, schritt: 0.05, wert: 1 },
      ],
    },
  ],
};

// ---------- Risodruck ----------
// Ein Risograph druckt eine Farbe nach der anderen, mit echten, leuchtenden Farben (keine CMYK-Mischung)
// und nie ganz deckungsgleich. Aus dem Bild zwei Auszüge machen: Wie viel von Tinte A und von Tinte B
// braucht es, um diese Farbe zu treffen? Gerechnet in „Dichte“ (−log der Helligkeit), weil Tinten sich
// dort addieren: zwei Schichten übereinander schlucken das Produkt ihres Lichts. Das sind zwei Gleichungen
// mit zwei Unbekannten pro Pixel (kleinste Quadrate über R, G, B), danach jede Tinte als Raster gedruckt
// und Tinte B um ein paar Pixel verschoben.
const TINTEN = [
  ["Pink und Blau", "#ff48b0", "#0078bf"],
  ["Rot und Schwarz", "#ff665e", "#000000"],
  ["Gelb und Grün", "#ffe800", "#00a95c"],
  ["Orange und Violett", "#ff6c2f", "#765ba7"],
];

const RISO = {
  id: "riso",
  name: "Risodruck",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float ar, ag, ab, br, bg, bb, versatz, zelle, korn;
vec3 dichte(vec3 c) { return -log(max(c, vec3(0.02))); }
// Tinte als Bayer-Raster drucken: Anteil d an dieser Stelle
float druck(float d, vec2 px) { return step(bayer8(floor(px / zelle)), d); }
void main() {
  vec2 px = uv * aufloesung;
  vec3 papier = vec3(0.97, 0.95, 0.9);
  vec3 tA = vec3(ar, ag, ab), tB = vec3(br, bg, bb);
  vec3 dA = dichte(tA), dB = dichte(tB);
  // Normalgleichungen für dichte(Bild) ≈ a·dA + b·dB
  float aa = dot(dA, dA), ab_ = dot(dA, dB), bb_ = dot(dB, dB);
  float det = aa * bb_ - ab_ * ab_;
  vec3 dBild = dichte(texture(bild, uv).rgb / papier);
  vec3 dBild2 = dichte(texture(bild, uv - vec2(versatz) / aufloesung).rgb / papier);
  float a = clamp((bb_ * dot(dBild, dA) - ab_ * dot(dBild, dB)) / det, 0.0, 1.0);
  float b = clamp((aa * dot(dBild2, dB) - ab_ * dot(dBild2, dA)) / det, 0.0, 1.0);
  float k = (zufall(floor(px)) - 0.5) * korn;
  float druckA = druck(a + k, px);
  float druckB = druck(b + k, px + vec2(versatz) + 3.0);
  vec3 f = papier * mix(vec3(1.0), tA, druckA * 0.95) * mix(vec3(1.0), tB, druckB * 0.95);
  farbe = vec4(f, 1.0);
}`,
  einstellungen(w) {
    const [, a, b] = TINTEN[Math.round(w.tinten)];
    const [ar, ag, ab] = hex(a).map((x) => x / 255);
    const [br, bg, bb] = hex(b).map((x) => x / 255);
    return { ar, ag, ab, br, bg, bb, versatz: w.versatz, zelle: w.zelle, korn: w.korn };
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "tinten", text: "Tinten", auswahl: TINTEN.map(([n]) => n), wert: 0 },
        { name: "versatz", text: "Versatz (px)", min: 0, max: 20, schritt: 0.5, wert: 4 },
        { name: "zelle", text: "Rastergröße", min: 1, max: 6, schritt: 1, wert: 2 },
        { name: "korn", text: "Korn", min: 0, max: 0.6, schritt: 0.01, wert: 0.15 },
      ],
    },
  ],
};

export const DRUCK = [RASTER, BAYER, PALETTE, ASCII, POSTERIZE, RISO];
