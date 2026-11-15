// Marmorpapier: die Seite. Zusammengesteckt aus
//   zuege.js  was ein Tropfen, eine Nadel, ein Kamm … mit der Farbe macht (und die Vorlagen)
//   bild.js   rückwärts zeichnen auf der Grafikkarte
// Hier: Maus und Finger werden zu Zügen, Rückgängig, Abspielen, Speichern, Export.
//
// Das ganze Bild ist nur eine Liste von Zügen. Neu gezeichnet wird nur, wenn sich etwas ändert (oder beim
// Abspielen): das Rückwärtsrechnen kostet bei vielen Zügen spürbar.

import { tropfen, nadel, kamm, welle, wirbel, stift, VORLAGEN, PALETTEN, zufallVon } from "./zuege.js";
import { erstelleBild, MAX } from "./bild.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteExportEin, ladeHerunter } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const status = hole("status");
let bild;
try {
  bild = erstelleBild(canvas);
} catch (fehler) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = fehler.message;
  throw fehler;
}

let formatRatio = 1;
let zuege = [];     // alle Züge, je 8 Zahlen (zuege.js)
let gruppen = [];   // wo jede Handlung anfängt (ein Strich, ein Regen …): Rückgängig nimmt eine ganze Gruppe
let version = 0;    // ändert sich mit der Liste: dann lädt bild.js sie neu hoch
let sichtbar = Infinity; // beim Abspielen: wie viele Züge schon zu sehen sind (12.4: der 13. ist zu 40 % fertig)
let abspielen = false;
let exportLaeuft = false;
let farbIndex = 0;
let zieht = false;  // während des Ziehens ohne Kantenglättung (schneller)

const { einstellung: e, setze } = richteReglerEin({
  beiAenderung: () => zeichneBald(),
  extra: {
    bildgroesse: () => passeBildgroesseAn(),
    palette: () => zeigePalette(),
    eigeneFarbe: () => zeigePalette(),
  },
});

const breite = () => canvas.width / canvas.height;
const rgb = (hex) => hexZuRgb(hex).map((x) => x / 255);
const farben = () => (e.palette === "eigen" ? [e.eigeneFarbe] : PALETTEN[e.palette]).map(rgb);

// die nächste Farbe aus der Palette (der Reihe nach, wie man beim Ebru die Pinsel nacheinander nimmt)
function naechsteFarbe() {
  const liste = farben();
  const f = liste[farbIndex % liste.length];
  farbIndex = (farbIndex + 1) % liste.length;
  zeigePalette();
  return f;
}

function zeigePalette() {
  const ziel = hole("paletten-vorschau");
  const liste = e.palette === "eigen" ? [e.eigeneFarbe] : PALETTEN[e.palette];
  ziel.replaceChildren(...liste.map((hex, i) => {
    const s = document.createElement("span");
    s.style.background = hex;
    if (i === farbIndex % liste.length) s.className = "naechste";
    return s;
  }));
}

// ---------- Liste der Züge ----------
function neueGruppe() {
  gruppen.push(zuege.length);
}
function dazu(zug) {
  if (zuege.length >= MAX) {
    melde(`Mehr als ${MAX} Züge gehen nicht. Rückgängig oder Wasser leeren hilft.`);
    return false;
  }
  zuege.push(zug);
  version++;
  zeichneBald();
  return true;
}
function rueckgaengig() {
  if (!gruppen.length) return;
  zuege.length = gruppen.pop();
  version++;
  zeichneBald();
}
function leeren() {
  zuege = [];
  gruppen = [];
  version++;
  zeichneBald();
}

// ---------- Zeichnen ----------
let geplant = false;
function zeichneBald() {
  if (geplant || exportLaeuft) return;
  geplant = true;
  requestAnimationFrame(() => {
    geplant = false;
    zeichne();
  });
}

function zeichne() {
  const n = Math.min(zuege.length, Math.ceil(sichtbar));
  const teil = sichtbar >= zuege.length ? 1 : sichtbar - Math.floor(sichtbar) || 1;
  bild.zeige(n === zuege.length ? zuege : zuege.slice(0, n), `${version}/${n}`, {
    teil,
    wasser: rgb(e.wasser),
    papier: rgb(e.papier),
    raender: e.raender,
    koernung: e.koernung,
    struktur: e.struktur,
    glatt: e.glatt && !zieht,
  });
  status.textContent = `${zuege.length} Züge` + (zuege.length > MAX * 0.8 ? ` (höchstens ${MAX})` : "");
}

