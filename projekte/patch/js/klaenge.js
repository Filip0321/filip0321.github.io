// Klänge als Gruppen (Runde 22b, Runde 23 mit Presets): jedes Geräusch und jedes Instrument aus einfachen Modulen
// gesteckt, als Gruppe eingefügt (zugeklappt; ± klappt auf, und man sieht jedes Modul und jedes Kabel).
// Ähnliches steckt in EINER Gruppe mit Presets: „Vogel“ kann Amsel, Kohlmeise, Spatz, Kuckuck, Waldkauz und Specht.
// Ein Preset dreht an den Knöpfen und schaltet Teile aus (⏻): die Amsel braucht das Gezwitscher am Ende, die Meise den
// Zähler für „zi-zi-bä“, der Specht statt des Oszillators zwei Pling. Nach dem Wechsel sieht man, was sich geändert hat.
//
// Die Bausteine (Runde 22b): Zufallsgeber (wann), Salve (wie viele Silben oder Pulse), Kurve (Form jeder Silbe:
// Tonhöhen-Bogen und Hülle), Oszillator, Shaper, Filter, Pling (viele angeschlagene Töne zugleich), Zufall.
// Die Gruppen stehen auf denselben Rechnungen wie die alten kompakten Natur-Module (module-natur.js) und nehmen deren
// Zahlen: gleiche Zufallsverteilungen, gleiche Längen, gleiche Frequenzen. Bit für Bit gleich sind sie nicht (die
// Module rechnen einige Kurven etwas anders), aber gleich gebaut.
//
// Format: module, kabel, gruppe { titel, aussen, makros, presets, preset }. Lage x, y wird automatisch verteilt.

const SPALTE = 400, ZEILE = 480;
const m = (id, typ, werte = {}) => ({ id, typ, werte });

// presets: { Name: { werte: { id: { knopf: wert } }, aus: [ids] } }. Das erste ist der Anfang: seine Werte stehen gleich
// in den Modulen. Gespeichert wird je Preset jedes Mitglied mit seinen Werten und ⏻ (aus: ja oder nein).
function k(titel, text, module, kabel, aussen, makros = [], presets = null) {
  module.forEach((mm, i) => {
    mm.x ??= (i % 4) * SPALTE;
    mm.y ??= Math.floor(i / 4) * ZEILE;
    mm.werte ??= {};
  });
  let p = null, erstes = null;
  if (presets) {
    p = {};
    for (const [name, pr] of Object.entries(presets)) {
      p[name] = {};
      for (const mm of module) p[name][mm.id] = { werte: pr.werte?.[mm.id] ?? {}, stumm: (pr.aus ?? []).includes(mm.id) };
    }
    erstes = Object.keys(presets)[0];
    for (const mm of module) {
      Object.assign(mm.werte, p[erstes][mm.id].werte);
      if (p[erstes][mm.id].stumm) mm.werte.__stumm = true;
    }
  }
  return {
    titel, text, module, kabel,
    gruppe: { titel, aussen: aussen.map((a) => (typeof a === "string" ? [a, "aus", "aus", "ton"] : a)), makros, ...(p && { presets: p, preset: erstes }) },
  };
}

// ---------- Vogel ----------
const VOGEL = k("Vogel", "Vogel: Amsel, Kohlmeise, Spatz, Kuckuck, Waldkauz, Specht als Presets einer Gruppe", [
  m("zg", "zufallsgeber"), m("sv", "salve"), m("kt", "kurve"), m("kh", "kurve"),
  m("zl", "zaehler", { bis: 2 }), m("ma", "mathe", { art: "0", b: 0, versatz: 0 }), m("zw", "zufallstakt"), m("tw", "salve"),
  m("kt2", "kurve"), m("kh2", "kurve"), m("vib", "lfo", { form: "sine" }), m("os", "oszillator", { form: "sine" }),
  m("sh", "shaper"), m("lp", "filter"), m("vc", "verstaerker", { pegel: 0 }), m("pl", "pling"),
  m("p2", "pling"), m("end", "panorama"),
], [
  ["zg", "Takt", "sv", "Takt"], ["sv", "Takt", "kt", "Takt"], ["sv", "Takt", "kh", "Takt"], ["sv", "Takt", "zl", "Takt"],
  ["zl", "Zahl", "ma", "A"], ["ma", "aus", "os", "Tonhöhe"], ["kt", "aus", "os", "Tonhöhe"],
  ["sv", "Ende", "zw", "Takt"], ["zw", "A", "tw", "Takt"], ["tw", "Takt", "kt2", "Takt"], ["tw", "Takt", "kh2", "Takt"], ["kt2", "aus", "os", "Tonhöhe"],
  ["vib", "aus", "os", "FM"], ["os", "aus", "sh", "ein"], ["sh", "aus", "lp", "ein"], ["lp", "aus", "vc", "ein"],
  ["kh", "aus", "vc", "Steuerung"], ["kh2", "aus", "vc", "Steuerung"], ["vc", "aus", "end", "ein"],
  ["sv", "Takt", "pl", "Takt"], ["sv", "Takt", "p2", "Takt"], ["pl", "aus", "end", "ein"], ["p2", "aus", "end", "ein"],
], ["end", ["zg", "Dichte", "ein", "ton"]], [["zg", "rate"], ["os", "frequenz"], ["sv", "anzahl"], ["kt", "streuung"]], {
  Amsel: {
    werte: {
      zg: { rate: 7, regel: 0.1, dauer: 0.1 }, sv: { anzahl: 4, streuung: 4, abstand: 0.23, zufall: 0.35, beschleunigen: 1, dauer: 0.75 },
      kt: { art: "bogen", start: 0, mitte: 0.15, ende: 0, streuung: 0.4, dauer: 0.17 }, kh: { art: "huelle", mitte: 0.5, streuung: 0.12, dauer: 0.17, form: 2 },
      ma: { faktor: 0 }, zw: { p: 0.6 }, tw: { anzahl: 3, streuung: 4, abstand: 0.05, zufall: 0, beschleunigen: 1, dauer: 0.7 },
      kt2: { art: "bogen", start: 1.4, mitte: 1.3, ende: 1.1, streuung: 0.15, dauer: 0.035 }, kh2: { art: "huelle", mitte: 0.18, streuung: 0, dauer: 0.035, form: 2 },
      vib: { tempo: 28, tiefe: 0.6 }, os: { frequenz: 1900, fmTiefe: 40 }, sh: { art: "obertoene", antrieb: 1, nass: 0.1, trocken: 1 },
      lp: { typ: "lowpass", grenze: 12000, resonanz: 0.7, mod: 0 }, end: { lage: -0.3 },
    },
    aus: ["ma", "pl", "p2"],
  },
  Kohlmeise: {
    werte: {
      zg: { rate: 5, regel: 0.1, dauer: 0.1 }, sv: { anzahl: 8, streuung: 0, abstand: 0.135, zufall: 0.08, beschleunigen: 1, dauer: 0.6 },
      kt: { art: "bogen", start: 0.04, mitte: 0.02, ende: 0, streuung: 0, dauer: 0.085 }, kh: { art: "huelle", mitte: 0.45, streuung: 0, dauer: 0.085, form: 1.5 },
      ma: { faktor: -10 }, zw: { p: 0 }, vib: { tempo: 28, tiefe: 0 }, os: { frequenz: 6500, fmTiefe: 1 },
      sh: { art: "obertoene", antrieb: 1, nass: 0.1, trocken: 1 }, lp: { typ: "lowpass", grenze: 12000, resonanz: 0.7, mod: 0 }, end: { lage: 0.5 },
    },
    aus: ["zw", "pl", "p2"],
  },
  Spatz: {
    werte: {
      zg: { rate: 12, regel: 0.1, dauer: 0.1 }, sv: { anzahl: 2, streuung: 4, abstand: 0.22, zufall: 0.6, beschleunigen: 1, dauer: 0.4 },
      kt: { art: "bogen", start: 0.14, mitte: 0.25, ende: -0.55, streuung: 0.1, dauer: 0.07 }, kh: { art: "huelle", mitte: 0.45, streuung: 0, dauer: 0.07, form: 1.5 },
      ma: { faktor: 0 }, zw: { p: 0 }, vib: { tempo: 28, tiefe: 0 }, os: { frequenz: 4600, fmTiefe: 1 },
      sh: { art: "obertoene", antrieb: 1, nass: 0.1, trocken: 1 }, lp: { typ: "lowpass", grenze: 12000, resonanz: 0.7, mod: 0 }, end: { lage: 0.15 },
    },
    aus: ["ma", "zw", "pl", "p2"],
  },
  Kuckuck: {
    werte: {
      zg: { rate: 5, regel: 0.5, dauer: 0.1 }, sv: { anzahl: 4, streuung: 6, abstand: 0.55, zufall: 0, beschleunigen: 1, dauer: 0.7 },
      kt: { art: "bogen", start: 0, mitte: 0, ende: -0.03, streuung: 0, dauer: 0.3 }, kh: { art: "huelle", mitte: 0.55, streuung: 0, dauer: 0.3, form: 1.3 },
      ma: { faktor: -4 }, zw: { p: 0 }, vib: { tempo: 28, tiefe: 0 }, os: { frequenz: 760, fmTiefe: 1 },
      sh: { art: "weich", antrieb: 1.6, nass: 0.8, trocken: 0 }, lp: { typ: "lowpass", grenze: 1600, resonanz: 0.7, mod: 0 }, end: { lage: -0.2 },
    },
    aus: ["zw", "pl", "p2"],
  },
  Waldkauz: {
    werte: {
      zg: { rate: 2, regel: 0.4, dauer: 0.1 }, sv: { anzahl: 1, streuung: 0, abstand: 2.2, zufall: 0, beschleunigen: 1, dauer: 0.5 },
      kt: { art: "bogen", start: -0.05, mitte: 0.03, ende: -0.08, streuung: 0, dauer: 0.9 }, kh: { art: "huelle", mitte: 0.6, streuung: 0, dauer: 0.9, form: 1 },
      ma: { faktor: 0 }, zw: { p: 1 }, tw: { anzahl: 3, streuung: 0, abstand: 0.33, zufall: 0.1, beschleunigen: 1, dauer: 0.6 },
      kt2: { art: "bogen", start: 0, mitte: 0, ende: -0.05, streuung: 0, dauer: 0.24 }, kh2: { art: "huelle", mitte: 0.45, streuung: 0, dauer: 0.24, form: 1.2 },
      vib: { tempo: 6, tiefe: 0.4 }, os: { frequenz: 420, fmTiefe: 6 }, sh: { art: "obertoene", antrieb: 1, nass: 0.1, trocken: 1 },
      lp: { typ: "lowpass", grenze: 12000, resonanz: 0.7, mod: 0 }, end: { lage: -0.6 },
    },
    aus: ["ma", "pl", "p2"],
  },
  Specht: {
    werte: {
      zg: { rate: 4, regel: 0.2, dauer: 0.05 }, sv: { anzahl: 14, streuung: 8, abstand: 0.055, zufall: 0, beschleunigen: 1.012, dauer: 0.3 },
      pl: { frequenz: 900, abklingen: 0.02, steigen: -0.3, breite: 0, laut: 0.5, wasser: "0" }, p2: { frequenz: 2300, abklingen: 0.006, steigen: 0, breite: 0, laut: 0.3, wasser: "0" },
      zw: { p: 0 }, end: { lage: 0.4 },
    },
    aus: ["vc", "zw", "ma"],
  },
});

