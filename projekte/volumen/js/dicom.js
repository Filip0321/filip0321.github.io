// DICOM lesen: das Format, in dem jedes Krankenhaus CT und MRT speichert. Meist eine Datei pro Schicht, alle in
// einem Ordner. Jede Datei ist eine Liste von Einträgen („Tags“): (Gruppe, Element), Typ (VR), Länge, Wert.
//   (0028,0010) Rows, (0028,0011) Columns          Größe der Schicht
//   (0028,0030) Pixel Spacing „0.7\0.7“            Pixelgröße in mm
//   (0020,0032) Image Position (Patient) „x\y\z“   wo die Schicht im Raum liegt (zum Sortieren)
//   (0020,0037) Image Orientation                  Richtung der Zeilen und Spalten (daraus die Normale)
//   (0028,1052) Rescale Intercept, (0028,1053) Slope   Wert = Rohwert · Slope + Intercept (bei CT: Hounsfield)
//   (0028,0100) Bits Allocated, (0028,0103) Pixel Representation (0 ohne, 1 mit Vorzeichen)
//   (7FE0,0010) Pixel Data                         die Bilddaten
// Ab Byte 128 steht „DICM“, danach die Gruppe 0002 (immer „explicit VR little endian“). Ihr Eintrag (0002,0010)
// sagt, wie der Rest geschrieben ist (Transfer Syntax). Ungepackt geht hier; JPEG- oder JPEG-2000-gepackte Daten
// bräuchten einen eigenen Decoder (dann vorher mit einem Werkzeug wie dcmdjpeg entpacken).

const LANG = new Set(["OB", "OW", "OF", "SQ", "UT", "UN", "OD", "OL", "UC", "UR", "OV", "SV", "UV"]);
const IMPLIZIT = "1.2.840.10008.1.2";
const EXPLIZIT = "1.2.840.10008.1.2.1";

function liesDatei(puffer) {
  const d = new DataView(puffer);
  const text = (o, n) => new TextDecoder("latin1").decode(new Uint8Array(puffer, o, n)).replace(/\0/g, "").trim();
  let pos = 132;
  if (puffer.byteLength < 132 || text(128, 4) !== "DICM") pos = 0; // manche Dateien haben keinen Vorspann
  const tags = {};
  let explizit = pos > 0; // die Gruppe 0002 ist immer explizit
  let syntax = pos > 0 ? null : IMPLIZIT;

  // undefinierte Länge (Sequenzen): bis zum Ende-Zeichen (FFFE,E0DD) überspringen
  function ueberspringeSequenz(p) {
    while (p < puffer.byteLength - 8) {
      const g = d.getUint16(p, true), e = d.getUint16(p + 2, true), l = d.getUint32(p + 4, true);
      p += 8;
      if (g === 0xfffe && e === 0xe0dd) return p;
      if (g === 0xfffe && e === 0xe000 && l === 0xffffffff) p = ueberspringeItem(p);
      else if (g === 0xfffe && e === 0xe000) p += l;
    }
    return p;
  }
  function ueberspringeItem(p) {
    while (p < puffer.byteLength - 8) {
      const g = d.getUint16(p, true), e = d.getUint16(p + 2, true);
      if (g === 0xfffe && e === 0xe00d) return p + 8;
      p = element(p).weiter;
    }
    return p;
  }
  function element(p) {
    const g = d.getUint16(p, true);
    const e = d.getUint16(p + 2, true);
    let vr = null;
    let laenge;
    let start;
    const hierExplizit = g === 0x0002 ? true : explizit;
    if (hierExplizit && !(g === 0xfffe)) {
      vr = text(p + 4, 2);
      if (LANG.has(vr)) {
        laenge = d.getUint32(p + 8, true);
        start = p + 12;
      } else {
        laenge = d.getUint16(p + 6, true);
        start = p + 8;
      }
    } else {
      laenge = d.getUint32(p + 4, true);
      start = p + 8;
    }
    let weiter;
    if (laenge === 0xffffffff) weiter = ueberspringeSequenz(start);
    else weiter = start + laenge;
    return { g, e, vr, start, laenge, weiter };
  }

  while (pos < puffer.byteLength - 8) {
    const el = element(pos);
    const schluessel = ((el.g << 16) | el.e) >>> 0;
    if (el.g !== 0x0002 && syntax === null) {
      // erste Gruppe nach 0002: ab hier gilt die Transfer Syntax
      syntax = tags[0x00020010] ?? EXPLIZIT;
      explizit = syntax !== IMPLIZIT;
      if (syntax !== IMPLIZIT && syntax !== EXPLIZIT) throw new Error(`gepackte Daten (Transfer Syntax ${syntax})`);
      continue; // dieses Element noch einmal mit der richtigen Lesart
    }
    if (schluessel === 0x7fe00010) {
      tags.pixel = { start: el.start, laenge: el.laenge };
      break;
    }
    if (el.laenge !== 0xffffffff && el.laenge < 256) {
      const istZahl = el.vr === "US" || (!el.vr && [0x00280010, 0x00280011, 0x00280100, 0x00280103, 0x00280002].includes(schluessel));
      tags[schluessel] = istZahl && el.laenge >= 2 ? d.getUint16(el.start, true) : text(el.start, el.laenge);
    }
    pos = el.weiter;
  }
  return tags;
}

