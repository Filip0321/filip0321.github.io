import { gl, baueProgramm, VERTEX_SHADER, glCanvas } from "../webgl.js";

const CRT_SHADER = /* glsl */ `#version 300 es
precision highp float;
// für Genauigkeit bei Kommazahlen (gibt es bei shadern nicht standard)

in vec2 uv;
// vec2 kommt aus dem VERTEX_SHADER, vec4 geht aus dem FRAGMENT_SHADER
out vec4 farbe;

uniform sampler2D bild;
uniform vec2 aufloesung;
uniform float versatzX;
uniform float versatzY;
uniform float woelbung;
uniform float scanlines;
uniform float vignette;
uniform float rauschen;
uniform float zufall;
uniform float randWeg; // 1: so weit hineinzoomen, dass die schwarzen gewölbten Ränder verschwinden
// (neu) die Röhre genauer, Erklärung bei den Funktionen unten und im LIESMICH:
uniform float maske; // 0 aus, 1 Streifen (Trinitron), 2 Schlitzmaske, 3 Lochmaske (Delta)
uniform float maskeStaerke;
uniform float maskeGroesse; // Bildschirmpixel pro Farbpunkt
uniform float zeilensprung; // 1: Halbbilder, jede zweite Zeile ist noch vom letzten Bild
uniform float halbbild; // 0 oder 1: welches Halbbild gerade neu ist (wechselt jedes Bild)
uniform float nachleuchten; // wie viel vom letzten Bild noch glimmt
uniform float phosphorArt; // 0 alle Farben gleich, 1 P22: Rot glimmt länger als Grün, Blau am kürzesten
uniform float glanz; // Spiegelung auf dem Glas
uniform float randUnschaerfe; // zum Rand hin wird der Strahl breiter
uniform float vorherDa; // 1, sobald es ein letztes Bild gibt
uniform sampler2D vorher; // das letzte fertige Bild (crtNachher kopiert es)
// zufall hat die Videozeit, damit es sich immer ändert
// uniform bedeutet dass es für jeden Pixel gleich ist (uv für jeden Pixel unterschiedlich)

const float LINIEN = 300.0;

vec2 woelbe(vec2 p) {
  vec2 c = p * 2.0 - 1.0;
  // aus 0..1 wird -1..1
  vec2 gewoelbt = c;
  gewoelbt.x *= 1.0 + woelbung * c.y * c.y;
  gewoelbt.y *= 1.0 + woelbung * c.x * c.x;
  return gewoelbt * 0.5 + 0.5;
  // wieder auf 0..1
}

float zufallswert(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + zufall) * 43758.5453);
  // fract() gibt die nachkommezahl wieder
}

// (neu) Lochmaske: vor dem Leuchtstoff liegt ein Blech mit Löchern, jedes Loch lässt den Strahl nur auf einen
// roten, grünen oder blauen Punkt fallen. px: Bildschirmpixel. Gibt an, welche Farbe hier leuchten darf.
vec3 lochmaske(vec2 px) {
  vec2 z = px / max(1.0, maskeGroesse); // in Farbpunkten
  if (maske > 2.5) z.x += mod(floor(z.y), 2.0) * 1.5; // Delta: jede zweite Reihe um eine halbe Triade versetzt
  float spalte = mod(floor(z.x), 3.0);
  vec3 m = vec3(spalte == 0.0, spalte == 1.0, spalte == 2.0);
  if (maske > 1.5 && maske < 2.5) {
    // Schlitzmaske: senkrechte Schlitze, jede dritte Zeile Blech, in benachbarten Triaden versetzt
    float triade = floor(z.x / 3.0);
    m *= step(1.0, mod(z.y + mod(triade, 2.0) * 1.5, 3.0));
  }
  if (maske > 2.5) m *= step(0.3, fract(z.y)); // Delta: runde Löcher, genähert durch eine Lücke je Reihe
  return m;
}

// welcher Anteil mittig bleibt, damit die Ecken gerade noch im Bild liegen: s · (1 + w · s²) = 1,
// gelöst mit Newton (wie crtAnteil unten in JavaScript)
float anteil(float w) {
  float s = 1.0;
  for (int i = 0; i < 8; i++) s -= (w * s * s * s + s - 1.0) / (3.0 * w * s * s + 1.0);
  return s;
}

void main() {
  // Ränder wegzoomen: erst nur die Mitte nehmen (von −s bis s statt −1 bis 1), dann wölben. Die Ecke
  // landet so genau auf der Ecke des Bildes, schwarz bleibt nichts. Volle Auflösung, anders als das
  // Abschneiden im Export.
  vec2 q = randWeg > 0.5 && woelbung > 0.0 ? 0.5 + (uv - 0.5) * anteil(woelbung) : uv;
  vec2 p = woelbe(q);

  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
    farbe = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 schritt = vec2(versatzX / aufloesung.x, versatzY / aufloesung.y);
  // Pixel in uv umrechnen: x durch die Breite, y durch die Höhe
  vec3 f;
  f.r = texture(bild, p + schritt).r;
  f.g = texture(bild, p).g;
  f.b = texture(bild, p - schritt).b;
  // die Farben aus den Nachbarpixeln (um einen schritt entfernt)

  // (neu) Rand-Unschärfe: der Strahl trifft den Rand schräger und wird dort breiter. Vier Nachbarn dazu, je
  // weiter vom Mittelpunkt, desto weiter weg (dot(c, c): 0 in der Mitte, 2 in den Ecken)
  if (randUnschaerfe > 0.0) {
    vec2 c0 = p * 2.0 - 1.0;
    vec2 r = randUnschaerfe * dot(c0, c0) / aufloesung;
    vec3 summe = f;
    for (int i = 0; i < 4; i++) {
      vec2 d = r * (i == 0 ? vec2(1, 0) : i == 1 ? vec2(-1, 0) : i == 2 ? vec2(0, 1) : vec2(0, -1));
      summe += vec3(texture(bild, p + d + schritt).r, texture(bild, p + d).g, texture(bild, p + d - schritt).b);
    }
    f = summe / 5.0;
  }

  float zeile = 0.5 - 0.5 * cos(p.y * LINIEN * 6.2831853);
  f *= 1.0 - scanlines * zeile;

  vec2 c = p * 2.0 - 1.0;
  f *= clamp(1.0 - vignette * dot(c, c) * 0.5, 0.0, 1.0);

  f += (zufallswert(gl_FragCoord.xy) - 0.5) * rauschen;

  // (neu) Lochmaske: nur ein Drittel der Fläche leuchtet, darum heller (2,5), sonst würde das Bild dunkel
  if (maske > 0.5) f *= mix(vec3(1.0), lochmaske(gl_FragCoord.xy) * 2.5, maskeStaerke);

  // (neu) Glanz: das gewölbte Glas spiegelt ein Fenster oben links, weich, leicht bläulich
  if (glanz > 0.0) {
    vec2 g = (c - vec2(-0.45, 0.55)) * vec2(1.0, 1.6);
    f += glanz * (0.22 * exp(-dot(g, g) * 5.0) + 0.025) * vec3(0.9, 0.95, 1.0);
  }

  // (neu) mit dem letzten Bild: Halbbilder und Nachleuchten
  if (vorherDa > 0.5) {
    vec3 alt = texture(vorher, uv).rgb;
    // Zeilensprung: ein Fernseher zeichnet erst alle ungeraden Zeilen, dann alle geraden. Die anderen stehen
    // noch vom Bild davor, in Bewegung sieht man darum Kämme an den Kanten
    if (zeilensprung > 0.5 && mod(floor(p.y * LINIEN), 2.0) != halbbild) f = alt;
    // Nachleuchten: der Leuchtstoff glimmt nach; P22 (Farbfernseher): Rot am längsten, Blau am kürzesten
    vec3 abklingen = phosphorArt > 0.5 ? vec3(1.0, 0.72, 0.5) : vec3(1.0);
    f = max(f, alt * nachleuchten * abklingen);
  }

  farbe = vec4(f, 1.0);
}`;
// für jeden Pixel bestimmt es die Farbe

