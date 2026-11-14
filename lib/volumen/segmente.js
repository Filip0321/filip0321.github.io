// Segmente wie im „Segment Editor“ von 3D Slicer: jedes Segment ist ein Teil des Volumens mit Namen, Farbe und
// Deckkraft (Gehirn, Schädel, Gefäße …). Gespeichert als Beschriftung (label map): ein Byte pro Zelle,
// 0 = keinem Segment, 1 bis 15 = Nummer des Segments. In derselben Auflösung wie die Maske (maske.js; bei großen
// Scans halb, 512 × 512 × 240 hätten sonst 63 MB).
//
// Werkzeuge (die Namen aus Slicer in Klammern):
//   schwelle        jede Zelle, deren Wert im Bereich [von, bis] liegt („Threshold“)
//   zusammenhaengend vom Klickpunkt aus alles im Bereich, das daran hängt („Flood filling“ / „Islands“):
//                   Breitensuche über die 6 Nachbarn. Beim Gehirn im CT: Bereich 15 bis 55 HU, der Schädel (über
//                   300) ist die Grenze, die Muskeln außen (auch um 40) werden nicht erreicht
//   malen           eine Kugel um den Punkt (oder ein Zylinder durch alle Schichten)
//   glaetten        Mehrheit der 27 Nachbarn („Smoothing: median“): füllt kleine Löcher, entfernt Krümel
// Ausgeblendetes (die Maske) wird nie Teil eines Segments.

export const FARBEN = [
  [230, 120, 110], [240, 210, 160], [110, 170, 230], [130, 200, 120], [220, 170, 60], [180, 120, 210],
  [90, 200, 200], [240, 150, 190], [160, 160, 160], [200, 90, 60], [120, 120, 220], [220, 220, 120],
  [100, 150, 100], [240, 240, 240], [150, 80, 120],
];
export const HOECHSTENS = 15;

export function erstelleSegmente(b, h, t) {
  const f = Math.max(b, h, t) > 256 ? 2 : 1;
  const s = { b: Math.ceil(b / f), h: Math.ceil(h / f), t: Math.ceil(t / f), f, liste: [], aktiv: -1, geaendert: true, verlauf: [] };
  s.daten = new Uint8Array(s.b * s.h * s.t);
  return s;
}

export function neuesSegment(s, name) {
  if (s.liste.length >= HOECHSTENS) return -1;
  const nr = s.liste.length + 1;
  s.liste.push({ name: name ?? `Segment ${nr}`, farbe: [...FARBEN[(nr - 1) % FARBEN.length]], deckkraft: 0.9, sichtbar: true });
  s.aktiv = nr;
  return nr;
}

export function merkeSegmente(s) {
  s.verlauf.push(s.daten.slice());
  if (s.verlauf.length > 6) s.verlauf.shift();
}
export function segmentRueckgaengig(s) {
  const alt = s.verlauf.pop();
  if (!alt) return false;
  s.daten.set(alt);
  s.geaendert = true;
  return true;
}

// Wert des Volumens an der Mitte der Segment-Zelle (x, y, z)
function werteLeser(s, v) {
  return (x, y, z) => {
    const vx = Math.min(v.b - 1, Math.floor(((x + 0.5) / s.b) * v.b));
    const vy = Math.min(v.h - 1, Math.floor(((y + 0.5) / s.h) * v.h));
    const vz = Math.min(v.t - 1, Math.floor(((z + 0.5) / s.t) * v.t));
    return v.werte[vx + vy * v.b + vz * v.b * v.h];
  };
}
function maskenLeser(s, m) {
  if (!m) return () => true;
  return (x, y, z) => {
    const mx = Math.min(m.b - 1, Math.floor(((x + 0.5) / s.b) * m.b));
    const my = Math.min(m.h - 1, Math.floor(((y + 0.5) / s.h) * m.h));
    const mz = Math.min(m.t - 1, Math.floor(((z + 0.5) / s.t) * m.t));
    return m.daten[mx + my * m.b + mz * m.b * m.h] > 127;
  };
}

