import { spieler, zeigeMeldung } from "./seite.js";
import { FENSTER, fft } from "/lib/fft.js";
import { fachTabelle } from "./frequenzen.js";
import { warte } from "/lib/export.js";

const aufnahmeInfo = hole("aufnahmeInfo");

export const ANALYSE_RATE = 48000;
export let aufnahme = null;
export let dateiName = "aufnahme";
export let originalTon = null; // kein Mono

export async function ladeDatei(datei) {
  dateiName = datei.name.replace(/\.[^.]+$/, "");
  if (spieler.src.startsWith("blob:")) URL.revokeObjectURL(spieler.src);
  spieler.src = URL.createObjectURL(datei);

  const bytes = await datei.arrayBuffer();
  const dekoder = new OfflineAudioContext(1, 1, ANALYSE_RATE);
  let puffer;
  try {
    puffer = await dekoder.decodeAudioData(bytes);
  } catch {
    gesamtDb = null;
    originalTon = null;
    zeigeMeldung("Datei kann vom Browser nicht gelesen werden");
    return false;
  }
  aufnahme = zuMono(puffer);
  originalTon = puffer;
  if (anzahlStuecke(aufnahme.length) > MAX_STUECKE) {
    gesamtDb = null;
    zeigeAufnahme(puffer);
    zeigeMeldung("Zu lang für das Gesamtbild (max 11 min)");
    return false;
  }
  if (!(await berechneGesamt())) return false;
  zeigeAufnahme(puffer);
  return true;
}

// Stücke (Frames) für die eigene FFT
//------------------------------------------------------
export const SPRUNG = FENSTER / 4; // so weit rückt das nächste Stück vor, 3/4 überlappen sich

// Hann-Fenster: eine Glockenkurve von 0 über 1 zurück auf 0, einmal vorausberechnet
const hann = new Float32Array(FENSTER);
for (let n = 0; n < FENSTER; n++) {
  hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / FENSTER));
}

// wie viele ganze Stücke in die Aufnahme passen
export function anzahlStuecke(laenge) {
  if (laenge < FENSTER) return 0;
  return Math.floor((laenge - FENSTER) / SPRUNG) + 1;
}

function holeStueck(nummer, ziel) {
  const start = nummer * SPRUNG;
  for (let n = 0; n < FENSTER; n++) {
    ziel[n] = aufnahme[start + n] * hann[n]; // durch hann[] wird es am anfang und ende "ausgewaschen"
  }
  return ziel;
}
//------------------------------------------------------

// Gesamtbild
export const ZEILEN = 1024;
export const MAX_STUECKE = 32767 - 100;
// max CanvasGröße

const [vonFachGesamt, bisFachGesamt] = fachTabelle(ZEILEN, ANALYSE_RATE / FENSTER, FENSTER / 2 - 1, true);

export let gesamtDb = null;
export let gesamtStuecke = 0;
let rechenNummer = 0;

function zuDb(betrag) {
  return 20 * Math.log10(betrag / FENSTER + 1e-12);
  // sonst ist log10(0) = -Infinity
}

async function berechneGesamt() {
  const meine = ++rechenNummer;
  gesamtStuecke = anzahlStuecke(aufnahme.length);
  gesamtDb = new Float32Array(gesamtStuecke * ZEILEN);
  const stueck = new Float32Array(FENSTER);
  const re = new Float32Array(FENSTER);
  const im = new Float32Array(FENSTER);
  const betrag = new Float32Array(FENSTER / 2);
  let letztePause = performance.now();

  for (let s = 0; s < gesamtStuecke; s++) {
    fft(holeStueck(s, stueck), re, im);
    // nach rekursion haben re und im die werte an jeder stelle für das Stück, um frequenzen nachzubauen
    for (let k = 0; k < FENSTER / 2; k++) {
      betrag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]); // schneller als Math.hypot
      // länge Pfeil für alle Winkel im Stück
    }
    const spalte = s * ZEILEN;
    for (let y = 0; y < ZEILEN; y++) {
      let lautester = 0;
      for (let k = vonFachGesamt[y]; k <= bisFachGesamt[y]; k++) {
        if (betrag[k] > lautester) lautester = betrag[k];
      }
      gesamtDb[spalte + y] = zuDb(lautester);
    }
    if (performance.now() - letztePause > 50) {
      aufnahmeInfo.textContent = `Rechne ... ${Math.round((s / gesamtStuecke) * 100)} %`;
      await warte();
      if (meine !== rechenNummer) return false; // während der Pause kam eine neue Datei
      letztePause = performance.now();
    }
  }
  return true;
}

export function zeitZuSpalte(sekunden) {
  const s = (sekunden * ANALYSE_RATE - FENSTER / 2) / SPRUNG; // welches Stück, mit Komma
  return s + 0.5; // + 0.5: Mitte der Pixelspalte
}

export function spalteZuZeit(spalte) {
  return ((spalte - 0.5) * SPRUNG + FENSTER / 2) / ANALYSE_RATE;
}

// Mittelwert aller Kanäle, Sample für Sample
function zuMono(puffer) {
  const mono = new Float32Array(puffer.length);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k); // Float32Array eines Kanals
    for (let i = 0; i < puffer.length; i++) mono[i] += kanal[i] / puffer.numberOfChannels;
  }
  return mono;
}

function zeigeAufnahme(puffer) {
  const minuten = Math.floor(puffer.duration / 60);
  const sekunden = Math.round(puffer.duration % 60).toString().padStart(2, "0");
  aufnahmeInfo.textContent =
    `${minuten}:${sekunden} min | ${puffer.numberOfChannels} ${puffer.numberOfChannels === 1 ? "Kanal" : "Kanäle"} | ` +
    `${puffer.sampleRate} Hz | ${puffer.length.toLocaleString("de-DE")} Samples | ` +
    `${anzahlStuecke(puffer.length).toLocaleString("de-DE")} Stücke`;
}