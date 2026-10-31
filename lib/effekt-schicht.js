import { gl, rendere, glCanvas } from "/lib/webgl.js";
import { crtProgramm, crtAnteil } from "/lib/effekte/crt.js";
import { vhsProgramm } from "/lib/effekte/vhs.js";
import { verbindeRegler } from "/lib/effekt-regler.js"; // baut die Regler für VHS und CRT ins HTML

const quelle = hole("feld");
const schicht = hole("effekte");
const schichtCtx = schicht.getContext("2d");

const werte = { vhs: {}, crt: {} };

// Die Effekte in ihrer Reihenfolge: erst VHS, dann CRT
// zeit: Sekunden, jeder Shader bekommt sie unter seinem Namen
const EFFEKTE = [
  {
    schalter: hole("vhs-an"),
    programm: vhsProgramm,
    einstellungen: (zeit) => ({ ...werte.vhs, zeit }),
  },
  {
    schalter: hole("crt-an"),
    programm: crtProgramm,
    einstellungen: (zeit) => ({ ...werte.crt, zufall: zeit }),
  },
];

// Ohne WebGL2 keine Shader
if (!gl) {
  for (const effekt of EFFEKTE) {
    effekt.schalter.disabled = true;
    effekt.schalter.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
  }
}


// Regler lesen: die Regler selbst baut effekt-regler.js (beim Import, also schon fertig)
verbindeRegler(werte);

function aktiveEffekte() {
  if (!gl) return [];
  return EFFEKTE.filter((effekt) => effekt.schalter.checked);
}

// Rechnet die Effekte für eine Zeit (Sekunden) und gibt den Canvas
// mit dem fertigen Bild zurück: ohne Effekte das Feld selbst
export function endbild(zeit) {
  const aktive = aktiveEffekte();
  if (aktive.length === 0) return quelle;

  const w = quelle.width;
  const h = quelle.height;
  if (schicht.width !== w || schicht.height !== h) {
    schicht.width = w;
    schicht.height = h;
  }

  let eingabe = quelle;                 // der erste Effekt liest das Original
  for (const effekt of aktive) {
    rendere(effekt.programm, eingabe, w, h, effekt.einstellungen(zeit));
    schichtCtx.drawImage(glCanvas, 0, 0);
    eingabe = schicht;                  // jeder weitere liest das Ergebnis davor
  }
  return schicht;
}

// CRT gerade abschneiden (für den Export): welcher Anteil mittig bleibt, null = nichts abzuschneiden
// (die Rechnung steht bei der Wölbung selbst, in /lib/effekte/crt.js)
export function crtZuschnitt() {
  if (!gl || !EFFEKTE[1].schalter.checked) return null;
  return crtAnteil(werte.crt.woelbung ?? 0);
}

// Was gerade auf dem Bildschirm zu sehen ist, ohne neu zu rechnen
export function sichtbaresBild() {
  return schicht.hidden ? quelle : schicht;
}


// Schleife für die Anzeige

function schritt(zeitpunkt) {
  requestAnimationFrame(schritt);

  const an = aktiveEffekte().length > 0;
  schicht.hidden = !an;
  if (an) endbild(zeitpunkt / 1000);
}

requestAnimationFrame(schritt);
