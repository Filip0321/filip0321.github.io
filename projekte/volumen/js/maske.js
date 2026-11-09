// Maske: was ausgeblendet ist. Ein zweites Volumen gleicher Form, ein Byte pro Zelle (255 sichtbar, 0 weg),
// bei großen Scans mit halber Auflösung (512 × 512 × 240 wären sonst 63 MB, so 8 MB; zum Wegschneiden reicht das).
// Auf der Grafikkarte liegt sie als zweite 3D-Textur; wo sie unter 0,5 ist, sieht der Strahl nur Luft.
// Weil die Textur weich (linear) gelesen wird, sind die Schnittkanten glatt und werden beleuchtet wie eine Oberfläche.
//
// Zwei Werkzeuge, wie in Programmen für medizinische 3D-Bilder (3D Slicer: „Scissors“, „Erase“):
//   Pinsel   in einem Schnitt: eine Kugel um den Punkt, oder ein Zylinder durch alle Schichten
//   Schere   im 3D-Bild einen Umriss ziehen: alles, was darin (oder draußen) liegt, verschwindet durch die ganze Tiefe.
//            Dafür wird jede Zelle mit derselben Kamera wie im Shader aufs Bild projiziert und nachgesehen, ob sie
//            im ausgefüllten Umriss landet.

export function erstelleMaske(b, h, t) {
  const f = Math.max(b, h, t) > 256 ? 2 : 1;
  const m = {
    b: Math.ceil(b / f),
    h: Math.ceil(h / f),
    t: Math.ceil(t / f),
    daten: null,
    geaendert: true, // muss neu auf die Grafikkarte
    verlauf: [], // frühere Stände zum Rückgängigmachen
  };
  m.daten = new Uint8Array(m.b * m.h * m.t).fill(255);
  return m;
}

export function merke(m) {
  m.verlauf.push(m.daten.slice());
  if (m.verlauf.length > 8) m.verlauf.shift();
}
export function rueckgaengig(m) {
  const alt = m.verlauf.pop();
  if (!alt) return false;
  m.daten.set(alt);
  m.geaendert = true;
  return true;
}
export function allesZeigen(m) {
  merke(m);
  m.daten.fill(255);
  m.geaendert = true;
}
// sichtbar an der Stelle (Anteile 0 bis 1 je Achse)?
export function sichtbar(m, fx, fy, fz) {
  const x = Math.min(m.b - 1, Math.floor(fx * m.b));
  const y = Math.min(m.h - 1, Math.floor(fy * m.h));
  const z = Math.min(m.t - 1, Math.floor(fz * m.t));
  return m.daten[x + y * m.b + z * m.b * m.h] > 127;
}

// Pinsel: q Mitte (0 bis 1 je Achse), r Radius als Anteil der größten echten Seite, groesse = echte Ausdehnung
// (größte Seite 1), wert 0 (weg) oder 255 (zurück); achse 0, 1, 2: durch alle Schichten entlang dieser Achse
export function pinsel(m, q, r, groesse, wert, achse = -1) {
  const n = [m.b, m.h, m.t];
  const lo = [];
  const hi = [];
  for (let k = 0; k < 3; k++) {
    if (k === achse) {
      lo[k] = 0;
      hi[k] = n[k] - 1;
    } else {
      const rk = (r / groesse[k]) * n[k];
      lo[k] = Math.max(0, Math.floor(q[k] * n[k] - rk));
      hi[k] = Math.min(n[k] - 1, Math.ceil(q[k] * n[k] + rk));
    }
  }
  const abstand = (k, i) => (k === achse ? 0 : ((i + 0.5) / n[k] - q[k]) * groesse[k]);
  for (let z = lo[2]; z <= hi[2]; z++) {
    const dz = abstand(2, z) ** 2;
    for (let y = lo[1]; y <= hi[1]; y++) {
      const dyz = dz + abstand(1, y) ** 2;
      if (dyz > r * r) continue;
      for (let x = lo[0]; x <= hi[0]; x++) {
        if (dyz + abstand(0, x) ** 2 <= r * r) m.daten[x + y * m.b + z * m.b * m.h] = wert;
      }
    }
  }
  m.geaendert = true;
}

