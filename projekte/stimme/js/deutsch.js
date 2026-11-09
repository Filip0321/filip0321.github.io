// Deutscher Text → Lautschrift (SAMPA), nur mit Regeln und ein paar kurzen Wörtern, ohne großes Wörterbuch.
//
// Die wichtigsten Regeln der deutschen Aussprache:
//   - Vokallänge: lang vor h (Rohr, gehen), vor einem einzelnen Konsonanten mit Vokal danach (Name, Rose) und
//     am Wortende; kurz vor zwei und mehr Konsonanten (Stimme, Wasser, Welt)
//   - kurze Vokale klingen anders als lange, nicht nur kürzer: i: / I, e: / E, o: / O, u: / U, y: / Y, 2: / 9
//   - schwaches e (@) in Endsilben: Rohre, gehen, Engel; „-er“ am Ende wird zu 6 (Wasser)
//   - r vor einem Vokal: R (hinten), sonst wird es zum Vokal 6 (hier, Uhr, Rohr)
//   - Auslautverhärtung: b, d, g am Wortende wie p, t, k (Hund, Tag); „-ig“ am Ende wie „ich“ (König)
//   - s vor Vokal am Wortanfang und zwischen Vokalen stimmhaft (Sonne, Rose); st und sp am Anfang: scht, schp
//   - ch nach a, o, u, au hinten (Bach, doch, Buch, auch), sonst vorn (ich, echt)
//   - Knacklaut (?) vor Vokalen am Wortanfang: „ein Ei“ ist ?aIn ?aI, nicht „einei“
// Was falsch herauskommt, kann man in der Lautschrift von Hand verbessern.

const VOKALE = "aeiouäöüy";
const LANG = { a: "a:", e: "e:", i: "i:", o: "o:", u: "u:", ä: "E:", ö: "2:", ü: "y:", y: "y:" };
const KURZ = { a: "a", e: "E", i: "I", o: "O", u: "U", ä: "E", ö: "9", ü: "Y", y: "Y" };
// lang, obwohl nur ein Konsonant folgt (einsilbig): die Regel allein würde sie kurz machen
const LANG_EINSILBIG = new Set(["gut", "tag", "weg", "glas", "gras", "bad", "rad", "grab", "los", "zug", "flug", "mag", "lag", "gab", "mal", "schon", "wem", "den", "dem", "wen", "ihm", "ihn", "schaf", "rot", "tod", "not", "brot", "hof", "nun", "zum", "vom", "wal", "tal", "kam", "nam", "blut", "mut", "fuß", "ruß", "spaß", "maß", "groß", "süß", "gruß", "buch", "tuch", "such", "hoch", "schön", "grün", "ruhm", "wut"]);
// kurze Wörter, die oft vorkommen und den Regeln entwischen
const WOERTER = {
  der: "de:6", die: "di:", das: "das", und: "?Unt", ist: "?Ist", ich: "?IC", nicht: "nICt", ein: "?aIn", mit: "mIt",
  es: "?Es", sie: "zi:", er: "?e:6", wir: "vi:6", ihr: "?i:6", du: "du:", zu: "tsu:", von: "fOn", vor: "fo:6",
  hat: "hat", bin: "bIn", hier: "hi:6", mir: "mi:6", dir: "di:6", für: "fy:6", nur: "nu:6", uhr: "?u:6",
  noch: "nOx", auch: "?aUx", wie: "vi:", was: "vas", wer: "ve:6", wo: "vo:", so: "zo:", ja: "ja:", nein: "naIn",
  uns: "?Uns", um: "?Um", in: "?In", an: "?an", am: "?am", im: "?Im", ab: "?ap", ob: "?Op", man: "man",
  kann: "kan", will: "vIl", bis: "bIs", des: "dEs", mich: "mIC", dich: "dIC", sich: "zIC", euch: "?OYC",
  aber: "?a:b6", oder: "?o:d6", immer: "?Im6", nie: "ni:", wieder: "vi:d6", komm: "kOm", herein: "hERaIn",
};

const vokal = (c) => c !== undefined && VOKALE.includes(c);

