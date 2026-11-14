// Aus dem Volumen ein Netz aus Dreiecken machen (zum Weiterarbeiten in Blender, für 3D-Druck, für three.js).
//
// Verfahren: „Surface Nets“ (Gibson 1998), eine Verwandte von Marching Cubes. Das Volumen ist ein Gitter von
// Zahlen; die Fläche liegt dort, wo die Zahl die Schwelle (iso) kreuzt.
//   1. Jede Gitterzelle (8 Ecken), deren Ecken teils drinnen, teils draußen liegen, bekommt einen Eckpunkt: den
//      Mittelwert der Stellen, an denen die Fläche ihre 12 Kanten kreuzt (linear zwischen den Ecken geschätzt).
//   2. Jede Gitterkante, die die Fläche kreuzt, wird von 4 Zellen umgeben: deren 4 Eckpunkte bilden ein Viereck
//      (zwei Dreiecke).
// Ergebnis: ein geschlossenes, recht glattes Netz mit etwa halb so vielen Dreiecken wie Marching Cubes, und ohne
// dessen 256-Fälle-Tabelle. Die Normalen kommen aus dem Gefälle (Gradient) der Zahlen, wie beim Beleuchten im Shader.
//
// Segmente sind Ja/Nein (in der Zelle oder nicht); als Treppe aus Würfeln sähe das Netz grob aus. Darum wird die
// Ja/Nein-Zahl vorher mit den Nachbarn gemittelt (Box-Filter, zweimal hintereinander fast eine Gaußglocke) und die
// Fläche bei 0,5 genommen: die Treppenstufen werden zu Rundungen. Zu viel Glätten frisst dünne Teile (eine
// Schädeldecke von 2 Zellen): darum nur so viel wie nötig.
//
// Ausgabe:
//   GLB (glTF 2.0, binär): eine Datei, jedes Segment ein eigenes Objekt mit eigener Farbe (Material). Blender,
//        three.js, Windows-3D-Viewer, Godot lesen es direkt. Einheit Meter.
//   OBJ: Text, jedes Segment eine Gruppe, Farbe als Farbe je Eckpunkt („v x y z r g b“, liest z. B. Blender ab 3.x
//        und MeshLab). Einheit wie gewählt.
// Achsen: y oben, wie in der Ansicht (glTF ist so festgelegt; Blender dreht beim Import selbst auf z oben).

// ---------- Felder ----------

// Ja/Nein des Segments nr, um faktor verkleinert (Anteil je grober Zelle), mit einem Rand „draußen“, geglättet
export function feldAusSegment(seg, nr, faktor) {
  const quelle = (x, y, z) => (seg.daten[x + y * seg.b + z * seg.b * seg.h] === nr ? 1 : 0);
  const f = verkleinere([seg.b, seg.h, seg.t], faktor, quelle, 0);
  // verkleinert ist es schon gemittelt: dann nur einmal glätten, sonst verschwinden dünne Teile (Schädeldecke)
  for (let i = 0; i < (faktor > 1 ? 1 : 2); i++) glaette(f);
  return { ...f, iso: 0.5, n: [seg.b, seg.h, seg.t] };
}

// die Werte selbst (Fläche bei „schwelle“), Ausgeblendetes zählt als ganz draußen
export function feldAusWerten(v, maske, schwelle, faktor) {
  const leer = Math.min(v.min, schwelle) - 1;
  const quelle = (x, y, z) => {
    if (maske) {
      const mx = Math.min(maske.b - 1, Math.floor(((x + 0.5) / v.b) * maske.b));
      const my = Math.min(maske.h - 1, Math.floor(((y + 0.5) / v.h) * maske.h));
      const mz = Math.min(maske.t - 1, Math.floor(((z + 0.5) / v.t) * maske.t));
      if (maske.daten[mx + my * maske.b + mz * maske.b * maske.h] < 128) return leer;
    }
    return v.werte[x + y * v.b + z * v.b * v.h];
  };
  const f = verkleinere([v.b, v.h, v.t], faktor, quelle, leer);
  glaette(f); // einmal: gegen Rauschen (CT hat ±20 HU), sonst wird die Haut zur Kraterlandschaft
  return { ...f, iso: schwelle, n: [v.b, v.h, v.t] };
}

