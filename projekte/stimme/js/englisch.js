// Englischer Text → Lautschrift (SAMPA, amerikanisch: das r wird gesprochen).
//
// Englische Schreibung ist viel unregelmäßiger als deutsche (through, though, tough, thought: viermal „ough“,
// viermal anders). Darum zwei Stufen, wie bei den alten Sprachsynthesizern (SAM, die NRL-Regeln von 1976):
//   1. ein kleines Wörterbuch für die häufigsten und unregelmäßigsten Wörter
//   2. Regeln von links nach rechts: an jeder Stelle die erste Regel, deren Buchstaben und Umgebung passen
//      (längere Buchstabenfolgen zuerst: „tion“ vor „t“, „igh“ vor „i“)
// Das trifft vielleicht vier von fünf Wörtern. Was falsch klingt, in der Lautschrift von Hand verbessern.
// Betonung kennen die Regeln nicht: unbetonte Vokale werden im Englischen meist zu @ (about, banana),
// hier bleiben sie oft voll.

const WOERTER = {
  the: "D@", a: "@", an: "{n", and: "{nd", of: "Vv", to: "tu:", in: "In", is: "Iz", it: "It", you: "ju:",
  that: "D{t", he: "hi:", she: "Si:", we: "wi:", me: "mi:", be: "bi:", was: "wVz", for: "fO:r", on: "An",
  are: "A:r", as: "{z", with: "wID", his: "hIz", they: "DeI", i: "aI", at: "{t", this: "DIs", have: "h{v",
  from: "frVm", or: "O:r", one: "wVn", had: "h{d", by: "baI", but: "bVt", not: "nAt", what: "wVt",
  all: "O:l", were: "w3", when: "wEn", your: "jO:r", can: "k{n", said: "sEd", there: "DEr", their: "DEr",
  use: "ju:z", each: "i:tS", which: "wItS", do: "du:", does: "dVz", done: "dVn", how: "haU", if: "If",
  will: "wIl", up: "Vp", other: "VD3", about: "@baUt", out: "aUt", many: "mEni", then: "DEn", them: "DEm",
  these: "Di:z", those: "DoUz", so: "soU", some: "sVm", her: "h3", would: "wUd", could: "kUd", should: "SUd",
  make: "meIk", like: "laIk", him: "hIm", into: "Intu:", time: "taIm", has: "h{z", look: "lUk", book: "bUk",
  good: "gUd", foot: "fUt", two: "tu:", more: "mO:r", go: "goU", no: "noU", see: "si:", my: "maI",
  than: "D{n", been: "bIn", who: "hu:", now: "naU", down: "daUn", day: "deI", did: "dId", get: "gEt",
  give: "gIv", girl: "g3l", come: "kVm", know: "noU", live: "lIv", love: "lVv", eye: "aI",
  here: "hIr", where: "wEr", nothing: "nVTIN", something: "sVmTIN", again: "@gEn", very: "vEri", any: "Eni",
  only: "oUnli", because: "bIkVz", door: "dO:r", blood: "blVd", hello: "h@loU", world: "w3ld",
  our: "aU3", always: "O:lweIz", never: "nEv3", forever: "f3rEv3", please: "pli:z", listen: "lIs@n",
  machine: "m@Si:n", human: "hju:m@n", heart: "hA:rt", head: "hEd", tongue: "tVN", woman: "wUm@n",
  women: "wImIn", friend: "frEnd", through: "Tru:", though: "DoU", thought: "TO:t", enough: "InVf",
  laugh: "l{f", word: "w3d", work: "w3k", water: "wAt3", people: "pi:p@l", put: "pUt", pull: "pUl",
  want: "wAnt", watch: "wAtS", talk: "tO:k", walk: "wO:k", eyes: "aIz", once: "wVns",
  young: "jVN", child: "tSaIld", children: "tSIldr@n", mind: "maInd", find: "faInd", behind: "bIhaInd",
  kind: "kaInd", wind: "wInd", alone: "@loUn", above: "@bVv", away: "@weI", awake: "@weIk", asleep: "@sli:p",
  begin: "bIgIn", gone: "gAn", mother: "mVD3", father: "fA:D3", brother: "brVD3", nobody: "noUbAdi",
  nation: "neIS@n", breathe: "bri:D", breath: "brET", dead: "dEd", death: "dET", dream: "dri:m", together: "t@gED3", voice: "vOIs", pipe: "paIp", pipes: "paIps",
};

