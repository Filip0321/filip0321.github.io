import { RAHMEN, rahmenGeladen, fensterMassstab, baueFenster, setzeSchatten } from "./rahmen.js";

const overlayCanvas = document.createElement("canvas");
const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: true });

// Größe eines Overlays auf einem Bild der Breite w
// breite, hoehe: nur der Inhalt (Grafik oder leere Fläche)
// gesamtB, gesamtH: mit Fenster drumherum, falls es eins hat
export function overlayMasse(schritt, w) {
  const breite = w * schritt.groesse;
  const hoehe = breite * schritt.verhaeltnis; // Höhe / Breite, beim Laden aus der Grafik bestimmt

  if (!schritt.fenster || !rahmenGeladen()) {
    return { breite, hoehe, gesamtB: breite, gesamtH: hoehe, s: 0 };
  }

  const s = fensterMassstab(w);
  const { innen } = RAHMEN;
  return {
    breite, hoehe, s,
    gesamtB: breite + (innen.links + innen.rechts) * s,
    gesamtH: hoehe + (innen.oben + innen.unten) * s,
  };
}

export function zeichneOverlay(bild, schritt) {
  const w = bild.width;
  const h = bild.height;
  const m = overlayMasse(schritt, w);

  // was gezeichnet wird: entweder das fertige Fenster oder nur die Grafik
  let quelle;
  if (m.s > 0) {
    quelle = baueFenster(schritt.grafik, m.breite, m.hoehe, m.s, schritt.titel);
  } else {
    quelle = schritt.grafik;
  }
  if (!quelle) return bild; // leeres Overlay ohne Fenster: nichts zu sehen

  overlayCanvas.width = w;
  overlayCanvas.height = h;
  overlayCtx.putImageData(bild, 0, 0);

  overlayCtx.save();
  if (schritt.schatten) setzeSchatten(overlayCtx, w);

  // Ursprung in die Mitte des Overlays legen, dort drehen
  // die Schattenrichtung wird von translate/rotate NICHT erfasst,
  // dadurch fällt das Licht immer von derselben Seite
  overlayCtx.translate(schritt.x * w, schritt.y * h);
  overlayCtx.rotate((schritt.winkel * Math.PI) / 180);
  overlayCtx.drawImage(quelle, -m.gesamtB / 2, -m.gesamtH / 2, m.gesamtB, m.gesamtH);

  overlayCtx.restore();

  return overlayCtx.getImageData(0, 0, w, h);
}

function grundZettel() {
  return {
    typ: "overlay",
    x: 0.5, // Mitte, waagerecht (Anteil der Bildbreite)
    y: 0.5, // Mitte, senkrecht (Anteil der Bildhöhe)
    groesse: 0.3, // 30 % der Bildbreite
    winkel: 0, // Grad, im Uhrzeigersinn
    schatten: true,
  };
}

export async function neuesOverlay(datei) {
  const grafik = await createImageBitmap(datei); // einmal laden, nicht bei jedem Bild

  return {
    ...grundZettel(),
    name: datei.name,
    grafik,
    verhaeltnis: grafik.height / grafik.width,
    fenster: false,
    titel: datei.name,
  };
}

// Fenster ohne Inhalt: die Mitte bleibt durchsichtig
export function neuesFenster(nummer) {
  return {
    ...grundZettel(),
    name: `Fenster ${nummer}`,
    grafik: null,
    verhaeltnis: 3 / 4,
    fenster: true,
    titel: "Unbenannt",
  };
}

// punkt in Anteilen (0..1), w und h in Pixeln
export function trifft(overlays, punkt, w, h) {
  return (
    overlays.find((schritt) => {
      const m = overlayMasse(schritt, w);

      // Abstand zur Mitte in echten Pixeln
      // (in Anteilen würde die Drehung auf nicht-quadratischen Bildern verzerren)
      const dx = (punkt.x - schritt.x) * w;
      const dy = (punkt.y - schritt.y) * h;

      // den Punkt zurückdrehen, statt das Rechteck zu drehen
      const r = (-schritt.winkel * Math.PI) / 180;
      const lx = dx * Math.cos(r) - dy * Math.sin(r);
      const ly = dx * Math.sin(r) + dy * Math.cos(r);

      return Math.abs(lx) <= m.gesamtB / 2 && Math.abs(ly) <= m.gesamtH / 2;
    }) ?? null
  );
}