// Gaussian Splats laden: .ply (wie es 3DGS, Postshot, Scaniverse, Polycam, SuperSplat … schreiben) und .splat
// (das kurze Format von antimatter15: 32 Bytes pro Splat), dazu einfache Punktwolken (.ply nur mit x y z und Farbe).
//
// Ein Gaussian Splat ist ein unscharfer, gedrehter Ellipsoid-Fleck: Mitte (x, y, z), drei Radien (scale), eine
// Drehung (Quaternion rot), eine Farbe und eine Deckkraft. Eine Szene sind Hunderttausende davon, so gelegt
// (trainiert), dass sie übereinander gemalt aus jeder Richtung aussehen wie die Fotos.
//
// Gespeichert wird in der .ply so, dass das Training bequem rechnen kann:
//   scale_0..2   der Logarithmus des Radius (Radius = e^scale)
//   opacity      vor der Sigmoid-Funktion (Deckkraft = 1 / (1 + e^−opacity))
//   f_dc_0..2    die Farbe als nullter Koeffizient der Kugelflächenfunktionen (Farbe = 0,5 + C0 · f_dc)
//   f_rest_…     wie sich die Farbe mit der Blickrichtung ändert (Glanz): lassen wir hier weg, das spart viel
//   rot_0..3     Quaternion (w, x, y, z), nicht unbedingt normiert
//
// Für das Zeichnen braucht es pro Splat die Kovarianz Σ = R S Sᵀ Rᵀ (3 × 3, symmetrisch: 6 Zahlen): sie sagt,
// wie der Fleck im Raum ausgedehnt ist. Die rechnen wir hier einmal aus.
// Ergebnis: { anzahl, lage: Float32Array(3n), kov: Float32Array(6n) (xx xy xz yy yz zz), farbe: Uint8Array(4n) }

const C0 = 0.28209479177387814; // Kugelflächenfunktion Y₀₀ = 1 / (2 √π)

const TYPEN = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

export async function ladeSplats(quelle) {
  const puffer = quelle instanceof ArrayBuffer ? quelle : await (await fetch(quelle)).arrayBuffer();
  const anfang = new TextDecoder().decode(new Uint8Array(puffer, 0, Math.min(puffer.byteLength, 4)));
  return anfang === "ply\n" || anfang.startsWith("ply") ? ausPly(puffer) : ausSplat(puffer);
}

function ausPly(puffer) {
  const bytes = new Uint8Array(puffer);
  // Kopf bis "end_header\n" lesen
  const kopfEnde = sucheText(bytes, "end_header\n");
  if (kopfEnde < 0) throw new Error("Kein gültiger PLY-Kopf.");
  const kopf = new TextDecoder().decode(bytes.subarray(0, kopfEnde)).split("\n");
  if (!kopf.some((z) => z.startsWith("format binary_little_endian"))) throw new Error("Nur binäre PLY-Dateien (little endian) gehen.");
  let anzahl = 0;
  let imVertex = false;
  const felder = {};
  let schritt = 0;
  for (const zeile of kopf) {
    const t = zeile.trim().split(/\s+/);
    if (t[0] === "element") {
      imVertex = t[1] === "vertex";
      if (imVertex) anzahl = Number(t[2]);
      else if (anzahl) break; // weitere Elemente nach den Punkten (z. B. Flächen) interessieren nicht
    } else if (t[0] === "property" && imVertex) {
      if (t[1] === "list") throw new Error("Listen in den Punkten gehen nicht.");
      felder[t[2]] = { typ: t[1], ort: schritt };
      schritt += TYPEN[t[1]];
    }
  }
  if (!felder.x || !anzahl) throw new Error("Die PLY hat keine Punkte.");
  // komprimierte PLY von SuperSplat / PlayCanvas: andere Felder (packed_position …), hier nicht unterstützt
  if (felder.packed_position) throw new Error("Komprimierte PLY (SuperSplat) gehen hier noch nicht: bitte als normale PLY exportieren oder mit werkzeuge/splat-packen.py umwandeln.");
  const d = new DataView(puffer, kopfEnde + "end_header\n".length);
  const leser = (name) => {
    const f = felder[name];
    if (!f) return null;
    const o = f.ort;
    switch (f.typ) {
      case "float": case "float32": return (i) => d.getFloat32(i * schritt + o, true);
      case "double": case "float64": return (i) => d.getFloat64(i * schritt + o, true);
      case "uchar": case "uint8": return (i) => d.getUint8(i * schritt + o);
      default: return null;
    }
  };
  const x = leser("x"), y = leser("y"), z = leser("z");
  const dc = [leser("f_dc_0"), leser("f_dc_1"), leser("f_dc_2")];
  const rgb = [leser("red"), leser("green"), leser("blue")];
  const op = leser("opacity");
  const sc = [leser("scale_0"), leser("scale_1"), leser("scale_2")];
  const rot = [leser("rot_0"), leser("rot_1"), leser("rot_2"), leser("rot_3")];
  const gaussian = sc[0] && rot[0];

  const lage = new Float32Array(anzahl * 3);
  const kov = new Float32Array(anzahl * 6);
  const farbe = new Uint8Array(anzahl * 4);
  // reine Punktwolke: alle Flecken gleich groß, rund; Größe aus dem mittleren Abstand (grob: Ausdehnung / ∛n)
  let punktRadius = 0;
  if (!gaussian) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < anzahl; i += Math.max(1, Math.floor(anzahl / 5000))) {
      const p = [x(i), y(i), z(i)];
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
    punktRadius = (Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / Math.cbrt(anzahl)) * 0.5;
  }
  const s = [0, 0, 0], q = [1, 0, 0, 0];
  for (let i = 0; i < anzahl; i++) {
    lage[3 * i] = x(i);
    lage[3 * i + 1] = y(i);
    lage[3 * i + 2] = z(i);
    for (let k = 0; k < 3; k++) {
      const c = dc[k] ? 0.5 + C0 * dc[k](i) : rgb[k] ? rgb[k](i) / 255 : 1;
      farbe[4 * i + k] = Math.max(0, Math.min(255, Math.round(c * 255)));
    }
    farbe[4 * i + 3] = op ? Math.round(255 / (1 + Math.exp(-op(i)))) : 255;
    if (gaussian) {
      for (let k = 0; k < 3; k++) s[k] = Math.exp(sc[k](i));
      for (let k = 0; k < 4; k++) q[k] = rot[k](i);
    } else {
      s[0] = s[1] = s[2] = punktRadius;
      q[0] = 1;
      q[1] = q[2] = q[3] = 0;
    }
    kovarianz(s, q, kov, 6 * i);
  }
  return { anzahl, lage, kov, farbe };
}

