// Kleine Anzeigen in den Modulen (Runde 21): man soll sehen, was eine Hüllkurve oder ein LFO gerade tut.
// Beide zeichnen in jedem Bild (main.js ruft alles in „bild“ auf). Den Wert „jetzt“ liest ein AnalyserNode am
// Ausgang (bausteine.js, leser): das letzte Sample seines Puffers. Der Fenster-Knopf „Bild an / aus“ blendet sie aus.

import { leser } from "./bausteine.js";

function leinwand(el) {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 72;
  c.className = "schirm klein";
  el.append(c);
  return c;
}

// Hüllkurve: die Form aus A, D, S, R als Linie, dazu ein Punkt, der ihr folgt.
// Waagrecht ist es keine echte Zeitachse: A + D + R sind echte Zeiten (anteilig), das Halten (Sustain) bekommt immer
// ein Viertel der Breite, weil es so lange dauert, wie die Taste gedrückt ist.
// Der Punkt: seine Höhe ist der echte Wert am Ausgang, seine Lage die Zeit seit dem Anschlag bzw. seit dem Loslassen.
export function huellkurvenBild(ctx, bild, w, ausgang, { spitze = () => 1 } = {}) {
  const l = leser(ctx);
  ausgang.connect(l.knoten);
  let c = null, g = null, an = -1, los = -1;
  const zeichne = () => {
    if (!g || !c.isConnected || c.offsetParent === null) return; // versteckt: nicht zeichnen
    const B = c.width, H = c.height, rand = 6, hoehe = H - 2 * rand;
    const s = w.s, summe = w.a + w.d + w.r, rest = B * 0.75;
    const xa = (w.a / summe) * rest, xd = xa + (w.d / summe) * rest, xh = xd + B * 0.25, xr = B;
    const y = (v) => rand + hoehe * (1 - v);
    g.clearRect(0, 0, B, H);
    g.strokeStyle = g.fillStyle = getComputedStyle(c).color;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, y(0));
    g.lineTo(xa, y(1));
    // Decay ist exponentiell (setTargetAtTime): als Kurve gezeichnet, nicht als Gerade
    for (let i = 1; i <= 12; i++) g.lineTo(xa + ((xd - xa) * i) / 12, y(s + (1 - s) * Math.exp((-3 * i) / 12)));
    g.lineTo(xh, y(s));
    for (let i = 1; i <= 12; i++) g.lineTo(xh + ((xr - xh) * i) / 12, y(s * Math.exp((-3 * i) / 12)));
    g.stroke();
    // Punkt
    const t = ctx.currentTime, v = l.wert() / spitze();
    let x = null;
    if (los >= 0 && t >= los) {
      const d = t - los;
      if (d < w.r * 1.2) x = xh + Math.min(1, d / w.r) * (xr - xh);
    } else if (an >= 0 && t >= an) {
      const d = t - an;
      x = d < w.a ? (d / w.a) * xa : d < w.a + w.d ? xa + ((d - w.a) / w.d) * (xd - xa) : xd + Math.min(1, (d - w.a - w.d) / 2) * (xh - xd);
    }
    if (x !== null) g.fillRect(x - 3, y(Math.max(0, Math.min(1, v))) - 3, 6, 6); // Quadrat (Regel 2)
  };
  return {
    extra: (el) => {
      c = leinwand(el);
      g = c.getContext("2d");
      bild.add(zeichne);
    },
    angeschlagen(t, dauer) {
      // die Anzeige läuft mit der Audio-Uhr: Anschlag in der Zukunft wird erst dann sichtbar
      an = t;
      los = Number.isFinite(dauer) ? t + Math.max(dauer, w.a) : -1;
    },
    losgelassen(t) {
      los = t;
    },
    weg() {
      bild.delete(zeichne);
      l.knoten.disconnect();
    },
  };
}

// Verlauf: die letzten zwei Sekunden eines Ausgangs als Linie, die nach links wandert (wie ein langsames
// Oszilloskop). Für den LFO, aber für jede langsame Steuerspannung brauchbar. bereich: so weit geht es nach oben
// und unten (die Tiefe des LFO), damit die Linie die Höhe ausnutzt.
export function verlaufsBild(ctx, bild, ausgang, bereich = () => 1) {
  const l = leser(ctx);
  ausgang.connect(l.knoten);
  const N = 160, werte = new Float32Array(N);
  let c = null, g = null, i = 0, zuletzt = 0;
  const zeichne = () => {
    // 80 Werte je Sekunde, unabhängig von der Bildrate
    const t = performance.now();
    if (t - zuletzt < 12.5) return;
    zuletzt = t;
    werte[i] = l.wert();
    i = (i + 1) % N;
    if (!g || c.offsetParent === null) return;
    const B = c.width, H = c.height, m = Math.max(1e-3, bereich());
    g.clearRect(0, 0, B, H);
    g.strokeStyle = g.fillStyle = getComputedStyle(c).color;
    g.globalAlpha = 0.35;
    g.fillRect(0, H / 2, B, 1); // Nulllinie
    g.globalAlpha = 1;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let k = 0; k < N; k++) {
      const v = werte[(i + k) % N], x = (k / (N - 1)) * B, y = H / 2 - (v / m) * (H / 2 - 5);
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    const v = werte[(i + N - 1) % N];
    g.fillRect(B - 6, H / 2 - (v / m) * (H / 2 - 5) - 3, 6, 6);
  };
  return {
    extra: (el) => {
      c = leinwand(el);
      g = c.getContext("2d");
    },
    an: () => bild.add(zeichne),
    weg() {
      bild.delete(zeichne);
      l.knoten.disconnect();
    },
  };
}

