import { gl, rendere, glCanvas } from "/lib/webgl.js";
import { crtProgramm } from "/lib/effekte/crt.js";
import { vhsProgramm } from "/lib/effekte/vhs.js";

const quelle = hole("feld");
const schicht = hole("effekte");
const schichtCtx = schicht.getContext("2d");

const werte = { vhs: {}, crt: {} };

// Die Effekte in ihrer Reihenfolge: erst VHS, dann CRT
// zeit: Sekunden seit dem Laden, jeder Shader bekommt sie unter seinem Namen
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


// Schleife

function schritt(zeitpunkt) {
  requestAnimationFrame(schritt);

  const aktive = EFFEKTE.filter((effekt) => effekt.schalter.checked);
  schicht.hidden = aktive.length === 0;
  if (aktive.length === 0) return;

  const w = quelle.width;
  const h = quelle.height;
  if (schicht.width !== w || schicht.height !== h) {
    schicht.width = w;
    schicht.height = h;
  }

  const zeit = zeitpunkt / 1000;
  let eingabe = quelle;                 // der erste Effekt liest das Original

  for (const effekt of aktive) {
    rendere(effekt.programm, eingabe, w, h, effekt.einstellungen(zeit));
    schichtCtx.drawImage(glCanvas, 0, 0);
    eingabe = schicht;                  // jeder weitere liest das Ergebnis davor
  }
}

requestAnimationFrame(schritt);