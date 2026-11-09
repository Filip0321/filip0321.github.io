import { gl, rendere, glCanvas } from "/lib/webgl.js";
import { crtProgramm, crtAnteil, crtEinstellungen, crtNachher } from "/lib/effekte/crt.js";
import { vhsProgramm } from "/lib/effekte/vhs.js";
import { verbindeRegler } from "/lib/effekt-regler.js"; // baut die Regler für VHS und CRT ins HTML
import { SAMMLUNG } from "/lib/effekte/sammlung.js";
import { programmVon } from "/lib/effekte/hilfen.js";
import { baueSammlung } from "/lib/effekte/sammlung-ui.js";
import { meldeEffekte } from "/lib/export-dialog.js";
import { defVon, nameVon, gedaechtnisVon, kopien, mischeBereich } from "/lib/effekte/instanzen.js";
import { richteKetteEin } from "/lib/effekt-kette.js";

const quelle = hole("feld");
const schicht = hole("effekte");
const schichtCtx = schicht.getContext("2d", { willReadFrequently: true });
// Kleine, wiederverwendete Vorschau-Leinwand. Sie verhindert, dass sehr teure Shader
// (insbesondere Zeitungspapier) bei jeder Bildschirmaktualisierung in 4K rechnen.
const vorschauCanvas = document.createElement("canvas");
const vorschauCtx = vorschauCanvas.getContext("2d");
let letzteVorschau = -Infinity;

const werte = { vhs: {}, crt: {} };

// Alle Effekte, die es auf der Seite gibt, unter ihrem Schlüssel: VHS, CRT und die Sammlung samt Kopien
// (instanzen.js: "feedback", "feedback~2" …). Welche davon rechnen und in welcher Reihenfolge, sagt die
// Kette weiter unten.
// zeit: Sekunden, jeder Shader bekommt sie unter seinem Namen
const EFFEKTE = new Map([
  ["vhs", { name: "VHS", programm: vhsProgramm, einstellungen: (zeit) => ({ ...werte.vhs, zeit }) }],
  // CRT merkt sich sein letztes Bild (Halbbilder, Nachleuchten): crtNachher
  ["crt", { name: "CRT", programm: crtProgramm, einstellungen: (zeit) => crtEinstellungen(werte.crt, zeit), nachher: crtNachher }],
]);

// einen Effekt der Sammlung (oder eine Kopie davon) anmelden. Shader-Effekte rechnen auf der Grafikkarte,
// CPU-Effekte (cpu: ImageData → ImageData: Linien, Blob-Tracking) auf dem Prozessor: langsamer, weil das Bild
// dafür aus der Grafikkarte geholt werden muss (getImageData)
function registriere(schluessel) {
  const def = defVon(schluessel);
  const g = gedaechtnisVon(schluessel);
  EFFEKTE.set(schluessel, {
    name: nameVon(schluessel),
    cpu: def.cpu && !def.shader ? (bild, zeit) => def.cpu(bild, werte[schluessel], zeit, g) : null,
    get programm() {
      return programmVon(def); // erst beim ersten Gebrauch übersetzt
    },
    einstellungen: (zeit) => (def.einstellungen ? def.einstellungen(werte[schluessel], zeit, g) : { ...werte[schluessel], zeit }),
    // Optionale Grenzen nur für die laufende Bildschirmvorschau; der Export bleibt in Originalauflösung.
    vorschauMaxKante: def.vorschauMaxKante ?? 0,
    vorschauFps: def.vorschauFps ?? 0,
    nachher: def.nachher && (() => def.nachher(g)), // Feedback merkt sich sein Bild
  });
}

const schalterVon = (schluessel) => document.getElementById(`${schluessel}-an`);

// Die Kette: die eingeschalteten Effekte in ihrer Reihenfolge. Neue kommen ans Ende, CRT bleibt der letzte
// (sonst liegen die gewölbten Ränder unter anderen Effekten), man kann ihn aber verschieben.
// Die Liste dazu („Reihenfolge“) ist ein eigener Abschnitt direkt unter dem Abschnitt Effekte, wie bei den
// Foto-Effekten; solange nichts angehakt ist, ist er versteckt.
const reihenfolge = document.createElement("details");
reihenfolge.className = "abschnitt";
reihenfolge.open = true;
reihenfolge.hidden = true;
reihenfolge.innerHTML = `<summary>Reihenfolge</summary><ol class="kette" aria-label="Reihenfolge der Effekte"></ol>`;
const effektAbschnitt = (document.getElementById("sammlung") ?? hole("crt-regler")).closest("details.abschnitt");
if (effektAbschnitt) effektAbschnitt.after(reihenfolge);
else (document.getElementById("sammlung") ?? hole("crt-regler")).after(reihenfolge);

