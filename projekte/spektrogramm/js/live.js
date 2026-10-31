import { canvas, ctx, ansicht, glaettung, einsaetzeZeigen, LESEKOPF_FARBE, lesekopfBreite } from "./seite.js";
import { audio, analyser } from "./audio.js";
import { fachTabelle, anteilZuFrequenz } from "./frequenzen.js";
import { farbenZahlen, baueVerlauf } from "/lib/farben.js";
import { zeichnePegel } from "./pegel.js";
import { pruefeEinsatz, staerke } from "./einsaetze-live.js";

export const laufrichtung = hole("laufrichtung"); // schieben / umlaufen
export const spektrumOben = hole("spektrumOben"); 
const spektrumGlatt = hole("spektrumGlatt"); // Häkchen: Spektrum bei den Tiefen weich statt treppig
const tempo = hole("tempo"); 
const tempoAnzeige = hole("tempoAnzeige");
const einsatzLampe = hole("einsatzLampe"); // leuchtet bei jedem Einsatz

// Canvas bei Wasserfall und spektrum größer machen
const OBEN_ANTEIL = 0.2;
let oben = 0; // Höhe des Spektrum-Bereich, 0 = kein Spektrum

let werte = null; // Uint8Array für die Lautstärken
let laufId = null;
let verlauf = null; // Farbverlauf über die ganze Höhe (Spektrum allein)
let verlaufOben = null; // Farbverlauf nur über den Bereich oben (Spektrum über dem Wasserfall)

// Umlaufen: wo die nächste Spalte (Spektrogramm) bzw. Zeile (Wasserfall) hinkommt
let schreibPos = 0;

let vonFach = null; // erstes Fach jeder Pixelspalte (Spektrum)
let bisFach = null; // letztes Fach jeder Pixelspalte (Spektrum)
let vonFachZeile = null; // erstes Fach jeder Pixelzeile (Spektrogramm)
let bisFachZeile = null; // letztes Fach jeder Pixelzeile (Spektrogramm)
// jeweils um den lautesten Wert aller Fächer dazwischen zu berechnen und den für den Bereich auszugeben
let fachPos = null; // Spektrum glatt: genaue Fach-Position (mit Komma) der Mitte jeder Pixelspalte

// Einsatz in einem Bild, in dem keine neue Spalte dran war (langsames Tempo):
// merken und an die nächste Spalte malen, sonst ginge er verloren
let einsatzOffen = false;
const EINSATZ_FARBE = "rgba(120, 220, 255, 0.8)"; // wie im Gesamtbild

let spalte = null; // die neue Spalte im Spektrogramm, 1 Pixel breit
let zeile = null; // die neue Zeile im Wasserfall, 1 Pixel hoch

export function richteFaecherEin() {
  werte = new Uint8Array(analyser.frequencyBinCount);
  // Fach (Bin) ist ein Ergebnis der FFT, also ein Frequenzbereich (-band) mit seiner Lautstärke (0-255)
  // frequencyBinCount ist wie viele Fächer herauskommen (fftSize / 2)
  berechneTabellen();
}

// läuft, wenn sich Größe oder fftSize ändern, nicht in jedem Bild
export function berechneTabellen() {
  if (!analyser) return; // vor dem Start gibt es noch keine Fächer
  // Fächer sind gleich breit (linear): Fach i liegt bei i mal Fachbreite
  // sample rate ist wieviele samples pro sekunde gemessen werden (z. B. 48.000)
  // fftSize - Wie viele Samples die FFT auf einmal anschaut
  // beim Standard 16384 Samples, also 16384 / 48.000 = 0,34 s Ton (richtet sich nach dem Regler)
  // Die höchste Frequenz, die man überhaupt messen kann: sampleRate / 2 = 24.000 Hz (braucht berg und tal)
  // Fachbreite: Die 24.000 Hz bis zur Nyquist-Frequenz, verteilt auf fftSize / 2 Fächer
  // also (sampleRate / 2) / (fftSize / 2) = sampleRate / fftSize
  const fachbreite = audio.sampleRate / analyser.fftSize;
  const letztes = werte.length - 1;

  // Spektrum: Spalten von links (MIN) nach rechts (MAX)
  const breite = canvas.width;
  [vonFach, bisFach] = fachTabelle(breite, fachbreite, letztes, false);
  // für "glatt": bei welchem Fach (mit Komma) liegt die Mitte jeder Spalte? z. B. 3,4 = zwischen Fach 3 und 4
  fachPos = new Float32Array(breite);
  for (let x = 0; x < breite; x++) {
    fachPos[x] = anteilZuFrequenz((x + 0.5) / breite) / fachbreite;
  }

  // Spektrogramm: Zeilen von oben (MAX) nach unten (MIN)
  const hoehe = canvas.height;
  [vonFachZeile, bisFachZeile] = fachTabelle(hoehe, fachbreite, letztes, true);

  // leere Pixelspalte (Spektrogramm) und Pixelzeile (Wasserfall), jedes Bild neu befüllt
  spalte = ctx.createImageData(1, hoehe);
  zeile = ctx.createImageData(breite, 1);

  // Bereich fürs Spektrum über dem Wasserfall hängt von der Höhe ab, also hier neu
  richteObenEin();
  verlauf = baueVerlauf(ctx, hoehe);
}

