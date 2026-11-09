// Hall aus einem gekrümmten Raum: Schallstrahlen durch eine Zelle der Waben aus dem hyperbolischen Raum
// (dieselben Waben wie auf der Seite „Hyperbolischer Raum“), daraus die Impulsantwort für einen Faltungshall.
//
// Verfahren (Krokstad 1968, „Ray Tracing“ für Raumakustik): von der Quelle viele Strahlen in zufällige Richtungen.
// Jeder Strahl trägt Energie in drei Bändern (tief, mitte, hoch), läuft geradeaus (im gekrümmten Raum: auf einer
// Geodäte), wird an Wänden gespiegelt und verliert dort je Band einen Anteil (Absorption, hohe Töne mehr).
// Kommt er am Hörer vorbei (einer kleinen Kugel), wird seine Energie zur Zeit „Weg / Schallgeschwindigkeit“
// gezählt. Das Ergebnis ist ein Energie-Histogramm über der Zeit; daraus wird Rauschen mit dieser Hüllkurve
// geformt (für jedes Band gefiltert) – das ist die Impulsantwort.
//
// Was im hyperbolischen Raum anders ist:
//   - Eine Kugel vom Radius r hat die Fläche 4π·sinh²r statt 4π·r²: der Schall verdünnt sich mit dem Abstand
//     exponentiell statt quadratisch (direkter Schall fällt schneller ab)
//   - Spiegelbilder der Quelle (jede Reflexion ist eine) gibt es exponentiell viele statt quadratisch viele:
//     die Echos werden viel schneller dicht, der Hall klingt sofort „diffus“, ohne einzelne frühe Echos
//   - mit durchlässigen Wänden (die Waben als offenes Gitter): ein Strahl, der hinausgeht, kommt fast nie wieder,
//     weil fast der ganze Raum „weit draußen“ liegt. Der Hall verliert Energie ins Unendliche. Im flachen Gitter
//     dagegen irrt der Strahl umher und kommt immer wieder vorbei.
//
// Hyperbolisch gerechnet im Hyperboloid-Modell (siehe /projekte/hyperbolisch/js/raum.js):
//   Strahl:       p(t) = cosh t · x + sinh t · v
//   Wand n:       ⟨n, p⟩ = 0, innen negativ; Treffer bei tanh t = −⟨n, x⟩ / ⟨n, v⟩
//   Spiegeln:     u ← u − 2⟨u, n⟩ n         (u: Richtung im Treffpunkt)
//   Hörer h:      kürzester Abstand zur Geodäte aus A = −⟨x, h⟩, B = −⟨v, h⟩: tanh s* = −B / A, cosh d = √(A² − B²)
// Durch eine Wand hindurch in die Nachbarzelle: die Nachbarzelle ist das Spiegelbild der Zelle an dieser Wand.
// Darum wird die aktuelle Zelle als Matrix M mitgeführt (M ← M · S_j), ihre Wände sind M · n_i.

import { WABEN, flaechen, mink } from "/projekte/hyperbolisch/js/raum.js";

export const SCHALL = 343; // m/s
export const BAENDER = [
  { name: "tief", von: 0, bis: 500, absorption: 0.05, luft: 0 },
  { name: "mitte", von: 500, bis: 2000, absorption: 0.1, luft: 0.0005 },
  { name: "hoch", von: 2000, bis: 24000, absorption: 0.25, luft: 0.003 },
];
export { WABEN };

