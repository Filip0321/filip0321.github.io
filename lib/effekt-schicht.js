import { gl, rendere, glCanvas } from "/lib/webgl.js";
import { crtProgramm, crtAnteil } from "/lib/effekte/crt.js";
import { vhsProgramm } from "/lib/effekte/vhs.js";
import { verbindeRegler } from "/lib/effekt-regler.js"; // baut die Regler für VHS und CRT ins HTML
import { SAMMLUNG } from "/lib/effekte/sammlung.js";
import { programmVon } from "/lib/effekte/hilfen.js";
import { baueSammlung } from "/lib/effekte/sammlung-ui.js";
import { meldeEffekte } from "/lib/export-dialog.js";

const quelle = hole("feld");
const schicht = hole("effekte");
const schichtCtx = schicht.getContext("2d");

const werte = { vhs: {}, crt: {} };

// Die Effekte in ihrer Reihenfolge: erst VHS, dann CRT
// zeit: Sekunden, jeder Shader bekommt sie unter seinem Namen
const EFFEKTE = [
  {
    id: "vhs",
    name: "VHS",
    schalter: hole("vhs-an"),
    programm: vhsProgramm,
    einstellungen: (zeit) => ({ ...werte.vhs, zeit }),
  },
  {
    id: "crt",
    name: "CRT",
    schalter: hole("crt-an"),
    programm: crtProgramm,
    einstellungen: (zeit) => ({ ...werte.crt, zufall: zeit }),
  },
];

// Die Sammlung der Foto-Effekte (nur die Shader): steht auf der Seite ein <div id="sammlung">, kommen ihre
// Häkchen und Regler dorthin, und die Effekte reihen sich zwischen VHS und CRT ein (CRT bleibt der letzte,
// sonst liegen die gewölbten Ränder unter anderen Effekten)
const sammlungPlatz = document.getElementById("sammlung");
if (sammlungPlatz && gl) {
  baueSammlung(sammlungPlatz, werte, () => {}, { nurGpu: true });
  const neue = SAMMLUNG.filter((def) => def.shader).map((def) => ({
    id: def.id,
    name: def.name,
    schalter: hole(`${def.id}-an`),
    get programm() {
      return programmVon(def); // erst beim ersten Gebrauch übersetzt
    },
    einstellungen: (zeit) => (def.einstellungen ? def.einstellungen(werte[def.id], zeit) : { ...werte[def.id], zeit }),
    nachher: def.nachher, // Feedback merkt sich sein Bild
  }));
  EFFEKTE.splice(1, 0, ...neue); // nach VHS, vor CRT
}

// Ohne WebGL2 keine Shader
if (!gl) {
  for (const effekt of EFFEKTE) {
    effekt.schalter.disabled = true;
    effekt.schalter.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
  }
}


// Regler lesen: die Regler selbst baut effekt-regler.js (beim Import, also schon fertig)
verbindeRegler(werte);

// im Export-Fenster dieselben Effekte zum An- und Ausschalten (/lib/export-dialog.js)
if (gl) {
  meldeEffekte({
    liste: () => EFFEKTE.map((e) => ({ id: e.id, name: e.name, an: e.schalter.checked })),
    setze(id, an) {
      const e = EFFEKTE.find((x) => x.id === id);
      e.schalter.checked = an;
      e.schalter.dispatchEvent(new Event("change")); // Regler auf der Seite zeigen oder verstecken
    },
  });
}

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
    effekt.nachher?.();
    schichtCtx.drawImage(glCanvas, 0, 0);
    eingabe = schicht;                  // jeder weitere liest das Ergebnis davor
  }
  return schicht;
}

// CRT gerade abschneiden (für den Export): welcher Anteil mittig bleibt, null = nichts abzuschneiden
// (die Rechnung steht bei der Wölbung selbst, in /lib/effekte/crt.js)
export function crtZuschnitt() {
  if (!gl || !EFFEKTE.at(-1).schalter.checked) return null;
  if (werte.crt.randWeg > 0.5) return null; // schon im Shader weggezoomt: nichts abzuschneiden
  return crtAnteil(werte.crt.woelbung ?? 0);
}

// Was gerade auf dem Bildschirm zu sehen ist, ohne neu zu rechnen
export function sichtbaresBild() {
  return schicht.hidden ? quelle : schicht;
}


// Schleife für die Anzeige
// angehalten: die Seite rechnet selbst (z. B. Fraktale „Groß rechnen“: ein riesiges Bild, das nicht 60-mal pro
// Sekunde durch die Effekte soll; das Export-Fenster ruft endbild dann nur, wenn es neu zeichnet)
let angehalten = false;
export function halteSchichtAn(an) {
  angehalten = an;
}

function schritt(zeitpunkt) {
  requestAnimationFrame(schritt);
  if (angehalten) return;

  const an = aktiveEffekte().length > 0;
  schicht.hidden = !an;
  if (an) endbild(zeitpunkt / 1000);
}

requestAnimationFrame(schritt);