// ---------- Frosch ----------
// Impuls → Resonanz: ein Sägezahn mit der Pulsrate, der Shaper „Spitzen“ macht daraus schmale Impulse (die Luftstöße
// der Stimmbänder), die zwei Bandpässe anstoßen (die Schallblasen). Runde 23: das Schnarren. Ein Teichfrosch-Ruf ist
// nicht ein Ton, sondern Gruppen von Pulsen, etwa 25 je Sekunde (das „rrr“ im „quarr“). Mathe rechnet
// Hülle · (1 + LFO): ein Rechteck-LFO (±0,9) macht den Ruf 25-mal je Sekunde fast zu und wieder doppelt so weit auf;
// im Mittel bleibt er gleich laut. Ist der LFO aus (⏻), steht am Eingang B nur der Knopf b = 1: Hülle · 1.
// Die Unke ist anders: ein weicher, fast reiner Ton, „uuh“, ohne Pulse.
const FROSCH = k("Frosch", "Frosch: Teichfrosch, Laubfrosch, Unke (Impuls → Resonanz)", [
  m("zg", "zufallsgeber"), m("sv", "salve"), m("kh", "kurve"), m("kt", "kurve"),
  m("os", "oszillator"), m("sh", "shaper"), m("rr", "lfo", { form: "square" }), m("mr", "mathe", { art: "2", b: 1, faktor: 1, versatz: 0 }),
  m("f1", "filter"), m("f2", "filter"), m("mi", "mischer"), m("vc", "verstaerker", { pegel: 0 }), m("end", "panorama"),
], [
  ["zg", "Takt", "sv", "Takt"], ["sv", "Takt", "kh", "Takt"], ["sv", "Takt", "kt", "Takt"], ["kt", "aus", "os", "Tonhöhe"],
  ["os", "aus", "sh", "ein"], ["sh", "aus", "f1", "ein"], ["sh", "aus", "f2", "ein"], ["f1", "aus", "mi", "1"], ["f2", "aus", "mi", "2"],
  ["mi", "aus", "vc", "ein"], ["kh", "aus", "mr", "A"], ["rr", "aus", "mr", "B"], ["mr", "aus", "vc", "Steuerung"], ["vc", "aus", "end", "ein"],
], ["end", ["vc", "aus", "aus", "ton"], ["zg", "Dichte", "ein", "ton"]], [["zg", "rate"], ["os", "frequenz"], ["f1", "grenze"]], {
  Teichfrosch: {
    werte: {
      zg: { rate: 12, regel: 0.2, dauer: 0.1 }, sv: { anzahl: 2, streuung: 3, abstand: 0.55, zufall: 0.3, beschleunigen: 1, dauer: 0.7 },
      kh: { art: "huelle", mitte: 3, streuung: 0.5, dauer: 0.38, form: 0.7 }, kt: { art: "bogen", start: 0.08, mitte: 0, ende: -0.12, streuung: 0, dauer: 0.38 },
      os: { frequenz: 58, form: "sawtooth" }, sh: { art: "spitzen", antrieb: 1, nass: 1.5, trocken: 0 }, rr: { tempo: 25, tiefe: 0.9 },
      f1: { typ: "bandpass", grenze: 850, resonanz: 6, mod: 0 }, f2: { typ: "bandpass", grenze: 2000, resonanz: 5, mod: 0 }, mi: { k1: 1.5, k2: 0.9 }, end: { lage: 0.2 },
    },
  },
  Laubfrosch: {
    werte: {
      zg: { rate: 8, regel: 0.2, dauer: 0.1 }, sv: { anzahl: 6, streuung: 12, abstand: 0.14, zufall: 0.05, beschleunigen: 1, dauer: 0.3 },
      kh: { art: "huelle", mitte: 3, streuung: 0, dauer: 0.045, form: 1 }, kt: { art: "bogen", start: 0, mitte: 0, ende: 0.05, streuung: 0, dauer: 0.045 },
      os: { frequenz: 250, form: "sawtooth" }, sh: { art: "spitzen", antrieb: 1, nass: 1.5, trocken: 0 },
      f1: { typ: "bandpass", grenze: 2400, resonanz: 2.5, mod: 0 }, mi: { k1: 1.5, k2: 0 }, end: { lage: -0.4 },
    },
    aus: ["rr"],
  },
  Unke: {
    werte: {
      zg: { rate: 40, regel: 0.75, dauer: 0.1 }, sv: { anzahl: 1, streuung: 0, abstand: 0.3, zufall: 0, beschleunigen: 1, dauer: 0.8 },
      kh: { art: "huelle", mitte: 0.55, streuung: 0, dauer: 0.25, form: 2 }, kt: { art: "bogen", start: 0, mitte: 0, ende: -0.07, streuung: 0, dauer: 0.25 },
      os: { frequenz: 440, form: "triangle" }, sh: { art: "weich", antrieb: 0.5, nass: 0, trocken: 1 },
      f1: { typ: "lowpass", grenze: 900, resonanz: 0.7, mod: 0 }, mi: { k1: 1, k2: 0 }, end: { lage: 0 },
    },
    aus: ["rr"],
  },
});