// ---------- Runde 23: Bilder für Oszillator, Filter, Shaper, Kurve ----------
// Alle nach demselben Muster: eine kleine Leinwand (72 Bildpunkte hoch), gezeichnet nur, wenn sie zu sehen ist.
function kleineLeinwand(el) {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 72;
  c.className = "schirm klein";
  el.append(c);
  return c;
}
const farbe = (c) => getComputedStyle(c).color;

// Oszillator: die Welle selbst, zwei Perioden. Wie ein Oszilloskop mit Trigger: gezeichnet ab dem ersten Durchgang durch
// null nach oben, sonst liefe das Bild durch. Wie viele Samples eine Periode hat, sagt die Frequenz: fs / f.
export function wellenBild(ctx, bild, ausgang, frequenz) {
  const a = ctx.createAnalyser();
  a.fftSize = 4096;
  ausgang.connect(a);
  const d = new Float32Array(4096);
  let c = null, g = null;
  const zeichne = () => {
    if (!g || c.offsetParent === null) return;
    a.getFloatTimeDomainData(d);
    const B = c.width, H = c.height;
    const periode = Math.max(4, Math.min(2000, ctx.sampleRate / Math.max(1, frequenz())));
    let start = 0;
    for (let i = 1; i < d.length - 2 * periode; i++) if (d[i - 1] <= 0 && d[i] > 0) { start = i; break; }
    let m = 0;
    for (let i = start; i < start + 2 * periode && i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    m = Math.max(m, 0.05);
    g.clearRect(0, 0, B, H);
    g.strokeStyle = farbe(c);
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x < B; x++) {
      const i = start + Math.floor((x / B) * 2 * periode), y = H / 2 - (d[i] / m) * (H / 2 - 5);
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  };
  return {
    extra: (el) => {
      c = kleineLeinwand(el);
      g = c.getContext("2d");
      bild.add(zeichne);
    },
    weg: () => {
      bild.delete(zeichne);
      a.disconnect();
    },
  };
}

// Filter: der Frequenzgang. getFrequencyResponse rechnet für eine Liste von Frequenzen aus, wie stark der BiquadFilter
// sie durchlässt (Betrag) – genau die Formel, mit der er auch filtert. Waagrecht 20 Hz … 20 kHz logarithmisch,
// senkrecht −36 … +18 dB; die Linie bei 0 dB heißt „unverändert“. Mit Resonanz sieht man den Buckel an der Grenze.
export function filterBild(bild, f) {
  const N = 160, frq = new Float32Array(N), betrag = new Float32Array(N), phase = new Float32Array(N);
  for (let i = 0; i < N; i++) frq[i] = 20 * 1000 ** (i / (N - 1));
  let c = null, g = null;
  const zeichne = () => {
    if (!g || c.offsetParent === null) return;
    f.getFrequencyResponse(frq, betrag, phase);
    const B = c.width, H = c.height, y = (db) => 4 + ((18 - Math.max(-36, Math.min(18, db))) / 54) * (H - 8);
    g.clearRect(0, 0, B, H);
    g.fillStyle = g.strokeStyle = farbe(c);
    g.globalAlpha = 0.35;
    g.fillRect(0, y(0), B, 1);
    for (const hz of [100, 1000, 10000]) g.fillRect(Math.round((Math.log(hz / 20) / Math.log(1000)) * B), 0, 1, H);
    g.globalAlpha = 1;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * B, yy = y(20 * Math.log10(Math.max(1e-6, betrag[i])));
      i ? g.lineTo(x, yy) : g.moveTo(x, yy);
    }
    g.stroke();
  };
  return {
    extra: (el) => {
      c = kleineLeinwand(el);
      g = c.getContext("2d");
      bild.add(zeichne);
    },
    weg: () => bild.delete(zeichne),
  };
}

// eine feste Linie aus einer Funktion (Kennlinie des Shapers, Form der Kurve); neu zeichnen, wenn sich etwas ändert.
// punkt(): optional ein Punkt [x 0 … 1, y −1 … 1], der jedes Bild neu gesetzt wird (wo die Kurve gerade ist)
export function linienBild(bild, werte, { unten = -1, oben = 1, punkt = null, mittellinie = true } = {}) {
  let c = null, g = null;
  const zeichne = () => {
    if (!g || c.offsetParent === null) return;
    const B = c.width, H = c.height, y = (v) => 4 + ((oben - v) / (oben - unten)) * (H - 8), w = werte();
    g.clearRect(0, 0, B, H);
    g.fillStyle = g.strokeStyle = farbe(c);
    if (mittellinie) {
      g.globalAlpha = 0.35;
      g.fillRect(0, y(0), B, 1);
      g.globalAlpha = 1;
    }
    g.lineWidth = 1.5;
    g.beginPath();
    w.forEach((v, i) => {
      const x = (i / (w.length - 1)) * B;
      i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v));
    });
    g.stroke();
    const p = punkt?.();
    if (p) g.fillRect(p[0] * B - 3, y(p[1]) - 3, 6, 6);
  };
  return {
    extra: (el) => {
      c = kleineLeinwand(el);
      g = c.getContext("2d");
      bild.add(zeichne);
    },
    weg: () => bild.delete(zeichne),
  };
}
