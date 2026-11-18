// Windkanal: die Seite. Die Rechnung (Lattice Boltzmann) steht in lbm.js, der Ton (Äolsharfe) in windton.js.
// Hier: Hindernisse (Formen und Pinsel), Reynolds-Zahl, Sonde mit Strouhal-Messung, Musik und Export.

import { erstelleWindkanal } from "./lbm.js";
import { erstelleWindton } from "./windton.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb, farbtabelle, skalaAnker } from "/lib/farben.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const hole = (id) => document.getElementById(id);
const canvas = hole("feld");
let kanal;
try {
  kanal = erstelleWindkanal(canvas);
} catch (fehler) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = fehler.message;
  throw fehler;
}
const ton = erstelleWindton();

// Hindernisse leben in einer Maske so groß wie das Gitter: weiß = fest. Formen und Pinsel malen darauf.
const maske = document.createElement("canvas");
const mg = maske.getContext("2d", { willReadFrequently: true });
let laeuft = true, exportLaeuft = false, schritte = 0;
let D = 40; // Größe des Hindernisses quer zum Wind (Zellen): die Länge in Re und St
let sonde = null; // { x, y } in Zellen (y von oben)

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    aufloesung: () => neu(),
    form: () => neu(),
    groesse: () => formNeu(),
    winkel: () => formNeu(),
    dicke: () => formNeu(),
    farben: () => farbenSetzen(),
  },
});

// ---------- Hindernisse ----------
// jede Form malt sich um die Mitte (cx, cy) mit Größe r (Zellen) und gibt ihre Höhe quer zum Wind zurück
const FORMEN = {
  kreis(r) {
    mg.beginPath();
    mg.arc(0, 0, r, 0, Math.PI * 2);
    mg.fill();
    return 2 * r;
  },
  platte(r, w) {
    mg.rotate(w);
    mg.fillRect(-1.5, -r, 3, 2 * r);
    return 2 * r * Math.abs(Math.cos(w)) + 3 * Math.abs(Math.sin(w));
  },
  quadrat(r, w) {
    mg.rotate(w);
    mg.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
    return r * 1.6 * (Math.abs(Math.cos(w)) + Math.abs(Math.sin(w)));
  },
  // NACA 00xx (symmetrisches Flügelprofil, NACA 1933): halbe Dicke an der Stelle x (0 … 1 der Sehne)
  //   y = 5 t (0,2969 √x − 0,1260 x − 0,3516 x² + 0,2843 x³ − 0,1015 x⁴),  t = größte Dicke / Sehne
  profil(r, w, t) {
    const sehne = r * 4;
    mg.rotate(w);
    mg.translate(-sehne * 0.3, 0); // drehen um ein Drittel der Sehne, wie im echten Kanal
    mg.beginPath();
    const y = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    for (let i = 0; i <= 60; i++) { const x = (i / 60) ** 2; mg.lineTo(x * sehne, -y(x) * sehne); }
    for (let i = 60; i >= 0; i--) { const x = (i / 60) ** 2; mg.lineTo(x * sehne, y(x) * sehne); }
    mg.fill();
    return sehne * (Math.abs(Math.sin(w)) + t);
  },
  gitter(r) {
    const a = r * 0.45, n = Math.max(2, Math.floor(maske.height / (a * 5)));
    for (let i = 0; i < n; i++) {
      mg.beginPath();
      mg.arc(0, (i - (n - 1) / 2) * a * 5, a, 0, Math.PI * 2);
      mg.fill();
    }
    return 2 * a;
  },
  stufe(r) {
    // rückspringende Stufe: der Wind fällt über eine Kante, dahinter eine Ablöseblase
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.fillRect(0, maske.height - r * 2, maske.width * 0.25, r * 2);
    return 2 * r;
  },
  leer: () => 40,
};

function formNeu() {
  const NX = maske.width, NY = maske.height;
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.fillStyle = "#000";
  mg.fillRect(0, 0, NX, NY);
  mg.fillStyle = "#fff";
  const cx = Math.round(NX * 0.22), cy = Math.round(NY / 2);
  mg.translate(cx, cy);
  D = Math.max(4, FORMEN[e.form](e.groesse * NY, (e.winkel * Math.PI) / 180, e.dicke));
  mg.setTransform(1, 0, 0, 1, 0, 0);
  sonde = { x: Math.min(NX - 2, cx + D * 2.5), y: e.form === "stufe" ? NY - D * 0.5 : cy };
  kanal.setzeFest(maske);
  messung.zuruecksetzen();
}

