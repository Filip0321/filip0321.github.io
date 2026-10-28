// Exportbereich: nur ein Abschnitt der Aufnahme (z. B. Sekunde 3 bis 5) für PNG, Video und Ton.
// Leere Felder heißen: vom Anfang bzw. bis zum Ende. Setzen geht über die Felder
// oder im Gesamtbild mit gedrückter Alt-Taste ziehen (gesamtbild.js)


import { originalTon } from "./datei.js";

export const vonFeld = hole("exportVon");
export const bisFeld = hole("exportBis");
const MIN_LAENGE = 0.05; // s: kürzer ergibt kein sinnvolles Bild

// der Bereich in Sekunden, auf die Datei begrenzt; ganz = nichts eingeschränkt
export function exportBereich() {
  const dauer = originalTon ? originalTon.duration : 0;
  let von = vonFeld.value === "" ? 0 : Number(vonFeld.value);
  let bis = bisFeld.value === "" ? dauer : Number(bisFeld.value);
  von = Math.min(Math.max(von, 0), dauer);
  bis = Math.min(Math.max(bis, 0), dauer);
  if (bis < von) [von, bis] = [bis, von]; // falsch herum eingetippt: tauschen
  const ganz = von === 0 && bis === dauer;
  return { von, bis, ganz, zuKurz: bis - von < MIN_LAENGE };
}

// von gesamtbild.js beim Ziehen mit Alt, auf Hundertstel gerundet
export function setzeBereich(von, bis) {
  vonFeld.value = Math.min(von, bis).toFixed(2);
  bisFeld.value = Math.max(von, bis).toFixed(2);
}

// neue Datei: der alte Bereich gehört nicht dazu
export function loescheBereich() {
  vonFeld.value = "";
  bisFeld.value = "";
}
