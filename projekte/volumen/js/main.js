// Volumen-Viewer: die Seite. Zusammengesteckt aus
//   laden.js     NRRD/RAW lesen, Testkörper und Mandelbulb rechnen
//   volumen.js   3D-Textur und Strahlen (Volumen, Oberfläche, MIP, Röntgen)
//   tf.js        Transferfunktion (Gewebe-Voreinstellungen für CT, eigene)
//   schnitte.js  axial, koronal, sagittal (und dort mit dem Pinsel ausblenden)
//   maske.js     was ausgeblendet ist (Pinsel, Schere)
//   sim3d.js     Strömung in 3D auf der Grafikkarte (Rayleigh-Taylor, Wolkentank, Tropfen Tinte)
// Später soll hier auch Rayleigh-Taylor 3D gezeigt werden (dieselbe Darstellung, die Werte kommen dann aus einer
// Simulation statt aus einer Datei).

import { ladeDateien, testkoerper, mandelbulb, halbiere } from "./laden.js";
import { erstelleVolumen } from "./volumen.js";
import { GEWEBE, ausPunkten, eigene } from "./tf.js";
import { richteSchnitteEin } from "./schnitte.js";
import { erstelleMaske, merke, rueckgaengig, allesZeigen, pinsel, schere, stueck } from "./maske.js";
import { erstelleSimulation } from "./sim3d.js";
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
const schnitte = richteSchnitteEin(
  { axial: hole("axial"), koronal: hole("koronal"), sagittal: hole("sagittal") },
  (s) => {
    setze("schnittX", s[0]);
    setze("schnittY", s[1]);
    setze("schnittZ", s[2]);
    zeichneSchnitte();
  },
  (q, achse, wann) => malen(q, achse, wann),
  () => e.werkzeug,
);

let geladen = null; // wie geladen (volle Auflösung)
let vol = null; // was gezeigt wird (vielleicht halbiert)
let fenster = [0, 1];
let gier = 0.6;
let nick = -0.35;
let zeit = 0;
let aufbauStart = null;
let exportLaeuft = false;
let neuZeichnen = true;
let maske = null;
// Ausrichtung des Volumens (spaltenweise wie im Shader). Für CT: Kopf nach oben, Gesicht zur Kamera.
// Die Achsen im CT (DICOM, „LPS“): x zur linken Seite des Patienten, y nach hinten, z zum Kopf. Die Kamera schaut
// am Anfang von +z auf die Mitte, oben ist +y. Also: Welt-x = x, Welt-y = z, Welt-z = −y (Drehung um x um −90°).
const EINHEIT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const KOPF_OBEN = [1, 0, 0, 0, 0, -1, 0, 1, 0];
let lage = EINHEIT;

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
    ziehen: () => (stapel.style.cursor = e.ziehen === "drehen" ? "" : "crosshair"),
  },
});
function melde(text) {
  meldung.hidden = !text;
  meldung.textContent = text ?? "";
}

