// 3D-Fraktale, die aufhören (Mandelbulb, Mandelbox, Sierpinski, Quaternion-Julia), als Punkte, Gaussian Splats
// oder Netz (GLB, OBJ).
//
// Die Fraktale gibt es nur als Abstandsfunktion (wie weit ist es von p bis zur Oberfläche, höchstens; dieselben
// Formeln wie im Shader). Daraus Punkte machen: ein Gitter über den Würfel, in dem das Fraktal liegt, und jede
// Zelle nehmen, deren Mitte näher an der Oberfläche liegt als eine halbe Zelle. Das ist eine Schale aus Punkten
// auf der Oberfläche, fein wie das Gitter.
//
// Schneller: erst grob (Zellen 8-mal so groß). Weil der Abstand eine untere Schranke ist (näher kann die
// Oberfläche nicht sein), ist eine grobe Zelle, deren Mitte weiter weg ist als ihre halbe Diagonale, sicher leer:
// die feinen Zellen darin müssen nicht gefragt werden. Bei einem Fraktal ist der größte Teil des Würfels leer.
//
// Farbe wie im Bild: der Shader färbt mit der „Spur“ (orbit trap: wie nah der Punkt beim Rechnen der Mitte kam) aus
// dem Farbverlauf, gemischt mit der Grundfarbe (70 % Verlauf). Dieselbe Spur rechnet main.js (abstandFraktal) mit.
// Wahlweise nach dem Abstand von der Mitte. Dazu etwas Licht von oben (Normale = Gefälle des Abstands), damit die
// Form auch ohne Beleuchtung im Betrachter lesbar bleibt (beim Netz nicht: das beleuchtet das Programm selbst).
//
// Netz: dasselbe Gitter, aber als Zahlenfeld „halbe Zelle minus Abstand“ (drinnen positiv), daraus Surface Nets
// (lib/volumen/netz.js). Farbe je Eckpunkt (GLB: COLOR_0, OBJ: v x y z r g b).
//
// PLY: Splats im Graphdeco-Format (f_dc …) und zusätzlich red, green, blue als Bytes. Splat-Programme lesen f_dc,
// der normale PLY-Import (Blender, MeshLab) liest red/green/blue: so kommen die Farben überall mit.

import { flaeche, inWelt } from "/lib/volumen/netz.js";

const C0 = 0.28209479177387814;

// Farbe an p: f(p) → [r, g, b] von 0 bis 1 (main.js baut sie: Spur oder Abstand, aus dem Verlauf)
function licht(abstand, p, e) {
  const nx = abstand([p[0] + e, p[1], p[2]]) - abstand([p[0] - e, p[1], p[2]]);
  const ny = abstand([p[0], p[1] + e, p[2]]) - abstand([p[0], p[1] - e, p[2]]);
  const nz = abstand([p[0], p[1], p[2] + e]) - abstand([p[0], p[1], p[2] - e]);
  const l = Math.hypot(nx, ny, nz) || 1;
  return 0.55 + 0.45 * Math.max(0, (0.3 * nx + 0.8 * ny + 0.5 * nz) / l / Math.hypot(0.3, 0.8, 0.5));
}

// abstand(p): Abstandsfunktion, g: halbe Breite des Würfels, n: Zellen je Achse, farbeBei(p) → [r, g, b]
export function fraktalPunkte(abstand, g, n, farbeBei) {
  const zelle = (2 * g) / n;
  const grob = 8;
  const ng = Math.ceil(n / grob);
  const halbDiagGrob = (Math.sqrt(3) / 2) * zelle * grob;
  const pos = [];
  const farbe = [];
  const mitte = (i) => -g + (i + 0.5) * zelle;
  for (let gz = 0; gz < ng; gz++) for (let gy = 0; gy < ng; gy++) for (let gx = 0; gx < ng; gx++) {
    const c = [gx, gy, gz].map((k) => -g + (k + 0.5) * zelle * grob);
    if (abstand(c) > halbDiagGrob) continue; // sicher leer
    for (let z = gz * grob; z < Math.min(n, (gz + 1) * grob); z++) for (let y = gy * grob; y < Math.min(n, (gy + 1) * grob); y++) for (let x = gx * grob; x < Math.min(n, (gx + 1) * grob); x++) {
      const p = [mitte(x), mitte(y), mitte(z)];
      if (abstand(p) > zelle * 0.5) continue;
      const f = farbeBei(p); // (ruft abstand auf: zuerst, damit die Spur zu p gehört)
      const hell = licht(abstand, p, zelle * 0.5);
      pos.push(p[0], p[1], p[2]);
      farbe.push(...f.map((x) => Math.min(1, x * hell)));
    }
  }
  return { pos: new Float32Array(pos), farbe: new Float32Array(farbe), zelle };
}

