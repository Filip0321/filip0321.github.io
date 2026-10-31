// Bild laden, auf ein Raster (Spalten × Zeilen) verkleinern, Helligkeit pro Rasterpunkt, zeigen

import { farbenZahlen } from "/lib/farben.js";

const MAX_GROESSE = 2048; // größer muss das Original im Canvas nicht sein

const canvasBild = hole("bild");
const ctxBild = canvasBild.getContext("2d");

export let dateiName = "bild";
export let originalBild = null; // wird vom Kreislauf ersetzt (setzeOriginal)
export let fotoBild = null; // das Bild aus der Datei, bleibt bis zum nächsten Öffnen
export let rastertBild = null;

export async function ladeBild(datei) {
  const bild = await createImageBitmap(datei); // wirft bei Nicht-Bildern -> catch in main.js
  // erst wenn es geklappt hat: sonst hätte das alte Bild schon den neuen Namen
  originalBild = bild;
  fotoBild = bild;
  dateiName = datei.name.replace(/\.[^.]+$/, "");
}

export function rastere(spalten, zeilen, invertieren) {
  rastertBild = new Float32Array(spalten * zeilen);

  const canvas = document.createElement("canvas");
  canvas.width = spalten;
  canvas.height = zeilen;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(originalBild, 0, 0, spalten, zeilen); // rastert selber
  const data = ctx.getImageData(0, 0, spalten, zeilen).data;

  for (let y = 0; y < zeilen; y++) {
    for (let x = 0; x < spalten; x++) {
      const p = (y * spalten + x) * 4; // 4 werte Springen mit Pixel
      const luminanz = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
      const zeile = zeilen - 1 - y; // im Bild oben = hohe Frequenz, also umdrehen
      // danach beim zeichnen wieder umdrehen
      // umdrehen nur weil die unteren Zeilen im Canvas y-Werte nah an zeilen - 1 haben,
      // aber für die Frequenzen diese Zeile nah 0 (tief) sein sollen
      rastertBild[x * zeilen + zeile] = invertieren ? 1 - luminanz : luminanz;
    }
  }
  return rastertBild;
}

// alles außerhalb von ab bis bis auf 0 (still); ändert das Raster direkt
export function schneide(raster, ab, bis) {
  for (let i = 0; i < raster.length; i++) {
    if (raster[i] < ab || raster[i] > bis) raster[i] = 0;
  }
}

// das Raster so, wie es klingt: ein Canvas-Pixel pro Rasterpunkt, in der gewählten Farbskala
export function zeigeRaster(spalten, zeilen, raster = rastertBild, ziel = canvasBild) {
  ziel.width = spalten;
  ziel.height = zeilen;
  const c = ziel.getContext("2d");
  const bildDaten = c.createImageData(spalten, zeilen);
  const pixel = bildDaten.data;
  for (let y = 0; y < zeilen; y++) {
    for (let x = 0; x < spalten; x++) {
      const v = Math.round(raster[x * zeilen + (zeilen - 1 - y)] * 255); // 0–255 wie im Spektrogramm
      const p = (y * spalten + x) * 4;
      pixel[p] = farbenZahlen[v * 3]; // rot
      pixel[p + 1] = farbenZahlen[v * 3 + 1]; // grün
      pixel[p + 2] = farbenZahlen[v * 3 + 2]; // blau
      pixel[p + 3] = 255;
    }
  }
  c.putImageData(bildDaten, 0, 0);
}

export function zeigeOriginal(verhaeltnis, invertieren) {
  const wunschBreite = originalBild.height * verhaeltnis; // Höhe bleibt, Breite folgt dem Verhältnis
  const faktor = Math.min(1, MAX_GROESSE / wunschBreite, MAX_GROESSE / originalBild.height); // nie vergrößern
  const breite = Math.round(wunschBreite * faktor);
  const hoehe = Math.round(originalBild.height * faktor);
  canvasBild.width = breite;
  canvasBild.height = hoehe;
  ctxBild.imageSmoothingQuality = "high";
  ctxBild.drawImage(originalBild, 0, 0, breite, hoehe); 
  if (invertieren) {
    // Negativ: "difference" malt |Bild − Weiß| = 255 - Bild, für jeden Farbkanal
    ctxBild.globalCompositeOperation = "difference";
    ctxBild.fillStyle = "#ffffff";
    ctxBild.fillRect(0, 0, breite, hoehe);
    ctxBild.globalCompositeOperation = "source-over"; // zurück auf normales Übermalen
  }
}

// neues Original von außen (Kreislauf)
export function setzeOriginal(bild) {
  originalBild = bild;
}

// umkehren: 1 − Helligkeit, damit "invertieren" beim nächsten Rastern sich wieder aufhebt
export function rasterAlsBild(raster, spalten, zeilen, umkehren) {
  const canvas = document.createElement("canvas");
  canvas.width = spalten;
  canvas.height = zeilen;
  const ctx = canvas.getContext("2d");
  const bildDaten = ctx.createImageData(spalten, zeilen);
  const pixel = bildDaten.data;
  for (let y = 0; y < zeilen; y++) {
    for (let x = 0; x < spalten; x++) {
      let v = raster[x * zeilen + (zeilen - 1 - y)]; // wieder umdrehen: Zeile 0 (tief) nach unten
      if (umkehren) v = 1 - v;
      const grau = Math.round(v * 255);
      const p = (y * spalten + x) * 4;
      pixel[p] = grau;
      pixel[p + 1] = grau;
      pixel[p + 2] = grau;
      pixel[p + 3] = 255;
    }
  }
  ctx.putImageData(bildDaten, 0, 0);
  return createImageBitmap(canvas); 
}
