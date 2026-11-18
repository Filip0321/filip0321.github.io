// Wellenwanne: die Seite. Zusammengesteckt aus
//   wanne.js     die Wellengleichung auf der Grafikkarte (Theorie dort)
//   medium.js    Wände, Glas, Schwamm am Rand
//   vorlagen.js  Spalt, Doppelspalt, Gitter, Linse, Parabolspiegel, Ellipse
// Hier: Werkzeuge (Tropfen, Quelle, Wand, Glas, Radieren), Lauschen (ein Mikrofon in der Wanne macht hörbar, wie
// laut es an einer Stelle schwingt), Musik, Export.

import { erstelleWanne } from "./wanne.js";
import { erstelleMedium } from "./medium.js";
import { VORLAGEN } from "./vorlagen.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const hole = (id) => document.getElementById(id);
const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const marken = hole("marken"); // Quellen und Mikrofon als Zeichen darüber (nicht im Export)
const status = hole("status");
let wanne;
try {
  wanne = erstelleWanne(canvas);
} catch (fehler) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = fehler.message;
  throw fehler;
}
const medium = erstelleMedium();

let quellen = []; // { x, y, start, dauer (Schritte, Infinity: dauernd) }
let ebeneAn = false;
let laeuft = true, exportLaeuft = false;
let formatRatio = 1;
let mikrofon = { x: 0.75, y: 0.5 };
let mediumNeu = true;

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    aufloesung: () => neueGroesse(),
    brechzahl: (v) => {
      medium.setzeBrechzahl(v);
      mediumNeu = true;
    },
    lauschen: () => schalteLauschen(),
  },
});

// Wellenlänge in Zellen ↔ Frequenz in Schwingungen pro Schritt: die Welle kommt 0,5 Zellen pro Schritt weit
// (Courant-Zahl in wanne.js), also λ = 0,5 / f
const frequenz = () => (0.5 / e.wellenlaenge) * (1 + 0.6 * (musik.wirkung.frequenz ?? 0));

// ---------- Größe ----------
function neueGroesse() {
  const lang = Number(e.aufloesung);
  const b = Math.round(formatRatio >= 1 ? lang : lang * formatRatio), h = Math.round(formatRatio >= 1 ? lang / formatRatio : lang);
  canvas.width = marken.width = b;
  canvas.height = marken.height = h;
  hole("stapel").style.aspectRatio = `${b} / ${h}`;
  wanne.groesse(b, h);
  medium.groesse(b, h);
  ladeVorlage(hole("vorlage").value);
}
window.addEventListener("formatwechsel", (ev) => {
  const r = Number(ev.detail?.ratio);
  if (!(r > 0)) return;
  formatRatio = r;
  neueGroesse();
});

function ladeVorlage(name) {
  const v = VORLAGEN[name] ?? VORLAGEN.zweiQuellen;
  medium.leeren();
  wanne.leeren();
  const { quellen: q, ebene, pulse } = v.baue(medium.zeichner(), e.wellenlaenge);
  quellen = q.map((s) => ({ ...s, start: 0, dauer: pulse ? 2 / frequenz() : Infinity }));
  ebeneAn = ebene;
  hole("ebene").checked = ebene;
  mediumNeu = true;
}
hole("vorlage").addEventListener("change", (ev) => ladeVorlage(ev.target.value));
hole("ebene").addEventListener("change", (ev) => (ebeneAn = ev.target.checked));
hole("wasser-ruhig").addEventListener("click", () => wanne.leeren());
hole("quellen-weg").addEventListener("click", () => (quellen = []));
hole("waende-weg").addEventListener("click", () => {
  medium.leeren();
  mediumNeu = true;
});
const pauseKnopf = hole("pause");
pauseKnopf.addEventListener("click", () => {
  laeuft = !laeuft;
  pauseKnopf.textContent = laeuft ? "Pause" : "Weiter";
});

// ---------- Maus und Finger ----------
const lage = (ev) => {
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
};
// Quellen und Mikrofon zum Anfassen: die nächste innerhalb von 3 % der Breite
function naechste(p) {
  let beste = null, d0 = 0.03;
  for (const q of quellen) {
    const d = Math.hypot((q.x - p.x) * formatRatio, q.y - p.y);
    if (d < d0) [beste, d0] = [q, d];
  }
  if (Math.hypot((mikrofon.x - p.x) * formatRatio, mikrofon.y - p.y) < d0 && e.lauschen) beste = mikrofon;
  return beste;
}
let zug = null;
canvas.addEventListener("pointerdown", (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  const p = lage(ev);
  const greift = naechste(p);
  // rechte Maustaste oder Alt: Quelle löschen
  if (greift && greift !== mikrofon && (ev.button === 2 || ev.altKey)) {
    quellen = quellen.filter((q) => q !== greift);
    return;
  }
  if (greift) zug = { art: "schieben", ding: greift };
  else if (e.werkzeug === "tropfen") quellen.push({ ...p, start: wanne.zeit, dauer: 1 / frequenz() });
  else if (e.werkzeug === "quelle") quellen.push({ ...p, start: wanne.zeit, dauer: Infinity });
  else zug = { art: "malen", letzte: p };
  if (zug?.art === "malen") male(p, p);
});
canvas.addEventListener("pointermove", (ev) => {
  if (!zug) return;
  const p = lage(ev);
  if (zug.art === "schieben") Object.assign(zug.ding, { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) });
  else {
    male(zug.letzte, p);
    zug.letzte = p;
  }
});
const los = () => (zug = null);
canvas.addEventListener("pointerup", los);
canvas.addEventListener("pointercancel", los);
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
function male(a, b) {
  medium.male(e.werkzeug, a.x, a.y, b.x, b.y, e.pinsel);
  mediumNeu = true;
}

