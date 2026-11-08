// Flecken finden und verfolgen, reine Rechnung auf den Pixeln (CPU). Benutzt vom Effekt Blob-Tracking
// (/lib/effekte/blobs.js, dort steht die ganze Erklärung der fünf Schritte) und von Video zu Ton (Flecken als
// Stimmen). Eigene Datei, damit Video zu Ton nicht die ganze Effekt-Sammlung laden muss.
//
// bild: { width, height, data } wie ImageData
// w: { art (0 hell, 1 dunkel, 2 Bewegung, 3 nur eigene), schwelle, gedaechtnis, zusammen, kleinste (% der
//      Fläche), anzahl, spur }
// g: Gedächtnis von neuesGedaechtnis(), eins pro Verfolgung
// eigeneFlecken(bild): feste Rechtecke, die wie Flecken zählen (beim Effekt von Hand gezogen)
// Zurück: [{ id, x, y, x0, y0, x1, y1, flaeche }] in Pixeln des Bildes, die größten zuerst

const MAX_BREITE = 240;

export const neuesGedaechtnis = () => ({ hintergrund: null, alte: [], naechsteId: 1, spuren: new Map() });

export function findeFlecken(bild, w, g, eigeneFlecken = () => []) {
  if (w.art > 2.5) return eigeneFlecken(bild); // nur eigene Rechtecke
  const f = Math.min(1, MAX_BREITE / bild.width);
  const b = Math.max(1, Math.round(bild.width * f));
  const h = Math.max(1, Math.round(bild.height * f));
  const sx = bild.width / b;
  const sy = bild.height / h;
  // Helligkeit, verkleinert (nächster Pixel genügt)
  const hell = new Float32Array(b * h);
  const d = bild.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < b; x++) {
      const i = (Math.floor(y * sy) * bild.width + Math.floor(x * sx)) * 4;
      hell[y * b + x] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
  }
  // Maske
  const maske = new Uint8Array(b * h);
  const art = w.art;
  if (!g.hintergrund || g.hintergrund.length !== hell.length) g.hintergrund = Float32Array.from(hell);
  const hintergrund = g.hintergrund;
  for (let i = 0; i < hell.length; i++) {
    if (art < 0.5) maske[i] = hell[i] > w.schwelle ? 1 : 0;
    else if (art < 1.5) maske[i] = hell[i] < w.schwelle ? 1 : 0;
    else {
      maske[i] = Math.abs(hell[i] - hintergrund[i]) > w.schwelle * 0.3 ? 1 : 0;
      hintergrund[i] += (hell[i] - hintergrund[i]) * w.gedaechtnis;
    }
  }
  // zusammenfassen: dicker machen (erst waagerecht, dann senkrecht: ein Quadrat mit Radius r)
  const r = Math.round(w.zusammen);
  if (r > 0) {
    const zw = new Uint8Array(b * h);
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = -r; x < b; x++) {
        if (x + r < b) n += maske[y * b + x + r];
        if (x - r - 1 >= 0) n -= maske[y * b + x - r - 1];
        if (x >= 0) zw[y * b + x] = n > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < b; x++) {
      let n = 0;
      for (let y = -r; y < h; y++) {
        if (y + r < h) n += zw[(y + r) * b + x];
        if (y - r - 1 >= 0) n -= zw[(y - r - 1) * b + x];
        if (y >= 0) maske[y * b + x] = n > 0 ? 1 : 0;
      }
    }
  }
  // Flecken einsammeln (Flutfüllung mit eigenem Stapel, Rekursion wäre bei großen Flecken zu tief)
  const besucht = new Uint8Array(b * h);
  const stapel = new Int32Array(b * h);
  const flecken = [];
  const kleinste = w.kleinste * 0.01 * b * h;
  for (let start = 0; start < b * h; start++) {
    if (!maske[start] || besucht[start]) continue;
    let oben = 0;
    stapel[oben++] = start;
    besucht[start] = 1;
    let n = 0, sx_ = 0, sy_ = 0, x0 = b, y0 = h, x1 = 0, y1 = 0;
    while (oben > 0) {
      const i = stapel[--oben];
      const x = i % b;
      const y = (i - x) / b;
      n++;
      sx_ += x;
      sy_ += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < b - 1 ? i + 1 : -1, y > 0 ? i - b : -1, y < h - 1 ? i + b : -1]) {
        if (j >= 0 && maske[j] && !besucht[j]) {
          besucht[j] = 1;
          stapel[oben++] = j;
        }
      }
    }
    if (n < Math.max(2, kleinste)) continue;
    // zurück in volle Größe (die Dilatation hat den Rahmen um r größer gemacht: wieder abziehen)
    flecken.push({
      x: ((sx_ / n) + 0.5) * sx,
      y: ((sy_ / n) + 0.5) * sy,
      x0: Math.max(0, x0 + r) * sx,
      y0: Math.max(0, y0 + r) * sy,
      x1: Math.min(b, x1 + 1 - r) * sx,
      y1: Math.min(h, y1 + 1 - r) * sy,
      flaeche: n / (b * h),
    });
  }
  flecken.sort((p, q) => q.flaeche - p.flaeche);
  flecken.length = Math.min(flecken.length, Math.round(w.anzahl));
  for (const p of flecken) {
    if (p.x1 <= p.x0) [p.x0, p.x1] = [p.x - sx, p.x + sx];
    if (p.y1 <= p.y0) [p.y0, p.y1] = [p.y - sy, p.y + sy];
  }

  // wiedererkennen: gierig, die nächsten Paare zuerst
  const weit = 0.15 * Math.hypot(bild.width, bild.height);
  const paare = [];
  const alte = g.alte;
  flecken.forEach((p, i) => alte.forEach((a, k) => paare.push([Math.hypot(p.x - a.x, p.y - a.y), i, k])));
  paare.sort((a, c) => a[0] - c[0]);
  const vergeben = new Set();
  for (const [abstand, i, k] of paare) {
    if (abstand > weit) break;
    if (flecken[i].id || vergeben.has(k)) continue;
    flecken[i].id = alte[k].id;
    vergeben.add(k);
  }
  for (const p of flecken) p.id ??= g.naechsteId++;
  if (g.naechsteId > 999) g.naechsteId = 1;
  g.alte = flecken.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  flecken.push(...eigeneFlecken(bild)); // eigene Rechtecke dazu (sie werden nicht wiedererkannt, sie stehen)
  // Spuren
  const spuren = g.spuren;
  const da = new Set(flecken.map((p) => p.id));
  for (const id of [...spuren.keys()]) if (!da.has(id)) spuren.delete(id);
  for (const p of flecken) {
    const s = spuren.get(p.id) ?? [];
    s.push([p.x, p.y]);
    if (s.length > w.spur) s.splice(0, s.length - w.spur);
    spuren.set(p.id, s);
  }
  return flecken;
}