export const crtProgramm = gl ? baueProgramm(VERTEX_SHADER, CRT_SHADER) : null;

// (neu) Gedächtnis des CRT: das letzte fertige Bild (für Halbbilder und Nachleuchten) und welches Halbbild
// dran ist. Den CRT gibt es auf jeder Seite einmal, darum ein Gedächtnis hier statt pro Instanz.
const gedaechtnis = { vorher: null, gefuellt: false, halbbild: 0 };

// was rendere() für den CRT bekommt: die Regler (mit Startwerten für die, die es früher nicht gab), Zufall
// und das letzte Bild
const START = { maske: 0, maskeStaerke: 0, maskeGroesse: 2, zeilensprung: 0, nachleuchten: 0, phosphorArt: 0, glanz: 0, randUnschaerfe: 0 };
export function crtEinstellungen(werte, zeit) {
  if (gl && !gedaechtnis.vorher) {
    gedaechtnis.vorher = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gedaechtnis.vorher);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
  return { ...START, ...werte, zufall: zeit, halbbild: gedaechtnis.halbbild, vorherDa: gedaechtnis.gefuellt ? 1 : 0, vorher: gedaechtnis.vorher };
}

// nach dem Zeichnen: das Ergebnis als „vorher“ merken (wie Feedback), nächstes Halbbild
export function crtNachher() {
  if (!gl || !gedaechtnis.vorher) return;
  gl.bindTexture(gl.TEXTURE_2D, gedaechtnis.vorher);
  gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, glCanvas.width, glCanvas.height, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gedaechtnis.gefuellt = true;
  gedaechtnis.halbbild = 1 - gedaechtnis.halbbild;
}

