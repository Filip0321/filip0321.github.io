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
//
// Runde 5:
//   Eigene Rechtecke: auf dem Bild gezogen (Foto-Effekte, „Rechtecke ziehen“), sie zählen wie Flecken
//     (Rahmen, Schrift, Linien, was im Rahmen passiert) und heißen E1, E2 … Mit „Flecken sind: nur eigene
//     Rechtecke“ wird gar nichts erkannt, dann gibt es nur sie.
//   Linien am Rand: statt von Mitte zu Mitte von der nächsten Stelle des einen Rahmens zur nächsten des
//     anderen. Für zwei achsenparallele Rechtecke geht das je Achse getrennt: überlappen sie auf einer Achse,
//     die Mitte der Überlappung, sonst die zugewandten Kanten.
//   Durchhängen: Kabel statt gespannter Linien. Ein hängendes Seil ist eine Kettenlinie (cosh); eine
//     Parabel sieht fast gleich aus und ist eine quadratische Bézierkurve: Anfang, Ende und ein Kontrollpunkt
//     unter der Mitte (doppelt so tief wie der tiefste Punkt der Kurve).

import { leinwand } from "./hilfen.js";
import { merkeFlecken } from "./instanzen.js";
import { findeFlecken } from "/lib/flecken.js";

// Gedächtnis einer Instanz (instanzen.js), damit zwei Blob-Trackings nicht dieselben Flecken verfolgen:
//   hintergrund  gleitender Mittelwert der Helligkeit (klein), für „Bewegung“
//   alte         Flecken vom letzten Bild: { id, x, y }
//   naechsteId   nächste freie Nummer
//   spuren       id -> letzte Schwerpunkte (volle Größe)
const neuesGedaechtnis = () => ({ hintergrund: null, alte: [], naechsteId: 1, spuren: new Map() });
const standard = neuesGedaechtnis();

const FARBEN = ["#ffffff", "#ff3030", "#30ff70", "#ffe030", "#30e0ff"];

// eigene Rechtecke, in Anteilen des Bildes (0 bis 1, von oben links): { x0, y0, x1, y1 }
let eigene = [];
export function setzeEigeneRechtecke(liste) {
  eigene = liste;
}

function eigeneFlecken(bild) {
  return eigene.map((r, i) => {
    const x0 = Math.min(r.x0, r.x1) * bild.width;
    const x1 = Math.max(r.x0, r.x1) * bild.width;
    const y0 = Math.min(r.y0, r.y1) * bild.height;
    const y1 = Math.max(r.y0, r.y1) * bild.height;
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0, y0, x1, y1, flaeche: ((x1 - x0) * (y1 - y0)) / (bild.width * bild.height), id: `E${i + 1}`, eigen: true };
  });
}

// die nächsten Stellen zweier Rahmen (je Achse: Mitte der Überlappung oder die zugewandten Kanten)
function naechstePunkte(p, q) {
  const achse = (a0, a1, b0, b1) => {
    if (a1 < b0) return [a1, b0]; // p liegt davor
    if (b1 < a0) return [a0, b1]; // p liegt dahinter
    const m = (Math.max(a0, b0) + Math.min(a1, b1)) / 2; // überlappen: in der Mitte der Überlappung
    return [m, m];
  };
  const [px, qx] = achse(p.x0, p.x1, q.x0, q.x1);
  const [py, qy] = achse(p.y0, p.y1, q.y0, q.y1);
  return [px, py, qx, qy];
}

// die Suche selbst steht in /lib/flecken.js (auch Video zu Ton braucht sie); hier kommen die eigenen Rechtecke dazu
function finde(bild, w, g) {
  return findeFlecken(bild, w, g, eigeneFlecken);
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
  neuesGedaechtnis,
  cpu(bild, w, zeit, g = standard) {
    const flecken = finde(bild, w, g);
    merkeFlecken(flecken, bild.width, bild.height); // für den „Bereich“ anderer Effekte (instanzen.js)
    const aus = new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height);
    if (w.innen > 0.5) for (const p of flecken) innen(aus.data, bild.width, p, Math.round(w.innen));
    const { c, ctx } = leinwand(bild.width, bild.height);
    ctx.putImageData(aus, 0, 0);
    const masz = Math.max(bild.width, bild.height) / 1000; // Strichstärke und Schrift wachsen mit dem Bild
    const farbe = FARBEN[Math.round(w.farbe)] ?? FARBEN[0];
    ctx.strokeStyle = farbe;
    ctx.fillStyle = farbe;
    ctx.lineWidth = w.dicke * masz;

    // Linien zwischen den Flecken: von Mitte zu Mitte oder vom nächsten Rand zum nächsten Rand,
    // gespannt oder durchhängend (der Kontrollpunkt liegt um „durchhang“ mal die Länge unter der Mitte)
    const verbinde = (p, q, weiter = false) => {
      const [ax, ay, bx, by] = w.ansatz > 0.5 ? naechstePunkte(p, q) : [p.x, p.y, q.x, q.y];
      if (!weiter) ctx.moveTo(ax, ay);
      else ctx.lineTo(ax, ay);
      const sack = (w.durchhang ?? 0) * Math.hypot(bx - ax, by - ay);
      if (sack > 0) ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sack, bx, by);
      else ctx.lineTo(bx, by);
    };
    if (w.linien > 0.5 && flecken.length > 1) {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      if (w.linien < 1.5) {
        // jeder zu seinen zwei nächsten Nachbarn
        for (const p of flecken) {
          const naechste = flecken.filter((q) => q !== p).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 2);
          for (const q of naechste) verbinde(p, q);
        }
      } else if (w.linien < 2.5) {
        // eine Kette in der Reihenfolge der Nummern
        const nummer = (p) => (p.eigen ? 1e6 + Number(String(p.id).slice(1)) : p.id); // eigene am Ende der Kette
        const kette = [...flecken].sort((a, b) => nummer(a) - nummer(b));
        for (let i = 1; i < kette.length; i++) verbinde(kette[i - 1], kette[i]);
      } else {
        for (let i = 0; i < flecken.length; i++) for (let k = i + 1; k < flecken.length; k++) verbinde(flecken[i], flecken[k]);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Spuren: wo die Mitte in den letzten Bildern war
    if (w.spur > 1) {
      ctx.globalAlpha = 0.5;
      for (const p of flecken) {
        const s = g.spuren.get(p.id);
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
      const nummer = p.eigen ? p.id : String(p.id).padStart(3, "0");
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
        { name: "art", text: "Flecken sind", auswahl: ["hell", "dunkel", "was sich bewegt", "nur eigene Rechtecke"], wert: 0 },
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
        { name: "ansatz", text: "Linien von", auswahl: ["Mitte zu Mitte", "Rand zu Rand (nächste Stelle)"], wert: 1 },
        { name: "durchhang", text: "Durchhängen (Kabel)", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "spur", text: "Spur (Bilder)", min: 0, max: 60, schritt: 1, wert: 0 },
        { name: "farbe", text: "Farbe", auswahl: ["Weiß", "Rot", "Grün", "Gelb", "Cyan"], wert: 0 },
        { name: "dicke", text: "Strich", min: 0.5, max: 6, schritt: 0.1, wert: 1.5 },
        { name: "schrift", text: "Schriftgröße", min: 0.5, max: 4, schritt: 0.1, wert: 1.4 },
      ],
    },
  ],
};

export { BLOBS };