// Regeln: [Buchstaben, Bedingung danach (RegExp oder null), Bedingung davor (RegExp oder null), Lautschrift]
// "#" in der Beschreibung unten: ein Vokal; die Bedingungen sind normale reguläre Ausdrücke auf dem Rest
// des Wortes (danach) und dem Anfang bis hierher (davor). „$“: Wortende, „^“: Wortanfang.
const K = "[bcdfghjklmnpqrstvwxz]"; // ein Konsonant
const R = [
  // lange Buchstabenfolgen
  ["tion", null, null, "S@n"], ["sion", null, /[aeiou]$/, "Z@n"], ["sion", null, null, "S@n"],
  ["ture", null, null, "tS3"], ["ous", /^$/, null, "@s"], ["ought", null, null, "O:t"], ["augh", null, null, "O:"],
  ["eigh", null, null, "eI"], ["igh", null, null, "aI"], ["ough", null, null, "O:"],
  ["tch", null, null, "tS"], ["ch", null, null, "tS"], ["sh", null, null, "S"], ["ph", null, null, "f"],
  ["th", null, null, "T"], ["wh", null, null, "w"], ["ck", null, null, "k"], ["qu", null, null, "kw"],
  ["kn", null, /^$/, "n"], ["wr", null, /^$/, "r"], ["gn", null, /^$/, "n"], ["mb", /^$/, null, "m"],
  ["gh", null, /^$/, "g"], ["gh", null, null, ""],
  ["ng", /^$|^[^aeiouy]/, null, "N"], ["nk", null, null, "Nk"],
  // Vokalpaare
  ["ee", null, null, "i:"], ["ea", null, null, "i:"], ["oo", null, null, "u:"], ["ou", null, null, "aU"],
  ["ow", /^$/, null, "oU"], ["ow", null, null, "aU"], ["oi", null, null, "OI"], ["oy", null, null, "OI"],
  ["ai", null, null, "eI"], ["ay", null, null, "eI"], ["au", null, null, "O:"], ["aw", null, null, "O:"],
  ["ew", null, null, "ju:"], ["ie", /^$/, null, "aI"], ["ie", null, null, "i:"], ["ei", null, null, "i:"],
  ["ey", /^$/, null, "i"], ["ue", /^$/, null, "u:"], ["oa", null, null, "oU"], ["oe", /^$/, null, "oU"],
  // Vokal + r (nicht vor einem Vokal)
  ["ar", /^$|^[^aeiouy]/, null, "A:r"], ["or", /^$|^[^aeiouy]/, null, "O:r"],
  ["er", /^$|^[^aeiouy]/, null, "3"], ["ir", /^$|^[^aeiouy]/, null, "3"], ["ur", /^$|^[^aeiouy]/, null, "3"],
  ["all", null, null, "O:l"],
  // stummes e am Ende: Vokal + ein Konsonant + e macht den Vokal lang (make, time, home, cute, these)
  ["a", new RegExp(`^${K}e(s|d)?$`), null, "eI"], ["i", new RegExp(`^${K}e(s|d)?$`), null, "aI"],
  ["o", new RegExp(`^${K}e(s|d)?$`), null, "oU"], ["u", new RegExp(`^${K}e(s|d)?$`), null, "ju:"],
  ["e", new RegExp(`^${K}e(s|d)?$`), null, "i:"],
  ["le", /^$/, new RegExp(`${K}$`), "@l"],
  ["e", /^$/, /[aeiouy].*$/, ""], // stumm am Ende (wenn es nicht der einzige Vokal ist)
  ["ed", /^$/, /[td]$/, "Id"], ["ed", /^$/, /[pkfsx]$|sh$|ch$/, "t"], ["ed", /^$/, /[aeiouy].*$/, "d"],
  ["es", /^$/, /(s|z|x|sh|ch|ge|ce)$/, "Iz"],
  // y
  ["y", null, /^$/, "j"], ["y", /^$/, /[aeiou].*[^aeiou]$/, "i"], ["y", /^$/, null, "aI"], ["y", null, null, "I"],
  // Konsonanten mit zwei Aussprachen
  ["c", /^[eiy]/, null, "s"], ["c", null, null, "k"], ["g", /^[eiy]/, null, "dZ"], ["g", null, null, "g"],
  ["s", /^$/, /[aeiouybdglmnrvw]$/, "z"], ["s", /^[aeiouy]/, /[aeiouy]$/, "z"], ["s", null, null, "s"],
  ["x", null, null, "ks"], ["j", null, null, "dZ"], ["z", null, null, "z"], ["q", null, null, "k"],
  // einzelne Vokale: kurz (cat, bed, sit, hot, cup); am Wortende lang (go, me, ha)
  ["a", /^$/, null, "@"], ["o", /^$/, null, "oU"], ["e", /^$/, null, "i:"], ["i", /^$/, null, "i:"],
  ["u", /^$/, null, "u:"],
  ["a", null, null, "{"], ["e", null, null, "E"], ["i", null, null, "I"], ["o", null, null, "A"], ["u", null, null, "V"],
];

export function englischZuLautschrift(text) {
  return text
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/(\s+|[.,!?;:]+)/)
    .map((t) => {
      if (!t) return "";
      if (/^\s+$/.test(t)) return " ";
      if (/^[.,!?;:]+$/.test(t)) return /[,;]/.test(t) ? " _ " : " . ";
      return wort(t.replace(/[^a-z]/g, ""));
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function wort(w) {
  if (!w) return "";
  if (WOERTER[w]) return WOERTER[w];
  // Endungen -s, -ed, -ing an bekannte Wörter hängen (looks, loved, watching)
  for (const [end, laut] of [["ing", "IN"], ["s", null], ["ed", null]]) {
    if (!w.endsWith(end)) continue;
    const kurz = w.slice(0, -end.length);
    if (kurz.length < 3) continue; // sonst wäre „bed“ ein „be“ + „d“
    const stamm = [kurz + "e", kurz].find((x) => WOERTER[x]); // lov-ed → love, breath-ing → breathe
    if (stamm) {
      const s = WOERTER[stamm];
      if (laut) return s + laut;
      if (end === "s") return s + (/[ptkfT]$/.test(s) ? "s" : "z");
      return s + (/[td]$/.test(s) ? "Id" : /[pkfsST]$/.test(s) ? "t" : "d");
    }
  }
  let aus = "";
  let i = 0;
  while (i < w.length) {
    const davor = w.slice(0, i);
    // Doppelkonsonant: einmal
    if (w[i] === w[i + 1] && !"aeiou".includes(w[i])) {
      i++;
      continue;
    }
    const regel = R.find(([g, nach, vor]) => w.startsWith(g, i) && (!nach || nach.test(w.slice(i + g.length))) && (!vor || vor.test(davor)));
    if (regel) {
      aus += regel[3];
      i += regel[0].length;
    } else {
      aus += { r: "r" }[w[i]] ?? w[i];
      i++;
    }
  }
  return aus;
}
