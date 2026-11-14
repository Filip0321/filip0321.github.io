// Transferfunktion: welcher Wert welche Farbe und Deckkraft bekommt.
// Eine Kurve aus Punkten [Wert, [r, g, b], Deckkraft]; zwischen den Punkten wird gemischt, das Fenster (von, bis) ist
// der erste und letzte Punkt. Auf der Grafikkarte wird daraus eine Tabelle mit TF_GROESSE Einträgen.
// Warum 1024 und nicht 256: über die ganze CT-Skala (−1000 bis 2000) wären 256 Einträge je 12 Hounsfield-Einheiten
// breit, das Gehirn (graue Substanz um 40, weiße um 25) läge dann in zwei Einträgen. Mit 1024 sind es 3 HU.
//
// Vorlagen für CT in Hounsfield-Einheiten (HU): Luft −1000, Fett um −100, Wasser 0, Hirnwasser 0 bis 15,
// weiße Substanz um 25, graue um 40, Muskeln und Organe 40 bis 80, Blut mit Kontrastmittel 150 bis 300,
// Knochen ab 300. Bei MRT haben die Werte keine feste Bedeutung (jedes Gerät, jede Sequenz anders): dort werden die
// Vorlagen aus dem Histogramm gerechnet (Perzentile, siehe histogramm.js).
import { farbtabelle, skalaAnker } from "/lib/farben.js";

export const TF_GROESSE = 1024;

const HAUT = [226, 170, 140];
const KNOCHEN = [242, 232, 214];
export const GEWEBE = {
  knochen: [[100, KNOCHEN, 0], [250, KNOCHEN, 0.25], [700, [250, 245, 235], 0.8], [1600, [255, 255, 255], 0.95]],
  haut: [[-800, HAUT, 0], [-550, HAUT, 0], [-350, HAUT, 0.8], [1600, HAUT, 0.8]],
  gefaesse: [[-50, [60, 20, 20], 0], [40, [150, 50, 45], 0.015], [130, [190, 70, 55], 0.05], [200, [235, 110, 85], 0.55], [380, [250, 210, 190], 0.6], [1600, [255, 255, 255], 0.9]],
  lunge: [[-1000, [80, 120, 200], 0], [-920, [110, 160, 230], 0], [-760, [160, 200, 255], 0.18], [-500, [210, 225, 255], 0.03], [-300, [0, 0, 0], 0], [250, KNOCHEN, 0], [600, KNOCHEN, 0.5], [1600, KNOCHEN, 0.85]],
  // Weichteile: Fett ganz schwach gelb, Muskeln und Organe rot, Knochen nur als Hauch (sonst verdeckt er alles)
  weichteile: [[-200, [230, 200, 120], 0], [-110, [230, 200, 120], 0], [-90, [235, 205, 125], 0.03], [-60, [230, 200, 120], 0], [10, [150, 40, 40], 0], [40, [200, 70, 60], 0.12], [80, [235, 125, 105], 0.3], [140, [240, 180, 160], 0], [400, KNOCHEN, 0], [900, KNOCHEN, 0.12], [1600, [255, 255, 255], 0.2]],
  // Gehirn: nur das enge Band um 15 bis 55 HU, Haut, Fett und Knochen ganz durchsichtig. Hirnwasser (0 bis 15) blau
  // und schwach. Muskeln haben dieselben Werte wie das Gehirn: was außen um den Schädel liegt, leuchtet mit. Dagegen
  // hilft ein Segment (Klick ins Gehirn: alles Zusammenhängende im Bereich, der Schädel ist die Grenze) oder die Schere.
  gehirn: [[-20, [40, 60, 140], 0], [3, [60, 90, 180], 0], [10, [90, 120, 210], 0.05], [17, [150, 130, 170], 0], [24, [235, 190, 180], 0.35], [36, [240, 165, 160], 0.55], [52, [250, 210, 200], 0.4], [62, [250, 210, 200], 0], [120, [0, 0, 0], 0]],
};

