// Kamera für den Quader: kreist um den Block (wie in Blender mit der mittleren Maustaste).
// Nur das Nötigste an 4×4-Matrizen, Spalte für Spalte wie WebGL sie will.
//
// Von der Kamera braucht der Shader nur zwei Dinge: wo das Auge ist, und wie man von einem Bildpunkt
// zurück in den Raum kommt (die Umkehrung von Projektion · Blickrichtung). Damit baut er für jeden
// Bildpunkt einen Strahl.

function mal(a, b) {
  const c = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      c[i * 4 + j] = s;
    }
  }
  return c;
}

function perspektive(blickwinkel, seitenverhaeltnis, nah, fern) {
  const f = 1 / Math.tan(blickwinkel / 2);
  const m = new Float32Array(16);
  m[0] = f / seitenverhaeltnis;
  m[5] = f;
  m[10] = (fern + nah) / (nah - fern);
  m[11] = -1;
  m[14] = (2 * fern * nah) / (nah - fern);
  return m;
}

function blick(auge, ziel, oben) {
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const norm = (a) => {
    const l = Math.hypot(...a);
    return a.map((x) => x / l);
  };
  const kreuz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const punkt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(auge, ziel));
  const x = norm(kreuz(oben, z));
  const y = kreuz(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -punkt(x, auge), -punkt(y, auge), -punkt(z, auge), 1]);
}

// Umkehrung einer 4×4-Matrix (Gauß-Jordan, reicht für eine Matrix pro Bild)
function umgekehrt(m) {
  const a = Array.from({ length: 4 }, (_, i) => [m[i], m[4 + i], m[8 + i], m[12 + i], ...[0, 0, 0, 0].map((_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    [a[i], a[p]] = [a[p], a[i]];
    const d = a[i][i];
    for (let j = 0; j < 8; j++) a[i][j] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const f = a[r][i];
      for (let j = 0; j < 8; j++) a[r][j] -= f * a[i][j];
    }
  }
  const z = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) z[j * 4 + i] = a[i][4 + j];
  return z;
}

// drehung, neigung in Bogenmaß, abstand in Blockhöhen
export function kamera({ drehung, neigung, abstand }, seitenverhaeltnis) {
  const auge = [
    abstand * Math.cos(neigung) * Math.sin(drehung),
    abstand * Math.sin(neigung),
    abstand * Math.cos(neigung) * Math.cos(drehung),
  ];
  const vp = mal(perspektive(0.8, seitenverhaeltnis, 0.05, 100), blick(auge, [0, 0, 0], [0, 1, 0]));
  return { auge: new Float32Array(auge), zurueck: umgekehrt(vp) };
}
