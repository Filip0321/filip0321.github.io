// Linien und Geometrie (und was sonst auf der CPU rechnet): Höhenlinien, Gravur, Delaunay, Quadtree,
// Atkinson und Blue Noise, Pixel Sorting, Farb-Vorhang.
// Diese Effekte sind keine Shader: Sie brauchen Nachbarschaften über das ganze Bild (Sortieren, Fehler
// weiterreichen, Dreiecke bauen) oder zeichnen Linien. Darum Canvas und Schleifen über ImageData.
// Für Videos sind sie langsamer als Shader, aber der Export rechnet ohnehin Bild für Bild.

import { leinwand } from "./hilfen.js";

const GRUPPE = "Linien und Geometrie";

// Helligkeit jedes Pixels (0 bis 1), optional auf jedes k-te Pixel verkleinert (gemittelt)
function helligkeiten(bild, k = 1) {
  const w = Math.ceil(bild.width / k);
  const h = Math.ceil(bild.height / k);
  const l = new Float32Array(w * h);
  const d = bild.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let yy = y * k; yy < Math.min((y + 1) * k, bild.height); yy++) {
        for (let xx = x * k; xx < Math.min((x + 1) * k, bild.width); xx++) {
          const i = (yy * bild.width + xx) * 4;
          s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
      }
      l[y * w + x] = s / n;
    }
  }
  return { l, w, h };
}

// Hintergrund für Linienbilder: das Bild selbst, Papier oder Schwarz
function grund(ctx, bild, art) {
  if (art === 0) ctx.putImageData(bild, 0, 0);
  else {
    ctx.fillStyle = art === 1 ? "#f3efe4" : "#0d0d0d";
    ctx.fillRect(0, 0, bild.width, bild.height);
  }
  return art === 2 ? "#f3efe4" : "#141414";
}

const HINTERGRUND = { name: "grund", text: "Hintergrund", auswahl: ["Bild", "Papier", "Schwarz"], wert: 1 };

// ---------- Höhenlinien (Marching Squares) ----------
// Das Bild als Landkarte: Helligkeit = Höhe. Für jede Höhe h wird in jedem Quadrat aus vier Gitterpunkten
// geschaut, welche Ecken über h liegen (4 Bit = 16 Fälle). Daraus folgt, welche Kanten die Linie schneidet,
// und wo genau auf der Kante (lineare Interpolation). Dasselbe in 3D heißt Marching Cubes.
const HOEHENLINIEN = {
  id: "hoehenlinien",
  name: "Höhenlinien",
  gruppe: GRUPPE,
  cpu(bild, w) {
    const k = Math.max(1, Math.round(w.abstand));
    const { l, w: gw, h: gh } = helligkeiten(bild, k);
    // leicht glätten, sonst zittern die Linien
    const g = new Float32Array(l.length);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) {
              s += l[yy * gw + xx];
              n++;
            }
          }
        }
        g[y * gw + x] = s / n;
      }
    }
    const { c, ctx } = leinwand(bild.width, bild.height);
    const linie = grund(ctx, bild, w.grund);
    ctx.lineWidth = w.dicke;
    ctx.lineCap = "round";
    const stufen = Math.round(w.linien);
    for (let s = 1; s <= stufen; s++) {
      const hoehe = s / (stufen + 1);
      ctx.strokeStyle = w.farbig ? `hsl(${(1 - hoehe) * 260}, 80%, ${w.grund === 2 ? 60 : 40}%)` : linie;
      ctx.beginPath();
      for (let y = 0; y < gh - 1; y++) {
        for (let x = 0; x < gw - 1; x++) {
          const a = g[y * gw + x];
          const b = g[y * gw + x + 1];
          const cc = g[(y + 1) * gw + x + 1];
          const d = g[(y + 1) * gw + x];
          const fall = (a > hoehe ? 8 : 0) | (b > hoehe ? 4 : 0) | (cc > hoehe ? 2 : 0) | (d > hoehe ? 1 : 0);
          if (fall === 0 || fall === 15) continue;
          // Schnittpunkte auf den vier Kanten (oben, rechts, unten, links), in Pixeln
          const t = (p, q) => (hoehe - p) / (q - p);
          const punkt = {
            o: [(x + t(a, b)) * k, y * k],
            r: [(x + 1) * k, (y + t(b, cc)) * k],
            u: [(x + t(d, cc)) * k, (y + 1) * k],
            l: [x * k, (y + t(a, d)) * k],
          };
          // welche Kanten verbunden werden (die zwei Sattelfälle 5 und 10 bekommen zwei Linien)
          const paare = { 1: ["l", "u"], 2: ["u", "r"], 3: ["l", "r"], 4: ["o", "r"], 5: ["l", "o", "u", "r"], 6: ["o", "u"], 7: ["l", "o"], 8: ["l", "o"], 9: ["o", "u"], 10: ["l", "u", "o", "r"], 11: ["o", "r"], 12: ["l", "r"], 13: ["u", "r"], 14: ["l", "u"] }[fall];
          for (let i = 0; i < paare.length; i += 2) {
            ctx.moveTo(...punkt[paare[i]]);
            ctx.lineTo(...punkt[paare[i + 1]]);
          }
        }
      }
      ctx.stroke();
    }
    return ctx.getImageData(0, 0, c.width, c.height);
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "linien", text: "Linien", min: 3, max: 60, schritt: 1, wert: 16 },
        { name: "abstand", text: "Gitter (px)", min: 1, max: 12, schritt: 1, wert: 3 },
        { name: "dicke", text: "Dicke", min: 0.5, max: 4, schritt: 0.1, wert: 1.2 },
        { name: "farbig", text: "Farbe", auswahl: ["eine", "nach Höhe"], wert: 0 },
        HINTERGRUND,
      ],
    },
  ],
};

