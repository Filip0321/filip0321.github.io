import { crtProgramm } from "./effekte/crt.js";
import { vhsProgramm } from "../../lib/effekte/vhs.js";
import { verkleinern, vergroessern, dithern } from "./effekte/pixel.js";
import { fensterUmsBild } from "./effekte/rahmen.js";
import { zeichneOverlay } from "./effekte/overlay.js";
import { gl, rendere, zurueckholen } from "../../lib/webgl.js";
import { zustand } from "./zustand.js";

export const EFFEKTE = {
  pixel: {
    name: "Pixel & Dithering",
    gpu: false,
    an: () => zustand.pixelgroesse > 1 || zustand.ditherAn,
    anwenden(bild) {
      const w = bild.width;
      const h = bild.height;
      if (zustand.pixelgroesse > 1) bild = verkleinern(bild, zustand.pixelgroesse);
      if (zustand.ditherAn) bild = dithern(bild, zustand.stufen, zustand.grau);
      if (zustand.pixelgroesse > 1) bild = vergroessern(bild, zustand.pixelgroesse, w, h);
      return bild;
    },
  },
  vhs: {
    name: "VHS",
    gpu: true,
    an: () => zustand.vhsAn && gl,
    programm: vhsProgramm,
    einstellungen: (zeit) => ({ ...zustand.werte.vhs, zeit }),
  },
  crt: {
    name: "CRT",
    gpu: true,
    an: () => zustand.crtAn && gl,
    programm: crtProgramm,
    einstellungen: (zeit) => ({ ...zustand.werte.crt, zufall: zeit }),
  },
  overlay: {
    name: "Overlay",
    gpu: false,
    an: () => true,
    anwenden(bild, zeit, schritt) {
      return zeichneOverlay(bild, schritt);
    },  
  },
  rahmen: {
    name: "Fenster",
    gpu: false,
    an: () => zustand.rahmenAn,
    anwenden(bild) {
      return fensterUmsBild(bild, zustand.rahmenTitel);
    },
  },
};

// Die Kette: Reihenfolge der Effekte, später umsortierbar
// overlay kommt mit kette.push() erst beim laden
export const kette = [
  { typ: "pixel" },
  { typ: "vhs" },
  { typ: "rahmen" },
  { typ: "crt" },
];

function wendeSchrittAn(schritt, bild, zeit) {
  const effekt = EFFEKTE[schritt.typ];
  if (!effekt.gpu) return effekt.anwenden(bild, zeit, schritt);
  // ohne gpu, normale anwenden Funktion in EFFEKTE, die andern haben shader

  rendere(
    effekt.programm,
    bild,
    bild.width,
    bild.height,
    effekt.einstellungen(zeit),
  );
  return zurueckholen(bild.width, bild.height);
}

// gibt die Effekte zurück, dessen "an" Funktion "true" zurückgibt
// geht kette durch und nimmt string von typ um in EFFEKTE zu suchen
export function aktiveSchritte() {
  return kette.filter((schritt) => EFFEKTE[schritt.typ].an());
}

export function wendeEffekteAn(eingabe, zeit) {
  let bild = eingabe;
  for (const schritt of aktiveSchritte()) {
    bild = wendeSchrittAn(schritt, bild, zeit);
  }
  return bild;
}

export function tausche(i, j) {
    if (j < 0 || j >= kette.length) return;
    [kette[i], kette[j]] = [kette[j], kette[i]]; // tauschen
    return true;
}