// Bedienung für die Sammlung (/lib/effekte/sammlung.js): pro Gruppe ein aufklappbarer Abschnitt, darin
// pro Effekt ein Häkchen mit seinen Reglern. Häkchen und Regler baut dieselbe Funktion wie für VHS und CRT
// (/lib/effekt-regler.js), damit alles gleich aussieht und verbindeRegler die Werte findet.

import { SAMMLUNG } from "/lib/effekte/sammlung.js";
import { baueEffektRegler } from "/lib/effekt-regler.js";

// Liegt in /lib, weil auch effekt-schicht.js (Attraktoren, Game of Life, Fraktale) die Sammlung anbietet.
// ziel: wohin die Gruppen kommen; werte: die Werte der Regler (bekommt für jeden Effekt ein leeres Objekt);
// beiSchalter(id, an): ein Häkchen wurde umgelegt; nurGpu: ohne die Canvas-Effekte (für reine Shader-Ketten)
export function baueSammlung(ziel, werte, beiSchalter = () => {}, { nurGpu = false } = {}) {
  const gruppen = new Map();
  for (const def of SAMMLUNG) {
    if (nurGpu && !def.shader) continue; // Camcorder hat beides: in der Shader-Kette ohne Schrift
    werte[def.id] ??= {};
    if (!gruppen.has(def.gruppe)) {
      const abschnitt = document.createElement("details");
      abschnitt.className = "regler-gruppe";
      const titel = document.createElement("summary");
      titel.textContent = def.gruppe;
      abschnitt.append(titel);
      ziel.append(abschnitt);
      gruppen.set(def.gruppe, abschnitt);
    }
    const platz = document.createElement("div");
    platz.dataset.effektRegler = def.id;
    gruppen.get(def.gruppe).append(platz);
    baueEffektRegler(platz, { name: def.name, gruppen: def.regler });
    const schalter = document.getElementById(`${def.id}-an`);
    schalter.addEventListener("change", () => beiSchalter(def.id, schalter.checked));
  }
}