// ---------- Lauschen ----------
// Ein Mikrofon in der Wanne: an seiner Stelle wird die Intensität gelesen (ein Pixel pro Bild) und als Lautstärke
// eines Tons benutzt, dessen Höhe der Frequenz der Quellen folgt (8800 · f: bei λ = 25 Zellen 176 Hz). Zieht man
// es durch die Streifen hinter dem Doppelspalt, hört man hell und dunkel als laut und leise.
let ton = null;
function schalteLauschen() {
  if (e.lauschen && !ton) {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(ctx.destination);
    osc.start();
    ton = { ctx, osc, g };
  } else if (!e.lauschen && ton) {
    ton.ctx.close();
    ton = null;
  }
}
function lausche() {
  if (!ton) return;
  const w = wanne.lies(mikrofon.x, 1 - mikrofon.y);
  const t = ton.ctx.currentTime;
  ton.osc.frequency.setTargetAtTime(8800 * frequenz(), t, 0.05);
  ton.g.gain.setTargetAtTime(Math.min(0.5, Math.sqrt(Math.max(0, w.i)) * 0.8), t, 0.05);
}

// ---------- Musik ----------
const musik = richteAudioreaktivEin({
  ziele: { staerke: "Wellen stärker", frequenz: "Frequenz steigt", tropfen: "Tropfen (Schlag)" },
  start: { bass: "staerke", schlag: "tropfen" },
  beiStart: () => {},
});
let warSchlag = false;

// ---------- Schritt und Bild ----------
function schritt(n) {
  const f = frequenz();
  const a = e.staerke * (1 + 1.5 * (musik.wirkung.staerke ?? 0));
  // Tropfen aus der Musik: bei jedem neuen Schlag einer an einer zufälligen Stelle
  const schlag = (musik.wirkung.tropfen ?? 0) > 0.5;
  if (schlag && !warSchlag) quellen.push({ x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6, start: wanne.zeit, dauer: 1 / f });
  warSchlag = schlag;
  quellen = quellen.filter((q) => wanne.zeit - q.start < q.dauer);
  if (mediumNeu) {
    wanne.setzeMedium(medium.textur());
    mediumNeu = false;
  }
  wanne.rechne(n, {
    quellen: quellen.map((q) => ({ x: q.x, y: 1 - q.y, f, phase: 0, a, r: e.quellRadius })),
    ebene: { an: ebeneAn, f, a: a * 0.5 },
    tau: e.gedaechtnis,
  });
}

function zeichne() {
  wanne.zeichne({
    art: e.ansicht,
    verstaerkung: e.verstaerkung,
    hell: hexZuRgb(e.hell).map((v) => v / 255),
    dunkel: hexZuRgb(e.dunkel).map((v) => v / 255),
    wand: hexZuRgb(e.wandfarbe).map((v) => v / 255),
  });
  // Zeichen für Quellen und Mikrofon (auf eigener Schicht, kommt nicht ins Video)
  const g = marken.getContext("2d");
  g.clearRect(0, 0, marken.width, marken.height);
  if (exportLaeuft || !e.zeichen) return;
  g.strokeStyle = e.hell;
  g.lineWidth = Math.max(1, marken.width / 400);
  const r = Math.max(4, marken.width / 120);
  for (const q of quellen) {
    if (q.dauer !== Infinity) continue;
    g.strokeRect(q.x * marken.width - r, q.y * marken.height - r, 2 * r, 2 * r);
  }
  if (e.lauschen) {
    const x = mikrofon.x * marken.width, y = mikrofon.y * marken.height;
    g.beginPath();
    g.moveTo(x - 2 * r, y);
    g.lineTo(x + 2 * r, y);
    g.moveTo(x, y - 2 * r);
    g.lineTo(x, y + 2 * r);
    g.stroke();
  }
}

let vorher = performance.now(), statusZeit = 0;
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    if (laeuft) schritt(e.tempo);
    zeichne();
    lausche();
    statusZeit += dt;
    if (statusZeit > 0.3) {
      statusZeit = 0;
      status.textContent = `λ = ${(0.5 / frequenz()).toFixed(1)} Zellen · ${quellen.filter((q) => q.dauer === Infinity).length} Quellen · Schritt ${wanne.zeit}`;
    }
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "wellenwanne",
  anzeige: sichtbaresBild,
  endbild,
  zuschnitt: crtZuschnitt,
  render: {
    start(n) {
      exportLaeuft = true;
      musik.exportStart(n, 30);
    },
    bild(i) {
      musik.exportBild(i);
      schritt(e.tempo);
      zeichne();
    },
    ende() {
      musik.exportEnde();
      exportLaeuft = false;
    },
    merke() {
      const zurueck = wanne.sichere(), q = quellen.map((s) => ({ ...s }));
      return () => {
        zurueck();
        quellen = q.map((s) => ({ ...s }));
        zeichne();
      };
    },
  },
  tonFuer: () => musik.tonFuerExport(),
});

// Vorlagen ins Menü
{
  const wahl = hole("vorlage");
  for (const [name, v] of Object.entries(VORLAGEN)) wahl.append(new Option(v.text, name));
  wahl.value = "doppelspalt";
}
medium.setzeBrechzahl(e.brechzahl);
neueGroesse();
requestAnimationFrame(schleife);
