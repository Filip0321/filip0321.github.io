// Gemalte Stellen für das Datamosh-Imitat (licht.js): ein Graubild 512 × 512, weiß = hier bewegen.
// Es liegt in Bildkoordinaten (0 bis 1), passt also zu jedem Seitenverhältnis. Die Foto-Effekte malen
// hinein (main.js, „Bereich malen“); auf der Grafikkarte wird es erst neu hochgeladen, wenn sich etwas
// geändert hat.

import { gl } from "../webgl.js";

const GROESSE = 512;
const leinwand = document.createElement("canvas");
leinwand.width = leinwand.height = GROESSE;
const ctx = leinwand.getContext("2d");
let textur = null;
let geaendert = false;
let leer = true;

// u, v: 0 bis 1, v von oben; radius als Anteil der Bildhöhe; wegnehmen: radieren statt malen
export function male(u, v, radius, wegnehmen = false) {
  ctx.globalCompositeOperation = wegnehmen ? "destination-out" : "source-over";
  // weicher Pinsel: innen weiß, außen durchsichtig, damit die Ränder fließen statt zu springen
  const r = radius * GROESSE;
  const verlauf = ctx.createRadialGradient(u * GROESSE, v * GROESSE, 0, u * GROESSE, v * GROESSE, r);
  verlauf.addColorStop(0, "rgba(255, 255, 255, 1)");
  verlauf.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = verlauf;
  ctx.beginPath();
  ctx.arc(u * GROESSE, v * GROESSE, r, 0, Math.PI * 2);
  ctx.fill();
  geaendert = true;
  leer = false;
}

export function loescheMaske() {
  ctx.clearRect(0, 0, GROESSE, GROESSE);
  geaendert = true;
  leer = true;
}

// die Textur (oder null, solange nichts gemalt ist); der Shader liest .r
export function moshMaske() {
  if (leer || !gl) return null;
  if (!textur) {
    textur = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    geaendert = true;
  }
  if (geaendert) {
    // Alpha nach Rot: der Pinsel malt in den Alphakanal; weiß auf Schwarz für den Shader
    const bild = document.createElement("canvas");
    bild.width = bild.height = GROESSE;
    const b = bild.getContext("2d");
    b.fillStyle = "#000";
    b.fillRect(0, 0, GROESSE, GROESSE);
    b.drawImage(leinwand, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // wie das Bild in rendere: v = 0 unten
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bild);
    geaendert = false;
  }
  return textur;
}
