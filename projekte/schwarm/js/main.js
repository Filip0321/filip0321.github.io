// Schwarm: die Seite. Theorie in schwarm.js (Regeln, Nachbarn, Gitter) und klangwolke.js (Ton).
// Hier: Feld, Zeichnen, Maus (Raubvogel, Futter, Wände), Falke, Musik und Export.

import { erstelleSchwarm } from "./schwarm.js";
import { erstelleKlangwolke } from "./klangwolke.js";
import { richteReglerEin } from "/lib/regler.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const hole = (id) => document.getElementById(id);
const canvas = hole("feld");
const g = canvas.getContext("2d");
const schwarm = erstelleSchwarm();
const ton = erstelleKlangwolke();
let laeuft = true, exportLaeuft = false;
let B = 800, H = 500, dpr = 1; // Welt in CSS-Pixeln, gezeichnet mal dpr
const waende = []; // [[x1, y1, x2, y2], …]
let maus = null; // { x, y, unten }
const falke = { x: 0, y: 0, vx: 0, vy: 0 };

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => {},
  extra: { anzahl: () => neu() },
});

function passeAn() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const b = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(b * dpr);
  canvas.height = Math.round(h * dpr);
  if (schwarm.n) schwarm.groesse(b, h);
  B = b;
  H = h;
  g.fillStyle = e.dunkel;
  g.fillRect(0, 0, canvas.width, canvas.height);
}
function neu() {
  schwarm.neu(e.anzahl, B, H);
  falke.x = B / 2;
  falke.y = H / 2;
}
new ResizeObserver(passeAn).observe(canvas);
passeAn();
neu();

hole("neu").addEventListener("click", neu);
hole("pause").addEventListener("click", (ev) => {
  laeuft = !laeuft;
  ev.target.textContent = laeuft ? "Pause" : "weiter";
});
hole("waendeWeg").addEventListener("click", () => (waende.length = 0));

// ---------- Maus ----------
const lage = (ev) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * B, y: ((ev.clientY - r.top) / r.height) * H };
};
let wandStart = null;
canvas.addEventListener("pointerdown", (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  const p = lage(ev);
  maus = { ...p, unten: true };
  if (e.werkzeug === "wand") wandStart = p;
  if (e.werkzeug === "radieren") radiere(p);
});
canvas.addEventListener("pointermove", (ev) => {
  const p = lage(ev);
  maus = { ...p, unten: maus?.unten ?? false };
  if (e.werkzeug === "wand" && wandStart && Math.hypot(p.x - wandStart.x, p.y - wandStart.y) > 12) {
    waende.push([wandStart.x, wandStart.y, p.x, p.y]); // gezogene Linie aus kurzen Stücken
    wandStart = p;
  }
  if (e.werkzeug === "radieren" && maus.unten) radiere(p);
});
canvas.addEventListener("pointerup", () => {
  if (maus) maus.unten = false;
  wandStart = null;
});
canvas.addEventListener("pointerleave", () => (maus = null));
function radiere(p) {
  for (let i = waende.length - 1; i >= 0; i--) {
    const [x1, y1, x2, y2] = waende[i];
    if (Math.hypot((x1 + x2) / 2 - p.x, (y1 + y2) / 2 - p.y) < 30) waende.splice(i, 1);
  }
}

// ---------- Ton ----------
hole("tonAn").addEventListener("click", async (ev) => {
  const an = ev.target.getAttribute("aria-pressed") !== "true";
  ev.target.setAttribute("aria-pressed", String(an));
  ev.target.textContent = an ? "Ton aus" : "Ton an";
  if (an) await ton.an(e);
  else ton.aus();
});

const musik = richteAudioreaktivEin({
  ziele: { zusammenhalt: "Zusammenhalt", tempo: "Tempo", schreck: "Schreck (Falke in der Mitte)" },
  start: { bass: "zusammenhalt", schlag: "schreck" },
  beiStart: () => {},
});

// ---------- Rechnen ----------
// Falke: fliegt auf den nächsten Vogel zu, etwas schneller als der Schwarm, aber träger (kleinere Kraft):
// so kann er nicht jede Wendung mitmachen, und der Schwarm reißt vor ihm auf wie bei echten Staren
function falkeSchritt(dt) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < schwarm.n; i += 4) {
    const d = (schwarm.x[i] - falke.x) ** 2 + (schwarm.y[i] - falke.y) ** 2;
    if (d < bd) [bd, best] = [d, i];
  }
  if (best < 0) return;
  const dx = schwarm.x[best] - falke.x, dy = schwarm.y[best] - falke.y, l = Math.hypot(dx, dy) || 1;
  const v = e.vmax * 1.25;
  falke.vx += ((dx / l) * v - falke.vx) * Math.min(1, dt * 1.5);
  falke.vy += ((dy / l) * v - falke.vy) * Math.min(1, dt * 1.5);
  falke.x = (falke.x + falke.vx * dt + B) % B;
  falke.y = (falke.y + falke.vy * dt + H) % H;
}