// ---------- Insekt ----------
const INSEKT = k("Insekt", "Insekt: Grille (Pulse aus Salve und Kurve), Mücke und Hummel (Sägezahn, der zufällig wandert)", [
  m("zg", "zufallsgeber"), m("zt", "zufallstakt"), m("sv", "salve"), m("kh", "kurve"),
  m("zh", "zufall"), m("os", "oszillator"), m("sh", "shaper"), m("f", "filter"),
  m("za", "zufall"), m("vc", "verstaerker", { pegel: 0 }), m("zl", "zufall"), m("end", "panorama"),
], [
  ["zg", "Takt", "zt", "Takt"], ["zt", "A", "sv", "Takt"], ["sv", "Takt", "kh", "Takt"], ["zh", "aus", "os", "Tonhöhe"],
  ["os", "aus", "sh", "ein"], ["sh", "aus", "f", "ein"], ["f", "aus", "vc", "ein"], ["kh", "aus", "vc", "Steuerung"], ["za", "aus", "vc", "Steuerung"],
  ["vc", "aus", "end", "ein"], ["zl", "aus", "end", "Lage"],
], ["end", ["zg", "Dichte", "ein", "ton"]], [["zg", "rate"], ["os", "frequenz"]], {
  Grille: {
    werte: {
      zg: { rate: 138, regel: 0.9, dauer: 0.05 }, zt: { p: 0.92 }, sv: { anzahl: 3, streuung: 0, abstand: 0.0333, zufall: 0, beschleunigen: 1, dauer: 0.65 },
      kh: { art: "huelle", mitte: 0.35, dauer: 0.0217, form: 2 }, os: { frequenz: 4600, form: "sine" }, sh: { nass: 0, trocken: 1 },
      f: { typ: "lowpass", grenze: 12000, resonanz: 0.7, mod: 0 }, end: { lage: 0 },
    },
    aus: ["zh", "za", "zl"],
  },
  "Mücke": {
    werte: {
      os: { frequenz: 580, form: "sawtooth" }, zh: { art: "spaziergang", zeit: 0.6, staerke: 0.08, mitte: 0 }, sh: { nass: 0, trocken: 1 },
      f: { typ: "bandpass", grenze: 1200, resonanz: 1, mod: 0 }, za: { art: "spaziergang", zeit: 3, staerke: 0.4, mitte: 0.45 }, zl: { art: "spaziergang", zeit: 2, staerke: 1.2, mitte: 0 },
    },
    aus: ["zg", "kh"],
  },
  Hummel: {
    werte: {
      os: { frequenz: 170, form: "sawtooth" }, zh: { art: "spaziergang", zeit: 1.5, staerke: 0.05, mitte: 0 }, sh: { art: "weich", antrieb: 2, nass: 0.8, trocken: 0 },
      f: { typ: "lowpass", grenze: 1400, resonanz: 1, mod: 0 }, za: { art: "glatt", zeit: 4, staerke: 0.35, mitte: 0.45 }, zl: { art: "glatt", zeit: 5, staerke: 1, mitte: 0 },
    },
    aus: ["zg", "kh"],
  },
});

// ---------- Wasser ----------
// Runde 24: leiser und weniger „Bloop“ (zu wenig Steigen klingt nach Wasser, zu viel nach Spielzeug)
const WASSER = k("Wasser", "Wasser: Regen, Bach, Tropfstein (Blasen aus Pling, Größe zufällig; kleine viel häufiger)", [
  m("zg", "zufallsgeber", { regel: 0, dauer: 0.01 }), m("tz", "zufall", { art: "stufen", zeit: 300 }), m("ma", "mathe", { art: "2", b: 0 }), m("pl", "pling"),
  m("zd", "zufallsgeber", { regel: 0, dauer: 0.02 }), m("td", "zufall", { art: "stufen", zeit: 300 }), m("pd", "pling"), m("ra", "rauschen"),
  m("f", "filter"), m("mi", "mischer"),
], [
  ["zg", "Takt", "tz", "Takt"], ["zg", "Takt", "pl", "Takt"], ["tz", "aus", "ma", "A"], ["tz", "aus", "ma", "B"], ["ma", "aus", "pl", "Tonhöhe"],
  ["zd", "Takt", "td", "Takt"], ["zd", "Takt", "pd", "Takt"], ["td", "aus", "pd", "Tonhöhe"],
  ["ra", "aus", "f", "ein"], ["pl", "aus", "mi", "1"], ["pd", "aus", "mi", "2"], ["f", "aus", "mi", "3"],
], ["mi", ["zg", "Dichte", "ein", "ton"]], [["zg", "rate"], ["pl", "steigen"], ["pl", "frequenz"]], {
  Regen: {
    werte: {
      zg: { rate: 108000 }, tz: { staerke: 0.5, mitte: 0.5 }, ma: { faktor: -2.8, versatz: 2.8 }, pl: { frequenz: 1300, wasser: "1", steigen: 0.1, breite: 1, laut: 0.07 },
      zd: { rate: 140 }, td: { staerke: 0.5, mitte: 0 }, pd: { frequenz: 520, wasser: "1", steigen: 0.12, breite: 0.8, laut: 0.2 },
      ra: { farbe: "rosa", pegel: 0.12 }, f: { typ: "lowpass", grenze: 1600, resonanz: 0.5, mod: 0 }, mi: { k1: 1, k2: 1, k3: 1 },
    },
  },
  Bach: {
    werte: {
      zg: { rate: 4200 }, tz: { staerke: 0.5, mitte: 0.5 }, ma: { faktor: -2.8, versatz: 2.8 }, pl: { frequenz: 470, wasser: "1", steigen: 0.18, breite: 0.9, laut: 0.15 },
      zd: { rate: 24000 }, td: { staerke: 1, mitte: 1.3 }, pd: { frequenz: 1600, wasser: "1", steigen: 0.15, breite: 1, laut: 0.12 },
      ra: { farbe: "braun", pegel: 0.5 }, f: { typ: "bandpass", grenze: 500, resonanz: 0.6, mod: 0 }, mi: { k1: 1, k2: 0.8, k3: 0.7 },
    },
  },
  Tropfstein: {
    werte: {
      zg: { rate: 40 }, tz: { staerke: 0.5, mitte: 0.5 }, ma: { faktor: -1.5, versatz: 1.5 }, pl: { frequenz: 700, wasser: "0", abklingen: 0.18, steigen: 0.12, breite: 0.6, laut: 0.22 },
      mi: { k1: 1, k2: 0, k3: 0 },
    },
    aus: ["zd", "ra"],
  },
});

// ---------- Wind ----------
const WIND = k("Wind", "Wind: Brise, Wind, Sturm (Rauschen durch ein Band, Böen als Zufallsspaziergang, Pfeifen bei Böe² über 0,35)", [
  m("ra", "rauschen", { farbe: "weiss", pegel: 1 }), m("lp", "filter", { typ: "lowpass", grenze: 3000, resonanz: 0.5, mod: 0 }),
  m("bp", "filter", { typ: "bandpass", resonanz: 0.8, mod: 1.5 }), m("zu", "zufall", { art: "spaziergang" }),
  m("mq", "mathe", { art: "2", b: 0, faktor: 1.6, versatz: 0.15 }), m("vc", "verstaerker", { pegel: 0 }),
  m("p1", "filter", { typ: "bandpass", grenze: 700, resonanz: 30, mod: 1 }), m("p2", "filter", { typ: "bandpass", grenze: 1100, resonanz: 40, mod: 1 }),
  m("m1", "mathe", { art: "4", b: 0.35, faktor: 1, versatz: -0.35 }), m("m2", "mathe", { art: "2", b: 0, versatz: 0 }), m("vp", "verstaerker", { pegel: 0 }),
  m("zl", "zufall", { art: "spaziergang", zeit: 10, staerke: 0.5, mitte: 0 }), m("mi", "mischer", { k1: 1, k2: 1 }), m("end", "panorama"),
], [
  ["ra", "aus", "lp", "ein"], ["lp", "aus", "bp", "ein"], ["zu", "aus", "bp", "Grenze"], ["zu", "aus", "mq", "A"], ["zu", "aus", "mq", "B"], ["mq", "aus", "vc", "Steuerung"], ["bp", "aus", "vc", "ein"],
  ["ra", "aus", "p1", "ein"], ["ra", "aus", "p2", "ein"], ["zu", "aus", "p1", "Grenze"], ["zu", "aus", "p2", "Grenze"],
  ["zu", "aus", "m1", "A"], ["m1", "aus", "m2", "A"], ["m1", "aus", "m2", "B"], ["m2", "aus", "vp", "Steuerung"], ["p1", "aus", "vp", "ein"], ["p2", "aus", "vp", "ein"],
  ["vc", "aus", "mi", "1"], ["vp", "aus", "mi", "2"], ["mi", "aus", "end", "ein"], ["zl", "aus", "end", "Lage"],
], ["end", ["zu", "aus", "aus", "ton"], ["zu", "dazu", "ein", "ton"]], [["zu", "mitte"], ["zu", "zeit"], ["zu", "staerke"], ["m2", "faktor"]], {
  Wind: { werte: { zu: { zeit: 3.3, staerke: 0.6, mitte: 0.5 }, bp: { grenze: 300 }, m2: { faktor: 1.8 }, mi: { k1: 1, k2: 1 } } },
  Brise: { werte: { zu: { zeit: 6, staerke: 0.3, mitte: 0.25 }, bp: { grenze: 250 }, m2: { faktor: 0.5 }, mi: { k1: 1.5, k2: 1 } } },
  // Sturm: die Böen gehen viermal so hoch (Böe² · 1,6), darum leiser gemischt (sonst Spitzen über 1)
  Sturm: { werte: { zu: { zeit: 1.5, staerke: 0.7, mitte: 0.85 }, bp: { grenze: 400 }, m2: { faktor: 1.5 }, mi: { k1: 0.6, k2: 0.6 } } },
});