// ---------- Gravur ----------
// Wie ein Kupferstich: Linien laufen entlang der Kanten (quer zum Helligkeitsgefälle aus Sobel) und sind
// dort dicker, wo das Bild dunkel ist. Jede Linie startet auf einem Gitter und folgt Schritt für Schritt
// dem Feld der Kantenrichtungen (eine Strömungslinie, wie ein Blatt auf Wasser).
const GRAVUR = {
  id: "gravur",
  name: "Gravur",
  gruppe: GRUPPE,
  cpu(bild, w) {
    const k = 2;
    const { l, w: gw, h: gh } = helligkeiten(bild, k);
    const hol = (x, y) => l[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];
    // Richtung entlang der Kante an einer Stelle (Sobel um 90° gedreht), geglättet über die Nachbarn
    function richtung(px, py) {
      const x = Math.round(px / k);
      const y = Math.round(py / k);
      let gx = 0;
      let gy = 0;
      for (let d = 1; d <= 3; d++) {
        gx += hol(x + d, y) - hol(x - d, y);
        gy += hol(x, y + d) - hol(x, y - d);
      }
      const n = Math.hypot(gx, gy);
      return n < 1e-4 ? [1, 0] : [-gy / n, gx / n];
    }
    const { c, ctx } = leinwand(bild.width, bild.height);
    const linie = grund(ctx, bild, w.grund);
    ctx.strokeStyle = linie;
    ctx.lineCap = "round";
    const abstand = w.abstand;
    const schritte = Math.round(w.laenge);
    // Striche nach Dicke in 8 Töpfe sortieren und jeden Topf auf einmal zeichnen: zehntausende einzelne
    // stroke()-Aufrufe wären sehr langsam
    const TOEPFE = 8;
    const pfade = Array.from({ length: TOEPFE }, () => new Path2D());
    for (let sy = abstand / 2; sy < bild.height; sy += abstand) {
      for (let sx = abstand / 2; sx < bild.width; sx += abstand) {
        // ein wenig Zufall im Start, sonst sieht man das Gitter
        let x = sx + (Math.sin(sx * 12.9 + sy * 78.2) * 0.5) * abstand;
        let y = sy + (Math.sin(sx * 39.3 + sy * 11.1) * 0.5) * abstand;
        let [vx, vy] = richtung(x, y);
        for (let i = 0; i < schritte; i++) {
          const dunkel = 1 - hol(Math.round(x / k), Math.round(y / k));
          const [rx, ry] = richtung(x, y);
          if (rx * vx + ry * vy < 0) [vx, vy] = [-rx, -ry]; // nicht umdrehen
          else [vx, vy] = [rx, ry];
          const nx = x + vx * 2;
          const ny = y + vy * 2;
          if (dunkel > 0.08) {
            const topf = pfade[Math.min(TOEPFE - 1, Math.floor(dunkel * TOEPFE))];
            topf.moveTo(x, y);
            topf.lineTo(nx, ny);
          }
          x = nx;
          y = ny;
        }
      }
    }
    pfade.forEach((pfad, i) => {
      ctx.lineWidth = ((i + 0.5) / TOEPFE) * abstand * w.dicke * 0.6;
      ctx.stroke(pfad);
    });
    return ctx.getImageData(0, 0, c.width, c.height);
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "abstand", text: "Abstand (px)", min: 3, max: 24, schritt: 1, wert: 7 },
        { name: "laenge", text: "Länge", min: 2, max: 40, schritt: 1, wert: 12 },
        { name: "dicke", text: "Dicke", min: 0.2, max: 2, schritt: 0.05, wert: 1 },
        HINTERGRUND,
      ],
    },
  ],
};

