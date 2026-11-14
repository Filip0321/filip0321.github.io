import { ladeDicom } from "./dicom.js";

// Volumen laden: NIfTI, MetaImage, NRRD, RAW und DICOM lesen oder selbst eines rechnen (Testkörper, Mandelbulb).
// Ergebnis immer: { b, h, t (Breite, Höhe, Tiefe in Voxeln), werte (Zahlen-Array, x läuft am schnellsten),
//                   abstand: [sx, sy, sz] (Voxelgröße), name, ct (true: Werte sind Hounsfield-Einheiten) }
//
// Formate:
//   .nrrd   ein Kopf aus Textzeilen („sizes: 512 512 240“, „type: int16“, …), eine Leerzeile, dann die Daten,
//           roh oder gzip-gepackt (der Browser kann gzip selbst entpacken: DecompressionStream)
//   .nhdr   derselbe Kopf allein, die Daten liegen in einer zweiten Datei („data file: …“): beide zusammen wählen
//   .nii/.nii.gz, .hdr + .img  NIfTI-1/2; 4D lädt das erste Zeitvolumen
//   .mha/.mhd                MetaImage, lokal oder mit separater Datendatei
//   .raw                     nur die Daten; Größe und Typ stehen im Namen: name_512x512x240_int16.raw

const TYPEN = {
  uint8: Uint8Array, "unsigned char": Uint8Array, uchar: Uint8Array,
  int8: Int8Array, "signed char": Int8Array, char: Int8Array,
  uint16: Uint16Array, "unsigned short": Uint16Array, ushort: Uint16Array,
  int16: Int16Array, short: Int16Array, "signed short": Int16Array,
  uint32: Uint32Array, "unsigned int": Uint32Array,
  int32: Int32Array, int: Int32Array,
  float32: Float32Array, float: Float32Array,
  float64: Float64Array, double: Float64Array,
};

// Bytes → Zahlen im richtigen Typ (und Byte-Reihenfolge: „big endian“ muss umgedreht werden, die Rechner hier
// sind alle „little endian“)
function zahlen(puffer, typ, endian = "little") {
  const Typ = TYPEN[typ];
  if (!Typ) throw new Error(`Datentyp „${typ}“ kenne ich nicht.`);
  const breite = Typ.BYTES_PER_ELEMENT;
  let bytes = new Uint8Array(puffer);
  if (endian === "big" && breite > 1) {
    bytes = bytes.slice();
    for (let i = 0; i < bytes.length; i += breite) bytes.subarray(i, i + breite).reverse();
  }
  const ausgerichtet = bytes.byteOffset % breite === 0 ? bytes : bytes.slice();
  return new Typ(ausgerichtet.buffer, ausgerichtet.byteOffset, Math.floor(ausgerichtet.byteLength / breite));
}

