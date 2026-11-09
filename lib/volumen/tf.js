// Transferfunktion: welcher Wert welche Farbe und Deckkraft bekommt.
// Gewebe-Voreinstellungen für CT in Hounsfield-Einheiten (HU): Luft −1000, Fett um −100, Wasser 0, Weichteile
// 20 bis 80, Blut mit Kontrastmittel 150 bis 300, Knochen 300 bis über 1500. Ein Punkt: [HU, [r, g, b], Deckkraft].
// Zwischen den Punkten wird gemischt; das Fenster (von, bis) ist der erste und letzte Punkt.
import { farbtabelle, skalaAnker } from "/lib/farben.js";

const HAUT = [226, 170, 140];
const KNOCHEN = [242, 232, 214];
export const GEWEBE = {
  knochen: [[100, KNOCHEN, 0], [250, KNOCHEN, 0.25], [700, [250, 245, 235], 0.8], [1600, [255, 255, 255], 0.95]],
  haut: [[-800, HAUT, 0], [-550, HAUT, 0], [-350, HAUT, 0.8], [1600, HAUT, 0.8]],
  gefaesse: [[-50, [60, 20, 20], 0], [40, [150, 50, 45], 0.015], [130, [190, 70, 55], 0.05], [200, [235, 110, 85], 0.55], [380, [250, 210, 190], 0.6], [1600, [255, 255, 255], 0.9]],
  lunge: [[-1000, [80, 120, 200], 0], [-920, [110, 160, 230], 0], [-760, [160, 200, 255], 0.18], [-500, [210, 225, 255], 0.03], [-300, [0, 0, 0], 0], [250, KNOCHEN, 0], [600, KNOCHEN, 0.5], [1600, KNOCHEN, 0.85]],
};

// aus Punkten: 256 RGBA-Werte und das Fenster
export function ausPunkten(punkte) {
  const von = punkte[0][0];
  const bis = punkte[punkte.length - 1][0];
  const aus = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const w = von + ((bis - von) * i) / 255;
    let k = 0;
    while (k < punkte.length - 2 && punkte[k + 1][0] < w) k++;
    const [w0, f0, a0] = punkte[k];
    const [w1, f1, a1] = punkte[k + 1];
    const t = Math.min(1, Math.max(0, (w - w0) / (w1 - w0 || 1)));
    aus.set([...f0.map((x, j) => x + (f1[j] - x) * t), 255 * (a0 + (a1 - a0) * t)].map(Math.round), i * 4);
  }
  return { farben: aus, fenster: [von, bis] };
}

// eigene: Fenster [von, bis], Farbskala, Deckkraft bis „deckkraft“, Kurve „gamma“ (größer = erst spät deckend)
export function eigene(von, bis, skala, deckkraft, gamma) {
  const f = farbtabelle(skalaAnker(skala));
  const aus = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) aus.set([f[i * 3], f[i * 3 + 1], f[i * 3 + 2], Math.round(255 * deckkraft * (i / 255) ** gamma)], i * 4);
  return { farben: aus, fenster: [von, bis] };
}