function richteObenEin() {
  oben =
    ansicht.value === "wasserfall" && spektrumOben.checked
      ? Math.round(canvas.height * OBEN_ANTEIL)
      : 0;
  verlaufOben = baueVerlauf(ctx, oben);
}

// andere Farbskala: die Farbverläufe fürs Spektrum neu (die Pixel-Farben liest fuelleReihe jedes Mal neu)
export function erneuereVerlaeufe() {
  verlauf = baueVerlauf(ctx, canvas.height);
  richteObenEin();
}

// neue Ansicht oder neue Größe: Canvas leeren, Umlaufen fängt vorne an
export function leere() {
  richteObenEin();
  ctx.clearRect(0, 0, canvas.width, canvas.height); // Reste der alten Ansicht weg
  schreibPos = 0;
}

// das lauteste Fach zwischen von und bis (beide eingeschlossen)
function lautestes(von, bis) {
  let lautester = 0;
  for (let i = von; i <= bis; i++) {
    if (werte[i] > lautester) lautester = werte[i];
  }
  return lautester;
}

// eine Pixelreihe (Spalte oder Zeile) aus den Fächern befüllen.
function fuelleReihe(bild, von, bis, anzahl) {
  const pixel = bild.data; 
  for (let n = 0; n < anzahl; n++) {
    const wert = lautestes(von[n], bis[n]); // 0–255, lauter = heller
    const p = n * 4; 
    const f = wert * 3; 
    pixel[p] = farbenZahlen[f];
    pixel[p + 1] = farbenZahlen[f + 1];
    pixel[p + 2] = farbenZahlen[f + 2];
    pixel[p + 3] = 255; 
  }
}


function zeichneSpektrogramm(neueSpalten) {
  if (neueSpalten === 0) return; 
  fuelleReihe(spalte, vonFachZeile, bisFachZeile, spalte.height);

  if (laufrichtung.value === "schieben") {
    ctx.drawImage(canvas, -neueSpalten, 0); // canvas auf sich selber um neueSpalten Pixel nach links
    for (let i = 1; i <= neueSpalten; i++) ctx.putImageData(spalte, canvas.width - i, 0);
    markiereEinsatz(canvas.width - lesekopfBreite(), 0, lesekopfBreite(), canvas.height); // neueSpalten-ste Spalte rechts
  } else {
    // umlaufen: das Bild steht, die Schreibstelle wandert von links nach rechts
    for (let i = 0; i < neueSpalten; i++) {
      ctx.putImageData(spalte, schreibPos, 0);
      schreibPos = (schreibPos + 1) % canvas.width; 
    }
    const x = (schreibPos - lesekopfBreite() + canvas.width) % canvas.width; 
    markiereEinsatz(x, 0, lesekopfBreite(), canvas.height);
    ctx.fillStyle = LESEKOPF_FARBE;
    ctx.fillRect(schreibPos, 0, lesekopfBreite(), canvas.height);
  }
}

function zeichneWasserfall(neueZeilen) {
  if (neueZeilen > 0) {
    fuelleReihe(zeile, vonFach, bisFach, zeile.width);

    if (laufrichtung.value === "schieben") {
      // drawImage(quelle, qx, qy, qBreite, qHoehe,  zx, zy, zBreite, zHoehe) -> Ausschnitt auf das Ziel malen
      const h = canvas.height - oben - neueZeilen; // Höhe, die kopiert wird (die untersten neueZeilen Zeilen fallen raus)
      ctx.drawImage(canvas, 0, oben, canvas.width, h, 0, oben + neueZeilen, canvas.width, h);
      for (let i = 0; i < neueZeilen; i++) ctx.putImageData(zeile, 0, oben + i); // oberste neueZeilen Zeilen des Wasserfalls
      markiereEinsatz(0, oben, canvas.width, lesekopfBreite()); // neueZeilenste Zeile oben
    } else {
      // umlaufen: Schreibstelle wandert von oben nach unten, nur im Wasserfall-Bereich
      const bereich = canvas.height - oben;
      for (let i = 0; i < neueZeilen; i++) {
        ctx.putImageData(zeile, 0, oben + schreibPos);
        schreibPos = (schreibPos + 1) % bereich;
      }
      const y = (schreibPos - lesekopfBreite() + bereich) % bereich; // gerade geschrieben
      markiereEinsatz(0, oben + y, canvas.width, lesekopfBreite());
      ctx.fillStyle = LESEKOPF_FARBE;
      ctx.fillRect(0, oben + schreibPos, canvas.width, lesekopfBreite());
    }
  }

  if (oben > 0) zeichneSpektrum(oben, verlaufOben); 
}