// Vorlagen für bestimmte Geräte (setzen die Regler, danach darf man weiterdrehen). Angelehnt an echte Röhren:
// Trinitron hat Streifen und ist fast flach, PC-Monitore hatten feine Masken und kein Zeilensprung,
// Fernseher Lochmasken, Zeilensprung und deutliche Wölbung
const VORLAGEN = {
  "Fernseher, 80er": { woelbung: 0.12, scanlines: 0.35, vignette: 0.5, rauschen: 0.06, versatzX: 3, versatzY: 0, maske: 3, maskeStaerke: 0.45, maskeGroesse: 2, zeilensprung: 1, nachleuchten: 0.35, phosphorArt: 1, glanz: 0.4, randUnschaerfe: 1.5 },
  "Trinitron": { woelbung: 0.04, scanlines: 0.25, vignette: 0.25, rauschen: 0.02, versatzX: 1, versatzY: 0, maske: 1, maskeStaerke: 0.4, maskeGroesse: 1, zeilensprung: 1, nachleuchten: 0.2, phosphorArt: 1, glanz: 0.25, randUnschaerfe: 0.5 },
  "PC-Monitor, 90er": { woelbung: 0.06, scanlines: 0.15, vignette: 0.2, rauschen: 0.01, versatzX: 0, versatzY: 0, maske: 2, maskeStaerke: 0.3, maskeGroesse: 1, zeilensprung: 0, nachleuchten: 0.1, phosphorArt: 0, glanz: 0.2, randUnschaerfe: 0.3 },
  "Arcade": { woelbung: 0.1, scanlines: 0.6, vignette: 0.35, rauschen: 0.03, versatzX: 2, versatzY: 0, maske: 1, maskeStaerke: 0.5, maskeGroesse: 2, zeilensprung: 0, nachleuchten: 0.25, phosphorArt: 1, glanz: 0.15, randUnschaerfe: 1 },
  "Überwachungsmonitor": { woelbung: 0.15, scanlines: 0.4, vignette: 0.6, rauschen: 0.12, versatzX: 0, versatzY: 0, maske: 0, maskeStaerke: 0, maskeGroesse: 2, zeilensprung: 1, nachleuchten: 0.5, phosphorArt: 0, glanz: 0.5, randUnschaerfe: 2 },
};