async function entpacke(puffer) {
  const strom = new Blob([puffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(strom).arrayBuffer();
}

// ---------- NIfTI-1 / NIfTI-2 (.nii, .nii.gz, .hdr + .img) ----------
// NIfTI speichert zuerst einen binären Header und danach die Voxel. Bei 4D-Dateien
// wird hier bewusst nur das erste Zeitvolumen geladen; komplexe/Vektor-Datensätze
// sind keine skalaren Volumen und werden mit einer verständlichen Meldung abgelehnt.
const NIFTI_TYPEN = {
  2: [Uint8Array, 1],       // uint8
  4: [Int16Array, 2],       // int16
  8: [Int32Array, 4],       // int32
  16: [Float32Array, 4],    // float32
  64: [Float64Array, 8],    // float64
  256: [Int8Array, 1],      // int8
  512: [Uint16Array, 2],    // uint16
  768: [Uint32Array, 4],    // uint32
  1024: [BigInt64Array, 8], // int64
  1280: [BigUint64Array, 8] // uint64
};

function niftiArray(puffer, code, anzahl, little, offset = 0) {
  const eintrag = NIFTI_TYPEN[code];
  if (!eintrag) throw new Error(`NIfTI-Datentyp ${code} wird nicht unterstützt (erwartet wird ein skalares Grauwert-Volumen).`);
  const [Typ, breite] = eintrag;
  const benoetigt = anzahl * breite;
  if (!Number.isSafeInteger(benoetigt) || offset < 0 || puffer.byteLength - offset < benoetigt) {
    throw new Error(`NIfTI-Daten sind zu kurz oder die Volumengröße ist zu groß (${puffer.byteLength - offset} statt ${benoetigt} Bytes).`);
  }
  let bytes = new Uint8Array(puffer, offset, benoetigt);
  if (!little && breite > 1) {
    bytes = bytes.slice(); // nur Big-Endian braucht eine Kopie für das Umdrehen
    for (let i = 0; i < bytes.length; i += breite) {
      for (let a = 0, b = breite - 1; a < b; a++, b--) {
        const tmp = bytes[i + a]; bytes[i + a] = bytes[i + b]; bytes[i + b] = tmp;
      }
    }
    return new Typ(bytes.buffer);
  }
  // Ungepackte Little-Endian-Dateien direkt lesen: große CT-Dateien nicht zusätzlich kopieren.
  if (bytes.byteOffset % breite === 0) return new Typ(bytes.buffer, bytes.byteOffset, anzahl);
  bytes = bytes.slice();
  return new Typ(bytes.buffer);
}

function multipliziere3(a, b) {
  const c = new Array(9);
  for (let spalte = 0; spalte < 3; spalte++) {
    for (let zeile = 0; zeile < 3; zeile++) {
      c[spalte * 3 + zeile] = a[zeile] * b[spalte * 3] + a[3 + zeile] * b[spalte * 3 + 1] + a[6 + zeile] * b[spalte * 3 + 2];
    }
  }
  return c;
}

// NIfTI beschreibt die Voxelachsen in RAS (rechts, vorne, oben). Der Viewer
// benutzt rechts, oben, vorne und schaut von +z auf das Volumen.
const RAS_ZU_ANSICHT = [-1, 0, 0, 0, 0, 1, 0, 1, 0]; // RAS → LPS → Viewer

function niftiRichtung(d, version, little) {
  const code = (o) => version === 1 ? d.getInt16(o, little) : d.getInt32(o, little);
  const f32 = (o) => d.getFloat32(o, little);
  const f64 = (o) => d.getFloat64(o, little);
  const codeQ = code(version === 1 ? 252 : 344);
  const codeS = code(version === 1 ? 254 : 348);
  let richtung = null;
  if (codeS > 0) {
    const start = version === 1 ? 280 : 400;
    const lese = (o) => version === 1 ? f32(o) : f64(o);
    const zeilen = [0, 1, 2].map((r) => [0, 1, 2].map((c) => lese(start + r * (version === 1 ? 16 : 32) + c * (version === 1 ? 4 : 8))));
    richtung = [];
    for (let c = 0; c < 3; c++) {
      const laenge = Math.hypot(zeilen[0][c], zeilen[1][c], zeilen[2][c]) || 1;
      richtung.push(zeilen[0][c] / laenge, zeilen[1][c] / laenge, zeilen[2][c] / laenge);
    }
  } else if (codeQ > 0) {
    const start = version === 1 ? 256 : 352;
    const lese = (o) => version === 1 ? f32(o) : f64(o);
    let b = lese(start), c = lese(start + (version === 1 ? 4 : 8)), e = lese(start + (version === 1 ? 8 : 16));
    const summe = b * b + c * c + e * e;
    let a;
    if (summe <= 1) a = Math.sqrt(1 - summe);
    else { const f = 1 / Math.sqrt(summe); b *= f; c *= f; e *= f; a = 0; }
    // Quaternion → Rotationsmatrix (zunächst zeilenweise).
    const r = [
      a*a+b*b-c*c-e*e, 2*b*c-2*a*e, 2*b*e+2*a*c,
      2*b*c+2*a*e, a*a+c*c-b*b-e*e, 2*c*e-2*a*b,
      2*b*e-2*a*c, 2*c*e+2*a*b, a*a+e*e-c*c-b*b,
    ];
    richtung = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
    const qfac = (version === 1 ? f32(76) : f64(104)) < 0 ? -1 : 1;
    richtung[6] *= qfac; richtung[7] *= qfac; richtung[8] *= qfac;
  }
  if (!richtung) richtung = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return multipliziere3(RAS_ZU_ANSICHT, richtung);
}

function kopfNifti(puffer) {
  if (puffer.byteLength < 348) throw new Error("Die NIfTI-Datei ist zu klein für einen Header.");
  const d = new DataView(puffer);
  let little;
  let version;
  if (d.getInt32(0, true) === 348) { little = true; version = 1; }
  else if (d.getInt32(0, false) === 348) { little = false; version = 1; }
  else if (puffer.byteLength >= 540 && d.getInt32(0, true) === 540) { little = true; version = 2; }
  else if (puffer.byteLength >= 540 && d.getInt32(0, false) === 540) { little = false; version = 2; }
  else throw new Error("Kein gültiger NIfTI-1- oder NIfTI-2-Header gefunden.");

  const i16 = (o) => d.getInt16(o, little);
  const i32 = (o) => d.getInt32(o, little);
  const i64 = (o) => Number(d.getBigInt64(o, little));
  const f32 = (o) => d.getFloat32(o, little);
  const f64 = (o) => d.getFloat64(o, little);
  const dimStart = version === 1 ? 40 : 16;
  const dim = (i) => version === 1 ? i16(dimStart + i * 2) : i64(dimStart + i * 8);
  const pixStart = version === 1 ? 76 : 104;
  const pix = (i) => version === 1 ? f32(pixStart + i * 4) : f64(pixStart + i * 8);
  const datatype = i16(version === 1 ? 70 : 12);
  const anzahlDimensionen = dim(0);
  if (anzahlDimensionen < 3 || anzahlDimensionen > 4) {
    throw new Error(`NIfTI mit ${anzahlDimensionen} Dimensionen wird nicht unterstützt. Erlaubt sind 3D und 4D (erstes Zeitvolumen).`);
  }
  const b = dim(1), h = dim(2), t = dim(3);
  if (![b, h, t].every((x) => Number.isSafeInteger(x) && x > 0)) throw new Error("Ungültige NIfTI-Volumengröße im Header.");
  if (anzahlDimensionen === 4 && dim(4) < 1) throw new Error("Ungültige Zeitdimension in der NIfTI-Datei.");

  const offset = version === 1 ? Math.max(0, Math.floor(f32(108))) : Math.max(0, i64(168));
  const slopeRaw = version === 1 ? f32(112) : f64(176);
  const interRaw = version === 1 ? f32(116) : f64(184);
  const slope = Number.isFinite(slopeRaw) && slopeRaw !== 0 ? slopeRaw : 1;
  const intercept = Number.isFinite(interRaw) ? interRaw : 0;
  const units = d.getUint8(version === 1 ? 123 : 500) & 7;
  const einheit = units === 1 ? 1000 : units === 3 ? 0.001 : 1; // Meter / Millimeter / Mikrometer → mm
  const abstand = [1, 2, 3].map((i) => Math.abs(pix(i) || 1) * einheit);
  const richtung = niftiRichtung(d, version, little);
  return { version, little, datatype, b, h, t, offset, slope, intercept, abstand, richtung };
}

async function ladeNiftiDatei(datei, datenDatei = null) {
  const istPaar = /\.hdr(?:\.gz)?$/i.test(datei.name);
  let headerPuffer = await datei.arrayBuffer();
  if (/\.gz$/i.test(datei.name)) headerPuffer = await entpacke(headerPuffer);
  const k = kopfNifti(headerPuffer);
  let datenPuffer;
  if (istPaar) {
    if (!datenDatei) throw new Error(`Zum NIfTI-Header „${datei.name}“ fehlt die passende .img-Datei. Bitte .hdr und .img zusammen auswählen.`);
    datenPuffer = await datenDatei.arrayBuffer();
    if (/\.gz$/i.test(datenDatei.name)) datenPuffer = await entpacke(datenPuffer);
  } else {
    datenPuffer = headerPuffer;
  }
  const count = k.b * k.h * k.t; // bei 4D nehmen wir das erste Zeitvolumen
  const datenOffset = k.offset; // bei .hdr/.img bezieht sich vox_offset auf den Anfang der .img-Datei
  const roh = niftiArray(datenPuffer, k.datatype, count, k.little, datenOffset);
  let werte = roh;
  if (roh instanceof BigInt64Array || roh instanceof BigUint64Array || k.slope !== 1 || k.intercept !== 0) {
    werte = new Float32Array(count);
    for (let i = 0; i < count; i++) werte[i] = Number(roh[i]) * k.slope + k.intercept;
  }
  return fertig(k.b, k.h, k.t, werte, k.abstand, istPaar ? datenDatei.name : datei.name, k.richtung);
}

// ---------- MetaImage (.mha / .mhd + .raw) ----------
const META_TYPEN = {
  MET_CHAR: "int8", MET_UCHAR: "uint8", MET_SHORT: "int16", MET_USHORT: "uint16",
  MET_INT: "int32", MET_UINT: "uint32", MET_FLOAT: "float32", MET_DOUBLE: "float64",
};

function metaKopf(bytes) {
  const kopf = {};
  let pos = 0;
  let lokal = false;
  const decoder = new TextDecoder();
  while (pos < bytes.length) {
    let ende = pos;
    while (ende < bytes.length && bytes[ende] !== 10) ende++;
    const zeile = decoder.decode(bytes.subarray(pos, ende)).replace(/\r$/, "").trim();
    pos = Math.min(bytes.length, ende + 1);
    if (!zeile || zeile.startsWith("#")) continue;
    const i = zeile.indexOf("=");
    if (i < 0) continue;
    const schluessel = zeile.slice(0, i).trim().toLowerCase();
    const wert = zeile.slice(i + 1).trim();
    kopf[schluessel] = wert;
    if (schluessel === "elementdatafile") {
      lokal = wert.toLowerCase() === "local";
      break; // bei LOCAL stehen unmittelbar danach die Binärdaten
    }
  }
  return { kopf, offset: pos, lokal };
}

function metaRichtung(kopf) {
  // MetaImage verwendet üblicherweise LPS-Koordinaten. TransformMatrix steht zeilenweise im Header.
  const werte = (kopf.transformmatrix ?? "1 0 0 0 1 0 0 0 1").split(/\s+/).map(Number);
  if (werte.length !== 9 || !werte.every(Number.isFinite)) return [1, 0, 0, 0, 0, -1, 0, 1, 0];
  const richtung = [werte[0], werte[3], werte[6], werte[1], werte[4], werte[7], werte[2], werte[5], werte[8]];
  return multipliziere3([1, 0, 0, 0, 0, -1, 0, 1, 0], richtung);
}

async function ladeMetaImage(headerDatei, dateien) {
  const puffer = await headerDatei.arrayBuffer();
  const bytes = new Uint8Array(puffer);
  const { kopf, offset, lokal } = metaKopf(bytes);
  if (Number(kopf.ndims) !== 3) throw new Error(`MetaImage mit ${kopf.ndims ?? "unbekannter"} Dimensionen wird nicht unterstützt; erwartet wird 3D.`);
  if (Number(kopf.elementnumberofchannels ?? 1) !== 1) throw new Error("MetaImage mit mehreren Kanälen (RGB/Vektoren) wird nicht unterstützt.");
  const groessen = (kopf.dimsize ?? "").split(/\s+/).map(Number);
  if (groessen.length !== 3 || !groessen.every((x) => Number.isSafeInteger(x) && x > 0)) throw new Error("Ungültige DimSize im MetaImage-Header.");
  const [b, h, t] = groessen;
  const typ = META_TYPEN[(kopf.elementtype ?? "").toUpperCase()];
  if (!typ) throw new Error(`MetaImage-Datentyp „${kopf.elementtype ?? "?"}“ wird nicht unterstützt.`);
  const abstand = (kopf.elementspacing ?? "1 1 1").split(/\s+/).map(Number).slice(0, 3).map((x) => x > 0 ? x : 1);
  let datenPuffer;
  if (lokal) {
    datenPuffer = puffer.slice(offset);
  } else {
    const datenName = kopf.elementdatafile;
    if (!datenName || /^(list|list\s)/i.test(datenName)) throw new Error("MetaImage-Listen mit mehreren Datendateien werden nicht unterstützt.");
    const basis = datenName.split(/[\\/]/).pop().toLowerCase();
    const datenDatei = dateien.find((f) => f.name.toLowerCase() === basis)
      ?? dateien.find((f) => f.name.toLowerCase().endsWith(basis));
    if (!datenDatei) throw new Error(`Zum MetaImage-Header fehlt „${datenName}“. Bitte .mhd und die RAW-Datei zusammen auswählen.`);
    datenPuffer = await datenDatei.arrayBuffer();
  }
  if (/^true$/i.test(kopf.compresseddata ?? "false")) {
    const strom = new Blob([datenPuffer]).stream().pipeThrough(new DecompressionStream("deflate"));
    datenPuffer = await new Response(strom).arrayBuffer();
  }
  const headerSize = Number(kopf.headersize ?? 0);
  if (headerSize > 0) datenPuffer = datenPuffer.slice(headerSize);
  const z = zahlen(datenPuffer, typ, /^true$/i.test(kopf.elementbyteordermsb ?? "false") ? "big" : "little");
  return fertig(b, h, t, z, abstand, headerDatei.name, metaRichtung(kopf));
}


// NRRD-Kopf lesen: „feld: wert“ je Zeile (Zeilen mit # sind Kommentare)
function lieskopf(text) {
  const kopf = {};
  for (const zeile of text.split(/\r?\n/)) {
    if (!zeile || zeile.startsWith("#") || zeile.startsWith("NRRD")) continue;
    const i = zeile.indexOf(":");
    if (i < 0) continue;
    kopf[zeile.slice(0, i).trim().toLowerCase()] = zeile.slice(i + 1).replace(/^=/, "").trim();
  }
  return kopf;
}
// Voxelgröße: „spacings: 1 1 2.5“ oder „space directions: (0.7,0,0) (0,0.7,0) (0,0,2.5)“ (die Länge jedes Vektors)
function abstaende(kopf) {
  if (kopf.spacings) return kopf.spacings.split(/\s+/).map(Number).map((x) => (Number.isFinite(x) ? x : 1));
  if (kopf["space directions"]) {
    const vektoren = kopf["space directions"].match(/\(([^)]*)\)/g) ?? [];
    return vektoren.map((v) => Math.hypot(...v.slice(1, -1).split(",").map(Number)));
  }
  return [1, 1, 1];
}

function ausKopf(kopf, daten, name) {
  const groessen = kopf.sizes.split(/\s+/).map(Number);
  if (groessen.length !== 3) throw new Error(`Erwartet drei Achsen, gefunden ${groessen.length} („sizes: ${kopf.sizes}“).`);
  const [b, h, t] = groessen;
  const z = zahlen(daten, kopf.type, kopf.endian);
  return fertig(b, h, t, z, abstaende(kopf), name);
}

function fertig(b, h, t, z, abstand, name, richtung = null) {
  if (z.length < b * h * t) throw new Error(`Zu wenig Daten: ${z.length} Werte, erwartet ${b} × ${h} × ${t} = ${b * h * t}.`);
  // die Zahlen bleiben im Typ der Datei (int16 braucht die Hälfte von Float32: bei 512 × 512 × 240 sind das 126
  // statt 252 MB)
  const werte = z.subarray(0, b * h * t);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < werte.length; i++) {
    const w = werte[i];
    if (!Number.isFinite(w)) continue;
    if (w < min) min = w;
    if (w > max) max = w;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("Das Volumen enthält keine gültigen Zahlenwerte.");
  // CT erkennen: Luft liegt bei −1000 Hounsfield-Einheiten
  const ct = min <= -900 && max > 200;
  return { b, h, t, werte, abstand, name, ct, min, max, ...(richtung ? { richtung } : {}) };
}

// files: die gewählten Dateien (eine oder zwei, oder ein ganzer DICOM-Ordner)
export async function ladeDateien(files) {
  const liste = [...files];
  const bekannt = /\.(nrrd|nhdr|raw|gz|nii|hdr|img|mha|mhd)$/i;
  // DICOM: Endung .dcm, oder viele Dateien ohne bekannte Endung (Scanner benennen Schichten oft nur mit Nummern)
  if (liste.some((f) => /\.dcm$/i.test(f.name)) || (liste.length > 2 && !liste.some((f) => bekannt.test(f.name)))) {
    return ladeDicom(liste);
  }
  const nach = (endung) => liste.find((f) => f.name.toLowerCase().endsWith(endung));
  const nhdr = nach(".nhdr");
  const nrrd = nach(".nrrd");
  if (nrrd) {
    const puffer = await nrrd.arrayBuffer();
    const bytes = new Uint8Array(puffer);
    // Kopfende: erste Leerzeile (\n\n)
    let ende = -1;
    for (let i = 0; i < Math.min(bytes.length - 1, 100000); i++) {
      if (bytes[i] === 10 && (bytes[i + 1] === 10 || (bytes[i + 1] === 13 && bytes[i + 2] === 10))) {
        ende = bytes[i + 1] === 10 ? i + 2 : i + 3;
        break;
      }
    }
    if (ende < 0) throw new Error("Kein Ende des NRRD-Kopfs gefunden.");
    const kopf = lieskopf(new TextDecoder().decode(bytes.subarray(0, ende)));
    let daten = puffer.slice(ende);
    if (/gz/.test(kopf.encoding ?? "")) daten = await entpacke(daten);
    else if (kopf.encoding && kopf.encoding !== "raw") throw new Error(`Kodierung „${kopf.encoding}“ geht nicht (nur raw und gzip).`);
    return ausKopf(kopf, daten, nrrd.name);
  }
  if (nhdr) {
    const kopf = lieskopf(await nhdr.text());
    const datei = liste.find((f) => f !== nhdr);
    if (!datei) throw new Error(`Zum Kopf gehört die Datei „${kopf["data file"] ?? kopf.datafile}“: beide zusammen auswählen.`);
    let daten = await datei.arrayBuffer();
    if (/gz/.test(kopf.encoding ?? "") || /\.gz$/i.test(datei.name)) daten = await entpacke(daten);
    return ausKopf(kopf, daten, datei.name);
  }

  // NIfTI-1/2: Einzeldatei .nii/.nii.gz oder Header-/Bildpaar .hdr + .img.
  const nii = nach(".nii.gz") ?? nach(".nii");
  const hdr = nach(".hdr.gz") ?? nach(".hdr");
  if (nii) return ladeNiftiDatei(nii);
  if (hdr) {
    const basis = hdr.name.replace(/\.hdr(?:\.gz)?$/i, "").toLowerCase();
    const img = liste.find((f) => f.name.toLowerCase() === `${basis}.img`)
      ?? liste.find((f) => f.name.toLowerCase() === `${basis}.img.gz`);
    return ladeNiftiDatei(hdr, img);
  }

  // MetaImage: eingebettete Daten in .mha oder separater .mhd-Kopf + .raw.
  const mha = nach(".mha");
  const mhd = nach(".mhd");
  if (mha) return ladeMetaImage(mha, liste);
  if (mhd) return ladeMetaImage(mhd, liste);

  // RAW ohne Header: Größe und Typ stehen im Dateinamen wie bei Open SciVis.
  const raw = nach(".raw") ?? liste[0];
  const m = raw.name.match(/(\d+)x(\d+)x(\d+)_([a-z0-9]+)/i);
  if (!m) throw new Error("RAW braucht Größe und Typ im Namen, z. B. kopf_256x256x128_uint8.raw, oder einen .nhdr/.mhd-Header dazu.");
  const [, b, h, t, typ] = m;
  return fertig(Number(b), Number(h), Number(t), zahlen(await raw.arrayBuffer(), typ.toLowerCase()), [1, 1, 1], raw.name);
}

// ---------- selbst gerechnete Volumen ----------
// Testkörper: ein Kopf aus Ellipsoiden in Hounsfield-Einheiten (wie das Shepp-Logan-Phantom, nur in 3D und mit
// Knochen): Luft −1000, Haut und Fett um −100, Gehirn 40, Flüssigkeit 10, Knochen 1000, Gefäße mit Kontrastmittel 250
export function testkoerper(n = 128) {
  const b = n, h = n, t = n;
  const werte = new Float32Array(b * h * t).fill(-1000);
  // [Mitte x, y, z, Halbachsen a, b, c, Wert (ersetzt)]
  const teile = [
    [0, 0, 0, 0.72, 0.9, 0.8, -80], // Kopf (Haut/Fett)
    [0, 0, 0, 0.68, 0.86, 0.76, 1000], // Schädelknochen
    [0, 0, 0, 0.62, 0.8, 0.7, 40], // Gehirn
    [-0.18, 0.05, 0.05, 0.08, 0.25, 0.12, 8], // Ventrikel links
    [0.18, 0.05, 0.05, 0.08, 0.25, 0.12, 8], // Ventrikel rechts
    [-0.28, -0.55, 0.45, 0.12, 0.12, 0.12, 20], // Augen
    [0.28, -0.55, 0.45, 0.12, 0.12, 0.12, 20],
    [0, -0.55, -0.4, 0.08, 0.08, 0.3, 250], // ein Gefäß mit Kontrastmittel
    [0, 0.3, -0.2, 0.05, 0.4, 0.05, 250],
  ];
  for (let z = 0; z < t; z++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        const p = [(x / (b - 1)) * 2 - 1, (y / (h - 1)) * 2 - 1, (z / (t - 1)) * 2 - 1];
        let v = -1000;
        for (const [mx, my, mz, a, bb, c, w] of teile) {
          const d = ((p[0] - mx) / a) ** 2 + ((p[1] - my) / bb) ** 2 + ((p[2] - mz) / c) ** 2;
          if (d <= 1) v = w;
        }
        // ein wenig Rauschen, wie im echten CT
        werte[x + y * b + z * b * h] = v + (Math.random() - 0.5) * 30;
      }
    }
  }
  return { b, h, t, werte, abstand: [1, 1, 1], name: "Testkörper (Kopf)", ct: true, min: -1015, max: 1015 };
}