function passeBildgroesseAn() {
  const lang = Number(e.bildgroesse);
  canvas.width = Math.max(1, Math.round(formatRatio >= 1 ? lang : lang * formatRatio));
  canvas.height = Math.max(1, Math.round(formatRatio >= 1 ? lang / formatRatio : lang));
  hole("stapel").style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  zeichneBald();
}
window.addEventListener("formatwechsel", (event) => {
  const ratio = Number(event.detail?.ratio);
  if (!(ratio > 0)) return;
  formatRatio = ratio;
  passeBildgroesseAn();
});

// ---------- Maus und Finger ----------
// Position im Wasser: x von 0 bis Breite / Höhe, y von 0 (oben) bis 1
function lage(event) {
  const r = canvas.getBoundingClientRect();
  return [((event.clientX - r.left) / r.width) * breite(), (event.clientY - r.top) / r.height];
}
const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const winkel = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

let start = null; // wo das Ziehen anfing
let zuletzt = null; // wo der letzte Tropfen oder das letzte Stück Strich war
let vorlaeufig = -1; // Nadel und Kamm: der Zug, der beim Ziehen noch mitwächst

canvas.addEventListener("pointerdown", (event) => {
  if (exportLaeuft) return;
  stoppeAbspielen();
  canvas.setPointerCapture(event.pointerId);
  start = zuletzt = lage(event);
  zieht = true;
  neueGruppe();
  const w = e.werkzeug;
  if (w === "tropfen") dazu(tropfen(start, e.radius, naechsteFarbe()));
  else if (w === "regen") regen();
  else if (w === "wirbel") dazu(wirbel(start, e.drehung, e.reichweite));
  else if (w === "nadel" || w === "kamm") {
    vorlaeufig = zuege.length;
    dazu(gerade(start, start));
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!start) return;
  const p = lage(event);
  const w = e.werkzeug;
  if (w === "tropfen" && abstand(p, zuletzt) >= e.tropfAbstand) {
    dazu(tropfen(p, e.radius, naechsteFarbe()));
    zuletzt = p;
  } else if (w === "stift") {
    // ein Strich aus kurzen Stücken; jedes zieht die Farbe um seine Länge (mal „Zug“) mit
    const schritt = Math.max(0.006, e.spitze * 0.7);
    while (abstand(p, zuletzt) >= schritt) {
      const a = winkel(zuletzt, p);
      const naechster = [zuletzt[0] + Math.cos(a) * schritt, zuletzt[1] + Math.sin(a) * schritt];
      const mitte = [(zuletzt[0] + naechster[0]) / 2, (zuletzt[1] + naechster[1]) / 2];
      if (!dazu(stift(mitte, a, schritt * e.zug, e.spitze))) break;
      zuletzt = naechster;
    }
  } else if (vorlaeufig >= 0) {
    zuege[vorlaeufig] = gerade(start, p);
    version++;
    zeichneBald();
  }
});

function loslassen() {
  if (!start) return;
  // eine Nadel, die gar nicht gezogen wurde, oder eine leere Gruppe: weg damit
  if (vorlaeufig >= 0 && zuege[vorlaeufig][4] === 0) zuege.length = vorlaeufig;
  if (gruppen.length && gruppen.at(-1) === zuege.length) gruppen.pop();
  start = zuletzt = null;
  vorlaeufig = -1;
  zieht = false;
  version++;
  zeichneBald();
}
canvas.addEventListener("pointerup", loslassen);
canvas.addEventListener("pointercancel", loslassen);

// Nadel oder Kamm von a nach b: die Richtung gibt der Strich, die Stärke seine Länge
function gerade(a, b) {
  const z = abstand(a, b) * e.zug;
  if (e.werkzeug === "kamm") return kamm(a, winkel(a, b), z, e.spitze, e.zinken);
  return nadel(a, winkel(a, b), z, e.spitze);
}

function regen() {
  const z = zufallVon(Math.random());
  for (let i = 0; i < e.regenAnzahl; i++) {
    const r = e.radius * (1 - e.regenStreuung * z());
    if (!dazu(tropfen([z() * breite(), z()], r, naechsteFarbe(), z()))) break;
  }
}

