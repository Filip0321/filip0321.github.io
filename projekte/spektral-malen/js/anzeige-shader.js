// Anzeige: die Mischung aller Ebenen (Spalten × Fächer) aufs Bild, mit logarithmischer Höhe und Farbskala.
// Läuft für jeden Bildpunkt einmal (Fragment-Shader), bei jedem Neuzeichnen.

export const ANZEIGE_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform highp sampler2D mischung; // Lautstärke jeder Stelle, quer: x = Fach, y = Spalte (R32F)
uniform sampler2D verlauf;        // Farbtabelle 256 × 1 (/lib/farben.js)
uniform vec2 aufloesung;          // Bild in Gerätepixeln
uniform float tief;               // unterste Frequenz im Bild (Hz)
uniform float hoch;               // oberste
uniform float dynamik;            // so viele dB sind zwischen Schwarz und der hellsten Farbe
uniform float fachBreite;         // Hz zwischen zwei Fächern
uniform int spalten;
uniform int faecher;

out vec4 farbe;

void main() {
  vec2 anteil = gl_FragCoord.xy / aufloesung; // 0 bis 1, y = 0 unten (wie die Frequenz)

  // waagerecht: einfach durchgezählt
  int spalte = min(int(anteil.x * float(spalten)), spalten - 1);

  // senkrecht: erst die Frequenz an dieser Höhe (logarithmisch, wie leinwand.js), dann das nächste Fach.
  // Unten im Bild sind die Fächer weit auseinander (eine Oktave tief hat nur wenige Fächer):
  // dort sieht man sie als breite Streifen. So grob ist die Leinwand dort wirklich.
  float f = tief * pow(hoch / tief, anteil.y);
  int fach = clamp(int(round(f / fachBreite)), 0, faecher - 1);

  // texelFetch: genau ein Texel, ohne Mischen (Mischen von Float-Texturen kann nicht jedes Handy)
  float amp = texelFetch(mischung, ivec2(fach, spalte), 0).r;
  // Lautstärke -> Helligkeit (umgekehrt wie beim Malen): 0 dB = 1, −dynamik dB = 0
  float wert = amp > 0.0 ? clamp(1.0 + 20.0 * log(amp) / log(10.0) / dynamik, 0.0, 1.0) : 0.0;
  farbe = vec4(texture(verlauf, vec2(wert, 0.5)).rgb, 1.0);
}`;