// Mandelbulb als Dichte: wie viele Schritte bleibt der Punkt in der Nähe (je mehr, desto „dichter“)
export function mandelbulb(n = 128, potenz = 8) {
  const werte = new Float32Array(n * n * n);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cx = (x / (n - 1)) * 2.6 - 1.3, cy = (y / (n - 1)) * 2.6 - 1.3, cz = (z / (n - 1)) * 2.6 - 1.3;
        let px = cx, py = cy, pz = cz;
        let i = 0;
        for (; i < 12; i++) {
          const r = Math.hypot(px, py, pz);
          if (r > 2) break;
          const th = Math.acos(pz / (r || 1e-9)) * potenz;
          const ph = Math.atan2(py, px) * potenz;
          const rn = r ** potenz;
          px = rn * Math.sin(th) * Math.cos(ph) + cx;
          py = rn * Math.sin(th) * Math.sin(ph) + cy;
          pz = rn * Math.cos(th) + cz;
        }
        werte[x + y * n + z * n * n] = i;
      }
    }
  }
  return { b: n, h: n, t: n, werte, abstand: [1, 1, 1], name: "Mandelbulb", ct: false, min: 0, max: 12 };
}

// halb so groß in jede Richtung (Mittel aus 2 × 2 × 2), für große Scans auf schwachen Geräten
export function halbiere(v) {
  const b = Math.floor(v.b / 2), h = Math.floor(v.h / 2), t = Math.floor(v.t / 2);
  const werte = new Float32Array(b * h * t);
  for (let z = 0; z < t; z++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        let s = 0;
        for (let k = 0; k < 8; k++) s += v.werte[(2 * x + (k & 1)) + (2 * y + ((k >> 1) & 1)) * v.b + (2 * z + (k >> 2)) * v.b * v.h];
        werte[x + y * b + z * b * h] = s / 8;
      }
    }
  }
  return { ...v, b, h, t, werte, abstand: v.abstand.map((a) => a * 2) };
}
