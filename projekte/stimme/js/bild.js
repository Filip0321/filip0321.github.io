// Das Bild: ein Schnitt durch Kopf und Hals, das Rohr auf einen Bogen gelegt (Kehlkopf unten links,
// hoch durch den Rachen, über die Zunge nach vorn zu den Lippen; die Nase als zweiter Bogen darüber).
// Außen ist die Wand fest (Rachenwand, Gaumen), innen bewegt sich die Zunge. Darunter die Tastatur
// für die Tonhöhe, rechts das Spektrum (dort sieht man die Formanten als Buckel).
//
// Dieselbe Geometrie (geometrie, wasIstBei) braucht die Seite, um Finger und Maus zu deuten.

const N = 44;
const NASE = 28;
const VELUM = 17;
export const ZUNGE_MIN = 12; // so weit darf die Zunge (wie bei Pink Trombone)
export const ZUNGE_MAX = 29;
export const WEITE_MIN = 2.05;
export const WEITE_MAX = 3.5;

export function geometrie(W, H) {
  const R = H * 0.47; // Außenwand
  const s = H * 0.052; // Pixel pro Einheit Durchmesser
  return {
    W, H, R, s,
    cx: W * 0.47,
    cy: H * 0.72,
    von: Math.PI + 0.1, // Winkel beim Kehlkopf
    bis: Math.PI / 2 - 0.55, // … bei den Lippen
    nase: R + 1.25 * s, // Innenwand der Nase
    tasten: { x: W * 0.03, y: H * 0.86, b: W * 0.94, h: H * 0.12 },
    spektrum: { x: W * 0.7, y: H * 0.5, b: W * 0.27, h: H * 0.26 },
  };
}
const winkel = (g, i) => g.von - (i / (N - 1)) * (g.von - g.bis);
const punkt = (g, w, r) => [g.cx + r * Math.cos(w), g.cy - r * Math.sin(w)];

// Was liegt unter (x, y)? Zunge, Engstelle (mit Ort und Weite), Tastatur (mit Anteil x und y) oder nichts.
// Mit "nur" wird es auf jeden Fall das (beim Ziehen: wer die Zunge greift, behält sie, auch wenn er abrutscht).
export function wasIstBei(g, x, y, nur) {
  const t = g.tasten;
  const imFeld = (a) => Math.min(1, Math.max(0, a));
  if (nur === "tasten" || (!nur && x >= t.x && x <= t.x + t.b && y >= t.y - 4 && y <= t.y + t.h + 4)) {
    return { art: "tasten", x: imFeld((x - t.x) / t.b), y: imFeld((y - t.y) / t.h) };
  }
  const dx = x - g.cx;
  const dy = g.cy - y;
  const r = Math.hypot(dx, dy);
  let w = Math.atan2(dy, dx);
  if (w < -Math.PI / 2) w += 2 * Math.PI; // so bleibt der Bogen (von π+0,1 bis π/2−0,55) am Stück
  const ort = ((g.von - w) / (g.von - g.bis)) * (N - 1);
  const tief = (g.R - r) / g.s; // in Einheiten Durchmesser unter der Außenwand
  const zunge = { art: "zunge", ort: Math.min(ZUNGE_MAX, Math.max(ZUNGE_MIN, ort)), weite: Math.min(WEITE_MAX, Math.max(WEITE_MIN, tief)) };
  const enge = { art: "enge", ort: Math.min(N - 1, Math.max(2, ort)), weite: Math.max(0, tief - 0.3) }; // ganz an der Außenwand = zu
  if (nur === "zunge") return zunge;
  if (nur === "enge") return enge;
  if (w > g.von + 0.05 || w < g.bis - 0.12 || tief < -0.6) return { art: "nichts" };
  if (tief > 2.0) return ort >= ZUNGE_MIN - 2 && ort <= ZUNGE_MAX + 2 && tief < 4.5 ? zunge : { art: "nichts" };
  return enge;
}

