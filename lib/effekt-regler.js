// Regler für VHS und CRT an einer Stelle: die Werte (min, max, Startwert …) stehen beim Shader
// (VHS_REGLER in effekte/vhs.js, CRT_REGLER in effekte/crt.js), hier wird daraus das HTML gebaut.
// Vorher stand dasselbe HTML (je ~150 Zeilen) in vier Seiten und musste viermal geändert werden.
//
// Im HTML der Seite steht nur ein Platzhalter:
//   <div data-effekt-regler="vhs"></div>
//   <div data-effekt-regler="crt"></div>
//
// daraus wird (wie bisher von Hand geschrieben, ids und data-regler bleiben gleich):
//   <div class="steuerung"><label><input type="checkbox" id="vhs-an"> VHS</label></div>
//   <div class="regler-gruppen" id="vhs-regler" hidden>
//     <details class="regler-gruppe">
//       <summary>Band</summary>
//       <div class="steuerung">
//         <label>Wackeln <input type="range" data-regler="vhs.wackeln" …><output></output></label>
//         …
//
// Gebaut wird sofort beim Import. Module laufen erst, wenn das HTML fertig gelesen ist, und alles,
// was diese Datei importiert (effekt-schicht.js, die Foto-Effekte), läuft erst danach:
// hole("vhs-an") findet das Häkchen also schon.

import { VHS_REGLER } from "/lib/effekte/vhs.js";
import { CRT_REGLER } from "/lib/effekte/crt.js";

const EFFEKTE = {
  vhs: { name: "VHS", gruppen: VHS_REGLER },
  crt: { name: "CRT", gruppen: CRT_REGLER },
};

// kleines Hilfsmittel: Element mit Klasse und Inhalt
function element(tag, klasse, ...kinder) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  e.append(...kinder);
  return e;
}

function baueRegler(effekt, r) {
  const feld = document.createElement("input");
  feld.type = "range";
  feld.dataset.regler = `${effekt}.${r.name}`; // "vhs.wackeln": verbindeRegler legt den Wert unter werte.vhs.wackeln ab
  feld.min = r.min;
  feld.max = r.max;
  feld.step = r.schritt;
  feld.value = r.wert; // nach min/max/step setzen, sonst schneidet der Browser den Wert am Standard-Bereich 0–100 ab
  return element("label", null, r.text, feld, document.createElement("output"));
}

function baue(platz) {
  const effekt = platz.dataset.effektRegler; // data-effekt-regler="vhs" → dataset.effektRegler
  const { name, gruppen } = EFFEKTE[effekt];

  const schalter = document.createElement("input");
  schalter.type = "checkbox";
  schalter.id = `${effekt}-an`;

  const alleGruppen = element("div", "regler-gruppen");
  alleGruppen.id = `${effekt}-regler`;
  alleGruppen.hidden = true;
  for (const g of gruppen) {
    const steuerung = element("div", "steuerung", ...g.regler.map((r) => baueRegler(effekt, r)));
    alleGruppen.append(element("details", "regler-gruppe", element("summary", null, g.gruppe), steuerung));
  }

  // Häkchen zeigt und versteckt die Regler (wie data-zeigt in script.js; das läuft aber schon vor diesem Modul)
  schalter.addEventListener("change", () => {
    alleGruppen.hidden = !schalter.checked;
  });

  platz.replaceWith(element("div", "steuerung", element("label", null, schalter, ` ${name}`)), alleGruppen);
}

document.querySelectorAll("[data-effekt-regler]").forEach(baue);

// Alle Regler mit data-regler="effekt.name" mit einem Werte-Objekt verbinden:
// werte.vhs.wackeln = Zahl im Regler, das <output> dahinter zeigt sie, bei jeder Änderung beiAenderung().
// Gilt auch für eigene Regler der Seite (z. B. rahmen.abstand bei den Foto-Effekten),
// solange werte den Effekt kennt ({ vhs: {}, crt: {}, rahmen: {} }).
export function verbindeRegler(werte, beiAenderung = () => {}) {
  document.querySelectorAll("[data-regler]").forEach((feld) => {
    const [effekt, name] = feld.dataset.regler.split(".");
    const anzeige = feld.nextElementSibling;

    const lies = () => {
      werte[effekt][name] = Number(feld.value);
      anzeige.textContent = feld.value;
    };

    lies();
    feld.addEventListener("input", () => {
      lies();
      beiAenderung();
    });
  });
}
