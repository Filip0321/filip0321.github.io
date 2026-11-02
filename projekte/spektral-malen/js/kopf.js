// Über der Leinwand: Frequenz-Skala, Rahmen (Auswahl, aktive Ebene) und Lesekopf,
// auf einem durchsichtigen 2D-Canvas
// (wie kopf.js in bild-zu-ton, nur dass der Lesekopf vom Klang kommt statt von einem <audio>)

import { frequenzZuAnteil } from "./leinwand.js";

const SKALA = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const KOPF_FARBE = "#dddddd";
const AUFNAHME_FARBE = "#ff4040"; // Lesekopf, während das Mikrofon aufnimmt
const LINIEN_FARBE = "rgba(221, 221, 221, 0.3)";
const RAND_FARBE = "rgba(17, 17, 17, 0.8)";
const SCHRIFT = 12;

export function richteKopfEin(canvas) {
  const ctx = canvas.getContext("2d");
  let dpr = 2;

  function passeGroesseAn() {
    dpr = Math.max(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }

  function beschriftung(f) {
    return f < 1000 ? `${f}` : `${f / 1000}k`;
  }

  // anteil: Lesekopf von 0 (links) bis 1 (rechts); tief, hoch: was das Bild zeigt
  // rechtecke: [{ links, rechts, unten, oben (Anteile 0 bis 1, unten = 0), gestrichelt }]
  // aufnahme: der Lesekopf wird rot
  function zeichne({ anteil, tief, hoch, skala, rechtecke = [], aufnahme = false }) {
    const { width: breite, height: hoehe } = canvas;
    ctx.clearRect(0, 0, breite, hoehe);

    if (skala) {
      ctx.font = `${SCHRIFT * dpr}px monospace`;
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3 * dpr;
      ctx.lineJoin = "round";
      for (const f of SKALA) {
        if (f < tief || f > hoch) continue;
        const y = Math.round((1 - frequenzZuAnteil(f, tief, hoch)) * hoehe); // oben = hoch
        ctx.fillStyle = LINIEN_FARBE;
        ctx.fillRect(0, y, breite, Math.round(dpr));
        ctx.strokeStyle = RAND_FARBE;
        ctx.strokeText(beschriftung(f), 4 * dpr, y - 2 * dpr);
        ctx.fillStyle = KOPF_FARBE;
        ctx.fillText(beschriftung(f), 4 * dpr, y - 2 * dpr);
      }
    }

    // Rahmen: hell mit dunklem Rand wie der Lesekopf; gestrichelt = Auswahl
    for (const r of rechtecke) {
      const x0 = r.links * breite;
      const y0 = (1 - r.oben) * hoehe;
      const w = (r.rechts - r.links) * breite;
      const h = (r.oben - r.unten) * hoehe;
      ctx.setLineDash(r.gestrichelt ? [6 * dpr, 4 * dpr] : []);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = RAND_FARBE;
      ctx.strokeRect(x0, y0, w, h);
      ctx.lineWidth = dpr;
      ctx.strokeStyle = KOPF_FARBE;
      ctx.strokeRect(x0, y0, w, h);
    }
    ctx.setLineDash([]);

    // Lesekopf: heller Strich mit dunklem Rand, damit man ihn auf hell und dunkel sieht
    const strich = Math.round(dpr);
    const x = Math.min(Math.round(anteil * breite), breite - strich);
    ctx.fillStyle = RAND_FARBE;
    ctx.fillRect(x - strich, 0, strich * 3, hoehe);
    ctx.fillStyle = aufnahme ? AUFNAHME_FARBE : KOPF_FARBE;
    ctx.fillRect(x, 0, strich, hoehe);
  }

  return { passeGroesseAn, zeichne };
}
