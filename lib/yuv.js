// VideoFrame -> ImageData, ganz ohne Grafikkarte (der „CPU-Weg“ in dekoder.js).
//
// Ein Videobild liegt fast nie als RGB vor, sondern als YUV: Y ist die Helligkeit in voller Auflösung,
// U und V sind die Farbe (blau minus Helligkeit, rot minus Helligkeit), meist nur in halber Breite und
// halber Höhe ("4:2:0"), weil das Auge Farbe gröber sieht als Helligkeit. Ein 2×2-Feld teilt sich also ein U und ein V.
//   I420  drei Ebenen hintereinander: Y, dann U, dann V
//   NV12  zwei Ebenen: Y, dann U und V abwechselnd (UVUVUV…), so liefern es viele Hardware-Dekoder
//   I422, I444  wie I420, aber mit feinerer Farbe (halbe Breite, volle Höhe / volle Auflösung)
// Umrechnung, z. B. BT.601 im „begrenzten Bereich“ (Y von 16 bis 235, so kodieren Video-Kodierer meist):
//   R = 1,164·(Y−16) + 1,596·(V−128)
//   G = 1,164·(Y−16) − 0,392·(U−128) − 0,813·(V−128)
//   B = 1,164·(Y−16) + 2,017·(U−128)
// Die Zahlen kommen aus Kr und Kb (siehe unten), für BT.709 sind sie etwas anders.

export async function zuBildDaten(bild) {
  const rect = bild.visibleRect;
  const b = rect.width;
  const h = rect.height;
  const puffer = new Uint8Array(bild.allocationSize({ rect }));
  const ebenen = await bild.copyTo(puffer, { rect }); // [{ offset, stride }] pro Ebene
  const aus = new ImageData(b, h);
  const p = aus.data;
  const f = bild.format;

  if (f === "RGBA" || f === "RGBX" || f === "BGRA" || f === "BGRX") {
    const { offset, stride } = ebenen[0];
    const bgr = f[0] === "B";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        const q = offset + y * stride + x * 4;
        const z = (y * b + x) * 4;
        p[z] = puffer[q + (bgr ? 2 : 0)];
        p[z + 1] = puffer[q + 1];
        p[z + 2] = puffer[q + (bgr ? 0 : 2)];
        p[z + 3] = 255;
      }
    }
    return aus;
  }

  // wie grob die Farbe gespeichert ist: um wie viele Bits x und y für U und V verschoben werden
  //   I420 (4:2:0) halbe Breite, halbe Höhe · I422 halbe Breite · I444 volle Auflösung
  const grob = { I420: [1, 1], I420A: [1, 1], NV12: [1, 1], I422: [1, 0], I422A: [1, 0], I444: [0, 0], I444A: [0, 0] }[f];
  if (!grob) throw new Error(`Bildformat ${f} kenne ich nicht`);
  const [sx, sy] = grob;
  const nv12 = f === "NV12";
  // welche Umrechnung: das Bild sagt es selbst (colorSpace). Kr und Kb sind die Anteile von Rot und Blau an
  // der Helligkeit, BT.601 (alte Norm, SD) und BT.709 (HD) unterscheiden sich darin. „Begrenzt“: Y nur von
  // 16 bis 235 und U, V von 16 bis 240, so speichern Kodierer meist; „voll“: 0 bis 255.
  const cs = bild.colorSpace ?? {};
  const [kr, kb] = cs.matrix === "bt709" ? [0.2126, 0.0722] : [0.299, 0.114];
  const kg = 1 - kr - kb;
  const voll = cs.fullRange === true;
  const ys = voll ? 1 : 255 / 219;
  const yo = voll ? 0 : 16;
  const cs2 = voll ? 1 : 255 / 224;
  const rv = 2 * (1 - kr) * cs2;
  const bu = 2 * (1 - kb) * cs2;
  const gu = ((2 * kb * (1 - kb)) / kg) * cs2;
  const gv = ((2 * kr * (1 - kr)) / kg) * cs2;
  const Y = ebenen[0];
  const U = ebenen[1];
  const V = nv12 ? ebenen[1] : ebenen[2];
  // Sonderfall „rgb“ (z. B. VP9 aus gbrp): gar kein YUV, die Ebenen sind einfach Grün, Blau, Rot.
  // Manche Dekoder lassen matrix leer; volle Farbauflösung (I444) mit vollem Bereich ist dann fast immer das
  if (cs.matrix === "rgb" || (!cs.matrix && f.startsWith("I444") && voll)) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        const z = (y * b + x) * 4;
        p[z] = puffer[V.offset + (y >> sy) * V.stride + (x >> sx)];
        p[z + 1] = puffer[Y.offset + y * Y.stride + x];
        p[z + 2] = puffer[U.offset + (y >> sy) * U.stride + (x >> sx)];
        p[z + 3] = 255;
      }
    }
    return aus;
  }
  for (let y = 0; y < h; y++) {
    const zeileY = Y.offset + y * Y.stride;
    const zeileU = U.offset + (y >> sy) * U.stride;
    const zeileV = V.offset + (y >> sy) * V.stride;
    for (let x = 0; x < b; x++) {
      const yy = ys * (puffer[zeileY + x] - yo);
      const xc = x >> sx;
      const u = (nv12 ? puffer[zeileU + xc * 2] : puffer[zeileU + xc]) - 128;
      const v = (nv12 ? puffer[zeileV + xc * 2 + 1] : puffer[zeileV + xc]) - 128;
      const z = (y * b + x) * 4;
      p[z] = yy + rv * v; // Uint8ClampedArray rundet und schneidet bei 0 und 255 selbst ab
      p[z + 1] = yy - gu * u - gv * v;
      p[z + 2] = yy + bu * u;
      p[z + 3] = 255;
    }
  }
  return aus;
}

// mittlere Helligkeit eines Canvas (0 bis 255), grob über 32×32 Punkte: „ist das Bild schwarz?“
export function helligkeit(quelle) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(quelle, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let summe = 0;
  for (let i = 0; i < d.length; i += 4) summe += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return summe / (d.length / 4);
}
