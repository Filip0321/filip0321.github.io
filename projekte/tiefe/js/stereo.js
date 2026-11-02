// Stereo auf der CPU: vorbereiten (vor dem Block Matching) und aufräumen (danach).
// Das Block Matching selbst rechnet die Grafikkarte (shader.js MATCH, gpu.js rechneDisparitaet).

// Vorher: Helligkeit minus Mittel der Umgebung (Fenster (2r+1)²). Zwei Fotos sind nie gleich hell
// belichtet; ein fester Helligkeitsunterschied verschwindet so, übrig bleibt die Struktur.
export function ohneMittel({ l, w, h }, r) {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) S[(y + 1) * (w + 1) + x + 1] = l[y * w + x] + S[y * (w + 1) + x + 1] + S[(y + 1) * (w + 1) + x] - S[y * (w + 1) + x];
  }
  const aus = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const summe = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
      aus[y * w + x] = l[y * w + x] - summe / ((x1 - x0) * (y1 - y0));
    }
  }
  return { l: aus, w, h };
}

// Danach:
//   1. Links-Rechts-Prüfung: dieselbe Rechnung mit dem rechten Foto als Referenz. Ein Pixel ist nur
//      glaubwürdig, wenn beide Richtungen dasselbe sagen. Wo nicht, ist er meist verdeckt: hinter einer
//      Kante sieht nur ein Auge den Hintergrund.
//   2. Eindeutigkeit: liegt die zweitbeste Disparität fast gleich gut, war es geraten (glatte Flächen,
//      Wiederholungen).
//   3. Löcher füllen: Zeile für Zeile mit dem kleineren der beiden Nachbarn (kleinere Disparität = weiter
//      weg). Verdeckte Stellen gehören fast immer zum Hintergrund.
//   4. Median im Fenster: einzelne Ausreißer verschwinden, Kanten bleiben (anders als beim Weichzeichnen).
// links, rechts: Ergebnis von rechneDisparitaet (4 Werte pro Pixel), rechts darf null sein (drei Fotos)
export function raeumeAuf(links, rechts, w, h, { eindeutigkeit, median, fuellen }) {
  const d = new Float32Array(w * h);
  const gueltig = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    d[i] = links[i * 4];
    const beste = links[i * 4 + 1];
    const zweit = links[i * 4 + 2];
    gueltig[i] = zweit >= 1e8 || beste <= zweit * eindeutigkeit ? 1 : 0;
  }
  if (rechts) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const xr = Math.round(x - d[i]);
        if (xr < 0 || xr >= w || Math.abs(rechts[(y * w + xr) * 4] - d[i]) > 1) gueltig[i] = 0;
      }
    }
  }
  const gefuellt = Float32Array.from(d);
  if (fuellen) {
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (gueltig[y * w + x]) {
          x++;
          continue;
        }
        const anfang = x;
        while (x < w && !gueltig[y * w + x]) x++;
        const links_ = anfang > 0 ? d[y * w + anfang - 1] : Infinity;
        const rechts_ = x < w ? d[y * w + x] : Infinity;
        const wert = Math.min(links_, rechts_);
        for (let k = anfang; k < x; k++) gefuellt[y * w + k] = Number.isFinite(wert) ? wert : 0;
      }
    }
  }
  const glatt = median > 0 ? medianFilter(gefuellt, w, h, median) : gefuellt;
  return { d: glatt, gueltig, w, h };
}

function medianFilter(werte, w, h, r) {
  const aus = new Float32Array(w * h);
  const fenster = new Float32Array((2 * r + 1) ** 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) fenster[n++] = werte[yy * w + Math.min(w - 1, Math.max(0, x + dx))];
      }
      const teil = fenster.subarray(0, n).sort();
      aus[y * w + x] = teil[n >> 1];
    }
  }
  return aus;
}

// auf 0 (fern) bis 1 (nah) bringen, nach dem 1. und 99. Perzentil (einzelne Ausreißer bestimmen sonst
// die ganze Skala); ungültige Pixel werden −1, wenn sie nicht gefüllt werden sollen
export function normiere({ d, gueltig, w, h }, { ungueltigZeigen }) {
  const sortiert = Float32Array.from(d).sort();
  const lo = sortiert[Math.floor(sortiert.length * 0.01)];
  const hi = sortiert[Math.floor(sortiert.length * 0.99)];
  const t = new Float32Array(w * h);
  for (let i = 0; i < t.length; i++) t[i] = ungueltigZeigen && !gueltig[i] ? -1 : Math.min(1, Math.max(0, (d[i] - lo) / Math.max(hi - lo, 1e-3)));
  return { t, lo, hi };
}