// ---------- Feuer ----------
const FEUER = k("Feuer", "Feuer: Knacken mit Potenzgesetz (Zufall hoch 4), Zischen, Glut aus braunem Rauschen", [
  m("zg", "zufallsgeber", { regel: 0, dauer: 0.004 }), m("tz", "zufall", { art: "stufen", zeit: 300, staerke: 0.5, mitte: 0.5 }),
  m("m2", "mathe", { art: "2", b: 0, faktor: 1, versatz: 0 }), m("kh", "kurve", { art: "huelle", mitte: 1, dauer: 0.004, form: 0.5 }),
  m("m4", "mathe", { art: "2", b: 0, faktor: 1, versatz: 0 }), m("mh", "mathe", { art: "2", b: 0, faktor: 1, versatz: 0 }),
  m("ra", "rauschen", { farbe: "weiss", pegel: 0.9 }), m("lk", "filter", { typ: "lowpass", grenze: 7000, resonanz: 0.5, mod: 0 }),
  m("vc", "verstaerker", { pegel: 0 }), m("tp", "zufall", { art: "stufen", zeit: 300, staerke: 0.7, mitte: 0 }), m("pk", "panorama", { lage: 0 }),
  m("zz", "zufallsgeber", { regel: 0, dauer: 0.001 }), m("kz", "kurve", { art: "huelle", mitte: 0.25, dauer: 0.0004, form: 0.5 }),
  m("hp", "filter", { typ: "highpass", grenze: 3500, resonanz: 0.7, mod: 0 }), m("vz", "verstaerker", { pegel: 0 }),
  m("rb", "rauschen", { farbe: "braun" }), m("zl", "zufall", { art: "spaziergang", zeit: 1.2, staerke: 0.8, mitte: 0 }),
  m("lo", "filter", { typ: "lowpass", resonanz: 1, mod: 1.5 }), m("mi", "mischer", { k1: 1, k2: 0.5, k3: 0.9 }),
], [
  ["zg", "Takt", "tz", "Takt"], ["zg", "Takt", "kh", "Takt"], ["zg", "Takt", "tp", "Takt"], ["tz", "aus", "m2", "A"], ["tz", "aus", "m2", "B"],
  ["m2", "aus", "m4", "A"], ["m2", "aus", "m4", "B"], ["m4", "aus", "mh", "A"], ["kh", "aus", "mh", "B"],
  ["ra", "aus", "lk", "ein"], ["lk", "aus", "vc", "ein"], ["mh", "aus", "vc", "Steuerung"], ["vc", "aus", "pk", "ein"], ["tp", "aus", "pk", "Lage"],
  ["zz", "Takt", "kz", "Takt"], ["ra", "aus", "hp", "ein"], ["hp", "aus", "vz", "ein"], ["kz", "aus", "vz", "Steuerung"],
  ["rb", "aus", "lo", "ein"], ["zl", "aus", "lo", "Grenze"], ["pk", "aus", "mi", "1"], ["vz", "aus", "mi", "2"], ["lo", "aus", "mi", "3"],
], ["mi"], [["zg", "rate"], ["zz", "rate"], ["lo", "grenze"]], {
  Lagerfeuer: { werte: { zg: { rate: 720 }, zz: { rate: 21000 }, rb: { pegel: 0.45 }, lo: { grenze: 180 } } },
  Kamin: { werte: { zg: { rate: 240 }, zz: { rate: 6000 }, rb: { pegel: 0.6 }, lo: { grenze: 130 } } },
});

// ---------- Donner ----------
const DONNER = k("Donner", "Donner: braunes Rauschen durch einen tiefen Tiefpass, eine lange Hüllkurve öffnet Lautstärke und Filter", [
  m("zg", "zufallsgeber", { regel: 0, dauer: 1 }), m("hk", "huellkurve"), m("ra", "rauschen", { farbe: "braun", pegel: 0.5 }),
  m("lp", "filter", { typ: "lowpass", resonanz: 0.8, mod: 2 }), m("vc", "verstaerker", { pegel: 0 }),
], [["zg", "Takt", "hk", "Auslöser"], ["ra", "aus", "lp", "ein"], ["hk", "aus", "lp", "Grenze"], ["lp", "aus", "vc", "ein"], ["hk", "aus", "vc", "Steuerung"]],
["vc", ["zg", "Takt", "aus", "takt"], ["zg", "Dichte", "ein", "ton"]], [["zg", "rate"], ["hk", "d"]], {
  nah: { werte: { zg: { rate: 1.5 }, hk: { a: 0.15, d: 4, s: 0, r: 2 }, lp: { grenze: 160 } } },
  fern: { werte: { zg: { rate: 1.5 }, hk: { a: 0.6, d: 7, s: 0, r: 3 }, lp: { grenze: 80 } } },
});

// ---------- Glocke ----------
// Modalsynthese: ein angeschlagener Körper schwingt in seinen Eigenschwingungen (Moden), jede ein Sinus, der ausklingt.
const glockeWerte = (basis, verh, zeiten, laut) => Object.fromEntries(verh.map((v, i) => [`p${i + 1}`, { frequenz: basis * v, abklingen: zeiten[i], breite: 0, laut: laut[i], steigen: 0, wasser: "0" }]));
const GLOCKE = k("Glocke", "Glocke: sechs Teiltöne (Pling) zu krummen Verhältnissen; Kirchenglocke, Glöckchen, Gong", [
  m("zg", "zufallsgeber", { regel: 1, dauer: 0.1 }), m("p1", "pling"), m("p2", "pling"), m("p3", "pling"), m("p4", "pling"), m("p5", "pling"), m("p6", "pling"),
  m("end", "verstaerker", { pegel: 0.8 }),
], [["zg", "Takt", "p1", "Takt"], ["zg", "Takt", "p2", "Takt"], ["zg", "Takt", "p3", "Takt"], ["zg", "Takt", "p4", "Takt"], ["zg", "Takt", "p5", "Takt"], ["zg", "Takt", "p6", "Takt"],
  ["p1", "aus", "end", "ein"], ["p2", "aus", "end", "ein"], ["p3", "aus", "end", "ein"], ["p4", "aus", "end", "ein"], ["p5", "aus", "end", "ein"], ["p6", "aus", "end", "ein"]],
["end", ["zg", "Takt", "aus", "takt"]], [["zg", "rate"], ["p2", "frequenz"]], {
  // Kirchenglocke: Unterton 0,5, Prime 1, Terz 1,2 (moll), Quinte 1,5, Oktave 2, 2,5
  Kirchenglocke: { werte: { zg: { rate: 6 }, ...glockeWerte(440, [0.5, 1, 1.2, 1.5, 2, 2.5], [4, 3, 2.4, 1.8, 1.5, 1], [0.25, 0.3, 0.22, 0.15, 0.18, 0.1]) } },
  "Glöckchen": { werte: { zg: { rate: 20 }, ...glockeWerte(1760, [0.5, 1, 1.2, 1.5, 2, 2.5], [1, 0.8, 0.6, 0.5, 0.4, 0.3], [0.1, 0.25, 0.15, 0.1, 0.12, 0.06]) } },
  // Gong: Platte statt Schale, die Moden liegen noch krummer (Kreisplatte nach Chladni: 1 : 1,59 : 2,14 : 2,30 …)
  Gong: { werte: { zg: { rate: 3 }, ...glockeWerte(110, [1, 1.59, 2.14, 2.3, 2.65, 3.16], [6, 5, 4, 4, 3, 2.5], [0.3, 0.2, 0.15, 0.15, 0.1, 0.08]) } },
});

