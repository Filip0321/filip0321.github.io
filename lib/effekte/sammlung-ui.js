// Bedienung für die Sammlung (/lib/effekte/sammlung.js): pro Gruppe ein aufklappbarer Abschnitt, darin
// pro Effekt ein Häkchen mit seinen Reglern. Häkchen und Regler baut dieselbe Funktion wie für VHS und CRT
// (/lib/effekt-regler.js), damit alles gleich aussieht und verbindeRegler die Werte findet.
//
// Dazu Kopien (instanzen.js): ⧉ neben einem angehakten Effekt legt ihn noch einmal an, mit den Werten, die er
// gerade hat, aber danach mit eigenen Reglern und eigenem Gedächtnis. Eine Kopie steht direkt unter ihrem
// Vorbild und hat ein × zum Entfernen.
//
// Und an jedem Effekt (außer Blob-Tracking selbst) der Regler „Bereich“: ganzes Bild, nur in den Rahmen von
// Blob-Tracking oder nur außerhalb (gerechnet wird das in der Kette, instanzen.js: mischeBereich).

import { SAMMLUNG } from "/lib/effekte/sammlung.js";
import { baueEffektRegler } from "/lib/effekt-regler.js";
import { neuerSchluessel, entferneKopie, nameVon, defVon } from "/lib/effekte/instanzen.js";
import { baueEffektMenue } from "/lib/effekte/effekt-menue.js";

const BEREICH = {
  gruppe: "Bereich",
  regler: [{ name: "bereich", text: "wirkt", auswahl: ["im ganzen Bild", "nur in den Blob-Rahmen", "nur außerhalb der Blob-Rahmen"], wert: 0 }],
};
const gruppenVon = (def) => (def.id === "blobs" ? def.regler : [...def.regler, BEREICH]);

// die Regler mit anderen Startwerten (für eine Kopie: die Werte des Vorbilds)
const mitWerten = (gruppen, w) => gruppen.map((g) => ({ ...g, regler: g.regler.map((r) => (w?.[r.name] !== undefined ? { ...r, wert: w[r.name] } : r)) }));

function knopf(text, titel, beiKlick) {
  const k = document.createElement("button");
  k.type = "button";
  k.textContent = text;
  k.title = titel;
  k.className = "klein";
  k.addEventListener("click", beiKlick);
  return k;
}

// ein kleiner Knopf rechts neben dem Häkchen, in derselben Zeile; nurWennAn: nur sichtbar, solange angehakt
// (sonst stünde unter jedem der dreißig Effekte ein Knopf)
function neben(schalter, k, nurWennAn) {
  const zeile = schalter.closest(".steuerung");
  zeile.classList.add("mit-knopf");
  zeile.append(k);
  if (!nurWennAn) return;
  const zeige = () => (k.hidden = !schalter.checked);
  schalter.addEventListener("change", zeige);
  zeige();
}

// Liegt in /lib, weil auch effekt-schicht.js (Attraktoren, Game of Life, Fraktale) die Sammlung anbietet.
// ziel: wohin die Gruppen kommen; werte: die Werte der Regler (bekommt für jeden Effekt ein leeres Objekt);
// beiSchalter(schluessel, an): ein Häkchen wurde umgelegt; nurGpu: ohne die Canvas-Effekte (für reine Shader-Ketten)
// beiKopie(schluessel, wurzel, vorbild): eine Kopie ist da (vorbild: wovon); wer die Sammlung benutzt, verbindet ihre Regler (wurzel)
//   und nimmt sie in seine Kette auf. Ohne beiKopie gibt es keine Kopien.
// beiEntfernen(schluessel): eine Kopie ist weg
// Gibt { kopiere(schluessel), entferne(schluessel) } zurück, damit auch die Reihenfolge-Liste kopieren kann.
// vorschauQuelle: () => Canvas, auf dem die Übersicht mit Bildern ihre Vorschau rechnet (effekt-menue.js)
export function baueSammlung(ziel, werte, beiSchalter = () => {}, { nurGpu = false, beiKopie = null, beiEntfernen = () => {}, vorschauQuelle } = {}) {
  const gruppen = new Map();
  baueEffektMenue(ziel, { vorschauQuelle, nurGpu });
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
    baueEffektRegler(platz, { name: def.name, gruppen: gruppenVon(def) });
    const schalter = document.getElementById(`${def.id}-an`);
    schalter.addEventListener("change", () => beiSchalter(def.id, schalter.checked));
    if (beiKopie) neben(schalter, knopf("⧉", `${def.name} kopieren: noch einmal, mit eigenen Werten`, () => kopiere(def.id)), true);
  }

  // eine Kopie von schluessel (dem Effekt selbst oder einer Kopie): Werte wie das Vorbild, Häkchen an
  function kopiere(vorbild) {
    const def = defVon(vorbild);
    if (!def || !beiKopie) return null;
    const schluessel = neuerSchluessel(def);
    // die Hülle hält Häkchen und Regler zusammen (baueEffektRegler ersetzt den Platz durch beides)
    const huelle = document.createElement("div");
    huelle.className = "effekt-kopie";
    const platz = document.createElement("div");
    platz.dataset.effektRegler = schluessel;
    huelle.append(platz);
    const nach = document.getElementById(`${vorbild}-regler`);
    (nach?.closest(".effekt-kopie") ?? nach)?.after(huelle);
    if (!huelle.isConnected) ziel.append(huelle);
    baueEffektRegler(platz, { name: nameVon(schluessel), gruppen: mitWerten(gruppenVon(def), werte[vorbild]) });
    werte[schluessel] = {};
    const schalter = document.getElementById(`${schluessel}-an`);
    schalter.addEventListener("change", () => beiSchalter(schluessel, schalter.checked));
    neben(schalter, knopf("×", `${nameVon(schluessel)} entfernen`, () => entferne(schluessel)), false);
    beiKopie(schluessel, huelle, vorbild);
    schalter.checked = true;
    schalter.dispatchEvent(new Event("change")); // zeigt die Regler und meldet beiSchalter
    // die Gruppe aufklappen, damit man die neue Kopie sieht
    const gruppe = huelle.closest("details.regler-gruppe");
    if (gruppe) gruppe.open = true;
    return schluessel;
  }

  function entferne(schluessel) {
    const schalter = document.getElementById(`${schluessel}-an`);
    if (!schalter) return;
    if (schalter.checked) beiSchalter(schluessel, false);
    schalter.closest(".effekt-kopie")?.remove();
    entferneKopie(schluessel);
    delete werte[schluessel];
    beiEntfernen(schluessel);
  }

  return { kopiere, entferne };
}
