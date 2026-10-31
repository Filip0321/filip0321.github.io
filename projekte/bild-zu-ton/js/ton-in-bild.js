// Um aus dem Ton wieder ein Bild zu machen

import { baueFft } from "/lib/fft.js";
import { RATE, zeileZuFrequenz } from "./ton.js";
import { warte } from "/lib/export.js";

const ANALYSE_FENSTER = 8192; // lang = Tiefen scharf, Zeit verschmiert; kurz = umgekehrt
const fft = baueFft(ANALYSE_FENSTER);
const hann = new Float32Array(ANALYSE_FENSTER);
for (let n = 0; n < ANALYSE_FENSTER; n++) {
  hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / ANALYSE_FENSTER));
  // Kurve von 0 bis 1 bis 0
}

export async function analysiere(ton, spalten, zeilen, { tief, hoch, dynamik, beiFortschritt }) {
  const raster = new Float32Array(spalten * zeilen);
  const fachbreite = RATE / ANALYSE_FENSTER; // wieviele Frequenzen / Fenster -> wieviele Frequenzen pro Fach
  const letztesFach = ANALYSE_FENSTER / 2 - 1;

  const pos = new Float32Array(zeilen);
  const von = new Int32Array(zeilen);
  const bis = new Int32Array(zeilen);

  const q = (hoch / tief) ** (1 / (zeilen - 1)); // Faktor von Zeile zu Zeile

  for (let zeile = 0; zeile < zeilen; zeile++) {
    const f = zeileZuFrequenz(zeile, zeilen, tief, hoch);
    pos[zeile] = f / fachbreite; // genaue Fach-Position (mit Komma), für schmale Zeilen
    von[zeile] = Math.ceil(f / Math.sqrt(q) / fachbreite); // erstes Fach, das ganz in der Zeile liegt
    bis[zeile] = Math.min(Math.floor((f * Math.sqrt(q)) / fachbreite), ANALYSE_FENSTER / 2 - 1); // letztes
    // da die Frequenz der Zeile sich auf die Mitte der Zeile bezieht teile ich durch halben Faktor
    // (sqrt() weil Log-Achse) und genauso mal den Faktor um die Frequenzen des Anfangs und Endes der Zeile zu bekommen
    // ANALYSE-FENSER ist die Anzahl der Fächer, also durch fachbreite
    // -> welche Fächer deckt die Zeile ab
  }

  const samplesProSpalte = ton.length / spalten; // ton.length sind schon samples
  let letztePause = performance.now();

  const stueck = new Float32Array(ANALYSE_FENSTER);
  const re = new Float32Array(ANALYSE_FENSTER);
  const im = new Float32Array(ANALYSE_FENSTER);
  const betrag = new Float32Array(ANALYSE_FENSTER / 2)
  
  let max = 0;

  for (let spalte = 0; spalte < spalten; spalte++) {
    let mitte = (spalte + 0.5) * samplesProSpalte; // mitte der Spalte
    const start = Math.round(mitte - ANALYSE_FENSTER / 2); // anfang der Spalte
    for (let n = 0; n < ANALYSE_FENSTER; n++) {
      const i = start + n;
      stueck[n] = i >= 0 && i < ton.length ? ton[i] * hann[n] : 0;
    }

    fft(stueck, re, im);
    for (let k = 0; k < ANALYSE_FENSTER / 2; k++) {
      betrag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }

    for (let zeile = 0; zeile < zeilen; zeile++) {
      let wert = 0;
      if (bis[zeile] >= von[zeile]) {
        // breit: das lauteste Fach zwischen von und bis
        for (let k = von[zeile]; k <= bis[zeile]; k++) {
          if (betrag[k] > wert) wert = betrag[k];
        }
      } else {
        // schmal: zwischen Fach i und i + 1 linear mischen
        // nur bei niedrigen Frequenzen, da Zeilen gleich groß sind aber Frequenzn Logorithmisch
        // sind unten wenige Frequenzn in einer Zeile und oben viele in einer (= wenige und viele Fächer)
        // abstand kleiner als 1 fach, also ceil macht "von" größer als floor "bis"
        const i = Math.min(Math.floor(pos[zeile]), letztesFach - 1);
        const anteil = pos[zeile] - i; // nur das hinterm Komma bleibt, also von 0 bis 1 zwischen Fach floor und ceil der Zeile
        wert = betrag[i] * (1 - anteil) + betrag[i + 1] * anteil;
      }
      const amplitude = (4 * wert) / ANALYSE_FENSTER; // Hann: ein Sinus mit Amplitude A ergibt etwa A * FENSTER / 4
      raster[spalte * zeilen + zeile] = amplitude; // erst einmal die Amplitude speichern
      if (amplitude > max) max = amplitude;
    }
 
    if (performance.now() - letztePause > 50) {
      beiFortschritt?.((spalte + 1) / spalten);
      await warte();
      letztePause = performance.now();
    }
  }
 
  if (max === 0) return raster; // Stille: alles bleibt 0
  for (let i = 0; i < raster.length; i++) {
    const a = raster[i] / max; // alles normieren
    if (a === 0) continue; // schon 0
    const db = 20 * Math.log10(a); // 0 dB beim lautesten, darunter negativ
    raster[i] = Math.min(Math.max(1 + db / dynamik, 0), 1); // −dynamik dB und leiser -> Schwarz
  }
  return raster;
}