// ---------- Instrumente ----------
// Bläser (Runde 24: physikalisch). Vorher: Sägezahn durch Filter, und das klang nach Synthesizer. Jetzt ist die
// Quelle ein Blasrohr (worklets.js): ein Rohr als Verzögerungsleitung mit einem Rohrblatt oder einer Luftkante. Der
// Ton entsteht im Rohr selbst; die Hüllkurve gibt nicht die Lautstärke, sondern den ATEM (Druck). Mehr Druck = lauter
// UND heller, beim Anblasen ein kurzes Suchen, bevor der Ton steht, und Luftrauschen, wo das Blatt nicht schließt.
// Danach: ein Formant (Glocken-Filter, die Resonanz von Rohr und Trichter), ein Tiefpass, verzögertes Vibrato wie
// gehabt (die zweite Hüllkurve blendet den LFO nach einer halben Sekunde ein).
// Trompete: ein Blech-Modell (schwingende Lippen) sprang noch nicht verlässlich an; bis dahin ist sie ein angeblasenes
// Saxophon-Rohr mit hartem Shaper und hellem Formant, also eine Annäherung.
const BLAESER = k("Bläser", "Bläser: Klarinette, Saxophon, Flöte, Oboe, Trompete (Blasrohr: physikalisches Modell; einstimmig, Noten am Eingang)", [
  m("nz", "notenZuTon"), m("gl", "glide"), m("br", "blasrohr"), m("vib", "lfo", { form: "sine" }),
  m("vv", "verstaerker", { pegel: 0 }), m("hv", "huellkurve"), m("hk", "huellkurve"), m("sh", "shaper"),
  m("f2", "filter"), m("f1", "filter"), m("end", "verstaerker", { pegel: 0.6 }),
], [
  ["nz", "Tonhöhe", "gl", "ein"], ["gl", "aus", "br", "Tonhöhe"], ["vib", "aus", "vv", "ein"], ["vv", "aus", "br", "Tonhöhe"],
  ["nz", "Takt", "hv", "Auslöser"], ["hv", "aus", "vv", "Steuerung"], ["nz", "Takt", "hk", "Auslöser"], ["hk", "aus", "br", "Druck"],
  ["br", "aus", "sh", "ein"], ["sh", "aus", "f2", "ein"], ["f2", "aus", "f1", "ein"], ["f1", "aus", "end", "ein"],
], ["end", ["nz", "Noten", "ein", "noten"]], [["br", "staerke"], ["br", "blatt"], ["br", "luft"], ["vib", "tiefe"]], {
  Klarinette: { werte: {
    gl: { zeit: 0.02 }, br: { art: "klarinette", frequenz: 261.63, staerke: 1, blatt: 0.5, luft: 0.08, pegel: 0.8 }, vib: { tempo: 5, tiefe: 0.004 },
    hv: { a: 0.6, d: 0.1, s: 1, r: 0.1 }, hk: { a: 0.04, d: 0.2, s: 1, r: 0.06 }, sh: { art: "weich", antrieb: 1, nass: 0, trocken: 1 },
    f2: { typ: "peaking", grenze: 1500, resonanz: 1.5, mod: 0 }, f1: { typ: "lowpass", grenze: 5000, resonanz: 0.7, mod: 0 } } },
  Saxophon: { werte: {
    gl: { zeit: 0.03 }, br: { art: "saxophon", frequenz: 261.63, staerke: 0.9, blatt: 0.7, luft: 0.15, pegel: 2.5 }, vib: { tempo: 5, tiefe: 0.01 },
    hv: { a: 0.5, d: 0.1, s: 1, r: 0.1 }, hk: { a: 0.04, d: 0.2, s: 1, r: 0.08 }, sh: { art: "weich", antrieb: 1.5, nass: 0.5, trocken: 0.5 },
    f2: { typ: "peaking", grenze: 1300, resonanz: 1.5, mod: 0 }, f1: { typ: "lowpass", grenze: 4500, resonanz: 0.7, mod: 0 } } },
  "Flöte": { werte: {
    gl: { zeit: 0.02 }, br: { art: "floete", frequenz: 261.63, staerke: 0.75, blatt: 0.5, luft: 0.3, pegel: 0.6 }, vib: { tempo: 5, tiefe: 0.008 },
    hv: { a: 0.4, d: 0.1, s: 1, r: 0.1 }, hk: { a: 0.06, d: 0.2, s: 1, r: 0.1 }, sh: { art: "weich", antrieb: 1, nass: 0, trocken: 1 },
    f2: { typ: "peaking", grenze: 800, resonanz: 0.7, mod: 0 }, f1: { typ: "lowpass", grenze: 6000, resonanz: 0.7, mod: 0 } } },
  Oboe: { werte: {
    gl: { zeit: 0.02 }, br: { art: "saxophon", frequenz: 261.63, staerke: 1, blatt: 1, luft: 0.08, pegel: 2.5 }, vib: { tempo: 5, tiefe: 0.006 },
    hv: { a: 0.5, d: 0.1, s: 1, r: 0.1 }, hk: { a: 0.03, d: 0.2, s: 1, r: 0.06 }, sh: { art: "hart", antrieb: 1.5, nass: 0.5, trocken: 0.5 },
    f2: { typ: "peaking", grenze: 1400, resonanz: 4, mod: 0 }, f1: { typ: "lowpass", grenze: 5000, resonanz: 0.7, mod: 0 } } },
  Trompete: { werte: {
    gl: { zeit: 0.02 }, br: { art: "saxophon", frequenz: 261.63, staerke: 1.05, blatt: 0.8, luft: 0.05, pegel: 1 }, vib: { tempo: 5.5, tiefe: 0.005 },
    hv: { a: 0.6, d: 0.1, s: 1, r: 0.1 }, hk: { a: 0.03, d: 0.2, s: 1, r: 0.06 }, sh: { art: "weich", antrieb: 4, nass: 1, trocken: 0 },
    f2: { typ: "peaking", grenze: 1200, resonanz: 1.2, mod: 0 }, f1: { typ: "lowpass", grenze: 3500, resonanz: 1.5, mod: 0 } } },
});

