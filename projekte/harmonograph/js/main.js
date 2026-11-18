// Harmonograph: ein Stift, den Pendel über das Papier führen. Im 19. Jahrhundert ein Salon-Apparat (Hugh Blackburn,
// Jules Lissajous); hier vier Pendel, zwei bewegen den Stift waagerecht, zwei senkrecht:
//
//   x(t) = A₁ sin(2π f₁ t + φ₁) e^(−d₁ t) + A₂ sin(2π f₂ t + φ₂) e^(−d₂ t)
//   y(t) = A₃ sin(2π f₃ t + φ₃) e^(−d₃ t) + A₄ sin(2π f₄ t + φ₄) e^(−d₄ t)
//
// Jedes Pendel schwingt mit seiner Frequenz und verliert durch Reibung Schwung: die Amplitude fällt exponentiell
// (e^(−d t)). Stehen die Frequenzen im Verhältnis kleiner ganzer Zahlen (2 : 3, 3 : 4), entsteht eine geschlossene
// Lissajous-Figur; ist eines leicht verstimmt (2 : 3,01), dreht sich die Figur langsam (die Phase wandert um
// 2π · 0,01 pro Sekunde), und weil alles ausschwingt, wird sie zur Spirale nach innen.
//
// Als Ton: x ist der linke, y der rechte Kanal, jede Frequenz mal einem Grundton (z. B. 110 Hz). Auf einem
// Oszilloskop im XY-Betrieb (Projekt Oszilloskop-Musik) zeichnet der Ton dieselbe Figur.

import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteExportEin, ladeHerunter, zeitstempel, zuWav } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const hole = (id) => document.getElementById(id);
const canvas = hole("feld");
const g = canvas.getContext("2d");
const status = hole("status");
let formatRatio = 1;
let t = 0; // wie weit der Stift schon gezeichnet hat (Sekunden Pendelzeit)
let laeuft = true, exportLaeuft = false;

const { einstellung: e, setze: setzeEins } = richteReglerEin({ beiAenderung: () => neu(), extra: { bildgroesse: () => passeAn() } });

const pendel = () => [1, 2, 3, 4].map((i) => ({ f: e[`f${i}`], p: (e[`p${i}`] * Math.PI) / 180, a: e[`a${i}`], d: e[`d${i}`] }));
function punkt(zeit, P = pendel()) {
  const s = (q) => q.a * Math.sin(2 * Math.PI * q.f * zeit + q.p) * Math.exp(-q.d * zeit);
  return [s(P[0]) + s(P[1]), s(P[2]) + s(P[3])];
}

// ---------- Zeichnen ----------
// Der Stift zeichnet in kleinen Schritten (dt so, dass bei der schnellsten Frequenz 200 Punkte pro Schwingung
// kommen); jede Strecke halb durchsichtig, so wird das Papier dort dunkler, wo der Stift oft vorbeikommt.
const schritt = () => 1 / (200 * Math.max(e.f1, e.f2, e.f3, e.f4));
function papier() {
  g.globalCompositeOperation = "source-over";
  g.fillStyle = e.papier;
  g.fillRect(0, 0, canvas.width, canvas.height);
}
function zeichneBis(bis) {
  const P = pendel(), dt = schritt();
  const m = Math.min(canvas.width, canvas.height) / 2 * 0.92, cx = canvas.width / 2, cy = canvas.height / 2;
  const [r, gr, b] = hexZuRgb(e.stift);
  g.strokeStyle = `rgba(${r}, ${gr}, ${b}, ${e.deckkraft})`;
  g.lineWidth = e.strich * (canvas.width / 1024);
  g.lineJoin = g.lineCap = "round";
  g.beginPath();
  let [x, y] = punkt(t, P);
  g.moveTo(cx + x * m, cy - y * m);
  // in Stücken von 400 Strecken: ein langer Pfad mit Zehntausenden Punkten wird in manchen Browsern sehr langsam
  let n = 0;
  while (t < bis) {
    t += dt;
    [x, y] = punkt(t, P);
    g.lineTo(cx + x * m, cy - y * m);
    if (++n % 400 === 0) {
      g.stroke();
      g.beginPath();
      g.moveTo(cx + x * m, cy - y * m);
    }
  }
  g.stroke();
}
function neu() {
  t = 0;
  papier();
  if (!laeuft) zeichneBis(e.dauer);
}

// ---------- Größe ----------
function passeAn() {
  const lang = Number(e.bildgroesse);
  canvas.width = Math.round(formatRatio >= 1 ? lang : lang * formatRatio);
  canvas.height = Math.round(formatRatio >= 1 ? lang / formatRatio : lang);
  hole("stapel").style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  neu();
}
window.addEventListener("formatwechsel", (ev) => {
  const r = Number(ev.detail?.ratio);
  if (!(r > 0)) return;
  formatRatio = r;
  passeAn();
});

