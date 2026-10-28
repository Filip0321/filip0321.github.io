import { originalTon } from "./datei.js";

export const vonFeld = hole("exportVon");
export const bisFeld = hole("exportBis");
const MIN_LAENGE = 0.05; // s: kürzer ergibt kein sinnvolles Bild

export function exportBereich() {
  const dauer = originalTon ? originalTon.duration : 0;
  let von = vonFeld.value === "" ? 0 : Number(vonFeld.value);
  let bis = bisFeld.value === "" ? dauer : Number(bisFeld.value);
  von = Math.min(Math.max(von, 0), dauer);
  bis = Math.min(Math.max(bis, 0), dauer);
  if (bis < von) [von, bis] = [bis, von]; 
  const ganz = von === 0 && bis === dauer;
  return { von, bis, ganz, zuKurz: bis - von < MIN_LAENGE };
}

export function setzeBereich(von, bis) {
  vonFeld.value = Math.min(von, bis).toFixed(2);
  bisFeld.value = Math.max(von, bis).toFixed(2);
}

export function loescheBereich() {
  vonFeld.value = "";
  bisFeld.value = "";
}
