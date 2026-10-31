import { macheDrehknopf, macheFader, haltePaar } from "/lib/knopfRegler.js";
import { ansicht, glaettung, minDb, maxDb, canvas, spieler, passeGroesseAn } from "./seite.js";
import { frequenzZuAnteil, anteilZuFrequenz, zeigeFrequenz } from "./frequenzen.js";
import { zeichneSkala } from "./skala.js";
import { audio, analyser, baueAudioAuf, fftRegler, fftGroesse, zeigeFft, setzeAnalyserDb, lautstaerke, setzeLautstaerke } from "./audio.js";
import { tiefen, hoehen, setzeGrenzen } from "./filter.js";
import { zeigeQuelle, setzeQuelle, quellenArt } from "./quelle.js";
import { laufrichtung, spektrumOben, richteFaecherEin, berechneTabellen, leere, zeigeTempo, starteZeichnen, stoppeZeichnen, zeichnetGerade, erneuereVerlaeufe } from "./live.js";
import { ladeDatei } from "./datei.js";
import { beiAufnahme } from "./aufnehmen.js";
import { berechneEinsaetze, setzeEmpfindlichkeit } from "./einsaetze.js";
import { setzeEmpfindlichkeitLive } from "./einsaetze-live.js";
import { berechneTempo, aendereTempo } from "./tempo.js";
import { zeigeGesamt, markiereFarbenVeraltet, zeigeAlles } from "./gesamtbild.js";
import { waehleFarbskala } from "/lib/farben.js";
import "./maus-info.js"; 
import "./ton-export.js"; 
import { vonFeld, bisFeld, loescheBereich } from "./bereich.js";
import "./png-export.js"; 
import "./video-export.js"; 

const startBtn = hole("startBtn");
const wrapper = hole("feld"); // der Rahmen um beide Canvas, bekommt Klassen fürs Seitenverhältnis
const spektrumObenLabel = hole("spektrumObenLabel"); // nur beim Wasserfall sichtbar
const spektrumGlattLabel = hole("spektrumGlattLabel"); // nur wo ein Spektrum zu sehen ist
const laufrichtungLabel = hole("laufrichtungLabel"); // beim Spektrum versteckt
const tempoLabel = hole("tempoLabel"); // wie die Laufrichtung nur bei laufenden Ansichten
const taktLabel = hole("taktLabel"); // nur beim Gesamtbild
const tempoHalb = hole("tempoHalb");
const tempoDoppelt = hole("tempoDoppelt");
const glaettungAnzeige = hole("glaettungAnzeige");
const minDbAnzeige = hole("minDbAnzeige");
const maxDbAnzeige = hole("maxDbAnzeige");
const farbskala = hole("farbskala");
const empfindlichkeit = hole("empfindlichkeit");
const empfindlichkeitAnzeige = hole("empfindlichkeitAnzeige");
const bedienung = document.querySelector(".bedienung"); 

// Größe
//------------------------------------------------------
function groesseGeaendert() {
  passeGroesseAn(); // neue Pixelzahl, dabei beide Canvas leer
  leere(); // Umlaufen fängt vorne an
  zeichneSkala(); 
  berechneTabellen(); 
  if (ansicht.value === "aufnahme") zeigeGesamt(); 
}

function wechsleAnsicht() {
  const wasserfall = ansicht.value === "wasserfall";
  wrapper.classList.toggle("wasserfall", wasserfall); // toggle(name, an) -> Klasse an oder aus
  wrapper.classList.toggle("mit-spektrum", wasserfall && spektrumOben.checked);
  wrapper.classList.toggle("aufnahme", ansicht.value === "aufnahme"); 
  spektrumObenLabel.hidden = !wasserfall; 
  spektrumGlattLabel.hidden = !(ansicht.value === "spektrum" || (wasserfall && spektrumOben.checked));
  const laeuftNicht = ansicht.value === "spektrum" || ansicht.value === "aufnahme";
  laufrichtungLabel.hidden = laeuftNicht;
  tempoLabel.hidden = laeuftNicht;
  taktLabel.hidden = ansicht.value !== "aufnahme";
  leere(); 
  zeichneSkala();
  if (ansicht.value === "aufnahme") zeigeGesamt();
}

ansicht.addEventListener("change", wechsleAnsicht); 
spektrumOben.addEventListener("change", wechsleAnsicht);
laufrichtung.addEventListener("change", wechsleAnsicht); 
//------------------------------------------------------

// Start
//------------------------------------------------------
// async - weil muss auf die Erlaubnis fürs Mikrofon warten
startBtn.addEventListener("click", async () => {
  if (!audio) {
    baueAudioAuf();
    richteFaecherEin(); // Anzahl der Fächer (fftSize / 2) liefert der Browser als frequencyBinCount
    await setzeQuelle();
  }
  // manche Browser starten suspended, dass nicht Ton sofort spielt
  // mit resume kann es fortgesetzt / gestartet werden
  await audio.resume();
  if (!zeichnetGerade()) {
    starteZeichnen();
    startBtn.textContent = "Stop";
  } else {
    stoppeZeichnen();
    startBtn.textContent = "Start";
  }
});

// Oktavfehler von Hand korrigieren, danach Raster neu zeigen
function korrigiereTempo(faktor) {
  aendereTempo(faktor);
  if (ansicht.value === "aufnahme") zeigeGesamt();
}
tempoHalb.addEventListener("click", () => korrigiereTempo(0.5));
tempoDoppelt.addEventListener("click", () => korrigiereTempo(2));

