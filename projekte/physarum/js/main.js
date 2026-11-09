// Physarum (Schleimpilz) nach Jeff Jones (2010): die Seite. Die Rechnung steht in gpu.js.
//
// Jeder Agent ist ein Teilchen mit Ort und Richtung. Er riecht mit drei Fühlern vor sich (links, vorn, rechts),
// dreht sich zur stärksten Spur, geht einen Schritt und legt selbst Spur ab. Die Spur verteilt sich und verfällt.
// Aus diesen vier Regeln entstehen Adernetze wie beim echten Schleimpilz Physarum polycephalum, der Futterstellen
// mit kurzen Wegen verbindet (berühmt: das Experiment, in dem er das Bahnnetz um Tokio nachbaute, Tero 2010).

import { erstelleGpu } from "./gpu.js";
import { richteReglerEin } from "/lib/regler.js";
import { farbtabelle, skalaAnker, hexZuRgb } from "/lib/farben.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const stapel = hole("stapel");
const meldung = hole("meldung");
let gpu;
try {
  gpu = await erstelleGpu(canvas);
} catch (fehler) {
  meldung.hidden = false;
  meldung.textContent = fehler.message;
  throw fehler;
}

// Zufall mit Startwert (für die Startlage der Agenten: „neu“ mit derselben Zahl gibt dasselbe Bild)
let zs = 1;
function rnd() {
  zs = (zs + 0x6d2b79f5) | 0;
  let t = Math.imul(zs ^ (zs >>> 15), 1 | zs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let saat = 1;
let foto = null;
let laeuft = true;
let exportLaeuft = false;
let pinsel = null; // { x, y } in Pixeln des Felds, solange gezogen wird

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    anzahl: () => spaeter(neu),
    aufloesung: () => neu(),
    format: () => neu(),
    start: () => neu(),
    futterUmkehren: () => setzeFutter(),
    skala: () => tabelle(),
    farbe1: () => tabelle(),
    farbe2: () => tabelle(),
  },
});
let wartet = 0;
function spaeter(f) {
  clearTimeout(wartet);
  wartet = setTimeout(f, 350);
}

// ---------- Farben ----------
function tabelle() {
  let anker;
  if (e.skala === "weiss") anker = [[255, 255, 255], [0, 0, 0]];
  else if (e.skala === "eigen") anker = [hexZuRgb(e.farbe1), hexZuRgb(e.farbe2)];
  else anker = skalaAnker(e.skala);
  gpu.setzeTabelle(farbtabelle(anker));
}

// ---------- Anfang ----------
const FORMATE = { quadrat: 1, "1:1": 1, quer: 16 / 9, "16:9": 16 / 9, "4:3": 4 / 3, "4:5": 4 / 5, hoch: 9 / 16, "9:16": 9 / 16, "3:2": 3 / 2, "21:9": 21 / 9 };
let b = 0;
let h = 0;
function neu() {
  const seiten = e.format === "foto" && foto ? foto.width / foto.height : FORMATE[e.format] ?? 1;
  const lang = Number(e.aufloesung);
  b = Math.round(seiten >= 1 ? lang : lang * seiten);
  h = Math.round(seiten >= 1 ? lang / seiten : lang);
  stapel.style.setProperty("--format", b / h);
  stapel.style.setProperty("--verhaeltnis", b / h);
  const n = Math.round(e.anzahl * 1000);
  const start = new Float32Array(n * 4);
  zs = saat;
  const m = Math.min(b, h);
  for (let i = 0; i < n; i++) {
    let x, y, w;
    const r = rnd();
    const winkel = rnd() * Math.PI * 2;
    if (e.start === "mitte") {
      // alle in einem kleinen Kreis in der Mitte, Blick nach außen: es breitet sich aus wie ein Pilz auf der Schale
      const a = Math.sqrt(r) * m * 0.05;
      x = b / 2 + Math.cos(winkel) * a;
      y = h / 2 + Math.sin(winkel) * a;
      w = winkel;
    } else if (e.start === "ring") {
      // auf einem Ring, Blick nach innen: sie laufen aufeinander zu
      x = b / 2 + Math.cos(winkel) * m * 0.4;
      y = h / 2 + Math.sin(winkel) * m * 0.4;
      w = winkel + Math.PI;
    } else if (e.start === "scheibe") {
      const a = Math.sqrt(r) * m * 0.4;
      x = b / 2 + Math.cos(winkel) * a;
      y = h / 2 + Math.sin(winkel) * a;
      w = rnd() * Math.PI * 2;
    } else {
      x = rnd() * b;
      y = rnd() * h;
      w = winkel;
    }
    start.set([x, y, w, 0], i * 4);
  }
  gpu.neu(b, h, start);
  setzeFutter();
  tabelle();
}

