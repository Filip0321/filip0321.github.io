// Kantenerkennung als GLSL-Bausteine, für alle Projekte, die Umrisse brauchen
// (Video zu Ton, später bild-zu-ton als Vorbearbeitung, Chronofotografie).
// Kein eigenes Programm: die Texte werden in einen Fragment-Shader eingesetzt (${KANTEN_GLSL}).
//
// Drei Schritte, in dieser Reihenfolge:
//   helligkeit  Farbe -> eine Zahl, wie das Auge sie empfindet (Rec. 709: Grün zählt am meisten)
//   weich       3 × 3 Gauß: jedes Pixel mit seinen Nachbarn gemittelt, die Mitte zählt am meisten.
//               Vorher nötig, weil Sobel Unterschiede misst, und Rauschen ist auch ein Unterschied.
//   sobel       wie stark sich die Helligkeit an dieser Stelle ändert (der Gradient):
//               gx = rechts − links, gy = oben − unten, je mit der Mitte doppelt gewichtet,
//               Kante = Länge von (gx, gy). Flächen werden 0, Umrisse hell.
//
//        −1 0 +1            −1 −2 −1
//   gx:  −2 0 +2      gy:    0  0  0
//        −1 0 +1            +1 +2 +1

export const KANTEN_GLSL = /* glsl */ `
float helligkeit(vec3 farbe) {
  return dot(farbe, vec3(0.2126, 0.7152, 0.0722));
}

// bild: Textur, uv: Stelle, schritt: Abstand zum Nachbarn in uv (1 / Größe, mal Radius)
float weich(sampler2D bild, vec2 uv, vec2 schritt) {
  float summe = 0.0;
  // Gewichte 1 2 1 / 2 4 2 / 1 2 1, zusammen 16
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float gewicht = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      summe += gewicht * texture(bild, uv + vec2(x, y) * schritt).r;
    }
  }
  return summe / 16.0;
}

// liest den Rotkanal (dort steht die Helligkeit), Ergebnis etwa 0 bis 4 (darum später verstärken oder kappen)
float sobel(sampler2D bild, vec2 uv, vec2 schritt) {
  float l  = texture(bild, uv + vec2(-1.0,  0.0) * schritt).r;
  float r  = texture(bild, uv + vec2( 1.0,  0.0) * schritt).r;
  float u  = texture(bild, uv + vec2( 0.0, -1.0) * schritt).r;
  float o  = texture(bild, uv + vec2( 0.0,  1.0) * schritt).r;
  float lu = texture(bild, uv + vec2(-1.0, -1.0) * schritt).r;
  float ru = texture(bild, uv + vec2( 1.0, -1.0) * schritt).r;
  float lo = texture(bild, uv + vec2(-1.0,  1.0) * schritt).r;
  float ro = texture(bild, uv + vec2( 1.0,  1.0) * schritt).r;
  float gx = (ru + 2.0 * r + ro) - (lu + 2.0 * l + lo);
  float gy = (lo + 2.0 * o + ro) - (lu + 2.0 * u + ru);
  return length(vec2(gx, gy));
}
`;