// Mittel über faktor³ Zellen; dazu ringsum eine Schicht mit dem Wert „rand“ (damit das Netz am Rand zu ist)
function verkleinere(n, faktor, quelle, rand) {
  const m = n.map((x) => Math.ceil(x / faktor) + 2);
  const d = new Float32Array(m[0] * m[1] * m[2]).fill(rand);
  for (let z = 1; z < m[2] - 1; z++) for (let y = 1; y < m[1] - 1; y++) for (let x = 1; x < m[0] - 1; x++) {
    let s = 0;
    let k = 0;
    for (let dz = 0; dz < faktor; dz++) for (let dy = 0; dy < faktor; dy++) for (let dx = 0; dx < faktor; dx++) {
      const qx = (x - 1) * faktor + dx, qy = (y - 1) * faktor + dy, qz = (z - 1) * faktor + dz;
      if (qx >= n[0] || qy >= n[1] || qz >= n[2]) continue;
      s += quelle(qx, qy, qz);
      k++;
    }
    d[x + y * m[0] + z * m[0] * m[1]] = k ? s / k : rand;
  }
  return { d, m, faktor };
}

// Box-Filter 3 × 3 × 3, getrennt je Achse (3 statt 27 Additionen je Zelle); der Rand bleibt
function glaette(f) {
  const { d, m } = f;
  const tmp = new Float32Array(d.length);
  const schritte = [1, m[0], m[0] * m[1]];
  for (let a = 0; a < 3; a++) {
    const s = schritte[a];
    tmp.set(d);
    for (let z = 1; z < m[2] - 1; z++) for (let y = 1; y < m[1] - 1; y++) for (let x = 1; x < m[0] - 1; x++) {
      const i = x + y * m[0] + z * m[0] * m[1];
      d[i] = (tmp[i - s] + tmp[i] + tmp[i + s]) / 3;
    }
  }
}

// ---------- Surface Nets ----------

// gibt { pos, nor, idx } in Gitterkoordinaten zurück (Float32Array, Float32Array, Uint32Array)
export function flaeche(feld) {
  const { d, m, iso } = feld;
  const [b, h, t] = m;
  const zb = b - 1, zh = h - 1;
  const zelle = new Int32Array(zb * zh * (t - 1)).fill(-1);
  const pos = [];
  const nor = [];
  const wert = (x, y, z) => d[x + y * b + z * b * h];
  // die 12 Kanten eines Würfels als Paare von Ecken (Ecke k: x = k & 1, y = (k >> 1) & 1, z = k >> 2)
  const KANTEN = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const ecke = new Float32Array(8);
  for (let z = 0; z < t - 1; z++) for (let y = 0; y < h - 1; y++) for (let x = 0; x < b - 1; x++) {
    let innen = 0;
    for (let k = 0; k < 8; k++) {
      ecke[k] = wert(x + (k & 1), y + ((k >> 1) & 1), z + (k >> 2)) - iso;
      if (ecke[k] > 0) innen++;
    }
    if (innen === 0 || innen === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, c] of KANTEN) {
      if ((ecke[a] > 0) === (ecke[c] > 0)) continue;
      const s = ecke[a] / (ecke[a] - ecke[c]); // wo zwischen a und c die Null liegt
      sx += (a & 1) + ((c & 1) - (a & 1)) * s;
      sy += ((a >> 1) & 1) + (((c >> 1) & 1) - ((a >> 1) & 1)) * s;
      sz += (a >> 2) + ((c >> 2) - (a >> 2)) * s;
      n++;
    }
    const px = x + sx / n, py = y + sy / n, pz = z + sz / n;
    zelle[x + y * zb + z * zb * zh] = pos.length / 3;
    pos.push(px, py, pz);
    // Normale: Gefälle nach außen (innen sind die Zahlen größer), an der nächsten Gitterstelle
    const gx = Math.min(b - 2, Math.max(1, Math.round(px)));
    const gy = Math.min(h - 2, Math.max(1, Math.round(py)));
    const gz = Math.min(t - 2, Math.max(1, Math.round(pz)));
    let nx = wert(gx - 1, gy, gz) - wert(gx + 1, gy, gz);
    let ny = wert(gx, gy - 1, gz) - wert(gx, gy + 1, gz);
    let nz = wert(gx, gy, gz - 1) - wert(gx, gy, gz + 1);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
  }
  // Vierecke: je Gitterkante mit Vorzeichenwechsel die 4 Zellen ringsum
  const idx = [];
  const z4 = (x, y, z) => zelle[x + y * zb + z * zb * zh];
  const viereck = (a, b2, c, e, innenVorn) => {
    if (a < 0 || b2 < 0 || c < 0 || e < 0) return;
    if (innenVorn) idx.push(a, b2, c, a, c, e);
    else idx.push(a, c, b2, a, e, c);
  };
  for (let z = 1; z < t - 1; z++) for (let y = 1; y < h - 1; y++) for (let x = 0; x < b - 1; x++) {
    const i0 = wert(x, y, z) > iso, i1 = wert(x + 1, y, z) > iso;
    if (i0 !== i1) viereck(z4(x, y - 1, z - 1), z4(x, y, z - 1), z4(x, y, z), z4(x, y - 1, z), i0);
  }
  for (let z = 1; z < t - 1; z++) for (let y = 0; y < h - 1; y++) for (let x = 1; x < b - 1; x++) {
    const i0 = wert(x, y, z) > iso, i1 = wert(x, y + 1, z) > iso;
    if (i0 !== i1) viereck(z4(x - 1, y, z - 1), z4(x - 1, y, z), z4(x, y, z), z4(x, y, z - 1), i0);
  }
  for (let z = 0; z < t - 1; z++) for (let y = 1; y < h - 1; y++) for (let x = 1; x < b - 1; x++) {
    const i0 = wert(x, y, z) > iso, i1 = wert(x, y, z + 1) > iso;
    if (i0 !== i1) viereck(z4(x - 1, y - 1, z), z4(x, y - 1, z), z4(x, y, z), z4(x - 1, y, z), i0);
  }
  const P = new Float32Array(pos);
  const N = new Float32Array(nor);
  const I = new Uint32Array(idx);
  // Umlaufsinn prüfen: die Dreiecke sollen nach außen zeigen (wie die Normalen); sonst umdrehen.
  // (Statt sich die Richtung für jede der drei Achsen zu überlegen, einfach nachsehen.)
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, c = I[k + 1] * 3, e = I[k + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
    const vx = P[e] - P[a], vy = P[e + 1] - P[a + 1], vz = P[e + 2] - P[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = N[a] + N[c] + N[e], ny = N[a + 1] + N[c + 1] + N[e + 1], nz = N[a + 2] + N[c + 2] + N[e + 2];
    if (fx * nx + fy * ny + fz * nz < 0) {
      const tt = I[k + 1];
      I[k + 1] = I[k + 2];
      I[k + 2] = tt;
    }
  }
  return { pos: P, nor: N, idx: I };
}