// .splat (antimatter15): je Splat 32 Bytes: Lage 3 × float, Radien 3 × float (schon e^), Farbe RGBA 4 × uchar
// (A ist die Deckkraft), Drehung 4 × uchar ((q + 1) · 128, w zuerst)
function ausSplat(puffer) {
  const anzahl = Math.floor(puffer.byteLength / 32);
  const f = new Float32Array(puffer, 0, anzahl * 8);
  const u = new Uint8Array(puffer);
  const lage = new Float32Array(anzahl * 3);
  const kov = new Float32Array(anzahl * 6);
  const farbe = new Uint8Array(anzahl * 4);
  const s = [0, 0, 0], q = [0, 0, 0, 0];
  for (let i = 0; i < anzahl; i++) {
    for (let k = 0; k < 3; k++) {
      lage[3 * i + k] = f[8 * i + k];
      s[k] = f[8 * i + 3 + k];
    }
    for (let k = 0; k < 4; k++) {
      farbe[4 * i + k] = u[32 * i + 24 + k];
      q[k] = (u[32 * i + 28 + k] - 128) / 128;
    }
    kovarianz(s, q, kov, 6 * i);
  }
  return { anzahl, lage, kov, farbe };
}

// Σ = M Mᵀ mit M = R · S (R aus der Quaternion, S = diag(Radien))
function kovarianz(s, q, ziel, o) {
  let [w, x, y, z] = q;
  const l = Math.hypot(w, x, y, z) || 1;
  w /= l; x /= l; y /= l; z /= l;
  const R = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const M = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[3 * r + c] = R[3 * r + c] * s[c];
  const m = (a, b) => M[3 * a] * M[3 * b] + M[3 * a + 1] * M[3 * b + 1] + M[3 * a + 2] * M[3 * b + 2];
  ziel[o] = m(0, 0);
  ziel[o + 1] = m(0, 1);
  ziel[o + 2] = m(0, 2);
  ziel[o + 3] = m(1, 1);
  ziel[o + 4] = m(1, 2);
  ziel[o + 5] = m(2, 2);
}

// Szene drehen (Grad um x, dann y, dann z): Lage p → R p, Kovarianz Σ → R Σ Rᵀ. Viele Scans liegen auf dem Kopf
// (COLMAP: y zeigt nach unten); [180, 0, 0] stellt sie hin. Mehrere Schritte nacheinander: [[90, 0, 0], [0, 90, 0]]
export function dreheSzene(szene, drehung) {
  if (Array.isArray(drehung[0])) {
    for (const schritt of drehung) dreheSzene(szene, schritt);
    return;
  }
  const [ax, ay, az] = drehung;
  if (!ax && !ay && !az) return;
  const r = (g) => (g * Math.PI) / 180;
  const cx = Math.cos(r(ax)), sx = Math.sin(r(ax)), cy = Math.cos(r(ay)), sy = Math.sin(r(ay)), cz = Math.cos(r(az)), sz = Math.sin(r(az));
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const R = mal(Rz, mal(Ry, Rx));
  const { lage, kov, anzahl } = szene;
  for (let i = 0; i < anzahl; i++) {
    const p = [lage[3 * i], lage[3 * i + 1], lage[3 * i + 2]];
    for (let k = 0; k < 3; k++) lage[3 * i + k] = R[3 * k] * p[0] + R[3 * k + 1] * p[1] + R[3 * k + 2] * p[2];
    const o = 6 * i;
    const S = [kov[o], kov[o + 1], kov[o + 2], kov[o + 1], kov[o + 3], kov[o + 4], kov[o + 2], kov[o + 4], kov[o + 5]];
    const N = mal(mal(R, S), [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
    kov[o] = N[0]; kov[o + 1] = N[1]; kov[o + 2] = N[2]; kov[o + 3] = N[4]; kov[o + 4] = N[5]; kov[o + 5] = N[8];
  }
}

function mal(a, b) {
  const c = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) c[3 * r + k] = a[3 * r] * b[k] + a[3 * r + 1] * b[3 + k] + a[3 * r + 2] * b[6 + k];
  return c;
}

function sucheText(bytes, text) {
  const t = new TextEncoder().encode(text);
  const ende = Math.min(bytes.length - t.length, 1 << 16);
  aussen: for (let i = 0; i <= ende; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue aussen;
    return i;
  }
  return -1;
}