function neu() {
  const [nx, ny] = e.aufloesung.split("x").map(Number);
  maske.width = nx;
  maske.height = ny;
  kanal.groesse(nx, ny, e.wind);
  schritte = 0;
  formNeu();
}

// ---------- Maus: malen, radieren, Sonde ----------
const zelle = (ev) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * maske.width, y: ((ev.clientY - r.top) / r.height) * maske.height };
};
let zuletzt = null;
function pinsel(p) {
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.strokeStyle = mg.fillStyle = e.werkzeug === "radieren" ? "#000" : "#fff";
  mg.lineWidth = e.pinsel * 2;
  mg.lineCap = "round";
  mg.beginPath();
  mg.moveTo((zuletzt ?? p).x, (zuletzt ?? p).y);
  mg.lineTo(p.x, p.y);
  mg.stroke();
  zuletzt = p;
  kanal.setzeFest(maske);
}
canvas.addEventListener("pointerdown", (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  const p = zelle(ev);
  if (e.werkzeug === "sonde") {
    sonde = p;
    messung.zuruecksetzen();
  } else pinsel(p);
});
canvas.addEventListener("pointermove", (ev) => {
  if (ev.buttons && e.werkzeug !== "sonde") pinsel(zelle(ev));
});
canvas.addEventListener("pointerup", () => (zuletzt = null));

hole("neu").addEventListener("click", neu);
hole("pause").addEventListener("click", (ev) => {
  laeuft = !laeuft;
  ev.target.textContent = laeuft ? "Pause" : "weiter";
});

// ---------- Messen: Strouhal-Zahl an der Sonde ----------
// Hinter dem Hindernis schwingt die Querströmung uy hin und her, einmal pro Wirbelpaar. Gezählt wird, wie viele
// Schritte zwischen zwei Nulldurchgängen nach oben liegen (um den gleitenden Mittelwert, falls die Sonde nicht genau
// auf der Mittellinie sitzt). Frequenz f = 1 / Periode (pro Schritt), St = f · D / U.
const messung = {
  mittel: 0, ausschlag: 0, vorher: 0, letzterDurchgang: -1, perioden: [],
  zuruecksetzen() { this.mittel = 0; this.ausschlag = 0; this.vorher = 0; this.letzterDurchgang = -1; this.perioden = []; },
  neu(uy, schritt, U) {
    this.mittel += (uy - this.mittel) * 0.02;
    const a = uy - this.mittel;
    this.ausschlag += (Math.abs(a) / U - this.ausschlag) * 0.05;
    if (this.vorher < 0 && a >= 0) {
      if (this.letzterDurchgang >= 0) {
        this.perioden.push(schritt - this.letzterDurchgang);
        if (this.perioden.length > 6) this.perioden.shift();
      }
      this.letzterDurchgang = schritt;
    }
    this.vorher = a;
  },
  strouhal(U) {
    // nur wenn wirklich etwas schwingt (Ausschlag über 1 % des Winds) und die letzten Perioden zueinander passen
    // (die ersten Perioden nach dem Start sind noch unregelmäßig; darum nur die letzten vier, und nur wenn sie um
    // weniger als ein Fünftel auseinanderliegen)
    const letzte = this.perioden.slice(-4);
    if (letzte.length < 3 || this.ausschlag < 0.01) return null;
    const p = letzte.reduce((s, x) => s + x, 0) / letzte.length;
    if (Math.max(...letzte) - Math.min(...letzte) > p * 0.2) return null;
    return D / (p * U);
  },
};

// ---------- Ton und Musik ----------
hole("tonAn").addEventListener("click", async (ev) => {
  const an = ev.target.getAttribute("aria-pressed") !== "true";
  ev.target.setAttribute("aria-pressed", String(an));
  ev.target.textContent = an ? "Ton aus" : "Ton an";
  e.tonAn = an;
  if (an) await ton.an();
  else ton.aus();
});
const musik = richteAudioreaktivEin({
  ziele: { wind: "Wind", rauch: "Rauch heller" },
  start: { bass: "wind" },
  beiStart: () => {},
});