// eine Datei (geöffnet oder gerade aufgenommen) laden, analysieren und zeigen
async function ladeUndZeige(datei) {
  zeigeAlles(); // Zoom zurück
  loescheBereich(); // der Bereich der alten Datei passt nicht zur neuen
  if (await ladeDatei(datei)) {
    markiereFarbenVeraltet();
    // eigene kleine FFT über die ganze Aufnahme; das Bild ist schon fertig und wird gleich gezeigt,
    // die Einsätze kommen danach dazu
    if (ansicht.value === "aufnahme") zeigeGesamt();
    if (!(await berechneEinsaetze())) return; // inzwischen andere Datei
    berechneTempo(); // braucht die Flux-Kurve aus einsaetze.js
  }
  if (ansicht.value === "aufnahme") zeigeGesamt();
}

hole("datei").addEventListener("change", (event) => {
  const datei = event.target.files[0];
  if (datei) ladeUndZeige(datei);
});

// fertige Aufnahme: zur Ansicht "Ganze Aufnahme" wechseln und wie eine Datei laden
beiAufnahme((datei) => {
  ansicht.value = "aufnahme";
  wechsleAnsicht();
  ladeUndZeige(datei);
});
//------------------------------------------------------

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  // auf Knöpfen, Feldern und Reglern hat die Leertaste schon eine eigene Bedeutung
  if (event.target.closest("input, select, textarea, button, audio, [role=slider]")) return;
  event.preventDefault(); // sonst scrollt die Seite
  if (quellenArt() === "datei") {
    if (spieler.paused) spieler.play();
    else spieler.pause();
  } else {
    startBtn.click();
  }
});

function zeigeGlaettung() {
  glaettungAnzeige.textContent = Number(glaettung.value);
}

fftRegler.addEventListener("input", () => {
  zeigeFft();
  if (!analyser) return; 
  analyser.fftSize = fftGroesse();
  richteFaecherEin(); 
});

glaettung.addEventListener("input", () => {
  zeigeGlaettung();
  // den Analyser stellt zeichne() in jedem Bild selbst ein (passend zur vergangenen Zeit)
});

// Dezibel-Bereich geht von minDb bis maxDb und wird auf 0–255 verteilt
// minDb (Schwarzpunkt), weil je leiser, desto dunkler schwarz
// maxDb (Weißpunkt), weil je lauter, desto heller
const DB_ABSTAND = 10; 

function setzeDb(gezogen) {
  const [min, max] = haltePaar(minDb, maxDb, DB_ABSTAND, gezogen);
  minDbAnzeige.textContent = `${min} dB`;
  maxDbAnzeige.textContent = `${max} dB`;
  if (analyser) setzeAnalyserDb(min, max);
  markiereFarbenVeraltet();
  if (ansicht.value === "aufnahme") zeigeGesamt();
}

farbskala.addEventListener("change", () => {
  waehleFarbskala(farbskala.value);
  erneuereVerlaeufe();
  markiereFarbenVeraltet();
  if (ansicht.value === "aufnahme") zeigeGesamt();
});

function setzeEmpfindlichkeiten() {
  const wert = Number(empfindlichkeit.value);
  empfindlichkeitAnzeige.textContent = `${Math.round(wert * 100)} %`;
  setzeEmpfindlichkeit(wert);
  setzeEmpfindlichkeitLive(wert);
  if (ansicht.value === "aufnahme") zeigeGesamt();
}
empfindlichkeit.addEventListener("input", setzeEmpfindlichkeiten);

// Exportbereich von Hand eingetippt: im Gesamtbild gleich zeigen
for (const feld of [vonFeld, bisFeld]) {
  feld.addEventListener("input", () => {
    if (ansicht.value === "aufnahme") zeigeGesamt();
  });
}
hole("bereichLoeschen").addEventListener("click", () => {
  loescheBereich();
  if (ansicht.value === "aufnahme") zeigeGesamt();
});

minDb.addEventListener("input", () => setzeDb(minDb)); // "gezogen" ist jeweiliges Element aus HTML
maxDb.addEventListener("input", () => setzeDb(maxDb));

tiefen.addEventListener("input", () => {
  setzeGrenzen(tiefen);
  zeichneSkala(); // Bänder neu markieren
});
hoehen.addEventListener("input", () => {
  setzeGrenzen(hoehen);
  zeichneSkala();
});

tiefen.value = frequenzZuAnteil(250); // Startwerte: übliche Einteilung (Mischpult, EQ)
hoehen.value = frequenzZuAnteil(4000);

const alsDb = (wert) => `${wert} Dezibel`;
const alsFrequenz = (anteil) => zeigeFrequenz(anteilZuFrequenz(anteil));
macheDrehknopf(glaettung, "Glättung");
macheDrehknopf(minDb, "Schwarzpunkt", alsDb);
macheDrehknopf(maxDb, "Weißpunkt", alsDb);
macheDrehknopf(tiefen, "Tiefen bis", alsFrequenz);
macheDrehknopf(hoehen, "Höhen ab", alsFrequenz);
macheDrehknopf(empfindlichkeit, "Empfindlichkeit", (wert) => `${Math.round(wert * 100)} Prozent`);

macheFader(lautstaerke, "Lautstärke", alsDb);

zeigeQuelle();
wechsleAnsicht();
zeigeFft();
zeigeGlaettung();
zeigeTempo();
setzeDb(minDb);
setzeLautstaerke();
setzeGrenzen(tiefen);
zeichneSkala();
setzeEmpfindlichkeiten();

const beobachter = new ResizeObserver(groesseGeaendert);
beobachter.observe(canvas);
