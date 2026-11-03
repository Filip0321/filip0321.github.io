// Blob-Tracking: zusammenhängende Flecken finden (hell, dunkel, oder was sich bewegt), sie mit Rahmen,
// Nummer und Koordinaten markieren und von Bild zu Bild wiedererkennen. Der Look kommt aus TouchDesigner
// und der Überwachungskamera: Maschinen, die sehen, und zeigen, was sie gesehen haben.
//
// Ablauf pro Bild:
//   1. verkleinern (Erkennen braucht keine 4K, und es wird ruhiger): höchstens 240 Pixel breit
//   2. Maske: welcher Pixel gehört zu einem Fleck? Helligkeit über/unter der Schwelle, oder Bewegung:
//      Unterschied zum Hintergrund. Der Hintergrund ist ein gleitender Mittelwert der letzten Bilder (jedes
//      neue Bild zählt ein wenig); was steht, verschwindet darin, was sich bewegt, hebt sich ab. Besser als
//      „Unterschied zum letzten Bild“: das wäre bei doppelt gezeigten Bildern plötzlich leer.
//   3. Zusammenfassen: die Maske etwas dicker machen (Dilatation), damit ein zerrissener Fleck einer ist
//   4. Flecken zählen: Flutfüllung („Connected Components“), von jedem noch freien Pixel aus alles
//      Zusammenhängende einsammeln; pro Fleck Rahmen (kleinstes/größtes x, y), Fläche, Schwerpunkt
//   5. Wiedererkennen: jeder Fleck bekommt die Nummer des nächsten Flecks vom letzten Bild (der nächste
//      Schwerpunkt, nicht zu weit weg); was keinen hat, bekommt eine neue Nummer
//   6. zeichnen, in voller Größe

import { leinwand } from "./hilfen.js";

const MAX_BREITE = 240;
let hintergrund = null; // gleitender Mittelwert der Helligkeit (klein), für „Bewegung“
let alte = []; // Flecken vom letzten Bild: { id, x, y }
let naechsteId = 1;
const spuren = new Map(); // id -> letzte Schwerpunkte (volle Größe)

const FARBEN = ["#ffffff", "#ff3030", "#30ff70", "#ffe030", "#30e0ff"];

function finde(bild, w) {
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
  if (!hintergrund || hintergrund.length !== hell.length) hintergrund = Float32Array.from(hell);
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
  flecken.forEach((p, i) => alte.forEach((a, k) => paare.push([Math.hypot(p.x - a.x, p.y - a.y), i, k])));
  paare.sort((a, c) => a[0] - c[0]);
  const vergeben = new Set();
  for (const [abstand, i, k] of paare) {
    if (abstand > weit) break;
    if (flecken[i].id || vergeben.has(k)) continue;
    flecken[i].id = alte[k].id;
    vergeben.add(k);
  }
  for (const p of flecken) p.id ??= naechsteId++;
  if (naechsteId > 999) naechsteId = 1;
  alte = flecken.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  // Spuren
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

// was im Rahmen mit dem Bild passiert
function innen(d, breite, p, art) {
  const x0 = Math.floor(p.x0), y0 = Math.floor(p.y0), x1 = Math.ceil(p.x1), y1 = Math.ceil(p.y1);
  if (art === 1) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * breite + x) * 4;
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
  } else if (art === 2) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * breite + x) * 4;
      const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 110 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else if (art === 3) {
    // grob gepixelt: 12 Blöcke über die Breite des Rahmens
    const k = Math.max(2, Math.round((x1 - x0) / 12));
    for (let by = y0; by < y1; by += k) for (let bx = x0; bx < x1; bx += k) {
      const i = (Math.min(y1 - 1, by + (k >> 1)) * breite + Math.min(x1 - 1, bx + (k >> 1))) * 4;
      for (let y = by; y < Math.min(y1, by + k); y++) for (let x = bx; x < Math.min(x1, bx + k); x++) {
        const j = (y * breite + x) * 4;
        d[j] = d[i];
        d[j + 1] = d[i + 1];
        d[j + 2] = d[i + 2];
      }
    }
  } else if (art === 4) {
    // Wärmebild: Helligkeit auf eine Glut-Skala
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * breite + x) * 4;
      const t = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      d[i] = 255 * Math.min(1, t * 2.2);
      d[i + 1] = 255 * Math.max(0, Math.min(1, t * 2 - 0.5));
      d[i + 2] = 255 * Math.max(0, t * 3 - 2) + 120 * Math.max(0, 0.4 - t);
    }
  }
}

