// Formen als Striche: jeder Strich ist eine Liste von Punkten [x, y] oder [x, y, z], alle −1 bis 1, y nach oben
// (wie am Oszilloskop), z zum Betrachter. Daraus wird ein Umlauf (umlauf): genau eine Runde über alle Striche,
// als gleich lange Schritte, die der Ton dann f-mal pro Sekunde abläuft.
// 3D: der Ton dreht die Punkte im Raum und rechnet sie mit Perspektive auf die Ebene (ton-worklet.js). Darum
// bleibt z im Umlauf erhalten; das Oszilloskop selbst kennt nur x und y.

const kreisPunkte = (n, fx, fy = fx, phase = 0, r = 0.8) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [r * Math.sin(fx * t + phase), r * Math.sin(fy * t)];
  });

// ---------- 3D: Körper aus Ecken und Kanten ----------
// Kanten → möglichst wenige Striche: von einer Ecke aus immer eine noch nicht gelaufene Kante nehmen; geht es nicht
// weiter, zur nächsten Ecke springen, an der noch Kanten übrig sind. Jeder Sprung ist eine Linie mehr auf dem Schirm
export function kantenZuStrichen(ecken, kanten) {
  const frei = kanten.map(([a, b]) => [a, b]);
  const anEcke = new Map();
  frei.forEach(([a, b], i) => {
    for (const e of [a, b]) {
      if (!anEcke.has(e)) anEcke.set(e, []);
      anEcke.get(e).push(i);
    }
  });
  const benutzt = new Set();
  const striche = [];
  let jetzt = frei.length ? frei[0][0] : null;
  while (benutzt.size < frei.length) {
    const strich = [ecken[jetzt]];
    for (;;) {
      const i = (anEcke.get(jetzt) ?? []).find((k) => !benutzt.has(k));
      if (i === undefined) break;
      benutzt.add(i);
      jetzt = frei[i][0] === jetzt ? frei[i][1] : frei[i][0];
      strich.push(ecken[jetzt]);
    }
    if (strich.length > 1) striche.push(strich);
    // nächste Ecke mit freien Kanten, die am nächsten liegt
    let beste = null;
    let abstand = Infinity;
    for (const [e, liste] of anEcke) {
      if (!liste.some((k) => !benutzt.has(k))) continue;
      const d = Math.hypot(...ecken[e].map((v, j) => v - ecken[jetzt][j]));
      if (d < abstand) {
        abstand = d;
        beste = e;
      }
    }
    if (beste === null) break;
    jetzt = beste;
  }
  return striche;
}

// auf eine Größe bringen: die weiteste Ecke liegt bei groesse vom Mittelpunkt
function normiere(ecken, groesse = 0.75) {
  const mitte = [0, 1, 2].map((k) => ecken.reduce((s, e) => s + e[k], 0) / ecken.length);
  const r = Math.max(...ecken.map((e) => Math.hypot(e[0] - mitte[0], e[1] - mitte[1], e[2] - mitte[2]))) || 1;
  return ecken.map((e) => e.map((v, k) => ((v - mitte[k]) / r) * groesse));
}

// Kanten eines Körpers aus seinen Ecken: alle Paare im kürzesten Abstand (bei den platonischen Körpern genau die Kanten)
function kurzeKanten(ecken) {
  let kurz = Infinity;
  for (let i = 0; i < ecken.length; i++) for (let j = i + 1; j < ecken.length; j++) kurz = Math.min(kurz, Math.hypot(...ecken[i].map((v, k) => v - ecken[j][k])));
  const kanten = [];
  for (let i = 0; i < ecken.length; i++) for (let j = i + 1; j < ecken.length; j++) if (Math.hypot(...ecken[i].map((v, k) => v - ecken[j][k])) < kurz * 1.01) kanten.push([i, j]);
  return kanten;
}
const koerper = (ecken) => {
  const e = normiere(ecken);
  return kantenZuStrichen(e, kurzeKanten(e));
};
const phi = (1 + Math.sqrt(5)) / 2;