// ---------- Delaunay ----------
// Punkte, vor allem auf Kanten, werden zu Dreiecken verbunden, und zwar so, dass in keinem Umkreis eines
// Dreiecks ein anderer Punkt liegt (Delaunay: möglichst „runde“ Dreiecke). Bowyer-Watson: Punkt für Punkt
// einfügen; alle Dreiecke, in deren Umkreis er liegt, fliegen raus; das Loch wird mit Dreiecken zum neuen
// Punkt gefüllt. Gefüllt wird jedes Dreieck mit der Farbe in seiner Mitte.
function delaunay(punkte, breite, hoehe) {
  const m = Math.max(breite, hoehe) * 10;
  const alle = [...punkte, [-m, -m], [m * 2, -m], [-m, m * 2]]; // ein riesiges Dreieck um alles
  const n = punkte.length;
  let dreiecke = [umkreis(alle, n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = alle[i];
    const kanten = new Map();
    const bleiben = [];
    for (const d of dreiecke) {
      if ((px - d.x) ** 2 + (py - d.y) ** 2 < d.r2) {
        // Kanten merken; eine Kante, die zwei entfernte Dreiecke teilen, liegt innen und fällt weg
        for (const [a, b] of [[d.a, d.b], [d.b, d.c], [d.c, d.a]]) {
          const schluessel = a < b ? `${a},${b}` : `${b},${a}`;
          if (kanten.has(schluessel)) kanten.delete(schluessel);
          else kanten.set(schluessel, [a, b]);
        }
      } else bleiben.push(d);
    }
    for (const [a, b] of kanten.values()) bleiben.push(umkreis(alle, a, b, i));
    dreiecke = bleiben;
  }
  return dreiecke.filter((d) => d.a < n && d.b < n && d.c < n).map((d) => [alle[d.a], alle[d.b], alle[d.c]]);
}

function umkreis(p, a, b, c) {
  const [ax, ay] = p[a];
  const [bx, by] = p[b];
  const [cx, cy] = p[c];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9;
  const x = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const y = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { a, b, c, x, y, r2: (ax - x) ** 2 + (ay - y) ** 2 };
}

const DELAUNAY = {
  id: "delaunay",
  name: "Delaunay-Dreiecke",
  gruppe: GRUPPE,
  cpu(bild, w) {
    const b = bild.width;
    const h = bild.height;
    const k = 2;
    const { l, w: gw, h: gh } = helligkeiten(bild, k);
    // Kantenstärke pro Gitterpunkt; Punkte bevorzugt dort
    const kanten = [];
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const gx = l[y * gw + x + 1] - l[y * gw + x - 1];
        const gy = l[(y + 1) * gw + x] - l[(y - 1) * gw + x];
        kanten.push([Math.hypot(gx, gy), x * k, y * k]);
      }
    }
    kanten.sort((p, q) => q[0] - p[0]);
    const anzahl = Math.round(w.punkte);
    const vonKanten = Math.round(anzahl * w.kantenanteil);
    const punkte = [[0, 0], [b - 1, 0], [0, h - 1], [b - 1, h - 1]];
    // von den stärksten Kanten zufällig auswählen (aus dem besten Fünftel), Rest gleichmäßig zufällig
    let zufall = 12345;
    const z = () => ((zufall = (zufall * 1103515245 + 12345) % 2147483648) / 2147483648);
    const besten = kanten.slice(0, Math.max(1, Math.floor(kanten.length / 5)));
    for (let i = 0; i < vonKanten; i++) {
      const p = besten[Math.floor(z() * besten.length)];
      punkte.push([p[1], p[2]]);
    }
    for (let i = vonKanten; i < anzahl; i++) punkte.push([z() * b, z() * h]);
    const dreiecke = delaunay(punkte, b, h);
    const { c, ctx } = leinwand(b, h);
    ctx.putImageData(bild, 0, 0);
    const d = bild.data;
    const farbeBei = (x, y) => {
      const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * b + Math.min(b - 1, Math.max(0, Math.round(x)))) * 4;
      return `rgb(${d[i]}, ${d[i + 1]}, ${d[i + 2]})`;
    };
    ctx.lineJoin = "round";
    for (const [p, q, r] of dreiecke) {
      ctx.beginPath();
      ctx.moveTo(...p);
      ctx.lineTo(...q);
      ctx.lineTo(...r);
      ctx.closePath();
      const f = farbeBei((p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3);
      if (w.darstellung !== 1) {
        ctx.fillStyle = f;
        ctx.fill();
        ctx.strokeStyle = f; // gegen helle Spalten zwischen den Dreiecken
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (w.darstellung !== 0) {
        ctx.strokeStyle = w.darstellung === 1 ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.5)";
        ctx.lineWidth = Math.max(1, b / 1200);
        ctx.stroke();
      }
    }
    if (w.darstellung === 1) {
      // nur das Netz: über das abgedunkelte Bild
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, b, h);
      ctx.globalCompositeOperation = "source-over";
    }
    return ctx.getImageData(0, 0, b, h);
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "punkte", text: "Punkte", min: 50, max: 4000, schritt: 10, wert: 1200 },
        { name: "kantenanteil", text: "Anteil auf Kanten", min: 0, max: 1, schritt: 0.01, wert: 0.7 },
        { name: "darstellung", text: "Darstellung", auswahl: ["gefüllt", "nur Netz", "gefüllt mit Netz"], wert: 0 },
      ],
    },
  ],
};

