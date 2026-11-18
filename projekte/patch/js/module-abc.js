// ABC (Runde 25): Noten als Text, in der ABC-Notation von Chris Walshaw (1991, für Volksmusik erfunden, damit man
// Melodien per E-Mail schicken kann). Ein Buchstabe ist eine Note, eine Zahl dahinter ihre Länge:
//
//   L:1/8          Grundlänge (hier Achtel); ohne Angabe 1/8
//   K:G            Tonart (G-Dur: jedes F wird Fis). Auch Moll (K:Am), Bb, F#, …
//   C D E F G A B  die Oktave ab dem mittleren C;  c d e … b eine Oktave höher;  ' höher, , tiefer (C, c')
//   ^C _B =F       Kreuz, Be, Auflöser (gilt bis zum nächsten Taktstrich, wie in Noten)
//   C2 C/2 C3/2 C/ Länge: doppelt, halb, anderthalb, halb
//   z              Pause (z2: zwei Grundlängen)
//   [CEG]          Akkord (alle zugleich)
//   (3CDE          Triole: drei Noten in der Zeit von zweien;  (5 … fünf in der Zeit von dreien (wie im Standard)
//   A>B  A<B       punktiert: 1,5 + 0,5 bzw. 0,5 + 1,5
//   | |: :|        Taktstrich, Wiederholung (der Teil zwischen |: und :| zweimal)
// Der Takt-Ausgang schlägt bei jeder Note (für Trommeln). Das Stück läuft im Kreis, im globalen Tempo
// (eine Viertel = ein Schlag).

import { Takt, Noten } from "./takt.js";

const DUR = ["C", "G", "D", "A", "E", "B", "F#", "C#"], MOLL_DUR = { Am: "C", Em: "G", Bm: "D", "F#m": "A", "C#m": "E", "G#m": "B", Dm: "F", Gm: "Bb", Cm: "Eb", Fm: "Ab", Bbm: "Db", Ebm: "Gb" };
const BE = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
const KREUZ_FOLGE = "FCGDAEB", BE_FOLGE = "BEADGCF";
const STUFE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function vorzeichen(k) {
  const grund = MOLL_DUR[k] ?? k.replace(/maj|dur/i, "");
  const v = {};
  const kr = DUR.indexOf(grund), be = BE.indexOf(grund);
  if (kr > 0) for (const b of KREUZ_FOLGE.slice(0, kr)) v[b] = 1;
  else if (be > 0) for (const b of BE_FOLGE.slice(0, be)) v[b] = -1;
  return v;
}