export const FORMEN = {
  kreis: () => [kreisPunkte(256, 1, 1, Math.PI / 2)],
  quadrat: () => [[[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7]]],
  dreieck: () => [[[0, 0.8], [0.7, -0.5], [-0.7, -0.5], [0, 0.8]]],
  stern: () => [Array.from({ length: 11 }, (_, i) => {
    const r = i % 2 ? 0.35 : 0.85;
    const t = (Math.PI * i) / 5 + Math.PI / 2;
    return [r * Math.cos(t), r * Math.sin(t)];
  })],
  herz: () => [Array.from({ length: 257 }, (_, i) => {
    const t = (2 * Math.PI * i) / 256;
    return [0.05 * 16 * Math.sin(t) ** 3, 0.05 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  })],
  spirale: () => [Array.from({ length: 401 }, (_, i) => {
    const t = i / 400;
    return [0.85 * t * Math.cos(t * 6 * 2 * Math.PI), 0.85 * t * Math.sin(t * 6 * 2 * Math.PI)];
  })],
  // Lissajous: x und y sind zwei Sinustöne im Verhältnis a : b. Bei ganzen Zahlen schließt sich die Figur
  lissajous: (w) => [kreisPunkte(1024, w.a, w.b, (w.phase * Math.PI) / 180)],

  // 3D
  wuerfel: () => koerper([[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]),
  tetraeder: () => koerper([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]),
  oktaeder: () => koerper([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]),
  ikosaeder: () => koerper([[0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi], [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0], [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]]),
  // Kugel aus Breitenkreisen und Längenkreisen
  kugel: () => {
    const striche = [];
    for (let b = 1; b < 6; b++) {
      const t = (Math.PI * b) / 6;
      striche.push(Array.from({ length: 65 }, (_, i) => {
        const a = (2 * Math.PI * i) / 64;
        return [0.75 * Math.sin(t) * Math.cos(a), 0.75 * Math.cos(t), 0.75 * Math.sin(t) * Math.sin(a)];
      }));
    }
    for (let l = 0; l < 6; l++) {
      const a = (Math.PI * l) / 6;
      striche.push(Array.from({ length: 65 }, (_, i) => {
        const t = (2 * Math.PI * i) / 64;
        return [0.75 * Math.sin(t) * Math.cos(a), 0.75 * Math.cos(t), 0.75 * Math.sin(t) * Math.sin(a)];
      }));
    }
    return striche;
  },
  // Torusknoten (p, q): eine einzige Linie, die p-mal um das Loch und q-mal durch es hindurch läuft; ohne Sprung
  knoten: (w) => [Array.from({ length: 1025 }, (_, i) => {
    const t = (2 * Math.PI * i) / 1024;
    const r = 0.5 + 0.22 * Math.cos(w.b * t);
    return [r * Math.cos(w.a * t), r * Math.sin(w.a * t), 0.22 * Math.sin(w.b * t)];
  })],
};
export const DREI_D = new Set(["wuerfel", "tetraeder", "oktaeder", "ikosaeder", "kugel", "knoten"]);

// ---------- Umlauf ----------
// Alle Striche hintereinander, auch die Sprünge zwischen ihnen (ein Oszilloskop ohne Z-Eingang kann den Strahl
// nicht ausschalten: jeder Sprung ist eine Linie). Damit sie kaum zu sehen sind, bekommen sie wenig Zeit:
// sprungZeit = 0,05 heißt, eine Strecke im Sprung dauert ein Zwanzigstel so lang wie gezeichnet. Wo der Strahl
// schnell ist, landen weniger Elektronen: die Linie wird blass.
// Dann gleichmäßig auf m Punkte verteilt (nach Zeit, nicht nach Strecke): der Ton liest sie der Reihe nach.
// Zum Schluss die Mitte abziehen: Soundkarten lassen keinen Gleichanteil durch (Kondensator am Ausgang),
// eine Figur, die nicht um 0 liegt, würde sonst langsam zur Mitte wandern. (z nicht: es kommt nie heraus.)
export function umlauf(striche, m = 2048, sprungZeit = 0.05) {
  const z3 = (p) => [p[0], p[1], p[2] ?? 0];
  const voll = striche.filter((s) => s.length).map((s) => s.map(z3));
  const teile = []; // [a, b, zeitGewicht]
  let vorher = null;
  for (const strich of voll) {
    if (vorher) teile.push([vorher, strich[0], sprungZeit]);
    for (let i = 1; i < strich.length; i++) teile.push([strich[i - 1], strich[i], 1]);
    if (strich.length === 1) teile.push([strich[0], strich[0], 1]); // ein Punkt bleibt ein Punkt
    vorher = strich[strich.length - 1];
  }
  const leer = { x: new Float32Array(m), y: new Float32Array(m), z: new Float32Array(m) };
  if (!teile.length) return leer;
  teile.push([vorher, voll[0][0], sprungZeit]); // zurück zum Anfang
  // Zeit jedes Teils: Länge mal Gewicht (ein Punkt bekommt etwas Zeit, sonst wäre er unsichtbar)
  const zeiten = teile.map(([a, b, g]) => Math.max(0.002, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) * g);
  const gesamt = zeiten.reduce((s, z) => s + z, 0);
  const { x, y, z } = leer;
  let teil = 0;
  let anfang = 0; // Zeit, zu der das aktuelle Teil anfängt
  for (let i = 0; i < m; i++) {
    const t = (i / m) * gesamt;
    while (teil < teile.length - 1 && t > anfang + zeiten[teil]) anfang += zeiten[teil++];
    const f = Math.min(1, (t - anfang) / zeiten[teil]);
    const [a, b] = teile[teil];
    x[i] = a[0] + (b[0] - a[0]) * f;
    y[i] = a[1] + (b[1] - a[1]) * f;
    z[i] = a[2] + (b[2] - a[2]) * f;
  }
  let mx = 0;
  let my = 0;
  for (let i = 0; i < m; i++) {
    mx += x[i] / m;
    my += y[i] / m;
  }
  for (let i = 0; i < m; i++) {
    x[i] -= mx;
    y[i] -= my;
  }
  return { x, y, z, mitte: [mx, my] }; // mitte: so weit ist die Figur verschoben (die Zeichenfläche braucht es)
}

// ---------- OBJ (aus Blender) ----------
// v x y z: eine Ecke; f a b c …: eine Fläche aus Ecken (1-basiert, auch a/b/c); jede Flächenkante wird eine
// Linie, doppelte (zwei Flächen teilen sich eine Kante) nur einmal. l a b: eine freie Linie
export function ladeObj(text) {
  const ecken = [];
  const kanten = new Map();
  const dazu = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (a !== b && !kanten.has(k)) kanten.set(k, [a, b]);
  };
  for (const zeile of text.split("\n")) {
    const teile = zeile.trim().split(/\s+/);
    if (teile[0] === "v") ecken.push([Number(teile[1]), Number(teile[2]), Number(teile[3])]);
    else if (teile[0] === "f" || teile[0] === "l") {
      const idx = teile.slice(1).map((t) => {
        const n = parseInt(t.split("/")[0], 10);
        return n < 0 ? ecken.length + n : n - 1;
      });
      for (let i = 1; i < idx.length; i++) dazu(idx[i - 1], idx[i]);
      if (teile[0] === "f" && idx.length > 2) dazu(idx.at(-1), idx[0]);
    }
  }
  if (!ecken.length) throw new Error("In der Datei sind keine Ecken (v …).");
  return kantenZuStrichen(normiere(ecken), [...kanten.values()]);
}
