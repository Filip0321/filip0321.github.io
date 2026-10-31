import { canvas, einsaetzeZeigen, ctx, ansicht, spieler, minDb, maxDb, LESEKOPF_FARBE, lesekopfBreite } from "./seite.js";
import { farbenZahlen } from "/lib/farben.js";
import { ZEILEN, gesamtDb, gesamtStuecke, zeitZuSpalte, spalteZuZeit } from "./datei.js";
import { zeichneEinsaetze } from "./einsaetze.js";
import { zeichneTakt } from "./tempo.js";
import { exportBereich, setzeBereich } from "./bereich.js";

const taktZeigen = hole("taktZeigen");

let farbenVeraltet = true; 
const gesamtBild = document.createElement("canvas"); // nicht im HTML, nur im Speicher
const gesamtCtx = gesamtBild.getContext("2d");

export function markiereFarbenVeraltet() {
  farbenVeraltet = true;
}

// das Gesamtbild mit aktuellen Farben (für die Anzeige und den PNG-Export)
export function fertigesGesamtBild() {
  if (farbenVeraltet) {
    maleGesamt();
    farbenVeraltet = false;
  }
  return gesamtBild;
}

function maleGesamt() {
  gesamtBild.width = gesamtStuecke;
  gesamtBild.height = ZEILEN;
  const bild = gesamtCtx.createImageData(gesamtStuecke, ZEILEN);
  const pixel = bild.data;
  const min = Number(minDb.value);
  const spanne = Number(maxDb.value) - min;
  for (let s = 0; s < gesamtStuecke; s++) {
    for (let y = 0; y < ZEILEN; y++) {
      const anteil = (gesamtDb[s * ZEILEN + y] - min) / spanne; 
      const wert = Math.round(Math.min(1, Math.max(0, anteil)) * 255);
      // gesamtDb liegt Spalte für Spalte, ImageData Zeile für Zeile
      const p = (y * gesamtStuecke + s) * 4;
      const f = wert * 3;
      pixel[p] = farbenZahlen[f];
      pixel[p + 1] = farbenZahlen[f + 1];
      pixel[p + 2] = farbenZahlen[f + 2];
      pixel[p + 3] = 255;
    }
  }
  gesamtCtx.putImageData(bild, 0, 0);
}

// Gesamtbild auf den sichtbaren Canvas strecken
export function zeigeGesamt() {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!gesamtDb) return; // noch keine Datei
  fertigesGesamtBild(); // Farben auf den neuesten Stand
  ctx.imageSmoothingEnabled = true; // beim Strecken zwischen den Pixeln weich mischen
  // nur der sichtbare Ausschnitt (Zoom): drawImage(quelle, qx, qy, qBreite, qHoehe, zx, zy, zBreite, zHoehe)
  const von = sichtVon * gesamtStuecke;
  const breite = (sichtBis - sichtVon) * gesamtStuecke;
  ctx.drawImage(gesamtBild, von, 0, breite, ZEILEN, 0, 0, canvas.width, canvas.height);
  if (taktZeigen.checked) {
    zeichneTakt(ctx, 0, 0, canvas.width, canvas.height, zeitZuX, lesekopfBreite());
  }
  if (einsaetzeZeigen.checked) {
    zeichneEinsaetze(ctx, 0, 0, canvas.width, canvas.height, zeitZuX, lesekopfBreite());
  }
  zeichneBereich();
  zeichneKopf();
}

// Exportbereich: alles außerhalb abdunkeln, an den Grenzen ein Strich
function zeichneBereich() {
  const { von, bis, ganz } = exportBereich();
  if (ganz) return;
  const x1 = zeitZuX(von);
  const x2 = zeitZuX(bis);
  ctx.fillStyle = "rgba(17, 17, 17, 0.7)"; // --bg, halb durchsichtig
  ctx.fillRect(0, 0, Math.max(0, x1), canvas.height);
  ctx.fillRect(x2, 0, Math.max(0, canvas.width - x2), canvas.height);
  ctx.fillStyle = LESEKOPF_FARBE;
  ctx.fillRect(Math.round(x1), 0, lesekopfBreite(), canvas.height);
  ctx.fillRect(Math.round(x2), 0, lesekopfBreite(), canvas.height);
}

einsaetzeZeigen.addEventListener("change", () => {
  if (ansicht.value === "aufnahme") zeigeGesamt();
});
taktZeigen.addEventListener("change", () => {
  if (ansicht.value === "aufnahme") zeigeGesamt();
});

// Zoom
//------------------------------------------------------
let sichtVon = 0;
let sichtBis = 1;
const MIN_SICHT = 0.005; // höchstens 200-fach vergrößert

export function zeigeAlles() {
  sichtVon = 0;
  sichtBis = 1;
}