const zahlen = (s) => String(s ?? "").split("\\").map(Number);

// files: alle Dateien eines Ordners; die größte Serie gleicher Größe wird zum Volumen
export async function ladeDicom(files) {
  const schichten = [];
  let fehler = null;
  for (const f of files) {
    if (/dicomdir/i.test(f.name)) continue;
    try {
      const puffer = await f.arrayBuffer();
      const t = liesDatei(puffer);
      if (!t.pixel || !t[0x00280010]) continue;
      schichten.push({ t, puffer });
    } catch (e) {
      fehler = e.message;
    }
  }
  if (!schichten.length) throw new Error(fehler ? `DICOM: ${fehler}. Gepackte DICOM-Dateien vorher entpacken (z. B. mit dcmdjpeg).` : "Keine DICOM-Schichten gefunden.");
  // nach Serie (0020,000E) und Größe gruppieren, die größte nehmen
  const gruppen = new Map();
  for (const s of schichten) {
    const k = `${s.t[0x0020000e] ?? ""}|${s.t[0x00280010]}x${s.t[0x00280011]}`;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(s);
  }
  const serie = [...gruppen.values()].sort((a, b) => b.length - a.length)[0];
  // sortieren: Lage entlang der Normale der Schicht (Kreuzprodukt der Zeilen- und Spaltenrichtung)
  const o = zahlen(serie[0].t[0x00200037]);
  const n = o.length === 6 ? [o[1] * o[5] - o[2] * o[4], o[2] * o[3] - o[0] * o[5], o[0] * o[4] - o[1] * o[3]] : [0, 0, 1];
  const lage = (s) => {
    const p = zahlen(s.t[0x00200032]);
    return p.length === 3 && p.every(Number.isFinite) ? p[0] * n[0] + p[1] * n[1] + p[2] * n[2] : Number(s.t[0x00200013] ?? 0);
  };
  serie.sort((a, b) => lage(a) - lage(b));
  const t0 = serie[0].t;
  const b = t0[0x00280011];
  const h = t0[0x00280010];
  const tiefe = serie.length;
  const bits = t0[0x00280100] ?? 16;
  const mitVorzeichen = t0[0x00280103] === 1;
  const pixel = zahlen(t0[0x00280030]);
  let dz = Number(t0[0x00180088] || t0[0x00180050] || 1);
  if (tiefe > 1) {
    const abst = [];
    for (let i = 1; i < tiefe; i++) abst.push(Math.abs(lage(serie[i]) - lage(serie[i - 1])));
    abst.sort((a, c) => a - c);
    if (abst[abst.length >> 1] > 0) dz = abst[abst.length >> 1]; // Median: robust gegen eine fehlende Schicht
  }
  const werte = new Float32Array(b * h * tiefe);
  serie.forEach((s, z) => {
    const steigung = Number(s.t[0x00281053] || 1);
    const versatz = Number(s.t[0x00281052] || 0);
    const { start } = s.t.pixel;
    const roh = bits === 8 ? new Uint8Array(s.puffer, start, b * h)
      : mitVorzeichen ? new Int16Array(s.puffer.slice(start, start + b * h * 2))
        : new Uint16Array(s.puffer.slice(start, start + b * h * 2));
    for (let i = 0; i < b * h; i++) werte[z * b * h + i] = roh[i] * steigung + versatz;
  });
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < werte.length; i += 7) {
    if (werte[i] < min) min = werte[i];
    if (werte[i] > max) max = werte[i];
  }
  const modalitaet = t0[0x00080060] ?? "";
  return {
    b, h, t: tiefe, werte,
    abstand: [pixel[1] || 1, pixel[0] || 1, dz], // Pixel Spacing ist „Zeile\Spalte“: erst der Abstand der Zeilen (y)
    name: `DICOM ${modalitaet} (${tiefe} Schichten)`,
    ct: modalitaet === "CT" || (min <= -900 && max > 200), min, max,
  };
}