// Futter: die Helligkeit des Fotos (oder umgekehrt: Dunkles lockt), so groß wie das Feld, füllend
function setzeFutter() {
  const werte = new Float32Array(b * h);
  if (foto) {
    const c = new OffscreenCanvas(b, h);
    const k = c.getContext("2d");
    const f = Math.max(b / foto.width, h / foto.height);
    k.drawImage(foto, (b - foto.width * f) / 2, (h - foto.height * f) / 2, foto.width * f, foto.height * f);
    const d = k.getImageData(0, 0, b, h).data;
    for (let i = 0; i < b * h; i++) {
      const hell = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      werte[i] = e.futterUmkehren ? 1 - hell : hell;
    }
  }
  gpu.setzeFutter(werte);
}
hole("fotoDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  foto = await createImageBitmap(datei);
  if (e.format === "foto") neu();
  else setzeFutter();
});
hole("neu").addEventListener("click", () => {
  saat++;
  neu();
});
const pauseKnopf = hole("pause");
pauseKnopf.addEventListener("click", () => {
  laeuft = !laeuft;
  pauseKnopf.textContent = laeuft ? "Pause" : "Weiter";
});

// ---------- Pinsel ----------
const stelle = (event) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((event.clientX - r.left) / r.width) * b, y: ((event.clientY - r.top) / r.height) * h };
};
stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture?.(event.pointerId);
  pinsel = stelle(event);
});
stapel.addEventListener("pointermove", (event) => {
  if (pinsel) pinsel = stelle(event);
});
for (const art of ["pointerup", "pointercancel"]) stapel.addEventListener(art, () => (pinsel = null));

// ---------- Musik ----------
const musik = richteAudioreaktivEin({
  ziele: {
    tempo: "schneller",
    fuehler: "Fühler weiter (gröbere Adern)",
    ablage: "mehr Spur (heller)",
    drehen: "Fühler spreizen",
  },
  start: { bass: "ablage", schlag: "fuehler" },
  beiStart: () => {},
});

// ---------- ein Bild ----------
const grad = Math.PI / 180;
function werte() {
  const w = musik.wirkung;
  return {
    sensorWinkel: e.sensorWinkel * grad * (1 + 0.5 * (w.drehen ?? 0)),
    sensorAbstand: e.sensorAbstand * (1 + 0.8 * (w.fuehler ?? 0)),
    drehWinkel: e.drehWinkel * grad,
    schritt: e.schritt,
    ablage: e.ablage * (1 + (w.ablage ?? 0)),
    verfall: e.verfall,
    diffusion: e.diffusion,
    futter: e.futter,
    rand: e.rand === "abprallen" ? 1 : 0,
    helligkeit: e.helligkeit,
    gamma: e.gamma,
    pinsel: pinsel ? [pinsel.x, pinsel.y, (e.pinselGroesse / 100) * Math.min(b, h), e.pinselArt === "lockt" ? e.pinselStaerke : -e.pinselStaerke] : [0, 0, 0, 0],
  };
}
function bild(schritte) {
  const w = werte();
  if (schritte > 0) gpu.schritte(schritte, w);
  gpu.zeige(w);
}

function schleife() {
  if (!exportLaeuft) {
    musik.schritt(1 / 60);
    const n = laeuft ? Math.round(e.tempo * (1 + (musik.wirkung.tempo ?? 0))) : pinsel ? 1 : 0;
    bild(n);
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
// Video: jedes Bild bekommt „Schritte pro Bild“ Schritte, wie in der Anzeige bei 60 Bildern pro Sekunde halbiert
// (das Video hat 30): so wächst es im Video so schnell wie live
const render = {
  start(n) {
    exportLaeuft = true;
    musik.exportStart(n, 30);
  },
  // Warten auf die Grafikkarte braucht es nicht: wer den Canvas danach liest (drawImage), bekommt das Bild erst,
  // wenn alles davor Abgeschickte fertig ist (der Browser hält die Reihenfolge ein)
  bild(i) {
    musik.exportBild(i);
    bild(Math.round(e.tempo * 2 * (1 + (musik.wirkung.tempo ?? 0))));
  },
  ende() {
    musik.exportEnde();
    exportLaeuft = false;
  },
  merke: () => gpu.merke(),
  vorschau(i) {
    bild(Math.min(i, 300) * e.tempo * 2);
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "physarum",
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
  ton: () => musik.tonFuerExport(),
});

neu();
requestAnimationFrame(schleife);
