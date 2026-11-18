// Vorlage „Spuren“ (Runde 24): wie eine DAW, aber auf der Wand. Oben der Clip-Player (Session-Ansicht), darunter
// jede Spur als Gruppe: Instrument (eine Klang-Gruppe mit Preset) + Kanal (Pegel, Lage, Send, Solo). Alle Kanäle
// gehen in einen Kompressor, alle Sends in einen gemeinsamen Hall.
// Die Clips darin sind nur Platzhalter zum Hören (Grundschlag, zwei Akkorde); die Musik schreibst du.

import { KLAENGE } from "./klaenge.js";
import { ausKlaengen } from "./vorlagen-natur.js";

// Eine Klang-Gruppe wird zur Spur: dazu ein Kanal am Ende. Trommeln hören auf Takte, die Clips schicken Noten:
// dafür sitzt vorn ein „Noten → Ton“, dessen Takt die Trommel anschlägt.
function spur(nr, name, { trommel = false, kanal = {} } = {}) {
  const d = KLAENGE[name];
  const ausgang = d.gruppe.aussen.find(([, , r]) => r === "aus");
  const unten = Math.max(...d.module.map((x) => x.y)) + 480;
  const module = [...d.module, { id: "ka", typ: "kanal", x: 0, y: unten, werte: { ...kanal } }];
  const kabel = [...d.kabel, [ausgang[0], ausgang[1], "ka", "ein"]];
  let rein = d.gruppe.aussen.filter(([, , r]) => r === "ein");
  if (trommel) {
    module.push({ id: "nt", typ: "notenZuTon", x: 400, y: unten, werte: {} });
    const takt = rein.find(([, , , art]) => art === "takt");
    kabel.push(["nt", "Takt", takt[0], takt[1]]);
    rein = [["nt", "Noten", "ein", "noten"]];
  }
  return {
    ...d,
    titel: `Spur ${nr}: ${d.titel}`,
    module,
    kabel,
    gruppe: {
      ...d.gruppe,
      aussen: [["ka", "aus", "aus", "ton"], ["ka", "Send", "aus", "ton"], ...rein],
      makros: [["ka", "pegel"], ["ka", "lage"], ["ka", "send"], ...d.gruppe.makros.slice(0, 2)],
    },
  };
}

const takt = (schritte, note = 60) => schritte.map((s) => [s, note, 1, 0.9]);
const akkord = (noten, laenge = 16) => noten.map((n) => [0, n, laenge, 0.7]);
const S = 440;

export const SPUREN_VORLAGEN = {
  spuren: ausKlaengen("Spuren (wie eine DAW): Clips oben, jede Spur eine Gruppe mit Instrument und Kanal", [
    ["s1", spur(1, "trommel", { trommel: true, kanal: { pegel: -3 } }), 40, 1300, "Kick 808"],
    ["s2", spur(2, "trommel", { trommel: true, kanal: { pegel: -10, lage: 0.2 } }), 40 + S, 1300, "Hi-Hat zu"],
    ["s3", spur(3, "wavetable", { kanal: { pegel: -6 } }), 40 + 2 * S, 1300, "Bass"],
    ["s4", spur(4, "wavetable", { kanal: { pegel: -8, send: 0.35 } }), 40 + 3 * S, 1300, "Fläche"],
    ["s5", spur(5, "blaeser", { kanal: { pegel: -6, lage: -0.2, send: 0.25 } }), 40 + 4 * S, 1300, "Saxophon"],
  ], [
    { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Spuren\n\nOben die Clips: Spalten sind Spuren, Zeilen Szenen. Ein Feld anklicken: der Clip startet beim nächsten Takt. ▶ startet eine ganze Zeile. In die Rolle unten zeichnen: Noten (in ein leeres Feld zeichnen legt einen Clip an).\n\nModus „Ablauf“: der Player spielt die Szenen im Feld „Ablauf“ nacheinander (das Arrangement).\n\nJede Spur ist eine Gruppe: Instrument + Kanal. Zugeklappt sieht man Pegel, Lage, Send; ± zeigt alles. Preset an der Gruppe wechselt das Instrument (Trommel: Kick → Snare …).\n\nDie Clips hier sind nur Platzhalter zum Hören." } },
    {
      id: "cl", typ: "clips", x: 470, y: 40,
      werte: {
        modus: "frei", feld: "2", ablauf: "1 1 2 2", grundton: "9", leiter: "moll",
        clips: {
          "0:0": { takte: 1, tiefste: 48, noten: takt([0, 4, 8, 12]) }, "0:1": { takte: 1, tiefste: 48, noten: takt([0, 4, 8, 12]) },
          "1:0": { takte: 1, tiefste: 48, noten: takt([2, 6, 10, 14]) }, "1:1": { takte: 1, tiefste: 48, noten: takt([2, 6, 10, 14]) },
          "2:0": { takte: 1, tiefste: 36, noten: akkord([45], 14) }, "2:1": { takte: 1, tiefste: 36, noten: akkord([41], 14) },
          "3:0": { takte: 1, tiefste: 48, noten: akkord([57, 60, 64]) }, "3:1": { takte: 1, tiefste: 48, noten: akkord([53, 57, 60]) },
        },
      },
    },
    { id: "ha", typ: "hall", x: 1300, y: 40, werte: { zeit: 2.5, daempfung: 0.6, mix: 1 } },
    { id: "ko", typ: "kompressor", x: 1300, y: 460, werte: { schwelle: -16, verhaeltnis: 3, aufholen: 2 } },
    { id: "aus", typ: "ausgang", x: 1700, y: 460, werte: { laut: 0.5 } },
  ], [
    ["cl", "Spur 1", "s1.nt", "Noten"], ["cl", "Spur 2", "s2.nt", "Noten"], ["cl", "Spur 3", "s3.vt", "Noten"], ["cl", "Spur 4", "s4.vt", "Noten"], ["cl", "Spur 5", "s5.nz", "Noten"],
    ["s1.ka", "aus", "ko", "ein"], ["s2.ka", "aus", "ko", "ein"], ["s3.ka", "aus", "ko", "ein"], ["s4.ka", "aus", "ko", "ein"], ["s5.ka", "aus", "ko", "ein"],
    ["s4.ka", "Send", "ha", "ein"], ["s5.ka", "Send", "ha", "ein"], ["ha", "aus", "ko", "ein"], ["ko", "aus", "aus", "ein"],
  ], 110),
};