// ---------- Zufall: Verhältnisse kleiner ganzer Zahlen, leicht verstimmt ----------
hole("zufall").addEventListener("click", () => {
  const ganz = [1, 2, 3, 4, 5];
  const wahl = () => ganz[Math.floor(Math.random() * ganz.length)];
  const werte = {};
  for (const i of [1, 2, 3, 4]) {
    werte[`f${i}`] = +(wahl() + (Math.random() - 0.5) * 0.02 * e.verstimmung).toFixed(4);
    werte[`p${i}`] = Math.round(Math.random() * 360);
    werte[`d${i}`] = +(0.002 + Math.random() * 0.01).toFixed(4);
  }
  werte.a2 = +(Math.random() * 0.5).toFixed(2);
  werte.a4 = +(Math.random() * 0.5).toFixed(2);
  werte.a1 = +(1 - werte.a2).toFixed(2);
  werte.a3 = +(1 - werte.a4).toFixed(2);
  for (const [name, wert] of Object.entries(werte)) setzeEins(name, wert);
  neu();
});
document.querySelectorAll("[data-setze]").forEach((k) => k.addEventListener("click", () => setTimeout(neu)));
hole("pause").addEventListener("click", (ev) => {
  laeuft = !laeuft;
  ev.target.textContent = laeuft ? "Pause" : "weiter";
});
hole("sofort").addEventListener("click", () => {
  papier();
  t = 0;
  zeichneBis(e.dauer);
});

// ---------- SVG: dieselbe Kurve als Linie (für Plotter, Laser, Druck) ----------
hole("svg").addEventListener("click", () => {
  const B = 1000, H = Math.round(1000 / formatRatio), m = Math.min(B, H) / 2 * 0.92, P = pendel();
  const dt = schritt() * 2;
  const pkt = [];
  for (let z = 0; z < e.dauer; z += dt) {
    const [x, y] = punkt(z, P);
    pkt.push(`${(B / 2 + x * m).toFixed(2)},${(H / 2 - y * m).toFixed(2)}`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${B} ${H}" width="${B}" height="${H}">` +
    `<rect width="100%" height="100%" fill="${e.papier}"/><polyline fill="none" stroke="${e.stift}" stroke-width="${e.strich}" stroke-opacity="${e.deckkraft}" points="${pkt.join(" ")}"/></svg>`;
  ladeHerunter(new Blob([svg], { type: "image/svg+xml" }), `harmonograph-${zeitstempel()}.svg`);
});

// ---------- Ton: x links, y rechts ----------
function alsTon(sekunden) {
  const rate = 48000, n = Math.round(rate * sekunden);
  const ctx = new OfflineAudioContext(2, n, rate);
  const puffer = ctx.createBuffer(2, n, rate);
  const L = puffer.getChannelData(0), R = puffer.getChannelData(1);
  // die Pendelzeit läuft im Ton e.zeitraffer-mal so schnell: in 20 s Ton schwingen die Pendel so weit aus wie auf
  // dem Papier; die Frequenzen werden zum Grundton (1 → grundton Hz)
  const P = pendel().map((q) => ({ ...q, f: q.f * e.grundton, d: (q.d * e.dauer) / sekunden }));
  let spitze = 1e-9;
  for (let i = 0; i < n; i++) {
    const [x, y] = punkt(i / rate, P);
    L[i] = x;
    R[i] = y;
    spitze = Math.max(spitze, Math.abs(x), Math.abs(y));
  }
  for (let i = 0; i < n; i++) {
    L[i] *= 0.9 / spitze;
    R[i] *= 0.9 / spitze;
  }
  return puffer;
}
let spieler = null;
hole("hoeren").addEventListener("click", (ev) => {
  if (spieler) {
    spieler.quelle.stop();
    return;
  }
  const ctx = new AudioContext();
  const quelle = ctx.createBufferSource();
  quelle.buffer = alsTon(e.tonlaenge);
  quelle.connect(ctx.destination);
  quelle.start();
  spieler = { ctx, quelle };
  ev.target.textContent = "Ton anhalten";
  quelle.onended = () => {
    ctx.close();
    spieler = null;
    ev.target.textContent = "anhören (x links, y rechts)";
  };
});
hole("wav").addEventListener("click", () => ladeHerunter(new Blob([zuWav(alsTon(e.tonlaenge))], { type: "audio/wav" }), `harmonograph-${zeitstempel()}.wav`));

// ---------- Schleife ----------
function schleife() {
  if (!exportLaeuft && laeuft && t < e.dauer) {
    zeichneBis(Math.min(e.dauer, t + e.tempo / 60));
    status.textContent = `${Math.round((100 * t) / e.dauer)} % gezeichnet`;
  }
  requestAnimationFrame(schleife);
}

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "harmonograph",
  anzeige: sichtbaresBild,
  endbild,
  zuschnitt: crtZuschnitt,
  // Video: der Stift zeichnet in der eingestellten Videolänge von vorn bis zum Ende (Länge im Export-Fenster)
  render: {
    start(n) {
      exportLaeuft = true;
      this.n = n;
      papier();
      t = 0;
    },
    bild(i) {
      zeichneBis((e.dauer * (i + 1)) / this.n);
    },
    ende() {
      exportLaeuft = false;
    },
  },
  tonFuer: (sekunden) => (e.tonImVideo ? alsTon(sekunden) : null),
});

passeAn();
requestAnimationFrame(schleife);
