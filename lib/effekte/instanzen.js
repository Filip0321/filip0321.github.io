// Instanzen: derselbe Effekt der Sammlung mehrmals in einer Kette, jede Kopie mit eigenen Werten und eigenem
// Gedächtnis. Vorher gab es jeden Effekt genau einmal, und was er sich merkt (Feedback das letzte Bild, Pixel
// Sorting seine Werte, Blob-Tracking die Flecken vom letzten Bild), stand oben in seiner Datei. Zwei Feedbacks
// hätten sich dann ein Bild geteilt und sich gegenseitig überschrieben.
//
// Schlüssel einer Instanz: die erste heißt wie der Effekt ("feedback"), jede weitere bekommt eine Nummer
// ("feedback~2", "feedback~3" …). Unter diesem Schlüssel stehen
//   werte[schluessel]         die Regler (verbindeRegler in /lib/effekt-regler.js)
//   gedaechtnisVon(schluessel) was der Effekt sich zwischen zwei Bildern merkt (def.neuesGedaechtnis())
//   "<schluessel>-an"          das Häkchen
//
// Ein Effekt bekommt sein Gedächtnis als letztes Argument: einstellungen(werte, zeit, g), nachher(g),
// cpu(bild, werte, zeit, g). Effekte ohne Gedächtnis bekommen ein leeres Objekt und beachten es nicht.
//
// Dazu der Bereich jeder Instanz (Regler „Bereich“, den sammlung-ui.js an jeden Effekt hängt): ganzes Bild,
// nur in den Rahmen von Blob-Tracking oder nur außerhalb. Die Rahmen merkt sich Blob-Tracking in seinem
// Gedächtnis (g.flecken); welche Instanz zuletzt gerechnet hat, steht in letzteFlecken.

import { SAMMLUNG } from "./sammlung.js";

const TRENNER = "~";

export const basisId = (schluessel) => schluessel.split(TRENNER)[0];
export const nummerVon = (schluessel) => Number(schluessel.split(TRENNER)[1] ?? 1);
export const defVon = (schluessel) => SAMMLUNG.find((d) => d.id === basisId(schluessel)) ?? null;

// Name für Listen: „Feedback“, „Feedback 2“ …
export function nameVon(schluessel) {
  const def = defVon(schluessel);
  const n = nummerVon(schluessel);
  return def ? (n > 1 ? `${def.name} ${n}` : def.name) : schluessel;
}

const gedaechtnisse = new Map();
export function gedaechtnisVon(schluessel) {
  if (!gedaechtnisse.has(schluessel)) gedaechtnisse.set(schluessel, defVon(schluessel)?.neuesGedaechtnis?.() ?? {});
  return gedaechtnisse.get(schluessel);
}

// eine Kopie wird entfernt: ihr Gedächtnis freigeben (Texturen auf der Grafikkarte löscht def.gibFrei)
export function vergiss(schluessel) {
  const g = gedaechtnisse.get(schluessel);
  if (g) defVon(schluessel)?.gibFrei?.(g);
  gedaechtnisse.delete(schluessel);
}

// alle Kopien, die es gibt (ohne die ersten), in der Reihenfolge, in der sie entstanden sind
export const kopien = [];

// nächster freier Schlüssel für eine Kopie von def
export function neuerSchluessel(def) {
  let n = 2;
  while (kopien.includes(`${def.id}${TRENNER}${n}`)) n++;
  const schluessel = `${def.id}${TRENNER}${n}`;
  kopien.push(schluessel);
  return schluessel;
}

export function entferneKopie(schluessel) {
  const i = kopien.indexOf(schluessel);
  if (i >= 0) kopien.splice(i, 1);
  vergiss(schluessel);
}

// die Rahmen der Blob-Instanz, die zuletzt gerechnet hat (in Pixeln des Bildes): { flecken, breite, hoehe }
let letzte = null;
export function merkeFlecken(flecken, breite, hoehe) {
  letzte = { flecken, breite, hoehe };
}
export const letzteFlecken = () => letzte;

// Bereich: 0 ganzes Bild, 1 nur in den Blob-Rahmen, 2 nur außerhalb
// vorher und nachher: Canvas (oder ImageData) gleicher Größe; gibt das Gemischte als Canvas zurück
export function mischeBereich(bereich, vorher, nachher) {
  const r = letzte;
  const w = nachher.width;
  const h = nachher.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const male = (bild) => {
    if (bild instanceof ImageData) {
      const t = document.createElement("canvas");
      t.width = w;
      t.height = h;
      t.getContext("2d").putImageData(bild, 0, 0);
      ctx.drawImage(t, 0, 0);
    } else ctx.drawImage(bild, 0, 0, w, h);
  };
  // außen: erst das bearbeitete Bild, in den Rahmen das unbearbeitete; innen umgekehrt
  male(bereich > 1.5 ? nachher : vorher);
  if (r && r.flecken.length) {
    const sx = w / r.breite;
    const sy = h / r.hoehe;
    ctx.save();
    ctx.beginPath();
    for (const p of r.flecken) ctx.rect(p.x0 * sx, p.y0 * sy, (p.x1 - p.x0) * sx, (p.y1 - p.y0) * sy);
    ctx.clip();
    male(bereich > 1.5 ? vorher : nachher);
    ctx.restore();
  }
  return c;
}
