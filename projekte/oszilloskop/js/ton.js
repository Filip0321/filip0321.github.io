// Die Rechnung des Tons, Sample für Sample: dieselbe im Worklet (live) und beim Speichern (WAV, Video).
// Das Worklet bekommt diese Datei nicht als Import (das geht nicht in jedem Browser), darum steht die Schleife in
// ton-worklet.js noch einmal; wer hier etwas ändert, ändert es dort mit.
//
// Ein Phasenzähler läuft f-mal pro Sekunde von 0 bis 1 und liest dabei den Umlauf ab (zwischen zwei Punkten
// linear gemischt). Dann, für jedes Sample:
//   3D-Drehung   um x, dann y, dann z (Winkel wachsen mit drehX, drehY, drehZ Umdrehungen pro Sekunde)
//   Perspektive  was näher ist (z groß), wird größer: Faktor abstand / (abstand − z); abstand 0 = ohne
//   Atmen        die Figur wird im Takt größer und kleiner
// Links = x, rechts = y.

export function neuerZustand() {
  return { phase: 0, wx: 0, wy: 0, wz: 0, atem: 0 };
}

// ein Punkt durch dieselbe Drehung und Perspektive wie im Ton (ohne Atmen und Lautstärke): für die Zeichenfläche,
// damit sie genau zeigt, was der Schirm zeigt. Zurück: [x, y, Tiefe q] (q groß = vorn)
export function drehe(x, y, q, wx, wy, wz, abstand) {
  [y, q] = [y * Math.cos(wx) - q * Math.sin(wx), y * Math.sin(wx) + q * Math.cos(wx)];
  [x, q] = [x * Math.cos(wy) + q * Math.sin(wy), -x * Math.sin(wy) + q * Math.cos(wy)];
  [x, y] = [x * Math.cos(wz) - y * Math.sin(wz), x * Math.sin(wz) + y * Math.cos(wz)];
  const s = abstand > 0 ? abstand / (abstand - q) : 1;
  return [x * s, y * s, q];
}
// rückwärts: ein Punkt auf dem Schirm, in der Ebene durch die Mitte (Tiefe 0, dort ist die Perspektive 1),
// zurück in die Figur. Die Drehungen in umgekehrter Reihenfolge und mit umgekehrtem Winkel
export function zurueckDrehen(x, y, wx, wy, wz) {
  let q = 0;
  [x, y] = [x * Math.cos(-wz) - y * Math.sin(-wz), x * Math.sin(-wz) + y * Math.cos(-wz)];
  [x, q] = [x * Math.cos(-wy) + q * Math.sin(-wy), -x * Math.sin(-wy) + q * Math.cos(-wy)];
  [y, q] = [y * Math.cos(-wx) - q * Math.sin(-wx), y * Math.sin(-wx) + q * Math.cos(-wx)];
  return [x, y, q];
}

// schreibt n Samples nach links und rechts; u = { x, y, z } (Umlauf), w = Werte, z = Zustand (wird weitergezählt)
export function rechne(u, w, z, links, rechts, rate) {
  const n = u.x.length;
  for (let i = 0; i < links.length; i++) {
    const p = z.phase * n;
    const i0 = Math.floor(p) % n;
    const i1 = (i0 + 1) % n;
    const t = p - Math.floor(p);
    let x = u.x[i0] + (u.x[i1] - u.x[i0]) * t;
    let y = u.y[i0] + (u.y[i1] - u.y[i0]) * t;
    let q = u.z[i0] + (u.z[i1] - u.z[i0]) * t;
    // um x (y und z drehen sich), um y (x und z), um z (x und y)
    [y, q] = [y * Math.cos(z.wx) - q * Math.sin(z.wx), y * Math.sin(z.wx) + q * Math.cos(z.wx)];
    [x, q] = [x * Math.cos(z.wy) + q * Math.sin(z.wy), -x * Math.sin(z.wy) + q * Math.cos(z.wy)];
    [x, y] = [x * Math.cos(z.wz) - y * Math.sin(z.wz), x * Math.sin(z.wz) + y * Math.cos(z.wz)];
    const s = (1 + w.atmen * Math.sin(2 * Math.PI * z.atem)) * (w.abstand > 0 ? w.abstand / (w.abstand - q) : 1);
    links[i] = x * s * w.laut;
    rechts[i] = y * s * w.laut;
    z.phase = (z.phase + w.f / rate) % 1;
    z.wx = (z.wx + (2 * Math.PI * w.drehX) / rate) % (2 * Math.PI);
    z.wy = (z.wy + (2 * Math.PI * w.drehY) / rate) % (2 * Math.PI);
    z.wz = (z.wz + (2 * Math.PI * w.drehZ) / rate) % (2 * Math.PI);
    z.atem = (z.atem + w.atmenF / rate) % 1;
  }
}
