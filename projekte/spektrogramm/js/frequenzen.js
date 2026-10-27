export const MIN_FREQUENZ = 20;
export const MAX_FREQUENZ = 20000;
// Hörbereich des Menschen

export const SKALA = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
// die Frequenzen für die Skala an der Seite

export function frequenzZuAnteil(frequenz) {
  return Math.log(frequenz / MIN_FREQUENZ) / Math.log(MAX_FREQUENZ / MIN_FREQUENZ);
  // weil Frequenz is exponentiell, also ist der Anteil logorithmisch
  // also (max/min) hoch was ist (frequenz/min)
  // Zahl zwischen 0 und 1
}

export function anteilZuFrequenz(anteil) {
  return MIN_FREQUENZ * (MAX_FREQUENZ / MIN_FREQUENZ) ** anteil;
  // die Umkehrung lol
}

export function beschriftung(frequenz) {
  return frequenz < 1000 ? `${frequenz}` : `${frequenz / 1000}k`;
  // für die Skala
}

export function zeigeFrequenz(f) {
  return f < 1000
    ? `${Math.round(f)} Hz`
    : `${Math.round(f / 100) / 10} kHz`;
  // aus 250 wird 250 Hz
  // aus 4000 halt 4 kHz
}


export function fachTabelle(pixel, fachbreite, letztes, vonOben) {
  const von = new Int32Array(pixel);
  const bis = new Int32Array(pixel);
  // Die Pixel sind natürlich gleichmäßig, und die Fächer linear (jedes Fach aber andere Frequenz), also ebenfalls gleichmäßig
  // da aber die Achse logorithmisch die Frequenzen verteilt werden zu beginn in niedrigen Frequenzen
  // ein Fach oder wenige über viele Pixel verteilt sein, diese werden immer kleiner, bis am Ende auf ein pixel viele Fächer
  for (let p = 0; p < pixel; p++) {
    const anteilTief = vonOben ? 1 - (p + 1) / pixel : p / pixel; // von welchem anteil der strecke
    const anteilHoch = vonOben ? 1 - p / pixel : (p + 1) / pixel; // bis zu welchem
    von[p] = Math.floor(anteilZuFrequenz(anteilTief) / fachbreite); 
    bis[p] = Math.min(Math.floor(anteilZuFrequenz(anteilHoch) / fachbreite), letztes);
    // fachbreite ist wieviele Hz pro Fach -> ausrechnen von welchem Fach bis welchem Fach dieser eine Pixel abdeckt
  } 
  return [von, bis];
}