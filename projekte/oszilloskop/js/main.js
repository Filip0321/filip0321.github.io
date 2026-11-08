// Oszilloskop-Musik: eine Zeichnung als Stereo-Ton. Links ist x, rechts ist y. Ein Oszilloskop im XY-Modus zeichnet
// damit genau die Zeichnung, und weil der Strahl sie f-mal pro Sekunde abfährt, hört man dabei einen Ton der
// Höhe f. Bild und Klang sind dasselbe Signal (Jerobeam Fenderson, Hansi3D, „Oscilloscope Music“; die 3D-Körper
// macht Fenderson mit seinem Blender-Werkzeug OsciStudio, hier gehen OBJ-Dateien aus Blender).
//
// Was man daraus hört:
//   Tonhöhe     wie oft pro Sekunde die Figur gezeichnet wird
//   Klangfarbe  die Form selbst: ein Kreis ist ein reiner Sinus (links Sinus, rechts Kosinus), ein Quadrat klingt
//               scharf (Ecken = Obertöne), eine Zeichnung mit vielen Strichen summt und schnarrt
//   Drehen      verschiebt Energie zwischen den Kanälen: es schwebt; in 3D ändert sich die Klangfarbe mit
// Je höher der Ton, desto weniger Samples hat eine Runde (bei 48 kHz und 1000 Hz nur 48): feine Zeichnungen
// werden dann eckig. Tiefe Töne flackern, weil eine Runde länger dauert, als der Phosphor nachleuchtet.
//
// Dateien: formen.js (Formen, 3D-Körper, OBJ, der Umlauf), nachzeichnen.js (Bild, Text, SVG → Striche),
// ton.js und ton-worklet.js (der Ton), schirm.js (das nachgemachte Oszilloskop)

import { FORMEN, DREI_D, umlauf, ladeObj } from "./formen.js";
import { bildZuStrichen, textZuStrichen, svgZuStrichen } from "./nachzeichnen.js";
import { neuerZustand, rechne, drehe, zurueckDrehen } from "./ton.js";
import { richteSchirmEin, zeichneSpur, zeichneRaster } from "./schirm.js";
import { zuWav, ladeHerunter, zeitstempel, speichereCanvas, neueAufnahme, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";

const zeichnung = hole("zeichnung");
const zctx = zeichnung.getContext("2d");
const meldung = hole("meldung");
const schirm = richteSchirmEin(hole("schirm"), hole("raster"));

let striche = FORMEN.stern();
let aktuell = null; // der Strich, der gerade gezogen wird
let ac = null;
let knoten = null; // AudioWorkletNode
let dateiQuelle = null; // eine Tondatei, die gerade auf dem Schirm läuft
let geladenesBild = null; // fürs Nachzeichnen: bei neuer Schwelle noch einmal
let beschaeftigt = false;
// die Drehung jetzt, um x, y und z (wie z.wx, z.wy, z.wz im Ton). Läuft der Ton, meldet das Worklet sie;
// sonst zählt die Seite selbst weiter. Von Hand gedreht wird hier und im Worklet
let winkel = [0, 0, 0];
let mitte = [0, 0]; // um diesen Punkt dreht sich die Figur (umlauf() schiebt ihn für den Ton in die Mitte)
const zeiger = new Map(); // Finger und Maus auf der Zeichenfläche: pointerId → letzte Stelle
let drehen = null; // { letzte: [x, y] } beim Drehen von Hand

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}

// ---------- Werte ----------
const NOTEN = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "H"];
const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const zahl = (id) => Number(hole(id).value);
const werte = () => ({
  f: hz(zahl("note")),
  laut: zahl("laut"),
  drehX: zahl("drehX"),
  drehY: zahl("drehY"),
  drehZ: zahl("drehZ"),
  abstand: zahl("abstand"),
  atmen: zahl("atmen"),
  atmenF: zahl("atmenF"),
  gleit: zahl("gleit"),
  sprung: zahl("sprung"),
});
function zeigeWerte() {
  const n = zahl("note");
  const gerundet = Math.round(n);
  hole("noteAnzeige").textContent = `${NOTEN[((gerundet % 12) + 12) % 12]}${Math.floor(gerundet / 12) - 1} · ${hz(n).toFixed(1)} Hz`;
  for (const out of document.querySelectorAll("output[data-fuer]")) out.textContent = hole(out.dataset.fuer).value;
  const form = hole("form").value;
  for (const id of ["la", "lb", "lphase"]) hole(id).closest("label").hidden = !(form === "lissajous" || (form === "knoten" && id !== "lphase"));
  hole("abstand").closest("label").querySelector("output").textContent = zahl("abstand") > 0 ? hole("abstand").value : "aus";
}