function farbenSetzen() {
  kanal.setzeVerlauf(e.farben === "eigen" ? null : farbtabelle(skalaAnker(e.farben)));
}
farbenSetzen();

// ---------- Rechnen und Zeichnen ----------
// Zähigkeit aus der gewünschten Reynolds-Zahl: Re = U · D / ν  →  ν = U · D / Re.
// Unter ν ≈ 0,006 wird das einfache BGK-Verfahren instabil (die Relaxationszeit τ = 3ν + ½ kommt zu nah an ½):
// dann bleibt ν dort stehen, und das echte Re ist kleiner. Mehr Auflösung (größeres D) erlaubt höhere Re.
const NU_MIN = 0.006;
function stroemung() {
  const U = e.wind * (1 + 0.8 * (musik.wirkung.wind ?? 0));
  const nu = Math.max(NU_MIN, (U * D) / e.re);
  return { U, nu, reEcht: (U * D) / nu };
}
function rechne(n) {
  const s = stroemung();
  for (let k = 0; k < n; k++) {
    kanal.rechne(1, { nu: s.nu, U: s.U, rauchAbstand: e.rauchAbstand, rauchBreite: e.rauchBreite });
    schritte++;
  }
  // die Sonde nur einmal pro Bild lesen: jedes Lesen wartet, bis die Grafikkarte fertig ist. Fein genug, eine Periode
  // dauert über tausend Schritte (St 0,2, D 30, U 0,1: f = St · U / D = 1/1500 pro Schritt)
  if (sonde && n > 0) messung.neu(kanal.sonde(sonde.x, sonde.y).uy, schritte, s.U);
  return s;
}
function zeichne() {
  const s = stroemung();
  kanal.zeichne({
    art: e.art, U: s.U, staerke: e.staerke * (1 + (musik.wirkung.rauch ?? 0)),
    hell: hexZuRgb(e.hell).map((x) => x / 255), dunkel: hexZuRgb(e.dunkel).map((x) => x / 255),
    wand: hexZuRgb(e.hell).map((x) => x / 255), sonde: e.sondeZeigen ? sonde : null,
  });
}

function passeAn() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
new ResizeObserver(passeAn).observe(canvas);
passeAn();
neu();

let vorher = performance.now(), proSekunde = 0;
function schleife(jetzt) {
  const dt = (jetzt - vorher) / 1000;
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(Math.min(0.05, dt));
    const s = laeuft ? rechne(e.tempo) : stroemung();
    proSekunde += ((laeuft ? e.tempo / Math.max(dt, 0.001) : 0) - proSekunde) * 0.05;
    zeichne();
    const st = messung.strouhal(s.U);
    const f = ton.nachfuehren(st, messung.ausschlag * 4, e, s.U / e.wind);
    const teile = [
      `Re ${Math.round(s.reEcht)}${s.reEcht < e.re - 1 ? " (mehr geht bei dieser Auflösung nicht)" : ""}`,
      `St ${st ? st.toFixed(2) : "–"}`,
      f && e.tonAn ? `${Math.round(f)} Hz` : null,
      `${maske.width} × ${maske.height}`,
      `${Math.round(proSekunde)} Schritte/s`,
    ];
    hole("status").textContent = teile.filter(Boolean).join(" · ");
  }
  requestAnimationFrame(schleife);
}

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "windkanal",
  anzeige: sichtbaresBild,
  endbild,
  zuschnitt: crtZuschnitt,
  render: {
    start(n) { exportLaeuft = true; musik.exportStart(n, 30); },
    bild(i) { musik.exportBild(i); rechne(e.tempo); zeichne(); },
    ende() { musik.exportEnde(); exportLaeuft = false; },
    merke() { const z = kanal.sichere(); return () => z(); },
  },
  tonFuer: () => musik.tonFuerExport(),
  liveTon: () => ton.liveTon() ?? musik.liveTon(),
});

requestAnimationFrame(schleife);
window.windkanal = { kanal, einstellung: e, messung, schritt: (n) => { rechne(n); zeichne(); } }; // zum Ausprobieren in der Konsole
