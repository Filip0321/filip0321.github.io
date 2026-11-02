// Was aus der Tiefe herauskommt, außer Bildern: Autostereogramm, Tiefenkarte als PNG, Punktwolke als PLY.

// ---------- Autostereogramm ----------
// Das „Magisches Auge“-Bild: ein Muster, das sich waagerecht wiederholt. Schaut man durch das Bild
// hindurch (die Augen parallel), sieht jedes Auge eine andere Wiederholung, und das Gehirn verschmilzt
// sie. Wo der Abstand zweier gleicher Pixel kleiner ist, scheint die Stelle näher.
// Algorithmus von Thimbleby, Inglis und Witten (1994): Für jede Zeile wird für jeden Pixel bestimmt,
// welcher andere Pixel dieselbe Farbe haben MUSS ("same"), weil beide Augen dort denselben Punkt der
// Oberfläche sehen. Danach bekommt jede Kette verbundener Pixel eine Farbe.
// t: Tiefe 0 (fern) bis 1 (nah), muster: ImageData (wird gekachelt) oder null für Zufallspunkte
export function autostereogramm(t, w, h, { augenabstand, tiefe, muster }) {
  const aus = new ImageData(w, h);
  const d = aus.data;
  const E = Math.round(augenabstand); // Augenabstand in Pixeln (etwa die Breite einer Wiederholung)
  const mu = tiefe; // wie weit die Szene vor der Hintergrund-Ebene liegt (0,1 bis 0,4)
  const abstand = (z) => Math.round(((1 - mu * z) * E) / (2 - mu * z));
  let zufall = 1;
  const z = () => ((zufall = (zufall * 1103515245 + 12345) % 2147483648) / 2147483648);
  const same = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) same[x] = x;
    for (let x = 0; x < w; x++) {
      const s = abstand(Math.max(0, t[y * w + x]));
      let links = x - (s >> 1);
      let rechts = links + s;
      if (links < 0 || rechts >= w) continue;
      // links und rechts müssen gleich sein. Ist links schon mit einem anderen verbunden, an der Kette
      // entlang weitergehen, bis die Verbindung passt (so entstehen keine Kreise)
      let k = same[links];
      while (k !== links && k !== rechts) {
        if (k < rechts) links = k;
        else {
          links = rechts;
          rechts = k;
        }
        k = same[links];
      }
      same[links] = rechts;
    }
    for (let x = w - 1; x >= 0; x--) {
      const o = (y * w + x) * 4;
      if (same[x] === x) {
        if (muster) {
          const m = ((y % muster.height) * muster.width + (x % muster.width)) * 4;
          d.set(muster.data.subarray(m, m + 3), o);
        } else {
          const v = z();
          d[o] = v * 255;
          d[o + 1] = z() * 255;
          d[o + 2] = (v * 0.5 + 0.5 * z()) * 255;
        }
      } else {
        const q = (y * w + same[x]) * 4;
        d[o] = d[q];
        d[o + 1] = d[q + 1];
        d[o + 2] = d[q + 2];
      }
      d[o + 3] = 255;
    }
  }
  return aus;
}

// ---------- Tiefenkarte als PNG ----------
// nah = hell. Damit lässt sie sich in Bild zu Ton laden (Tiefe als Ton), in DaVinci als Maske benutzen
// oder in Blender als Displacement.
export function tiefenkarteBild(t, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const bild = ctx.createImageData(w, h);
  for (let i = 0; i < t.length; i++) {
    const v = Math.max(0, t[i]) * 255;
    bild.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(bild, 0, 0);
  return c;
}

// ---------- Punktwolke als PLY ----------
// PLY (Stanford, 1994) ist das einfachste Format für Punktwolken: ein Textkopf, der sagt, was pro Punkt
// gespeichert ist, danach die Punkte binär. Blender öffnet es direkt (Datei → Importieren → Stanford PLY),
// MeshLab und CloudCompare auch. Gleiche Rechnung wie im Shader (WOLKE_VERTEX).
export function plyDatei(t, farben, w, h, { schritt, brennweite, relief, tiefenFaktor }) {
  const punkte = [];
  const seite = w / h;
  for (let y = 0; y < h; y += schritt) {
    for (let x = 0; x < w; x += schritt) {
      const v = t[y * w + x];
      if (v < 0) continue;
      const qx = (x + 0.5) / w - 0.5;
      const qy = -((y + 0.5) / h - 0.5);
      let pos;
      if (relief) pos = [qx * seite, qy, (v - 0.5) * tiefenFaktor];
      else {
        const z = 1 / (1 + (0.25 + 1.5 * v - 1) * tiefenFaktor);
        pos = [(qx * seite) / brennweite * z, (qy / brennweite) * z, 1 - z];
      }
      const i = (y * w + x) * 4;
      punkte.push([...pos, farben[i], farben[i + 1], farben[i + 2]]);
    }
  }
  const kopf = `ply\nformat binary_little_endian 1.0\ncomment Tiefe aus Fotos, filip-winkler.de\nelement vertex ${punkte.length}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  const kopfBytes = new TextEncoder().encode(kopf);
  const puffer = new ArrayBuffer(kopfBytes.length + punkte.length * 15);
  new Uint8Array(puffer).set(kopfBytes);
  const sicht = new DataView(puffer);
  let o = kopfBytes.length;
  for (const p of punkte) {
    // Blender: z ist oben. Darum (x, −z, y): die Wolke steht dort aufrecht vor der Kamera
    sicht.setFloat32(o, p[0], true);
    sicht.setFloat32(o + 4, -p[2], true);
    sicht.setFloat32(o + 8, p[1], true);
    sicht.setUint8(o + 12, p[3]);
    sicht.setUint8(o + 13, p[4]);
    sicht.setUint8(o + 14, p[5]);
    o += 15;
  }
  return new Blob([puffer], { type: "application/octet-stream" });
}