// ---------- Zeichnen ----------
// Zeichenfläche: −1 bis 1 in beiden Richtungen, y nach oben. Sie zeigt die Figur so gedreht wie der Schirm
// (gleiche Drehung, gleiche Perspektive), nur nicht in die Mitte geschoben: was man zeichnet, bleibt, wo man es
// gezeichnet hat. Hinten ist blasser als vorn.
// Neue Striche liegen in der Ebene, die gerade zum Betrachter zeigt (durch die Mitte der Figur): dreht man die
// Figur und zeichnet weiter, entsteht ein Körper aus Strichen in verschiedenen Ebenen (3D zeichnen). Dreht sie
// sich beim Zeichnen von selbst, wird der Strich mitgenommen wie auf einer Töpferscheibe.
const nachXY = (event) => {
  const r = zeichnung.getBoundingClientRect();
  return [((event.clientX - r.left) / r.width) * 2 - 1, 1 - ((event.clientY - r.top) / r.height) * 2];
};
const nachPx = ([x, y]) => [((x + 1) / 2) * zeichnung.width, ((1 - y) / 2) * zeichnung.height];
// ein Punkt der Figur → Zeichenfläche (x, y, Tiefe)
const ansicht = (p) => {
  const [x, y, q] = drehe(p[0] - mitte[0], p[1] - mitte[1], p[2] ?? 0, ...winkel, zahl("abstand"));
  return [x + mitte[0], y + mitte[1], q];
};
// eine Stelle auf der Zeichenfläche → Punkt der Figur (in der Ebene, die gerade nach vorn zeigt)
const inFigur = ([x, y]) => {
  const [a, b, c] = zurueckDrehen(x - mitte[0], y - mitte[1], ...winkel);
  return [a + mitte[0], b + mitte[1], c];
};
const gedreht = () => winkel.some((w) => Math.abs(Math.sin(w)) > 1e-6);

function zeichne() {
  const w = zeichnung.width;
  zctx.fillStyle = "#050805";
  zctx.fillRect(0, 0, w, zeichnung.height);
  zctx.strokeStyle = "rgba(125,255,154,0.15)";
  zctx.beginPath();
  zctx.moveTo(w / 2, 0);
  zctx.lineTo(w / 2, w);
  zctx.moveTo(0, w / 2);
  zctx.lineTo(w, w / 2);
  zctx.stroke();
  const voll = striche.filter((s) => s.length);
  const alle = [...voll, aktuell].filter((s) => s?.length);
  const flach = alle.map((s) => s.map(ansicht));
  // Sprünge zwischen den Strichen gestrichelt: so läuft der Strahl auch, nur schneller
  zctx.setLineDash([4, 6]);
  zctx.strokeStyle = "rgba(255,255,255,0.3)";
  zctx.beginPath();
  const fertige = flach.slice(0, voll.length);
  fertige.forEach((s, i) => {
    const naechster = fertige[(i + 1) % fertige.length];
    zctx.moveTo(...nachPx(s[s.length - 1]));
    zctx.lineTo(...nachPx(naechster[0]));
  });
  zctx.stroke();
  zctx.setLineDash([]);
  // Stücke nach Tiefe in vier Töpfe (vorn hell, hinten blass): vier Pfade statt einem pro Stück, das bleibt schnell
  const toepfe = [[], [], [], []];
  for (const s of flach) {
    if (s.length === 1) toepfe[3].push([s[0], s[0]]);
    for (let i = 1; i < s.length; i++) {
      const tiefe = (s[i - 1][2] + s[i][2]) / 2; // etwa −1 (hinten) bis 1 (vorn)
      toepfe[Math.max(0, Math.min(3, Math.floor((tiefe + 1) * 2)))].push([s[i - 1], s[i]]);
    }
  }
  zctx.strokeStyle = "#7dff9a";
  zctx.lineWidth = 2;
  zctx.lineCap = "round";
  toepfe.forEach((stuecke, k) => {
    zctx.globalAlpha = gedreht() ? 0.3 + k * 0.23 : 1;
    zctx.beginPath();
    for (const [a, b] of stuecke) {
      zctx.moveTo(...nachPx(a));
      zctx.lineTo(...nachPx(b));
    }
    zctx.stroke();
  });
  zctx.globalAlpha = 1;
  hole("anzahl").textContent = `${voll.length} Striche, ${voll.reduce((s, t) => s + t.length, 0)} Punkte`;
}

