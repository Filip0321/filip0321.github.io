// Lage des Attraktors in der Welt: eine Drehung (3 × 3-Matrix) und eine Verschiebung.
// Aus Drehen, Kippen und Pendeln am Strick wird so eine einzige Rechnung, die der Shader
// auf jeden Punkt anwendet: welt = lage · punkt + versatz.
//
// Warum eine Matrix? Jede Drehung ist eine Rechnung der Form
//   x' = a·x + b·y + c·z,  y' = …,  z' = …
// also neun Zahlen. Zwei Drehungen nacheinander sind wieder neun Zahlen (die Matrizen multipliziert).
// So muss der Shader nicht wissen, wie viele Drehungen es gab; beim Mobile werden es viele.
//
// Die neun Zahlen stehen spaltenweise im Array (wie WebGL sie für mat3 erwartet):
//   [ m0 m3 m6 ]
//   [ m1 m4 m7 ]      m = [m0, m1, m2, m3, m4, m5, m6, m7, m8]
//   [ m2 m5 m8 ]

export const EINHEIT = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // keine Drehung

// um die Senkrechte (y): dieselbe Formel wie im Shader, x und z drehen sich
export function drehY(w) {
  const c = Math.cos(w);
  const s = Math.sin(w);
  // x' = c·x − s·z, z' = s·x + c·z
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

// um die Waagerechte x (Kippen nach vorn): y und z drehen sich
export function drehX(w) {
  const c = Math.cos(w);
  const s = Math.sin(w);
  // y' = c·y − s·z, z' = s·y + c·z
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

// um die Waagerechte z (Kippen zur Seite): x und y drehen sich
export function drehZ(w) {
  const c = Math.cos(w);
  const s = Math.sin(w);
  // x' = c·x − s·y, y' = s·x + c·y
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

// a · b: erst b, dann a anwenden (wie beim Lesen von rechts nach links)
export function mal(a, b) {
  const m = new Array(9);
  for (let spalte = 0; spalte < 3; spalte++) {
    for (let zeile = 0; zeile < 3; zeile++) {
      m[spalte * 3 + zeile] =
        a[zeile] * b[spalte * 3] + a[3 + zeile] * b[spalte * 3 + 1] + a[6 + zeile] * b[spalte * 3 + 2];
    }
  }
  return m;
}

// Spiegelung an der Diagonale. Bei einer Drehung ist das genau die Drehung rückwärts
// (die Spalten einer Drehmatrix stehen senkrecht aufeinander und haben die Länge 1)
export function transponiert(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

// um eine beliebige Achse k (Länge 1) um den Winkel w (Formel von Rodrigues):
//   R = cos(w) · E + sin(w) · [k]× + (1 − cos(w)) · k · kᵀ
// [k]× ist die Matrix, die das Kreuzprodukt k × v rechnet. Die drei Teile: was auf der Achse liegt,
// bleibt (k · kᵀ), der Rest dreht sich in der Ebene senkrecht zur Achse (cos und sin wie beim Einheitskreis).
export function drehUm([kx, ky, kz], w) {
  const c = Math.cos(w);
  const s = Math.sin(w);
  const t = 1 - c;
  return [
    c + t * kx * kx,      t * kx * ky + s * kz, t * kx * kz - s * ky, // Spalte 0
    t * kx * ky - s * kz, c + t * ky * ky,      t * ky * kz + s * kx, // Spalte 1
    t * kx * kz + s * ky, t * ky * kz - s * kx, c + t * kz * kz,      // Spalte 2
  ];
}

// die kleinste Drehung, die die Richtung a auf die Richtung b dreht (beide Länge 1):
// Achse senkrecht zu beiden (Kreuzprodukt), Winkel zwischen beiden (Skalarprodukt)
export function drehVonNach(a, b) {
  const achse = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const laenge = Math.hypot(...achse);
  const cos = Math.min(Math.max(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1), 1);
  if (laenge < 1e-9) {
    // gleiche Richtung: nichts zu tun; genau entgegengesetzt: jede Achse senkrecht dazu geht
    if (cos > 0) return [...EINHEIT];
    const senkrecht = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const k = [a[1] * senkrecht[2] - a[2] * senkrecht[1], a[2] * senkrecht[0] - a[0] * senkrecht[2], a[0] * senkrecht[1] - a[1] * senkrecht[0]];
    const l = Math.hypot(...k);
    return drehUm(k.map((x) => x / l), Math.PI);
  }
  return drehUm(achse.map((x) => x / laenge), Math.acos(cos));
}

// m · v für einen Punkt v = [x, y, z]
export function anwenden(m, [x, y, z]) {
  return [
    m[0] * x + m[3] * y + m[6] * z,
    m[1] * x + m[4] * y + m[7] * z,
    m[2] * x + m[5] * y + m[8] * z,
  ];
}
