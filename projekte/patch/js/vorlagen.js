import { NATUR_VORLAGEN, MEER_NOTIZ } from "./vorlagen-natur.js";
import { SPUREN_VORLAGEN } from "./vorlagen-spuren.js"; // Runde 24

// Fertige Patches zum Anfangen. Jeder Eintrag: Module (Typ, Lage, Werte) und Kabel [von, Ausgang, nach, Eingang].
// Genau dieses Format schreibt auch „Patch speichern“.

export const VORLAGEN = {
  ersterTon: {
    text: "Erster Ton: Sequenz durch Filter, Hüllkurve, Echo",
    module: [
      { id: "seq", typ: "sequenzer", x: 40, y: 40, werte: { tempo: 118, teilung: "8", gate: 0.45 }, schritte: [[0, true], [0, true], [12, true], [0, false], [7, true], [0, true], [10, true], [3, true]] },
      { id: "osz", typ: "oszillator", x: 470, y: 40, werte: { frequenz: 55, form: "sawtooth" } },
      { id: "lfo", typ: "lfo", x: 470, y: 520, werte: { tempo: 0.15, tiefe: 0.6 } },
      { id: "fil", typ: "filter", x: 860, y: 40, werte: { grenze: 500, resonanz: 9, mod: 2.5 } },
      { id: "hk", typ: "huellkurve", x: 40, y: 560, werte: { a: 0.005, d: 0.25, s: 0.2, r: 0.2 } },
      { id: "vca", typ: "verstaerker", x: 1250, y: 40, werte: { pegel: 0 } },
      { id: "echo", typ: "echo", x: 1250, y: 400, werte: { zeit: 0.38, rueck: 0.45, nass: 0.35 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 400, werte: { laut: 0.5 } },
      { id: "sko", typ: "oszilloskop", x: 1640, y: 40, werte: {} },
      { id: "wel", typ: "wellen", x: 860, y: 520, werte: {} },
    ],
    kabel: [
      ["seq", "Tonhöhe", "osz", "Tonhöhe"],
      ["seq", "Takt", "hk", "Auslöser"],
      ["osz", "aus", "fil", "ein"],
      ["lfo", "aus", "fil", "Grenze"],
      ["fil", "aus", "vca", "ein"],
      ["hk", "aus", "vca", "Steuerung"],
      ["vca", "aus", "echo", "ein"],
      ["echo", "aus", "aus", "ein"],
      ["vca", "aus", "sko", "X"],
      ["echo", "aus", "wel", "ein"],
      ["seq", "Takt", "wel", "Tropfen"],
    ],
  },

  lenia: {
    text: "Lenia spielt: Wesen wandern unter einem Lesekopf, jede Spalte eine Note",
    module: [
      { id: "len", typ: "lenia", x: 40, y: 40, werte: { tempo: 104, teilung: "8", schwelle: 0.35, umfang: 2, leiter: "moll" } },
      { id: "osz", typ: "oszillator", x: 470, y: 40, werte: { frequenz: 110, form: "triangle" } },
      { id: "hk", typ: "huellkurve", x: 470, y: 520, werte: { a: 0.004, d: 0.3, s: 0.1, r: 0.4 } },
      { id: "fil", typ: "filter", x: 860, y: 40, werte: { grenze: 600, resonanz: 4, mod: 4 } },
      { id: "vca", typ: "verstaerker", x: 1250, y: 40, werte: { pegel: 0 } },
      { id: "echo", typ: "echo", x: 1250, y: 400, werte: { zeit: 0.43, rueck: 0.5, nass: 0.4 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 400, werte: { laut: 0.5 } },
      { id: "eu", typ: "euklid", x: 860, y: 520, werte: { n: 16, k: 1, tempo: 104, teilung: "4" } },
    ],
    kabel: [
      ["len", "Tonhöhe", "osz", "Tonhöhe"],
      ["len", "Takt", "hk", "Auslöser"],
      ["len", "Dichte", "fil", "Grenze"],
      ["osz", "aus", "fil", "ein"],
      ["fil", "aus", "vca", "ein"],
      ["hk", "aus", "vca", "Steuerung"],
      ["vca", "aus", "echo", "ein"],
      ["echo", "aus", "aus", "ein"],
      ["eu", "Takt", "len", "Wesen"],
    ],
  },

  techno: {
    text: "Techno: Bassdrum, Hi-Hat aus Euklid, Bass",
    module: [
      { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 4, k: 4, tempo: 128, teilung: "4" } },
      { id: "bd", typ: "bassdrum", x: 470, y: 40, werte: {} },
      { id: "e2", typ: "euklid", x: 40, y: 470, werte: { n: 16, k: 7, drehen: 2, tempo: 128, teilung: "16" } },
      { id: "hh", typ: "hihat", x: 470, y: 470, werte: { laenge: 0.04 } },
      { id: "seq", typ: "sequenzer", x: 40, y: 900, werte: { tempo: 128, teilung: "16", gate: 0.3 }, schritte: [[0, false], [0, false], [12, true], [0, false], [0, false], [0, true], [12, true], [10, true]] },
      { id: "osz", typ: "oszillator", x: 470, y: 900, werte: { frequenz: 41.2, form: "square" } },
      { id: "fil", typ: "filter", x: 860, y: 900, werte: { grenze: 300, resonanz: 6, mod: 3 } },
      { id: "hk", typ: "huellkurve", x: 860, y: 470, werte: { a: 0.002, d: 0.12, s: 0, r: 0.08 } },
      { id: "vca", typ: "verstaerker", x: 1250, y: 900, werte: { pegel: 0 } },
      { id: "mix", typ: "mischer", x: 1250, y: 40, werte: { k1: 1, k2: 0.75, k3: 0.7, k4: 0 } },
      { id: "ha", typ: "hall", x: 1250, y: 420, werte: { zeit: 1.3, daempfung: 0.7, mix: 0.12 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 40, werte: { laut: 0.5 } },
      { id: "spk", typ: "spektrum", x: 1640, y: 420, werte: {} },
    ],
    kabel: [
      ["e1", "Takt", "bd", "Auslöser"],
      ["e2", "Takt", "hh", "Auslöser"],
      ["seq", "Tonhöhe", "osz", "Tonhöhe"],
      ["seq", "Takt", "hk", "Auslöser"],
      ["osz", "aus", "fil", "ein"],
      ["hk", "aus", "fil", "Grenze"],
      ["fil", "aus", "vca", "ein"],
      ["hk", "aus", "vca", "Steuerung"],
      ["bd", "aus", "mix", "1"],
      ["hh", "aus", "mix", "2"],
      ["vca", "aus", "mix", "3"],
      ["mix", "aus", "ha", "ein"],
      ["ha", "aus", "aus", "ein"],
      ["ha", "aus", "spk", "ein"],
    ],
  },

  lissajous: {
    text: "Lissajous: zwei Sinus an X und Y",
    module: [
      { id: "o1", typ: "oszillator", x: 40, y: 40, werte: { frequenz: 220, form: "sine", fmTiefe: 1 } },
      { id: "o2", typ: "oszillator", x: 40, y: 470, werte: { frequenz: 330, form: "sine", fmTiefe: 2 } },
      { id: "lfo", typ: "lfo", x: 430, y: 470, werte: { tempo: 0.05, tiefe: 1 } },
      { id: "sko", typ: "oszilloskop", x: 820, y: 40, werte: { zoom: 0.8, nachleuchten: 0.9 } },
      { id: "mix", typ: "mischer", x: 430, y: 40, werte: { k1: 0.3, k2: 0.3, k3: 0, k4: 0 } },
      { id: "aus", typ: "ausgang", x: 1220, y: 40, werte: { laut: 0.3 } },
    ],
    kabel: [
      ["o1", "aus", "sko", "X"],
      ["o2", "aus", "sko", "Y"],
      ["lfo", "aus", "o2", "FM"],
      ["o1", "aus", "mix", "1"],
      ["o2", "aus", "mix", "2"],
      ["mix", "aus", "aus", "ein"],
    ],
  },

  // ---------- Genres (Runde 17) ----------
  // Tonhöhe 0 = die Frequenz am Oszillator. Steht sie auf 261,63 Hz (C4), sind alle Tonhöhen „Halbtöne über C4 / 12“,
  // wie beim MIDI-Eingang; so passen Notenraster, Arpeggiator und Keyboard zusammen.

  house: {
    text: "House (124): Four-to-the-floor, Offbeat-Hats, Bass, Orgel-Akkorde",
    module: [
      { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 4, k: 4, tempo: 124, teilung: "4" } },
      { id: "e2", typ: "euklid", x: 40, y: 330, werte: { n: 2, k: 1, drehen: 0, tempo: 124, teilung: "8" } },
      { id: "e3", typ: "euklid", x: 40, y: 620, werte: { n: 4, k: 2, drehen: 0, tempo: 124, teilung: "4" } },
      { id: "bd", typ: "bassdrum", x: 470, y: 40, werte: { tief: 50, laenge: 0.4 } },
      { id: "hh", typ: "hihat", x: 470, y: 330, werte: { laenge: 0.12, farbe: 8000 } },
      { id: "sn", typ: "snare", x: 470, y: 620, werte: { mischung: 0.85, laenge: 0.22 } },
      { id: "nr", typ: "notenraster", x: 40, y: 900, werte: { tempo: 124, teilung: "16", leiter: "moll", grund: "9", oktave: -2, gate: 0.4 }, schritte: [[-1, false, false], [-1, false, false], [0, false, false], [-1, false, false], [-1, false, false], [-1, false, false], [0, false, false], [-1, false, false], [-1, false, false], [-1, false, false], [0, false, false], [-1, false, false], [-1, false, false], [-1, false, false], [2, false, false], [-1, false, false]] },
      { id: "bo", typ: "oszillator", x: 860, y: 900, werte: { frequenz: 261.63, form: "square" } },
      { id: "bf", typ: "filter", x: 1250, y: 900, werte: { grenze: 300, resonanz: 3, mod: 3 } },
      { id: "bh", typ: "huellkurve", x: 860, y: 1250, werte: { a: 0.003, d: 0.2, s: 0.3, r: 0.1 } },
      { id: "bv", typ: "verstaerker", x: 1250, y: 1250, werte: { pegel: 0 } },
      { id: "e4", typ: "euklid", x: 860, y: 40, werte: { n: 8, k: 3, drehen: 2, tempo: 124, teilung: "8" } },
      { id: "ar", typ: "arpeggiator", x: 860, y: 400, werte: { akkord: "moll7", muster: "zufall", oktaven: 1, halbton: -3, laenge: 0.3 } },
      { id: "or", typ: "wellenform", x: 1250, y: 40, werte: { frequenz: 261.63, vorlage: "orgel" } },
      { id: "oh", typ: "huellkurve", x: 1250, y: 470, werte: { a: 0.003, d: 0.25, s: 0, r: 0.15 } },
      { id: "ov", typ: "verstaerker", x: 1640, y: 470, werte: { pegel: 0 } },
      { id: "ha", typ: "hall", x: 1640, y: 40, werte: { zeit: 1.8, mix: 0.3 } },
      { id: "m1", typ: "mischer", x: 1640, y: 760, werte: { k1: 1, k2: 0.5, k3: 0.6, k4: 0.7 } },
      { id: "ko", typ: "kompressor", x: 1640, y: 1100, werte: { schwelle: -18, verhaeltnis: 3, aufholen: 0 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 1400, werte: { laut: 0.5 } },
    ],
    kabel: [
      ["e1", "Takt", "bd", "Auslöser"], ["e2", "Takt", "hh", "Auslöser"], ["e3", "Takt", "sn", "Auslöser"],
      ["nr", "Tonhöhe", "bo", "Tonhöhe"], ["nr", "Takt", "bh", "Auslöser"],
      ["bo", "aus", "bf", "ein"], ["bh", "aus", "bf", "Grenze"], ["bf", "aus", "bv", "ein"], ["bh", "aus", "bv", "Steuerung"],
      ["e4", "Takt", "ar", "Takt"], ["ar", "Tonhöhe", "or", "Tonhöhe"], ["ar", "Takt", "oh", "Auslöser"],
      ["or", "aus", "ov", "ein"], ["oh", "aus", "ov", "Steuerung"], ["ov", "aus", "ha", "ein"],
      ["bd", "aus", "m1", "1"], ["hh", "aus", "m1", "2"], ["sn", "aus", "m1", "2"], ["bv", "aus", "m1", "3"], ["ha", "aus", "m1", "4"],
      ["m1", "aus", "ko", "ein"], ["ko", "aus", "aus", "ein"],
    ],
  },

  acid: {
    text: "Acid (132): Notenraster mit Bindung und Akzent, Glide, Filter mit viel Resonanz",
    module: [
      { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 4, k: 4, tempo: 132, teilung: "4" } },
      { id: "e2", typ: "euklid", x: 40, y: 330, werte: { n: 16, k: 16, tempo: 132, teilung: "16" } },
      { id: "tw", typ: "taktwerk", x: 470, y: 330, werte: { chance: 0.7 } },
      { id: "bd", typ: "bassdrum", x: 470, y: 40, werte: { tief: 46, laenge: 0.35 } },
      { id: "hh", typ: "hihat", x: 860, y: 330, werte: { laenge: 0.03 } },
      { id: "nr", typ: "notenraster", x: 40, y: 640, werte: { tempo: 132, teilung: "16", leiter: "moll", grund: "9", oktave: -2, gate: 0.45 }, schritte: [[0, false, true], [0, false, false], [7, false, false], [0, false, false], [2, false, true], [3, true, false], [0, false, false], [4, false, false], [-1, false, false], [0, false, true], [5, false, false], [4, true, false], [0, false, false], [7, false, true], [6, true, false], [2, false, false]] },
      { id: "gl", typ: "glide", x: 860, y: 640, werte: { zeit: 0.05 } },
      { id: "os", typ: "oszillator", x: 1250, y: 640, werte: { frequenz: 261.63, form: "sawtooth" } },
      { id: "hk", typ: "huellkurve", x: 860, y: 950, werte: { a: 0.002, d: 0.18, s: 0.05, r: 0.08 } },
      { id: "fi", typ: "filter", x: 1640, y: 640, werte: { grenze: 350, resonanz: 18, mod: 3.5 } },
      { id: "vc", typ: "verstaerker", x: 1640, y: 950, werte: { pegel: 0 } },
      { id: "vz", typ: "verzerrung", x: 1250, y: 40, werte: { antrieb: 6, mix: 0.6, pegel: 0.6 } },
      { id: "ec", typ: "echo", x: 1640, y: 40, werte: { zeit: 0.341, rueck: 0.35, nass: 0.25 } },
      { id: "mi", typ: "mischer", x: 1250, y: 1150, werte: { k1: 1, k2: 0.4, k3: 0.8 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 1250, werte: { laut: 0.5 } },
    ],
    kabel: [
      ["e1", "Takt", "bd", "Auslöser"], ["e2", "Takt", "tw", "Takt"], ["tw", "Takt", "hh", "Auslöser"],
      ["nr", "Tonhöhe", "gl", "ein"], ["gl", "aus", "os", "Tonhöhe"], ["nr", "Takt", "hk", "Auslöser"],
      ["os", "aus", "fi", "ein"], ["hk", "aus", "fi", "Grenze"], ["nr", "Akzent", "fi", "Grenze"],
      ["fi", "aus", "vc", "ein"], ["hk", "aus", "vc", "Steuerung"], ["vc", "aus", "vz", "ein"], ["vz", "aus", "ec", "ein"],
      ["bd", "aus", "mi", "1"], ["hh", "aus", "mi", "2"], ["ec", "aus", "mi", "3"], ["mi", "aus", "aus", "ein"],
    ],
  },

  tekke: {
    text: "Tekke (168): verzerrte Bassdrum, rollender Bass, Turing-Maschine als Lead",
    module: [
      { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 4, k: 4, tempo: 168, teilung: "4" } },
      { id: "bd", typ: "bassdrum", x: 470, y: 40, werte: { tief: 52, hoch: 260, fall: 0.04, laenge: 0.28 } },
      { id: "vz", typ: "verzerrung", x: 860, y: 40, werte: { antrieb: 14, art: "hart", mix: 1, pegel: 0.5, ton: 6000 } },
      { id: "e2", typ: "euklid", x: 40, y: 330, werte: { n: 4, k: 1, drehen: 1, tempo: 168, teilung: "16" } },
      { id: "hh", typ: "hihat", x: 470, y: 330, werte: { laenge: 0.06 } },
      { id: "nr", typ: "notenraster", x: 40, y: 620, werte: { tempo: 168, teilung: "16", leiter: "phrygisch", grund: "4", oktave: -2, gate: 0.6 }, schritte: [[-1, false, false], [0, false, false], [0, false, false], [0, false, false], [-1, false, false], [0, false, false], [0, false, false], [0, false, false], [-1, false, false], [0, false, false], [0, false, false], [0, false, false], [-1, false, false], [4, false, false], [3, false, false], [0, false, false]] },
      { id: "bo", typ: "oszillator", x: 860, y: 620, werte: { frequenz: 261.63, form: "sawtooth" } },
      { id: "bh", typ: "huellkurve", x: 860, y: 950, werte: { a: 0.002, d: 0.1, s: 0.2, r: 0.05 } },
      { id: "bf", typ: "filter", x: 1250, y: 620, werte: { grenze: 500, resonanz: 6, mod: 2 } },
      { id: "bv", typ: "verstaerker", x: 1250, y: 950, werte: { pegel: 0 } },
      { id: "e3", typ: "euklid", x: 1250, y: 40, werte: { n: 16, k: 7, tempo: 168, teilung: "16" } },
      { id: "tu", typ: "turing", x: 1250, y: 330, werte: { wandel: 0.06, laenge: 8, umfang: 1.5 } },
      { id: "qu", typ: "quantisierer", x: 1640, y: 330, werte: { leiter: "phrygisch", grund: "4" } },
      { id: "fm", typ: "fmop", x: 1640, y: 620, werte: { frequenz: 523.25, verhaeltnis: 2, index: 1.5 } },
      { id: "lh", typ: "huellkurve", x: 1640, y: 950, werte: { a: 0.002, d: 0.12, s: 0, r: 0.08 } },
      { id: "lv", typ: "verstaerker", x: 1640, y: 1200, werte: { pegel: 0 } },
      { id: "ec", typ: "echo", x: 1250, y: 1200, werte: { zeit: 0.268, rueck: 0.4, nass: 0.3 } },
      { id: "mi", typ: "mischer", x: 470, y: 1100, werte: { k1: 0.9, k2: 0.5, k3: 0.8, k4: 0.45 } },
      { id: "aus", typ: "ausgang", x: 40, y: 1250, werte: { laut: 0.45 } },
    ],
    kabel: [
      ["e1", "Takt", "bd", "Auslöser"], ["bd", "aus", "vz", "ein"], ["e2", "Takt", "hh", "Auslöser"],
      ["nr", "Tonhöhe", "bo", "Tonhöhe"], ["nr", "Takt", "bh", "Auslöser"], ["bo", "aus", "bf", "ein"], ["bf", "aus", "bv", "ein"], ["bh", "aus", "bv", "Steuerung"],
      ["e3", "Takt", "tu", "Takt"], ["tu", "Tonhöhe", "qu", "ein"], ["qu", "aus", "fm", "Tonhöhe"], ["tu", "Takt", "lh", "Auslöser"],
      ["lh", "aus", "fm", "Index"], ["fm", "aus", "lv", "ein"], ["lh", "aus", "lv", "Steuerung"], ["lv", "aus", "ec", "ein"],
      ["vz", "aus", "mi", "1"], ["hh", "aus", "mi", "2"], ["bv", "aus", "mi", "3"], ["ec", "aus", "mi", "4"], ["mi", "aus", "aus", "ein"],
    ],
  },

  boombap: {
    text: "Boom Bap (88): Swing, Jazz-Akkorde (ii–V–I) auf einem E-Piano aus Stimmen, Band und Knistern für Staub",
    module: [
      { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 16, k: 3, drehen: 15, tempo: 88, teilung: "16" } },
      { id: "e2", typ: "euklid", x: 40, y: 330, werte: { n: 4, k: 2, drehen: 1, tempo: 88, teilung: "4" } },
      { id: "e3", typ: "euklid", x: 40, y: 620, werte: { n: 8, k: 8, tempo: 88, teilung: "8" } },
      { id: "tw", typ: "taktwerk", x: 470, y: 620, werte: { swing: 0.5, chance: 0.9 } },
      { id: "bd", typ: "bassdrum", x: 470, y: 40, werte: { tief: 55, hoch: 140, laenge: 0.5 } },
      { id: "sn", typ: "snare", x: 470, y: 330, werte: { ton: 220, mischung: 0.55, laenge: 0.25, farbe: 1200 } },
      { id: "hh", typ: "hihat", x: 860, y: 620, werte: { laenge: 0.05, farbe: 6000 } },
      { id: "dm", typ: "mischer", x: 860, y: 40, werte: { k1: 0.75, k2: 0.8, k3: 0.55 } },
      { id: "bc", typ: "bitcrusher", x: 1250, y: 40, werte: { bits: 10, teiler: 3, mix: 0.6 } },
      { id: "e4", typ: "euklid", x: 40, y: 1000, werte: { n: 4, k: 4, tempo: 88, teilung: "4" } },
      { id: "ak", typ: "akkorde", x: 470, y: 1000, werte: { grundton: "2", leiter: "dorisch", art: "sept", lage: "fuehrung", schlaege: "4", spielweise: "zusammen", laenge: 0.85, anschlag: 0.6, folge: "1,4,7,3,0,0,0,0", bassOktave: -2 } },
      { id: "ep", typ: "stimmen", x: 1100, y: 1000, werte: { form: "sine", form2: "triangle", mix: 0.25, a: 0.003, d: 1.6, s: 0.3, r: 0.5, grenze: 1600, reso: 0.8, fhk: 1.6, anschlagFilter: 0.8, breite: 6, pegel: 0.3 } },
      { id: "ba2", typ: "stimmen", x: 1100, y: 1600, werte: { form: "sine", form2: "triangle", mix: 0.3, a: 0.005, d: 0.5, s: 0.5, r: 0.12, grenze: 600, reso: 0.7, fhk: 0.8, breite: 0, anzahl: 1, pegel: 0.45 } },
      { id: "ch", typ: "chorus", x: 1680, y: 1000, werte: { mix: 0.4 } },
      { id: "kn", typ: "knistern", x: 1250, y: 330, werte: { rate: 30, laenge: 0.0004, knall: 0.05, breite: 0.9, pegel: 0.25 } },
      { id: "mi", typ: "mischer", x: 1680, y: 330, werte: { k1: 1, k2: 0.8, k3: 0.8, k4: 0.6 } },
      { id: "ba", typ: "band", x: 2080, y: 330, werte: { wow: 0.5, flutter: 0.3, antrieb: 2, rauschen: 0.004, alter: 7000, kopf: 3, aussetzer: 0.1 } },
      { id: "ko", typ: "kompressor", x: 2080, y: 700, werte: { schwelle: -20, verhaeltnis: 4, aufholen: 0 } },
      { id: "aus", typ: "ausgang", x: 2080, y: 1050, werte: { laut: 0.5 } },
    ],
    kabel: [
      ["e1", "Takt", "bd", "Auslöser"], ["e2", "Takt", "sn", "Auslöser"], ["e3", "Takt", "tw", "Takt"], ["tw", "Takt", "hh", "Auslöser"],
      ["bd", "aus", "dm", "1"], ["sn", "aus", "dm", "2"], ["hh", "aus", "dm", "3"], ["dm", "aus", "bc", "ein"],
      ["e4", "Takt", "ak", "Takt"], ["ak", "Noten", "ep", "Noten"], ["ak", "Bass", "ba2", "Noten"], ["ep", "aus", "ch", "ein"],
      ["bc", "aus", "mi", "1"], ["ch", "aus", "mi", "2"], ["ba2", "aus", "mi", "3"], ["kn", "aus", "mi", "4"],
      ["mi", "aus", "ba", "ein"], ["ba", "aus", "ko", "ein"], ["ko", "aus", "aus", "ein"],
    ],
  },

  // ---------- Instrumente zum Spielen (Runde 17) ----------
  // Alle Klangquellen stehen auf C4 = 261,63 Hz, die Tastatur gibt Halbtöne über C4 / 12 aus.
  // Runde 21: Tastatur statt MIDI-Eingang. Sie spielt mit der Computertastatur (A S D F …), der Maus und einem
  // MIDI-Keyboard; vorher blieben diese Vorlagen ohne Keyboard stumm.

  glocke: {
    text: "Glocke (Tastatur): FM mit krummem Verhältnis 3,5, die Hüllkurve öffnet den Index",
    module: [
      { id: "mi", typ: "tastatur", x: 40, y: 40, werte: {} },
      { id: "fm", typ: "fmop", x: 470, y: 40, werte: { frequenz: 261.63, verhaeltnis: 3.5, index: 0 } },
      { id: "hk", typ: "huellkurve", x: 470, y: 470, werte: { a: 0.001, d: 2.5, s: 0, r: 2.5 } },
      { id: "vc", typ: "verstaerker", x: 860, y: 40, werte: { pegel: 0 } },
      { id: "ha", typ: "hall", x: 1250, y: 40, werte: { zeit: 4, mix: 0.35 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 40, werte: { laut: 0.45 } },
    ],
    kabel: [["mi", "Tonhöhe", "fm", "Tonhöhe"], ["mi", "Takt", "hk", "Auslöser"], ["hk", "aus", "fm", "Index"], ["fm", "aus", "vc", "ein"], ["hk", "aus", "vc", "Steuerung"], ["vc", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]],
  },

  saite: {
    text: "Gezupfte Saite (Tastatur): Karplus-Strong",
    module: [
      { id: "mi", typ: "tastatur", x: 40, y: 40, werte: {} },
      { id: "sa", typ: "saite", x: 470, y: 40, werte: { frequenz: 261.63, klingen: 0.997, hell: 0.3 } },
      { id: "ha", typ: "hall", x: 860, y: 40, werte: { zeit: 2.2, mix: 0.3 } },
      { id: "aus", typ: "ausgang", x: 1250, y: 40, werte: { laut: 0.5 } },
    ],
    kabel: [["mi", "Tonhöhe", "sa", "Tonhöhe"], ["mi", "Takt", "sa", "Zupfen"], ["sa", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]],
  },

  generativ: {
    text: "Generativ: Turing-Maschine, Quantisierer, Saite, langer Hall (spielt sich selbst)",
    module: [
      { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 8, k: 5, tempo: 96, teilung: "8" } },
      { id: "tu", typ: "turing", x: 470, y: 40, werte: { wandel: 0.08, laenge: 7, umfang: 2 } },
      { id: "qu", typ: "quantisierer", x: 860, y: 40, werte: { leiter: "pentatonik-moll", grund: "2" } },
      { id: "sa", typ: "saite", x: 860, y: 400, werte: { frequenz: 146.83, klingen: 0.998, hell: 0.2 } },
      { id: "ec", typ: "echo", x: 1250, y: 40, werte: { zeit: 0.47, rueck: 0.45, nass: 0.3 } },
      { id: "ha", typ: "hall", x: 1250, y: 470, werte: { zeit: 7, mix: 0.45 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 470, werte: { laut: 0.5 } },
    ],
    kabel: [["e1", "Takt", "tu", "Takt"], ["tu", "Tonhöhe", "qu", "ein"], ["qu", "aus", "sa", "Tonhöhe"], ["tu", "Takt", "sa", "Zupfen"], ["sa", "aus", "ec", "ein"], ["ec", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]],
  },

  // ---------- Runde 21: Akkorde ----------
  akkorde: {
    text: "Akkorde (100): I–V–vi–IV als Fläche, Arpeggio und Bass aus einem Akkord-Modul, dazu Bassdrum und Hi-Hat",
    module: [
      { id: "e4", typ: "euklid", x: 40, y: 40, werte: { n: 4, k: 4, tempo: 100, teilung: "4" } },
      { id: "e16", typ: "euklid", x: 40, y: 330, werte: { n: 16, k: 11, drehen: 0, tempo: 100, teilung: "16" } },
      { id: "eh", typ: "euklid", x: 40, y: 620, werte: { n: 8, k: 4, drehen: 1, tempo: 100, teilung: "8" } },
      { id: "ak", typ: "akkorde", x: 470, y: 40, werte: { grundton: "0", leiter: "dur", art: "dreiklang", lage: "fuehrung", schlaege: "4", spielweise: "zusammen", laenge: 0.95, anschlag: 0.7, folge: "1,5,6,4,0,0,0,0", arp: "aufab", arpOktaven: 2, bassOktave: -2 } },
      { id: "pad", typ: "stimmen", x: 1100, y: 40, werte: { form: "sawtooth", form2: "sawtooth", mix: 0.5, breite: 18, a: 0.08, d: 1.2, s: 0.7, r: 1.2, grenze: 1300, reso: 1, fhk: 1.2, anschlagFilter: 0.4, pegel: 0.18 } },
      { id: "arp", typ: "stimmen", x: 1100, y: 640, werte: { form: "triangle", form2: "square", mix: 0.35, breite: 8, a: 0.002, d: 0.25, s: 0, r: 0.2, grenze: 1600, reso: 2, fhk: 2.5, anschlagFilter: 0.6, oktave: 1, pegel: 0.16 } },
      { id: "bass", typ: "stimmen", x: 1100, y: 1240, werte: { form: "square", form2: "sine", mix: 0.5, breite: 0, a: 0.005, d: 0.3, s: 0.7, r: 0.1, grenze: 380, reso: 2, fhk: 1.5, anzahl: 1, pegel: 0.3 } },
      { id: "echo", typ: "echo", x: 1680, y: 640, werte: { zeit: 0.45, rueck: 0.4, nass: 0.3 } },
      { id: "bd", typ: "bassdrum", x: 470, y: 900, werte: { tief: 50, hoch: 150, laenge: 0.4 } },
      { id: "hh", typ: "hihat", x: 470, y: 1200, werte: { laenge: 0.04 } },
      { id: "mi", typ: "mischer", x: 1680, y: 40, werte: { k1: 1, k2: 0.9, k3: 1, k4: 0.8 } },
      { id: "dr", typ: "mischer", x: 1680, y: 1240, werte: { k1: 0.8, k2: 0.5 } },
      { id: "ha", typ: "hall", x: 2080, y: 40, werte: { zeit: 2.5, daempfung: 0.6, mix: 0.25 } },
      { id: "ko", typ: "kompressor", x: 2080, y: 400, werte: { schwelle: -18, verhaeltnis: 3, aufholen: 2 } },
      { id: "aus", typ: "ausgang", x: 2080, y: 760, werte: { laut: 0.5 } },
    ],
    kabel: [
      ["e4", "Takt", "ak", "Takt"], ["e16", "Takt", "ak", "Arp-Takt"],
      ["ak", "Noten", "pad", "Noten"], ["ak", "Arpeggio", "arp", "Noten"], ["ak", "Bass", "bass", "Noten"],
      ["arp", "aus", "echo", "ein"],
      ["pad", "aus", "mi", "1"], ["echo", "aus", "mi", "2"], ["bass", "aus", "mi", "3"], ["dr", "aus", "mi", "4"],
      ["e4", "Takt", "bd", "Auslöser"], ["eh", "Takt", "hh", "Auslöser"], ["bd", "aus", "dr", "1"], ["hh", "aus", "dr", "2"],
      ["mi", "aus", "ha", "ein"], ["ha", "aus", "ko", "ein"], ["ko", "aus", "aus", "ein"],
    ],
  },

  ambient: {
    text: "Ambient (64): schwebende add9-Akkorde, langsame Fläche, zufälliges Glockenspiel, Tropfen im Hall, Band",
    module: [
      { id: "e1", typ: "euklid", x: 40, y: 40, werte: { n: 4, k: 4, tempo: 64, teilung: "4" } },
      { id: "e2", typ: "euklid", x: 40, y: 330, werte: { n: 16, k: 5, drehen: 2, tempo: 64, teilung: "8" } },
      { id: "ak", typ: "akkorde", x: 470, y: 40, werte: { grundton: "2", leiter: "dur", art: "add9", lage: "fuehrung", schlaege: "8", spielweise: "zusammen", laenge: 1, anschlag: 0.55, folge: "1,6,4,5,0,0,0,0", arp: "zufall", arpOktaven: 2, oktave: 0 } },
      { id: "pad", typ: "stimmen", x: 1100, y: 40, werte: { form: "sawtooth", form2: "triangle", mix: 0.5, breite: 25, a: 2.5, d: 3, s: 0.8, r: 5, grenze: 900, reso: 1.2, fhk: 0.8, anschlagFilter: 0.2, anzahl: 8, pegel: 0.42 } },
      { id: "lfo", typ: "lfo", x: 470, y: 900, werte: { tempo: 0.05, tiefe: 0.6, form: "sine" } },
      { id: "gl", typ: "stimmen", x: 1100, y: 640, werte: { form: "sine", form2: "triangle", mix: 0.2, breite: 4, a: 0.004, d: 2, s: 0, r: 2, grenze: 4000, reso: 0.7, fhk: 1, oktave: 1, pegel: 0.28 } },
      { id: "echo", typ: "echo", x: 1680, y: 640, werte: { zeit: 0.7, rueck: 0.55, nass: 0.45 } },
      { id: "tr", typ: "tropfen", x: 1680, y: 1000, werte: { rate: 0.7, rKlein: 2, rGross: 8, steigen: 0.25, breite: 1, pegel: 1 } },
      { id: "mi", typ: "mischer", x: 1680, y: 40, werte: { k1: 1, k2: 0.9, k3: 0.6, k4: 0 } },
      { id: "ha", typ: "hall", x: 2080, y: 40, werte: { zeit: 8, daempfung: 0.5, mix: 0.45 } },
      { id: "ba", typ: "band", x: 2080, y: 400, werte: { wow: 0.35, flutter: 0.1, antrieb: 1.2, rauschen: 0.002, alter: 9000, kopf: 3 } },
      { id: "aus", typ: "ausgang", x: 2080, y: 800, werte: { laut: 0.5 } },
    ],
    kabel: [
      ["e1", "Takt", "ak", "Takt"], ["e2", "Takt", "ak", "Arp-Takt"], ["ak", "Noten", "pad", "Noten"], ["ak", "Arpeggio", "gl", "Noten"],
      ["lfo", "aus", "pad", "Grenze"], ["gl", "aus", "echo", "ein"],
      ["pad", "aus", "mi", "1"], ["echo", "aus", "mi", "2"], ["tr", "aus", "mi", "3"],
      ["mi", "aus", "ha", "ein"], ["ha", "aus", "ba", "ein"], ["ba", "aus", "aus", "ein"],
    ],
  },

  pianoroll: {
    text: "Pianoroll: Noten zeichnen (eine Melodie mit Akkorden liegt schon da), mehrstimmig gespielt",
    module: [
      { id: "pr", typ: "pianoroll", x: 40, y: 40, werte: { tempo: 96, takte: "2", tiefste: 48, leiter: "moll", grundton: "9", swing: 0.12, noten: [[0, 57, 8, 0.6], [0, 60, 8, 0.55], [0, 64, 8, 0.55], [8, 55, 8, 0.6], [8, 60, 8, 0.55], [8, 64, 8, 0.5], [16, 53, 8, 0.6], [16, 57, 8, 0.55], [16, 60, 8, 0.55], [24, 52, 8, 0.6], [24, 55, 8, 0.55], [24, 59, 8, 0.55], [0, 69, 2, 0.9], [3, 72, 1, 0.7], [4, 71, 2, 0.8], [6, 67, 2, 0.6], [10, 69, 2, 0.8], [12, 64, 4, 0.7], [18, 65, 2, 0.8], [20, 69, 2, 0.7], [22, 72, 2, 0.9], [26, 71, 3, 0.8], [29, 68, 3, 0.7]] } },
      { id: "st", typ: "stimmen", x: 680, y: 40, werte: { form: "sawtooth", form2: "square", mix: 0.35, breite: 10, a: 0.01, d: 0.6, s: 0.5, r: 0.4, grenze: 1400, reso: 2, fhk: 2, anschlagFilter: 0.7, pegel: 0.45 } },
      { id: "ch", typ: "chorus", x: 1300, y: 40, werte: { mix: 0.35 } },
      { id: "ha", typ: "hall", x: 1300, y: 400, werte: { zeit: 2.2, mix: 0.25 } },
      { id: "aus", typ: "ausgang", x: 1300, y: 760, werte: { laut: 0.5 } },
      { id: "ta", typ: "tastatur", x: 40, y: 760, werte: {} },
    ],
    kabel: [["pr", "Noten", "st", "Noten"], ["ta", "Noten", "st", "Noten"], ["st", "aus", "ch", "ein"], ["ch", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]],
  },

  meer: {
    text: "Meer: braunes Rauschen, Wellen alle 9 s (LFO, mit Mathe auf 0 … 1 gebracht) öffnen Filter und Lautstärke, Gischt kommt etwas später",
    module: [
      { id: "ra", typ: "rauschen", x: 40, y: 40, werte: { farbe: "braun", pegel: 0.9 } },
      { id: "fi", typ: "filter", x: 470, y: 40, werte: { typ: "lowpass", grenze: 250, resonanz: 0.6, mod: 2.5 } },
      { id: "vc", typ: "verstaerker", x: 860, y: 40, werte: { pegel: 0.1 } },
      { id: "lfo", typ: "lfo", x: 40, y: 430, werte: { tempo: 0.11, tiefe: 1, form: "triangle" } },
      { id: "ma", typ: "mathe", x: 470, y: 430, werte: { art: "4", b: 0, faktor: 0.5, versatz: 0 } },
      { id: "ra2", typ: "rauschen", x: 40, y: 820, werte: { farbe: "weiss", pegel: 0.4 } },
      { id: "hp", typ: "filter", x: 470, y: 820, werte: { typ: "highpass", grenze: 2500, resonanz: 0.5, mod: 0 } },
      { id: "vc2", typ: "verstaerker", x: 860, y: 820, werte: { pegel: 0 } },
      { id: "ec", typ: "echo", x: 860, y: 430, werte: { zeit: 1.5, rueck: 0, nass: 1 } },
      { id: "mi", typ: "mischer", x: 1250, y: 40, werte: { k1: 1, k2: 0.5 } },
      { id: "ha", typ: "hall", x: 1250, y: 400, werte: { zeit: 2, daempfung: 0.6, mix: 0.3 } },
      { id: "aus", typ: "ausgang", x: 1640, y: 40, werte: { laut: 0.5 } },
    ],
    kabel: [
      ["ra", "aus", "fi", "ein"], ["fi", "aus", "vc", "ein"], ["lfo", "aus", "ma", "A"], ["ma", "aus", "fi", "Grenze"], ["ma", "aus", "vc", "Steuerung"],
      ["ra2", "aus", "hp", "ein"], ["hp", "aus", "vc2", "ein"], ["ma", "aus", "ec", "ein"], ["ec", "aus", "vc2", "Steuerung"],
      ["vc", "aus", "mi", "1"], ["vc2", "aus", "mi", "2"], ["mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"],
    ],
  },

  leer: {
    text: "Leer (nur der Ausgang)",
    module: [{ id: "aus", typ: "ausgang", x: 900, y: 300, werte: {} }],
    kabel: [],
  },
};

// Runde 22: Meer bekommt eine Notiz und wird eine Gruppe (zum Aufklappen und Nachbauen); dann die Lern-Vorlagen und
// die Landschaft aus vorlagen-natur.js, „Leer“ bleibt am Ende der Liste
VORLAGEN.meer.module.unshift({ id: "no", typ: "notiz", x: 40, y: 1200, werte: { text: MEER_NOTIZ } });
VORLAGEN.meer.gruppen = [{ id: "g1", titel: "Meer", offen: true, x: 0, y: 0, mitglieder: VORLAGEN.meer.module.filter((m) => m.typ !== "ausgang").map((m) => m.id), aussen: [["ha", "aus", "aus", "ton"]], makros: [["lfo", "tempo"], ["fi", "grenze"]] }];
{
  const leer = VORLAGEN.leer;
  delete VORLAGEN.leer;
  Object.assign(VORLAGEN, SPUREN_VORLAGEN, NATUR_VORLAGEN, { leer });
}