// Mausrad: um die Stelle unter dem Mauszeiger herum vergrößern oder verkleinern
canvas.addEventListener(
  "wheel",
  (event) => {
    if (ansicht.value !== "aufnahme" || !gesamtDb) return;
    event.preventDefault(); // nicht die Seite scrollen
    const rahmen = canvas.getBoundingClientRect();
    const anteilImBild = (event.clientX - rahmen.left) / rahmen.width; // 0 links, 1 rechts
    const breite = sichtBis - sichtVon;
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      // Shift + Rad oder seitlich wischen: verschieben statt zoomen
      verschiebeSicht(((event.deltaX || event.deltaY) / rahmen.width) * breite);
    } else {
      // Rad runter = weiter weg
      const faktor = Math.exp(event.deltaY * 0.002);
      const neueBreite = Math.min(1, Math.max(MIN_SICHT, breite * faktor));
      const stelle = sichtVon + anteilImBild * breite; // diese Stelle soll unter der Maus bleiben
      sichtVon = stelle - anteilImBild * neueBreite;
      sichtBis = sichtVon + neueBreite;
      verschiebeSicht(0); // an den Rändern festhalten
    }
    zeigeGesamt();
  },
  { passive: false }, // sonst nicht preventDefault
);

// Doppelklick: wieder alles zeigen
canvas.addEventListener("dblclick", () => {
  if (ansicht.value !== "aufnahme") return;
  zeigeAlles();
  zeigeGesamt();
});

// Ausschnitt verschieben, ohne über Anfang oder Ende hinaus
function verschiebeSicht(um) {
  const breite = sichtBis - sichtVon;
  sichtVon = Math.min(Math.max(sichtVon + um, 0), 1 - breite);
  sichtBis = sichtVon + breite;
}
//------------------------------------------------------

// Abspielkopf
//------------------------------------------------------
// Zeit und Bild passen nicht 1:1 zusammen, (zeitZuSpalte in datei.js)
// Sekunden -> x auf sichtbaren Canvas (nur der Ausschnitt sichtVon bis sichtBis ist gestreckt)
export function zeitZuX(sekunden) {
  const anteil = zeitZuSpalte(sekunden) / gesamtStuecke;
  return ((anteil - sichtVon) / (sichtBis - sichtVon)) * canvas.width;
}

// Umkehrung: Stelle im Bild -> Sekunden
export function xZuZeit(x) {
  const anteil = sichtVon + (x / canvas.width) * (sichtBis - sichtVon);
  return spalteZuZeit(anteil * gesamtStuecke);
}

function zeichneKopf() {
  const x = Math.round(zeitZuX(spieler.currentTime));
  const breite = lesekopfBreite();
  // ganz am Anfang und Ende liegt die Zeit vor der ersten bzw. hinter der letzten Stückmitte
  const xImBild = Math.min(Math.max(x, 0), canvas.width - breite);
  ctx.fillStyle = LESEKOPF_FARBE;
  ctx.fillRect(xImBild, 0, breite, canvas.height);
}

let kopfId = null;
function laufeKopf() {
  if (ansicht.value === "aufnahme") {
    folgeKopf();
    zeigeGesamt();
  }
  kopfId = requestAnimationFrame(laufeKopf);
}
function stoppeKopf() {
  cancelAnimationFrame(kopfId);
  kopfId = null;
  if (ansicht.value === "aufnahme") zeigeGesamt(); 
}

// beim Abspielen mit Zoom: läuft der Kopf aus dem Ausschnitt, eine Seite weiterblättern
function folgeKopf() {
  if (sichtBis - sichtVon >= 1) return; // nicht gezoomt
  const x = zeitZuX(spieler.currentTime);
  if (x > canvas.width || x < 0) {
    const anteil = zeitZuSpalte(spieler.currentTime) / gesamtStuecke;
    verschiebeSicht(anteil - sichtVon - 0.05 * (sichtBis - sichtVon)); // Kopf dann kurz hinter dem linken Rand
  }
}

spieler.addEventListener("play", () => {
  if (kopfId === null) laufeKopf(); // nicht zweimal starten
});
spieler.addEventListener("pause", stoppeKopf); // auch am Ende der Datei
// gesprungen (über die Leiste des <audio> oder per Klick ins Bild): auch in der Pause neu zeichnen
spieler.addEventListener("seeked", () => {
  if (ansicht.value === "aufnahme") zeigeGesamt();
});

// Klicken oder Ziehen im Bild springt an diese Stelle (scrubben)
// Zeit an der Stelle des Zeigers
function zeitBeiZeiger(event) {
  const rahmen = canvas.getBoundingClientRect(); // Lage und Größe in CSS-Pixeln
  const x = (event.clientX - rahmen.left) * (canvas.width / rahmen.width); // in Canvas-Pixel umrechnen
  const ende = Number.isFinite(spieler.duration) ? spieler.duration : 0; // vor dem Laden ist duration NaN
  return Math.min(Math.max(xZuZeit(x), 0), ende);
}

// Klicken oder Ziehen im Bild springt an diese Stelle (scrubben),
// mit gedrückter Alt-Taste wird stattdessen der Exportbereich aufgezogen
let bereichStart = null; // Zeit, an der das Ziehen mit Alt angefangen hat, sonst null

canvas.addEventListener("pointerdown", (event) => {
  if (ansicht.value !== "aufnahme" || !gesamtDb) return;
  canvas.setPointerCapture(event.pointerId); // weiterziehen geht auch über den Rand hinaus
  if (event.altKey) {
    bereichStart = zeitBeiZeiger(event);
  } else {
    bereichStart = null;
    spieler.currentTime = zeitBeiZeiger(event);
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (!canvas.hasPointerCapture(event.pointerId)) return;
  if (bereichStart === null) {
    spieler.currentTime = zeitBeiZeiger(event);
  } else {
    setzeBereich(bereichStart, zeitBeiZeiger(event));
    zeigeGesamt();
  }
});
