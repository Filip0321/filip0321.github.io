import { crtProgramm } from "../../lib/effekte/crt.js";
import { vhsProgramm } from "../../lib/effekte/vhs.js";
import { farbverlaufProgramm, farbverlaufTextur } from "../../lib/effekte/farbverlauf.js";
import { verkleinern, vergroessern, dithern } from "./effekte/pixel.js";
import { fensterUmsBild } from "./effekte/rahmen.js";
import { zeichneOverlay } from "./effekte/overlay.js";
import { gl, rendere, zurueckholen } from "../../lib/webgl.js";
import { zustand } from "./zustand.js";
import { SAMMLUNG } from "../../lib/effekte/sammlung.js";
import { programmVon } from "../../lib/effekte/hilfen.js";

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
  farbverlauf: {
    name: "Farbverlauf",
    gpu: true,
    an: () => zustand.farbverlaufAn && gl,
    programm: farbverlaufProgramm,
    // die Textur geht mit: rendere (webgl.js) legt sie auf Platz 1 für "uniform sampler2D verlauf"
    einstellungen: () => ({ ...zustand.werte.farbverlauf, verlauf: farbverlaufTextur }),
  },
  vhs: {
    name: "VHS",
    gpu: true,
    zeitabhaengig: true,
    an: () => zustand.vhsAn && gl,
    programm: vhsProgramm,
    einstellungen: (zeit) => ({ ...zustand.werte.vhs, zeit }),
  },
  crt: {
    name: "CRT",
    gpu: true,
    zeitabhaengig: true,
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

// Die Sammlung (/lib/effekte/sammlung.js): jeder Effekt bekommt einen Eintrag wie die oben.
// an: das Häkchen, das sammlung-ui.js baut (id "<effekt>-an"); die Werte der Regler liegen in zustand.werte
for (const def of SAMMLUNG) {
  EFFEKTE[def.id] = {
    name: def.name,
    gpu: !def.cpu,
    zeitabhaengig: Boolean(def.zeitabhaengig),
    lebendig: Boolean(def.lebendig), // bewegt sich auch auf einem Foto (main.js rechnet dann laufend neu)
    an: () => Boolean(document.getElementById(`${def.id}-an`)?.checked) && Boolean(def.cpu || gl),
    get programm() {
      return programmVon(def); // erst beim ersten Gebrauch übersetzt
    },
    einstellungen: (zeit) => (def.einstellungen ? def.einstellungen(zustand.werte[def.id], zeit) : { ...zustand.werte[def.id], zeit }),
    anwenden: def.cpu ? (bild, zeit) => def.cpu(bild, zustand.werte[def.id], zeit) : undefined,
    nachher: def.nachher, // Feedback merkt sich hier sein Bild
  };
}

// Die Kette: Reihenfolge der Effekte, später umsortierbar
// overlay kommt mit kette.push() erst beim laden
export const kette = [
  { typ: "pixel" },
  { typ: "farbverlauf" },
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
  effekt.nachher?.();
  return zurueckholen(bild.width, bild.height);
}

// gibt die Effekte zurück, dessen "an" Funktion "true" zurückgibt
// geht kette durch und nimmt string von typ um in EFFEKTE zu suchen
export function aktiveSchritte() {
  return kette.filter((schritt) => EFFEKTE[schritt.typ].an());
}

export function wendeEffekteAn(eingabe, zeit, schritte = aktiveSchritte()) {
  let bild = eingabe;
  for (const schritt of schritte) {
    bild = wendeSchrittAn(schritt, bild, zeit);
  }
  return bild;
}

// Effekte der Sammlung kommen erst in die Kette, wenn ihr Häkchen an ist (sonst wäre die Liste unter
// „Reihenfolge“ dreißig Einträge lang): vor das Fenster und das CRT, die am Schluss stehen sollen
export function nimmAuf(typ) {
  if (kette.some((schritt) => schritt.typ === typ)) return;
  const stelle = kette.findIndex((schritt) => schritt.typ === "rahmen");
  kette.splice(stelle < 0 ? kette.length : stelle, 0, { typ });
}

export function nimmRaus(typ) {
  const stelle = kette.findIndex((schritt) => schritt.typ === typ);
  if (stelle >= 0) kette.splice(stelle, 1);
}

export function tausche(i, j) {
    if (j < 0 || j >= kette.length) return;
    [kette[i], kette[j]] = [kette[j], kette[i]]; // tauschen
    return true;
}

export function istZeitabhaengig(schritt) {
  return Boolean(EFFEKTE[schritt.typ].zeitabhaengig || schritt.folge);
}
