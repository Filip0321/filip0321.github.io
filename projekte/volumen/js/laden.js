// Volumen laden: Dateien lesen (NRRD, RAW) oder selbst eines rechnen (Testkörper, Mandelbulb).
// Ergebnis immer: { b, h, t (Breite, Höhe, Tiefe in Voxeln), werte (Zahlen-Array, x läuft am schnellsten),
//                   abstand: [sx, sy, sz] (Voxelgröße), name, ct (true: Werte sind Hounsfield-Einheiten) }
//
// Formate:
//   .nrrd   ein Kopf aus Textzeilen („sizes: 512 512 240“, „type: int16“, …), eine Leerzeile, dann die Daten,
//           roh oder gzip-gepackt (der Browser kann gzip selbst entpacken: DecompressionStream)
//   .nhdr   derselbe Kopf allein, die Daten liegen in einer zweiten Datei („data file: …“): beide zusammen wählen
//   .raw    nur die Daten; Größe und Typ stehen im Namen wie bei Open SciVis: name_512x512x240_int16.raw

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

function fertig(b, h, t, z, abstand, name) {
  if (z.length < b * h * t) throw new Error(`Zu wenig Daten: ${z.length} Werte, erwartet ${b} × ${h} × ${t} = ${b * h * t}.`);
  // die Zahlen bleiben im Typ der Datei (int16 braucht die Hälfte von Float32: bei 512 × 512 × 240 sind das 126
  // statt 252 MB)
  const werte = z.subarray(0, b * h * t);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < werte.length; i += 7) {
    if (werte[i] < min) min = werte[i];
    if (werte[i] > max) max = werte[i];
  }
  // CT erkennen: Luft liegt bei −1000 Hounsfield-Einheiten
  const ct = min <= -900 && max > 200;
  return { b, h, t, werte, abstand, name, ct, min, max };
}

// files: die gewählten Dateien (eine oder zwei)
export async function ladeDateien(files) {
  const liste = [...files];
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
    if (/gz/.test(kopf.encoding ?? "") || datei.name.endsWith(".gz")) daten = await entpacke(daten);
    return ausKopf(kopf, daten, datei.name);
  }
  const raw = liste[0];
  const m = raw.name.match(/(\d+)x(\d+)x(\d+)_([a-z0-9]+)/i);
  if (!m) throw new Error("Bei einer .raw-Datei müssen Größe und Typ im Namen stehen, z. B. kopf_256x256x128_uint8.raw, oder den .nhdr-Kopf dazu wählen.");
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