// Streicher (Runde 24: physikalisch). Die Quelle ist ein Bogen auf einer Saite (worklets.js): Haften und Rutschen,
// daraus die Helmholtz-Bewegung (ein Sägezahn, aber einer, der lebt: er braucht beim Anstrich einen Moment, rauscht
// am Bogen, kratzt bei zu viel Druck). Die Hüllkurve ist die Bogengeschwindigkeit. Danach der Korpus: drei
// Glocken-Filter (Luft im Korpus um 280 Hz, Holz um 450 Hz, der „Brückenbuckel“ um 2,5 kHz bei der Geige).
// Pizzicato: gezupft statt gestrichen, also die Saite aus Karplus-Strong (Modul „Saite“), der Bogen ist aus.
// Frequenz überall 261,63 Hz (C4): „Noten → Ton“ rechnet ab C4, so klingt jede Note, wie sie gespielt wird. Ein Cello
// ist ein Cello, weil man es tief spielt (und durch seinen Korpus), nicht weil der Knopf tiefer steht.
const STREICHER = k("Streicher", "Streicher: Geige, Bratsche, Cello, Pizzicato (Bogen: physikalisches Modell; einstimmig)", [
  m("nz", "notenZuTon"), m("gl", "glide"), m("bo", "bogen"), m("sa", "saite"),
  m("vib", "lfo", { form: "sine" }), m("vv", "verstaerker", { pegel: 0 }), m("hv", "huellkurve"), m("hk", "huellkurve"),
  m("b1", "filter"), m("b2", "filter"), m("b3", "filter"), m("f1", "filter"),
  m("end", "verstaerker", { pegel: 0.8 }),
], [
  ["nz", "Tonhöhe", "gl", "ein"], ["gl", "aus", "bo", "Tonhöhe"], ["gl", "aus", "sa", "Tonhöhe"], ["vib", "aus", "vv", "ein"], ["vv", "aus", "bo", "Tonhöhe"],
  ["nz", "Takt", "hv", "Auslöser"], ["hv", "aus", "vv", "Steuerung"], ["nz", "Takt", "hk", "Auslöser"], ["hk", "aus", "bo", "Druck"], ["nz", "Takt", "sa", "Zupfen"],
  ["bo", "aus", "b1", "ein"], ["sa", "aus", "b1", "ein"], ["b1", "aus", "b2", "ein"], ["b2", "aus", "b3", "ein"], ["b3", "aus", "f1", "ein"], ["f1", "aus", "end", "ein"],
], ["end", ["nz", "Noten", "ein", "noten"]], [["bo", "staerke"], ["bo", "blatt"], ["bo", "luft"], ["vib", "tiefe"]], {
  Geige: { werte: {
    end: { pegel: 0.8 }, gl: { zeit: 0.05 }, bo: { frequenz: 261.63, staerke: 1, blatt: 0.6, luft: 0.3, pegel: 0.7 }, vib: { tempo: 5.5, tiefe: 0.012 }, hv: { a: 0.4, d: 0.1, s: 1, r: 0.2 },
    hk: { a: 0.12, d: 0.2, s: 1, r: 0.15 }, b1: { typ: "peaking", grenze: 280, resonanz: 3, mod: 0 }, b2: { typ: "peaking", grenze: 450, resonanz: 2, mod: 0 },
    b3: { typ: "peaking", grenze: 2600, resonanz: 1, mod: 0 }, f1: { typ: "lowpass", grenze: 7000, resonanz: 0.7, mod: 0 } }, aus: ["sa"] },
  Bratsche: { werte: {
    end: { pegel: 0.8 }, gl: { zeit: 0.05 }, bo: { frequenz: 261.63, staerke: 1, blatt: 0.6, luft: 0.3, pegel: 0.7 }, vib: { tempo: 5.2, tiefe: 0.012 }, hv: { a: 0.45, d: 0.1, s: 1, r: 0.2 },
    hk: { a: 0.14, d: 0.2, s: 1, r: 0.18 }, b1: { typ: "peaking", grenze: 230, resonanz: 3, mod: 0 }, b2: { typ: "peaking", grenze: 380, resonanz: 2, mod: 0 },
    b3: { typ: "peaking", grenze: 2000, resonanz: 1, mod: 0 }, f1: { typ: "lowpass", grenze: 5500, resonanz: 0.7, mod: 0 } }, aus: ["sa"] },
  Cello: { werte: {
    end: { pegel: 0.8 }, gl: { zeit: 0.06 }, bo: { frequenz: 261.63, staerke: 1, blatt: 0.65, luft: 0.25, pegel: 0.9 }, vib: { tempo: 5, tiefe: 0.011 }, hv: { a: 0.5, d: 0.1, s: 1, r: 0.2 },
    hk: { a: 0.16, d: 0.2, s: 1, r: 0.25 }, b1: { typ: "peaking", grenze: 110, resonanz: 3, mod: 0 }, b2: { typ: "peaking", grenze: 220, resonanz: 2, mod: 0 },
    b3: { typ: "peaking", grenze: 1200, resonanz: 1, mod: 0 }, f1: { typ: "lowpass", grenze: 4000, resonanz: 0.7, mod: 0 } }, aus: ["sa"] },
  Pizzicato: { werte: {
    end: { pegel: 0.35 }, gl: { zeit: 0.001 }, sa: { frequenz: 261.63, klingen: 0.993, hell: 0.2 }, vib: { tempo: 5, tiefe: 0 },
    b1: { typ: "peaking", grenze: 280, resonanz: 3, mod: 0 }, b2: { typ: "peaking", grenze: 450, resonanz: 2, mod: 0 },
    b3: { typ: "peaking", grenze: 2600, resonanz: 1, mod: 0 }, f1: { typ: "lowpass", grenze: 4000, resonanz: 0.7, mod: 0 } }, aus: ["bo"] },
});

// Trommel (Runde 24): Schlagzeug aus Teilen, wie die Drum-Synths in Ableton (DS Kick, DS Snare, DS HH …) oder eine
// 808/909: keine Aufnahmen, alles gerechnet. Ein Takt am Eingang geht in eine Salve (für das Händeklatschen: vier
// schnelle Stöße, wie vier Hände, die nicht ganz gleichzeitig klatschen; sonst ein Stoß), von dort an:
//   Ton       zwei Oszillatoren, deren Tonhöhe eine schnelle Hüllkurve von oben herunterzieht (der „Punch“ einer Kick:
//             eine 808-Kick beginnt etwa zwei Oktaven höher und fällt in 50 ms auf ihren Grundton)
//   Rauschen  durch ein Filter, mit eigener kurzer Hüllkurve (Snare-Teppich, Hi-Hat, Klatschen)
//   Pling     ein angeschlagener Sinus (Clave, Rimshot)
// Ein Preset schaltet aus, was es nicht braucht. Cowbell: zwei Rechtecke bei 540 und 800 Hz, wie in der 808.
const TROMMEL_BASIS = {
  sv: { anzahl: 1, streuung: 0, abstand: 0.011, zufall: 0, beschleunigen: 1, dauer: 0.5 },
  hk: { a: 0.001, d: 0.5, s: 0, r: 0.2 }, hp: { a: 0.001, d: 0.05, s: 0, r: 0.05 }, mp: { art: "0", b: 0, faktor: 2, versatz: 0 },
  os: { frequenz: 50, form: "sine", fmTiefe: 1 }, o2: { frequenz: 80, form: "sine", fmTiefe: 1 },
  fk: { typ: "lowpass", grenze: 3000, resonanz: 0.7, mod: 0 },
  ra: { farbe: "weiss", pegel: 1 }, nf: { typ: "highpass", grenze: 3000, resonanz: 0.7, mod: 0 }, kn: { a: 0.001, d: 0.01, s: 0, r: 0.02 },
  pl: { frequenz: 2500, abklingen: 0.03, steigen: 0, breite: 0, laut: 0.6, wasser: "0" },
  mi: { k1: 1, k2: 0, k3: 0 }, sh: { art: "weich", antrieb: 1, nass: 0, trocken: 1 }, end: { pegel: 0.8 },
};
const tr = (ueber, aus) => ({ werte: Object.fromEntries(Object.entries(TROMMEL_BASIS).map(([id, w]) => [id, { ...w, ...(ueber[id] ?? {}) }])), aus });
const TROMMEL = k("Trommel", "Trommel: Kick 808, Kick 909, Snare, Klatschen, Hi-Hat zu/offen, Tom, Cowbell, Clave, Rimshot (alles gerechnet, Takt am Eingang)", [
  m("sv", "salve"), m("hk", "huellkurve"), m("hp", "huellkurve"), m("mp", "mathe"),
  m("os", "oszillator"), m("o2", "oszillator"), m("vb", "verstaerker", { pegel: 0 }), m("v2", "verstaerker", { pegel: 0 }),
  m("fk", "filter"), m("ra", "rauschen"), m("nf", "filter"), m("kn", "huellkurve"),
  m("vn", "verstaerker", { pegel: 0 }), m("pl", "pling"), m("mi", "mischer"), m("sh", "shaper"),
  m("end", "verstaerker"),
], [
  ["sv", "Erster", "hk", "Auslöser"], ["sv", "Erster", "hp", "Auslöser"], ["sv", "Takt", "kn", "Auslöser"], ["sv", "Erster", "pl", "Takt"],
  ["hp", "aus", "mp", "A"], ["mp", "aus", "os", "Tonhöhe"], ["mp", "aus", "o2", "Tonhöhe"],
  ["os", "aus", "vb", "ein"], ["o2", "aus", "v2", "ein"], ["hk", "aus", "vb", "Steuerung"], ["hk", "aus", "v2", "Steuerung"],
  ["vb", "aus", "fk", "ein"], ["v2", "aus", "fk", "ein"], ["fk", "aus", "mi", "1"],
  ["ra", "aus", "nf", "ein"], ["nf", "aus", "vn", "ein"], ["kn", "aus", "vn", "Steuerung"], ["vn", "aus", "mi", "2"], ["pl", "aus", "mi", "3"],
  ["mi", "aus", "sh", "ein"], ["sh", "aus", "end", "ein"],
], ["end", ["sv", "Takt", "ein", "takt"]], [["os", "frequenz"], ["hk", "d"], ["kn", "d"], ["sh", "antrieb"]], {
  "Kick 808": tr({ hk: { d: 0.9, r: 0.4 }, hp: { d: 0.05 }, mp: { faktor: 2 }, os: { frequenz: 48 }, sh: { antrieb: 1.5, nass: 0.3, trocken: 0.8 } }, ["v2", "vn", "pl"]),
  "Kick 909": tr({ hk: { d: 0.4 }, hp: { d: 0.03 }, mp: { faktor: 2.5 }, os: { frequenz: 55 }, nf: { grenze: 4000 }, kn: { d: 0.006 }, mi: { k1: 1, k2: 0.4 }, sh: { antrieb: 2.5, nass: 0.6, trocken: 0.5 } }, ["v2", "pl"]),
  Snare: tr({ hk: { d: 0.12 }, hp: { d: 0.02 }, mp: { faktor: 0.4 }, os: { frequenz: 185, form: "triangle" }, o2: { frequenz: 330, form: "triangle" }, fk: { grenze: 5000 },
    nf: { typ: "highpass", grenze: 1500 }, kn: { d: 0.18, r: 0.1 }, mi: { k1: 0.4, k2: 0.6 } }, ["pl"]),
  Klatschen: tr({ sv: { anzahl: 4, abstand: 0.011, zufall: 0.3 }, nf: { typ: "bandpass", grenze: 1100, resonanz: 1.5 }, kn: { d: 0.05, r: 0.15 }, mi: { k1: 0, k2: 1.5 }, end: { pegel: 1 } }, ["vb", "v2", "pl"]),
  "Hi-Hat zu": tr({ nf: { typ: "highpass", grenze: 7000 }, kn: { d: 0.04, r: 0.03 }, mi: { k1: 0, k2: 0.8 } }, ["vb", "v2", "pl"]),
  "Hi-Hat offen": tr({ nf: { typ: "highpass", grenze: 6500 }, kn: { d: 0.4, r: 0.2 }, mi: { k1: 0, k2: 0.7 } }, ["vb", "v2", "pl"]),
  Tom: tr({ hk: { d: 0.45 }, hp: { d: 0.12 }, mp: { faktor: 0.6 }, os: { frequenz: 110 }, nf: { grenze: 2500 }, kn: { d: 0.02 }, mi: { k1: 1, k2: 0.15 } }, ["v2", "pl"]),
  Cowbell: tr({ hk: { d: 0.3 }, mp: { faktor: 0 }, os: { frequenz: 540, form: "square" }, o2: { frequenz: 800, form: "square" }, fk: { typ: "bandpass", grenze: 2600, resonanz: 1.2 }, mi: { k1: 0.6 } }, ["vn", "pl"]),
  Clave: tr({ pl: { frequenz: 2500, abklingen: 0.025, laut: 1 }, mi: { k1: 0, k2: 0, k3: 1 } }, ["vb", "v2", "vn"]),
  Rimshot: tr({ pl: { frequenz: 1700, abklingen: 0.012 }, nf: { grenze: 2500 }, kn: { d: 0.01 }, mi: { k1: 0, k2: 0.5, k3: 1 } }, ["vb", "v2"]),
});