// offenen Einsatz als Strich an die gerade geschriebene Stelle malen (nur wenn das Häkchen an ist)
function markiereEinsatz(x, y, breite, hoehe) {
  if (!einsatzOffen) return;
  einsatzOffen = false;
  if (!einsaetzeZeigen.checked) return;
  ctx.fillStyle = EINSATZ_FARBE;
  ctx.fillRect(x, y, breite, hoehe);
}

// Catmull-Rom für weiche Kurve 
function catmullRom(p0, p1, p2, p3, t) {
  return (
    0.5 *
    (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  );
}

function wertBeiSpalte(x) {
  if (!spektrumGlatt.checked || bisFach[x] > vonFach[x]) return lautestes(vonFach[x], bisFach[x]);
  const letztes = werte.length - 1;
  const i = Math.min(Math.floor(fachPos[x]), letztes - 1);
  const t = fachPos[x] - i; // wie weit zwischen Fach i und i + 1
  const p0 = werte[Math.max(i - 1, 0)];
  const p3 = werte[Math.min(i + 2, letztes)];
  const wert = catmullRom(p0, werte[i], werte[i + 1], p3, t);
  return Math.min(Math.max(wert, 0), 255); 
}

// Spektrum in den Bereich von y = 0 bis hoeheCanvas, mit dem passenden Farbverlauf
function zeichneSpektrum(hoeheCanvas, farbverlauf) {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, hoeheCanvas); 

  ctx.beginPath(); 
  ctx.moveTo(0, hoeheCanvas); // unten links

  for (let x = 0; x < canvas.width; x++) {
    const hoehe = (wertBeiSpalte(x) / 255) * hoeheCanvas; // 0–255 -> Pixel
    ctx.lineTo(x, hoeheCanvas - hoehe); // pro Spalte nur einen Punkt anhängen
  }

  ctx.lineTo(canvas.width, hoeheCanvas); // unten rechts
  ctx.closePath(); // zurück nach unten links
  ctx.fillStyle = farbverlauf;
  ctx.fill(); // nur einmal füllen
}

// Tempo an die echte Zeit binden statt an die Bildrate
//------------------------------------------------------
// aus der vergangenen Zeit ausrechnen, wie viele Spalten dran sind.
const MAX_LUECKE = 0.25; 
let letzteZeit = null; 
let guthaben = 0; // angefangene Spalte, noch nicht gemalt (0 bis unter 1)

// laenge: Pixel, über die die Zeit läuft (Breite beim Spektrogramm, Höhe beim Wasserfall)
function neueReihen(sekunden, laenge) {
  const proSekunde = laenge / Number(tempo.value); // so viele Pixel pro Sekunde, damit tempo.value Sekunden hineinpassen
  guthaben += sekunden * proSekunde; // z. B. 0,7 Spalten
  const anzahl = Math.floor(guthaben); // nur ganze Spalten malen
  guthaben -= anzahl; // den Rest beim nächsten Bild weiterzählen, so geht nichts verloren
  return anzahl;
}

export function zeigeTempo() {
  tempoAnzeige.textContent = `${tempo.value} s`;
}
tempo.addEventListener("input", zeigeTempo);
//------------------------------------------------------

function zeichne(zeit = performance.now()) {
  // echte Zeit seit dem letzten Bild
  // beim ersten Bild als wäre es eins bei 60 Hz.
  const vergangen = Math.max(0, (zeit - letzteZeit) / 1000);
  const sekunden = letzteZeit === null ? 1 / 60 : Math.min(vergangen, MAX_LUECKE);
  letzteZeit = zeit;

  // Glättung hängt auch an der Bildrate
  analyser.smoothingTimeConstant = Number(glaettung.value) ** (sekunden * 60);
  analyser.getByteFrequencyData(werte);
  if (pruefeEinsatz(sekunden, zeit)) einsatzOffen = true;
  einsatzLampe.style.setProperty("--an", staerke); // CSS macht die Helligkeit

  if (ansicht.value === "spektrogramm") zeichneSpektrogramm(neueReihen(sekunden, canvas.width));
  else if (ansicht.value === "wasserfall")
    zeichneWasserfall(neueReihen(sekunden, canvas.height - oben)); // zeichnet das Spektrum oben selbst mit
  else if (ansicht.value === "spektrum")
    zeichneSpektrum(canvas.height, verlauf);
  // "aufnahme": das Gesamtbild steht schon, den Abspielkopf malt laufeKopf
  zeichnePegel(zeit, sekunden);
  laufId = requestAnimationFrame(zeichne); // Live-Schleife; die zweite Schleife (Abspielkopf) ist laufeKopf
}

export function starteZeichnen() {
  letzteZeit = null; 
  zeichne();
}

export function stoppeZeichnen() {
  cancelAnimationFrame(laufId);
  laufId = null;
}

export function zeichnetGerade() {
  return laufId !== null;
}
