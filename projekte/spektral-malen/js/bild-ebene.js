// Bild-Ebene: ein Bild liegt als eigene Ebene auf der Leinwand, verschiebbar, lauter und leiser.
// Nichts wird eingebrannt: das Bild bleibt in der Ebene (quelle), und werte wird jedes Mal neu
// daraus gerechnet, wenn sich Lage oder Einstellung ändern.
//
// Lage: waagerecht von Spalte anfang bis ende, senkrecht von unten bis oben (Hz).
// Die Höhe im Bild ist logarithmisch wie die Ansicht: so steht das Bild unverzerrt da, wo man es
// hingelegt hat, auch wenn die Fächer unten breit und oben dicht sind.

const MAX_SEITE = 1024; // größere Bilder werden vorher verkleinert (mehr sieht und hört man nicht)

// Datei -> Helligkeit 0 bis 1 pro Pixel (Zeile für Zeile, Zeile 0 oben)
export async function ladeBild(datei) {
  const bitmap = await createImageBitmap(datei);
  const faktor = Math.min(1, MAX_SEITE / Math.max(bitmap.width, bitmap.height));
  const breite = Math.max(1, Math.round(bitmap.width * faktor));
  const hoehe = Math.max(1, Math.round(bitmap.height * faktor));
  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, breite, hoehe);
  bitmap.close();
  const pixel = ctx.getImageData(0, 0, breite, hoehe).data;
  const hell = new Float32Array(breite * hoehe);
  for (let i = 0; i < hell.length; i++) {
    // Helligkeit wie das Auge (Grün zählt am meisten), Durchsichtiges zählt als Schwarz
    const a = pixel[i * 4 + 3] / 255;
    hell[i] = ((0.2126 * pixel[i * 4] + 0.7152 * pixel[i * 4 + 1] + 0.0722 * pixel[i * 4 + 2]) / 255) * a;
  }
  return { breite, hoehe, hell };
}

// werte der Ebene neu aus dem Bild rechnen (so groß wie die Leinwand, außerhalb des Bildes 0)
export function rastere(ebene, leinwand) {
  const { spalten, faecher, fachBreite } = leinwand;
  const { breite, hoehe, hell } = ebene.quelle;
  const { anfang, ende, unten, oben, invertieren, schwelle } = ebene;
  const werte = ebene.werte?.length === spalten * faecher ? ebene.werte : new Float32Array(spalten * faecher);
  werte.fill(0);
  const logSpanne = Math.log(oben / unten);

  // pro Fach einmal: welche Bildzeilen es abdeckt (oben im Bild = hohe Frequenz).
  // Unten sind die Fächer breit und decken viele Zeilen ab: dort wird gemittelt, sonst flimmert es
  const zeilen = [];
  for (let k = 1; k < faecher - 1; k++) {
    const fu = Math.max((k - 0.5) * fachBreite, unten);
    const fo = Math.min((k + 0.5) * fachBreite, oben);
    if (fo <= fu) continue; // Fach liegt nicht im Bild
    const y0 = (1 - Math.log(fo / unten) / logSpanne) * hoehe; // obere Kante (kleinere Zeile)
    const y1 = (1 - Math.log(fu / unten) / logSpanne) * hoehe;
    zeilen.push({ k, von: Math.max(0, Math.floor(y0)), bis: Math.min(hoehe - 1, Math.max(Math.floor(y0), Math.ceil(y1) - 1)) });
  }

  const s0 = Math.max(0, Math.ceil(anfang - 0.5));
  const s1 = Math.min(spalten - 1, Math.floor(ende - 0.5));
  for (let s = s0; s <= s1; s++) {
    const x = Math.min(breite - 1, Math.floor(((s + 0.5 - anfang) / (ende - anfang)) * breite));
    const basis = s * faecher;
    for (const { k, von, bis } of zeilen) {
      let summe = 0;
      for (let y = von; y <= bis; y++) summe += hell[y * breite + x];
      let v = summe / (bis - von + 1);
      if (invertieren) v = 1 - v;
      werte[basis + k] = v < schwelle ? 0 : v; // unter der Schwelle: Stille statt leises Rauschen
    }
  }
  ebene.werte = werte;
  return werte;
}