export function deutschZuLautschrift(text) {
  return text
    .toLowerCase()
    .split(/(\s+|[.,!?;:]+)/)
    .map((t) => {
      if (!t) return "";
      if (/^\s+$/.test(t)) return " ";
      if (/^[.,!?;:]+$/.test(t)) return /[,;]/.test(t) ? " _ " : " . ";
      return wort(t.replace(/[^a-zäöüß]/g, ""));
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function wort(w) {
  if (!w) return "";
  if (WOERTER[w]) return WOERTER[w];
  let aus = "";
  let i = 0;
  // Vorsilben, die unbetont sind (nur bei langen Wörtern, sonst wäre „geben“ ein „ge-ben“)
  for (const [vor, laut] of [["ver", "f6"], ["zer", "ts6"], ["be", "b@"], ["ge", "g@"]]) {
    const rest = w.slice(vor.length);
    if (w.startsWith(vor) && rest.length >= 4 && !vokal(rest[0]) && rest[0] !== "h" && rest[0] !== rest[1]) {
      aus = laut;
      i = vor.length;
      break;
    }
  }
  const vokaleGesamt = [...w].filter(vokal).length;
  let letzterVokal = -1;
  for (let k = w.length - 1; k >= 0; k--) if (vokal(w[k])) { letzterVokal = k; break; }

  while (i < w.length) {
    const rest = w.slice(i);
    const c = w[i];
    const vorher = aus.at(-1);
    const amAnfang = i === 0;
    // ---- Vokale ----
    if (vokal(c)) {
      if (amAnfang) aus += "?";
      const zwei = rest.slice(0, 2);
      const doppel = { ie: "i:", ei: "aI", ai: "aI", eu: "OY", äu: "OY", au: "aU", aa: "a:", ee: "e:", oo: "o:" }[zwei];
      if (doppel) {
        aus += doppel;
        i += 2;
        // h nach einem Doppellaut wird gesprochen (Freiheit), nach ie, aa … ist es nur Dehnung
        if (w[i] === "h" && /[aeiouäöü]/.test(w[i + 1] ?? "") && !["ie", "aa", "ee", "oo"].includes(zwei)) {
          aus += "h";
          i++;
        }
        continue;
      }
      // schwaches e in der letzten Silbe (Rohre, gehen, Engel); „er“ am Ende wird 6 (Wasser)
      if (c === "e" && i === letzterVokal && vokaleGesamt > 1) {
        const danach = w.slice(i + 1);
        if (/^r[nst]?$/.test(danach)) {
          aus += "6" + danach.slice(1);
          i = w.length;
          continue;
        }
        if (/^(n|l|m|s|t|nd|ns|nt|lt|st|ln|ls|ms)?$/.test(danach)) {
          aus += "@";
          i++;
          continue;
        }
      }
      // Länge aus dem, was folgt
      let j = i + 1;
      let einheiten = 0;
      let dehnung = false;
      if (w[j] === "h") {
        dehnung = true;
      } else {
        while (j < w.length && !vokal(w[j])) {
          const r = w.slice(j);
          if (r.startsWith("sch")) j += 3, einheiten += 1;
          else if (r.startsWith("ch") || r.startsWith("ph") || r.startsWith("th")) j += 2, einheiten += 1;
          else if (r.startsWith("ß")) j += 1, einheiten += 1;
          else j += 1, einheiten += 1;
        }
      }
      const ende = j >= w.length;
      let lang;
      if (dehnung) lang = true;
      else if (einheiten === 0) lang = true; // Vokal am Wortende oder vor einem anderen Vokal
      else if (einheiten === 1 && !ende) lang = true; // offene Silbe: Na-me, Ro-se
      else if (einheiten === 1 && ende) lang = LANG_EINSILBIG.has(w) || w[i + 1] === "r" || w[i + 1] === "ß";
      else lang = false;
      // ch, ck, ng, x zählen als zwei: davor kurz (Bach, Rock, Ring, Hexe)
      if (/^(ch|ck|ng|x|tz|pf|ß)/.test(w.slice(i + 1)) && !dehnung && w.slice(i + 1, i + 4) !== "sch") {
        lang = w[i + 1] === "ß" && (LANG_EINSILBIG.has(w) || einheiten === 1);
        if (w.slice(i + 1).startsWith("ch") && LANG_EINSILBIG.has(w)) lang = true;
      }
      aus += lang ? LANG[c] : KURZ[c];
      i += 1;
      if (dehnung) i += 1; // das h ist stumm
      continue;
    }
    // ---- Konsonanten ----
    const nach = w[i + 1];
    const regeln = [
      ["tsch", "tS"], ["sch", "S"], ["chs", "ks"], ["ck", "k"], ["tz", "ts"], ["qu", "kv"], ["ph", "f"], ["th", "t"],
      ["ng", "N"], ["nk", "Nk"], ["pf", "pf"],
    ];
    const r = regeln.find(([g]) => rest.startsWith(g));
    if (r) {
      aus += r[1];
      i += r[0].length;
      continue;
    }
    if (rest.startsWith("ch")) {
      aus += /[aouAOU]:?$/.test(aus) ? "x" : "C"; // nach a, o, u (und au: endet auf U) hinten im Mund
      i += 2;
      continue;
    }
    if (c === nach) {
      i++; // Doppelkonsonant: einmal sprechen
      continue;
    }
    if (c === "s") {
      if (amAnfang && (nach === "t" || nach === "p")) aus += "S";
      else if ((amAnfang || vokal(w[i - 1]) || w[i - 1] === "l" || w[i - 1] === "n" || w[i - 1] === "r") && vokal(nach)) aus += "z";
      else aus += "s";
    } else if (c === "r") {
      aus += vokal(nach) ? "R" : /[aeiouyEIOUY269@:]$/.test(aus) ? "6" : "R";
    } else if (c === "h") {
      if (amAnfang || !vokal(w[i - 1])) aus += "h"; // sonst Dehnung (oben schon behandelt)
    } else if ("bdg".includes(c) && (i === w.length - 1 || (i === w.length - 2 && "st".includes(w.at(-1))))) {
      // Auslautverhärtung; -ig am Ende wie „ich“
      aus += c === "g" && w[i - 1] === "i" && i === w.length - 1 ? "C" : { b: "p", d: "t", g: "k" }[c];
    } else {
      aus += { v: "f", w: "v", z: "ts", x: "ks", ß: "s", c: "k", q: "k", j: "j" }[c] ?? c;
    }
    i++;
  }
  return aus;
}
