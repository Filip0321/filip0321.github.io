// Der Attraktor als starrer Körper am Faden (Strick).
//
// Bisher hing er am höchsten Punkt und konnte sich nur um den Faden drehen (Torsion).
// Jetzt hat er eine Masse, die sich über alle Punkte verteilt, und die Schwere dreht ihn,
// bis sein Schwerpunkt genau unter dem Aufhängepunkt liegt. Stößt man ihn an, pendelt er darum
// herum, kippt, eiert und dreht sich, je nachdem, wie seine Masse verteilt ist.
//
// Drei Größen beschreiben den Körper (alle im Raum des Attraktors, −1 bis 1, vor jeder Drehung):
//   S  Schwerpunkt: der Durchschnitt aller Punkte. Jeder Punkt wiegt gleich viel, darum sind dichte Stellen
//      von selbst schwerer: wo viele Punkte liegen, liegt viel Masse.
//   A  Aufhängepunkt: wo der Faden festgemacht ist
//   J  Trägheitstensor um A: wie schwer er sich um welche Achse drehen lässt (siehe vermesseKoerper)
//
// Gerechnet wird mit dem Drehimpuls L (in der Welt) statt mit der Drehgeschwindigkeit:
//   dL/dt = Drehmoment                 (wie dv/dt = Kraft / Masse beim Verschieben)
//   ω = I⁻¹ · L                        (I = Trägheitstensor in der Welt, ändert sich mit der Lage)
// Die Lage selbst ist ein Quaternion (siehe unten): vier Zahlen statt neun, und nach vielen kleinen
// Schritten lässt es sich leicht wieder zu einer reinen Drehung machen (normieren).

import { mal, anwenden, transponiert } from "./lage.js";

const STICHPROBE = 200000; // höchstens so viele Punkte für Schwerpunkt, Aufhängepunkt und Trägheit
const SEITLICH = 1; // „oben“: so viel Höhe kostet es, eine Einheit neben dem Schwerpunkt zu liegen

// Schwerpunkt, Aufhängepunkt und Trägheit aus den Punkten.
// daten: Punktliste (x, y, z, x, y, z, …), mitte und mass aus vermesseAttraktor
// art: "oben" = hoch und möglichst über dem Schwerpunkt, "mitte" = der Punkt, der der Mitte am nächsten liegt
//      (der Mitte der Vermessung, wie beim Maßstab), "schwerpunkt" = genau im Schwerpunkt
// kipp: Kippung als Matrix (nur für „oben“: was oben ist, hängt davon ab, wie er gekippt ist)
export function vermesseKoerper(daten, { mitteX, mitteY, mitteZ, mass }, art, kipp) {
  const n = daten.length / 3;
  const sprung = Math.max(1, Math.floor(n / STICHPROBE));
  // in den Raum −1 bis 1, wie im Shader: (punkt − mitte) / mass · 2
  const punkt = (i) => [
    (daten[i * 3] - mitteX) / mass * 2,
    (daten[i * 3 + 1] - mitteY) / mass * 2,
    (daten[i * 3 + 2] - mitteZ) / mass * 2,
  ];

  // 1. Schwerpunkt = Durchschnitt
  const S = [0, 0, 0];
  let gezaehlt = 0;
  for (let i = 0; i < n; i += sprung) {
    const p = punkt(i);
    S[0] += p[0]; S[1] += p[1]; S[2] += p[2];
    gezaehlt++;
  }
  S.forEach((_, k) => (S[k] /= gezaehlt));

  // 2. Aufhängepunkt
  let A;
  if (art === "schwerpunkt") {
    A = [...S];
  } else if (art === "mitte") {
    // der Punkt mit dem kleinsten Abstand zur Mitte (0, 0, 0); Abstand im Quadrat reicht zum Vergleichen
    let bester = Infinity;
    for (let i = 0; i < n; i += sprung) {
      const p = punkt(i);
      const d = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
      if (d < bester) { bester = d; A = p; }
    }
  } else {
    // oben: gekippt betrachtet ein hoher Punkt, der nicht weit neben dem Schwerpunkt liegt.
    // Nur der höchste wäre oft weit außen (beim Lorenz auf einem Flügel), dann kippt er stark.
    // Nur genau über dem Schwerpunkt wäre beim Lorenz das Loch zwischen den Flügeln, also ganz tief.
    // Darum Punkte nach Höhe minus seitlichem Abstand bewerten und den besten nehmen.
    const s = anwenden(kipp, S);
    let bester = -Infinity;
    for (let i = 0; i < n; i += sprung) {
      const p = punkt(i);
      const g = anwenden(kipp, p);
      const wert = g[1] - SEITLICH * Math.hypot(g[0] - s[0], g[2] - s[2]);
      if (wert > bester) { bester = wert; A = p; }
    }
  }

  // 3. Trägheitstensor um A, pro Masse (jeder Punkt wiegt 1 / Anzahl):
  //   J = Durchschnitt von (|r|² · E − r · rᵀ),  r = Punkt − A
  // Auf der Diagonale steht, wie weit die Masse von jeder Achse entfernt ist (im Quadrat: doppelt so weit
  // weg = viermal so träge). Außerhalb der Diagonale steht, wie schief die Masse verteilt ist; daran liegt es,
  // dass ein Stoß um eine Achse ihn auch um eine andere drehen lässt (er eiert).
  const J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i += sprung) {
    const p = punkt(i);
    const r = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
    const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
    for (let spalte = 0; spalte < 3; spalte++) {
      for (let zeile = 0; zeile < 3; zeile++) {
        J[spalte * 3 + zeile] += (zeile === spalte ? r2 : 0) - r[zeile] * r[spalte];
      }
    }
  }
  for (let k = 0; k < 9; k++) J[k] /= gezaehlt;

  return { S, A, J, hebel: Math.hypot(S[0] - A[0], S[1] - A[1], S[2] - A[2]) };
}


