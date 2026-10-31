import { canvas, ansicht, minDb, maxDb, zeigeMeldung, LESEKOPF_FARBE } from "./seite.js";
import { SKALA, frequenzZuAnteil, beschriftung } from "./frequenzen.js";
import { FENSTER } from "/lib/fft.js";
import { ANALYSE_RATE, SPRUNG, ZEILEN, dateiName, gesamtDb, gesamtStuecke, zeitZuSpalte } from "./datei.js";
import { fertigesGesamtBild } from "./gesamtbild.js";
import { exportBereich, setzeBereich, loescheBereich } from "./bereich.js";
import { originalTon } from "./datei.js";
import { zeichneEinsaetze } from "./einsaetze.js";
import { zeichneTakt } from "./tempo.js";
import { speichereCanvas, zeitstempel } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";

export const mitAchsen = hole("mitAchsen"); 
const bildSpeichern = hole("bildSpeichern");
const exportBreite = hole("exportBreite"); // "anzeige" oder "voll"
const mitEinsaetzen = hole("mitEinsaetzen"); // Häkchen: Einsätze und Flux-Kurve ins PNG
const mitTakt = hole("mitTakt"); // Häkchen: Taktraster ins PNG

const RAND_LINKS = 56; // Platz für die Frequenzen
const RAND_UNTEN = 32; // Platz für die Zeit
const RAND_OBEN = 28; // Platz für die Infozeile
const MIN_BREITE = 1000; // "voll": kurze Aufnahmen werden auf mindestens so viele Pixel vergrößert
const STANDARD_VERHAELTNIS = 2; // Breite / Höhe, wenn gerade eine andere Ansicht zu sehen ist

function zeigeZeit(sekunden, schritt) {
  const m = Math.floor(sekunden / 60);
  const rest = sekunden - m * 60;
  const s = schritt < 1 ? rest.toFixed(1).replace(".", ",") : String(Math.round(rest));
  return `${m}:${s.padStart(schritt < 1 ? 4 : 2, "0")}`;
}

function zeitSchritt(pixelProSekunde) {
  const RUND = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return RUND.find((s) => s * pixelProSekunde >= 80) ?? 600;
}

// spalten: wie viele Stücke im Exportbereich liegen
function bildBreite(breiteArt, spalten) {
  if (breiteArt === "voll") {
    // eine Spalte pro Stück (21 ms)
    // Format nach Länge (22 s ist es quadratisch, bei 3 min achtmal so breit wie hoch)
    // ganze Zahl, damit jede Spalte gleich breit
    const faktor = Math.max(1, Math.ceil(MIN_BREITE / spalten));
    return spalten * faktor;
  }
  // "wie angezeigt" - dasselbe Seitenverhältnis wie der Canvas bei "Ganze Aufnahme"
  const verhaeltnis =
    ansicht.value === "aufnahme" ? canvas.clientWidth / canvas.clientHeight : STANDARD_VERHAELTNIS;
  return Math.round(ZEILEN * verhaeltnis);
}