// Text → { ereignisse: [[Beginn in Vierteln, Note, Länge in Vierteln]], laenge }
export function leseABC(text) {
  let L = 0.5, tonart = {}; // L: Grundlänge in Vierteln (1/8 = eine halbe Viertel)
  const koerper = [];
  for (const zeile of text.split("\n")) {
    const kopf = zeile.match(/^\s*([A-Za-z]):\s*(.*)$/);
    if (kopf) {
      const [, f, wert] = kopf;
      if (f === "L") {
        const [a, b] = wert.split("/").map(Number);
        if (a && b) L = (4 * a) / b;
      }
      if (f === "K") tonart = vorzeichen(wert.trim().split(/\s/)[0]);
      continue;
    }
    koerper.push(zeile.replace(/%.*$/, ""));
  }
  let s = koerper.join(" ");
  // Wiederholungen: |: … :| zweimal hintereinander schreiben
  s = s.replace(/\|:(.*?):\|/gs, (_, teil) => ` ${teil} | ${teil} |`);
  const ereignisse = [];
  let zeit = 0, i = 0, takt = {}, tupel = null, punkt = 0;
  const laenge = () => {
    const m = s.slice(i).match(/^(\d*)(\/*)(\d*)/);
    i += m[0].length;
    let z = m[1] ? Number(m[1]) : 1;
    if (m[2]) z /= m[3] ? Number(m[3]) : 2 ** m[2].length;
    return z;
  };
  const note = () => {
    const m = s.slice(i).match(/^(\^\^|\^|__|_|=)?([A-Ga-gz])([,']*)/);
    if (!m) return null;
    i += m[0].length;
    const [, acc, buchstabe, okt] = m;
    if (buchstabe === "z") return { pause: true };
    const gross = buchstabe.toUpperCase();
    let n = 60 + STUFE[gross] + (buchstabe === gross ? 0 : 12);
    for (const o of okt) n += o === "'" ? 12 : -12;
    if (acc) takt[gross + n] = { "^": 1, "^^": 2, _: -1, __: -2, "=": 0 }[acc];
    n += takt[gross + n] ?? tonart[gross] ?? 0;
    return { n };
  };
  const dauer = (d) => {
    let f = 1;
    if (tupel) {
      f = tupel.q / tupel.p;
      if (--tupel.rest <= 0) tupel = null;
    }
    if (punkt) {
      f *= punkt;
      punkt = 0;
    }
    return d * L * f;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "|" || c === ":") {
      takt = {};
      i++;
    } else if (c === "(" && /\d/.test(s[i + 1])) {
      const p = Number(s[i + 1]);
      tupel = { p, q: p === 3 ? 2 : p === 2 || p === 4 ? 3 : p === 6 ? 2 : 3, rest: p };
      i += 2;
    } else if (c === "[") {
      i++;
      const akkord = [];
      while (i < s.length && s[i] !== "]") {
        const no = note();
        if (no?.n !== undefined) akkord.push(no.n);
        else i++;
      }
      i++;
      const d = dauer(laenge());
      for (const n of akkord) ereignisse.push([zeit, n, d]);
      zeit += d;
    } else if (c === ">" || c === "<") {
      // die letzte Note wird länger (>) oder kürzer (<), die nächste umgekehrt
      const letzte = ereignisse.filter((e) => e[0] === ereignisse.at(-1)?.[0]);
      const f = c === ">" ? 1.5 : 0.5;
      const alt = letzte[0]?.[2] ?? 0;
      for (const e of letzte) e[2] = alt * f;
      zeit += alt * (f - 1);
      punkt = 2 - f;
      i++;
    } else {
      const no = note();
      if (!no) {
        i++;
        continue;
      }
      const d = dauer(laenge());
      if (!no.pause) ereignisse.push([zeit, no.n, d]);
      zeit += d;
    }
  }
  return { ereignisse, laenge: zeit };
}

const BEISPIEL = `X:1
T:Beispiel (Triolen, punktiert, Wiederholung)
L:1/8
K:Am
|: A2 c>B A2 E2 | (3ABc (3dcB A4 :| e2 d>c B2 G2 | [A,EA]8 |`;

const abc = {
  titel: "ABC",
  gruppe: "Noten",
  baue(ctx, { uhr, tempo, modul, bild }) {
    const noten = new Noten(), takt = new Takt();
    let stueck = leseABC(modul.werte.abc ?? BEISPIEL), start = null, kopf = 0, status = null;
    const abo = uhr.abonniere(() => tempo() * 4, (t, nr) => {
      if (!stueck.laenge) return;
      start ??= nr;
      const viertel = 60 / tempo();
      const von = ((nr - start) / 4) % stueck.laenge, bis = von + 0.25;
      for (const [b, n, d] of stueck.ereignisse) {
        if (b >= von && b < bis) {
          const zeitpunkt = t + (b - von) * viertel;
          noten.an(zeitpunkt, n, 0.8, d * viertel * 0.95);
          takt.sende(zeitpunkt, d * viertel * 0.95);
        }
      }
      setTimeout(() => (kopf = von / stueck.laenge), Math.max(0, (t - ctx.currentTime) * 1000));
    });
    const zeige = () => status && (status.textContent = `${stueck.ereignisse.length} Noten, ${stueck.laenge.toFixed(2)} Viertel · ${Math.round(kopf * 100)} %`);
    return {
      ein: { Neustart: { art: "takt", ziel: (t) => setTimeout(() => (start = null), Math.max(0, (t - ctx.currentTime) * 1000 - 50)) } },
      aus: { Noten: { art: "noten", knoten: noten }, Takt: { art: "takt", knoten: takt, info: "ein Schlag je Note" } },
      regler: [],
      klasse: "breit",
      extra: (el) => {
        const feld = document.createElement("textarea");
        feld.className = "abc-feld";
        feld.rows = 8;
        feld.spellcheck = false;
        feld.value = modul.werte.abc ?? BEISPIEL;
        status = document.createElement("p");
        status.className = "hinweis";
        let warte = null;
        feld.addEventListener("input", () => {
          clearTimeout(warte);
          warte = setTimeout(() => {
            stueck = leseABC(feld.value);
            modul.werte.abc = feld.value;
            feld.dispatchEvent(new Event("change", { bubbles: true }));
          }, 300);
        });
        const hilfe = document.createElement("p");
        hilfe.className = "hinweis";
        hilfe.textContent = "C D E … das mittlere C aufwärts, c d e eine Oktave höher, ' und , verschieben. Zahl dahinter: Länge (2 doppelt, /2 halb). z Pause, [CEG] Akkord, (3 Triole, > punktiert, ^ _ = Vorzeichen, |: :| Wiederholung, L: Grundlänge, K: Tonart.";
        el.append(feld, status, hilfe);
        bild.add(zeige);
      },
      weg: () => {
        abo();
        bild.delete(zeige);
      },
    };
  },
};

export const ABC_MODULE = { abc };