// Zeichnen mit einem Finger oder der Maus; drehen mit Alt + Ziehen, der rechten Maustaste oder zwei Fingern
zeichnung.addEventListener("contextmenu", (event) => event.preventDefault());
zeichnung.addEventListener("pointerdown", (event) => {
  try {
    zeichnung.setPointerCapture(event.pointerId);
  } catch {
    // ohne Fangen geht es auch, nur verliert man den Strich, wenn man über den Rand zieht
  }
  zeiger.set(event.pointerId, nachXY(event));
  if (event.altKey || event.button === 2 || zeiger.size > 1) {
    aktuell = null; // der zweite Finger kam dazu: kein Strich, sondern drehen
    drehen = { letzte: mittelpunkt() };
    zeichne();
    return;
  }
  aktuell = [inFigur(nachXY(event))];
});
const mittelpunkt = () => {
  const punkte = [...zeiger.values()];
  return [0, 1].map((k) => punkte.reduce((s, p) => s + p[k], 0) / punkte.length);
};
zeichnung.addEventListener("pointermove", (event) => {
  if (!zeiger.has(event.pointerId)) return;
  zeiger.set(event.pointerId, nachXY(event));
  if (drehen) {
    const jetzt = mittelpunkt();
    // ganz über die Fläche ziehen = eine halbe Umdrehung; nach unten ziehen kippt die Oberkante nach vorn
    dreheVonHand(-(jetzt[1] - drehen.letzte[1]) * (Math.PI / 2), (jetzt[0] - drehen.letzte[0]) * (Math.PI / 2));
    drehen.letzte = jetzt;
    return;
  }
  if (!aktuell) return;
  const p = inFigur(nachXY(event));
  const q = aktuell[aktuell.length - 1];
  if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.01) return; // nicht jeden Pixel: gibt nur Zittern
  aktuell.push(p);
  zeichne();
});
const fertig = (event) => {
  zeiger.delete(event.pointerId);
  if (drehen) {
    if (!zeiger.size) drehen = null;
    else drehen.letzte = mittelpunkt(); // ein Finger blieb: weiterdrehen ohne Sprung
    return;
  }
  if (!aktuell) return;
  striche.push(aktuell);
  aktuell = null;
  neu();
};
zeichnung.addEventListener("pointerup", fertig);
zeichnung.addEventListener("pointercancel", fertig);

function dreheVonHand(dx, dy) {
  winkel[0] += dx;
  winkel[1] += dy;
  if (laeuftTon()) knoten.port.postMessage({ drehe: [dx, dy, 0] });
  zeichne();
}
hole("geradeStellen").addEventListener("click", () => {
  winkel = [0, 0, 0];
  if (knoten) knoten.port.postMessage({ winkel });
  zeichne();
});

