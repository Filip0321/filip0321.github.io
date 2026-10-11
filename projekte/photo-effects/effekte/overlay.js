import { RAHMEN, rahmenGeladen, fensterMassstab, baueFenster, setzeSchatten } from "./rahmen.js";

const overlayCanvas = document.createElement("canvas");
const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: true });

// Größe eines Overlays auf einem Bild der Breite w 
// breite, hoehe: nur die Grafik
// gesamtB, gesamtH: mit Fenster drumherum, falls es eins hat
export function overlayMasse(schritt, w) {
  const breite = w * schritt.groesse;
  const hoehe = (breite * schritt.grafik.height) / schritt.grafik.width;

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

  overlayCanvas.width = w;
  overlayCanvas.height = h;
  overlayCtx.putImageData(bild, 0, 0);

  const m = overlayMasse(schritt, w);
  const links = schritt.x * w - m.gesamtB / 2;   // Mitte → linke Kante
  const oben = schritt.y * h - m.gesamtH / 2;

  if (m.s > 0) {
    // mit Fenster: bauen, dann einmal mit Schatten zeichnen
    const fenster = baueFenster(schritt.grafik, m.breite, m.hoehe, m.s, schritt.titel);
    overlayCtx.save();
    setzeSchatten(overlayCtx, w);
    overlayCtx.drawImage(fenster, links, oben);
    overlayCtx.restore();
  } else {
    overlayCtx.drawImage(schritt.grafik, links, oben, m.breite, m.hoehe);
  }

  return overlayCtx.getImageData(0, 0, w, h);
}

export async function neuesOverlay(datei) {
  const grafik = await createImageBitmap(datei); // einmal laden, nicht bei jedem Bild

  // packe es hinten an die Kette dran
  return {
    typ: "overlay",
    name: datei.name, // für die Anzeige in der Liste
    grafik,
    x: 0.5, // Mitte, waagerecht
    y: 0.5, // Mitte, senkrecht
    groesse: 0.3, // 30 % der ganzen Bildbreite (canvasBreite)
    fenster: false,
    titel: datei.name,
  }; // Mitte ist wichtig zum späteren skalieren und rotieren
}

export function trifft(overlays, punkt, w, h) {
  return (
    overlays.find((schritt) => {
      // find gibt das erste Element zurück wo es zu "true" ausgewertet wird
      const m = overlayMasse(schritt, w);
      const halbeBreite = m.gesamtB / w / 2;
      const halbeHoehe = m.gesamtH / h / 2;
      return (
        Math.abs(punkt.x - schritt.x) <= halbeBreite && // einfach dass der Punkt max halbe größe des Overlays
        Math.abs(punkt.y - schritt.y) <= halbeHoehe
      ); // von der mitte des Overlays entfernt ist
    }) ?? null
  )
}
