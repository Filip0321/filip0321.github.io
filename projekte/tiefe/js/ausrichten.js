// Ausrichten: zwei Handfotos liegen nie genau nebeneinander. Das rechte ist ein paar Pixel höher oder
// tiefer, ein bisschen gedreht, ein bisschen größer. Block Matching sucht aber nur waagerecht (in derselben
// Zeile); schon 2 Pixel senkrechter Versatz machen das Ergebnis kaputt.
//
// Vorgehen (alles auf einem kleinen Graubild, ~400 Pixel breit, das genügt und ist schnell):
//   1. Merkpunkte im linken Bild finden: Harris-Ecken. Eine Ecke ist eine Stelle, die sich in JEDE
//      Richtung von ihrer Umgebung unterscheidet (eine Kante nur quer zu sich). Das misst der
//      Strukturtensor aus den Ableitungen Ix, Iy: zwei große Eigenwerte = Ecke.
//   2. Jede Ecke im rechten Bild suchen: kleines Fenster, alle Verschiebungen (dx, dy) in einem Bereich,
//      das ähnlichste nehmen (Summe der absoluten Unterschiede, vorher Mittelwert abgezogen, damit
//      Helligkeitsunterschiede nicht zählen). Nur eindeutige Treffer behalten.
//   3. Aus allen Treffern ein Modell für den senkrechten Versatz: dy = a + b·x + c·y.
//      a = Höhenunterschied, b ≈ Drehung (dreht man, wandert rechts nach unten und links nach oben),
//      c ≈ Größenunterschied. Kleinste Quadrate, danach Ausreißer weg und noch einmal.
//   4. Die waagerechten Verschiebungen dx sind schon Disparitäten: daraus der Suchbereich (dMin, dMax)
//      für das eigentliche Block Matching. Sind fast alle negativ, sind die Fotos vertauscht.

// Graubild in der Breite "breite" (Helligkeit 0 bis 1), y nach unten wie im Canvas
export function graubild(quelle, breite) {
  const hoehe = Math.round((quelle.height * breite) / quelle.width);
  const c = document.createElement("canvas");
  c.width = breite;
  c.height = hoehe;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(quelle, 0, 0, breite, hoehe);
  const d = ctx.getImageData(0, 0, breite, hoehe).data;
  const l = new Float32Array(breite * hoehe);
  for (let i = 0; i < l.length; i++) l[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  return { l, w: breite, h: hoehe };
}

// 1. Harris-Ecken: in jeder Zelle des Gitters die stärkste (damit sie übers Bild verteilt sind)
export function findeEcken({ l, w, h }, zelle = 16) {
  const ix = new Float32Array(w * h);
  const iy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      ix[y * w + x] = l[y * w + x + 1] - l[y * w + x - 1];
      iy[y * w + x] = l[(y + 1) * w + x] - l[(y - 1) * w + x];
    }
  }
  const ecken = [];
  const r = 2; // Strukturtensor über 5 × 5 summiert
  for (let cy = 8; cy < h - 8; cy += zelle) {
    for (let cx = 8; cx < w - 8; cx += zelle) {
      let beste = null;
      for (let y = cy; y < Math.min(cy + zelle, h - 8); y++) {
        for (let x = cx; x < Math.min(cx + zelle, w - 8); x++) {
          let a = 0;
          let b = 0;
          let c = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const i = (y + dy) * w + x + dx;
              a += ix[i] * ix[i];
              b += ix[i] * iy[i];
              c += iy[i] * iy[i];
            }
          }
          const antwort = a * c - b * b - 0.04 * (a + c) ** 2; // det − k·Spur²
          if (!beste || antwort > beste.antwort) beste = { x, y, antwort };
        }
      }
      if (beste && beste.antwort > 1e-4) ecken.push(beste);
    }
  }
  return ecken;
}

// Mittelwert jedes (2r+1)²-Fensters, über ein Integralbild (jede Fenstersumme mit vier Zugriffen)
function fensterMittel({ l, w, h }, r) {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) S[(y + 1) * (w + 1) + x + 1] = l[y * w + x] + S[y * (w + 1) + x + 1] + S[(y + 1) * (w + 1) + x] - S[y * (w + 1) + x];
  }
  const m = new Float32Array(w * h);
  const n = (2 * r + 1) ** 2;
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const x0 = x - r;
      const y0 = y - r;
      const x1 = x + r + 1;
      const y1 = y + r + 1;
      m[y * w + x] = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / n;
    }
  }
  return m;
}