// die Drehung weiterzählen, wenn kein Ton läuft (sonst kommt sie vom Worklet), und neu zeichnen, wenn sich etwas dreht
let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.1, (jetzt - vorher) / 1000);
  vorher = jetzt;
  const w = werte();
  const dreht = w.drehX || w.drehY || w.drehZ;
  if (dreht && !laeuftTon()) {
    winkel[0] = (winkel[0] + 2 * Math.PI * w.drehX * dt) % (2 * Math.PI);
    winkel[1] = (winkel[1] + 2 * Math.PI * w.drehY * dt) % (2 * Math.PI);
    winkel[2] = (winkel[2] + 2 * Math.PI * w.drehZ * dt) % (2 * Math.PI);
  }
  if (dreht) zeichne();
  requestAnimationFrame(schleife);
}
requestAnimationFrame(schleife);

hole("zurueck").addEventListener("click", () => {
  striche.pop();
  neu();
});
hole("loeschen").addEventListener("click", () => {
  striche = [];
  neu();
});
hole("einsetzen").addEventListener("click", () => {
  const form = hole("form").value;
  striche = FORMEN[form]({ a: zahl("la"), b: zahl("lb"), phase: zahl("lphase") });
  // ein 3D-Körper ohne Drehung sieht flach aus: ein wenig drehen lassen, wenn noch nichts dreht
  if (DREI_D.has(form) && !zahl("drehX") && !zahl("drehY")) {
    hole("drehX").value = 0.13;
    hole("drehY").value = 0.21;
    sende();
  }
  neu();
});

// ---------- Eigene Dateien und Text ----------
// eine Datei, drei Arten: SVG (Formen), OBJ (3D aus Blender), sonst ein Bild (Umrisse)
hole("datei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  zeige("");
  try {
    const endung = datei.name.split(".").pop().toLowerCase();
    if (endung === "svg" || datei.type === "image/svg+xml") {
      geladenesBild = null;
      striche = svgZuStrichen(await datei.text());
    } else if (endung === "obj") {
      geladenesBild = null;
      striche = ladeObj(await datei.text());
      if (!zahl("drehX") && !zahl("drehY")) {
        hole("drehY").value = 0.2;
        sende();
      }
    } else {
      geladenesBild = await createImageBitmap(datei);
      zeichneBildNach();
    }
    hole("bildTeil").hidden = !geladenesBild;
    neu();
  } catch (fehler) {
    console.error(fehler);
    zeige(`Ging nicht: ${fehler.message}`);
  }
});
function zeichneBildNach() {
  striche = bildZuStrichen(geladenesBild, { schwelle: zahl("schwelle"), aufloesung: zahl("bildDetail"), umkehren: hole("bildUmkehren").checked });
}
for (const id of ["schwelle", "bildDetail", "bildUmkehren"]) {
  hole(id).addEventListener("change", () => {
    if (!geladenesBild) return;
    zeichneBildNach();
    neu();
  });
}
hole("textEinsetzen").addEventListener("click", () => {
  const text = hole("text").value.trim();
  if (!text) return;
  geladenesBild = null;
  hole("bildTeil").hidden = true;
  striche = textZuStrichen(text);
  neu();
});

// Zeichnung geändert: neuer Umlauf an den Ton
function neu() {
  const u = umlauf(striche, 2048, werte().sprung);
  mitte = u.mitte ?? [0, 0];
  zeichne();
  if (knoten) knoten.port.postMessage({ umlauf: u });
}

// ---------- Ton ----------
async function richteTonEin() {
  if (ac) return;
  ac = new AudioContext();
  await ac.audioWorklet.addModule(new URL("./ton-worklet.js", import.meta.url));
  knoten = new AudioWorkletNode(ac, "oszi-ton", { numberOfInputs: 0, outputChannelCount: [2] });
  // die Winkel des Tons: nur übernehmen, solange er läuft (sonst zählt die Seite selbst)
  knoten.port.onmessage = (event) => {
    if (event.data.winkel && laeuftTon()) winkel = event.data.winkel;
  };
  // fürs nachgemachte Oszilloskop: die beiden Kanäle getrennt messen
  const teiler = ac.createChannelSplitter(2);
  const [l, r] = [ac.createAnalyser(), ac.createAnalyser()];
  l.fftSize = r.fftSize = 2048;
  teiler.connect(l, 0);
  teiler.connect(r, 1);
  knoten.connect(teiler);
  ac.teiler = teiler;
  schirm.verbinde(l, r);
}

