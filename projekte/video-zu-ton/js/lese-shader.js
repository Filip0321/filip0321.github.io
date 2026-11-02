// Lese-Shader: liest einen Strich im (vorbearbeiteten) Bild und macht daraus eine Helligkeit pro Zeile.
// Theorie im LIESMICH (Teil 3).
//
// Er läuft nicht auf dem Bildschirm, sondern auf einer Fläche, die "zeilen" breit und so hoch ist,
// wie es Striche gibt (gpu.js, lies). Pro Strich ein Durchgang auf seiner eigenen Zeile der Fläche:
//   gl_FragCoord.x = 0.5, 1.5, 2.5, …  -> Zeile 0, 1, 2, …  (Zeile 0 = tiefster Ton)
// Was in "farbe" steht, liest gpu.js danach zurück (nur den Rotkanal, 0 bis 1).
//
// Ein Strich ist ein schmales Rechteck: quer von mitte - breite/2 bis mitte + breite/2,
// längs (senkrecht: von unten nach oben, waagerecht: von links nach rechts) in "zeilen" Stücke geteilt.
// Wo die Stücke liegen, steht in "grenzen" (gleich groß oder dort dichter, wo im Bild viel passiert,
// frequenzen.js). Jede Zeile bekommt den Mittelwert ihres Stücks, nicht nur einen Punkt.
// Alle Lagen sind Anteile des Bereichs (ganzes Bild oder Lupe), erst am Ende wird daraus uv im Video.

export const LESE_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D bild;           // das vorbearbeitete Bild, uv 0 bis 1, y = 0 unten
uniform highp sampler2D grenzen;  // pro Strich (y) und Zeile (x): (unten, oben) längs des Strichs, 0 bis 1
uniform int strich;               // welcher Strich (Zeile in grenzen)
uniform float mitte;              // Mitte quer zum Strich (Anteil des Bereichs)
uniform float breite;             // Breite quer zum Strich (Anteil des Bereichs)
uniform bool senkrecht;           // false = waagerecht
uniform bool rueckwaerts;         // tief und hoch vertauscht (oben bzw. rechts ist tief)
uniform vec4 bereich;             // was der Strich überblickt, in uv: (links, unten, rechts, oben)
uniform vec4 fenster;             // nur was hier drin liegt, klingt (uv, wie bereich)
uniform int probenQuer;           // so viele Proben quer (gpu.js: etwa eine pro Pixel, höchstens 32)
uniform int probenLaengs;         // so viele längs in einer Zeile

out vec4 farbe;

void main() {
  int zeile = int(gl_FragCoord.x);
  float hell = 0.0;

  // 1. Das Stück dieser Zeile: längs von g.x bis g.y, quer von links bis links + breite.
  //    Rückwärts gelesen liegt Zeile 0 am anderen Ende: einfach 1 - … (unten und oben tauschen dabei).
  vec2 g = texelFetch(grenzen, ivec2(zeile, strich), 0).rg;
  if (rueckwaerts) g = vec2(1.0 - g.y, 1.0 - g.x);
  float links = mitte - breite / 2.0;

  // 2. Proben gleichmäßig verteilt, jede in der Mitte ihres Teilstücks ((i + 0.5) / n, nicht i / n:
  //    sonst sitzt die erste genau auf dem Rand und gehört halb zum Nachbarn, wie bei gl_FragCoord)
  for (int i = 0; i < probenQuer; i++) {
    float quer = links + (float(i) + 0.5) / float(probenQuer) * breite;
    for (int j = 0; j < probenLaengs; j++) {
      float laengs = g.x + (float(j) + 0.5) / float(probenLaengs) * (g.y - g.x);
      vec2 lokal = senkrecht ? vec2(quer, laengs) : vec2(laengs, quer);
      vec2 uv = mix(bereich.xy, bereich.zw, lokal); // Anteil des Bereichs -> uv im Video
      // außerhalb des Fensters: zählt mit, aber als Schwarz (so wird ein halb verdecktes Stück halb so laut)
      bool drin = all(greaterThanEqual(uv, fenster.xy)) && all(lessThanEqual(uv, fenster.zw));
      if (drin) hell += texture(bild, uv).r; // die Vorbearbeitung hat schon Helligkeit daraus gemacht
    }
  }

  // 3. Mittelwert (GLSL wandelt int nicht von selbst in float)
  hell /= float(probenQuer * probenLaengs);
  farbe = vec4(hell, 0.0, 0.0, 1.0);
}`;
