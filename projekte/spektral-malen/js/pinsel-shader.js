// Pinsel: ein Tupfer auf eine Fläche (Malschicht oder Maske einer Ton-Ebene). Theorie im LIESMICH.
//
// Läuft für jede Stelle der Leinwand (Spalte × Fach) im Rechteck um den Tupfer einmal
// (gpu.js schneidet das Rechteck mit scissor zu, alles andere bleibt unangetastet).
// Er liest den alten Wert und schreibt den neuen: neu = f(alt, Abstand zum Pinsel).
//
// Gerechnet wird in Bildpunkten (CSS-Pixel), nicht in Spalten und Fächern: sonst wäre der Pinsel
// unten im Bild (wenige Fächer pro Oktave) riesig und oben winzig. So ist er überall rund.

export const PINSEL_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform highp sampler2D daten; // die Fläche vor dem Tupfer (R32F, Wert im Rotkanal)
uniform vec2 pinsel;           // Mitte des Tupfers in Bildpunkten, y = 0 unten
uniform float radius;          // Radius in Bildpunkten
uniform float staerke;         // 0 bis 1: wie viel ein Tupfer auf einmal ändert
uniform float haerte;          // 0 = Rand ganz weich, 1 = harter Rand
uniform float helligkeit;      // wie hell (laut) der Pinsel malt, 0 bis 1
uniform bool radieren;         // false = malen, true = radieren (leiser bis ganz weg)

uniform float pxProSpalte;     // so breit ist eine Spalte im Bild (meist weniger als 1 Pixel)
uniform float bildHoehe;       // Höhe des Bildes in Bildpunkten
uniform float tief;            // unterste Frequenz im Bild (Hz)
uniform float hoch;            // oberste
uniform float fachBreite;      // Hz zwischen zwei Fächern
uniform float faecher;         // Anzahl der Fächer

out float neu; // der neue Wert dieser Stelle

// Höhe einer Frequenz im Bild, in Bildpunkten von unten (wie frequenzZuAnteil in leinwand.js)
float frequenzZuY(float f) {
  return log(f / tief) / log(hoch / tief) * bildHoehe;
}

// Eine Spalte ist im Bild ein schmaler Streifen: von x = links bis x = rechts
vec2 spalteBereich(float spalte) {
  return vec2(spalte, spalte + 1.0) * pxProSpalte;
}

// Ein Fach ist im Bild ein waagerechtes Band: von der Frequenz ein halbes Fach unter seiner Mitte
// bis ein halbes Fach darüber (so zeigt es auch der Anzeige-Shader). Rückgabe: (unten, oben)
vec2 fachBand(float fach) {
  return vec2(frequenzZuY((fach - 0.5) * fachBreite), frequenzZuY((fach + 0.5) * fachBreite));
}

void main() {
  // gl_FragCoord liegt in der Mitte des Texels (z. B. 12.5), floor macht daraus Spalte und Fach
  float spalte = floor(gl_FragCoord.x);
  float fach = floor(gl_FragCoord.y);
  float alt = texelFetch(daten, ivec2(spalte, fach), 0).r;
  neu = alt; // ohne Änderung bleibt alles, wie es war

  // Fach 0 (0 Hz) und das letzte (halbe Abtastrate) klingen nicht richtig, und was außerhalb
  // des Bildes liegt, hört man, sieht es aber nicht: dort nie malen
  float f = fach * fachBreite;
  if (fach < 1.0 || fach > faecher - 2.0 || f < tief || f > hoch) return;

  // ---------------- ab hier schreibst du ----------------
  // 1. Abstand dieser Stelle zum Pinsel in Bildpunkten, waagerecht (dx) und senkrecht (dy).
  //    Achtung: Spalte und Fach sind Streifen, keine Punkte (spalteBereich, fachBand).
  //    Liegt der Pinsel im Streifen, ist der Abstand 0.
  vec2 sb = spalteBereich(spalte); // (links, rechts) in Bildpunkten
  vec2 band = fachBand(fach);      // (unten, oben) in Bildpunkten
  // Pinsel links vom Streifen: sb.x - pinsel.x ist positiv. Rechts davon: pinsel.x - sb.y.
  // Liegt er im Streifen, sind beide negativ, und max(0, …) macht daraus 0
  float dx = max(0.0, max(sb.x - pinsel.x, pinsel.x - sb.y));
  float dy = max(0.0, max(band.x - pinsel.y, pinsel.y - band.y));

  // 2. Abstand durch den Radius teilen: 0 in der Mitte, 1 am Rand.
  float d = length(vec2(dx, dy)) / radius;

  // 3. Wirkung von 1 (Mitte) bis 0 (Rand und weiter draußen), weich nach haerte (smoothstep),
  //    mal staerke.
  //    smoothstep(a, b, d) ist 0 bis a, 1 ab b und dazwischen weich. Es verlangt a < b,
  //    darum ist haerte hier höchstens 0.999
  float wirkung = staerke * (1.0 - smoothstep(min(haerte, 0.999), 1.0, d));

  // 4. malen: in Richtung helligkeit, aber nie leiser machen als vorher.
  //    radieren: leiser, bei voller Wirkung bis 0.
  if (radieren) neu = alt * (1.0 - wirkung);
  else neu = max(alt, mix(alt, helligkeit, wirkung));
}`;
