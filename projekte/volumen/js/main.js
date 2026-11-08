// Volumen-Viewer: die Seite. Zusammengesteckt aus
//   laden.js     NRRD/RAW lesen, Testkörper und Mandelbulb rechnen
//   volumen.js   3D-Textur und Strahlen (Volumen, Oberfläche, MIP, Röntgen)
//   tf.js        Transferfunktion (Gewebe-Voreinstellungen für CT, eigene)
//   schnitte.js  axial, koronal, sagittal
// Später soll hier auch Rayleigh-Taylor 3D gezeigt werden (dieselbe Darstellung, die Werte kommen dann aus einer
// Simulation statt aus einer Datei).

import { ladeDateien, testkoerper, mandelbulb, halbiere } from "./laden.js";
import { erstelleVolumen } from "./volumen.js";
import { GEWEBE, ausPunkten, eigene } from "./tf.js";
import { richteSchnitteEin } from "./schnitte.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const stapel = hole("stapel");
const meldung = hole("meldung");
const info = hole("info");
let volumen;
try {
  volumen = erstelleVolumen(canvas);
} catch (fehler) {
  meldung.hidden = false;
  meldung.textContent = fehler.message;
  throw fehler;
}
const schnitte = richteSchnitteEin({ axial: hole("axial"), koronal: hole("koronal"), sagittal: hole("sagittal") }, (s) => {
  setze("schnittX", s[0]);
  setze("schnittY", s[1]);
  setze("schnittZ", s[2]);
  zeichneSchnitte();
});

let geladen = null; // wie geladen (volle Auflösung)
let vol = null; // was gezeigt wird (vielleicht halbiert)
let fenster = [0, 1];
let gier = 0.6;
let nick = -0.35;
let zeit = 0;
let aufbauStart = null;
let exportLaeuft = false;
let neuZeichnen = true;

const { einstellung: e, setze } = richteReglerEin({
  beiAenderung: () => (neuZeichnen = true),
  extra: {
    aufloesung: () => zeige(geladen),
    gewebe: () => transfer(),
    von: () => transfer(),
    bis: () => transfer(),
    skala: () => transfer(),
    deckkraft: () => transfer(),
    gamma: () => transfer(),
    schnittX: () => zeichneSchnitte(),
    schnittY: () => zeichneSchnitte(),
    schnittZ: () => zeichneSchnitte(),
    aufbauen: () => (aufbauStart = e.aufbauen ? zeit : null),
    format: () => stelleFormat(),
  },
});
function melde(text) {
  meldung.hidden = !text;
  meldung.textContent = text ?? "";
}

// ---------- Laden ----------
function zeige(v) {
  if (!v) return;
  geladen = v;
  vol = e.aufloesung === "halb" ? halbiere(v) : v;
  try {
    volumen.setze(vol);
  } catch (fehler) {
    melde(`Die Grafikkarte nimmt das Volumen nicht (${fehler.message}). „halbe Auflösung“ versuchen.`);
    return;
  }
  schnitte.setze(vol);
  // Regler für das Fenster auf den Wertebereich der Daten stellen
  for (const name of ["von", "bis", "schwelle"]) {
    const feld = document.querySelector(`[data-wert="${name}"]`);
    feld.min = Math.floor(v.min);
    feld.max = Math.ceil(v.max);
    feld.step = v.max - v.min > 50 ? 1 : (v.max - v.min) / 500;
  }
  setze("von", v.ct ? -200 : v.min);
  setze("bis", v.ct ? 1200 : v.max);
  setze("schwelle", v.ct ? 300 : v.min + (v.max - v.min) * 0.5);
  setze("gewebe", v.ct ? "knochen" : "eigen");
  document.querySelectorAll("[data-nur-ct]").forEach((el) => (el.disabled = !v.ct));
  ["abstandX", "abstandY", "abstandZ"].forEach((id, i) => (hole(id).value = +v.abstand[i].toFixed(3)));
  const mb = (v.werte.byteLength / 1e6).toFixed(0);
  info.textContent = `${v.name}: ${v.b} × ${v.h} × ${v.t} Voxel, Voxelgröße ${v.abstand.map((x) => +x.toFixed(2)).join(" × ")}, Werte ${Math.round(v.min)} bis ${Math.round(v.max)}${v.ct ? " (CT, Hounsfield)" : ""}, ${mb} MB` + (vol !== v ? `; gezeigt halbiert: ${vol.b} × ${vol.h} × ${vol.t}` : "");
  transfer();
  zeichneSchnitte();
  melde("");
}
hole("datei").addEventListener("change", async (event) => {
  if (!event.target.files.length) return;
  melde("lädt …");
  try {
    zeige(await ladeDateien(event.target.files));
  } catch (fehler) {
    melde(fehler.message);
  }
});
// Voxelgröße von Hand (bei .raw ohne Kopf): ändert nur die Form, die Werte bleiben
for (const [i, id] of ["abstandX", "abstandY", "abstandZ"].entries()) {
  hole(id).addEventListener("change", () => {
    if (!geladen) return;
    const x = Number(hole(id).value);
    if (!(x > 0)) return;
    geladen.abstand[i] = x;
    if (vol !== geladen) vol.abstand[i] = x * 2; // halbiert: doppelt so große Voxel
    schnitte.setze(vol);
    zeichneSchnitte();
    neuZeichnen = true;
  });
}
hole("test").addEventListener("click", () => zeige(testkoerper(160)));
hole("bulb").addEventListener("click", () => zeige(mandelbulb(160)));