// Tasten (vierstimmig): der Verteiler gibt jede Note an eine von vier gleichen Stimmen. Jede Stimme: zwei Oszillatoren
// (o1 klingt; o2 kann o1 in der Frequenz modulieren, FM, über m: E-Piano; oder selbst mitklingen, über x: Orgel,
// Harmonium, Akkordeon mit verstimmtem zweitem Ton), eine Hüllkurve, ein Verstärker.
function stimme(i) {
  return {
    module: [m(`o1${i}`, "oszillator"), m(`o2${i}`, "oszillator"), m(`m${i}`, "verstaerker", { pegel: 0 }), m(`x${i}`, "verstaerker"), m(`h${i}`, "huellkurve"), m(`v${i}`, "verstaerker", { pegel: 0 })],
    kabel: [
      ["vt", `Ton ${i}`, `o1${i}`, "Tonhöhe"], ["vt", `Ton ${i}`, `o2${i}`, "Tonhöhe"], ["vt", `Takt ${i}`, `h${i}`, "Auslöser"],
      [`o2${i}`, "aus", `m${i}`, "ein"], [`h${i}`, "aus", `m${i}`, "Steuerung"], [`m${i}`, "aus", `o1${i}`, "FM"],
      [`o2${i}`, "aus", `x${i}`, "ein"], [`o1${i}`, "aus", `v${i}`, "ein"], [`x${i}`, "aus", `v${i}`, "ein"], [`h${i}`, "aus", `v${i}`, "Steuerung"], [`v${i}`, "aus", "lp", "ein"],
    ],
  };
}
const st = [1, 2, 3, 4].map(stimme);
const jede = (f) => Object.assign({}, ...[1, 2, 3, 4].map((i) => f(i)));
const tasten = (o1, o2, x, fm, h) => jede((i) => ({ [`o1${i}`]: { ...o1, fmTiefe: fm }, [`o2${i}`]: o2, [`x${i}`]: { pegel: x }, [`h${i}`]: h }));
const TASTEN = k("Tasten", "Tasten (vierstimmig über den Verteiler): E-Piano (FM), Orgel, Harmonium, Akkordeon, Cembalo", [
  m("vt", "verteiler"), ...st.flatMap((s) => s.module), m("lp", "filter"), m("ch", "chorus"), m("end", "verstaerker", { pegel: 0.25 }),
], [...st.flatMap((s) => s.kabel), ["lp", "aus", "ch", "ein"], ["ch", "aus", "end", "ein"]],
["end", ["vt", "Noten", "ein", "noten"]], [["lp", "grenze"], ["ch", "mix"]], {
  "E-Piano": { werte: { ...tasten({ frequenz: 261.63, form: "sine" }, { frequenz: 261.63, form: "sine" }, 0, 600, { a: 0.002, d: 1.5, s: 0.2, r: 0.4 }), lp: { typ: "lowpass", grenze: 5000, resonanz: 0.7, mod: 0 }, ch: { mix: 0.4 } } },
  Orgel: { werte: { ...tasten({ frequenz: 261.63, form: "sine" }, { frequenz: 523.25, form: "sine" }, 0.6, 1, { a: 0.005, d: 0.01, s: 1, r: 0.05 }), lp: { typ: "lowpass", grenze: 6000, resonanz: 0.7, mod: 0 }, ch: { mix: 0.6 } } },
  Harmonium: { werte: { ...tasten({ frequenz: 261.63, form: "sawtooth" }, { frequenz: 262.54, form: "sawtooth" }, 0.8, 1, { a: 0.08, d: 0.1, s: 1, r: 0.2 }), lp: { typ: "lowpass", grenze: 1800, resonanz: 1, mod: 0 }, ch: { mix: 0.2 } } },
  Akkordeon: { werte: { ...tasten({ frequenz: 261.63, form: "square" }, { frequenz: 263.5, form: "square" }, 1, 1, { a: 0.03, d: 0.1, s: 0.95, r: 0.1 }), lp: { typ: "lowpass", grenze: 2500, resonanz: 0.8, mod: 0 }, ch: { mix: 0.2 } } },
  Cembalo: { werte: { ...tasten({ frequenz: 261.63, form: "sawtooth" }, { frequenz: 523.25, form: "square" }, 0.5, 1, { a: 0.001, d: 0.8, s: 0, r: 0.3 }), lp: { typ: "lowpass", grenze: 6000, resonanz: 0.7, mod: 0 }, ch: { mix: 0.1 } } },
});