// ---------- Knöpfe ----------
hole("zurueck").addEventListener("click", rueckgaengig);
hole("leeren").addEventListener("click", leeren);
hole("welle").addEventListener("click", () => {
  neueGruppe();
  dazu(welle(Math.random() * Math.PI, 0.03 * e.zug, 0.15 + Math.random() * 0.2, Math.random() * 6.28));
});
hole("kammQuer").addEventListener("click", () => {
  neueGruppe();
  dazu(kamm([0, 0], Math.PI / 2, 0.1 * e.zug, e.spitze, e.zinken));
});
hole("kammLaengs").addEventListener("click", () => {
  neueGruppe();
  dazu(kamm([0, 0], 0, 0.1 * e.zug, e.spitze, e.zinken));
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "z") {
    event.preventDefault();
    rueckgaengig();
  }
});

function ladeVorlage() {
  const name = hole("vorlage").value;
  if (!name) return;
  stoppeAbspielen();
  zuege = VORLAGEN[name](breite(), farben(), zufallVon(e.saat + 0.5));
  gruppen = [0];
  farbIndex = 0;
  version++;
  zeigePalette();
  zeichneBald();
}
hole("vorlage").addEventListener("change", ladeVorlage);
hole("neuWuerfeln").addEventListener("click", () => {
  setze("saat", Math.floor(Math.random() * 10000));
  ladeVorlage();
});

// ---------- Abspielen ----------
function stoppeAbspielen() {
  abspielen = false;
  sichtbar = Infinity;
}
let vorher = 0;
function spiele(jetzt) {
  if (!abspielen) return;
  sichtbar += ((jetzt - vorher) / 1000) * e.tempo;
  vorher = jetzt;
  if (sichtbar >= zuege.length) stoppeAbspielen();
  zeichne();
  if (abspielen) requestAnimationFrame(spiele);
}
hole("abspielen").addEventListener("click", () => {
  if (!zuege.length) return;
  abspielen = true;
  sichtbar = 0;
  vorher = performance.now();
  requestAnimationFrame(spiele);
});

// ---------- Muster speichern und laden ----------
hole("musterSpeichern").addEventListener("click", () => {
  const daten = { art: "marmor", breite: breite(), zuege: zuege.map((z) => z.map((x) => Math.round(x * 1e5) / 1e5)) };
  ladeHerunter(new Blob([JSON.stringify(daten)], { type: "application/json" }), "marmor-muster.json");
});
hole("musterLaden").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  try {
    const daten = JSON.parse(await datei.text());
    if (daten.art !== "marmor" || !Array.isArray(daten.zuege)) throw new Error("Das ist kein Muster von dieser Seite.");
    stoppeAbspielen();
    zuege = daten.zuege.slice(0, MAX);
    gruppen = [0];
    version++;
    zeichneBald();
  } catch (fehler) {
    melde(fehler.message);
  }
  event.target.value = "";
});

// ---------- Export: das Video spielt das Muster von vorn ab ----------
let gemerkt = Infinity;
const render = {
  start() {
    exportLaeuft = true;
    abspielen = false;
    sichtbar = 0;
  },
  bild(i, dt) {
    sichtbar = Math.min(zuege.length, sichtbar + dt * e.tempo);
    zeichne();
  },
  ende() {
    exportLaeuft = false;
    sichtbar = Infinity;
    zeichneBald();
  },
  merke() {
    gemerkt = sichtbar;
    return () => {
      sichtbar = gemerkt;
      zeichne();
    };
  },
  vorschau(i, n, dt) {
    sichtbar = Math.min(zuege.length, i * dt * e.tempo);
    zeichne();
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "marmor",
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
  dauer: () => (zuege.length ? Math.ceil(zuege.length / e.tempo) + 1 : null), // ganz abspielen, dann 1 s stehen
});

// ---------- Helfer ----------
function hole(id) {
  return document.getElementById(id);
}
let meldungsUhr = 0;
function melde(text) {
  const m = hole("meldung");
  m.hidden = false;
  m.textContent = text;
  clearTimeout(meldungsUhr);
  meldungsUhr = setTimeout(() => (m.hidden = true), 5000);
}

passeBildgroesseAn();
zeigePalette();
// zum Anfang ein Muster, damit nicht nur leeres Wasser zu sehen ist
hole("vorlage").value = "gelgit";
ladeVorlage();
hole("vorlage").value = "";
