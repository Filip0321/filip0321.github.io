// Export aus dem geladenen Skalarvolumen. Es werden die Original-Voxel (nicht die ggf.
// halbierte Vorschau) gelesen und ausgeblendete Voxel aus der Maske ausgelassen.
// Farbe: entweder grau nach dem Messwert (ab einer Schwelle), oder über optionen.farbe(x, y, z, wert) → [r, g, b, a]
// (0 bis 1) oder null: dann bestimmt die Ansicht (Kurve und Segmente), was dabei ist und welche Farbe und
// Deckkraft es hat. Bei Splats wird a die Deckkraft der Gaußglocke.

const C0 = 0.28209479177387814; // 0. Ordnung der sphärischen Harmonischen (3DGS / Graphdeco PLY)
export const MAX_PUNKTE = 1_000_000;

function sichtbar(maske, v, x, y, z) {
  if (!maske?.daten) return true;
  const mx = Math.min(maske.b - 1, Math.floor(((x + 0.5) / v.b) * maske.b));
  const my = Math.min(maske.h - 1, Math.floor(((y + 0.5) / v.h) * maske.h));
  const mz = Math.min(maske.t - 1, Math.floor(((z + 0.5) / v.t) * maske.t));
  return maske.daten[mx + my * maske.b + mz * maske.b * maske.h] > 127;
}

function laufe(v, maske, schwelle, schritt, callback, limit = Infinity, farbe = null) {
  let anzahl = 0;
  const ebene = v.b * v.h;
  for (let z = 0; z < v.t; z += schritt) {
    for (let y = 0; y < v.h; y += schritt) {
      let i = z * ebene + y * v.b;
      for (let x = 0; x < v.b; x += schritt, i += schritt) {
        const wert = v.werte[i];
        if (!Number.isFinite(wert) || (!farbe && wert < schwelle) || !sichtbar(maske, v, x, y, z)) continue;
        const f = farbe ? farbe(x, y, z, wert) : null;
        if (farbe && !f) continue;
        anzahl++;
        if (anzahl > limit) return anzahl; // bei zu großen Wolken nicht den ganzen Datensatz weiter zählen
        callback?.(x, y, z, wert, anzahl - 1, f);
      }
    }
  }
  return anzahl;
}

export function zaehlePunkte(v, maske, schwelle, schritt, limit = Infinity, farbe = null) {
  return laufe(v, maske, schwelle, schritt, null, limit, farbe);
}

function farbwert(wert, v) {
  const bereich = v.max - v.min;
  if (!(bereich > 0)) return 0.75;
  return Math.max(0, Math.min(1, (wert - v.min) / bereich));
}

function positionsFunktion(v, lage) {
  const seiten = [v.b * v.abstand[0], v.h * v.abstand[1], v.t * v.abstand[2]];
  const groesste = Math.max(...seiten, 1e-9);
  const m = lage ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return (x, y, z) => {
    const px = ((x + 0.5) / v.b - 0.5) * seiten[0] / groesste;
    const py = ((y + 0.5) / v.h - 0.5) * seiten[1] / groesste;
    const pz = ((z + 0.5) / v.t - 0.5) * seiten[2] / groesste;
    const wx = m[0] * px + m[3] * py + m[6] * pz;
    const wy = m[1] * px + m[4] * py + m[7] * pz;
    const wz = m[2] * px + m[5] * py + m[8] * pz;
    // Blender: Z oben. Dieselbe Achsenkonvention wie beim Punktwolken-Export in „Tiefe aus Fotos“.
    return [wx, -wz, wy];
  };
}

const PLY_ACHSE = [1, 0, 0, 0, 0, 1, 0, -1, 0]; // spaltenweise: Viewer [x,y,z] → Blender [x,-z,y]