// ---------- Laden ----------
function zeige(v) {
  if (!v) return;
  if (v !== geladen) {
    // neues Volumen: neue Maske, Ausrichtung passend zur Art
    maske = erstelleMaske(v.b, v.h, v.t);
    schnitte.setzeMaske(maske);
    lage = v.ct ? KOPF_OBEN : EINHEIT;
  }
  geladen = v;
  vol = e.aufloesung === "halb" && !v.sim ? halbiere(v) : v;
  try {
    if (v.sim) volumen.setzeFremd(sim.textur(), vol);
    else volumen.setze(vol);
  } catch (fehler) {
    melde(`Die Grafikkarte nimmt das Volumen nicht (${fehler.message}). „halbe Auflösung“ versuchen.`);
    return;
  }
  schnitte.setze(vol);
  // Regler für das Fenster auf den Wertebereich der Daten stellen
  for (const name of ["von", "bis", "schwelle", "grenze"]) {
    const feld = document.querySelector(`[data-wert="${name}"]`);
    feld.min = Math.floor(v.min);
    feld.max = Math.ceil(v.max);
    feld.step = v.max - v.min > 50 ? 1 : (v.max - v.min) / 500;
  }
  setze("von", v.ct ? -200 : v.min);
  setze("bis", v.ct ? 1200 : v.max);
  setze("schwelle", v.ct ? 300 : v.min + (v.max - v.min) * 0.5);
  setze("grenze", v.ct ? 200 : Math.round((v.min + (v.max - v.min) * 0.3) * 100) / 100);
  setze("gewebe", v.ct ? "knochen" : "eigen");
  document.querySelectorAll("[data-nur-ct]").forEach((el) => (el.disabled = !v.ct));
  ["abstandX", "abstandY", "abstandZ"].forEach((id, i) => (hole(id).value = +v.abstand[i].toFixed(3)));
  const mb = (v.werte.byteLength / 1e6).toFixed(0);
  info.textContent = `${v.name}: ${v.b} × ${v.h} × ${v.t} Voxel, Voxelgröße ${v.abstand.map((x) => +x.toFixed(2)).join(" × ")}, Werte ${Math.round(v.min)} bis ${Math.round(v.max)}${v.ct ? " (CT, Hounsfield)" : ""}, ${mb} MB` + (vol !== v ? `; gezeigt halbiert: ${vol.b} × ${vol.h} × ${vol.t}` : "");
  transfer();
  zeichneSchnitte();
  melde("");
}
for (const id of ["datei", "ordner"]) hole(id).addEventListener("change", async (event) => {
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
let umriss = null; // Punkte der Schere (Anteile 0 bis 1 im Bild)
const lassoLinie = document.querySelector("#lasso polyline");
function imBild(event) {
  const r = stapel.getBoundingClientRect();
  return [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height];
}
stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture?.(event.pointerId);
  if (e.ziehen !== "drehen" && vol) {
    umriss = [imBild(event)];
    return;
  }
  ziehen = { x: event.clientX, y: event.clientY };
});
stapel.addEventListener("pointermove", (event) => {
  if (umriss) {
    umriss.push(imBild(event));
    lassoLinie.setAttribute("points", umriss.map((p) => p.join(",")).join(" "));
    return;
  }
  if (!ziehen) return;
  gier -= (event.clientX - ziehen.x) * 0.008;
  nick = Math.max(-1.5, Math.min(1.5, nick - (event.clientY - ziehen.y) * 0.008));
  ziehen = { x: event.clientX, y: event.clientY };
  neuZeichnen = true;
});
for (const art of ["pointerup", "pointercancel"]) stapel.addEventListener(art, () => {
  ziehen = null;
  if (umriss) {
    if (umriss.length > 2 && art === "pointerup") schneide(umriss);
    umriss = null;
    lassoLinie.setAttribute("points", "");
  }
});
stapel.addEventListener("wheel", (event) => {
  event.preventDefault();
  setze("abstand", Math.max(0.6, Math.min(5, e.abstand * Math.exp(event.deltaY * 0.001))));
  neuZeichnen = true;
}, { passive: false });