// aus Punkten: TF_GROESSE RGBA-Werte und das Fenster. skala (wahlweise, farbtabelle aus farben.js: 256 · 3):
// dann kommt die Farbe nicht von den Punkten, sondern aus der Skala über das Fenster (vom ersten bis zum letzten
// Punkt: Glut, Eis …); die Deckkraft bleibt die der Punkte
export function ausPunkten(punkte, skala = null) {
  const von = punkte[0][0];
  const bis = Math.max(punkte[punkte.length - 1][0], von + 1e-6);
  const n = TF_GROESSE;
  const aus = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = von + ((bis - von) * i) / (n - 1);
    let k = 0;
    while (k < punkte.length - 2 && punkte[k + 1][0] < w) k++;
    const [w0, f0, a0] = punkte[k];
    const [w1, f1, a1] = punkte[Math.min(k + 1, punkte.length - 1)];
    const t = Math.min(1, Math.max(0, (w - w0) / (w1 - w0 || 1)));
    const farbe = skala ? [0, 1, 2].map((j) => skala[Math.round((i / (n - 1)) * 255) * 3 + j]) : f0.map((x, j) => x + (f1[j] - x) * t);
    aus.set([...farbe, 255 * (a0 + (a1 - a0) * t)].map(Math.round), i * 4);
  }
  return { farben: aus, fenster: [von, bis] };
}

// eigene: Fenster [von, bis], Farbskala, Deckkraft bis „deckkraft“, Kurve „gamma“ (größer = erst spät deckend)
export function eigene(von, bis, skala, deckkraft, gamma) {
  const f = farbtabelle(skalaAnker(skala));
  const n = TF_GROESSE;
  const aus = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = Math.round((i / (n - 1)) * 255);
    aus.set([f[k * 3], f[k * 3 + 1], f[k * 3 + 2], Math.round(255 * deckkraft * (i / (n - 1)) ** gamma)], i * 4);
  }
  return { farben: aus, fenster: [von, bis] };
}

// Vorlagen, die vom Volumen abhängen (MRT und alles ohne feste Skala): aus Perzentilen des Vordergrunds
// (h: histogramm.js). p(0.5) ist der Median der Werte, die nicht Hintergrund (Luft) sind.
export function vorlageAusHistogramm(art, h) {
  const p = (x) => h.perzentil(x, true);
  const lo = p(0.02);
  const hi = p(0.995);
  const span = Math.max(hi - lo, 1e-6);
  if (art === "mrtAussen") {
    // die Oberfläche: alles über dem dunklen Rand des Vordergrunds, hautfarben und deckend
    const s = p(0.12);
    return [[lo, HAUT, 0], [s, HAUT, 0], [s + span * 0.04, HAUT, 0.85], [hi, HAUT, 0.85]];
  }
  if (art === "mrtGewebe") {
    // mittlere Helligkeiten (bei T1: Hirngewebe), die hellsten (Fett) und dunkelsten (Wasser, Rand) durchsichtig
    const a = p(0.35), m = p(0.6), b = p(0.85);
    return [[lo, [0, 0, 0], 0], [a, [180, 120, 140], 0], [m, [240, 180, 175], 0.35], [b, [250, 220, 210], 0.5], [b + span * 0.05, [250, 220, 210], 0], [hi, [0, 0, 0], 0]];
  }
  if (art === "mrtHell") {
    // nur die hellsten Stellen (T1: Fett, Kontrastmittel; TOF-Angiografie: Gefäße)
    const a = p(0.9), b = p(0.98);
    return [[lo, [0, 0, 0], 0], [a, [230, 90, 70], 0], [b, [250, 170, 130], 0.5], [hi, [255, 240, 220], 0.9]];
  }
  if (art === "rampe") {
    // wie früher „eigene Kurve“: von dunkel nach hell immer deckender (Kurve t²), Farben am besten aus einer Skala
    return [0, 0.25, 0.5, 0.75, 1].map((t) => [lo + span * t, [255 * t, 255 * t, 255 * t].map(Math.round), 0.5 * t * t]);
  }
  // regenbogen: jeder Wert eine Farbe, wenig Deckkraft: zum Erkunden unbekannter Daten (was liegt wo?)
  const farben = [[40, 40, 160], [40, 160, 220], [60, 200, 90], [240, 220, 60], [240, 120, 40], [220, 40, 40]];
  return farben.map((f, i) => [lo + (span * i) / (farben.length - 1), f, i === 0 ? 0 : 0.05 + 0.25 * (i / (farben.length - 1))]);
}

// Farbe und Deckkraft (0 bis 1) für einen Wert aus einer fertigen Tabelle (für den Export)
export function nachschlagen(tf, wert) {
  const [von, bis] = tf.fenster;
  const n = tf.farben.length / 4;
  const i = Math.min(n - 1, Math.max(0, Math.round(((wert - von) / (bis - von)) * (n - 1))));
  const f = tf.farben;
  return [f[i * 4] / 255, f[i * 4 + 1] / 255, f[i * 4 + 2] / 255, f[i * 4 + 3] / 255];
}