const starten = hole("starten");
starten.addEventListener("click", async () => {
  await richteTonEin();
  await ac.resume();
  const an = starten.getAttribute("aria-pressed") !== "true";
  halteDatei();
  if (an) {
    knoten.connect(ac.destination);
    knoten.port.postMessage({ winkel }); // der Ton fängt da an, wo die Zeichenfläche gerade steht
    sende();
    neu();
  } else knoten.disconnect(ac.destination);
  starten.setAttribute("aria-pressed", String(an));
  starten.textContent = an ? "Ton aus" : "Ton an";
});
const laeuftTon = () => starten.getAttribute("aria-pressed") === "true";

function sende() {
  zeigeWerte();
  if (!knoten) return;
  const { sprung, ...rest } = werte();
  knoten.port.postMessage(rest);
}
for (const id of ["note", "laut", "drehX", "drehY", "drehZ", "abstand", "atmen", "atmenF", "gleit"]) hole(id).addEventListener("input", sende);
hole("sprung").addEventListener("input", () => {
  zeigeWerte();
  neu();
});
for (const id of ["la", "lb", "lphase", "form"]) hole(id).addEventListener("input", zeigeWerte);
for (const id of ["nachleuchten", "helligkeit", "verstaerkung"]) {
  hole(id).addEventListener("input", () => {
    schirm.einst[id] = zahl(id);
    zeigeWerte();
  });
}

// Tastatur wie in Ableton: A W S E D F T G Z H U J K ist eine Oktave (nach der Lage der Tasten, nicht dem
// Buchstaben, damit es auch auf der deutschen Tastatur mit Z und Y passt), Y und X eine Oktave runter und hoch
const TASTEN = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK"];
let oktave = 3;
window.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea") || event.repeat || event.metaKey || event.ctrlKey) return;
  if (event.code === "KeyZ") oktave = Math.max(0, oktave - 1);
  if (event.code === "KeyX") oktave = Math.min(7, oktave + 1);
  const i = TASTEN.indexOf(event.code);
  if (i < 0) return;
  hole("note").value = 12 * (oktave + 1) + i;
  sende();
});

// ---------- Tondatei ansehen ----------
// Eine fertige Oszilloskop-Musik (oder jedes Stereo-Lied) auf dem nachgemachten Schirm. Ein normales Lied gibt
// meist nur ein Knäuel um die Diagonale: links und rechts sind fast gleich, also x ≈ y
hole("tondatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  await richteTonEin();
  await ac.resume();
  if (laeuftTon()) starten.click();
  halteDatei();
  try {
    const puffer = await ac.decodeAudioData(await datei.arrayBuffer());
    dateiQuelle = new AudioBufferSourceNode(ac, { buffer: puffer });
    dateiQuelle.connect(ac.teiler);
    dateiQuelle.connect(ac.destination);
    dateiQuelle.start();
    dateiQuelle.onended = halteDatei;
    zeige(`${datei.name} läuft`);
  } catch {
    zeige("Diese Datei kann der Browser nicht lesen.");
  }
});
function halteDatei() {
  if (!dateiQuelle) return;
  dateiQuelle.onended = null;
  dateiQuelle.stop();
  dateiQuelle = null;
  zeige("");
}

// ---------- Export ----------
const RATE = 48000;
// der ganze Ton auf einmal (dieselbe Rechnung wie im Worklet, ohne Gleiten)
function rendereTon(sekunden) {
  const w = werte();
  const puffer = new AudioBuffer({ length: Math.round(RATE * sekunden), numberOfChannels: 2, sampleRate: RATE });
  // ab der Drehung, die gerade zu sehen ist
  const zustand = { ...neuerZustand(), wx: winkel[0], wy: winkel[1], wz: winkel[2] };
  rechne(umlauf(striche, 2048, w.sprung), w, zustand, puffer.getChannelData(0), puffer.getChannelData(1), RATE);
  return puffer;
}

hole("wavSpeichern").addEventListener("click", () => ladeHerunter(zuWav(rendereTon(zahl("dauer"))), `oszilloskop-${zeitstempel()}.wav`));