const BLOBS = {
  id: "blobs",
  name: "Blob-Tracking",
  gruppe: "Linien und Geometrie",
  zeitabhaengig: true,
  cpu(bild, w) {
    const flecken = finde(bild, w);
    const aus = new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height);
    if (w.innen > 0.5) for (const p of flecken) innen(aus.data, bild.width, p, Math.round(w.innen));
    const { c, ctx } = leinwand(bild.width, bild.height);
    ctx.putImageData(aus, 0, 0);
    const masz = Math.max(bild.width, bild.height) / 1000; // Strichstärke und Schrift wachsen mit dem Bild
    const farbe = FARBEN[Math.round(w.farbe)] ?? FARBEN[0];
    ctx.strokeStyle = farbe;
    ctx.fillStyle = farbe;
    ctx.lineWidth = w.dicke * masz;

    // Linien zwischen den Flecken
    if (w.linien > 0.5 && flecken.length > 1) {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      if (w.linien < 1.5) {
        // jeder zu seinen zwei nächsten Nachbarn
        for (const p of flecken) {
          const naechste = flecken.filter((q) => q !== p).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 2);
          for (const q of naechste) {
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
          }
        }
      } else if (w.linien < 2.5) {
        // eine Kette in der Reihenfolge der Nummern
        const kette = [...flecken].sort((a, b) => a.id - b.id);
        kette.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      } else {
        for (let i = 0; i < flecken.length; i++) for (let k = i + 1; k < flecken.length; k++) {
          ctx.moveTo(flecken[i].x, flecken[i].y);
          ctx.lineTo(flecken[k].x, flecken[k].y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Spuren: wo die Mitte in den letzten Bildern war
    if (w.spur > 1) {
      ctx.globalAlpha = 0.5;
      for (const p of flecken) {
        const s = spuren.get(p.id);
        if (!s || s.length < 2) continue;
        ctx.beginPath();
        s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Rahmen und Schrift
    ctx.font = `${Math.round(11 * masz * w.schrift)}px monospace`;
    ctx.textBaseline = "bottom";
    for (const p of flecken) {
      const bb = p.x1 - p.x0;
      const bh = p.y1 - p.y0;
      if (w.rahmen < 0.5) ctx.strokeRect(p.x0, p.y0, bb, bh);
      else if (w.rahmen < 1.5) {
        // nur die Ecken, wie im Sucher
        const e = Math.min(bb, bh) * 0.25;
        ctx.beginPath();
        for (const [x, y, dx, dy] of [[p.x0, p.y0, 1, 1], [p.x1, p.y0, -1, 1], [p.x0, p.y1, 1, -1], [p.x1, p.y1, -1, -1]]) {
          ctx.moveTo(x + dx * e, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y + dy * e);
        }
        ctx.stroke();
      } else if (w.rahmen < 2.5) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.hypot(bb, bh) / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Kreuz in der Mitte
      const k = 4 * masz * w.schrift;
      ctx.beginPath();
      ctx.moveTo(p.x - k, p.y);
      ctx.lineTo(p.x + k, p.y);
      ctx.moveTo(p.x, p.y - k);
      ctx.lineTo(p.x, p.y + k);
      ctx.stroke();
      const nummer = String(p.id).padStart(3, "0");
      const text = [
        "",
        `#${nummer}`,
        `x ${Math.round(p.x)} y ${Math.round(p.y)}`,
        `#${nummer}  x ${Math.round(p.x)} y ${Math.round(p.y)}`,
        `#${nummer}  ${(p.flaeche * 100).toFixed(1)} %`,
      ][Math.round(w.text)];
      if (text) ctx.fillText(text, p.x0, p.y0 - 2 * masz);
    }
    return ctx.getImageData(0, 0, c.width, c.height);
  },
  regler: [
    {
      gruppe: "Erkennen",
      regler: [
        { name: "art", text: "Flecken sind", auswahl: ["hell", "dunkel", "was sich bewegt"], wert: 0 },
        { name: "schwelle", text: "Schwelle", min: 0, max: 1, schritt: 0.01, wert: 0.6 },
        // Bewegung: wie schnell Neues zum Hintergrund wird (klein: was stehen bleibt, bleibt lange sichtbar)
        { name: "gedaechtnis", text: "Hintergrund lernt", min: 0.005, max: 0.5, schritt: 0.005, wert: 0.08 },
        { name: "zusammen", text: "Zusammenfassen (px)", min: 0, max: 8, schritt: 1, wert: 2 },
        { name: "kleinste", text: "Kleinster Fleck (% des Bildes)", min: 0, max: 5, schritt: 0.01, wert: 0.1 },
        { name: "anzahl", text: "Höchstens", min: 1, max: 60, schritt: 1, wert: 16 },
      ],
    },
    {
      gruppe: "Zeigen",
      regler: [
        { name: "rahmen", text: "Rahmen", auswahl: ["Rechteck", "Ecken", "Kreis", "nur Kreuz"], wert: 0 },
        { name: "innen", text: "im Rahmen", auswahl: ["Bild", "invertiert", "schwarz-weiß", "gepixelt", "Wärmebild"], wert: 0 },
        { name: "text", text: "Schrift", auswahl: ["keine", "Nummer", "Koordinaten", "Nummer und Koordinaten", "Nummer und Fläche"], wert: 3 },
        { name: "linien", text: "Linien", auswahl: ["keine", "zu den Nachbarn", "Kette (nach Nummer)", "alle"], wert: 1 },
        { name: "spur", text: "Spur (Bilder)", min: 0, max: 60, schritt: 1, wert: 0 },
        { name: "farbe", text: "Farbe", auswahl: ["Weiß", "Rot", "Grün", "Gelb", "Cyan"], wert: 0 },
        { name: "dicke", text: "Strich", min: 0.5, max: 6, schritt: 0.1, wert: 1.5 },
        { name: "schrift", text: "Schriftgröße", min: 0.5, max: 4, schritt: 0.1, wert: 1.4 },
      ],
    },
  ],
};

export { BLOBS };
