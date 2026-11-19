// Lenia: die Seite. Theorie in lenia.js. Hier: Ursuppe säen, malen (ziehen sät, mit Umschalt radiert), Parameter,
// Musik und Export.

import { erstelleLenia, ursuppe, setzeMuster } from "./lenia.js";
import { WESEN, entpacke } from "./wesen.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb, skalaAnker, farbtabelle } from "/lib/farben.js";
import { richteLeniaTonEin } from "./lenia-ton.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const hole = (id) => document.getElementById(id);
const canvas = hole("feld");
let lenia;
try {
  lenia = erstelleLenia(canvas);
} catch (fehler) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = fehler.message;
  throw fehler;
}
let laeuft = true, exportLaeuft = false, pinsel = null;

const { einstellung: e, setzeAlle } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    radius: () => lenia.setzeKern(e.radius), groesse: () => neu(),
    weg: () => zeigeWeg(), farben: () => neueFarben(),
    wesenGross: () => setzeAlle(regelnVon(WESEN[wahl.value])), // größere Wesen brauchen einen größeren Kern
  },
});

// Rechnung: direkt oder über die FFT (lenia.js); „automatisch“ nimmt die FFT, sobald der Kern mehr als
// 100 Zellen hat und die Größe eine Zweierpotenz ist
function zeigeWeg() {
  lenia.setzeWeg(e.weg);
  hole("weg-info").textContent = `Gerechnet wird ${lenia.weg() === "FFT" ? "über die FFT" : "direkt"}.`;
}

// Farben: zwei eigene (dunkel bis hell) oder ein Verlauf aus /lib/farben.js
function neueFarben() {
  lenia.setzeVerlauf(e.farben === "eigen" ? null : farbtabelle(skalaAnker(e.farben)));
}

// Wesen: Auswahl füllen; wählen stellt die Regeln des Wesens ein (es lebt nur mit seinen eigenen)
const wahl = hole("wesen");
WESEN.forEach((w, i) => wahl.add(new Option(w.name, i)));
const muster = WESEN.map((w) => entpacke(w.zellen));
const regelnVon = (w) => ({ mu: w.mu, sigma: w.sigma, radius: Math.round(w.R * e.wesenGross), dt: w.dt });
wahl.addEventListener("change", () => setzeAlle(regelnVon(WESEN[wahl.value])));

function wesenSetzen(stellen) {
  lenia.bearbeite((d, N) => {
    // Maßstab: so viel größer ist der Kern jetzt als der, für den das Wesen gefunden wurde
    const q = e.radius / WESEN[wahl.value].R;
    for (const [x, y, winkel] of stellen) setzeMuster(d, N, muster[wahl.value], x * N, y * N, winkel, q);
  });
}
const irgendwo = (n) => Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random() * Math.PI * 2]);

function neu(art = "wesen") {
  const n = Number(e.groesse);
  canvas.width = canvas.height = Math.max(512, n);
  lenia.groesse(n, art === "suppe" ? ursuppe(n, e.saat, e.dichte, Math.round((n / 256) ** 2 * 12)) : null);
  lenia.setzeKern(e.radius);
  zeigeWeg();
  // so viele Wesen, dass die Welt etwa gleich voll ist: mit der Fläche mehr, mit der Wesen-Größe weniger
  if (art === "wesen") wesenSetzen(irgendwo(Math.max(1, Math.round(((n / 256) ** 2 * 5) / (e.radius / 13) ** 2))));
}
hole("suppe").addEventListener("click", () => {
  e.saat = Math.floor(Math.random() * 1e6);
  neu("suppe");
});
hole("streuen").addEventListener("click", () => wesenSetzen(irgendwo(3)));
hole("leeren").addEventListener("click", () => neu("leer"));
hole("pause").addEventListener("click", (ev) => {
  laeuft = !laeuft;
  ev.target.textContent = laeuft ? "Pause" : "weiter";
});

// Werkzeug: Wesen setzen (Klick, gedreht in Zugrichtung, sonst zufällig), säen (ziehen setzt Leben, zufällig
// zwischen 0,5 und 1) oder radieren; Umschalt oder rechts radiert immer
const lage = (ev) => {
  const r = canvas.getBoundingClientRect();
  return [(ev.clientX - r.left) / r.width, 1 - (ev.clientY - r.top) / r.height];
};
canvas.addEventListener("pointerdown", (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  if (e.tonArt === "steht" && !ev.shiftKey && ev.button === 0) {
    const r = canvas.getBoundingClientRect();
    const anteil = e.tonRichtung === "waagerecht" ? 1 - (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
    const feld = document.querySelector('[data-wert="tonLage"]');
    if (feld) { feld.value = String(Math.max(0, Math.min(1, anteil))); feld.dispatchEvent(new Event("input", { bubbles: true })); }
    return;
  }
  const weg = ev.shiftKey || ev.button === 2 || e.werkzeug === "radieren";
  if (e.werkzeug === "wesen" && !weg) {
    const [x, y] = lage(ev);
    wesenSetzen([[x, y, Math.random() * Math.PI * 2]]);
    return;
  }
  pinsel = { wo: lage(ev), weg };
});
canvas.addEventListener("pointermove", (ev) => pinsel && (pinsel.wo = lage(ev)));
canvas.addEventListener("pointerup", () => (pinsel = null));
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

const musik = richteAudioreaktivEin({
  ziele: { mu: "μ verschieben (andere Formen)", tempo: "schneller leben" },
  start: { bass: "tempo" },
  beiStart: () => {},
});

function schritt() {
  const mu = e.mu * (1 + 0.15 * (musik.wirkung.mu ?? 0));
  const n = Math.round(e.tempo * (1 + (musik.wirkung.tempo ?? 0)));
  lenia.rechne(n, {
    mu, sigma: e.sigma, dt: e.dt,
    pinsel: pinsel ? [...pinsel.wo, e.pinsel, pinsel.weg ? 0 : 0.5 + Math.random() * 0.5] : null,
  });
}
// Ton: ein Strich liest die Welt wie im Game of Life (lenia-ton.js)
const ton = richteLeniaTonEin(lenia, e, hole("tonAn"));

function zeichne() {
  lenia.zeichne({
    hell: hexZuRgb(e.hell).map((v) => v / 255), dunkel: hexZuRgb(e.dunkel).map((v) => v / 255), art: e.ansicht,
    kopf: exportLaeuft ? null : ton.kopf(),
  });
}
let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    if (laeuft || pinsel) schritt();
    zeichne();
  }
  requestAnimationFrame(schleife);
}

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "lenia",
  anzeige: sichtbaresBild,
  endbild,
  zuschnitt: crtZuschnitt,
  render: {
    start(n) { exportLaeuft = true; musik.exportStart(n, 30); },
    bild(i) { musik.exportBild(i); schritt(); zeichne(); },
    ende() { musik.exportEnde(); exportLaeuft = false; },
    merke() { const z = lenia.sichere(); return () => { z(); zeichne(); }; },
  },
  tonFuer: () => musik.tonFuerExport(),
  liveTon: () => [ton.liveTon(), musik.liveTon()], // „Live aufnehmen“: der Ton des Strichs, sonst die Musik
});

neueFarben();
neu();
requestAnimationFrame(schleife);
window.lenia = { lenia, einstellung: e, wesenSetzen }; // zum Ausprobieren in der Konsole