let sammlung = null; // { kopiere, entferne } aus sammlung-ui.js
const ketteUi = richteKetteEin(reihenfolge.querySelector("ol"), {
  name: (s) => EFFEKTE.get(s)?.name ?? s,
  kopierbar: (s) => Boolean(sammlung && defVon(s)),
  beiKopie: (s) => sammlung.kopiere(s),
  beiAus: (s) => {
    const schalter = schalterVon(s);
    schalter.checked = false;
    schalter.dispatchEvent(new Event("change")); // Regler verstecken, aus der Kette nehmen
  },
  letzte: ["crt"],
});
const kette = ketteUi.kette;

function schalte(schluessel, an) {
  if (an && gl) ketteUi.nimmAuf(schluessel);
  else ketteUi.nimmRaus(schluessel);
}
for (const s of ["vhs", "crt"]) schalterVon(s).addEventListener("change", (e) => schalte(s, e.target.checked));

// Die Sammlung der Foto-Effekte: steht auf der Seite ein <div id="sammlung">, kommen ihre Häkchen und Regler
// dorthin, mit „+ Kopie“ an jedem Effekt
const sammlungPlatz = document.getElementById("sammlung");
if (sammlungPlatz && gl) {
  for (const def of SAMMLUNG) registriere(def.id);
  sammlung = baueSammlung(sammlungPlatz, werte, schalte, {
    beiKopie(schluessel, wurzel, vorbild) {
      registriere(schluessel);
      verbindeRegler(werte, () => {}, wurzel);
      ketteUi.merkeNachbar(schluessel, vorbild); // die Kopie rechnet direkt hinter ihrem Vorbild
    },
    beiEntfernen: (schluessel) => EFFEKTE.delete(schluessel),
    vorschauQuelle: () => quelle, // das Bild ohne Effekte
  });
}

// Ohne WebGL2 keine Shader
if (!gl) {
  for (const s of EFFEKTE.keys()) {
    const schalter = schalterVon(s);
    if (!schalter) continue;
    schalter.disabled = true;
    schalter.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
  }
}

// Regler lesen: die Regler selbst baut effekt-regler.js (beim Import, also schon fertig)
verbindeRegler(werte);

// was schon angehakt ist (der Browser stellt Häkchen nach dem Neuladen wieder her), gleich in die Kette
for (const s of EFFEKTE.keys()) if (schalterVon(s)?.checked) schalte(s, true);

// im Export-Fenster dieselben Effekte zum An- und Ausschalten (/lib/export-dialog.js), samt Kopien
if (gl) {
  // die eingeschalteten in der Reihenfolge, in der sie rechnen; die anderen nach den Gruppen der Sammlung
  const gruppeVon = (s) => defVon(s)?.gruppe ?? "Bildschirm";
  const alle = () => {
    const aus = ["vhs", "crt", ...SAMMLUNG.map((d) => d.id), ...kopien].filter((s) => EFFEKTE.has(s) && !kette.includes(s));
    return [...kette, ...aus];
  };
  meldeEffekte({
    liste: () => alle().map((s) => ({ id: s, name: EFFEKTE.get(s).name, an: schalterVon(s).checked, gruppe: gruppeVon(s) })),
    setze(id, an) {
      const schalter = schalterVon(id);
      schalter.checked = an;
      schalter.dispatchEvent(new Event("change")); // Regler auf der Seite zeigen oder verstecken
    },
    // ↑ ↓ im Export-Fenster: dieselbe Kette wie auf der Seite (richtung −1 nach oben, +1 nach unten)
    verschiebe(id, richtung) {
      const i = kette.indexOf(id);
      if (i >= 0) ketteUi.tausche(i, i + richtung);
    },
  });
}