// Schere. umriss: { breite, hoehe, innen (Uint8Array: 1 = im Umriss) } als Bild in der Größe des 3D-Bildes;
// kamera: { lage, dreh (je 9 Zahlen, spaltenweise wie im Shader), abstand, seite (Breite / Höhe), groesse };
// weg: "innen" oder "aussen"
export function schere(m, umriss, kamera, weg) {
  const { lage: O, dreh: D, abstand, seite, groesse: g } = kamera;
  // M = Dᵀ · O: vom Volumen (um die Mitte) direkt in den Blick der Kamera; Spalte j von M = Dᵀ · (Spalte j von O)
  const M = new Float64Array(9);
  for (let j = 0; j < 3; j++) {
    const o = [O[3 * j], O[3 * j + 1], O[3 * j + 2]];
    for (let i = 0; i < 3; i++) M[3 * j + i] = D[3 * i] * o[0] + D[3 * i + 1] * o[1] + D[3 * i + 2] * o[2];
  }
  const { breite: W, hoehe: H, innen } = umriss;
  const wegInnen = weg === "innen";
  for (let z = 0; z < m.t; z++) {
    const pz = ((z + 0.5) / m.t - 0.5) * g[2];
    for (let y = 0; y < m.h; y++) {
      const py = ((y + 0.5) / m.h - 0.5) * g[1];
      // Anteil von y und z am Blick, dann pro x nur noch dazuzählen
      const bx = M[3] * py + M[6] * pz;
      const by = M[4] * py + M[7] * pz;
      const bz = M[5] * py + M[8] * pz - abstand;
      let i = y * m.b + z * m.b * m.h;
      for (let x = 0; x < m.b; x++, i++) {
        if (m.daten[i] === 0) continue;
        const px = ((x + 0.5) / m.b - 0.5) * g[0];
        const lx = bx + M[0] * px;
        const ly = by + M[1] * px;
        const lz = bz + M[2] * px;
        let drin = false;
        if (lz < 0) {
          // wie im Shader: Strahl = (u · seite / 2, v / 2, −1), also u = lx / (−lz) / (seite / 2)
          const u = lx / -lz / (seite * 0.5);
          const v = ly / -lz / 0.5;
          const sx = Math.floor(((u + 1) / 2) * W);
          const sy = Math.floor(((1 - v) / 2) * H);
          drin = sx >= 0 && sx < W && sy >= 0 && sy < H && innen[sx + sy * W] === 1;
        }
        if (drin === wegInnen) m.daten[i] = 0;
      }
    }
  }
  m.geaendert = true;
}

// Zusammenhängendes Stück (Flutfüllung, 6 Nachbarn): von der Zelle unter q aus alle sichtbaren Zellen, deren Wert
// mindestens „grenze“ ist und die über solche Zellen erreichbar sind. Wie Farbe, die sich ausbreitet, solange sie
// auf Knochen (oder was über der Grenze liegt) bleibt. Dann: „behalten“ blendet alles andere aus, „weg“ das Stück.
// Damit verschwindet die Liege des CT mit einem Klick (sie hängt nicht am Körper), oder es bleibt nur ein Knochen.
// v: das geladene Volumen (die Werte werden in der Mitte jeder Maskenzelle gelesen). Zurück: Zahl der Zellen.
export function stueck(m, v, q, grenze, art) {
  const n = m.b * m.h * m.t;
  const wert = (x, y, z) => {
    const vx = Math.min(v.b - 1, Math.floor(((x + 0.5) / m.b) * v.b));
    const vy = Math.min(v.h - 1, Math.floor(((y + 0.5) / m.h) * v.h));
    const vz = Math.min(v.t - 1, Math.floor(((z + 0.5) / m.t) * v.t));
    return v.werte[vx + vy * v.b + vz * v.b * v.h];
  };
  const start = [Math.min(m.b - 1, Math.floor(q[0] * m.b)), Math.min(m.h - 1, Math.floor(q[1] * m.h)), Math.min(m.t - 1, Math.floor(q[2] * m.t))];
  const s0 = start[0] + start[1] * m.b + start[2] * m.b * m.h;
  if (m.daten[s0] === 0 || wert(...start) < grenze) return 0;
  const drin = new Uint8Array(n);
  const schlange = new Int32Array(n); // jede Zelle kommt höchstens einmal hinein
  let kopf = 0;
  let ende = 0;
  schlange[ende++] = s0;
  drin[s0] = 1;
  const ebene = m.b * m.h;
  while (kopf < ende) {
    const i = schlange[kopf++];
    const z = Math.floor(i / ebene);
    const y = Math.floor((i - z * ebene) / m.b);
    const x = i - z * ebene - y * m.b;
    const nachbarn = [
      x > 0 ? i - 1 : -1, x < m.b - 1 ? i + 1 : -1,
      y > 0 ? i - m.b : -1, y < m.h - 1 ? i + m.b : -1,
      z > 0 ? i - ebene : -1, z < m.t - 1 ? i + ebene : -1,
    ];
    for (const j of nachbarn) {
      if (j < 0 || drin[j] || m.daten[j] === 0) continue;
      const jz = Math.floor(j / ebene);
      const jy = Math.floor((j - jz * ebene) / m.b);
      if (wert(j - jz * ebene - jy * m.b, jy, jz) < grenze) continue;
      drin[j] = 1;
      schlange[ende++] = j;
    }
  }
  for (let i = 0; i < n; i++) if ((drin[i] === 1) === (art === "weg")) m.daten[i] = 0;
  m.geaendert = true;
  return ende;
}
