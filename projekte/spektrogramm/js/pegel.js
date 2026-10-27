import { pegelMesser, pegelDaten } from "./audio.js";

const pegel = hole("pegel");
const pegelAnzeige = hole("pegelAnzeige");

let pegelStand = 0;
let spitzeDb = -Infinity;
let clipBis = 0;
let textZeit = 0;

const PEGEL_MIN = -60;
const PEGEL_FALL = 0.72;
const CLIP_GRENZE = 0.99;

export function zeichnePegel(zeit, sekunden) {
  pegelMesser.getFloatTimeDomainData(pegelDaten);

  let spitze = 0;
  // Spitzenwert in dem analysed Bereich
  for (const s of pegelDaten) {
    const betrag = Math.abs(s);
    if (betrag > spitze) spitze = betrag;
  }

  // Amplitude -> dB, Umkehrung von 10 ** (db / 20) bei der Lautstärke
  // log10(0) ist -Infinity
  const db = spitze > 0 ? 20 * Math.log10(spitze) : -Infinity;

  // zwischen -60 db und 0 db ist anteil zwischen 0 und 1
  const anteil = Math.min(1, Math.max(0, (db - PEGEL_MIN) / -PEGEL_MIN));
  pegelStand = Math.max(anteil, pegelStand - PEGEL_FALL * sekunden);
  pegel.style.setProperty("--pegel", pegelStand);

  if (spitze >= CLIP_GRENZE) clipBis = zeit + 1000; // eine Sekunde lang zeigen
  pegel.classList.toggle("clip", zeit < clipBis);

  // die Zahl nur ein paar Mal pro Sekunde, sonst flimmert sie unlesbar
  spitzeDb = Math.max(spitzeDb, db);
  if (zeit - textZeit > 150) {
    pegelAnzeige.textContent = spitzeDb > PEGEL_MIN ? `${Math.round(spitzeDb)} dB` : "–∞";
    pegel.setAttribute("aria-valuenow", String(Math.round(Math.max(spitzeDb, PEGEL_MIN))));
    spitzeDb = -Infinity;
    textZeit = zeit;
  }
}