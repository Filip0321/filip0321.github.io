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
    ["s5", spur(5, "wavetable", { kanal: { pegel: -8, lage: -0.2, send: 0.25 } }), 40 + 4 * S, 1300, "Lead"],
  ], [
    { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Spuren\n\nOben die Clips: Spalten sind Spuren, Zeilen Szenen. Ein Feld anklicken: der Clip startet beim nächsten Takt. ▶ startet eine ganze Zeile. In die Rolle unten zeichnen: Noten (in ein leeres Feld zeichnen legt einen Clip an).\n\nModus „Ablauf“: der Player spielt die Szenen im Feld „Ablauf“ nacheinander (das Arrangement).\n\nJede Spur ist eine Gruppe: Instrument + Kanal. Zugeklappt sieht man Pegel, Lage, Send; ± zeigt alles. Preset an der Gruppe wechselt das Instrument (Trommel: Kick → Snare …).\n\nDie Clips hier sind nur Platzhalter zum Hören." } },
    {
      id: "cl", typ: "clips", x: 470, y: 40,
      werte: {
        modus: "frei", feld: "2", ablauf: "1 1 2 2", grundton: "9", leiter: "moll", arrTakte: "16",
        // Runde 29: auch ein Arrangement (Modus „Arrangement“): Szene 1 und 2 im Wechsel, die Hi-Hat setzt erst später ein
        arr: { 0: [[0, 0, 4], [4, 1, 4], [8, 0, 4], [12, 1, 4]], 1: [[4, 1, 4], [12, 1, 4]], 2: [[0, 0, 4], [4, 1, 4], [8, 0, 4], [12, 1, 4]], 3: [[0, 0, 4], [4, 1, 4], [8, 0, 8]] },
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
    ["cl", "Spur 1", "s1.nt", "Noten"], ["cl", "Spur 2", "s2.nt", "Noten"], ["cl", "Spur 3", "s3.vt", "Noten"], ["cl", "Spur 4", "s4.vt", "Noten"], ["cl", "Spur 5", "s5.vt", "Noten"],
    ["s1.ka", "aus", "ko", "ein"], ["s2.ka", "aus", "ko", "ein"], ["s3.ka", "aus", "ko", "ein"], ["s4.ka", "aus", "ko", "ein"], ["s5.ka", "aus", "ko", "ein"],
    ["s4.ka", "Send", "ha", "ein"], ["s5.ka", "Send", "ha", "ein"], ["ha", "aus", "ko", "ein"], ["ko", "aus", "aus", "ein"],
  ], 110),

  // Runde 25: kleine Vorlagen, die je EINE Idee zeigen
  knoepfe: {
    text: "Knöpfe mit Kabeln: ein LFO dreht die Grenze des Filters, ein Zufall den Abstand des Echos (die kleinen Buchsen neben den Knöpfen)",
    tempo: 100,
    module: [
      { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Jeder Knopf hat daneben eine kleine Buchse. Ein Kabel dort dreht den Knopf: 1,0 = eine halbe Umdrehung nach rechts.\n\nHier: LFO (0,15 Hz) → Grenze des Filters (der Zeiger wandert), Zufall (Spaziergang) → Zeit des Echos (das Echo „schmiert“, wenn sich seine Zeit ändert: wie beim Band-Echo).\n\nKabel ziehen und an andere Knöpfe stecken." } },
      { id: "ab", typ: "abc", x: 460, y: 40, werte: { abc: "L:1/8\nK:Dm\n|: D2 F A d2 A F | E2 G B c2 A2 :|" } },
      { id: "nz", typ: "notenZuTon", x: 460, y: 520, werte: {} },
      { id: "os", typ: "oszillator", x: 860, y: 40, werte: { form: "sawtooth", frequenz: 261.63 } },
      { id: "hk", typ: "huellkurve", x: 860, y: 460, werte: { a: 0.005, d: 0.25, s: 0.3, r: 0.2 } },
      { id: "fi", typ: "filter", x: 1260, y: 40, werte: { typ: "lowpass", grenze: 800, resonanz: 3, mod: 0 } },
      { id: "vo", typ: "verstaerker", x: 1660, y: 860, werte: { pegel: 0.5 } },
      { id: "vc", typ: "verstaerker", x: 1260, y: 460, werte: { pegel: 0 } },
      { id: "lfo", typ: "lfo", x: 860, y: 860, werte: { form: "sine", tempo: 0.15, tiefe: 0.8 } },
      { id: "zu", typ: "zufall", x: 1260, y: 860, werte: { art: "spaziergang", zeit: 4, staerke: 0.6, mitte: 0 } },
      { id: "ec", typ: "echo", x: 1660, y: 40, werte: {} },
      { id: "aus", typ: "ausgang", x: 1660, y: 460, werte: { laut: 0.5 } },
    ],
    kabel: [["ab", "Noten", "nz", "Noten"], ["nz", "Tonhöhe", "os", "Tonhöhe"], ["nz", "Takt", "hk", "Auslöser"], ["os", "aus", "fi", "ein"], ["fi", "aus", "vc", "ein"], ["hk", "aus", "vc", "Steuerung"],
      ["lfo", "aus", "fi", "⤳grenze"], ["zu", "aus", "ec", "⤳zeit"], ["vc", "aus", "vo", "ein"], ["vo", "aus", "ec", "ein"], ["ec", "aus", "aus", "ein"]],
  },
  supersaw: ausKlaengen("Supersaw: Akkorde in einen Wavetable-Synth mit sieben verstimmten Sägezähnen, dazu Hall", [["sy", "wavetable", 860, 40, "Supersaw"]], [
    { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Supersaw (Roland JP-8000, 1996): sieben Sägezähne, gegeneinander verstimmt. Jeder schwebt gegen jeden; das klingt breit wie ein Chor aus Synthesizern. Am Wavetable-Modul: „Stimmen“ 7, „Unisono“ die Verstimmung in Cent. Preset der Gruppe wechseln: Fläche, Glas, Stimme …" } },
    { id: "e1", typ: "euklid", x: 460, y: 40, werte: { n: 4, k: 4, tempo: 70, teilung: "4" } },
    { id: "ak", typ: "akkorde", x: 460, y: 400, werte: { grundton: "9", leiter: "moll", art: "sept", lage: "fuehrung", schlaege: "8", spielweise: "zusammen", laenge: 1, anschlag: 0.6, folge: "1,6,3,7,0,0,0,0" } },
    { id: "ha", typ: "hall", x: 1300, y: 40, werte: { zeit: 3, mix: 0.3 } },
    { id: "aus", typ: "ausgang", x: 1300, y: 460, werte: { laut: 0.5 } },
  ], [["e1", "Takt", "ak", "Takt"], ["ak", "Noten", "sy.vt", "Noten"], ["sy.end", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]], 70),
  // Runde 34: Vorlagen, die je eine Klang-Familie zeigen (Preset an der Gruppe wechseln, ± hineinsehen)
  glitzer: ausKlaengen("Glitzer: Funken, Sternenstaub, Kristall nebeneinander (viele kurze hohe Töne, zufällig in Zeit, Höhe und Raum)", [
    ["f", "glitzer", 460, 40, "Funken"], ["s", "glitzer", 860, 40, "Sternenstaub"], ["k", "glitzer", 1260, 40, "Kristall"],
  ], [
    { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Drei Glitzer-Gruppen. Am Mischer einzeln lauter oder leiser drehen, um sie zu hören. In jeder Gruppe: Zufallsgeber (wie oft), Zufall Stufen (welche Höhe), Pling (der Ton), Echo. Die Dichte-Buchse der Gruppe: mit einem LFO wird der Funkenregen dichter und dünner." } },
    { id: "mi", typ: "mischer", x: 1660, y: 40, werte: { k1: 0.7, k2: 0.6, k3: 0.6 } },
    { id: "ha", typ: "hall", x: 1660, y: 440, werte: { zeit: 4, mix: 0.35 } },
    { id: "aus", typ: "ausgang", x: 2060, y: 40, werte: { laut: 0.5 } },
  ], [["f.end", "aus", "mi", "1"], ["s.end", "aus", "mi", "2"], ["k.end", "aus", "mi", "3"], ["mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),
  schlegel: ausKlaengen("Schlegel: eine ABC-Melodie mit Akkorden auf Marimba (Preset wechseln: Vibraphon, Xylophon, Kalimba, freier Stab)", [["sl", "schlegel", 860, 40, "Marimba"]], [
    { id: "ab", typ: "abc", x: 40, y: 40, werte: { abc: "L:1/8\nK:C\n|: [CEG]2 E G c2 G E | [A,CE]2 C E A2 E C | [F,A,C]2 A, C F2 C A, | [G,B,D]2 B, D G2 (3DEF :|" } },
    { id: "ha", typ: "hall", x: 1260, y: 40, werte: { zeit: 2, mix: 0.25 } },
    { id: "aus", typ: "ausgang", x: 1660, y: 40, werte: { laut: 0.5 } },
  ], [["ab", "Noten", "sl.nd", "Noten"], ["sl.end", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]], 96),
  drift: ausKlaengen("Drift: Akkorde auf einem analogen Synth, dessen Stimmen leicht wandern (Preset: Fläche, Bass, Keys, Lead)", [["dr", "drift", 860, 40, "Fläche"]], [
    { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 4, k: 4, tempo: 80, teilung: "4" } },
    { id: "ak", typ: "akkorde", x: 40, y: 400, werte: { grundton: "2", leiter: "dorisch", art: "sept", lage: "fuehrung", schlaege: "8", spielweise: "zusammen", laenge: 1, anschlag: 0.6, folge: "1,4,1,5,0,0,0,0" } },
    { id: "ha", typ: "hall", x: 1260, y: 40, werte: { zeit: 3, mix: 0.3 } },
    { id: "aus", typ: "ausgang", x: 1660, y: 40, werte: { laut: 0.5 } },
  ], [["e1", "Takt", "ak", "Takt"], ["ak", "Noten", "dr.vt", "Noten"], ["dr.end", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]], 80),
  meld: ausKlaengen("Meld: FM-Glocken (zwei Quellen je Stimme, B moduliert A), dazu Echo und Hall", [["me", "meld", 860, 40, "FM-Glocke"]], [
    { id: "ab", typ: "abc", x: 40, y: 40, werte: { abc: "L:1/8\nK:Em\n|: e4 B2 G2 | A4 E2 z2 | [GB]4 D2 E2 | [E,B,E]6 z2 :|" } },
    { id: "ec", typ: "echo", x: 1260, y: 40, werte: { zeit: 0.42, rueck: 0.45, nass: 0.35 } },
    { id: "ha", typ: "hall", x: 1260, y: 440, werte: { zeit: 4, mix: 0.3 } },
    { id: "aus", typ: "ausgang", x: 1660, y: 40, werte: { laut: 0.5 } },
  ], [["ab", "Noten", "me.vt", "Noten"], ["me.end", "aus", "ec", "ein"], ["ec", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]], 72),
  wobble: ausKlaengen("Wobble: ein Bass, dessen Filter ein schneller LFO öffnet und schließt (Ausgänge an Knöpfen)", [["wb", "wavetable", 860, 40, "Wobble"]], [
    { id: "ab", typ: "abc", x: 40, y: 40, werte: { abc: "L:1/4\nK:Dm\n|: D,,2 D,,2 | F,,2 A,,,2 :|" } },
    { id: "li", typ: "limiter", x: 1260, y: 40, werte: { gain: 3, decke: -1 } },
    { id: "aus", typ: "ausgang", x: 1660, y: 40, werte: { laut: 0.5 } },
  ], [["ab", "Noten", "wb.vt", "Noten"], ["wb.end", "aus", "li", "ein"], ["li", "aus", "aus", "ein"]], 140),
  trommelkit: ausKlaengen("Trommeln aus Teilen: vier Trommel-Gruppen (Kick, Snare, Hi-Hat, Cowbell) an einem Euklid-Rhythmus", [
    ["k", "trommel", 860, 40, "Kick 909"], ["s", "trommel", 1260, 40, "Snare"], ["h", "trommel", 860, 420, "Hi-Hat zu"], ["c", "trommel", 1260, 420, "Cowbell"],
  ], [
    { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Jede Trommel ist eine Gruppe aus Oszillatoren, Rauschen, Filtern und Hüllkurven (± klappt auf). Der „Punch“ der Kick: eine schnelle Hüllkurve zieht die Tonhöhe zwei Oktaven herunter. Preset an der Gruppe wechseln: aus der Kick wird ein Tom, aus der Cowbell eine Clave." } },
    { id: "e1", typ: "euklid", x: 460, y: 40, werte: { n: 16, k: 4, tempo: 124, teilung: "16" } },
    { id: "e2", typ: "euklid", x: 460, y: 320, werte: { n: 16, k: 2, tempo: 124, teilung: "16", drehen: 4 } },
    { id: "e3", typ: "euklid", x: 460, y: 600, werte: { n: 16, k: 11, tempo: 124, teilung: "16" } },
    { id: "e4", typ: "euklid", x: 460, y: 880, werte: { n: 16, k: 3, tempo: 124, teilung: "16", drehen: 2 } },
    { id: "mi", typ: "mischer", x: 1660, y: 40, werte: { k1: 1, k2: 0.8, k3: 0.5, k4: 0.4 } },
    { id: "li", typ: "limiter", x: 1660, y: 420, werte: { gain: 4, decke: -1 } },
    { id: "aus", typ: "ausgang", x: 2060, y: 40, werte: { laut: 0.5 } },
  ], [["e1", "Takt", "k.sv", "Takt"], ["e2", "Takt", "s.sv", "Takt"], ["e3", "Takt", "h.sv", "Takt"], ["e4", "Takt", "c.sv", "Takt"],
    ["k.end", "aus", "mi", "1"], ["s.end", "aus", "mi", "2"], ["h.end", "aus", "mi", "3"], ["c.end", "aus", "mi", "4"], ["mi", "aus", "li", "ein"], ["li", "aus", "aus", "ein"]], 124),
};
