// Stellen, an denen plötzlich etwas Neues anfängt (Schlag, Ton, Silbe)

import { baueFft } from "/lib/fft.js";
import { fachTabelle } from "./frequenzen.js";
import { ANALYSE_RATE, aufnahme } from "./datei.js";
import { warte } from "/lib/export.js";

const KLEIN = 1024;
const KLEIN_SPRUNG = KLEIN / 4;
const BAENDER = 64;
const BODEN_DB = -80; // sonst hat rauschen nen einfluss

export const STUECKE_PRO_SEKUNDE = ANALYSE_RATE / KLEIN_SPRUNG; 
const MAX_UMGEBUNG = Math.round(0.064 * STUECKE_PRO_SEKUNDE); // ms
const SCHNITT_UMGEBUNG = Math.round(0.213 * STUECKE_PRO_SEKUNDE); 
const MIN_ABSTAND = Math.round(0.064 * STUECKE_PRO_SEKUNDE); 
let ueberSchnitt = 0.05; // empfindlichkeit

const fftKlein = baueFft(KLEIN);
const hannKlein = new Float32Array(KLEIN);
for (let n = 0; n < KLEIN; n++) {
  hannKlein[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / KLEIN));
  // Bellkurve, von 0 bis 1 bis 0
}

// Fächer, Frequenzen zusammenfassen und dann db veränderungen checken
const [vonAlle, bisAlle] = fachTabelle(BAENDER, ANALYSE_RATE / KLEIN, KLEIN / 2 - 1, false);
const baender = [];
for (let b = 0; b < BAENDER; b++) {
  const vorher = baender.at(-1);
  if (vorher && vorher.von === vonAlle[b] && vorher.bis === bisAlle[b]) continue;
  baender.push({ von: vonAlle[b], bis: bisAlle[b] });
}

export let flux = null; // pro kleinem Stück, wie viel lauter es geworden ist, 0–1
export let einsaetze = []; // Zeiten in Sekunden, an denen etwas einsetzt
let rechenNummer = 0; 

export function stueckZuZeit(s) {
  return (s * KLEIN_SPRUNG + KLEIN / 2) / ANALYSE_RATE;
}

export async function berechneEinsaetze() {
  const meine = ++rechenNummer;
  flux = null; 
  einsaetze = [];
  const anzahl = aufnahme.length < KLEIN ? 0 : Math.floor((aufnahme.length - KLEIN) / KLEIN_SPRUNG) + 1;
  const neuerFlux = new Float32Array(anzahl);
  const stueck = new Float32Array(KLEIN);
  const re = new Float32Array(KLEIN);
  const im = new Float32Array(KLEIN);
  let alt = new Float32Array(baender.length); // dB pro Band im Stück davor
  let neu = new Float32Array(baender.length); // also beim verschieben des Fensters immer neu
  let groesster = 0;
  let letztePause = performance.now();

  // pro Stück die Zunahme aller Bänder gegenüber dem Stück davor
  for (let s = 0; s < anzahl; s++) {
    const start = s * KLEIN_SPRUNG;
    for (let n = 0; n < KLEIN; n++) stueck[n] = aufnahme[start + n] * hannKlein[n];
    fftKlein(stueck, re, im);

    let summe = 0;
    for (let b = 0; b < baender.length; b++) {
      let lautester = 0; 
      for (let k = baender[b].von; k <= baender[b].bis; k++) {
        const betrag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        if (betrag > lautester) lautester = betrag;
      }
      neu[b] = Math.max(20 * Math.log10(lautester / KLEIN + 1e-12), BODEN_DB);
    }
    if (s > 0) {
      for (let b = 0; b < baender.length; b++) {
        // mit dem lautesten der Nachbar-Bänder im Stück davor vergleichen 
        // ein Ton, der nur ins nächste Band rutscht ist kein Einsatz
        const davor = Math.max(alt[b], alt[b - 1] ?? BODEN_DB, alt[b + 1] ?? BODEN_DB);
        // alt und neu zeigt im spektrogramm die übereinandergestapelten Zeilen, 
        // wenn jedes stück zu einer Spalte wird
        if (neu[b] > davor) summe += neu[b] - davor; // wieviel lauter
      }
    }
    neuerFlux[s] = summe;
    if (summe > groesster) groesster = summe;
    [alt, neu] = [neu, alt]; 

    if (performance.now() - letztePause > 50) {
      await warte();
      if (meine !== rechenNummer) return false;
      letztePause = performance.now();
    }
  }
  // auf 0–1 bringen, damit ueberSchnitt bei leisen und lauten Aufnahmen gleich wirkt
  if (groesster > 0) {
    for (let s = 0; s < anzahl; s++) neuerFlux[s] /= groesster;
  }
  flux = neuerFlux;
  sucheSpitzen();
  return true;
}

// Empfindlichkeit 0 (nur deutliche Einsätze) bis 1 (auch leise)
export function setzeEmpfindlichkeit(wert) {
  ueberSchnitt = 0.1 * (1 - wert);
  if (flux) sucheSpitzen();
}

// Spitzen suchen
// höchste Stelle in der Nähe UND deutlich über dem Durchschnitt drumherum
function sucheSpitzen() {
  const gefunden = [];
  let letzter = -Infinity;
  for (let s = 1; s < flux.length; s++) {
    if (!istHoechsteStelle(s)) continue;
    if (flux[s] < durchschnittUm(s) + ueberSchnitt) continue;
    if (s - letzter < MIN_ABSTAND) continue;
    gefunden.push(stueckZuZeit(s));
    letzter = s;
  }
  einsaetze = gefunden;
}

function istHoechsteStelle(s) {
  const von = Math.max(0, s - MAX_UMGEBUNG);
  const bis = Math.min(flux.length - 1, s + MAX_UMGEBUNG);
  for (let i = von; i <= bis; i++) {
    if (flux[i] > flux[s]) return false;
  }
  return true;
}

function durchschnittUm(s) {
  const von = Math.max(0, s - SCHNITT_UMGEBUNG);
  const bis = Math.min(flux.length - 1, s + SCHNITT_UMGEBUNG);
  let summe = 0;
  for (let i = von; i <= bis; i++) summe += flux[i];
  return summe / (bis - von + 1);
}

const FLUX_ANTEIL = 0.15; // so viel der Höhe bekommt Flux-Kurve unten
const EINSATZ_FARBE = "rgba(120, 220, 255, 0.55)";

export function zeichneEinsaetze(c, links, oben, breite, hoehe, zeitZuX, strich) {
  if (!flux) return;
  const unten = oben + hoehe;
  const kurve = hoehe * FLUX_ANTEIL;

  // Flux-Kurve unten, wie das Spektrum: ein Pfad, einmal gefüllt
  c.beginPath();
  c.moveTo(links, unten);
  for (let s = 0; s < flux.length; s++) {
    c.lineTo(links + zeitZuX(stueckZuZeit(s)), unten - flux[s] * kurve);
  }
  c.lineTo(links + breite, unten);
  c.closePath();
  c.fillStyle = "rgba(221, 221, 221, 0.35)";
  c.fill();

  // jeder Einsatz ein dünner Strich über die ganze Höhe
  c.fillStyle = EINSATZ_FARBE;
  for (const t of einsaetze) {
    c.fillRect(Math.round(links + zeitZuX(t)), oben, strich, hoehe);
  }
}