// Regler für dieses Effekt-Programm (wie VHS_REGLER in vhs.js, gebaut von /lib/effekt-regler.js)
export const CRT_REGLER = [
  { gruppe: "Vorlage", vorlagen: VORLAGEN, regler: [] },
  {
    gruppe: "Einstellungen",
    regler: [
      { name: "versatzX", text: "Farbversatz X", min: -20, max: 20, schritt: 1, wert: 4 },
      { name: "versatzY", text: "Farbversatz Y", min: -20, max: 20, schritt: 1, wert: 0 },
      { name: "woelbung", text: "Wölbung", min: -0.8, max: 0.3, schritt: 0.01, wert: 0.08 },
      { name: "scanlines", text: "Scanlines", min: 0, max: 1, schritt: 0.05, wert: 0.3 },
      { name: "vignette", text: "Vignette", min: 0, max: 1, schritt: 0.05, wert: 0.4 },
      { name: "rauschen", text: "Rauschen", min: 0, max: 0.3, schritt: 0.01, wert: 0.05 },
      { name: "randWeg", text: "Gewölbte Ränder", auswahl: ["schwarz lassen", "wegzoomen"], wert: 0 },
    ],
  },
  {
    gruppe: "Röhre",
    regler: [
      { name: "maske", text: "Maske", auswahl: ["aus", "Streifen (Trinitron)", "Schlitzmaske", "Lochmaske"], wert: 0 },
      { name: "maskeStaerke", text: "Maske Stärke", min: 0, max: 1, schritt: 0.05, wert: 0 },
      { name: "maskeGroesse", text: "Maske Größe (px)", min: 1, max: 6, schritt: 1, wert: 2 },
      { name: "zeilensprung", text: "Zeilensprung", auswahl: ["aus", "Halbbilder"], wert: 0 },
      { name: "nachleuchten", text: "Nachleuchten", min: 0, max: 0.95, schritt: 0.05, wert: 0, ruhig: 0 },
      { name: "phosphorArt", text: "Leuchtstoff", auswahl: ["alle Farben gleich", "P22 (Rot glimmt länger)"], wert: 0 },
      { name: "glanz", text: "Glanz auf dem Glas", min: 0, max: 1, schritt: 0.05, wert: 0 },
      { name: "randUnschaerfe", text: "Rand-Unschärfe", min: 0, max: 4, schritt: 0.1, wert: 0 },
    ],
  },
];

// CRT gerade abschneiden (für den Export): welcher Anteil der Breite und Höhe bleibt, mittig,
// damit nichts von den schwarzen, gewölbten Rändern übrig ist? null, wenn es nichts abzuschneiden gibt.
// Die Wölbung in woelbe() (Mitte 0, Rand ±1): x' = x · (1 + w · y²), y' = y · (1 + w · x²).
// Schwarz wird es, wo x' oder y' über 1 kommt; am knappsten ist es an den Ecken (s, s):
// die Ecke liegt gerade noch im Bild, wenn s · (1 + w · s²) = 1. Das lösen wir mit Newton
// (s so lange verbessern, bis es passt). w ≤ 0 wölbt nach innen, dort gibt es keine schwarzen Ränder.
export function crtAnteil(w) {
  if (!(w > 0)) return null;
  let s = 1;
  for (let i = 0; i < 20; i++) s -= (w * s ** 3 + s - 1) / (3 * w * s * s + 1); // f / f'
  return s;
}