// bereich: { von, bis, ganz } in Sekunden; ohne Angabe der Exportbereich aus dem Bedienfeld
export function baueExport(achsen, breiteArt = exportBreite.value, bereich = exportBereich()) {
  // Exportbereich -> Spalten des Gesamtbilds: alle Stücke, deren Mitte im Bereich liegt
  const { von, bis, ganz } = bereich;
  const ersteSpalte = Math.max(0, Math.ceil(zeitZuSpalte(von) - 0.5));
  const letzteSpalte = Math.min(gesamtStuecke - 1, Math.floor(zeitZuSpalte(bis) - 0.5));
  const spalten = Math.max(1, letzteSpalte - ersteSpalte + 1);

  const breite = bildBreite(breiteArt, spalten);
  const spaltenBreite = breite / spalten; // Pixel pro Stück, kann auch 0,3 oder 1,7 sein
  const links = achsen ? RAND_LINKS : 0;
  const oben = achsen ? RAND_OBEN : 0;
  const unten = achsen ? RAND_UNTEN : 0;

  const bild = document.createElement("canvas");
  bild.width = breite + links;
  bild.height = ZEILEN + oben + unten;
  const c = bild.getContext("2d");
  c.fillStyle = "#111111";
  c.fillRect(0, 0, bild.width, bild.height);
  c.imageSmoothingEnabled = !Number.isInteger(spaltenBreite);
  // nur die Spalten des Bereichs: drawImage(quelle, qx, qy, qBreite, qHoehe, zx, zy, zBreite, zHoehe)
  c.drawImage(fertigesGesamtBild(), ersteSpalte, 0, spalten, ZEILEN, links, oben, breite, ZEILEN);
  // Sekunden -> x im Gesamtbild (ohne den Rand links), ab der ersten Spalte des Bereichs
  const zeitZuX = (t) => (zeitZuSpalte(t) - ersteSpalte) * spaltenBreite;
  const ergebnis = { bild, links, oben, breite, hoehe: ZEILEN, zeitZuX, von, bis };

  // Takt und Einsätze nur im Bildbereich: clip schneidet alles ab, was außerhalb landet
  // (Striche vor dem Bereich lägen sonst über der Frequenz-Beschriftung)
  c.save();
  c.beginPath();
  c.rect(links, oben, breite, ZEILEN);
  c.clip();
  if (mitTakt.checked) zeichneTakt(c, links, oben, breite, ZEILEN, zeitZuX, 2);
  if (mitEinsaetzen.checked) zeichneEinsaetze(c, links, oben, breite, ZEILEN, zeitZuX, 2);
  c.restore(); // clip wieder aufheben
  if (!achsen) return ergebnis;

  c.font = "14px monospace";
  c.fillStyle = "#dddddd";

  c.textAlign = "right";
  c.textBaseline = "middle";
  for (const f of SKALA) {
    const y = Math.round(oben + ZEILEN * (1 - frequenzZuAnteil(f)));
    c.fillRect(links - 6, y, 6, 1); // kleiner Strich an der Kante
    c.fillText(beschriftung(f), links - 10, y);
  }

  // Zeit unten
  const pixelProSekunde = (ANALYSE_RATE / SPRUNG) * spaltenBreite; 
  const schritt = zeitSchritt(pixelProSekunde);
  c.textAlign = "center";
  c.textBaseline = "top";
  // n zählt statt t += schritt: 0,1 + 0,1 + 0,1 ergibt sonst 0,30000000000000004.
  // Beim Bereich die erste runde Zeit ab "von" (bei Schritt 2 und von 3,3: 4)
  for (let n = Math.ceil(von / schritt - 1e-9); n * schritt <= bis; n++) {
    const t = n * schritt;
    const x = Math.round(links + Math.max(0, zeitZuX(t)));
    if (x > bild.width - 24) break; // Beschriftung würde rechts abgeschnitten
    c.fillRect(x, oben + ZEILEN, 1, 6);
    c.fillText(zeigeZeit(t, schritt), x, oben + ZEILEN + 10);
  }

  c.textAlign = "left";
  c.textBaseline = "middle";
  c.fillText(
    `${dateiName}${ganz ? "" : ` | ${zeigeZeit(von, 0.1)} bis ${zeigeZeit(bis, 0.1)}`} | ` +
      `Schwarzpunkt ${minDb.value} dB | Weißpunkt ${maxDb.value} dB | Fenster ${FENSTER}`,
    links,
    oben / 2,
  );
  return ergebnis;
}

const KOPF_BREITE = 3; // Pixel im Video