// Wavetable-Synth (Runde 24), wie Abletons „Wavetable“: vier Stimmen über den Verteiler, je ein Wavetable-Oszillator
// (acht Frames von Sinus bis Glas, Position überblendet), eine Hüllkurve, ein Verstärker. Gemeinsam: ein LFO, der
// die Position aller vier Stimmen langsam durch die Tabelle schiebt (das „Wandern“ im Klang, das Wavetable-Synths
// ausmacht), ein Filter, dessen Grenze ein zweiter LFO bewegt, Chorus und Hall.
function wtStimme(i) {
  return {
    module: [m(`w${i}`, "wavetable"), m(`h${i}`, "huellkurve"), m(`v${i}`, "verstaerker", { pegel: 0 })],
    kabel: [["vt", `Ton ${i}`, `w${i}`, "Tonhöhe"], ["vt", `Takt ${i}`, `h${i}`, "Auslöser"], ["lp", "aus", `w${i}`, "Position"],
      [`w${i}`, "aus", `v${i}`, "ein"], [`h${i}`, "aus", `v${i}`, "Steuerung"], [`v${i}`, "aus", "fi", "ein"]],
  };
}
const wst = [1, 2, 3, 4].map(wtStimme);
const wtJede = (wt, h) => Object.assign({}, ...[1, 2, 3, 4].map((i) => ({ [`w${i}`]: wt, [`h${i}`]: h })));
const WAVETABLE = k("Wavetable-Synth", "Wavetable-Synth (vierstimmig): Fläche, Lead, Bass, Pluck, Glas, Stimme", [
  m("vt", "verteiler"), m("lp", "lfo", { form: "triangle" }), m("lf", "lfo", { form: "sine" }), ...wst.flatMap((x) => x.module),
  m("fi", "filter"), m("ch", "chorus"), m("end", "verstaerker", { pegel: 0.5 }),
], [...wst.flatMap((x) => x.kabel), ["lf", "aus", "fi", "Grenze"], ["fi", "aus", "ch", "ein"], ["ch", "aus", "end", "ein"]],
["end", ["vt", "Noten", "ein", "noten"]], [["w1", "position"], ["fi", "grenze"], ["lp", "tiefe"], ["h1", "r"]], {
  "Fläche": { werte: { end: { pegel: 0.5 }, ...wtJede({ frequenz: 261.63, position: 0.3, verstimmen: 18 }, { a: 1.2, d: 1, s: 0.8, r: 2.5 }), lp: { tempo: 0.07, tiefe: 0.25 }, lf: { tempo: 0.11, tiefe: 0.3 },
    fi: { typ: "lowpass", grenze: 1800, resonanz: 1, mod: 1 }, ch: { mix: 0.5 } } },
  Lead: { werte: { end: { pegel: 0.6 }, ...wtJede({ frequenz: 261.63, position: 0.28, verstimmen: 8 }, { a: 0.005, d: 0.3, s: 0.7, r: 0.2 }), lp: { tempo: 5, tiefe: 0.02 }, lf: { tempo: 0.5, tiefe: 0 },
    fi: { typ: "lowpass", grenze: 4000, resonanz: 3, mod: 1 }, ch: { mix: 0.2 } } },
  Bass: { werte: { end: { pegel: 0.5 }, ...wtJede({ frequenz: 261.63, position: 0.43, verstimmen: 4 }, { a: 0.003, d: 0.4, s: 0.5, r: 0.1 }), lp: { tempo: 0.2, tiefe: 0 }, lf: { tempo: 0.2, tiefe: 0 },
    fi: { typ: "lowpass", grenze: 700, resonanz: 4, mod: 1 }, ch: { mix: 0 } } },
  Pluck: { werte: { end: { pegel: 1 }, ...wtJede({ frequenz: 261.63, position: 0.6, verstimmen: 5 }, { a: 0.002, d: 0.35, s: 0, r: 0.3 }), lp: { tempo: 0.3, tiefe: 0.1 }, lf: { tempo: 0.2, tiefe: 0 },
    fi: { typ: "lowpass", grenze: 3000, resonanz: 2, mod: 1 }, ch: { mix: 0.3 } } },
  Glas: { werte: { end: { pegel: 0.5 }, ...wtJede({ frequenz: 261.63, position: 1, verstimmen: 6 }, { a: 0.01, d: 1.5, s: 0.2, r: 2 }), lp: { tempo: 0.1, tiefe: 0.05 }, lf: { tempo: 0.2, tiefe: 0 },
    fi: { typ: "lowpass", grenze: 8000, resonanz: 0.7, mod: 1 }, ch: { mix: 0.4 } } },
  Stimme: { werte: { end: { pegel: 1 }, ...wtJede({ frequenz: 261.63, position: 0.78, verstimmen: 10 }, { a: 0.3, d: 0.5, s: 0.8, r: 1 }), lp: { tempo: 0.15, tiefe: 0.08 }, lf: { tempo: 0.2, tiefe: 0 },
    fi: { typ: "lowpass", grenze: 3500, resonanz: 0.7, mod: 1 }, ch: { mix: 0.4 } } },
});

export const KLAENGE = {
  vogel: VOGEL, frosch: FROSCH, insekt: INSEKT, wasser: WASSER, wind: WIND, feuer: FEUER, donner: DONNER, glocke: GLOCKE,
  blaeser: BLAESER, streicher: STREICHER, tasten: TASTEN, wavetable: WAVETABLE, trommel: TROMMEL,

  herz: k("Herzschlag", "Herzschlag: „lub-dub“ (Salve aus zwei Schlägen), ein tiefer Sinus, dessen Höhe beim Schlag fällt", [
    m("zg", "zufallsgeber", { rate: 62, regel: 0.95, dauer: 0.1 }), m("sv", "salve", { anzahl: 2, abstand: 0.28, dauer: 0.4 }),
    m("kh", "kurve", { art: "huelle", mitte: 0.9, dauer: 0.12, form: 1 }), m("kt", "kurve", { art: "bogen", start: 0.5, mitte: 0, ende: -0.2, dauer: 0.12 }),
    m("os", "oszillator", { frequenz: 45, form: "sine" }), m("sh", "shaper", { art: "weich", antrieb: 2.5, nass: 0.6 }),
    m("lp", "filter", { typ: "lowpass", grenze: 140, resonanz: 0.8, mod: 0 }), m("vc", "verstaerker", { pegel: 0 }),
  ], [["zg", "Takt", "sv", "Takt"], ["sv", "Takt", "kh", "Takt"], ["sv", "Takt", "kt", "Takt"], ["kt", "aus", "os", "Tonhöhe"], ["os", "aus", "sh", "ein"], ["sh", "aus", "lp", "ein"], ["lp", "aus", "vc", "ein"], ["kh", "aus", "vc", "Steuerung"]],
  ["vc"], [["zg", "rate"], ["os", "frequenz"]]),

  uhr: k("Uhr", "Uhr: tick und tack (Zähler wechselt die Höhe), ein kurzer Pling und ein Klick aus Rauschen", [
    m("zg", "zufallsgeber", { rate: 60, regel: 1, dauer: 0.01 }), m("zl", "zaehler", { bis: 2 }), m("ma", "mathe", { art: "0", b: 0, faktor: 3, versatz: 0 }),
    m("pl", "pling", { frequenz: 2200, abklingen: 0.008, breite: 0, laut: 0.4 }), m("kh", "kurve", { art: "huelle", mitte: 0.5, dauer: 0.003, form: 0.5 }),
    m("ra", "rauschen", { farbe: "weiss", pegel: 0.8 }), m("hp", "filter", { typ: "highpass", grenze: 3000, resonanz: 0.7, mod: 0 }),
    m("vc", "verstaerker", { pegel: 0 }), m("mi", "mischer", { k1: 1, k2: 0.6 }),
  ], [["zg", "Takt", "zl", "Takt"], ["zl", "Zahl", "ma", "A"], ["ma", "aus", "pl", "Tonhöhe"], ["zg", "Takt", "pl", "Takt"], ["zg", "Takt", "kh", "Takt"], ["ra", "aus", "hp", "ein"], ["hp", "aus", "vc", "ein"], ["kh", "aus", "vc", "Steuerung"], ["pl", "aus", "mi", "1"], ["vc", "aus", "mi", "2"]],
  ["mi", ["zg", "Takt", "aus", "takt"]], [["zg", "rate"], ["pl", "frequenz"]]),

  geiger: k("Geigerzähler", "Geigerzähler: Klicks zu zufälligen Zeiten (Poisson, wie der radioaktive Zerfall selbst)", [
    m("zg", "zufallsgeber", { rate: 150, regel: 0, dauer: 0.002 }), m("kh", "kurve", { art: "huelle", mitte: 0.6, dauer: 0.0015, form: 0.5 }),
    m("ra", "rauschen", { farbe: "weiss", pegel: 1 }), m("hp", "filter", { typ: "highpass", grenze: 2000, resonanz: 0.7, mod: 0 }), m("vc", "verstaerker", { pegel: 0 }),
  ], [["zg", "Takt", "kh", "Takt"], ["ra", "aus", "hp", "ein"], ["hp", "aus", "vc", "ein"], ["kh", "aus", "vc", "Steuerung"]],
  ["vc", ["zg", "Takt", "aus", "takt"]], [["zg", "rate"]]),

  brummen: k("Netzbrummen", "Netzbrummen: 50 Hz (das Stromnetz), Obertöne aus dem Shaper (T₂, T₃), leises Flackern", [
    m("os", "oszillator", { frequenz: 50, form: "sine" }), m("sh", "shaper", { art: "obertoene", antrieb: 1, nass: 0.5, trocken: 0.7 }),
    m("lp", "filter", { typ: "lowpass", grenze: 2000, resonanz: 0.7, mod: 0 }), m("zu", "zufall", { art: "spaziergang", zeit: 0.3, staerke: 0.08, mitte: 0.3 }),
    m("vc", "verstaerker", { pegel: 0 }),
  ], [["os", "aus", "sh", "ein"], ["sh", "aus", "lp", "ein"], ["lp", "aus", "vc", "ein"], ["zu", "aus", "vc", "Steuerung"]],
  ["vc"], [["os", "frequenz"], ["sh", "nass"]]),
};

// Suche nach einem Preset-Namen („Amsel“) findet die Gruppe mit diesem Preset
export const PRESET_SUCHE = Object.entries(KLAENGE).flatMap(([name, d]) => Object.keys(d.gruppe.presets ?? {}).map((p) => ({ name, preset: p, titel: `${d.titel}: ${p}` })));
