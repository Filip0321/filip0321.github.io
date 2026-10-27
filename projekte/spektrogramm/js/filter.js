import { anteilZuFrequenz, zeigeFrequenz } from "./frequenzen.js"
import { haltePaar } from "/lib/knopfregler.js"

export const tiefen = hole("tiefen");
const tiefenAnzeige = hole("tiefenAnzeige");
export const hoehen = hole("hoehen");
const hoehenAnzeige = hole("hoehenAnzeige");
const hoeren = hole("hoeren"); // die Auswahl

const GRENZ_ABSTAND = 0.05;
// kleiner Abstand zwischen von Tiefen und Höhen Grenze

export let grenzeTief = 250;
export let grenzeHoch = 4000;

export function setzeGrenzen(gezogen) {
  const [unten, oben] = haltePaar(tiefen, hoehen, GRENZ_ABSTAND, gezogen);
  grenzeTief = anteilZuFrequenz(unten);
  grenzeHoch = anteilZuFrequenz(oben);
  tiefenAnzeige.textContent = zeigeFrequenz(grenzeTief);
  hoehenAnzeige.textContent = zeigeFrequenz(grenzeHoch);

  setzeFilter(); 
}

const GANZ_UNTEN = 10; // alles hörbare ab 20 Hz

const BUTTERWORTH_Q = -3.01;

let kontext = null;
let hochpaesse = [];
let tiefpaesse = [];

function baueFilter(typ) {
  const filter = kontext.createBiquadFilter();
  filter.type = typ;
  filter.Q.value = BUTTERWORTH_Q;
  return filter;
}

export function baueFilterKette(audio) {
  kontext = audio;
  hochpaesse = [baueFilter("highpass"), baueFilter("highpass")];
  tiefpaesse = [baueFilter("lowpass"), baueFilter("lowpass")];
  hochpaesse[0].connect(hochpaesse[1]).connect(tiefpaesse[0]).connect(tiefpaesse[1]);
  setzeFilter();
  return [hochpaesse[0], tiefpaesse[1]];
}

export function setzeFilter() {
  if (!hochpaesse.length) return;
  const ganzOben = kontext.sampleRate / 2; // (Nyquist) höchste mögliche Frequenz

  const EINSTELLUNGEN = {
    alles: [GANZ_UNTEN, ganzOben],
    tiefen: [GANZ_UNTEN, grenzeTief],
    mitten: [grenzeTief, grenzeHoch],
    hoehen: [grenzeHoch, ganzOben],
  };
  const [unten, oben] = EINSTELLUNGEN[hoeren.value];

  for (const filter of hochpaesse) filter.frequency.setTargetAtTime(unten, kontext.currentTime, 0.01);
  for (const filter of tiefpaesse) filter.frequency.setTargetAtTime(oben, kontext.currentTime, 0.01);
}

hoeren.addEventListener("change", setzeFilter);