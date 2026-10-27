// Einfach zum Sammeln der verschiedenen Elemente und dem Anpassen der größe

export const spieler = hole("spieler");
export const canvas = hole("bild");
export const ctx = canvas.getContext("2d");

export const canvas2 = hole("skala");
export const ctx2 = canvas2.getContext("2d");

export const ansicht = hole("ansicht");
export const glaettung = hole("glaettung");
export const einsaetzeZeigen = hole("einsaetzeZeigen");

// Die Zahl muss ich mit "Number(minDb.value)" holen
export const minDb = hole("minDb");
export const maxDb = hole("maxDb");

const meldung = hole("meldung");

export let dpr = 2;

export function passeGroesseAn() {
  // mindestens doppelt so fein rechnen, auch bei normalen Monitoren mit dpr 1
  dpr = Math.max(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  canvas2.width = Math.round(canvas2.clientWidth * dpr);
  canvas2.height = Math.round(canvas2.clientHeight * dpr);
}

export function zeigeMeldung(text) {
  meldung.textContent = text;
  meldung.hidden = text === "";
}

// Lesekopf beim Umlaufen: ein heller Strich direkt var der Schreibstelle
// Das nächste Bild überschreibt ihn mit Daten und malt ihn eins weiter, so wandert er mit
export const LESEKOPF_FARBE = "#DDDDDD"; 
export function lesekopfBreite() {
  return Math.round(dpr); // 1 CSS-Pixel
}