// ---------- Transferfunktion ----------
function transfer() {
  if (!vol) return;
  const tf = e.gewebe !== "eigen" && vol.ct ? ausPunkten(GEWEBE[e.gewebe]) : eigene(e.von, e.bis, e.skala, e.deckkraft, e.gamma);
  fenster = tf.fenster;
  volumen.setzeTf(tf.farben);
  zeichneSchnitte();
  neuZeichnen = true;
}
function zeichneSchnitte() {
  // die Schnitte zeigen immer das eigene Fenster (von, bis): beim Röntgen-Lesen braucht man das frei einstellbar
  schnitte.zeichne([e.von, e.bis], [e.schnittX, e.schnittY, e.schnittZ]);
}

// ---------- Kamera ----------
let ziehen = null;
stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture?.(event.pointerId);
  ziehen = { x: event.clientX, y: event.clientY };
});
stapel.addEventListener("pointermove", (event) => {
  if (!ziehen) return;
  gier -= (event.clientX - ziehen.x) * 0.008;
  nick = Math.max(-1.5, Math.min(1.5, nick - (event.clientY - ziehen.y) * 0.008));
  ziehen = { x: event.clientX, y: event.clientY };
  neuZeichnen = true;
});
for (const art of ["pointerup", "pointercancel"]) stapel.addEventListener(art, () => (ziehen = null));
stapel.addEventListener("wheel", (event) => {
  event.preventDefault();
  setze("abstand", Math.max(0.6, Math.min(5, e.abstand * Math.exp(event.deltaY * 0.001))));
  neuZeichnen = true;
}, { passive: false });

// Drehmatrix aus gier (um die senkrechte Achse) und nick; Spalten für GLSL (mat3 ist spaltenweise)
function drehung() {
  const cg = Math.cos(gier), sg = Math.sin(gier), cn = Math.cos(nick), sn = Math.sin(nick);
  // R = R_y(gier) · R_x(nick)
  return [cg, 0, -sg, sg * sn, cn, cg * sn, sg * cn, -sn, cg * cn];
}

function stelleFormat() {
  stapel.style.setProperty("--format", { quer: 16 / 9, quadrat: 1, hoch: 9 / 16 }[e.format] ?? 16 / 9);
  neuZeichnen = true;
}

// ---------- Zeichnen ----------
function schritt(dt) {
  zeit += dt;
  if (e.drehen) {
    gier += e.drehTempo * dt;
    neuZeichnen = true;
  }
  if (aufbauStart !== null) neuZeichnen = true;
}
function zeichne() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const b = Math.max(16, Math.round(stapel.clientWidth * dpr * e.bildAufloesung));
  const h = Math.max(16, Math.round(stapel.clientHeight * dpr * e.bildAufloesung));
  if (!exportLaeuft && (canvas.width !== b || canvas.height !== h)) {
    canvas.width = b;
    canvas.height = h;
  }
  // Aufbau: die Box wächst von unten nach oben, Schicht für Schicht (wie der Scanner sie aufnimmt)
  let zBis = e.zBis;
  if (aufbauStart !== null) zBis = Math.min(e.zBis, e.zVon + ((zeit - aufbauStart) / e.aufbauDauer) * (e.zBis - e.zVon));
  volumen.zeige({
    // MIP zeigt Graustufen im Fenster der Schnitte (von, bis), alles andere das der Transferfunktion
    fenster: e.art === "mip" ? [e.von, e.bis] : fenster,
    art: { volumen: 0, oberflaeche: 1, mip: 2, roentgen: 3 }[e.art],
    schwelle: e.schwelle,
    dichte: e.dichte,
    schritt: e.schritt,
    licht: e.licht,
    grund: hexZuRgb(e.grund).map((x) => x / 255),
    oberFarbe: hexZuRgb(e.oberFarbe).map((x) => x / 255),
    dreh: drehung(),
    abstand: e.abstand,
    boxVon: [e.xVon, e.yVon, e.zVon],
    boxBis: [e.xBis, e.yBis, zBis],
  });
}

let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    schritt(dt);
    // nur neu rechnen, wenn sich etwas geändert hat (große Volumen kosten viel)
    if (neuZeichnen || stapel.clientWidth * Math.min(devicePixelRatio || 1, 2) * e.bildAufloesung !== canvas.width) {
      zeichne();
      neuZeichnen = false;
    }
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
const render = {
  start() {
    exportLaeuft = true;
  },
  bild(i, dt) {
    schritt(dt);
    zeichne();
  },
  ende() {
    exportLaeuft = false;
    neuZeichnen = true;
  },
  merke() {
    const alt = { gier, zeit, aufbauStart };
    return () => {
      ({ gier, zeit, aufbauStart } = alt);
      neuZeichnen = true;
    };
  },
  vorschau(i, n, dt) {
    for (let j = 0; j < i; j++) schritt(dt);
    zeichne();
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: () => `volumen-${(vol?.name ?? "leer").replace(/\.[^.]+$/, "")}`,
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
});

stelleFormat();
zeige(testkoerper(128));
requestAnimationFrame(schleife);