// Ein Bild des Videos: der Strich steht bei zeitImTon (Sekunden in der Datei).
// "aufbauen": das Spektrogramm ist nur zu sehen, wo der Strich schon war (rückwärts: rechts von ihm);
// die Achsen bleiben stehen. Auch die Vorschau im Export-Fenster zeichnet so.
export function zeichneVideoBild(c, exp, zeitImTon, { ablauf, rueckwaerts }) {
  const { bild, links, oben, breite, hoehe, zeitZuX } = exp;
  c.drawImage(bild, 0, 0);
  // ganz am Anfang und Ende liegt die Zeit vor der ersten bzw. hinter der letzten Stückmitte
  const x = Math.min(Math.max(Math.round(links + zeitZuX(zeitImTon)), links), links + breite - KOPF_BREITE);
  if (ablauf === "aufbauen") {
    c.fillStyle = "#111111"; // wie der Hintergrund in baueExport
    if (rueckwaerts) c.fillRect(links, oben, x - links, hoehe);
    else c.fillRect(x + KOPF_BREITE, oben, links + breite - x - KOPF_BREITE, hoehe);
  }
  c.fillStyle = LESEKOPF_FARBE;
  c.fillRect(x, oben, KOPF_BREITE, hoehe);
}

// eigene Felder im Export-Fenster, nur beim Video: wie das Bild entsteht und in welche Richtung
const felder = document.createElement("div");
felder.className = "steuerung nur-video";
felder.innerHTML = `
  <label>Ablauf
    <select name="ablauf">
      <option value="lesekopf">Lesekopf darüber</option>
      <option value="aufbauen">aufbauen (entsteht bis zum Strich)</option>
    </select>
  </label>
  <label><input type="checkbox" name="rueckwaerts"> rückwärts</label>`;
const videoArt = () => ({
  ablauf: felder.querySelector("[name=ablauf]").value,
  rueckwaerts: felder.querySelector("[name=rueckwaerts]").checked,
});

// Export-Fenster: Rahmen, Format, Größe; beim Video Zeitleiste und Bereich über die ganze Datei
// (der Bereich ist derselbe wie von/bis im Bedienfeld: er wird beim Öffnen übernommen und beim Speichern zurückgeschrieben)
// Achsen und Breite bleiben im Bedienfeld. Beim Video ist die Breite immer "wie angezeigt" (H.264 schafft etwa 4096 Pixel)
let exportArt = "bild";
const exportFenster = erstelleExportDialog({
  felder,
  zeichneVorschau: (allgemein, zeit) => {
    if (exportArt === "bild") return mitRahmen(baueExport(mitAchsen.checked).bild, allgemein);
    const dauer = originalTon.duration;
    const exp = baueExport(mitAchsen.checked, "anzeige", { von: 0, bis: dauer, ganz: true }); // die ganze Datei
    const bild = document.createElement("canvas");
    bild.width = exp.bild.width;
    bild.height = exp.bild.height;
    zeichneVideoBild(bild.getContext("2d"), exp, (zeit ?? 0) * dauer, videoArt());
    return mitRahmen(bild, allgemein);
  },
});

// öffnet das Fenster; ergibt die Einstellungen (beim Video mit ablauf und rueckwaerts) oder null (abgebrochen)
export async function frageExport(art) {
  exportArt = art;
  if (art === "bild") return exportFenster.oeffne({ art, ueberschrift: "Bild speichern" });
  const dauer = originalTon.duration;
  const { von, bis } = exportBereich();
  const einst = await exportFenster.oeffne({
    art,
    ueberschrift: "Video speichern",
    laenge: dauer,
    bereichStart: [von / dauer, bis / dauer],
  });
  if (!einst) return null;
  // Bereich aus dem Fenster ins Bedienfeld: dort gilt er auch für Bild und Ton
  if (einst.von === 0 && einst.bis === 1) loescheBereich();
  else setzeBereich(einst.von * dauer, einst.bis * dauer);
  return { ...einst, ...videoArt() };
}

bildSpeichern.addEventListener("click", async () => {
  zeigeMeldung("");
  if (!gesamtDb) {
    zeigeMeldung("Erst eine Datei laden.");
    return;
  }
  if (exportBereich().zuKurz) {
    zeigeMeldung("Der Bereich ist zu kurz.");
    return;
  }
  const einst = await frageExport("bild");
  if (!einst) return; // abgebrochen
  try {
    await speichereCanvas(mitRahmen(baueExport(mitAchsen.checked).bild, einst), einst.bildTyp, `${dateiName}-spektrogramm-${zeitstempel()}`);
  } catch (fehler) {
    zeigeMeldung(fehler.message);
  }
});