// nurLeere: Zellen, die schon zu einem anderen Segment gehören, bleiben dort
export function schwelle(s, v, maske, nr, von, bis, nurLeere = true) {
  const wert = werteLeser(s, v);
  const sicht = maskenLeser(s, maske);
  let n = 0;
  for (let z = 0, i = 0; z < s.t; z++) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.b; x++, i++) {
    if (nurLeere && s.daten[i] !== 0 && s.daten[i] !== nr) continue;
    const w = wert(x, y, z);
    if (w >= von && w <= bis && sicht(x, y, z)) {
      s.daten[i] = nr;
      n++;
    }
  }
  s.geaendert = true;
  return n;
}

// q: Klickpunkt (0 bis 1 je Achse); gibt die Zahl der gefüllten Zellen zurück (0: der Punkt liegt nicht im Bereich)
export function zusammenhaengend(s, v, maske, nr, q, von, bis, nurLeere = true) {
  const wert = werteLeser(s, v);
  const sicht = maskenLeser(s, maske);
  const sx = Math.min(s.b - 1, Math.floor(q[0] * s.b));
  const sy = Math.min(s.h - 1, Math.floor(q[1] * s.h));
  const sz = Math.min(s.t - 1, Math.floor(q[2] * s.t));
  const passt = (x, y, z, i) => {
    if (nurLeere && s.daten[i] !== 0) return false; // schon in diesem oder einem anderen Segment
    const w = wert(x, y, z);
    return w >= von && w <= bis && sicht(x, y, z);
  };
  const ebene = s.b * s.h;
  const start = sx + sy * s.b + sz * ebene;
  if (!passt(sx, sy, sz, start)) return 0;
  const besucht = new Uint8Array(s.daten.length);
  let schlange = new Int32Array(1 << 16);
  let kopf = 0;
  let ende = 0;
  schlange[ende++] = start;
  besucht[start] = 1;
  let n = 0;
  while (kopf < ende) {
    const i = schlange[kopf++];
    s.daten[i] = nr;
    n++;
    const x = i % s.b;
    const y = Math.floor(i / s.b) % s.h;
    const z = Math.floor(i / ebene);
    const nachbarn = [[x - 1, y, z, i - 1], [x + 1, y, z, i + 1], [x, y - 1, z, i - s.b], [x, y + 1, z, i + s.b], [x, y, z - 1, i - ebene], [x, y, z + 1, i + ebene]];
    for (const [nx, ny, nz, j] of nachbarn) {
      if (nx < 0 || ny < 0 || nz < 0 || nx >= s.b || ny >= s.h || nz >= s.t || besucht[j]) continue;
      besucht[j] = 1;
      if (!passt(nx, ny, nz, j)) continue;
      if (ende >= schlange.length) {
        // die Warteschlange wächst bei Bedarf (vorne Abgearbeitetes wegwerfen, dann verdoppeln)
        const neu = new Int32Array(Math.max(schlange.length, (ende - kopf) * 2 + 1024));
        neu.set(schlange.subarray(kopf, ende));
        ende -= kopf;
        kopf = 0;
        schlange = neu;
      }
      schlange[ende++] = j;
    }
  }
  s.geaendert = true;
  return n;
}

// Kugel (oder Zylinder entlang „achse“) mit Radius r (Anteil der größten echten Seite); nr 0 = radieren
// (nur das aktive Segment wird radiert, andere bleiben)
export function malen(s, q, r, groesse, nr, aktiv, achse = -1) {
  const n = [s.b, s.h, s.t];
  const lo = [];
  const hi = [];
  for (let k = 0; k < 3; k++) {
    if (k === achse) {
      lo[k] = 0;
      hi[k] = n[k] - 1;
    } else {
      const rz = (r / groesse[k]) * n[k];
      lo[k] = Math.max(0, Math.floor(q[k] * n[k] - rz));
      hi[k] = Math.min(n[k] - 1, Math.ceil(q[k] * n[k] + rz));
    }
  }
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
    const p = [x, y, z];
    let d = 0;
    for (let k = 0; k < 3; k++) if (k !== achse) d += (((p[k] + 0.5) / n[k] - q[k]) * groesse[k]) ** 2;
    if (d > r * r) continue;
    const i = x + y * s.b + z * s.b * s.h;
    if (nr === 0) {
      if (s.daten[i] === aktiv) s.daten[i] = 0;
    } else s.daten[i] = nr;
  }
  s.geaendert = true;
}