// Video: der nachgemachte Schirm, Bild für Bild aus genau dem Ton, der mit ins Video kommt. Jedes Bild zeigt die
// Samples seit dem letzten (bei 30 Bildern pro Sekunde 1600 Stück), auf das nachleuchtende vorige gezeichnet
const videoSchirm = document.createElement("canvas");
function schirmBild(mitRaster) {
  const c = document.createElement("canvas");
  c.width = videoSchirm.width;
  c.height = videoSchirm.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(videoSchirm, 0, 0);
  if (mitRaster) zeichneRaster(ctx);
  return c;
}
const dialog = erstelleExportDialog({
  felder: hole("exportFelder"),
  zeichneVorschau: (einst) => mitRahmen(exportArt === "video" ? vorschauBild() : hole("schirm"), einst),
});
let exportArt = "bild";
// Vorschau fürs Video: eine halbe Sekunde rechnen und das letzte Bild zeigen
function vorschauBild() {
  videoSchirm.width = videoSchirm.height = 800;
  const ton = rendereTon(0.5);
  const a = ton.getChannelData(0);
  const b = ton.getChannelData(1);
  const ctx = videoSchirm.getContext("2d");
  ctx.fillStyle = "#020402";
  ctx.fillRect(0, 0, 800, 800);
  for (let i = 0; i < a.length; i += 1600) zeichneSpur(ctx, a.subarray(i, i + 1601), b.subarray(i, i + 1601), schirm.einst);
  return schirmBild(hole("exportRaster").checked);
}

hole("videoRendern").addEventListener("click", async () => {
  if (beschaeftigt) return;
  exportArt = "video";
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
  if (!einst) return;
  beschaeftigt = true;
  let aufnahme = null;
  try {
    const fps = 30;
    const sekunden = zahl("dauer");
    const ton = rendereTon(sekunden);
    const a = ton.getChannelData(0);
    const b = ton.getChannelData(1);
    videoSchirm.width = videoSchirm.height = 1080;
    const ctx = videoSchirm.getContext("2d");
    ctx.fillStyle = "#020402";
    ctx.fillRect(0, 0, 1080, 1080);
    const rahmen = document.createElement("canvas");
    const mitRaster = hole("exportRaster").checked;
    aufnahme = await neueAufnahme(mitRahmen(schirmBild(mitRaster), einst, rahmen), fps, undefined, { kanaele: 2, rate: RATE }, einst.videoTyp, einst.videoQualitaet);
    const proBild = RATE / fps;
    const bilder = Math.round(sekunden * fps);
    for (let k = 0; k < bilder; k++) {
      const von = Math.round(k * proBild);
      const bis = Math.round((k + 1) * proBild);
      zeichneSpur(ctx, a.subarray(Math.max(0, von - 1), bis), b.subarray(Math.max(0, von - 1), bis), schirm.einst);
      const stueck = new AudioBuffer({ length: bis - von, numberOfChannels: 2, sampleRate: RATE });
      stueck.copyToChannel(a.subarray(von, bis), 0);
      stueck.copyToChannel(b.subarray(von, bis), 1);
      await Promise.all([aufnahme.bild(mitRahmen(schirmBild(mitRaster), einst, rahmen), k / fps, 1 / fps), aufnahme.ton(stueck)]);
      if (k % 15 === 0) {
        zeige(`Video … ${Math.round((k / bilder) * 100)} %`);
        await warte();
      }
    }
    zeige("Speichern …");
    ladeHerunter(await aufnahme.fertig(), `oszilloskop-${zeitstempel()}.${aufnahme.endung}`);
    zeige("");
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
  }
});

hole("bildSpeichern").addEventListener("click", async () => {
  exportArt = "bild";
  const einst = await dialog.oeffne({ art: "bild", ueberschrift: "Bild speichern" });
  if (einst) await speichereCanvas(mitRahmen(hole("schirm"), einst), einst.bildTyp, `oszilloskop-${zeitstempel()}`);
});

zeigeWerte();
neu();