// Gitterkoordinaten → Welt. ausdehnung: echte Größe je Achse (Voxel · Voxelgröße), lage: Drehung der Ansicht,
// skala: Faktor auf die echte Größe (1 / größte Seite: größte Seite 1; 0.001: Millimeter in Meter)
export function inWelt(netz, feld, ausdehnung, lage, skala) {
  const { pos, nor } = netz;
  const { m, faktor, n } = feld;
  const L = lage ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < pos.length; i += 3) {
    const p = [0, 1, 2].map((k) => (((pos[i + k] - 1) * faktor + faktor / 2) / n[k] - 0.5) * ausdehnung[k] * skala);
    const q = [nor[i], nor[i + 1], nor[i + 2]].map((x, k) => x / ausdehnung[k]); // Normalen: mit der Umkehrung strecken
    const lq = Math.hypot(...q) || 1;
    for (let k = 0; k < 3; k++) {
      pos[i + k] = L[k] * p[0] + L[3 + k] * p[1] + L[6 + k] * p[2];
      nor[i + k] = (L[k] * q[0] + L[3 + k] * q[1] + L[6 + k] * q[2]) / lq;
    }
  }
  void m;
  return netz;
}

// ---------- Dateien ----------

const linear = (c) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4); // sRGB → linear

// teile: [{ name, farbe: [r, g, b] (0 bis 255), deckkraft, netz: { pos, nor, idx }, farben? }]
// farben (wahlweise): eine Farbe je Eckpunkt (Float32Array r, g, b von 0 bis 1, wie auf dem Bildschirm, sRGB);
// dann ist das Material weiß und die Farben der Eckpunkte gelten (glTF: COLOR_0, linear)
export function alsGlb(teile) {
  const json = { asset: { version: "2.0", generator: "Volumen-Viewer (Filip Winkler)" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const stuecke = [];
  let laenge = 0;
  const anhaengen = (arr, ziel) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: laenge, byteLength: bytes.length, target: ziel });
    stuecke.push(bytes);
    laenge += bytes.length;
    const rest = (4 - (laenge % 4)) % 4; // jedes Stück auf 4 Bytes ausrichten
    if (rest) {
      stuecke.push(new Uint8Array(rest));
      laenge += rest;
    }
    return json.bufferViews.length - 1;
  };
  teile.forEach((t, k) => {
    const { pos, nor, idx } = t.netz;
    if (!idx.length) return;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], pos[i + a]);
      hi[a] = Math.max(hi[a], pos[i + a]);
    }
    const vPos = anhaengen(pos, 34962), vNor = anhaengen(nor, 34962), vIdx = anhaengen(idx, 34963);
    const a0 = json.accessors.length;
    json.accessors.push(
      { bufferView: vPos, componentType: 5126, count: pos.length / 3, type: "VEC3", min: lo, max: hi },
      { bufferView: vNor, componentType: 5126, count: nor.length / 3, type: "VEC3" },
      { bufferView: vIdx, componentType: 5125, count: idx.length, type: "SCALAR" },
    );
    const attribute = { POSITION: a0, NORMAL: a0 + 1 };
    if (t.farben) {
      const lin = t.farben.map((c) => linear(c * 255));
      json.accessors.push({ bufferView: anhaengen(lin, 34962), componentType: 5126, count: lin.length / 3, type: "VEC3" });
      attribute.COLOR_0 = json.accessors.length - 1;
    }
    const a = t.deckkraft ?? 1;
    json.materials.push({
      name: t.name,
      pbrMetallicRoughness: { baseColorFactor: [...(t.farben ? [1, 1, 1] : t.farbe.map(linear)), a], metallicFactor: 0, roughnessFactor: 0.6 },
      doubleSided: true,
      ...(a < 0.999 ? { alphaMode: "BLEND" } : {}),
    });
    json.meshes.push({ name: t.name, primitives: [{ attributes: attribute, indices: a0 + 2, material: json.materials.length - 1 }] });
    json.nodes.push({ name: t.name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
    void k;
  });
  json.buffers.push({ byteLength: laenge });
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jRest = (4 - (text.length % 4)) % 4;
  if (jRest) text = new Uint8Array([...text, ...new Array(jRest).fill(0x20)]); // mit Leerzeichen auffüllen
  const gesamt = 12 + 8 + text.length + 8 + laenge;
  const aus = new Uint8Array(gesamt);
  const dv = new DataView(aus.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, gesamt, true);
  dv.setUint32(12, text.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  aus.set(text, 20);
  let o = 20 + text.length;
  dv.setUint32(o, laenge, true);
  dv.setUint32(o + 4, 0x004e4942, true); // "BIN"
  o += 8;
  for (const s of stuecke) {
    aus.set(s, o);
    o += s.length;
  }
  return new Blob([aus], { type: "model/gltf-binary" });
}