// ---------- Quadtree ----------
// Ein Quadrat wird in vier geteilt, solange die Farben darin zu verschieden sind (Varianz über der Schwelle)
// und es noch größer als das kleinste erlaubte ist. Ruhige Flächen bleiben große Kacheln, Details werden fein.
// Die Summen kommen aus „Integralbildern“: Summe in jedem Rechteck mit vier Zugriffen, egal wie groß.
const QUADTREE = {
  id: "quadtree",
  name: "Quadtree",
  gruppe: GRUPPE,
  cpu(bild, w) {
    const b = bild.width;
    const h = bild.height;
    const d = bild.data;
    // Integralbilder für r, g, b und r² + g² + b²
    const S = [0, 1, 2, 3].map(() => new Float64Array((b + 1) * (h + 1)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        const i = (y * b + x) * 4;
        const werte = [d[i], d[i + 1], d[i + 2], d[i] * d[i] + d[i + 1] * d[i + 1] + d[i + 2] * d[i + 2]];
        const o = (y + 1) * (b + 1) + x + 1;
        for (let k = 0; k < 4; k++) S[k][o] = werte[k] + S[k][o - 1] + S[k][o - b - 1] - S[k][o - b - 2];
      }
    }
    const summe = (k, x0, y0, x1, y1) => S[k][y1 * (b + 1) + x1] - S[k][y0 * (b + 1) + x1] - S[k][y1 * (b + 1) + x0] + S[k][y0 * (b + 1) + x0];
    const { c, ctx } = leinwand(b, h);
    const schwelle = (w.schwelle * 60) ** 2;
    const kleinste = w.kleinste;
    function teile(x0, y0, x1, y1) {
      const n = (x1 - x0) * (y1 - y0);
      if (n <= 0) return;
      const m = [0, 1, 2].map((k) => summe(k, x0, y0, x1, y1) / n);
      const varianz = summe(3, x0, y0, x1, y1) / n - (m[0] ** 2 + m[1] ** 2 + m[2] ** 2);
      if (varianz > schwelle && x1 - x0 > kleinste && y1 - y0 > kleinste) {
        const xm = Math.floor((x0 + x1) / 2);
        const ym = Math.floor((y0 + y1) / 2);
        teile(x0, y0, xm, ym);
        teile(xm, y0, x1, ym);
        teile(x0, ym, xm, y1);
        teile(xm, ym, x1, y1);
        return;
      }
      ctx.fillStyle = `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (w.linien) {
        ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      }
    }
    teile(0, 0, b, h);
    return ctx.getImageData(0, 0, b, h);
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "schwelle", text: "Schwelle", min: 0.05, max: 1.5, schritt: 0.01, wert: 0.4 },
        { name: "kleinste", text: "Kleinste Kachel (px)", min: 2, max: 64, schritt: 1, wert: 4 },
        { name: "linien", text: "Linien", auswahl: ["aus", "an"], wert: 1 },
      ],
    },
  ],
};

// ---------- Atkinson und Blue Noise ----------
// Atkinson (Bill Atkinson, Apple Macintosh 1984): wie Floyd-Steinberg wird der Rundungsfehler an Nachbarn
// weitergereicht, aber nur 6/8 davon, an sechs Nachbarn je 1/8. Der Rest geht verloren: Lichter und
// Schatten „laufen aus“, der Kontrast wird härter, typisch für frühe Mac-Bilder.
// Blue Noise: eine Schwellen-Textur wie Bayer, aber ohne Muster. Die Punkte sind so verteilt, dass keine
// zwei zu nah beieinander liegen (nur hohe Frequenzen, daher „blau“). Erzeugt mit Void-and-Cluster
// (Ulichney 1993): immer den Punkt aus dem dichtesten Haufen in das größte Loch setzen, dann jedem Pixel
// einen Rang geben.
let blauesRauschen = null;
const BLAU = 64;

function erzeugeBlauesRauschen() {
  const n = BLAU * BLAU;
  const sigma = 1.5;
  // Gauß-Kern auf dem Torus (das Muster soll nahtlos kacheln)
  const kern = new Float32Array(n);
  for (let y = 0; y < BLAU; y++) {
    for (let x = 0; x < BLAU; x++) {
      const dx = Math.min(x, BLAU - x);
      const dy = Math.min(y, BLAU - y);
      kern[y * BLAU + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  const muster = new Uint8Array(n);
  const energie = new Float32Array(n);
  const setze = (i, wert) => {
    muster[i] = wert;
    const px = i % BLAU;
    const py = Math.floor(i / BLAU);
    const v = wert ? 1 : -1;
    for (let y = 0; y < BLAU; y++) {
      for (let x = 0; x < BLAU; x++) energie[y * BLAU + x] += v * kern[((y - py + BLAU) % BLAU) * BLAU + ((x - px + BLAU) % BLAU)];
    }
  };
  const extrem = (gesetzt, groesster) => {
    let beste = -1;
    for (let i = 0; i < n; i++) {
      if (muster[i] !== gesetzt) continue;
      if (beste < 0 || (groesster ? energie[i] > energie[beste] : energie[i] < energie[beste])) beste = i;
    }
    return beste;
  };
  // 1. zufälliger Anfang mit 10 % Punkten, dann so lange umsetzen, bis es gleichmäßig ist
  let s = 7;
  const z = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const anfang = Math.floor(n * 0.1);
  for (let k = 0; k < anfang; k++) {
    let i;
    do i = Math.floor(z() * n);
    while (muster[i]);
    setze(i, 1);
  }
  for (let runde = 0; runde < n; runde++) {
    const haufen = extrem(1, true);
    setze(haufen, 0);
    const loch = extrem(0, false);
    if (loch === haufen) {
      setze(haufen, 1);
      break;
    }
    setze(loch, 1);
  }
  // 2. Ränge: aus dem Anfangsmuster nacheinander die dichtesten entfernen (Ränge abwärts),
  //    dann die größten Löcher füllen (Ränge aufwärts)
  const rang = new Float32Array(n);
  const start = Uint8Array.from(muster);
  const startEnergie = Float32Array.from(energie);
  const einsen = muster.reduce((a, b) => a + b, 0);
  for (let r = einsen - 1; r >= 0; r--) {
    const i = extrem(1, true);
    setze(i, 0);
    rang[i] = r;
  }
  muster.set(start);
  energie.set(startEnergie);
  for (let r = einsen; r < n; r++) {
    const i = extrem(0, false);
    setze(i, 1);
    rang[i] = r;
  }
  return rang.map((r) => (r + 0.5) / n);
}

const DITHER2 = {
  id: "dither2",
  name: "Atkinson und Blue Noise",
  gruppe: GRUPPE,
  cpu(bild, w) {
    const b = bild.width;
    const h = bild.height;
    const ein = bild.data;
    const aus = new ImageData(b, h);
    const d = aus.data;
    const stufen = Math.max(1, Math.round(w.stufen) - 1);
    const grau = w.grau === 1;
    if (w.art === 1) {
      blauesRauschen ??= erzeugeBlauesRauschen();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < b; x++) {
          const i = (y * b + x) * 4;
          const schwelle = blauesRauschen[(y % BLAU) * BLAU + (x % BLAU)] - 0.5;
          const l = (0.2126 * ein[i] + 0.7152 * ein[i + 1] + 0.0722 * ein[i + 2]) / 255;
          for (let k = 0; k < 3; k++) {
            const v = grau ? l : ein[i + k] / 255;
            d[i + k] = (Math.min(stufen, Math.max(0, Math.floor(v * stufen + schwelle + 0.5))) / stufen) * 255;
          }
          d[i + 3] = ein[i + 3];
        }
      }
      return aus;
    }
    // Atkinson: Fehler an (x+1), (x+2), (x−1, y+1), (x, y+1), (x+1, y+1), (x, y+2), je 1/8
    const kanaele = grau ? 1 : 3;
    const v = new Float32Array(b * h * kanaele);
    for (let p = 0; p < b * h; p++) {
      const i = p * 4;
      if (grau) v[p] = (0.2126 * ein[i] + 0.7152 * ein[i + 1] + 0.0722 * ein[i + 2]) / 255;
      else for (let k = 0; k < 3; k++) v[p * 3 + k] = ein[i + k] / 255;
    }
    const nachbarn = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        for (let k = 0; k < kanaele; k++) {
          const p = (y * b + x) * kanaele + k;
          const alt = v[p];
          const neu = Math.min(stufen, Math.max(0, Math.round(alt * stufen))) / stufen;
          v[p] = neu;
          const fehler = (alt - neu) / 8;
          for (const [dx, dy] of nachbarn) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && xx < b && yy < h) v[(yy * b + xx) * kanaele + k] += fehler;
          }
        }
        const i = (y * b + x) * 4;
        for (let k = 0; k < 3; k++) d[i + k] = v[(y * b + x) * kanaele + (grau ? 0 : k)] * 255;
        d[i + 3] = ein[i + 3];
      }
    }
    return aus;
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "art", text: "Art", auswahl: ["Atkinson", "Blue Noise"], wert: 0 },
        { name: "stufen", text: "Stufen", min: 2, max: 8, schritt: 1, wert: 2 },
        { name: "grau", text: "Farbe", auswahl: ["bunt", "grau"], wert: 1 },
      ],
    },
  ],
};

// ---------- Pixel Sorting ----------
// In jeder Spalte (oder Zeile) werden zusammenhängende Strecken gesucht, deren Helligkeit zwischen
// „unten“ und „oben“ liegt, und die Pixel darin nach Helligkeit sortiert. Was außerhalb liegt (sehr
// dunkel, sehr hell), bleibt stehen und begrenzt die Strecken: deshalb tropft das Bild nur stellenweise.
const PIXELSORT = {
  id: "pixelsort",
  name: "Pixel Sorting",
  gruppe: "Pixel und Druck",
  cpu(bild, w) {
    const b = bild.width;
    const h = bild.height;
    const aus = new ImageData(new Uint8ClampedArray(bild.data), b, h);
    const d = aus.data;
    const senkrecht = w.richtung === 0;
    const reihen = senkrecht ? b : h;
    const laenge = senkrecht ? h : b;
    const index = (r, t) => (senkrecht ? t * b + r : r * b + t) * 4;
    const hell = (i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const strecke = [];
    for (let r = 0; r < reihen; r++) {
      let t = 0;
      while (t < laenge) {
        // Anfang einer Strecke suchen
        while (t < laenge && !(hell(index(r, t)) >= w.unten && hell(index(r, t)) <= w.oben)) t++;
        const anfang = t;
        strecke.length = 0;
        while (t < laenge && hell(index(r, t)) >= w.unten && hell(index(r, t)) <= w.oben) {
          const i = index(r, t);
          strecke.push([hell(i), d[i], d[i + 1], d[i + 2], d[i + 3]]);
          t++;
        }
        if (strecke.length < 2) continue;
        strecke.sort((p, q) => (w.umkehren ? q[0] - p[0] : p[0] - q[0]));
        strecke.forEach((p, k) => d.set(p.slice(1), index(r, anfang + k)));
      }
    }
    return aus;
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "richtung", text: "Richtung", auswahl: ["senkrecht", "waagerecht"], wert: 0 },
        { name: "unten", text: "Helligkeit ab", min: 0, max: 1, schritt: 0.01, wert: 0.25 },
        { name: "oben", text: "Helligkeit bis", min: 0, max: 1, schritt: 0.01, wert: 0.85 },
        { name: "umkehren", text: "Reihenfolge", auswahl: ["dunkel zuerst", "hell zuerst"], wert: 0 },
      ],
    },
  ],
};

// ---------- Farb-Vorhang ----------
// Von jeder starken Kante aus läuft ihre Farbe ein Stück nach unten (oder oben) weiter und blendet
// langsam aus, wie Farbe, die an einer Wand herunterläuft. Verwandt mit Pixel Sorting, aber die Strecke
// beginnt an der Kante und ihre Länge stellt man selbst ein.
const VORHANG = {
  id: "vorhang",
  name: "Farb-Vorhang",
  gruppe: GRUPPE,
  cpu(bild, w) {
    const b = bild.width;
    const h = bild.height;
    const ein = bild.data;
    const aus = new ImageData(new Uint8ClampedArray(ein), b, h);
    const d = aus.data;
    const hell = (i) => (0.2126 * ein[i] + 0.7152 * ein[i + 1] + 0.0722 * ein[i + 2]) / 255;
    const laenge = w.laenge * h;
    const nachOben = w.richtung === 1;
    for (let x = 0; x < b; x++) {
      let farbe = null;
      let rest = 0;
      for (let k = 1; k < h - 1; k++) {
        const y = nachOben ? h - 1 - k : k;
        const i = (y * b + x) * 4;
        const vorher = ((nachOben ? y + 1 : y - 1) * b + x) * 4;
        if (Math.abs(hell(i) - hell(vorher)) > w.schwelle) {
          farbe = [ein[i], ein[i + 1], ein[i + 2]];
          rest = laenge;
        }
        if (farbe && rest > 0) {
          const a = (rest / laenge) * w.deckung;
          for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - a) + farbe[c] * a;
          rest--;
        }
      }
    }
    return aus;
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "schwelle", text: "Kanten ab", min: 0.02, max: 0.8, schritt: 0.01, wert: 0.2 },
        { name: "laenge", text: "Länge", min: 0.01, max: 1, schritt: 0.01, wert: 0.2 },
        { name: "deckung", text: "Deckung", min: 0, max: 1, schritt: 0.01, wert: 0.9 },
        { name: "richtung", text: "Richtung", auswahl: ["nach unten", "nach oben"], wert: 0 },
      ],
    },
  ],
};

export const LINIEN = [HOEHENLINIEN, GRAVUR, DELAUNAY, QUADTREE, DITHER2, PIXELSORT, VORHANG];
