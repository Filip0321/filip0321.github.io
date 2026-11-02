// Auswahl: ein Rechteck auf der Leinwand (Zeit × Frequenz), dessen Inhalt man verschieben, kopieren
// oder still machen kann. Reine Rechnung auf den Feldern einer Ebene (Malschicht oder Ton-Ebene).
//
// Waagerecht verschieben ist einfach: Spalten umkopieren.
// Senkrecht verschieben heißt im logarithmischen Bild: alle Frequenzen mal denselben Faktor
// (eine Oktave höher = mal 2). Fach k wandert also nach k · faktor, nicht nach k + Abstand.
// Dazwischen liegende Fächer werden aus den beiden Nachbarn gemischt.
// Bei einer Ton-Ebene muss die Phase mit: dreh ist die Frequenz, also dreht sich ein Ton, der eine
// Oktave höher liegt, auch doppelt so schnell (dreh · faktor). Das ist der Phasen-Vocoder.
//
// Wohin verschoben wird, gewinnt das Lautere: Verschobenes deckt nichts zu, was lauter war
// (wie beim Malen, das nie leiser macht).

import { amplitude } from "./ebenen.js";
import { drehGanz, umEins } from "./ton-analyse.js";

const ZWEI_PI = 2 * Math.PI;

// die Felder, die zu einer Ebene gehören (alle Spalte für Spalte)
export function felderVon(ebene) {
  return ebene.art === "ton" ? ["betrag", "phase", "dreh", "maske"] : ["werte"];
}

// Spaltenzahl einer Ebene und wo sie auf der Leinwand anfängt
function lage(ebene, leinwand) {
  return ebene.art === "ton" ? { start: ebene.start, spalten: ebene.spalten } : { start: 0, spalten: leinwand.spalten };
}

// Auswahl { von, bis (Spalten der Leinwand, beide mit), unten, oben (Hz) } in Spalten der Ebene und Fächern
function bereich(ebene, auswahl, leinwand) {
  const { start, spalten } = lage(ebene, leinwand);
  const von = Math.max(auswahl.von - start, 0);
  const bis = Math.min(auswahl.bis - start, spalten - 1);
  const kVon = Math.max(Math.ceil(auswahl.unten / leinwand.fachBreite), 1);
  const kBis = Math.min(Math.floor(auswahl.oben / leinwand.fachBreite), leinwand.faecher - 2);
  if (von > bis || kVon > kBis) return null;
  return { von, bis, kVon, kBis, spalten };
}

// welche Spalten der Ebene sich beim Verschieben um d Spalten ändern können [von, bis] oder null
// (vorher merken für Rückgängig)
export function betroffen(ebene, auswahl, d, leinwand) {
  const b = bereich(ebene, auswahl, leinwand);
  if (!b) return null;
  return [Math.max(Math.min(b.von, b.von + d), 0), Math.min(Math.max(b.bis, b.bis + d), b.spalten - 1)];
}

// Gemalte Maske einer Ton-Ebene in der Auswahl in den Betrag einrechnen (Maske danach 1),
// damit Verschobenes so klingt wie vorher, auch ohne seine Maske
function maskeEinrechnen(ebene, b, faecher, tabelle) {
  for (let s = b.von; s <= b.bis; s++) {
    for (let k = b.kVon; k <= b.kBis; k++) {
      const i = s * faecher + k;
      ebene.betrag[i] *= amplitude(tabelle, ebene.maske[i]);
      ebene.maske[i] = 1;
    }
  }
}

// verschieben (oder kopieren) um d Spalten und mal faktor in der Frequenz
export function verschiebe(ebene, auswahl, { d, faktor, kopie }, leinwand, tabelle) {
  const b = bereich(ebene, auswahl, leinwand);
  if (!b) return;
  const { faecher } = leinwand;
  const ton = ebene.art === "ton";
  if (ton) maskeEinrechnen(ebene, b, faecher, tabelle);
  const felder = ton ? ["betrag", "phase", "dreh"] : ["werte"];
  const laut = ton ? "betrag" : "werte"; // daran wird gemessen, was lauter ist

  // 1. Inhalt der Auswahl herausnehmen (Kopie), ohne Kopieren an der alten Stelle Stille
  const breite = b.bis - b.von + 1;
  const hoehe = b.kBis - b.kVon + 1;
  const stueck = {};
  for (const feld of felder) {
    stueck[feld] = new Float32Array(breite * hoehe);
    for (let s = 0; s < breite; s++) {
      for (let k = 0; k < hoehe; k++) stueck[feld][s * hoehe + k] = ebene[feld][(b.von + s) * faecher + b.kVon + k];
    }
  }
  if (!kopie) {
    for (let s = b.von; s <= b.bis; s++) ebene[laut].fill(0, s * faecher + b.kVon, s * faecher + b.kBis + 1);
  }

  // 2. an der neuen Stelle einsetzen: Ziel-Fach k' holt sich seinen Inhalt von q = k' / faktor
  const zielVon = Math.max(Math.ceil(b.kVon * faktor), 1);
  const zielBis = Math.min(Math.floor(b.kBis * faktor), faecher - 2);
  for (let s = 0; s < breite; s++) {
    const ziel = b.von + s + d;
    if (ziel < 0 || ziel >= b.spalten) continue;
    for (let k2 = zielVon; k2 <= zielBis; k2++) {
      const q = Math.min(Math.max(k2 / faktor - b.kVon, 0), hoehe - 1); // Stelle im Stück, mit Komma
      const q0 = Math.floor(q);
      const q1 = Math.min(q0 + 1, hoehe - 1);
      const a = q - q0;
      const wert = stueck[laut][s * hoehe + q0] * (1 - a) + stueck[laut][s * hoehe + q1] * a;
      const i = ziel * faecher + k2;
      if (wert <= ebene[laut][i]) continue; // dort ist es schon lauter
      ebene[laut][i] = wert;
      if (!ton) continue;
      // Phasen-Vocoder: Frequenz (dreh) und Phase mal faktor, vom näheren der beiden Nachbarn
      const nah = a < 0.5 ? q0 : q1;
      const n = s * hoehe + nah;
      ebene.dreh[i] = umEins(drehGanz(stueck.dreh[n], b.kVon + nah, leinwand) * faktor);
      const phi = stueck.phase[n] * faktor;
      ebene.phase[i] = phi - ZWEI_PI * Math.floor(phi / ZWEI_PI);
      ebene.maske[i] = 1;
    }
  }
}

// Inhalt der Auswahl still machen
export function stille(ebene, auswahl, leinwand) {
  const b = bereich(ebene, auswahl, leinwand);
  if (!b) return;
  const feld = ebene.art === "ton" ? "betrag" : "werte";
  for (let s = b.von; s <= b.bis; s++) {
    ebene[feld].fill(0, s * leinwand.faecher + b.kVon, s * leinwand.faecher + b.kBis + 1);
  }
}
