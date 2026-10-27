import { spieler, glaettung, minDb, maxDb } from "./seite.js";
import { baueFilterKette } from "./filter.js";

export const fftRegler = hole("fftRegler");
const fftAnzeige = hole("fftAnzeige");
export const lautstaerke = hole("lautstaerke");
const lautstaerkeAnzeige = hole("lautstaerkeAnzeige");

export let audio = null;
export let analyser = null;
export let mischer = null;
export let ausgang = null;
export let dateiQuelle = null;
let verstaerker = null;

export let pegelMesser = null;
export let pegelDaten = null;

export let einsatzMesser = null;

export let aufnahmeZiel = null;

export function baueAudioAuf() {
  audio = new AudioContext();

  mischer = audio.createGain();
  ausgang = audio.createGain();
  verstaerker = audio.createGain();
  analyser = audio.createAnalyser();
  analyser.fftSize = fftGroesse();

  analyser.smoothingTimeConstant = Number(glaettung.value);
  setzeAnalyserDb(Number(minDb.value), Number(maxDb.value)); // Schwarz- und Weißpunkt

  const [ersterFilter, letzterFilter] = baueFilterKette(audio);

  // ersterFilter bis felterEnde connected
  // ersterFilter.connect(...).....connect(letzterFilter)
  mischer.connect(ersterFilter);
  letzterFilter
    .connect(analyser)
    .connect(verstaerker)
    .connect(ausgang)
    .connect(audio.destination);
  
  // Einsätze Filtern, nur das was ich höre
  // kleine fftSize und keine Glättung, damit Schläge nicht verschmieren
  einsatzMesser = audio.createAnalyser();
  einsatzMesser.fftSize = 1024;
  einsatzMesser.smoothingTimeConstant = 0;
  letzterFilter.connect(einsatzMesser);

  // zum aufnehmen vor den Filtern, in ein Mediastream für MediaRecorder
  aufnahmeZiel = audio.createMediaStreamDestination();
  mischer.connect(aufnahmeZiel);

  // Pegel vor Filter, weil wichtig ist die Quelle
  pegelMesser = audio.createAnalyser();
  pegelMesser.fftSize = 2048; 
  pegelDaten = new Float32Array(pegelMesser.fftSize);
  mischer.connect(pegelMesser);

  dateiQuelle = audio.createMediaElementSource(spieler);

  // verstärker
  setzeLautstaerke();
}

export function fftGroesse() {
  return 2 ** Number(fftRegler.value);
}

export function zeigeFft() {
  fftAnzeige.textContent = fftGroesse();
}

export function setzeAnalyserDb(min, max) {
  if (min < analyser.maxDecibels) {
    analyser.minDecibels = min; 
    analyser.maxDecibels = max;
  } else {
    analyser.maxDecibels = max; // wenn min nicht kleiner als bisheriger max
    // erst max neu setzen, sonst wäre min kurz über max
    analyser.minDecibels = min;
  }
}

export function setzeLautstaerke() {
  const db = Number(lautstaerke.value);
  const dbAnzeigen = Math.round(db);
  lautstaerkeAnzeige.textContent = `${dbAnzeigen > 0 ? "+" : ""}${dbAnzeigen} dB`;
  if (verstaerker) verstaerker.gain.value = 10 ** (db / 20);
}

lautstaerke.addEventListener("input", setzeLautstaerke);