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
// Steht im Platzhalter schon etwas (z. B. die Auswahl des Verlaufs), kommt es mit in die Gruppe,
// die das Häkchen zeigt und versteckt: <div data-effekt-regler="farbverlauf"> eigene Felder </div>
//
// Gebaut wird sofort beim Import. Module laufen erst, wenn das HTML fertig gelesen ist, und alles,
// was diese Datei importiert (effekt-schicht.js, die Foto-Effekte), läuft erst danach:
// hole("vhs-an") findet das Häkchen also schon.

import { VHS_REGLER } from "/lib/effekte/vhs.js";
import { CRT_REGLER } from "/lib/effekte/crt.js";
import { FARBVERLAUF_REGLER } from "/lib/effekte/farbverlauf.js";

const EFFEKTE = {
  vhs: { name: "VHS", gruppen: VHS_REGLER },
  crt: { name: "CRT", gruppen: CRT_REGLER },
  farbverlauf: { name: "Farbverlauf", gruppen: FARBVERLAUF_REGLER },
};

// kleines Hilfsmittel: Element mit Klasse und Inhalt
function element(tag, klasse, ...kinder) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  e.append(...kinder);
  return e;
}

// wer im System „Bewegung reduzieren“ eingestellt hat, bekommt bei flackernden Reglern den ruhigeren
// Startwert (r.ruhig), falls der Effekt einen angibt
const ruhig = matchMedia("(prefers-reduced-motion: reduce)").matches;

function baueRegler(effekt, r) {
  // Text statt Zahl: r.eingabe = true (eigener Text beim Zeitungspapier). Der Wert ist der Text selbst;
  // der Effekt macht in seinen einstellungen() daraus, was der Shader braucht (verbindeRegler liest ihn als Text)
  if (r.eingabe) {
    const feld = document.createElement("textarea");
    feld.dataset.regler = `${effekt}.${r.name}`;
    feld.dataset.text = "";
    feld.rows = r.zeilen ?? 3;
    feld.value = r.wert ?? "";
    feld.placeholder = r.platzhalter ?? "";
    const leer = document.createElement("output");
    leer.hidden = true;
    const label = element("label", "text-eingabe", r.text, feld, leer);
    return label;
  }
  // Auswahl statt Regler: r.auswahl = ["Game Boy", "CGA", …], der Wert ist die Nummer (0, 1, 2 …),
  // damit verbindeRegler ihn wie jeden Regler als Zahl liest. Das <output> bleibt leer und versteckt.
  if (r.auswahl) {
    const wahl = document.createElement("select");
    wahl.dataset.regler = `${effekt}.${r.name}`;
    r.auswahl.forEach((text, i) => wahl.append(new Option(text, i, false, i === (r.wert ?? 0))));
    const leer = document.createElement("output");
    leer.hidden = true;
    return element("label", null, r.text, wahl, leer);
  }
  const feld = document.createElement("input");
  feld.type = "range";
  feld.dataset.regler = `${effekt}.${r.name}`; // "vhs.wackeln": verbindeRegler legt den Wert unter werte.vhs.wackeln ab
  feld.min = r.min;
  feld.max = r.max;
  feld.step = r.schritt;
  feld.value = ruhig && r.ruhig !== undefined ? r.ruhig : r.wert; // nach min/max/step setzen, sonst schneidet der Browser den Wert am Standard-Bereich 0–100 ab
  return element("label", null, r.text, feld, document.createElement("output"));
}

// Vorlagen (z. B. Geräte beim CRT): { "Trinitron": { woelbung: 0.04, … }, … } in einer Gruppe. Eine Wahl stellt
// die Regler dieses Effekts auf die Werte der Vorlage und meldet jeden wie eine Bewegung von Hand („input“),
// damit verbindeRegler die Werte übernimmt; danach darf man weiterdrehen.
function baueVorlagen(effekt, vorlagen, wurzel) {
  const wahl = document.createElement("select");
  wahl.append(new Option("eigene Einstellung", ""));
  for (const name of Object.keys(vorlagen)) wahl.append(new Option(name, name));
  wahl.addEventListener("change", () => {
    const werte = vorlagen[wahl.value];
    if (!werte) return;
    for (const [name, wert] of Object.entries(werte)) {
      const feld = wurzel.querySelector(`[data-regler="${effekt}.${name}"]`);
      if (!feld) continue;
      feld.value = wert;
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      feld.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  return element("label", null, "Gerät", wahl);
}

// def: { name, gruppen } für Effekte, die nicht oben in EFFEKTE stehen (die Sammlung der Foto-Effekte
// baut ihre Plätze selbst und ruft baueEffektRegler damit auf)
export function baueEffektRegler(platz, def = EFFEKTE[platz.dataset.effektRegler]) {
  const effekt = platz.dataset.effektRegler; // data-effekt-regler="vhs" → dataset.effektRegler
  const { name, gruppen } = def;

  const schalter = document.createElement("input");
  schalter.type = "checkbox";
  schalter.id = `${effekt}-an`;

  const alleGruppen = element("div", "regler-gruppen");
  alleGruppen.id = `${effekt}-regler`;
  alleGruppen.hidden = true;
  alleGruppen.append(...platz.childNodes); // eigene Felder aus dem Platzhalter zuerst (verschieben, ids bleiben)
  for (const g of gruppen) {
    const steuerung = element("div", "steuerung", ...g.regler.map((r) => baueRegler(effekt, r)));
    if (g.vorlagen) steuerung.append(baueVorlagen(effekt, g.vorlagen, alleGruppen));
    alleGruppen.append(element("details", "regler-gruppe", element("summary", null, g.gruppe), steuerung));
  }

  // Häkchen zeigt und versteckt die Regler (wie data-zeigt in script.js; das läuft aber schon vor diesem Modul)
  schalter.addEventListener("change", () => {
    alleGruppen.hidden = !schalter.checked;
  });

  platz.replaceWith(element("div", "steuerung", element("label", null, schalter, ` ${name}`)), alleGruppen);
}

// nur die, die hier bekannt sind; die anderen baut, wer sie kennt
document.querySelectorAll("[data-effekt-regler]").forEach((platz) => {
  if (EFFEKTE[platz.dataset.effektRegler]) baueEffektRegler(platz);
});

// Alle Regler mit data-regler="effekt.name" mit einem Werte-Objekt verbinden:
// werte.vhs.wackeln = Zahl im Regler, das <output> dahinter zeigt sie, bei jeder Änderung beiAenderung().
// Gilt auch für eigene Regler der Seite (z. B. rahmen.abstand bei den Foto-Effekten),
// solange werte den Effekt kennt ({ vhs: {}, crt: {}, rahmen: {} }).
// wurzel: nur die Regler darin (für Kopien eines Effekts, die später dazukommen: sonst bekämen die schon
// verbundenen Regler einen zweiten Zuhörer)
export function verbindeRegler(werte, beiAenderung = () => {}, wurzel = document) {
  wurzel.querySelectorAll("[data-regler]").forEach((feld) => {
    const [effekt, name] = feld.dataset.regler.split(".");
    werte[effekt] ??= {};
    const anzeige = feld.nextElementSibling;

    const lies = () => {
      if (feld.dataset.text !== undefined) {
        werte[effekt][name] = feld.value; // Text bleibt Text
        return;
      }
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