function multipliziere3(a, b) {
  const c = new Array(9);
  for (let spalte = 0; spalte < 3; spalte++) {
    for (let zeile = 0; zeile < 3; zeile++) {
      c[spalte * 3 + zeile] = a[zeile] * b[spalte * 3] + a[3 + zeile] * b[spalte * 3 + 1] + a[6 + zeile] * b[spalte * 3 + 2];
    }
  }
  return c;
}

function quaternion(matrix) {
  const m = matrix.slice();
  // Ein Quaternion kann nur eine reine Drehung darstellen. Bei einer gespiegelten
  // Achse drehen wir eine Basisachse um; die Gaußsche Ellipsoidform bleibt gleich.
  const det = m[0] * (m[4] * m[8] - m[7] * m[5]) - m[3] * (m[1] * m[8] - m[7] * m[2]) + m[6] * (m[1] * m[5] - m[4] * m[2]);
  if (det < 0) { m[0] *= -1; m[1] *= -1; m[2] *= -1; }
  const a00 = m[0], a01 = m[3], a02 = m[6];
  const a10 = m[1], a11 = m[4], a12 = m[7];
  const a20 = m[2], a21 = m[5], a22 = m[8];
  const spur = a00 + a11 + a22;
  let w, x, y, z;
  if (spur > 0) {
    const s = Math.sqrt(spur + 1) * 2;
    w = 0.25 * s; x = (a21 - a12) / s; y = (a02 - a20) / s; z = (a10 - a01) / s;
  } else if (a00 > a11 && a00 > a22) {
    const s = Math.sqrt(1 + a00 - a11 - a22) * 2;
    w = (a21 - a12) / s; x = 0.25 * s; y = (a01 + a10) / s; z = (a02 + a20) / s;
  } else if (a11 > a22) {
    const s = Math.sqrt(1 + a11 - a00 - a22) * 2;
    w = (a02 - a20) / s; x = (a01 + a10) / s; y = 0.25 * s; z = (a12 + a21) / s;
  } else {
    const s = Math.sqrt(1 + a22 - a00 - a11) * 2;
    w = (a10 - a01) / s; x = (a02 + a20) / s; y = (a12 + a21) / s; z = 0.25 * s;
  }
  const norm = Math.hypot(w, x, y, z) || 1;
  return [w / norm, x / norm, y / norm, z / norm];
}