// ---------- Ausblenden: Schere und Pinsel ----------
// Schere: den Umriss in ein kleines Bild füllen (das macht der Browser), dann jede Zelle der Maske dort nachsehen
function schneide(punkte) {
  const breite = Math.min(640, canvas.width);
  const hoehe = Math.round((breite * canvas.height) / canvas.width);
  const bild = new OffscreenCanvas(breite, hoehe);
  const ctx = bild.getContext("2d");
  ctx.beginPath();
  for (const [x, y] of punkte) ctx.lineTo(x * breite, y * hoehe);
  ctx.closePath();
  ctx.fill();
  const pixel = ctx.getImageData(0, 0, breite, hoehe).data;
  const innen = new Uint8Array(breite * hoehe);
  for (let i = 0; i < innen.length; i++) innen[i] = pixel[i * 4 + 3] > 127 ? 1 : 0;
  merke(maske);
  schere(maske, { breite, hoehe, innen }, { lage, dreh: drehung(), abstand: e.abstand, seite: canvas.width / canvas.height, groesse: groesse() }, e.ziehen === "schereInnen" ? "innen" : "aussen");
  zeichneSchnitte();
  neuZeichnen = true;
}
// echte Ausdehnung, größte Seite 1 (wie im Shader)
function groesse() {
  const echt = [vol.b * vol.abstand[0], vol.h * vol.abstand[1], vol.t * vol.abstand[2]];
  const m = Math.max(...echt);
  return echt.map((x) => x / m);
}
let malZeit = 0;
function malen(q, achse, wann) {
  if (!maske) return;
  if (e.werkzeug.startsWith("stueck")) {
    // ein Klick: das zusammenhängende Stück unter dem Punkt behalten oder ausblenden
    if (wann !== "anfang") return;
    merke(maske);
    const zellen = stueck(maske, geladen, q, e.grenze, e.werkzeug === "stueckWeg" ? "weg" : "behalten");
    if (!zellen) {
      rueckgaengig(maske);
      melde(`Dort ist nichts über der Grenze (${e.grenze}) oder es ist schon ausgeblendet.`);
    } else melde("");
    zeichneSchnitte();
    neuZeichnen = true;
    return;
  }
  if (wann === "anfang") merke(maske);
  pinsel(maske, q, e.pinsel, groesse(), e.werkzeug === "radieren" ? 0 : 255, e.durchAlle ? achse : -1);
  neuZeichnen = true;
  // die Schnitte neu zeichnen kostet bei großen Scans: höchstens 20-mal pro Sekunde
  const jetzt = performance.now();
  if (jetzt - malZeit > 50 || wann === "anfang") {
    malZeit = jetzt;
    zeichneSchnitte();
  }
}
hole("rueckgaengig").addEventListener("click", () => {
  if (maske && rueckgaengig(maske)) {
    zeichneSchnitte();
    neuZeichnen = true;
  }
});
hole("allesZeigen").addEventListener("click", () => {
  if (!maske) return;
  allesZeigen(maske);
  zeichneSchnitte();
  neuZeichnen = true;
});

// ---------- Ausrichtung und Ansicht ----------
// 3 × 3 spaltenweise multiplizieren: (A · B)
function mal(A, B) {
  const C = new Array(9);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) C[3 * j + i] = A[i] * B[3 * j] + A[3 + i] * B[3 * j + 1] + A[6 + i] * B[3 * j + 2];
  return C;
}
// 90° um eine Achse der Welt (spaltenweise); spiegeln: links und rechts tauschen
const DREHE = {
  x: [1, 0, 0, 0, 0, 1, 0, -1, 0],
  y: [0, 0, -1, 0, 1, 0, 1, 0, 0],
  z: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  spiegeln: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
};
for (const knopf of document.querySelectorAll("[data-lage]")) {
  knopf.addEventListener("click", () => {
    const art = knopf.dataset.lage;
    if (art === "zurueck") lage = vol?.ct ? KOPF_OBEN : EINHEIT;
    else if (art === "roh") lage = EINHEIT;
    else lage = mal(DREHE[art], lage);
    neuZeichnen = true;
  });
}
const ANSICHTEN = { vorn: [0, 0], links: [-Math.PI / 2, 0], rechts: [Math.PI / 2, 0], hinten: [Math.PI, 0], oben: [0, -1.5], unten: [0, 1.5] };
for (const knopf of document.querySelectorAll("[data-ansicht]")) {
  knopf.addEventListener("click", () => {
    [gier, nick] = ANSICHTEN[knopf.dataset.ansicht];
    neuZeichnen = true;
  });
}