// 2. jede Ecke im rechten Bild suchen
export function findePaare(links, rechts, ecken, { maxDx, maxDy, r = 4 }) {
  const { w, h } = rechts;
  const mL = fensterMittel(links, r);
  const mR = fensterMittel(rechts, r);
  const paare = [];
  for (const e of ecken) {
    const ma = mL[e.y * w + e.x];
    const kosten = (x, y) => {
      const mb = mR[y * w + x];
      let k = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ia = (e.y + dy) * w + e.x;
        const ib = (y + dy) * w + x;
        for (let dx = -r; dx <= r; dx++) k += Math.abs(links.l[ia + dx] - ma - (rechts.l[ib + dx] - mb));
      }
      return k;
    };
    let beste = { kosten: Infinity };
    const alle = [];
    for (let dy = -maxDy; dy <= maxDy; dy++) {
      const y = e.y + dy;
      if (y < r || y >= h - r) continue;
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const x = e.x + dx;
        if (x < r || x >= w - r) continue;
        const k = kosten(x, y);
        alle.push(dx, dy, k);
        if (k < beste.kosten) beste = { dx, dy, kosten: k };
      }
    }
    // eindeutig? Der zweitbeste Treffer (mindestens 2 Pixel entfernt) muss deutlich schlechter sein
    let zweit = Infinity;
    for (let i = 0; i < alle.length; i += 3) {
      if (Math.abs(alle[i] - beste.dx) > 1 || Math.abs(alle[i + 1] - beste.dy) > 1) zweit = Math.min(zweit, alle[i + 2]);
    }
    if (beste.kosten < zweit * 0.8) paare.push({ x: e.x, y: e.y, dx: beste.dx, dy: beste.dy });
  }
  return paare;
}

// 3 × 3 lösen (Cramer), für die kleinsten Quadrate
function loese3(m, v) {
  const det = (q) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return [0, 0, 0];
  return [0, 1, 2].map((k) => det(m.map((zeile, i) => zeile.map((x, j) => (j === k ? v[i] : x)))) / d);
}

// 3. und 4.: Modell für dy und Bereich der Disparität (in Pixeln des kleinen Bildes)
export function passeAn(paare, w, h) {
  let gute = paare;
  let modell = [0, 0, 0];
  for (let runde = 0; runde < 3 && gute.length >= 6; runde++) {
    // Normalgleichungen für dy = a + b·x + c·y, x und y relativ zur Bildmitte
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const v = [0, 0, 0];
    for (const p of gute) {
      const f = [1, p.x - w / 2, p.y - h / 2];
      for (let i = 0; i < 3; i++) {
        v[i] += f[i] * p.dy;
        for (let j = 0; j < 3; j++) m[i][j] += f[i] * f[j];
      }
    }
    modell = loese3(m, v);
    const rest = (p) => Math.abs(p.dy - (modell[0] + modell[1] * (p.x - w / 2) + modell[2] * (p.y - h / 2)));
    const reste = gute.map(rest).sort((a, b) => a - b);
    const grenze = Math.max(1, 2.5 * reste[Math.floor(reste.length / 2)]);
    gute = gute.filter((p) => rest(p) <= grenze);
  }
  // Disparität d = −dx (rechts liegt alles weiter links); Bereich aus dem 2. und 98. Perzentil
  const d = gute.map((p) => -p.dx).sort((a, b) => a - b);
  const bei = (q) => d[Math.min(d.length - 1, Math.floor(q * d.length))] ?? 0;
  return { a: modell[0], b: modell[1], c: modell[2], dMin: bei(0.02), dMax: bei(0.98), anzahl: gute.length, vertauscht: bei(0.5) < 0 };
}

// das rechte Bild senkrecht zurechtrücken: Pixel (x, y) bekommt den Wert von (x, y + dy(x, y)),
// bilinear dazwischen; a, b, c gelten hier für ein Bild der Breite w (schon umgerechnet)
export function richteAus(quelle, w, h, { a, b, c }) {
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(quelle, 0, 0, w, h);
  const ein = sctx.getImageData(0, 0, w, h).data;
  const aus = new ImageData(w, h);
  const d = aus.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const yy = y + a + b * (x - w / 2) + c * (y - h / 2);
      const y0 = Math.floor(yy);
      const t = yy - y0;
      const o = (y * w + x) * 4;
      if (y0 < 0 || y0 + 1 >= h) {
        d[o + 3] = 255;
        continue;
      }
      const i0 = (y0 * w + x) * 4;
      const i1 = i0 + w * 4;
      for (let k = 0; k < 3; k++) d[o + k] = ein[i0 + k] * (1 - t) + ein[i1 + k] * t;
      d[o + 3] = 255;
    }
  }
  return aus;
}
