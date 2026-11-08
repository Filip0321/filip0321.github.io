import { crtProgramm, crtEinstellungen, crtNachher } from "../../lib/effekte/crt.js";
import { vhsProgramm } from "../../lib/effekte/vhs.js";
import { farbverlaufProgramm, farbverlaufTextur } from "../../lib/effekte/farbverlauf.js";
import { verkleinern, vergroessern, dithern } from "./effekte/pixel.js";
import { fensterUmsBild } from "./effekte/rahmen.js";
import { zeichneOverlay } from "./effekte/overlay.js";
import { gl, rendere, zurueckholen } from "../../lib/webgl.js";
import { zustand } from "./zustand.js";
import { SAMMLUNG } from "../../lib/effekte/sammlung.js";
import { programmVon } from "../../lib/effekte/hilfen.js";
import { defVon, nameVon, gedaechtnisVon, mischeBereich } from "../../lib/effekte/instanzen.js";

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
    einstellungen: (zeit) => crtEinstellungen(zustand.werte.crt, zeit),
    nachher: crtNachher, // merkt sich das Bild (Halbbilder, Nachleuchten)
  },
  overlay: {
    name: "Overlay",
    gpu: false,
    an: () => true,
    anwenden(bild, zeit, schritt) {
      // eigene Effekte des Overlays (schritt.kette: Schlüssel von Kopien, instanzen.js), nur die angehakten
      const eigene = (schritt.kette ?? []).filter((s) => EFFEKTE[s]?.an()).map((s) => ({ typ: s }));
      return zeichneOverlay(bild, schritt, eigene.length ? (inhalt) => wendeEffekteAn(inhalt, zeit, eigene) : null);
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
// Kopien (/lib/effekte/instanzen.js) bekommen genauso einen Eintrag, unter ihrem Schlüssel ("feedback~2"),
// mit eigenen Werten und eigenem Gedächtnis g (Feedback merkt sich dort sein Bild)
export function registriere(schluessel) {
  const def = defVon(schluessel);
  const g = gedaechtnisVon(schluessel);
  EFFEKTE[schluessel] = {
    name: nameVon(schluessel),
    sammlung: true, // kann kopiert werden (Liste „Reihenfolge“)
    gpu: !def.cpu,
    zeitabhaengig: Boolean(def.zeitabhaengig),
    lebendig: Boolean(def.lebendig), // bewegt sich auch auf einem Foto (main.js rechnet dann laufend neu)
    an: () => Boolean(document.getElementById(`${schluessel}-an`)?.checked) && Boolean(def.cpu || gl),
    get programm() {
      return programmVon(def); // erst beim ersten Gebrauch übersetzt
    },
    einstellungen: (zeit) => (def.einstellungen ? def.einstellungen(zustand.werte[schluessel], zeit, g) : { ...zustand.werte[schluessel], zeit }),
    anwenden: def.cpu ? (bild, zeit) => def.cpu(bild, zustand.werte[schluessel], zeit, g) : undefined,
    nachher: def.nachher && (() => def.nachher(g)),
    bereich: () => zustand.werte[schluessel]?.bereich ?? 0, // 0 ganzes Bild, 1 in den Blob-Rahmen, 2 außerhalb
  };
}
for (const def of SAMMLUNG) registriere(def.id);

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
  // Bereich (nur in oder außerhalb der Blob-Rahmen): erst ganz rechnen, dann mit dem Bild davor mischen
  const bereich = effekt.bereich?.() ?? 0;
  if (bereich > 0.5) {
    // Kopie: manche CPU-Effekte schreiben in das Bild, das sie bekommen
    const davor = bild instanceof ImageData ? new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height) : bild;
    const neu = wendeGanzAn(effekt, schritt, bild, zeit);
    const c = mischeBereich(bereich, davor, neu);
    return c.getContext("2d").getImageData(0, 0, c.width, c.height);
  }
  return wendeGanzAn(effekt, schritt, bild, zeit);
}

function wendeGanzAn(effekt, schritt, bild, zeit) {
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
// nach: Typ, hinter den der neue Schritt soll (eine Kopie hinter ihr Vorbild); sonst vor das Fenster ums Bild
export function nimmAuf(typ, nach = null) {
  if (kette.some((schritt) => schritt.typ === typ)) return;
  const hinter = nach ? kette.findIndex((schritt) => schritt.typ === nach) : -1;
  if (hinter >= 0) return void kette.splice(hinter + 1, 0, { typ });
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
  // ein Overlay ist es auch, wenn einer seiner eigenen Effekte es ist
  const eigene = (schritt.kette ?? []).some((s) => EFFEKTE[s]?.an() && EFFEKTE[s].zeitabhaengig);
  return Boolean(EFFEKTE[schritt.typ].zeitabhaengig || schritt.folge || eigene);
}