// ---------- Simulation ----------
let sim = null;
let simZeit = 0;
let simLesen = 0;
// Voreinstellungen je Versuch: Größe des Tanks (relativ zur Gitterzahl) und wie es aussieht
const VERSUCHE = {
  rt: { nummer: 0, form: [1, 1, 1], name: "Rayleigh-Taylor", skala: "eis", deckkraft: 0.35, gamma: 1.2, von: 0.05 },
  wolken: { nummer: 1, form: [1.5, 1, 1], name: "Wolkentank", skala: "grau", deckkraft: 0.18, gamma: 1.4, von: 0.02 },
  tropfen: { nummer: 2, form: [1, 1.25, 1], name: "Tropfen Tinte", skala: "glut", deckkraft: 0.3, gamma: 1.3, von: 0.03 },
};
function simStarten() {
  try {
    sim ??= erstelleSimulation(volumen.gl);
  } catch (fehler) {
    return melde(fehler.message);
  }
  const v = VERSUCHE[e.simArt];
  const N = Number(e.simGitter);
  const groesse = v.form.map((f) => Math.round(f * N));
  sim.neu(groesse, v.nummer, { unruhe: e.simUnruhe, schicht: e.simSchicht, saat: Math.random() * 100 });
  simZeit = 0;
  simLesen = 0;
  const [b, h, t] = groesse;
  zeige({ b, h, t, werte: new Float32Array(b * h * t), abstand: [1, 1, 1], name: v.name, ct: false, min: 0, max: 1, sim: true });
  setze("gewebe", "eigen");
  setze("von", v.von);
  setze("bis", 1);
  setze("skala", v.skala);
  setze("deckkraft", v.deckkraft);
  setze("gamma", v.gamma);
  setze("art", "volumen");
  transfer();
  neuZeichnen = true;
}
function simSchritt(dt) {
  const t = dt * e.simTempo;
  if (t <= 0) return;
  // große Zeitschritte in kleinere teilen (höchstens 1/30 s), sonst rechnet die Mitnahme zu grob
  const k = Math.ceil(t / (1 / 30));
  for (let i = 0; i < k; i++) {
    sim.schritt(t / k, { auftrieb: e.simSchwere, salz: e.simSalz, duese: e.simDuese, strahl: e.simStrahl, jacobi: e.simJacobi });
  }
  simZeit += t;
  neuZeichnen = true;
  // ab und zu die Werte auf die CPU holen: für die Schnitte, den Pinsel und „Stück behalten“ (kostet: nicht jedes Bild)
  if (hole("schnitteAbschnitt").open && simZeit - simLesen > 0.5) {
    simLesen = simZeit;
    sim.lies(vol.werte);
    zeichneSchnitte();
  }
}
hole("simStart").addEventListener("click", simStarten);

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
  if (vol?.sim && !e.simPause) simSchritt(dt);
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
  // Aufbau: die Box wächst Schicht für Schicht entlang einer Achse, in die gewählte Richtung
  // (z vorwärts ist wie der Scanner aufnimmt: vom Fuß zum Kopf). „immer wieder“: nach dem Ende kurz ganz, dann neu.
  const von = [e.xVon, e.yVon, e.zVon];
  const bis = [e.xBis, e.yBis, e.zBis];
  if (aufbauStart !== null) {
    let s = (zeit - aufbauStart) / e.aufbauDauer;
    s = e.aufbauSchleife ? Math.min(1, s % 1.25) : Math.min(1, s);
    const k = { x: 0, y: 1, z: 2 }[e.aufbauRichtung[0]];
    if (e.aufbauRichtung[1] === "+") bis[k] = von[k] + s * (bis[k] - von[k]);
    else von[k] = bis[k] - s * (bis[k] - von[k]);
  }
  if (maske?.geaendert) volumen.setzeMaske(maske);
  if (vol?.sim) volumen.setzeFremd(sim.textur(), vol); // die Simulation rechnet abwechselnd in zwei Texturen
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
    lage,
    abstand: e.abstand,
    boxVon: von,
    boxBis: bis,
  });
}

let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    schritt(dt);
    // nur neu rechnen, wenn sich etwas geändert hat (große Volumen kosten viel)
    // (gerundet vergleichen wie in zeichne(), sonst ist es nie gleich und es würde jedes Bild neu gerechnet)
    if (neuZeichnen || Math.max(16, Math.round(stapel.clientWidth * Math.min(devicePixelRatio || 1, 2) * e.bildAufloesung)) !== canvas.width) {
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
      ({ gier, zeit, aufbauStart } = alt); // (nicht die Maske: die ändert sich beim Rendern nicht)
      neuZeichnen = true;
    };
  },
  vorschau(i, n, dt) {
    // die Simulation lässt sich nicht zurückspulen: in der Vorschau steht sie still
    const p = e.simPause;
    e.simPause = true;
    for (let j = 0; j < i; j++) schritt(dt);
    e.simPause = p;
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
