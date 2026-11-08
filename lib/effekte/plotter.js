// Plotter: ein Stiftplotter zeichnet die Umrisse des Bildes nach, Strich für Strich, wie ein HP 7475 oder ein
// AxiDraw. Die Umrisse sind Höhenlinien der Helligkeit (Marching Squares, /lib/konturen.js) auf einigen Stufen
// zwischen Dunkel und Hell. Der Stift fährt sie in der Reihenfolge ab, die ein Plotter wählen würde: immer zum
// nächsten Strich (ordne), denn Leerfahrten kosten Zeit.
//
// Zeit: alle Striche zusammen sind eine Länge L. Nach t Sekunden ist der Stift bei t / Dauer · L. Leerfahrten
// (Stift oben) zählen mit, aber schneller (ein Drittel ihrer Länge), wie beim echten Gerät. So entsteht die
// Zeichnung im Video nach und nach, beim Foto auch schon in der Vorschau.
// Ein Video: jedes Bild hat andere Umrisse; gezeichnet wird, was das jetzige Bild bis zu dieser Stelle hätte
// (die Zeichnung wächst und bewegt sich zugleich). Ein Foto wird nur einmal ausgerechnet (das Gedächtnis merkt
// sich die Striche, solange Bild und Regler gleich bleiben).
// Zittern: jeder Punkt etwas versetzt, fest pro Punkt (sonst flimmerte es), wie eine unruhige Hand oder Papier,
// das sich wellt.

import { leinwand } from "./hilfen.js";
import { konturen, ordne } from "/lib/konturen.js";
import { meldeSvg } from "/lib/export.js";

const TINTEN = ["#111111", "#1d3fa0", "#b0201c", "#f4f1e8"];
const PAPIER = "#f3eee2";

const neuesGedaechtnis = () => ({ schluessel: "", striche: [], laengen: [], gesamt: 0 });

// Fingerabdruck des Bildes (jedes 97. Pixel) und der Regler: gleich = dieselben Striche wie letztes Mal
function fingerabdruck(bild, w) {
  let s = 0;
  const d = bild.data;
  for (let i = 0; i < d.length; i += 97 * 4) s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1e9;
  return `${bild.width}x${bild.height}|${s}|${w.stufen}|${w.detail}|${w.kuerzeste}`;
}

function rechneStriche(bild, w) {
  // klein rechnen und weichzeichnen (glattere Linien, weniger Krümel), mit einem Rand: Umrisse schließen sich
  const f = w.detail / Math.max(bild.width, bild.height);
  const b = Math.max(8, Math.round(bild.width * f));
  const h = Math.max(8, Math.round(bild.height * f));
  const gross = leinwand(bild.width, bild.height);
  gross.ctx.putImageData(bild, 0, 0);
  const klein = leinwand(b + 2, h + 2);
  klein.ctx.fillStyle = "#000";
  klein.ctx.fillRect(0, 0, b + 2, h + 2);
  klein.ctx.filter = "blur(0.7px)";
  klein.ctx.drawImage(gross.c, 1, 1, b, h);
  const d = klein.ctx.getImageData(0, 0, b + 2, h + 2).data;
  const W = b + 2;
  const H = h + 2;
  const hell = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) hell[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  // zurück in Pixel des Bildes
  const sx = bild.width / b;
  const sy = bild.height / h;
  const alle = [];
  for (let k = 1; k <= w.stufen; k++) {
    for (const linie of konturen(hell, W, H, k / (w.stufen + 1))) {
      const punkte = linie.map(([x, y]) => [(x - 1) * sx, (y - 1) * sy]);
      if (laenge(punkte) >= w.kuerzeste) alle.push(punkte);
    }
  }
  return ordne(alle);
}

