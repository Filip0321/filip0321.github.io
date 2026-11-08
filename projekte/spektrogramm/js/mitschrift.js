// Mitschreiben: beim Abhören entsteht ein Gesamtbild Spalte für Spalte aus dem, was das Live-Bild gerade zeigt,
// also mit den Einstellungen des Moments: Farben, Glättung, FFT-Größe, Schwarz- und Weißpunkt. Wer beim Hören an
// den Reglern dreht, malt damit. Wer spult, überschreibt; rückwärts hören schreibt rückwärts. Jeder Durchgang ergibt
// ein anderes Bild.
//
// Die Mitschrift hat genau die Maße des Gesamtbilds (eine Spalte pro Stück, ZEILEN hoch, dieselbe
// Frequenz-Achse), darum gehen Bild und Video speichern mit Achsen, Bereich und „aufbauen“ ohne Extra-Code:
// png-export.js nimmt statt des Gesamtbilds einfach dieses Bild.

import { analyser, audio } from "./audio.js";
import { fachTabelle } from "./frequenzen.js";
import { farbenZahlen } from "/lib/farben.js";
import { ZEILEN, gesamtStuecke, zeitZuSpalte } from "./datei.js";
import { spieler, wiedergabe, canvas, ctx, LESEKOPF_FARBE, lesekopfBreite } from "./seite.js";

export const mitschreiben = hole("mitschreiben");
const bild = document.createElement("canvas"); // nur im Speicher
const bctx = bild.getContext("2d");
let spalte = null; // eine Spalte, ZEILEN hoch
let tabelle = null; // [von, bis] Fach je Zeile, für die aktuelle FFT-Größe
let tabelleFuer = 0; // fftSize, für die die Tabelle gilt
let letzte = -1; // die zuletzt geschriebene Spalte
let geschrieben = 0; // wie viele Spalten etwas haben (für die Anzeige)

// passt die Mitschrift zur geladenen Datei? Sonst neu und leer
function richteEin() {
  if (bild.width === gesamtStuecke && bild.height === ZEILEN) return;
  bild.width = Math.max(1, gesamtStuecke);
  bild.height = ZEILEN;
  leereMitschrift();
}

export function leereMitschrift() {
  bctx.fillStyle = "#111111";
  bctx.fillRect(0, 0, bild.width, bild.height);
  letzte = -1;
  geschrieben = 0;
}

export function mitschriftBild() {
  richteEin();
  return bild;
}
export const hatMitschrift = () => geschrieben > 0;

// aus live.js in jedem Bild, mit den Lautstärken (0–255), die das Live-Bild gerade zeichnet
export function schreibeMit(werte) {
  if (!mitschreiben.checked || !gesamtStuecke || spieler.paused) {
    letzte = -1; // nach einer Pause kein Lückenfüllen über die Pause hinweg
    return;
  }
  richteEin();
  if (tabelleFuer !== analyser.fftSize || !spalte) {
    tabelle = fachTabelle(ZEILEN, audio.sampleRate / analyser.fftSize, werte.length - 1, true);
    tabelleFuer = analyser.fftSize;
    spalte = bctx.createImageData(1, ZEILEN);
  }
  const [von, bis] = tabelle;
  const pixel = spalte.data;
  for (let y = 0; y < ZEILEN; y++) {
    let wert = 0;
    for (let i = von[y]; i <= bis[y]; i++) if (werte[i] > wert) wert = werte[i];
    const f = wert * 3;
    pixel.set([farbenZahlen[f], farbenZahlen[f + 1], farbenZahlen[f + 2], 255], y * 4);
  }
  const jetzt = Math.max(0, Math.min(gesamtStuecke - 1, Math.floor(zeitZuSpalte(wiedergabe.zeit()))));
  // bei 60 Bildern pro Sekunde und etwa 47 Stücken pro Sekunde liegen meist 0 oder 1 Spalten dazwischen:
  // die Lücke mit derselben Spalte füllen. Ein großer Sprung ist Spulen, dann nur die Stelle selbst
  const abstand = letzte < 0 ? 0 : jetzt - letzte;
  const schritte = Math.abs(abstand) <= 8 ? Math.abs(abstand) : 0;
  const richtung = Math.sign(abstand);
  for (let k = 0; k <= schritte; k++) bctx.putImageData(spalte, jetzt - k * richtung, 0);
  geschrieben += schritte + 1;
  letzte = jetzt;
}

// die Ansicht „Mitschrift“: das Bild über die ganze Fläche, der Strich steht da, wo gerade geschrieben wird
export function zeigeMitschrift() {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!gesamtStuecke) return;
  richteEin();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bild, 0, 0, canvas.width, canvas.height);
  const x = (zeitZuSpalte(wiedergabe.zeit()) / gesamtStuecke) * canvas.width;
  ctx.fillStyle = LESEKOPF_FARBE;
  ctx.fillRect(Math.round(x), 0, lesekopfBreite(), canvas.height);
}

// Mitschreiben braucht das laufende Live-Bild: wer mit dem Häkchen auf Abspielen drückt, ohne vorher Start zu
// drücken, bekommt es von selbst (derselbe Knopf, damit Ton und Anzeige wie sonst eingerichtet werden)
spieler.addEventListener("play", () => {
  const start = hole("startBtn");
  if (mitschreiben.checked && start.textContent.trim() === "Start") start.click();
});

hole("mitschriftLeeren").addEventListener("click", () => {
  richteEin();
  leereMitschrift();
});
