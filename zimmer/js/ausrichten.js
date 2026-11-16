// Boden waagerecht: findet die Ebene des Bodens im Scan und gibt die Drehung zurück, die sie waagerecht legt.
//
// Ein Training (Postshot, COLMAP …) weiß nicht, wo „oben“ ist; es rät aus den Kamerapositionen. Hielt man die
// Kamera beim Aufnehmen etwas schräg, liegt das ganze Zimmer danach ein paar Grad schief.
//
// 1. Kandidaten: der Boden liegt unten. Also nur die untersten 25 % der Splats (nach Höhe), und nur deckende
//    (fast durchsichtige Splats sind oft Schwebeteile).
// 2. RANSAC („random sample consensus“, Fischler und Bolles 1981): immer wieder drei zufällige Punkte nehmen, die
//    Ebene durch sie legen und zählen, wie viele Punkte nah an ihr liegen. Die Ebene mit den meisten gewinnt. Das
//    ist robust: Möbel, Teppichkanten und Schwebeteile stören nicht, sie liegen einfach nicht auf der Ebene.
//    Nur Ebenen, die höchstens 25° schräg sind, zählen (sonst gewinnt vielleicht eine Wand).
// 3. Verfeinern: durch alle Punkte nah an der besten Ebene die Ebene legen, die am besten passt (kleinste
//    Abweichung im Quadrat). Ihre Normale ist der Eigenvektor zum kleinsten Eigenwert der Kovarianzmatrix der
//    Punkte (in diese Richtung streuen sie am wenigsten). Eigenwerte hier mit dem Jacobi-Verfahren.
// 4. Drehung: erst um z, bis die Normale keinen x-Anteil mehr hat, dann um x, bis auch der z-Anteil weg ist; dann
//    zeigt sie genau nach oben.

export function bodenNormale({ lage, farbe, anzahl }, groesse, zufall = Math.random) {
  // 1. Kandidaten (höchstens 200 000, gleichmäßig ausgedünnt)
  const schritt = Math.max(1, Math.floor(anzahl / 200000));
  const punkte = [];
  for (let i = 0; i < anzahl; i += schritt) if (farbe[4 * i + 3] > 80) punkte.push(i);
  const hoehen = punkte.map((i) => lage[3 * i + 1]).sort((a, b) => a - b);
  const grenze = hoehen[Math.floor(hoehen.length * 0.25)];
  const unten = punkte.filter((i) => lage[3 * i + 1] <= grenze);
  if (unten.length < 50) return null;
  const p = (i) => [lage[3 * i], lage[3 * i + 1], lage[3 * i + 2]];
  const toleranz = groesse * 0.004; // wie nah ein Punkt an der Ebene liegen muss
  const maxSchraeg = Math.cos((25 * Math.PI) / 180);
  // zum Zählen reicht eine Stichprobe
  const probe = [];
  for (let k = 0; k < Math.min(20000, unten.length); k++) probe.push(p(unten[Math.floor(zufall() * unten.length)]));

  // 2. RANSAC
  let beste = null, besteZahl = 0;
  for (let versuch = 0; versuch < 500; versuch++) {
    const [a, b, c] = [0, 1, 2].map(() => probe[Math.floor(zufall() * probe.length)]);
    let n = kreuz(sub(b, a), sub(c, a));
    const l = Math.hypot(...n);
    if (l < 1e-12) continue;
    n = n.map((v) => v / l);
    if (n[1] < 0) n = n.map((v) => -v);
    if (n[1] < maxSchraeg) continue;
    const d = punkt(n, a);
    let zahl = 0;
    for (const q of probe) if (Math.abs(punkt(n, q) - d) < toleranz) zahl++;
    if (zahl > besteZahl) [beste, besteZahl] = [{ n, d }, zahl];
  }
  if (!beste) return null;

  // 3. verfeinern: Kovarianz der Punkte nah an der Ebene, kleinster Eigenvektor
  const nah = probe.filter((q) => Math.abs(punkt(beste.n, q) - beste.d) < toleranz);
  const m = [0, 1, 2].map((k) => nah.reduce((s, q) => s + q[k], 0) / nah.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const q of nah) {
    const v = sub(q, m);
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) C[3 * r + s] += v[r] * v[s];
  }
  const { werte, vektoren } = jacobi(C);
  const kleinster = werte.indexOf(Math.min(...werte));
  let n = [vektoren[kleinster], vektoren[3 + kleinster], vektoren[6 + kleinster]];
  if (n[1] < 0) n = n.map((v) => -v);
  return { normale: n, anteil: besteZahl / probe.length, hoehe: punkt(n, m) };
}

// 4. die zwei Drehschritte in Grad, für dreheSzene: erst um z, dann um x
export function schritteZuOben([nx, ny, nz]) {
  const grad = 180 / Math.PI;
  const c = Math.atan2(nx, ny); // um z: danach ist der x-Anteil 0, der y-Anteil √(nx² + ny²)
  const a = Math.atan2(-nz, Math.hypot(nx, ny)); // um x: danach ist der z-Anteil 0
  return [[0, 0, c * grad], [a * grad, 0, 0]];
}

// Eigenwerte und -vektoren einer symmetrischen 3 × 3-Matrix (Jacobi: so lange mit kleinen Drehungen die
// Einträge neben der Diagonale wegdrehen, bis sie fast 0 sind; die Diagonale sind dann die Eigenwerte, die
// gesammelten Drehungen in den Spalten die Eigenvektoren)
function jacobi(M) {
  const A = M.slice();
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let runde = 0; runde < 50; runde++) {
    let [p, q, groesst] = [0, 1, Math.abs(A[1])];
    if (Math.abs(A[2]) > groesst) [p, q, groesst] = [0, 2, Math.abs(A[2])];
    if (Math.abs(A[5]) > groesst) [p, q, groesst] = [1, 2, Math.abs(A[5])];
    if (groesst < 1e-15) break;
    const theta = (A[3 * q + q] - A[3 * p + p]) / (2 * A[3 * p + q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const co = 1 / Math.sqrt(t * t + 1), si = t * co;
    for (let k = 0; k < 3; k++) {
      // Spalten p und q drehen …
      const akp = A[3 * k + p], akq = A[3 * k + q];
      A[3 * k + p] = co * akp - si * akq;
      A[3 * k + q] = si * akp + co * akq;
    }
    for (let k = 0; k < 3; k++) {
      // … dann die Zeilen
      const apk = A[3 * p + k], aqk = A[3 * q + k];
      A[3 * p + k] = co * apk - si * aqk;
      A[3 * q + k] = si * apk + co * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = V[3 * k + p], vkq = V[3 * k + q];
      V[3 * k + p] = co * vkp - si * vkq;
      V[3 * k + q] = si * vkp + co * vkq;
    }
  }
  return { werte: [A[0], A[4], A[8]], vektoren: V };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const punkt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kreuz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ungefähre Größe der Szene (größte Spanne zwischen 5 % und 95 % je Achse), für die Toleranz oben
export function groesseVon({ lage, anzahl }) {
  const schritt = Math.max(1, Math.floor(anzahl / 20000));
  let groesst = 0;
  for (let k = 0; k < 3; k++) {
    const a = [];
    for (let i = 0; i < anzahl; i += schritt) a.push(lage[3 * i + k]);
    a.sort((x, y) => x - y);
    groesst = Math.max(groesst, a[Math.floor(a.length * 0.95)] - a[Math.floor(a.length * 0.05)]);
  }
  return groesst || 1;
}