// zuletzt gezeichnet: fürs SVG (Bild speichern als SVG). Nur, wenn der Plotter eben noch lief (sonst ist er aus)
let zuletzt = null; // { striche, farben, breite, hoehe, dicke, zeit }
const zahl = (v) => Math.round(v * 100) / 100;
function alsSvg() {
  if (!zuletzt || performance.now() - zuletzt.zeit > 3000) return null;
  const { striche, farben, breite, hoehe, dicke } = zuletzt;
  // die ganze Zeichnung (nicht nur, was bis jetzt gezeichnet ist), ohne Zittern: die Maschine zittert selbst
  const pfade = striche.map((s, i) => {
    const d = s.map(([x, y], k) => `${k ? "L" : "M"}${zahl(x)} ${zahl(y)}`).join("");
    return `  <path d="${d}" stroke="${farben[i]}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${breite}" height="${hoehe}" viewBox="0 0 ${breite} ${hoehe}">
<g fill="none" stroke-width="${zahl(dicke)}" stroke-linecap="round" stroke-linejoin="round">
${pfade.join("\n")}
</g>
</svg>
`;
}
meldeSvg(alsSvg);

const laenge = (l) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);

const PLOTTER = {
  id: "plotter",
  name: "Plotter",
  gruppe: "Linien und Geometrie",
  zeitabhaengig: true,
  lebendig: true, // zeichnet schon in der Vorschau eines Fotos
  neuesGedaechtnis,
  regler: [
    {
      gruppe: "Linien",
      regler: [
        { name: "stufen", text: "Höhenlinien", min: 1, max: 8, schritt: 1, wert: 3 },
        { name: "detail", text: "Feinheit", min: 60, max: 480, schritt: 10, wert: 200 },
        { name: "kuerzeste", text: "Krümel weg (px)", min: 0, max: 80, schritt: 1, wert: 10 },
      ],
    },
    {
      gruppe: "Zeichnen",
      regler: [
        { name: "dauer", text: "Dauer (s)", min: 1, max: 120, schritt: 0.5, wert: 10 },
        { name: "ablauf", text: "Ablauf", auswahl: ["einmal", "immer wieder", "fertig zeigen"], wert: 1 },
        { name: "tinte", text: "Tinte", auswahl: ["Schwarz", "Blau", "Rot", "Weiß", "Farbe des Bildes"], wert: 0 },
        { name: "grund", text: "Hintergrund", auswahl: ["Bild", "Papier", "Schwarz"], wert: 1 },
        { name: "dicke", text: "Strich", min: 0.3, max: 8, schritt: 0.1, wert: 1.2 },
        { name: "zittern", text: "Zittern", min: 0, max: 1, schritt: 0.01, wert: 0.15 },
        { name: "stift", text: "Stift zeigen", auswahl: ["nein", "ja"], wert: 1 },
      ],
    },
  ],
  cpu(bild, w, zeit = 0, g = neuesGedaechtnis()) {
    const schluessel = fingerabdruck(bild, w);
    if (g.schluessel !== schluessel) {
      g.schluessel = schluessel;
      g.striche = rechneStriche(bild, w);
      // Länge bis zum Anfang jedes Strichs, Leerfahrten zu einem Drittel
      g.laengen = [];
      let summe = 0;
      let wo = [0, 0];
      for (const s of g.striche) {
        summe += Math.hypot(s[0][0] - wo[0], s[0][1] - wo[1]) / 3;
        g.laengen.push(summe);
        summe += laenge(s);
        wo = s.at(-1);
      }
      g.gesamt = summe;
    }
    const anteil = w.ablauf > 1.5 ? 1 : w.ablauf > 0.5 ? (zeit / w.dauer) % 1 : Math.min(1, zeit / w.dauer);
    const bis = anteil * g.gesamt;

    const { c, ctx } = leinwand(bild.width, bild.height);
    if (w.grund < 0.5) ctx.putImageData(bild, 0, 0);
    else {
      ctx.fillStyle = w.grund < 1.5 ? PAPIER : "#000";
      ctx.fillRect(0, 0, bild.width, bild.height);
    }
    const masz = Math.max(bild.width, bild.height) / 1000;
    const farbeDesBildes = w.tinte > 3.5;
    const tinte = TINTEN[Math.round(w.tinte)] ?? (w.grund > 1.5 ? TINTEN[3] : TINTEN[0]);
    ctx.lineWidth = w.dicke * masz;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = tinte;
    const zitter = w.zittern * 2.5 * masz;
    const versatz = (s, i, k) => zitter * Math.sin(i * 0.9 + s * 2.1 + k * 1.7) * Math.sin(i * 0.23 + s * 0.7 + k);
    // fürs SVG: alle Striche mit ihrer Farbe
    const farbe = (linie) => {
      if (!farbeDesBildes) return tinte;
      // die Farbe des Bildes am Anfang des Strichs (ein Strich, eine Farbe, wie ein Stiftwechsel)
      const [x, y] = linie[0];
      const p = (Math.min(bild.height - 1, Math.max(0, Math.round(y))) * bild.width + Math.min(bild.width - 1, Math.max(0, Math.round(x)))) * 4;
      return `rgb(${bild.data[p]}, ${bild.data[p + 1]}, ${bild.data[p + 2]})`;
    };
    zuletzt = { striche: g.striche, farben: g.striche.map(farbe), breite: bild.width, hoehe: bild.height, dicke: w.dicke * masz, zeit: performance.now() };
    let stift = null;
    for (let s = 0; s < g.striche.length && g.laengen[s] < bis; s++) {
      const linie = g.striche[s];
      if (farbeDesBildes) ctx.strokeStyle = zuletzt.farben[s];
      ctx.beginPath();
      let gefahren = g.laengen[s];
      ctx.moveTo(linie[0][0] + versatz(s, 0, 0), linie[0][1] + versatz(s, 0, 1));
      stift = linie[0];
      for (let i = 1; i < linie.length; i++) {
        const [ax, ay] = linie[i - 1];
        const [bx, by] = linie[i];
        const stueck = Math.hypot(bx - ax, by - ay);
        if (gefahren + stueck > bis) {
          // das letzte Stück nur zum Teil: da steht der Stift gerade
          const t = (bis - gefahren) / (stueck || 1);
          stift = [ax + (bx - ax) * t, ay + (by - ay) * t];
          ctx.lineTo(stift[0] + versatz(s, i, 0), stift[1] + versatz(s, i, 1));
          gefahren = bis;
          break;
        }
        ctx.lineTo(bx + versatz(s, i, 0), by + versatz(s, i, 1));
        gefahren += stueck;
        stift = linie[i];
      }
      ctx.stroke();
    }
    // der Stift: ein Kreis an der Stelle, wo gerade gezeichnet wird (nur solange er noch zeichnet)
    if (w.stift > 0.5 && stift && anteil < 1) {
      ctx.strokeStyle = w.grund > 1.5 ? "#ffffff" : "#000000";
      ctx.lineWidth = 1.5 * masz;
      ctx.beginPath();
      ctx.arc(stift[0], stift[1], 6 * masz, 0, 2 * Math.PI);
      ctx.stroke();
    }
    return ctx.getImageData(0, 0, bild.width, bild.height);
  },
};

export { PLOTTER };
