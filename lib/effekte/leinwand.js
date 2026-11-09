// Papier und Material, Teil 2: Leinwand.
//
// Leinwand ist gewebt, in der einfachsten Bindung („Leinwandbindung“): jeder Faden geht abwechselnd über und unter
// den Fäden quer zu ihm. Die senkrechten heißen Kette, die waagerechten Schuss. Wo ein Faden oben liegt, ist er
// rund und hoch, wo er abtaucht, liegt er tiefer: daraus ein Höhenbild, das gegen ein Licht von links oben
// schattiert wird. Echte Fäden sind nie gleich dick: hier und da Verdickungen („Noppen“, englisch slubs), und jeder
// Faden ist ein wenig heller oder dunkler. Feine Härchen laufen längs der Fäden.
// Grundiert (mit Gesso, weiß) oder roh (Leinen, graubraun).
// Farbe auf Leinwand: sie liegt auf den Fäden; wenig Farbe erreicht die Täler zwischen ihnen nicht, dort schaut
// der Grund durch (dünn gemalt sieht man das Gewebe deutlich, dick gemalt kaum).

import { MATERIAL_GLSL, SPUREN_REGLER, wechselRegler } from "./material.js";

const LEINWAND = {
  id: "leinwand",
  name: "Leinwand",
  gruppe: "Papier und Material",
  zeitabhaengig: true,
  shader: /* glsl */ `
uniform float faden, grundierung, unruhe, relief, deckung, dicke, weissLeer;
${MATERIAL_GLSL}
// Höhe eines Fadens: rund im Querschnitt (q = −1 bis 1 quer zum Faden), hoch wo er oben liegt
float faden1(float quer, float laengs, bool oben, float dick) {
  float rund = sqrt(max(0.0, 1.0 - quer * quer / (dick * dick)));
  float welle = oben ? 0.55 + 0.45 * sin(3.1416 * laengs) : 0.25 + 0.2 * sin(3.1416 * laengs);
  return rund * welle;
}
// Höhe des Gewebes an der Pixelstelle, dazu (out) ob dort Kette oder Schuss oben liegt und welcher Faden es ist
float gewebe(vec2 px, float saat, out float welcher) {
  vec2 q = px / faden;
  vec2 z = floor(q), f = fract(q);
  bool ketteOben = mod(z.x + z.y, 2.0) < 1.0;
  // Dicke je Faden (und längs des Fadens wechselnd: Noppen)
  float dickK = 1.05 + unruhe * 0.5 * (wert(vec2(z.x * 7.1 + saat, q.y * 0.15)) - 0.5) + unruhe * 0.2 * (zufall(vec2(z.x, saat)) - 0.5);
  float dickS = 1.05 + unruhe * 0.5 * (wert(vec2(q.x * 0.15, z.y * 7.1 + saat)) - 0.5) + unruhe * 0.2 * (zufall(vec2(saat, z.y)) - 0.5);
  float hk = faden1(f.x * 2.0 - 1.0, f.y, ketteOben, dickK);
  float hs = faden1(f.y * 2.0 - 1.0, f.x, !ketteOben, dickS);
  welcher = hk > hs ? zufall(vec2(z.x, 3.3 + saat)) : zufall(vec2(9.1 + saat, z.y));
  // Härchen längs der Fäden
  float haar = hk > hs ? wert(vec2(q.x * 9.0, q.y * 1.2) + saat) : wert(vec2(q.x * 1.2, q.y * 9.0) + saat);
  return max(hk, hs) + (haar - 0.5) * 0.15 * unruhe;
}
void main() {
  vec2 px = uv * aufloesung;
  float saat = saatOberflaeche();
  float welcher, w2, w3;
  float h = gewebe(px, saat, welcher);
  float hx = gewebe(px + vec2(1.0, 0.0), saat, w2) - h;
  float hy = gewebe(px + vec2(0.0, 1.0), saat, w3) - h;
  float licht = (-hx + hy) * relief * 2.5 + (h - 0.4) * relief * 0.6;
  vec3 grund = grundierung < 0.5 ? vec3(0.93, 0.92, 0.88) : vec3(0.66, 0.58, 0.45);
  vec3 leinwand = grund * (1.0 + (welcher - 0.5) * 0.08 * unruhe) * (1.0 + (fbm(px / 50.0 + saat) - 0.5) * 0.08);
  // Farbe: liegt auf den Fäden; in den Tälern nur, wenn genug da ist (dicke Farbe)
  vec4 b = texture(bild, uv);
  float bedeckt = deckung * smoothstep(0.25 - dicke * 0.6, 0.45 - dicke * 0.6, h);
  if (weissLeer > 0.5) bedeckt *= 1.0 - smoothstep(0.8, 0.97, hell(b.rgb)); // Weiß im Bild: keine Farbe, die Leinwand bleibt
  vec3 aus = mix(leinwand, b.rgb, bedeckt);
  aus *= 1.0 + licht * (1.0 - dicke * 0.6); // dicke Farbe füllt das Gewebe, das Relief wird flacher
  farbe = vec4(clamp(spuren(aus, px, false), 0.0, 1.0), b.a);
}`,
  regler: [
    {
      gruppe: "Leinwand",
      regler: [
        { name: "faden", text: "Fadenbreite (Pixel)", min: 1.5, max: 16, schritt: 0.5, wert: 4 },
        { name: "grundierung", text: "Leinwand", auswahl: ["grundiert (weiß)", "roh (Leinen)"], wert: 0 },
        { name: "unruhe", text: "ungleiche Fäden", min: 0, max: 1.5, schritt: 0.01, wert: 0.6 },
        { name: "relief", text: "Relief", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
      ],
    },
    {
      gruppe: "Farbe",
      regler: [
        { name: "deckung", text: "Deckung", min: 0, max: 1, schritt: 0.01, wert: 0.95 },
        { name: "dicke", text: "Farbe dick", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "weissLeer", text: "Weiß im Bild", auswahl: ["ist weiße Farbe", "bleibt Leinwand"], wert: 0 },
      ],
    },
    { ...SPUREN_REGLER, regler: SPUREN_REGLER.regler.map((r) => (r.name === "flecken" || r.name === "kratzer" ? { ...r, wert: 0 } : r)) },
    wechselRegler("Leinwand", "neue Leinwand"),
  ],
};

export const LEINWAENDE = [LEINWAND];