// Quaternionen: eine Drehung um die Achse k (Länge 1) um den Winkel w ist
//   q = (cos(w/2), sin(w/2) · k)   als [w, x, y, z]
// Zwei Drehungen nacheinander: q2 · q1 (Hamilton-Produkt, unten). Warum die halben Winkel? Dadurch wird das
// Hintereinander-Ausführen eine einfache Multiplikation; mehr muss man dafür nicht wissen.

function quatMal([aw, ax, ay, az], [bw, bx, by, bz]) {
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

// Drehung um den Vektor v: Richtung = Achse, Länge = Winkel (so kommt sie aus ω · Zeit)
function quatAusVektor([x, y, z]) {
  const w = Math.hypot(x, y, z);
  if (w < 1e-12) return [1, 0, 0, 0];
  const s = Math.sin(w / 2) / w;
  return [Math.cos(w / 2), x * s, y * s, z * s];
}

function normiere(q) {
  const l = Math.hypot(...q);
  return q.map((k) => k / l);
}

// Quaternion → Drehmatrix (spaltenweise wie in lage.js)
export function quatZuMatrix([w, x, y, z]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z),     2 * (x * z - w * y),
    2 * (x * y - w * z),     1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
    2 * (x * z + w * y),     2 * (y * z - w * x),     1 - 2 * (x * x + y * y),
  ];
}

const kreuz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Umkehrmatrix einer 3 × 3-Matrix (für ω = I⁻¹ · L): Kreuzprodukte der Spalten geteilt durch die Determinante
function invers(m) {
  const a = [m[0], m[1], m[2]];
  const b = [m[3], m[4], m[5]];
  const c = [m[6], m[7], m[8]];
  const bc = kreuz(b, c);
  const ca = kreuz(c, a);
  const ab = kreuz(a, b);
  const det = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2];
  // die Zeilen der Umkehrung sind bc, ca, ab (geteilt durch det); spaltenweise hingeschrieben:
  return [bc[0], ca[0], ab[0], bc[1], ca[1], ab[1], bc[2], ca[2], ab[2]].map((k) => k / det);
}