// Netz: Feld „halbe Zelle minus Abstand“ auf (n + 2)³ Punkten (mit leerem Rand), Surface Nets, Farbe je Eckpunkt
export function fraktalNetz(abstand, g, n, farbeBei) {
  const zelle = (2 * g) / n;
  const m = n + 2;
  const iso = zelle * 0.5;
  const d = new Float32Array(m * m * m).fill(-g); // ganz draußen
  const grob = 8;
  const ng = Math.ceil(n / grob);
  const halbDiagGrob = (Math.sqrt(3) / 2) * zelle * grob;
  const mitte = (i) => -g + (i + 0.5) * zelle;
  for (let gz = 0; gz < ng; gz++) for (let gy = 0; gy < ng; gy++) for (let gx = 0; gx < ng; gx++) {
    const c = [gx, gy, gz].map((k) => -g + (k + 0.5) * zelle * grob);
    const dg = abstand(c);
    const leer = dg > halbDiagGrob + zelle; // sicher weit genug weg: der Wert dort ist egal, nur das Vorzeichen zählt
    for (let z = gz * grob; z < Math.min(n, (gz + 1) * grob); z++) for (let y = gy * grob; y < Math.min(n, (gy + 1) * grob); y++) for (let x = gx * grob; x < Math.min(n, (gx + 1) * grob); x++) {
      d[x + 1 + (y + 1) * m + (z + 1) * m * m] = leer ? iso - dg + halbDiagGrob : iso - abstand([mitte(x), mitte(y), mitte(z)]);
    }
  }
  const feld = { d, m: [m, m, m], iso: 0, faktor: 1, n: [n, n, n] };
  const netz = inWelt(flaeche(feld), feld, [2 * g, 2 * g, 2 * g], null, 1);
  const farben = new Float32Array(netz.pos.length);
  for (let i = 0; i < netz.pos.length; i += 3) {
    const p = [netz.pos[i], netz.pos[i + 1], netz.pos[i + 2]];
    abstand(p);
    farben.set(farbeBei(p), i);
  }
  return { netz, farben };
}

// als PLY: Punkte (x y z, Farbe) oder Gaussian Splats (Graphdeco-Felder und dazu red, green, blue)
export function alsPly({ pos, farbe, zelle }, gaussian, { groesse = 0.8, deckkraft = 0.9 } = {}) {
  const anzahl = pos.length / 3;
  const farbFelder = "property uchar red\nproperty uchar green\nproperty uchar blue\n";
  const kopf = gaussian
    ? `ply\nformat binary_little_endian 1.0\ncomment Fraktal, Filip Winkler\nelement vertex ${anzahl}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nproperty float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n${farbFelder}end_header\n`
    : `ply\nformat binary_little_endian 1.0\ncomment Fraktal, Filip Winkler\nelement vertex ${anzahl}\nproperty float x\nproperty float y\nproperty float z\n${farbFelder}end_header\n`;
  const k = new TextEncoder().encode(kopf);
  const je = gaussian ? 17 * 4 + 3 : 15;
  const puffer = new ArrayBuffer(k.length + anzahl * je);
  new Uint8Array(puffer).set(k);
  const d = new DataView(puffer);
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const logScale = Math.log(zelle * 0.5 * groesse);
  const p = Math.max(0.01, Math.min(0.99, deckkraft));
  const logit = Math.log(p / (1 - p));
  let o = k.length;
  for (let i = 0; i < anzahl; i++) {
    // Blender: z oben (y und z tauschen, eine Achse umdrehen, damit es keine Spiegelung wird)
    const x = pos[3 * i], y = -pos[3 * i + 2], z = pos[3 * i + 1];
    d.setFloat32(o, x, true);
    d.setFloat32(o + 4, y, true);
    d.setFloat32(o + 8, z, true);
    let c = o + 12; // wo die Bytes der Farbe hinkommen
    if (gaussian) {
      for (let j = 0; j < 3; j++) d.setFloat32(o + 12 + 4 * j, 0, true); // Normale (nicht gebraucht)
      for (let j = 0; j < 3; j++) d.setFloat32(o + 24 + 4 * j, (linear(farbe[3 * i + j]) - 0.5) / C0, true);
      d.setFloat32(o + 36, logit, true);
      for (let j = 0; j < 3; j++) d.setFloat32(o + 40 + 4 * j, logScale, true);
      d.setFloat32(o + 52, 1, true); // Drehung: keine (rot_0 ist w)
      for (let j = 1; j < 4; j++) d.setFloat32(o + 52 + 4 * j, 0, true);
      c = o + 68;
    }
    for (let j = 0; j < 3; j++) d.setUint8(c + j, Math.round(farbe[3 * i + j] * 255));
    o += je;
  }
  return new Blob([puffer], { type: "application/octet-stream" });
}
