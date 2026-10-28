import { fachTabelle } from "./frequenzen.js";
import { audio, einsatzMesser } from "./audio.js";
// Einsätze live: dasselbe Prinzip wie in einsaetze.js (Spectral Flux mit Nachbar-Vergleich),

const BAENDER = 64;
const BODEN_DB = -80; 
const SCHNITT_ZEIT = 0.25; // so schnell folgt der Durchschnitt dem Flux
const SPITZEN_ZEIT = 2; // so langsam vergisst der Merker die letzten großen Spitzen
// kann ja schlecht mit Umgebung, da ich nur nach hinten hab
let ueberSchnitt = 1.5; // Flux muss so viel mal über dem Durchschnitt liegen
let minAnteil = 0.25; // und mindestens so viel der letzten großen Spitzen 
// beide: setzeEmpfindlichkeitLive
const MIN_ABSTAND = 0.08; // schneller hintereinander zählt als ein Einsatz
const ABKLINGEN = 0.15; // so schnell klingt "staerke" nach einem Einsatz ab

let daten = null; // dB pro Fach, vom Analyser
let baender = [];
let alt = null; // dB pro Band im Bild davor
let neu = null;
let schnitt = 0; // gleitender Durchschnitt des Flux
let spitze = 0; // langsam abklingender Merker der größten Flux-Werte
let vorher = 0; // Flux im Bild davor
let letzterEinsatz = -Infinity; // Zeit in s

export let staerke = 0; // bei Einsatz 1 und klingt ab 
const zuhoerer = []; // Funktionen, die bei jedem Einsatz aufgerufen werden

export function beiEinsatz(funktion) {
  zuhoerer.push(funktion);
}

export function setzeEmpfindlichkeitLive(wert) {
  ueberSchnitt = 1 + (1 - wert); 
  minAnteil = 0.5 * (1 - wert); 
}

function richteEin() {
  daten = new Float32Array(einsatzMesser.frequencyBinCount);
  const fachbreite = audio.sampleRate / einsatzMesser.fftSize;
  const [von, bis] = fachTabelle(BAENDER, fachbreite, einsatzMesser.frequencyBinCount - 1, false);
  baender = [];
  for (let b = 0; b < BAENDER; b++) {
    const vorige = baender.at(-1);
    if (vorige && vorige.von === von[b] && vorige.bis === bis[b]) continue; // doppelte weg
    baender.push({ von: von[b], bis: bis[b] });
  }
  alt = new Float32Array(baender.length).fill(BODEN_DB);
  neu = new Float32Array(baender.length);
}

export function pruefeEinsatz(sekunden, zeit) {
  if (!einsatzMesser) return false;
  if (!daten) richteEin();
  einsatzMesser.getFloatFrequencyData(daten); // schon in dB

  // Bänder, lautestes Fach, mit den Nachbarn davor vergleichen
  for (let b = 0; b < baender.length; b++) {
    let lautester = -Infinity;
    for (let k = baender[b].von; k <= baender[b].bis; k++) {
      if (daten[k] > lautester) lautester = daten[k];
    }
    neu[b] = Math.max(lautester, BODEN_DB);
  }
  let flux = 0;
  for (let b = 0; b < baender.length; b++) {
    const davor = Math.max(alt[b], alt[b - 1] ?? BODEN_DB, alt[b + 1] ?? BODEN_DB);
    if (neu[b] > davor) flux += neu[b] - davor;
  }
  [alt, neu] = [neu, alt];

  // Grenze aus dem bisherigen Verlauf (vor dem Aktualisieren, sonst zieht der Einsatz sie selbst hoch)
  const grenze = Math.max(schnitt * ueberSchnitt, spitze * minAnteil);
  const jetzt = zeit / 1000;
  const einsatz = flux > grenze && vorher <= grenze && jetzt - letzterEinsatz >= MIN_ABSTAND;

  // gleitende Werte nach echter Zeit, nicht pro Bild
  // Anteil = 1 - e^(-Zeit / Zeitkonstante), bei 60 und 120 Hz gleich schnell
  schnitt += (flux - schnitt) * (1 - Math.exp(-sekunden / SCHNITT_ZEIT));
  spitze = Math.max(flux, spitze * Math.exp(-sekunden / SPITZEN_ZEIT));
  staerke *= Math.exp(-sekunden / ABKLINGEN);
  vorher = flux;

  if (einsatz) {
    letzterEinsatz = jetzt;
    staerke = 1;
    for (const funktion of zuhoerer) funktion();
  }
  return einsatz;
}