// Der Zustand: abweichung = Drehung weg von der Ruhelage (Quaternion), L = Drehimpuls in der Welt
export function erstelleKoerper() {
  let abweichung = [1, 0, 0, 0];
  let L = [0, 0, 0];
  let letztesMoment = 0; // wie stark Schwere und Faden zuletzt an ihm drehten (für bewegtSich)

  // Lage in der Welt: erst in Ruhe hängen (ruhe, Matrix), dann um die Abweichung gedreht
  const lage = (ruhe) => mal(quatZuMatrix(abweichung), ruhe);

  // Trägheit in der Welt: I = R · J · Rᵀ (J gilt im Raum des Attraktors, R dreht ihn in die Welt)
  const traegheit = (R, J) => mal(mal(R, J), transponiert(R));

  // Um h Sekunden weiter. koerper: aus vermesseKoerper; ruhe: Lage in Ruhe;
  // schwere: Beschleunigung, die der Körper spürt (die Schwere nach unten, dazu das Schwingen des Fadens);
  // torsion: wie stark der verdrillte Faden zurückdreht; daempfung: wie schnell alles ausläuft;
  // zusatz: weiteres Drehmoment (Musik)
  function schritt(h, { koerper, ruhe, schwere, torsion, daempfung, zusatz = [0, 0, 0] }) {
    const R = lage(ruhe);
    // Hebel vom Aufhängepunkt zum Schwerpunkt, in der Welt
    const r = anwenden(R, koerper.S.map((k, i) => k - koerper.A[i]));
    // Drehmoment = Hebel × Kraft: die Schwere zieht am Schwerpunkt. Liegt er genau unter A, sind Hebel
    // und Kraft parallel und das Kreuzprodukt ist 0: Ruhe. Seitlich daneben dreht sie ihn zurück.
    const moment = kreuz(r, schwere);
    // Torsion: wie weit ist er um die Senkrechte verdreht? Aus dem Quaternion der Anteil um y
    // („Swing-Twist-Zerlegung“): (w, 0, y, 0) normiert ist die reine Drehung um y, ihr Winkel 2 · atan2(y, w)
    let drill = 2 * Math.atan2(abweichung[2], abweichung[0]);
    if (drill > Math.PI) drill -= 2 * Math.PI;
    if (drill < -Math.PI) drill += 2 * Math.PI;
    const I = traegheit(R, koerper.J);
    // Torsion mal Trägheit um die Senkrechte (in Ruhe): so schwingt jeder Attraktor in etwa gleichem Takt,
    // egal wie seine Masse verteilt ist. Die Trägheit in Ruhe, nicht die jetzige: sonst hinge die Rückstellkraft
    // vom Kippen ab, und der Faden könnte beim Eiern Energie hineinpumpen, statt sie nur zu speichern
    moment[1] -= torsion * traegheit(ruhe, koerper.J)[4] * drill;
    letztesMoment = Math.hypot(...moment);
    for (let k = 0; k < 3; k++) {
      moment[k] += zusatz[k] - daempfung * L[k]; // Dämpfung: bremst proportional zum Drehimpuls
      L[k] += moment[k] * h;
    }
    // ω = I⁻¹ · L, dann um ω · h weiterdrehen (in der Welt, darum von links)
    const omega = anwenden(invers(I), L);
    abweichung = normiere(quatMal(quatAusVektor(omega.map((k) => k * h)), abweichung));
  }

  // Stoß: die Drehgeschwindigkeit ändert sich sofort um dOmega (Welt). ΔL = I · Δω
  function stoss(dOmega, koerper, ruhe) {
    const I = traegheit(lage(ruhe), koerper.J);
    const dL = anwenden(I, dOmega);
    L = L.map((k, i) => k + dL[i]);
  }

  // Er bewegt sich, solange er Schwung hat oder noch etwas an ihm dreht. Nicht nach der Lage fragen:
  // am Schwerpunkt aufgehängt ruht er in jeder Lage, und am Umkehrpunkt eines Pendels ist der Schwung kurz 0
  function bewegtSich() {
    return Math.hypot(...L) > 0.0002 || letztesMoment > 0.0005;
  }

  function halte() {
    abweichung = [1, 0, 0, 0];
    L = [0, 0, 0];
    letztesMoment = 0;
  }

  function merke() {
    const alt = { abweichung: [...abweichung], L: [...L] };
    return () => {
      abweichung = [...alt.abweichung];
      L = [...alt.L];
    };
  }

  return { lage, schritt, stoss, bewegtSich, halte, merke };
}
