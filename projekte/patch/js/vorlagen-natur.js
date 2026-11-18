// Vorlagen Runde 22: die Stimme im Band; Runde 23: die Landschaft aus Gruppen und die Instrumente.
// Runde 22b: Vorlagen aus Klang-Gruppen (klaenge.js): jeder Klang eine zugeklappte Gruppe, mit ± hineinsehen.
// (Die Lern-Vorlagen aus Runde 22 sind entfallen: die Klang-Gruppen ersetzen sie und klingen wie die Module.)
// Format wie ein gespeicherter Patch; gruppen: [{ id, titel, offen, x, y, mitglieder, aussen, makros }].

import { KLAENGE } from "./klaenge.js";

// Eine Vorlage aus Klang-Gruppen. teile: [Kürzel, Klang, x, y]; Kabel und Module dazu sprechen die Module der Gruppen
// als "Kürzel.id" an (z. B. "am.end"). Jede Gruppe liegt zugeklappt bei (x, y), ihre Module darunter versteckt.
// teile: [Kürzel, Klang, x, y, Preset, Abweichungen]. Abweichungen: { werte: { id: {…} }, aus: [ids], an: [ids] }
// (z. B. in der Landschaft beim Regen das Rauschbett aus). Werte und ⏻ stehen gleich in den Modulen.
export function ausKlaengen(text, teile, module, kabel, tempo) {
  const alle = [], alleKabel = [], gruppen = [];
  const id = (s) => s.replace(".", "_");
  teile.forEach(([kurz, name, x, y, preset, extra = {}], i) => {
    const d = typeof name === "string" ? KLAENGE[name] : name; // Runde 24: auch eine fertige Gruppe (Spuren)
    const p = preset ?? d.gruppe.preset;
    for (const mm of d.module) {
      const pw = d.gruppe.presets?.[p]?.[mm.id];
      const werte = { ...mm.werte, ...(pw?.werte ?? {}), ...(extra.werte?.[mm.id] ?? {}) };
      let stumm = pw ? pw.stumm : Boolean(mm.werte.__stumm);
      if (extra.aus?.includes(mm.id)) stumm = true;
      if (extra.an?.includes(mm.id)) stumm = false;
      if (stumm) werte.__stumm = true;
      else delete werte.__stumm;
      alle.push({ ...mm, id: `${kurz}_${mm.id}`, x: x + mm.x, y: y + mm.y, werte });
    }
    for (const [a, an, b, bn] of d.kabel) alleKabel.push([`${kurz}_${a}`, an, `${kurz}_${b}`, bn]);
    const presets = d.gruppe.presets && Object.fromEntries(Object.entries(d.gruppe.presets).map(([n, pr]) => [n, Object.fromEntries(Object.entries(pr).map(([mid, e]) => [`${kurz}_${mid}`, e]))]));
    gruppen.push({
      id: `k${i + 1}`, titel: preset ? `${d.titel}: ${preset}` : d.titel, offen: false, x, y,
      mitglieder: d.module.map((mm) => `${kurz}_${mm.id}`),
      aussen: d.gruppe.aussen.map(([a, n, r, art]) => [`${kurz}_${a}`, n, r, art]),
      makros: d.gruppe.makros.map(([a, n]) => [`${kurz}_${a}`, n]),
      ...(presets && { presets, preset: p }),
    });
  });
  for (const mm of module) alle.push({ ...mm, werte: mm.werte ?? {} });
  for (const [a, an, b, bn] of kabel) {
    alleKabel.push([id(a), an, id(b), bn]);
    // Buchsen einer Gruppe, an denen von außen ein Kabel steckt, müssen außen liegen (sonst endet es am Rand)
    for (const [mid, name, richtung] of [[id(b), bn, "ein"], [id(a), an, "aus"]]) {
      const g = gruppen.find((x) => x.mitglieder.includes(mid));
      if (g && !g.aussen.some(([m, n, r]) => m === mid && n === name && r === richtung)) g.aussen.push([mid, name, richtung, "ton"]);
    }
  }
  return { text, tempo, module: alle, kabel: alleKabel, gruppen };
}

