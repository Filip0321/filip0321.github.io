import { flux, STUECKE_PRO_SEKUNDE, stueckZuZeit } from "./einsaetze.js";

const tempoAnzeige = hole("tempoBpm");

const MIN_BPM = 60;
const MAX_BPM = 200;
const BEVORZUGT_BPM = 120;

const OKTAVEN_BREITE = 1;
const SCHNITT_SEKUNDEN = 0.25;
const FEIN_SPANNE = 0.02;
const FEIN_SCHRITTE = 80;
const MIN_KLARHEIT = 1.3;

export let bpm = null;
export let schlaege = [];
let staerke = null;
let periode = null;

export function berechneTempo() {
  bpm = null;
  schlaege = [];
  periode = null;
  tempoAnzeige.textContent = "";
  if (!flux || flux.length < STUECKE_PRO_SEKUNDE * 4) return;
  
  staerke = ohneGrundrauschen(flux);
  // ist wo es es schläge gibt
  const n = staerke.length;

  const lagMin = Math.floor((60 / MAX_BPM) * STUECKE_PRO_SEKUNDE);
  const lagMax = Math.ceil((60 / MIN_BPM) * STUECKE_PRO_SEKUNDE);
  // Abstand zwischen Schlägen bei Min und Max BPM
  // Flux ist pro Stück
  const korrelation = new Float32Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let summe = 0;
    for (let s = 0; s + lag < n; s++) summe += staerke[s] * staerke[s + lag];
    korrelation[lag] = summe / (n - lag); // nur wenn es schläge in diesem Abstand gab speichern (sonst 0)
    // alle möglichen Werte durchgehen und speichern
  }

  let besterLag = lagMin;
  let besterWert = -Infinity;
  let summeWerte = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const lagBpm = (60 * STUECKE_PRO_SEKUNDE) / lag;
    const oktaven = Math.log2(lagBpm / BEVORZUGT_BPM); 
    // von bevorzugtem BPM schauen welcher Abstand näher dran
    // wenn zwei Abstände gleich kommen (beispiel aller 4 und 8)
    // bei allen anderen Abständen kommt 0 raus
    const wert = korrelation[lag] * Math.exp(-0.5 * (oktaven / OKTAVEN_BREITE) ** 2);
    summeWerte += wert;
    if (wert > besterWert) {
      besterWert = wert;
      besterLag = lag;
    }
  }
  const klarheit = besterWert / (summeWerte / (lagMax - lagMin + 1));
  // durchschnitt
  if (!(klarheit >= MIN_KLARHEIT)) {
    tempoAnzeige.textContent = "kein klares Tempo";
    return;
  }

  const links = korrelation[besterLag - 1];
  const mitte = korrelation[besterLag];
  const rechts = korrelation[besterLag + 1];
  const nenner = links - 2 * mitte + rechts;
  const versatz = nenner === 0 ? 0 : (0.5 * (links - rechts)) / nenner;
  // wo genau der schlag kommt
  const grobePeriode = besterLag + versatz;

  legeRasterAn(grobePeriode);
}

export function aendereTempo(faktor) {
  if (!periode) return; 
  legeRasterAn(periode / faktor);
}

function legeRasterAn(grobePeriode) {
  const n = staerke.length;
  let bestePeriode = grobePeriode;
  let besterStart = 0;
  let besteTreffer = -Infinity;
  for (let i = -FEIN_SCHRITTE / 2; i <= FEIN_SCHRITTE / 2; i++) {
    const versuch = grobePeriode * (1 + (FEIN_SPANNE * i) / (FEIN_SCHRITTE / 2));
    for (let start = 0; start < versuch; start++) {
      let treffer = 0;
      for (let s = start; s < n - 1; s += versuch) treffer += zwischen(staerke, s);
      if (treffer > besteTreffer) {
        besteTreffer = treffer;
        bestePeriode = versuch;
        besterStart = start;
      }
    }
  }

  periode = bestePeriode;
  bpm = (60 * STUECKE_PRO_SEKUNDE) / periode;
  schlaege = [];
  for (let s = besterStart; s < n; s += periode) schlaege.push(stueckZuZeit(s));
  tempoAnzeige.textContent = `${bpm.toFixed(1).replace(".", ",")} BPM`;
}

function ohneGrundrauschen(kurve) {
  const n = kurve.length;
  const summe = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) summe[i + 1] = summe[i] + kurve[i];
  const halb = Math.round((SCHNITT_SEKUNDEN / 2) * STUECKE_PRO_SEKUNDE);
  const ergebnis = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const von = Math.max(0, i - halb);
    const bis = Math.min(n, i + halb + 1);
    const schnitt = (summe[bis] - summe[von]) / (bis - von);
    ergebnis[i] = Math.max(0, kurve[i] - schnitt);
  }
  return ergebnis;
}

function zwischen(kurve, s) {
  const i = Math.floor(s);
  const t = s - i;
  return kurve[i] * (1 - t) + kurve[i + 1] * t;
}

const SCHLAG_FARBE = "rgba(255, 190, 90, 0.35)";
const TAKT_FARBE = "rgba(255, 190, 90, 0.8)";

export function zeichneTakt(c, links, oben, breite, hoehe, zeitZuX, strich) {
  for (let k = 0; k < schlaege.length; k++) {
    c.fillStyle = k % 4 === 0 ? TAKT_FARBE : SCHLAG_FARBE;
    c.fillRect(Math.round(links + zeitZuX(schlaege[k])), oben, strich, hoehe);
  }
}