function regeln() {
  const w = musik.wirkung;
  return {
    sicht: e.sicht, abstand: e.abstand, trennung: e.trennung, ausrichtung: e.ausrichtung,
    zusammenhalt: e.zusammenhalt * (1 + 2 * (w.zusammenhalt ?? 0)),
    vmax: e.vmax * (1 + 0.6 * (w.tempo ?? 0)), vmin: e.vmin, kraft: e.kraft, blick: e.blick,
    topologisch: e.topologisch, k: e.k, torus: e.rand === "torus", zittern: e.zittern,
  };
}
function stoerer() {
  const s = [];
  if (maus?.unten && (e.werkzeug === "jagen" || e.werkzeug === "locken")) s.push({ x: maus.x, y: maus.y, art: e.werkzeug, radius: 120, staerke: 2 });
  if (e.falke) s.push({ x: falke.x, y: falke.y, art: "jagen", radius: 90, staerke: 2 });
  const schreck = musik.wirkung.schreck ?? 0;
  if (schreck > 0.3) {
    const m = schwarm.messe();
    s.push({ x: m.mitteX * B, y: m.mitteY * H, art: "jagen", radius: 200 * schreck, staerke: 3 * schreck });
  }
  return s;
}
function schritt(dt) {
  // in Teilschritten, damit schnelle Vögel bei großem dt nicht durch Wände springen
  const teile = Math.max(1, Math.ceil(dt / 0.02));
  for (let k = 0; k < teile; k++) {
    if (e.falke) falkeSchritt(dt / teile);
    schwarm.schritt((dt / teile) * e.zeit, regeln(), stoerer(), waende);
  }
}

// ---------- Zeichnen ----------
function zeichne() {
  // Spuren: das alte Bild nur abdunkeln statt löschen (wie Nachleuchten); 0 = jedes Bild neu
  g.globalAlpha = 1 - e.spuren;
  g.fillStyle = e.dunkel;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalAlpha = 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = g.strokeStyle = e.hell;
  g.lineWidth = Math.max(0.6, e.groesse * 0.35);
  const s = e.groesse, n = schwarm.n, { x, y, vx, vy } = schwarm;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const v = Math.hypot(vx[i], vy[i]) || 1, rx = vx[i] / v, ry = vy[i] / v;
    if (e.form === "dreieck") {
      // Spitze nach vorn, zwei Ecken hinten seitlich
      g.moveTo(x[i] + rx * s * 1.6, y[i] + ry * s * 1.6);
      g.lineTo(x[i] - rx * s + ry * s * 0.6, y[i] - ry * s - rx * s * 0.6);
      g.lineTo(x[i] - rx * s - ry * s * 0.6, y[i] - ry * s + rx * s * 0.6);
      g.closePath();
    } else if (e.form === "strich") {
      g.moveTo(x[i] - rx * s * 1.5, y[i] - ry * s * 1.5);
      g.lineTo(x[i] + rx * s * 1.5, y[i] + ry * s * 1.5);
    } else g.rect(x[i] - s / 2, y[i] - s / 2, s, s);
  }
  if (e.form === "strich") g.stroke();
  else g.fill();
  // Wände und Falke
  g.lineWidth = 2;
  g.beginPath();
  for (const [x1, y1, x2, y2] of waende) {
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
  }
  g.stroke();
  if (e.falke) {
    const v = Math.hypot(falke.vx, falke.vy) || 1, rx = falke.vx / v, ry = falke.vy / v, f = s * 4;
    g.beginPath();
    g.moveTo(falke.x + rx * f * 1.6, falke.y + ry * f * 1.6);
    g.lineTo(falke.x - rx * f + ry * f, falke.y - ry * f - rx * f);
    g.lineTo(falke.x - rx * f * 0.3, falke.y - ry * f * 0.3);
    g.lineTo(falke.x - rx * f - ry * f, falke.y - ry * f + rx * f);
    g.closePath();
    g.stroke();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    if (laeuft) schritt(dt);
    zeichne();
    ton.nachfuehren(schwarm, B, H, e);
    const m = schwarm.messe();
    hole("status").textContent = `${schwarm.n} Vögel · Ordnung ${m.ordnung.toFixed(2)} · Tempo ${Math.round(m.tempo)}`;
  }
  requestAnimationFrame(schleife);
}

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "schwarm",
  anzeige: sichtbaresBild,
  endbild,
  zuschnitt: crtZuschnitt,
  render: {
    start(n) { exportLaeuft = true; musik.exportStart(n, 30); },
    bild(i, dt) { musik.exportBild(i); schritt(dt); zeichne(); },
    ende() { musik.exportEnde(); exportLaeuft = false; },
    merke() { const z = schwarm.sichere(); return () => z(); },
  },
  tonFuer: () => musik.tonFuerExport(),
  liveTon: () => ton.liveTon() ?? musik.liveTon(),
});

requestAnimationFrame(schleife);
window.schwarm = { schwarm, einstellung: e }; // zum Ausprobieren in der Konsole
