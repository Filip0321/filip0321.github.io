import { canvas, ansicht } from "./seite.js";
import { anteilZuFrequenz, zeigeFrequenz } from "./frequenzen.js";
import { gesamtDb } from "./datei.js";
import { xZuZeit } from "./gesamtbild.js";

const mausInfo = hole("mausInfo"); 

const NOTEN = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

// A4 = 440 Hz (MIDI Note 69), jede Verdopplung eine Oktave = 12 Halbtöne 
// Also: Halbtöne über A4 = 12 * log2(f / 440)
export function notenName(f) {
  const midi = 69 + 12 * Math.log2(f / 440); 
  const naechste = Math.round(midi);
  const cent = Math.round((midi - naechste) * 100); 
  const oktave = Math.floor(naechste / 12) - 1; 
  const name = NOTEN[naechste % 12];
  const abweichung = cent === 0 ? "" : ` ${cent > 0 ? "+" : "−"}${Math.abs(cent)} ct`;
  return `${name}${oktave}${abweichung}`;
}

function zeigeZeit(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = (sekunden - m * 60).toFixed(1).replace(".", ",").padStart(4, "0");
  return `${m}:${s}`;
}

function zeigeInfo(event) {
  const rahmen = canvas.getBoundingClientRect();
  const x = event.clientX - rahmen.left; 
  const y = event.clientY - rahmen.top;
  if (x < 0 || y < 0 || x > rahmen.width || y > rahmen.height) {
    mausInfo.hidden = true;
    return;
  }
  const senkrecht = ansicht.value === "spektrogramm" || ansicht.value === "aufnahme";
  const anteil = senkrecht ? 1 - y / rahmen.height : x / rahmen.width;
  const f = anteilZuFrequenz(anteil);

  let text = `${zeigeFrequenz(f)} · ${notenName(f)}`;
  if (ansicht.value === "aufnahme" && gesamtDb) {
    text += ` · ${zeigeZeit(Math.max(0, xZuZeit(x * (canvas.width / rahmen.width))))}`;
  }
  mausInfo.textContent = text;
  mausInfo.hidden = false;
  mausInfo.style.left = `${x}px`;
  mausInfo.style.top = `${y}px`;
  mausInfo.classList.toggle("links", x > rahmen.width * 0.6); // am rechten Rand nach links klappen
}

canvas.addEventListener("pointermove", zeigeInfo);
canvas.addEventListener("pointerdown", zeigeInfo); // am Handy: beim Antippen
canvas.addEventListener("pointerleave", () => {
  mausInfo.hidden = true;
});