export function zeichne(ctx, g, z, farben) {
  const { W, H, R, s } = g;
  ctx.fillStyle = farben.grund;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = Math.max(1, H / 360);
  ctx.lineJoin = "round";

  // Fleisch: ein dickes Band um den Bogen (Hals, Zunge, Gaumen, Nase)
  ctx.fillStyle = farben.fleisch;
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) ctx.lineTo(...punkt(g, g.von + 0.04 - (i / 40) * (g.von - g.bis + 0.12), g.nase + 2.3 * s));
  for (let i = 40; i >= 0; i--) ctx.lineTo(...punkt(g, g.von + 0.04 - (i / 40) * (g.von - g.bis + 0.12), R - 4.2 * s));
  ctx.closePath();
  ctx.fill();

  // Luft im Rohr: zwischen Außenwand und Zunge
  const d = z.d;
  ctx.fillStyle = farben.luft;
  ctx.beginPath();
  for (let i = 0; i < N; i++) ctx.lineTo(...punkt(g, winkel(g, i), R));
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(...punkt(g, winkel(g, i), R - d[i] * s));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = farben.linie;
  ctx.beginPath();
  for (let i = 0; i < N; i++) ctx.lineTo(...punkt(g, winkel(g, i), R - d[i] * s));
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < N; i++) ctx.lineTo(...punkt(g, winkel(g, i), R));
  ctx.stroke();

  // Nase: von der Abzweigung am Velum bis zum Ende des Mundes
  const nw = (j) => winkel(g, VELUM + (j / (NASE - 1)) * (N - 1 - VELUM));
  ctx.fillStyle = farben.luft;
  ctx.beginPath();
  for (let j = 0; j < NASE; j++) ctx.lineTo(...punkt(g, nw(j), g.nase));
  for (let j = NASE - 1; j >= 0; j--) ctx.lineTo(...punkt(g, nw(j), g.nase + z.nase[j] * s * 0.7));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Gaumensegel: ein Durchgang vom Rohr zur Nase, so breit wie es offen ist
  if (z.velum > 0.03) {
    const breite = z.velum * 0.08;
    const w0 = winkel(g, VELUM);
    ctx.beginPath();
    ctx.lineTo(...punkt(g, w0 + breite, R - 0.05 * s));
    ctx.lineTo(...punkt(g, w0 + breite, g.nase + 0.05 * s));
    ctx.lineTo(...punkt(g, w0 - breite, g.nase + 0.05 * s));
    ctx.lineTo(...punkt(g, w0 - breite, R - 0.05 * s));
    ctx.closePath();
    ctx.fill();
  }

  // Kehlkopf: zwei Striche, die im Takt der Stimme auf- und zugehen
  const w0 = winkel(g, 0) + 0.03;
  const auf = z.stimmhaft * (0.5 + 0.5 * Math.sin(2 * Math.PI * z.phase)) * 0.5 * d[0] * s;
  const mitte = R - d[0] * s * 0.5;
  ctx.beginPath();
  ctx.moveTo(...punkt(g, w0, R + 0.1 * s));
  ctx.lineTo(...punkt(g, w0, mitte + auf * 0.5));
  ctx.moveTo(...punkt(g, w0, R - d[0] * s - 0.1 * s));
  ctx.lineTo(...punkt(g, w0, mitte - auf * 0.5));
  ctx.stroke();

  // Griff der Zunge
  ctx.strokeStyle = farben.griff;
  const [zx, zy] = punkt(g, winkel(g, z.zungeOrt), R - z.zungeWeite * s);
  ctx.beginPath();
  ctx.arc(zx, zy, s * 0.45, 0, 2 * Math.PI);
  ctx.stroke();
  // Finger auf Engstellen
  for (const e of z.finger) {
    const [ex, ey] = punkt(g, winkel(g, e.ort), R - (e.weite + 0.3) * s);
    ctx.beginPath();
    ctx.arc(ex, ey, s * 0.3, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // Beschriftung
  if (z.beschriftung) {
    ctx.fillStyle = farben.linie;
    ctx.font = `${Math.round(H / 34)}px monospace`;
    ctx.textAlign = "center";
    const text = (t, i, r) => ctx.fillText(t, ...punkt(g, winkel(g, i), r));
    text("Kehlkopf", -1.2, R - 0.6 * s);
    text("Rachen", 6, R - 5.2 * s);
    text("Nase", 33, g.nase + 2.7 * s);
    text("Zunge", 20, R - 4.8 * s);
    text("Lippen", 43, R - 2.6 * s);
    ctx.fillText("Tonhöhe ← →   gepresst ↑ ↓ hauchig", g.W / 2, g.tasten.y - 0.012 * H);
  }

  // Tastatur: zwei Oktaven, eine Linie pro Halbton, Oktaven heller
  const t = g.tasten;
  ctx.strokeStyle = farben.fleisch;
  ctx.strokeRect(t.x, t.y, t.b, t.h);
  for (let k = 0; k <= 24; k++) {
    const x = t.x + (k / 24) * t.b;
    ctx.strokeStyle = k % 12 === 0 ? farben.linie : farben.fleisch;
    ctx.beginPath();
    ctx.moveTo(x, t.y);
    ctx.lineTo(x, t.y + t.h * ([1, 3, 6, 8, 10].includes(k % 12) ? 0.55 : 1));
    ctx.stroke();
  }
  // wo die Stimme gerade ist
  const fx = Math.log2(z.frequenz / z.tastenVon) / 2;
  if (fx >= 0 && fx <= 1) {
    ctx.fillStyle = farben.linie;
    ctx.beginPath();
    ctx.moveTo(t.x + fx * t.b, t.y + t.h);
    ctx.lineTo(t.x + fx * t.b - 0.25 * s, t.y + t.h + 0.35 * s);
    ctx.lineTo(t.x + fx * t.b + 0.25 * s, t.y + t.h + 0.35 * s);
    ctx.fill();
  }
  if (z.taste) {
    ctx.fillStyle = farben.griff;
    ctx.fillRect(t.x + z.taste.x * t.b - 2, t.y + z.taste.y * t.h - 2, 4, 4);
  }

  // Spektrum: dB über log-Frequenz (50 bis 5000 Hz)
  if (z.spektrum) {
    const b = g.spektrum;
    const sp = z.spektrum;
    const fach = z.rate / 2 / sp.length;
    ctx.strokeStyle = farben.fleisch;
    ctx.strokeRect(b.x, b.y, b.b, b.h);
    ctx.strokeStyle = farben.linie;
    ctx.beginPath();
    for (let k = 0; k <= 120; k++) {
      const f = 50 * 100 ** (k / 120);
      const wert = sp[Math.min(sp.length - 1, Math.round(f / fach))];
      const y = b.y + b.h * Math.min(1, Math.max(0, (-30 - wert) / 70));
      ctx.lineTo(b.x + (k / 120) * b.b, y);
    }
    ctx.stroke();
    if (z.beschriftung) {
      ctx.fillStyle = farben.linie;
      ctx.textAlign = "left";
      ctx.fillText("Spektrum", b.x, b.y - 0.012 * H);
    }
  }
}