function kopfPly(anzahl, gaussian) {
  if (!gaussian) {
    return `ply\nformat binary_little_endian 1.0\ncomment Volumen-Viewer, Filip Winkler\nelement vertex ${anzahl}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nproperty float intensity\nend_header\n`;
  }
  // Übliche Graphdeco-3DGS-PLY-Felder, dazu red/green/blue als Bytes: Splat-Programme lesen f_dc, der normale
  // PLY-Import (Blender, MeshLab) die Bytes; so kommt die Farbe überall mit. Nur SH-Grad 0: die Volumendaten haben
  // einen festen Voxel-Farbwert, keine kamerawinkelabhängige Erscheinungsfarbe.
  return `ply\nformat binary_little_endian 1.0\ncomment Gaussian splats generated from a scalar volume\nelement vertex ${anzahl}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nproperty float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
}

// Gaussian-PLY speichert Scale logarithmisch und Opazität als Logit (wie Graphdeco).
export function erstellePunktdatei(v, maske, optionen = {}) {
  const schwelle = Number(optionen.schwelle ?? v.min);
  const schritt = Math.max(1, Math.floor(Number(optionen.schritt ?? 1)));
  const gaussian = optionen.art === "gaussian";
  const groesse = Math.max(0.1, Math.min(3, Number(optionen.groesse ?? 0.8)));
  const deckkraft = Math.max(0.05, Math.min(1, Number(optionen.deckkraft ?? 0.85)));
  const farbe = optionen.farbe ?? null;
  const anzahl = zaehlePunkte(v, maske, schwelle, schritt, MAX_PUNKTE, farbe);
  if (!anzahl) throw new Error("Mit dieser Schwelle sind keine sichtbaren Voxel übrig.");
  if (anzahl > MAX_PUNKTE) throw new Error(`${anzahl.toLocaleString("de-DE")} Punkte sind zu viel für einen sicheren Browser-Export. Erhöhe die Schrittweite oder die Schwelle (maximal ${MAX_PUNKTE.toLocaleString("de-DE")}).`);

  const header = new TextEncoder().encode(kopfPly(anzahl, gaussian));
  const bytesProPunkt = gaussian ? 17 * 4 + 3 : 3 * 4 + 3 + 4;
  const puffer = new ArrayBuffer(header.length + anzahl * bytesProPunkt);
  new Uint8Array(puffer).set(header);
  const d = new DataView(puffer);
  const lage = optionen.lage;
  const punktPosition = positionsFunktion(v, lage);
  const matrix = multipliziere3(PLY_ACHSE, lage ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const drehung = quaternion(matrix);
  const seiten = [v.abstand[0], v.abstand[1], v.abstand[2]];
  const maxSeite = Math.max(v.b * seiten[0], v.h * seiten[1], v.t * seiten[2], 1e-9);
  const abstand = seiten.map((x) => x / maxSeite * schritt * 0.5 * groesse);
  const logScale = abstand.map((x) => Math.log(Math.max(x, 1e-6)));
  const logitVon = (a) => {
    const p = Math.max(0.005, Math.min(0.995, a));
    return Math.log(p / (1 - p));
  };
  const logit = logitVon(deckkraft);
  // sRGB (wie auf dem Bildschirm) → linear (so rechnen Splat-Programme mit f_dc)
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let o = header.length;

  laufe(v, maske, schwelle, schritt, (x, y, z, wert, _i, f) => {
    const p = punktPosition(x, y, z);
    const grau = farbwert(wert, v);
    const rgb = f ? [f[0], f[1], f[2]] : [grau, grau, grau];
    if (!gaussian) {
      d.setFloat32(o, p[0], true);
      d.setFloat32(o + 4, p[1], true);
      d.setFloat32(o + 8, p[2], true);
      d.setUint8(o + 12, Math.round(rgb[0] * 255));
      d.setUint8(o + 13, Math.round(rgb[1] * 255));
      d.setUint8(o + 14, Math.round(rgb[2] * 255));
      d.setFloat32(o + 15, wert, true);
      o += bytesProPunkt;
      return;
    }
    // Position
    d.setFloat32(o, p[0], true); d.setFloat32(o + 4, p[1], true); d.setFloat32(o + 8, p[2], true);
    // Normale (nicht berechnet); Orientierung ist durch die skalierte Voxel-Gaussian beschrieben.
    d.setFloat32(o + 12, 0, true); d.setFloat32(o + 16, 0, true); d.setFloat32(o + 20, 0, true);
    // SH-DC: RGB = 0.5 + C0 * f_dc (Farbe in linearer Helligkeit)
    for (let k = 0; k < 3; k++) d.setFloat32(o + 24 + 4 * k, (linear(rgb[k]) - 0.5) / C0, true);
    // Deckkraft: aus der Kurve (mal Faktor), sonst fest
    d.setFloat32(o + 36, f ? logitVon(f[3] * deckkraft) : logit, true);
    d.setFloat32(o + 40, logScale[0], true);
    d.setFloat32(o + 44, logScale[1], true);
    d.setFloat32(o + 48, logScale[2], true);
    // Orientierung des Voxelgitters, in Blender-PLY-Koordinaten.
    d.setFloat32(o + 52, drehung[0], true); d.setFloat32(o + 56, drehung[1], true);
    d.setFloat32(o + 60, drehung[2], true); d.setFloat32(o + 64, drehung[3], true);
    for (let k = 0; k < 3; k++) d.setUint8(o + 68 + k, Math.round(Math.min(1, rgb[k]) * 255));
    o += bytesProPunkt;
  }, Infinity, farbe);

  return {
    blob: new Blob([puffer], { type: "application/octet-stream" }),
    anzahl,
    endung: ".ply",
    gaussian,
  };
}