export const NATUR_VORLAGEN = {
  stimmeBand: {
    text: "Stimme im Band: die Stimme spricht zu zufälligen Zeiten, durch ein Kohlemikrofon in eine rückwärts laufende Bandschleife",
    module: [
      { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Stimme im Band\n\nDie Stimme spricht den Text, jedes Mal wenn der Zufallsgeber einen Takt schickt (selten), oder wenn du den Taster drückst (auch mit der Taste S). Sie geht durch die Kohle (altes Telefon: schmal, verzerrt, knisternd) und in eine Schleife, die rückwärts und langsamer läuft (Band 0,5: eine Oktave tiefer).\n\nAufnahme an der Schleife einschalten: was die Stimme sagt, kommt Runde für Runde rückwärts wieder, und mit „Halten“ 0,85 jedes Mal etwas leiser, bis es verschwindet. So haben Eno und Fripp mit zwei Bandmaschinen gearbeitet; rückwärts gesprochene Stimmen kennt man aus EVP-Aufnahmen.\n\nEigenen Text oben in die Stimme schreiben." } },
      { id: "zg", typ: "zufallsgeber", x: 430, y: 40, werte: { rate: 5, regel: 0.2, dauer: 1 } },
      // Runde 23: der Taster (oder die Taste S) lässt sie jetzt sprechen
      { id: "ta", typ: "taster", x: 40, y: 560, werte: { taste: "s" } },
      { id: "st", typ: "stimme", x: 430, y: 330, werte: { text: "wo bist du", vokal: 0.4, frequenz: 95, spannung: 0.45, tempo: 0.09, melodie: "fallend", laut: 0.9 } },
      { id: "ko", typ: "kohle", x: 860, y: 40, werte: { antrieb: 6, buckel: 10, band: 3000, knistern: 0.5, nass: 0.6, trocken: 0 } },
      { id: "sl", typ: "schleife", x: 860, y: 520, werte: { sekunden: 7, tempo: 0.5, halten: 0.85, nass: 1, trocken: 0.7, richtung: "-1" } },
      { id: "ha", typ: "hall", x: 1250, y: 40, werte: { zeit: 4, daempfung: 0.5, mix: 0.4 } },
      { id: "aus", typ: "ausgang", x: 1250, y: 400, werte: { laut: 0.5 } },
    ],
    kabel: [["zg", "Takt", "st", "Takt"], ["ta", "Takt", "st", "Takt"], ["st", "aus", "ko", "ein"], ["ko", "aus", "sl", "ein"], ["sl", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]],
  },
};

// ---------- Runde 22b / 23: aus Klang-Gruppen ----------
const SPALTE = 420;
Object.assign(NATUR_VORLAGEN, {
  // Landschaft (Runde 22, Runde 23 aus Gruppen): ein Tag in 12 Minuten, Wetter, Tiere. Warum sie sich nie wiederholt:
  // nichts darin ist eine Schleife. Sekunden: Rufe und Tropfen kommen zu zufälligen Zeiten (Poisson). Minuten: „Wetter“
  // ist ein Zufall (Spaziergang, 2 min) für Wind, Regen (ab 0,4) und Donner (ab 0,6). Der Tag: Tageslauf (Morgen weckt die
  // Vögel, Abend und Nacht bringen Grillen und Frösche, das Licht wärmt die Grillen). Musik: eine leise Fläche in den
  // Dämmerungen. Dieselben Zahlen wie die Fassung mit den kompakten Modulen; nur sind die Tiere jetzt Gruppen.
  // Aktivität → Dichte: die Gruppen fragen „wie oft“ über die Dichte ihres Zufallsgebers (1 + Kabel); darum steht in den
  // Mathe-Modulen „Versatz −1“: Lust 0 heißt Dichte −1, also still; Lust 1 heißt Dichte 0, wie eingestellt.
  landschaft: ausKlaengen("Landschaft (immer anders): ein Tag in 12 Minuten, Wetter, Vögel, Wind, Regen, Bach, Grillen, Frösche, Gewitter, leise Fläche", [
    ["am", "vogel", 40, 1900, "Amsel"], ["me", "vogel", 40 + SPALTE, 1900, "Kohlmeise"], ["sp", "vogel", 40 + 2 * SPALTE, 1900, "Spatz"],
    ["wi", "wind", 40 + 3 * SPALTE, 1900, "Wind", { werte: { zu: { mitte: 0.12, staerke: 0.9, zeit: 4 } } }],
    ["re", "wasser", 40, 2260, "Regen", { werte: { zg: { rate: 90000 } }, aus: ["zd", "ra"] }],
    ["ba", "wasser", 40 + SPALTE, 2260, "Bach", { werte: { zg: { rate: 3300 } }, aus: ["zd", "ra"] }],
    ["g1", "insekt", 40 + 2 * SPALTE, 2260, "Grille", { werte: { zg: { rate: 82 }, end: { lage: 0 } } }],
    ["g2", "insekt", 40 + 3 * SPALTE, 2260, "Grille", { werte: { zg: { rate: 78 }, os: { frequenz: 4380 }, end: { lage: -0.6 } } }],
    ["g3", "insekt", 40, 2620, "Grille", { werte: { zg: { rate: 86 }, os: { frequenz: 4820 }, end: { lage: 0.55 } } }],
    ["f1", "frosch", 40 + SPALTE, 2620, "Teichfrosch"], ["f2", "frosch", 40 + 2 * SPALTE, 2620, "Teichfrosch", { werte: { os: { frequenz: 52 }, end: { lage: -0.5 } } }],
    ["un", "frosch", 40 + 3 * SPALTE, 2620, "Unke"], ["do", "donner", 40, 2980, "fern"],
  ], [
    { id: "no", typ: "notiz", x: 40, y: 40, werte: { text: "Landschaft, die sich nie wiederholt\n\nNichts hier ist eine Schleife. Vier Zeitebenen laufen gegeneinander:\n\n• Sekunden: Rufe, Tropfen, Donner kommen zu zufälligen Zeiten (Poisson).\n• Minuten: „Wetter“ (Zufall, Spaziergang, 2 min) macht Wind stärker, ab 0,4 regnet es, ab 0,6 donnert es (Mathe „größer“ schneidet unten ab).\n• Ein Tag in 12 Minuten (Tageslauf): Morgen weckt die Vögel, Abend und Nacht bringen Grillen und Frösche. Das Licht wärmt die Grillen (Dichte): mittags zirpen sie schneller (Dolbear).\n• Musik: leise Akkorde, die in den Dämmerungen auftauchen.\n\nJedes Tier ist eine Gruppe: ± klappt auf. Start des Tages: Knopf „Start“ am Tageslauf." } },
    { id: "tag", typ: "tageslauf", x: 430, y: 40, werte: { tag: 12, start: 4.8 } },
    { id: "wet", typ: "zufall", x: 430, y: 400, werte: { art: "spaziergang", zeit: 120, staerke: 0.9, mitte: 0.2 } },
    { id: "lv", typ: "mathe", x: 820, y: 40, werte: { art: "0", b: 0, faktor: 1, versatz: -1 } },
    { id: "la", typ: "mathe", x: 820, y: 330, werte: { art: "0", b: 0, faktor: 1.3, versatz: -1 } },
    { id: "lw", typ: "mathe", x: 820, y: 620, werte: { art: "0", b: 0, faktor: 0.5, versatz: 0 } },
    { id: "lr", typ: "mathe", x: 820, y: 910, werte: { art: "4", b: 0.4, faktor: 2.5, versatz: -2 } },
    { id: "bz", typ: "zufall", x: 430, y: 760, werte: { art: "spaziergang", zeit: 40, staerke: 0.5, mitte: 0 } },
    { id: "lt", typ: "mathe", x: 1210, y: 40, werte: { art: "0", b: 0, faktor: 0.85, versatz: 0 } },
    { id: "lg", typ: "mathe", x: 1210, y: 330, werte: { art: "0", b: 0, faktor: 0.9, versatz: 0 } },
    { id: "lf", typ: "mathe", x: 1210, y: 620, werte: { art: "0", b: 0, faktor: 0.9, versatz: -1 } },
    { id: "lu", typ: "mathe", x: 1210, y: 910, werte: { art: "0", b: 0, faktor: 1, versatz: -1 } },
    { id: "ld", typ: "mathe", x: 1210, y: 1200, werte: { art: "4", b: 0.6, faktor: 5, versatz: -4 } },
    { id: "vg", typ: "verstaerker", x: 1600, y: 40, werte: { pegel: 0 } },
    { id: "e1", typ: "euklid", x: 1600, y: 330, werte: { n: 4, k: 4, tempo: 60, teilung: "4" } },
    { id: "ak", typ: "akkorde", x: 2000, y: 40, werte: { grundton: "2", leiter: "dur", art: "add9", lage: "fuehrung", schlaege: "16", spielweise: "zusammen", laenge: 1, anschlag: 0.5, folge: "1,6,4,5,0,0,0,0" } },
    { id: "pad", typ: "stimmen", x: 2600, y: 40, werte: { form: "sawtooth", form2: "triangle", mix: 0.5, breite: 25, a: 4, d: 4, s: 0.8, r: 6, grenze: 700, reso: 1, fhk: 0.6, anzahl: 8, pegel: 0.35 } },
    { id: "lp", typ: "mathe", x: 1600, y: 700, werte: { art: "0", b: 0, faktor: 0.9, versatz: 0.05 } },
    { id: "vp", typ: "verstaerker", x: 2600, y: 700, werte: { pegel: 0 } },
    { id: "m1", typ: "mischer", x: 3200, y: 40, werte: { k1: 1, k2: 1, k3: 1, k4: 0.9 } },
    { id: "m2", typ: "mischer", x: 3200, y: 400, werte: { k1: 0.9, k2: 0.7, k3: 1, k4: 0.9 } },
    { id: "m3", typ: "mischer", x: 3200, y: 760, werte: { k1: 1, k2: 0.8, k3: 1, k4: 0.7 } },
    { id: "ms", typ: "mischer", x: 3600, y: 40, werte: { k1: 1, k2: 1, k3: 1, k4: 0 } },
    { id: "ha", typ: "hall", x: 3600, y: 400, werte: { zeit: 2.2, daempfung: 0.7, vor: 0.03, mix: 0.25 } },
    { id: "ko", typ: "kompressor", x: 3600, y: 760, werte: { schwelle: -20, verhaeltnis: 3, aufholen: 3 } },
    { id: "aus", typ: "ausgang", x: 4000, y: 40, werte: { laut: 0.5 } },
  ], [
    ["tag", "Morgen", "lv", "A"], ["tag", "Licht", "lv", "B"], ["tag", "Morgen", "la", "A"], ["tag", "Abend", "la", "B"],
    ["la", "aus", "am.zg", "Dichte"], ["lv", "aus", "me.zg", "Dichte"], ["lv", "aus", "sp.zg", "Dichte"],
    ["wet", "aus", "lw", "A"], ["lw", "aus", "wi.zu", "dazu"],
    ["wet", "aus", "lr", "A"], ["lr", "aus", "re.zg", "Dichte"], ["bz", "aus", "ba.zg", "Dichte"],
    ["tag", "Licht", "lt", "A"], ["lt", "aus", "g1.zg", "Dichte"], ["lt", "aus", "g2.zg", "Dichte"], ["lt", "aus", "g3.zg", "Dichte"],
    ["tag", "Abend", "lg", "A"], ["tag", "Nacht", "lg", "B"], ["lg", "aus", "vg", "Steuerung"],
    ["g1.end", "aus", "vg", "ein"], ["g2.end", "aus", "vg", "ein"], ["g3.end", "aus", "vg", "ein"],
    ["tag", "Abend", "lf", "A"], ["tag", "Nacht", "lf", "B"], ["lf", "aus", "f1.zg", "Dichte"], ["lf", "aus", "f2.zg", "Dichte"],
    ["tag", "Nacht", "lu", "A"], ["lu", "aus", "un.zg", "Dichte"],
    ["wet", "aus", "ld", "A"], ["ld", "aus", "do.zg", "Dichte"],
    ["e1", "Takt", "ak", "Takt"], ["ak", "Noten", "pad", "Noten"], ["tag", "Abend", "lp", "A"], ["tag", "Morgen", "lp", "B"], ["lp", "aus", "vp", "Steuerung"], ["pad", "aus", "vp", "ein"],
    ["am.end", "aus", "m1", "1"], ["me.end", "aus", "m1", "2"], ["sp.end", "aus", "m1", "3"], ["f1.end", "aus", "m1", "4"], ["f2.end", "aus", "m1", "4"],
    ["wi.end", "aus", "m2", "1"], ["re.mi", "aus", "m2", "2"], ["ba.mi", "aus", "m2", "3"], ["do.vc", "aus", "m2", "4"],
    ["vg", "aus", "m3", "1"], ["un.end", "aus", "m3", "2"], ["vp", "aus", "m3", "3"],
    ["m1", "aus", "ms", "1"], ["m2", "aus", "ms", "2"], ["m3", "aus", "ms", "3"],
    ["ms", "aus", "ha", "ein"], ["ha", "aus", "ko", "ein"], ["ko", "aus", "aus", "ein"],
  ], 60),

  waldMorgen: ausKlaengen("Wald am Morgen (Gruppen): Amsel, Kohlmeise, Spatz, Specht, Kuckuck, Wind, Bach", [
    ["am", "vogel", 40, 40, "Amsel"], ["me", "vogel", 40 + SPALTE, 40, "Kohlmeise"], ["sp", "vogel", 40 + 2 * SPALTE, 40, "Spatz"],
    ["sh", "vogel", 40, 400, "Specht"], ["ku", "vogel", 40 + SPALTE, 400, "Kuckuck"], ["wi", "wind", 40 + 2 * SPALTE, 400, "Brise"], ["ba", "wasser", 40, 760, "Bach"],
  ], [
    { id: "mv", typ: "mischer", x: 1400, y: 40, werte: { k1: 1, k2: 0.8, k3: 0.7, k4: 0.7 } },
    { id: "mu", typ: "mischer", x: 1400, y: 400, werte: { k1: 0.6, k2: 0.6, k3: 0 } },
    { id: "ha", typ: "hall", x: 1800, y: 40, werte: { zeit: 1.8, daempfung: 0.75, vor: 0.04, mix: 0.28 } },
    { id: "aus", typ: "ausgang", x: 1800, y: 400, werte: { laut: 0.5 } },
  ], [
    ["am.end", "aus", "mv", "1"], ["me.end", "aus", "mv", "2"], ["sp.end", "aus", "mv", "3"], ["sh.end", "aus", "mv", "4"], ["ku.end", "aus", "mv", "4"],
    ["wi.end", "aus", "mu", "1"], ["ba.mi", "aus", "mu", "2"], ["mu", "aus", "mv", "1"],
    ["mv", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"],
  ]),

  teichNacht: ausKlaengen("Nacht am Teich (Gruppen): zwei Teichfrösche im Wechselgesang, Unke, Grillen, Waldkauz, eine Mücke", [
    ["f1", "frosch", 40, 40, "Teichfrosch"], ["f2", "frosch", 40 + SPALTE, 40, "Teichfrosch", { werte: { os: { frequenz: 52 }, end: { lage: -0.5 } } }], ["un", "frosch", 40 + 2 * SPALTE, 40, "Unke"],
    ["gr", "insekt", 40, 400, "Grille"], ["ka", "vogel", 40 + SPALTE, 400, "Waldkauz"], ["mu", "insekt", 40 + 2 * SPALTE, 400, "Mücke"],
  ], [
    { id: "no", typ: "notiz", x: 40, y: 760, werte: { text: "Wechselgesang: jeder Frosch „hört“ den anderen. Der Folger misst, wie laut Frosch 1 gerade ist, Mathe macht daraus eine negative Zahl (mal −8), und die geht an die Dichte des Zufallsgebers von Frosch 2: solange Frosch 1 ruft, ruft Frosch 2 nicht (Dichte −1 heißt: nichts). Und umgekehrt. Keiner zählt, keiner hat einen Plan, und trotzdem rufen sie abwechselnd. Kabel an den Folgern herausziehen: dann rufen sie durcheinander." } },
    { id: "h1", typ: "folger", x: 460, y: 760, werte: { attack: 0.01, release: 0.25, verstaerkung: 6 } },
    { id: "n1", typ: "mathe", x: 460, y: 1060, werte: { art: "0", b: 0, faktor: -8, versatz: 0 } },
    { id: "h2", typ: "folger", x: 860, y: 760, werte: { attack: 0.01, release: 0.25, verstaerkung: 6 } },
    { id: "n2", typ: "mathe", x: 860, y: 1060, werte: { art: "0", b: 0, faktor: -8, versatz: 0 } },
    { id: "mi", typ: "mischer", x: 1400, y: 40, werte: { k1: 1, k2: 0.8, k3: 0.6, k4: 0.5 } },
    { id: "ha", typ: "hall", x: 1800, y: 40, werte: { zeit: 2.4, daempfung: 0.7, vor: 0.03, mix: 0.3 } },
    { id: "aus", typ: "ausgang", x: 1800, y: 400, werte: { laut: 0.5 } },
  ], [
    ["f1.vc", "aus", "h1", "ein"], ["h1", "aus", "n1", "A"], ["n1", "aus", "f2.zg", "Dichte"],
    ["f2.vc", "aus", "h2", "ein"], ["h2", "aus", "n2", "A"], ["n2", "aus", "f1.zg", "Dichte"],
    ["f1.end", "aus", "mi", "1"], ["f2.end", "aus", "mi", "1"], ["un.end", "aus", "mi", "2"], ["gr.end", "aus", "mi", "3"], ["ka.end", "aus", "mi", "4"], ["mu.end", "aus", "mi", "4"],
    ["mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"],
  ]),

  gewitter: ausKlaengen("Gewitter (Gruppen): Regen, Sturm, Donner", [
    ["re", "wasser", 40, 40, "Regen"], ["wi", "wind", 40 + SPALTE, 40, "Sturm"], ["do", "donner", 40 + 2 * SPALTE, 40, "nah"],
  ], [
    { id: "mi", typ: "mischer", x: 1400, y: 40, werte: { k1: 1, k2: 0.9, k3: 1.2 } },
    { id: "ha", typ: "hall", x: 1800, y: 40, werte: { zeit: 3, daempfung: 0.6, mix: 0.25 } },
    { id: "aus", typ: "ausgang", x: 1800, y: 400, werte: { laut: 0.5 } },
  ], [["re.mi", "aus", "mi", "1"], ["wi.end", "aus", "mi", "2"], ["do.vc", "aus", "mi", "3"], ["mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),

  maschinen: ausKlaengen("Maschinenraum (Gruppen): Herzschlag, Uhr, Netzbrummen, Geigerzähler durch ein Kohlemikrofon in eine Bandschleife", [
    ["hz", "herz", 40, 40], ["uh", "uhr", 40 + SPALTE, 40], ["br", "brummen", 40 + 2 * SPALTE, 40], ["ge", "geiger", 40, 400],
  ], [
    { id: "mi", typ: "mischer", x: 1400, y: 40, werte: { k1: 1, k2: 0.7, k3: 0.5, k4: 0.4 } },
    { id: "ko", typ: "kohle", x: 1400, y: 400, werte: { antrieb: 4, buckel: 8, band: 3400, knistern: 0.3, nass: 0.5, trocken: 0.4 } },
    { id: "sl", typ: "schleife", x: 1800, y: 40, werte: { sekunden: 6, tempo: 0.5, halten: 0.8, nass: 0.8, trocken: 1, richtung: "-1" } },
    { id: "ha", typ: "hall", x: 1800, y: 600, werte: { zeit: 3.5, daempfung: 0.5, mix: 0.3 } },
    { id: "aus", typ: "ausgang", x: 2200, y: 40, werte: { laut: 0.5 } },
  ], [["hz.vc", "aus", "mi", "1"], ["uh.mi", "aus", "mi", "2"], ["br.vc", "aus", "mi", "3"], ["ge.vc", "aus", "mi", "4"], ["mi", "aus", "ko", "ein"], ["ko", "aus", "sl", "ein"], ["sl", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),

  glocken: ausKlaengen("Glocke und Grillen (Gruppen): eine Kirchenglocke in der Sommernacht", [
    ["gl", "glocke", 40, 40, "Kirchenglocke"], ["gr", "insekt", 40 + SPALTE, 40, "Grille"], ["wi", "wind", 40 + 2 * SPALTE, 40, "Brise"],
  ], [
    { id: "mi", typ: "mischer", x: 1400, y: 40, werte: { k1: 0.8, k2: 0.7, k3: 0.35 } },
    { id: "ha", typ: "hall", x: 1800, y: 40, werte: { zeit: 5, daempfung: 0.5, mix: 0.35 } },
    { id: "aus", typ: "ausgang", x: 1800, y: 400, werte: { laut: 0.5 } },
  ], [["gl.end", "aus", "mi", "1"], ["gr.end", "aus", "mi", "2"], ["wi.end", "aus", "mi", "3"], ["mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),

  // Einzelne Geräusche (Runde 23: ersetzen die alten Vorlagen aus kompakten Modulen)
  regen: ausKlaengen("Regen (Gruppe): viele kleine Blasen, wenige große Tropfen, ein Rauschbett. Preset an der Gruppe: Regen, Bach, Tropfstein", [["re", "wasser", 40, 40, "Regen"]], [
    { id: "ha", typ: "hall", x: 460, y: 40, werte: { zeit: 1.5, mix: 0.2 } }, { id: "aus", typ: "ausgang", x: 860, y: 40, werte: { laut: 0.5 } },
  ], [["re.mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),
  feuer: ausKlaengen("Feuer (Gruppe): Knacken, Zischen, Glut. Preset: Lagerfeuer, Kamin", [["fe", "feuer", 40, 40, "Lagerfeuer"]], [
    { id: "ha", typ: "hall", x: 460, y: 40, werte: { zeit: 1, mix: 0.12 } }, { id: "aus", typ: "ausgang", x: 860, y: 40, werte: { laut: 0.5 } },
  ], [["fe.mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),
  sommernacht: ausKlaengen("Sommernacht (Gruppen): drei Grillen, eine Unke, ein Waldkauz", [
    ["g1", "insekt", 40, 40, "Grille"], ["g2", "insekt", 40 + SPALTE, 40, "Grille", { werte: { zg: { rate: 124 }, os: { frequenz: 4380 }, end: { lage: -0.6 } } }],
    ["g3", "insekt", 40 + 2 * SPALTE, 40, "Grille", { werte: { zg: { rate: 150 }, os: { frequenz: 4820 }, end: { lage: 0.55 } } }],
    ["un", "frosch", 40, 400, "Unke"], ["ka", "vogel", 40 + SPALTE, 400, "Waldkauz"],
  ], [
    { id: "mi", typ: "mischer", x: 1400, y: 40, werte: { k1: 0.6, k2: 0.6, k3: 0.6, k4: 0.8 } },
    { id: "ha", typ: "hall", x: 1800, y: 40, werte: { zeit: 2.5, daempfung: 0.6, mix: 0.3 } }, { id: "aus", typ: "ausgang", x: 1800, y: 400, werte: { laut: 0.5 } },
  ], [["g1.end", "aus", "mi", "1"], ["g2.end", "aus", "mi", "2"], ["g3.end", "aus", "mi", "3"], ["un.end", "aus", "mi", "4"], ["ka.end", "aus", "mi", "4"], ["mi", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),

  // Instrumente zum Spielen (Runde 23): Tastatur → Instrument-Gruppe → Hall. Preset an der Gruppe wählen.
  streicher: ausKlaengen("Streicher (Tastatur): Geige, Cello, Pizzicato als Presets einer Gruppe", [["st", "streicher", 430, 40, "Geige"]], [
    { id: "ta", typ: "tastatur", x: 40, y: 40, werte: {} },
    { id: "ha", typ: "hall", x: 860, y: 40, werte: { zeit: 2.5, mix: 0.3 } },
    { id: "aus", typ: "ausgang", x: 1250, y: 40, werte: { laut: 0.5 } },
  ], [["ta", "Noten", "st.nz", "Noten"], ["st.end", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),
  tasten: ausKlaengen("Tasten (Tastatur, vierstimmig): E-Piano, Orgel, Harmonium, Akkordeon, Cembalo als Presets einer Gruppe", [["tk", "tasten", 430, 40, "E-Piano"]], [
    { id: "ta", typ: "tastatur", x: 40, y: 40, werte: {} },
    { id: "ha", typ: "hall", x: 860, y: 40, werte: { zeit: 1.8, mix: 0.2 } },
    { id: "aus", typ: "ausgang", x: 1250, y: 40, werte: { laut: 0.5 } },
  ], [["ta", "Noten", "tk.vt", "Noten"], ["tk.end", "aus", "ha", "ein"], ["ha", "aus", "aus", "ein"]]),
});

// Meer (Runde 21) bekommt in vorlagen.js eine Notiz und eine Gruppe: siehe dort
export const MEER_NOTIZ = "Meer aus Bausteinen\n\n1. Braunes Rauschen (tief, −6 dB je Oktave) durch einen Tiefpass: das Rauschen des Wassers.\n\n2. Die Wellen: ein Dreieck-LFO mit 0,11 Hz (alle 9 s eine Welle) geht durch Mathe „größer“ mit B = 0 und Faktor 0,5. Aus −1 … 1 wird eine halbe Welle 0 … 0,5: Welle, dann Ruhe. Sie öffnet das Filter (die Welle wird heller, wenn sie bricht) und den Verstärker (lauter).\n\n3. Gischt: weißes Rauschen durch einen Hochpass, mit derselben Welle, aber 1,5 s später. Das Echo verzögert hier keinen Ton, sondern die Steuerspannung: auch das geht mit jedem Ton-Modul.\n\nVerbesserung zum Ausprobieren: ein Zufall (Spaziergang, 30 s) an die Tempo-Buchse des LFO: dann ist keine Welle gleich lang.";
