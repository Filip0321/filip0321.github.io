import { gl, rendere, glCanvas } from "/lib/webgl.js";
import { crtProgramm } from "/lib/effekte/crt.js";
import { vhsProgramm } from "/lib/effekte/vhs.js";

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


// Regler lesen

document.querySelectorAll("[data-regler]").forEach((feld) => {
  const [effekt, name] = feld.dataset.regler.split(".");
  const anzeige = feld.nextElementSibling;

  const lies = () => {
    werte[effekt][name] = Number(feld.value);
    anzeige.textContent = feld.value;
  };

  lies();
  feld.addEventListener("input", lies);
});


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

// CRT gerade abschneiden (für den Export): welcher Anteil der Breite und Höhe bleibt, mittig,
// damit nichts von den schwarzen, gewölbten Rändern übrig ist? null, wenn es nichts abzuschneiden gibt.
// Die Wölbung im Shader (Mitte 0, Rand ±1): x' = x · (1 + w · y²), y' = y · (1 + w · x²).
// Schwarz wird es, wo x' oder y' über 1 kommt; am knappsten ist es an den Ecken (s, s):
// die Ecke liegt gerade noch im Bild, wenn s · (1 + w · s²) = 1. Das lösen wir mit Newton
// (s so lange verbessern, bis es passt). w ≤ 0 wölbt nach innen, dort gibt es keine schwarzen Ränder.
export function crtZuschnitt() {
  if (!gl || !EFFEKTE[1].schalter.checked) return null;
  const w = werte.crt.woelbung ?? 0;
  if (w <= 0) return null;
  let s = 1;
  for (let i = 0; i < 20; i++) s -= (w * s ** 3 + s - 1) / (3 * w * s * s + 1); // f / f'
  return s;
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