// Rechnet die Effekte für eine Zeit (Sekunden) und gibt den Canvas
// mit dem fertigen Bild zurück: ohne Effekte das Feld selbst
export function endbild(zeit, { vorschau = false } = {}) {
  if (!gl || kette.length === 0) return quelle;

  const originalBreite = quelle.width;
  const originalHoehe = quelle.height;
  let bildQuelle = quelle;
  let w = originalBreite;
  let h = originalHoehe;

  if (vorschau) {
    // Der kleinste Grenzwert aller aktiven Effekte gilt für die ganze Kette.
    // So bleiben die Effekte untereinander deckungsgleich und der Export wird nicht verändert.
    let maxKante = Infinity;
    for (const s of kette) {
      const grenze = EFFEKTE.get(s)?.vorschauMaxKante ?? 0;
      if (grenze > 0) maxKante = Math.min(maxKante, grenze);
    }
    const laengste = Math.max(w, h);
    if (Number.isFinite(maxKante) && laengste > maxKante) {
      const faktor = maxKante / laengste;
      w = Math.max(1, Math.round(originalBreite * faktor));
      h = Math.max(1, Math.round(originalHoehe * faktor));
      if (vorschauCanvas.width !== w || vorschauCanvas.height !== h) {
        vorschauCanvas.width = w;
        vorschauCanvas.height = h;
      }
      vorschauCtx.clearRect(0, 0, w, h);
      vorschauCtx.drawImage(quelle, 0, 0, w, h);
      bildQuelle = vorschauCanvas;
    }
  }

  // Die Effekt-Schicht selbst bleibt in Vorschaugröße. Beim Speichern/Rendern stellt der
  // normale endbild()-Aufruf automatisch wieder die volle Quellauflösung her.
  if (schicht.width !== w || schicht.height !== h) {
    schicht.width = w;
    schicht.height = h;
  }

  let eingabe = bildQuelle; // der erste Effekt liest das Original (oder die kleine Vorschaukopie)
  for (const s of kette) {
    const effekt = EFFEKTE.get(s);
    if (!effekt) continue;
    const bereich = werte[s]?.bereich ?? 0;
    // Bereich: das Bild davor aufheben, nachher nur in (oder außerhalb) der Blob-Rahmen das neue nehmen
    const vorher = bereich > 0.5 ? kopie(eingabe) : null;
    if (effekt.cpu) {
      if (eingabe !== schicht) schichtCtx.drawImage(eingabe, 0, 0, w, h); // erst das Bild hinein
      schichtCtx.putImageData(effekt.cpu(schichtCtx.getImageData(0, 0, w, h), zeit), 0, 0);
    } else {
      rendere(effekt.programm, eingabe, w, h, effekt.einstellungen(zeit));
      effekt.nachher?.();
      schichtCtx.drawImage(glCanvas, 0, 0);
    }
    if (vorher) schichtCtx.drawImage(mischeBereich(bereich, vorher, schicht), 0, 0);
    eingabe = schicht; // jeder weitere liest das Ergebnis davor
  }
  return schicht;
}

const kopie = (bild) => {
  const c = document.createElement("canvas");
  c.width = schicht.width;
  c.height = schicht.height;
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  return c;
};

// CRT gerade abschneiden (für den Export): welcher Anteil mittig bleibt, null = nichts abzuschneiden
// (die Rechnung steht bei der Wölbung selbst, in /lib/effekte/crt.js). Nur wenn das CRT als letztes
// rechnet: liegt danach noch ein Effekt, ist der Rand nicht mehr rund.
export function crtZuschnitt() {
  if (!gl || kette.at(-1) !== "crt") return null;
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

  const an = gl && kette.length > 0;
  schicht.hidden = !an;
  if (!an) return;

  let fps = Infinity;
  for (const s of kette) {
    const grenze = EFFEKTE.get(s)?.vorschauFps ?? 0;
    if (grenze > 0) fps = Math.min(fps, grenze);
  }
  if (Number.isFinite(fps)) {
    const intervall = 1000 / fps;
    if (zeitpunkt - letzteVorschau < intervall) return;
    letzteVorschau = zeitpunkt;
  }
  endbild(zeitpunkt / 1000, { vorschau: true });
}

requestAnimationFrame(schritt);