export function alsObj(teile) {
  const zeilen = ["# Volumen-Viewer (Filip Winkler): Netz aus Surface Nets, Farbe je Eckpunkt"];
  let basis = 1;
  for (const t of teile) {
    const { pos, nor, idx } = t.netz;
    if (!idx.length) continue;
    const [r, g, b] = t.farbe.map((x) => (x / 255).toFixed(3));
    zeilen.push(`o ${t.name.replace(/\s+/g, "_")}`);
    for (let i = 0; i < pos.length; i += 3) {
      const f = t.farben ? [0, 1, 2].map((k) => t.farben[i + k].toFixed(3)).join(" ") : `${r} ${g} ${b}`;
      zeilen.push(`v ${pos[i].toFixed(5)} ${pos[i + 1].toFixed(5)} ${pos[i + 2].toFixed(5)} ${f}`);
    }
    for (let i = 0; i < nor.length; i += 3) zeilen.push(`vn ${nor[i].toFixed(4)} ${nor[i + 1].toFixed(4)} ${nor[i + 2].toFixed(4)}`);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] + basis, c = idx[i + 1] + basis, e = idx[i + 2] + basis;
      zeilen.push(`f ${a}//${a} ${c}//${c} ${e}//${e}`);
    }
    basis += pos.length / 3;
  }
  return new Blob([zeilen.join("\n") + "\n"], { type: "text/plain" });
}