// Zufall mit Startwert: dieselben Einstellungen geben denselben Hall
function zufallMit(start) {
  let zs = start | 0;
  return () => {
    zs = (zs + 0x6d2b79f5) | 0;
    let t = Math.imul(zs ^ (zs >>> 15), 1 | zs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function richtung(rnd) {
  // gleichmäßig auf der Kugel: z gleichverteilt, Winkel gleichverteilt
  const z = 2 * rnd() - 1;
  const w = 2 * Math.PI * rnd();
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(w), s * Math.sin(w), z];
}
const norm3 = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

// e: { wabe, groesse (Innenradius der Zelle in m), daempfung (mal die Absorption), durchlaessig (0 bis 1),
//      dauer (s), strahlen, flachVergleich (true: statt der Wabe ein flacher Würfel gleicher Größe) }
// zurück: { energie: [3][bins] (je Millisekunde), wege: einige Strahlwege fürs Bild, r, R }
export function verfolge(e, flach) {
  const rnd = zufallMit(12345);
  const bins = Math.ceil(e.dauer * 1000);
  const energie = BAENDER.map(() => new Float64Array(bins));
  const maxWeg = e.dauer * SCHALL;
  const alpha = BAENDER.map((b) => Math.min(0.95, b.absorption * e.daempfung));
  const wege = [];
  const geom = flach ? flacheWelt(e) : hyperbolischeWelt(e);
  for (let s = 0; s < e.strahlen; s++) {
    const weg = s < 40 ? [] : null; // die ersten 40 Wege fürs Bild merken
    const E = [1, 1, 1].map((x) => x / e.strahlen);
    const strahl = geom.start(richtung(rnd));
    let meter = 0;
    if (weg) weg.push({ p: geom.bild(strahl), m: 0 });
    for (let schritt = 0; schritt < 100000 && meter < maxWeg; schritt++) {
      const treffer = geom.naechsteWand(strahl);
      if (!treffer) break;
      // am Hörer vorbei?
      const h = geom.hoerer(strahl, treffer.t);
      if (h) {
        const bin = Math.floor(((meter + h.s) / SCHALL) * 1000);
        if (bin < bins) for (let b = 0; b < 3; b++) energie[b][bin] += E[b] * Math.exp(-BAENDER[b].luft * (meter + h.s)) * h.gewicht;
      }
      // weiter bis zur Wand, dort durch oder zurück
      if (weg) geom.zwischenpunkte(strahl, treffer.t, meter, weg);
      meter += geom.meter(treffer.t);
      geom.gehe(strahl, treffer.t);
      if (rnd() < e.durchlaessig) geom.hindurch(strahl, treffer.wand);
      else {
        geom.spiegle(strahl, treffer.wand);
        for (let b = 0; b < 3; b++) E[b] *= 1 - alpha[b];
      }
      if (E[0] < 1e-9 / e.strahlen || geom.zuWeit(strahl)) break;
    }
    if (weg) wege.push(weg);
  }
  return { energie, wege, geom };
}

// ---------- hyperbolisch ----------
function hyperbolischeWelt(e) {
  const F = flaechen(e.wabe);
  const n = F.normalen;
  const R = e.groesse / F.r; // Meter pro Einheit der Krümmung
  const punkt = (d, s) => [...d.map((x) => x * Math.sinh(s)), Math.cosh(s)];
  const quelle = punkt([1, 0, 0], 0.4 * F.r);
  const hoererOrt = punkt(norm3([0, 0.6, 0.8]), 0.35 * F.r);
  const rho = 0.25 * F.r; // Hörer-Kugel
  const volumen = Math.PI * (Math.sinh(2 * rho) - 2 * rho) * R ** 3; // Volumen einer hyperbolischen Kugel, in m³
  const coshRho = Math.cosh(rho);
  // Spiegelung an Wand j als Matrix: S q = q − 2⟨q, n⟩ n,  ⟨q, n⟩ = qᵀ J n mit J = diag(1, 1, 1, −1)
  const S = n.map((nj) => {
    const Jn = [nj[0], nj[1], nj[2], -nj[3]];
    const m = new Float64Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[4 * r + c] = (r === c ? 1 : 0) - 2 * nj[r] * Jn[c];
    return m;
  });
  const malMat = (A, B) => {
    const C = new Float64Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) C[4 * r + c] = A[4 * r] * B[c] + A[4 * r + 1] * B[4 + c] + A[4 * r + 2] * B[8 + c] + A[4 * r + 3] * B[12 + c];
    return C;
  };
  const malVek = (A, v) => [0, 1, 2, 3].map((r) => A[4 * r] * v[0] + A[4 * r + 1] * v[1] + A[4 * r + 2] * v[2] + A[4 * r + 3] * v[3]);
  const kombi = (a, x, b, y) => x.map((xi, i) => a * xi + b * y[i]);
  return {
    r: F.r,
    R,
    volumenZelle: null,
    start(d) {
      // Richtung d im Tangentialraum an der Quelle: (d, 0) auf die Tangente projizieren und normieren
      let v = [...d, 0];
      v = kombi(1, v, mink(v, quelle), quelle);
      v = v.map((x) => x / Math.sqrt(mink(v, v)));
      return { x: [...quelle], v, M: null, wand: n };
    },
    naechsteWand(st) {
      let tmin = Infinity;
      let wand = -1;
      for (let i = 0; i < st.wand.length; i++) {
        const a = mink(st.wand[i], st.x);
        const c = mink(st.wand[i], st.v);
        if (c <= 1e-12) continue; // läuft weg oder parallel
        const q = -a / c;
        if (q >= 1 || q <= 1e-12) continue; // trifft nie (oder steht schon drauf)
        const t = Math.atanh(q);
        if (t < tmin) {
          tmin = t;
          wand = i;
        }
      }
      return wand < 0 ? null : { t: tmin, wand };
    },
    hoerer(st, t) {
      const A = -mink(st.x, hoererOrt);
      const B = -mink(st.v, hoererOrt);
      if (A <= Math.abs(B)) return null;
      const s = Math.atanh(-B / A);
      if (s < 0 || s > t) return null;
      const coshD = Math.sqrt(A * A - B * B);
      if (coshD >= coshRho) return null;
      const sehne = 2 * Math.acosh(coshRho / coshD) * R; // Länge des Wegs durch die Hörer-Kugel
      return { s: s * R, gewicht: sehne / volumen };
    },
    meter: (t) => t * R,
    gehe(st, t) {
      const x = kombi(Math.cosh(t), st.x, Math.sinh(t), st.v);
      const v = kombi(Math.sinh(t), st.x, Math.cosh(t), st.v);
      // Rundungsfehler wegräumen: ⟨x, x⟩ = −1, ⟨x, v⟩ = 0, ⟨v, v⟩ = 1
      const xs = x.map((a) => a / Math.sqrt(-mink(x, x)));
      let vs = kombi(1, v, mink(v, xs), xs);
      vs = vs.map((a) => a / Math.sqrt(mink(vs, vs)));
      st.x = xs;
      st.v = vs;
    },
    spiegle(st, j) {
      const w = st.wand[j];
      st.v = kombi(1, st.v, -2 * mink(st.v, w), w);
    },
    hindurch(st, j) {
      st.M = st.M ? malMat(st.M, S[j]) : S[j];
      st.wand = n.map((ni) => malVek(st.M, ni));
    },
    zuWeit: (st) => st.x[3] > 1e6, // weiter als etwa 14 Einheiten draußen: kommt nicht mehr zurück, und die Rechnung wird ungenau
    // fürs Bild: Poincaré-Kugel (der ganze unendliche Raum in einer Kugel vom Radius 1)
    bild: (st) => [st.x[0] / (1 + st.x[3]), st.x[1] / (1 + st.x[3]), st.x[2] / (1 + st.x[3])],
    zwischenpunkte(st, t, meter, weg) {
      const k = Math.max(1, Math.ceil(t / 0.08));
      for (let i = 1; i <= k; i++) {
        const s = (t * i) / k;
        const p = kombi(Math.cosh(s), st.x, Math.sinh(s), st.v);
        weg.push({ p: [p[0] / (1 + p[3]), p[1] / (1 + p[3]), p[2] / (1 + p[3])], m: meter + s * R });
      }
    },
    hoererBild: [hoererOrt[0] / (1 + hoererOrt[3]), hoererOrt[1] / (1 + hoererOrt[3]), hoererOrt[2] / (1 + hoererOrt[3])],
    quelleBild: [quelle[0] / (1 + quelle[3]), 0, 0],
  };
}

// ---------- flach: Würfel mit demselben Innenradius ----------
function flacheWelt(e) {
  const a = e.groesse;
  const quelle = [0.4 * a, 0, 0];
  const hoererOrt = norm3([0, 0.6, 0.8]).map((x) => x * 0.35 * a);
  const rho = 0.25 * a;
  const volumen = (4 / 3) * Math.PI * rho ** 3;
  // fürs Bild: in eine Kugel vom Radius 1 stauchen wie die Poincaré-Kugel (x / (a·k + |x|)), damit beide gleich aussehen
  const zuBild = (p) => {
    const l = Math.hypot(...p);
    return p.map((x) => x / (2.2 * a + l));
  };
  return {
    r: a,
    R: 1,
    start: (d) => ({ x: [...quelle], v: d }),
    naechsteWand(st) {
      let tmin = Infinity;
      let wand = -1;
      for (let k = 0; k < 3; k++) {
        const d = st.v[k];
        if (Math.abs(d) < 1e-12) continue;
        // Zellen sind Würfel um 2a·m, Wände bei 2a·m ± a; die nächste in Bewegungsrichtung
        const c = Math.round(st.x[k] / (2 * a));
        let ebene = 2 * a * c + Math.sign(d) * a;
        if ((ebene - st.x[k]) * Math.sign(d) <= 1e-9) ebene += Math.sign(d) * 2 * a; // steht schon auf der Wand
        const t = (ebene - st.x[k]) / d;
        if (t < tmin) {
          tmin = t;
          wand = k;
        }
      }
      return { t: tmin, wand };
    },
    hoerer(st, t) {
      const w = st.x.map((x, i) => hoererOrt[i] - x);
      const s = w[0] * st.v[0] + w[1] * st.v[1] + w[2] * st.v[2];
      if (s < 0 || s > t) return null;
      const d2 = w[0] ** 2 + w[1] ** 2 + w[2] ** 2 - s * s;
      if (d2 >= rho * rho) return null;
      return { s, gewicht: (2 * Math.sqrt(rho * rho - d2)) / volumen };
    },
    meter: (t) => t,
    gehe(st, t) {
      st.x = st.x.map((x, i) => x + st.v[i] * t);
    },
    spiegle(st, k) {
      st.v[k] = -st.v[k];
    },
    hindurch() {},
    zuWeit: (st) => Math.hypot(...st.x) > 1e5,
    bild: (st) => zuBild(st.x),
    zwischenpunkte(st, t, meter, weg) {
      const k = Math.max(1, Math.ceil(t / (0.08 * a)));
      for (let i = 1; i <= k; i++) {
        const s = (t * i) / k;
        weg.push({ p: zuBild(st.x.map((x, j) => x + st.v[j] * s)), m: meter + s });
      }
    },
    hoererBild: zuBild(hoererOrt),
    quelleBild: zuBild(quelle),
  };
}

// ---------- vom Histogramm zur Impulsantwort ----------
// Rauschen je Band, gefiltert (zwei Biquads hintereinander), mal √(Energie je Sample) aus dem Histogramm.
// Spät wird das Histogramm geglättet (wenige Strahlen kommen dort an, es wäre sonst körnig).
function biquad(art, f, q, rate) {
  const w = (2 * Math.PI * f) / rate;
  const a = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  let b0, b1, b2;
  if (art === "tief") [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  else [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a0 = 1 + a;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function filtere(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

export function impulsantwort(energie, rate, kanal) {
  const rnd = zufallMit(777 + kanal * 31);
  const bins = energie[0].length;
  const proBin = rate / 1000;
  const n = Math.ceil(bins * proBin);
  const ir = new Float32Array(n);
  for (let b = 0; b < 3; b++) {
    const band = BAENDER[b];
    const filter = [];
    if (band.von > 0) filter.push(biquad("hoch", band.von, 0.707, rate), biquad("hoch", band.von, 0.707, rate));
    if (band.bis < rate / 2) filter.push(biquad("tief", band.bis, 0.707, rate), biquad("tief", band.bis, 0.707, rate));
    const anteil = (Math.min(band.bis, rate / 2) - band.von) / (rate / 2); // so viel der Rauschleistung lässt das Band durch
    // geglättet: Fenster wächst mit der Zeit (1 ms am Anfang, 1 + t/25 ms später)
    const glatt = new Float64Array(bins);
    const summe = new Float64Array(bins + 1);
    for (let i = 0; i < bins; i++) summe[i + 1] = summe[i] + energie[b][i];
    for (let i = 0; i < bins; i++) {
      const w = Math.floor(i / 25);
      const lo = Math.max(0, i - w);
      const hi = Math.min(bins, i + w + 1);
      glatt[i] = (summe[hi] - summe[lo]) / (hi - lo);
    }
    for (let i = 0; i < n; i++) {
      const bin = Math.min(bins - 1, Math.floor(i / proBin));
      let x = (rnd() * 2 - 1) * Math.sqrt(3); // Varianz 1
      for (const f of filter) x = filtere(f, x);
      ir[i] += (x * Math.sqrt(glatt[bin] / proBin)) / Math.sqrt(anteil);
    }
  }
  return ir;
}

// Abklingkurve nach Schroeder (1965): Energie, die ab der Zeit t noch kommt, in dB. Ihre Steigung gibt die
// Nachhallzeit T60 (Zeit für −60 dB); gemessen zwischen −5 und −25 dB und hochgerechnet (wie T20 in der Akustik).
export function abklingkurve(e) {
  const n = e.length;
  const k = new Float64Array(n);
  let s = 0;
  for (let i = n - 1; i >= 0; i--) k[i] = s += e[i];
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) db[i] = 10 * Math.log10(k[i] / k[0] + 1e-12);
  const t5 = db.findIndex((x) => x <= -5);
  const t25 = db.findIndex((x) => x <= -25);
  const t60 = t5 >= 0 && t25 > t5 ? ((t25 - t5) / 1000) * 3 : null;
  return { db, t60 };
}