// Mehrheit der 27 Nachbarn (für ein Segment): drin, wenn mindestens 14 drin sind
export function glaetten(s, nr) {
  const alt = s.daten.slice();
  const ebene = s.b * s.h;
  for (let z = 0; z < s.t; z++) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.b; x++) {
    const i = x + y * s.b + z * ebene;
    if (alt[i] !== 0 && alt[i] !== nr) continue; // andere Segmente bleiben unberührt
    let drin = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(s.b - 1, Math.max(0, x + dx));
      const yy = Math.min(s.h - 1, Math.max(0, y + dy));
      const zz = Math.min(s.t - 1, Math.max(0, z + dz));
      if (alt[xx + yy * s.b + zz * ebene] === nr) drin++;
    }
    s.daten[i] = drin >= 14 ? nr : 0;
  }
  s.geaendert = true;
}

export function leeren(s, nr) {
  for (let i = 0; i < s.daten.length; i++) if (s.daten[i] === nr) s.daten[i] = 0;
  s.geaendert = true;
}

// Segment weg: die Nummern dahinter rücken auf
export function entfernen(s, nr) {
  for (let i = 0; i < s.daten.length; i++) {
    const l = s.daten[i];
    if (l === nr) s.daten[i] = 0;
    else if (l > nr) s.daten[i] = l - 1;
  }
  s.liste.splice(nr - 1, 1);
  s.aktiv = s.liste.length ? Math.min(nr, s.liste.length) : -1;
  s.geaendert = true;
}

// Zellen je Segment (Index = Nummer)
export function zaehle(s) {
  const n = new Array(HOECHSTENS + 1).fill(0);
  for (let i = 0; i < s.daten.length; i++) n[s.daten[i]]++;
  return n;
}

// Nummer an einer Stelle (Anteile 0 bis 1)
export function segmentBei(s, fx, fy, fz) {
  const x = Math.min(s.b - 1, Math.floor(fx * s.b));
  const y = Math.min(s.h - 1, Math.floor(fy * s.h));
  const z = Math.min(s.t - 1, Math.floor(fz * s.t));
  return s.daten[x + y * s.b + z * s.b * s.h];
}

// Weiche Maske aller sichtbaren Segmente (0 bis 255), zweimal mit den Nachbarn gemittelt (Box-Filter 3 × 3 × 3,
// zusammen fast eine Gaußglocke). Auf der Grafikkarte wird sie weich (linear) gelesen: die Grenze bei 0,5 ist dann
// eine glatte Fläche statt der Treppe aus Würfeln, die man sieht, wenn man nur die Nummern ansieht. Die Nummern
// selbst (welches Segment, welche Farbe) bleiben hart; sie bestimmen nur die Farbe, nicht mehr die Form.
export function weicheMaske(s) {
  const sicht = s.liste.map((x) => x.sichtbar);
  const n = s.daten.length;
  let a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = s.daten[i];
    a[i] = l > 0 && sicht[l - 1] ? 1 : 0;
  }
  let b = new Float32Array(n);
  const schritte = [1, s.b, s.b * s.h];
  const groesse = [s.b, s.h, s.t];
  for (let durchgang = 0; durchgang < 2; durchgang++) {
    for (let achse = 0; achse < 3; achse++) {
      const st = schritte[achse];
      const max = groesse[achse] - 1;
      for (let z = 0, i = 0; z < s.t; z++) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.b; x++, i++) {
        const k = achse === 0 ? x : achse === 1 ? y : z;
        b[i] = (a[k > 0 ? i - st : i] + a[i] + a[k < max ? i + st : i]) / 3;
      }
      [a, b] = [b, a];
    }
  }
  const aus = new Uint8Array(n);
  for (let i = 0; i < n; i++) aus[i] = Math.round(a[i] * 255);
  return aus;
}
