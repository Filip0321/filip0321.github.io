// Effekte nur im Export, für Projekte ohne eigene Effekte (Datamosh, Zeitquader, Chronofotografie, Video zu
// Ton …): dieselbe Sammlung wie überall (/lib/effekte/sammlung.js), mit Kopien und Reihenfolge, im Export-
// Fenster. Sie wirken auf das fertige Bild, bevor der Rahmen dazukommt (mitRahmen in export-dialog.js): in der
// Vorschau des Fensters, im gespeicherten Bild und in jedem Bild des Videos.
//
// Die Rechnung ist dieselbe wie in effekt-schicht.js (Attraktoren, Fraktale): Shader-Effekte auf der
// Grafikkarte (rendere in webgl.js), CPU-Effekte (Linien, Blob-Tracking) über getImageData, in der Reihenfolge
// der Kette, jeder liest das Ergebnis davor.
//
// Zeit: mitRahmen kennt keine Zeit. Darum zählt die Kette selbst mit, eine dreißigstel Sekunde pro Bild. Für
// Korn, Flackern und Feedback reicht das; ein Bild, das zweimal durch mitRahmen geht, ist eine Dreißigstel älter.

import { gl, rendere, glCanvas } from "/lib/webgl.js";
import { verbindeRegler } from "/lib/effekt-regler.js";
import { SAMMLUNG } from "/lib/effekte/sammlung.js";
import { programmVon } from "/lib/effekte/hilfen.js";
import { baueSammlung } from "/lib/effekte/sammlung-ui.js";
import { defVon, nameVon, gedaechtnisVon, mischeBereich } from "/lib/effekte/instanzen.js";
import { richteKetteEin } from "/lib/effekt-kette.js";

// kettePlatz: wohin die Reihenfolge kommt (im Fenster ein eigener Abschnitt); ohne: über die Sammlung
export function baueExportEffekte(platz, beiAenderung = () => {}, kettePlatz = null) {
  if (!gl) {
    platz.textContent = "Effekte brauchen WebGL2, das dein Browser nicht hat.";
    return { aktiv: () => false, anwenden: (q) => q };
  }
  const werte = {};
  const EFFEKTE = new Map();
  function registriere(schluessel) {
    const def = defVon(schluessel);
    const g = gedaechtnisVon(schluessel);
    EFFEKTE.set(schluessel, {
      name: nameVon(schluessel),
      cpu: def.cpu && !def.shader ? (bild, zeit) => def.cpu(bild, werte[schluessel], zeit, g) : null,
      programm: () => programmVon(def),
      einstellungen: (zeit) => (def.einstellungen ? def.einstellungen(werte[schluessel], zeit, g) : { ...werte[schluessel], zeit }),
      nachher: def.nachher && (() => def.nachher(g)),
    });
  }
  for (const def of SAMMLUNG) registriere(def.id);

  // Aufbau: kurzer Hinweis, die Reihenfolge, dann die Sammlung
  const hinweis = document.createElement("p");
  hinweis.className = "hinweis";
  hinweis.textContent = "Dieses Projekt hat keine eigenen Effekte: die hier wirken nur auf das, was gespeichert wird.";
  const reihenfolge = document.createElement("ol");
  reihenfolge.className = "kette";
  reihenfolge.setAttribute("aria-label", "Reihenfolge der Export-Effekte");
  const sammlungPlatz = document.createElement("div");
  platz.append(hinweis, sammlungPlatz);
  (kettePlatz ?? platz).prepend(reihenfolge);

  let sammlung = null;
  const ketteUi = richteKetteEin(reihenfolge, {
    name: (s) => EFFEKTE.get(s)?.name ?? s,
    kopierbar: () => true,
    beiKopie: (s) => sammlung.kopiere(s),
    beiAus: (s) => {
      const schalter = document.getElementById(`${s}-an`);
      schalter.checked = false;
      schalter.dispatchEvent(new Event("change"));
    },
    beiAenderung,
  });
  const kette = ketteUi.kette;

  sammlung = baueSammlung(
    sammlungPlatz,
    werte,
    (s, an) => {
      if (an) ketteUi.nimmAuf(s);
      else ketteUi.nimmRaus(s);
      beiAenderung();
    },
    {
      beiKopie(s, wurzel, vorbild) {
        registriere(s);
        verbindeRegler(werte, beiAenderung, wurzel);
        ketteUi.merkeNachbar(s, vorbild);
      },
      beiEntfernen: (s) => {
        EFFEKTE.delete(s);
        beiAenderung();
      },
    },
  );
  // nur die Regler hier im Fenster verbinden (die Seite hat ihre eigenen)
  verbindeRegler(werte, beiAenderung, platz);

  const ausgabe = document.createElement("canvas");
  const ausgabeCtx = ausgabe.getContext("2d", { willReadFrequently: true });
  let zeit = 0;

  function anwenden(quelle) {
    if (!kette.length) return quelle;
    const w = quelle.width;
    const h = quelle.height;
    if (ausgabe.width !== w || ausgabe.height !== h) {
      ausgabe.width = w;
      ausgabe.height = h;
    }
    let eingabe = quelle;
    for (const s of kette) {
      const effekt = EFFEKTE.get(s);
      if (!effekt) continue;
      const bereich = werte[s]?.bereich ?? 0;
      let vorher = null;
      if (bereich > 0.5) {
        vorher = document.createElement("canvas");
        vorher.width = w;
        vorher.height = h;
        vorher.getContext("2d").drawImage(eingabe, 0, 0, w, h);
      }
      if (effekt.cpu) {
        if (eingabe !== ausgabe) ausgabeCtx.drawImage(eingabe, 0, 0, w, h);
        ausgabeCtx.putImageData(effekt.cpu(ausgabeCtx.getImageData(0, 0, w, h), zeit), 0, 0);
      } else {
        rendere(effekt.programm(), eingabe, w, h, effekt.einstellungen(zeit));
        effekt.nachher?.();
        ausgabeCtx.drawImage(glCanvas, 0, 0);
      }
      if (vorher) ausgabeCtx.drawImage(mischeBereich(bereich, vorher, ausgabe), 0, 0);
      eingabe = ausgabe;
    }
    zeit += 1 / 30;
    return ausgabe;
  }

  return { aktiv: () => kette.length > 0, anwenden };
}
