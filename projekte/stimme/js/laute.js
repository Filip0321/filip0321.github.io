// Laute: wie das Rohr für jeden Laut aussieht, und Lautschrift (SAMPA) als Folge davon.
//
// SAMPA ist das IPA in gewöhnlichen Buchstaben (Wells, 1990er), für Rechner gemacht: S für sch, C für ch wie in
// „ich“, x für ch wie in „Bach“, @ für das schwache e in „Rohre“, 6 für das r in „Wasser“, : für lang.
// „Rohre“ ist R o: R @, „thing“ ist T I N. Was die Sprachregeln (deutsch.js, englisch.js) falsch machen,
// kann man so in der Lautschrift von Hand richtig schreiben.
//
// Die Vokale sind gemessen, nicht geraten: für jede Zungen- und Lippenlage die Antwort des Rohrs auf einen
// einzelnen Puls ausgerechnet, daraus die ersten zwei Formanten (F1, F2), und die Lage gesucht, die den
// Mittelwerten von Männerstimmen am nächsten kommt (deutsch nach Sendlmeier, englisch nach Hillenbrand 1995).
// Die Lippen bleiben bei Vokalen unter 0,3 oder über 0,7, sonst zischen sie wie ein f.
//
// Konsonanten sind Engstellen: wo (ort), wie weit (weite; 0 = ganz zu) und wie stark es dort rauscht (rausch).
// Ob die Stimmlippen dabei schwingen, unterscheidet b/p, d/t, g/k, v/f, z/s. Nasale (m, n, N) sind Verschlüsse
// mit offenem Gaumensegel: der Schall geht dann durch die Nase.

const LIPPEN = 41;
const ZAEHNE = 38; // th
const ZAHN = 36; // Zahndamm: t, d, n, s, l
const HART = 33; // hinter dem Zahndamm: sch
const GAUMEN = 28; // harter Gaumen: ch wie in „ich“, j
const WEICH = 22; // weicher Gaumen: k, g, ng
const ZAEPFCHEN = 17; // r im Deutschen (hinten)

const v = (zungeOrt, zungeWeite, lippen) => ({ zungeOrt, zungeWeite, lippen });
// SAMPA-Vokal → Zunge (Ort, Weite) und Lippen (ab 1,5 offen); in Klammern F1 / F2 des Ziels
export const VOKALE = {
  i: v(26, 2.05, 3), // Liebe, see (280 / 2250)
  I: v(24.5, 2.2, 3), // bin, sit (400 / 1990)
  e: v(25.5, 2.35, 3), // See (390 / 2100)
  E: v(23.5, 2.65, 3), // Bett, Käse, bed (550 / 1800)
  "{": v(24, 2.95, 3), // cat (600 / 1900)
  a: v(17.5, 2.5, 3), // Haus, father (750 / 1300)
  A: v(17.5, 2.5, 3), // hot (amerikanisch), wie a
  V: v(18, 2.2, 3), // cup (620 / 1200)
  "@": v(21.5, 2.2, 3), // Rohre, about (500 / 1500)
  6: v(19, 2.35, 3), // Wasser, Uhr (650 / 1350)
  3: v(20, 2.05, 3), // bird (475 / 1380)
  O: v(13, 2.2, 0.75), // Sonne, thought (600 / 950)
  o: v(19, 2.2, 0.28), // Rohr (400 / 750)
  U: v(21.5, 2.2, 0.75), // Mund, book (470 / 1120)
  u: v(15, 2.05, 0.25), // gut, food (300 / 700)
  y: v(26, 2.1, 0.75), // über (280 / 1650)
  Y: v(25, 2.2, 0.75), // Müll (350 / 1550)
  2: v(22.5, 2.05, 1.2), // schön (380 / 1500)
  9: v(21.5, 2.2, 1.2), // Hölle (500 / 1400)
};
const SCHWACH = new Set(["@", "6"]);

// Für die Formant-Art (SAM): die drei Formanten jedes Vokals in Hz (F1, F2 die Ziele von oben, F3 typisch;
// beim englischen r-Vokal 3 ist F3 auffällig tief, daran hört man das r)
export const FORMANTEN = {
  i: [280, 2250, 3000], I: [400, 1990, 2550], e: [390, 2100, 2700], E: [550, 1800, 2550], "{": [600, 1900, 2500],
  a: [750, 1300, 2500], A: [750, 1300, 2500], V: [620, 1200, 2550], "@": [500, 1500, 2500], 6: [650, 1350, 2400],
  3: [475, 1380, 1700], O: [600, 950, 2450], o: [400, 750, 2400], U: [470, 1120, 2300], u: [300, 700, 2250],
  y: [280, 1650, 2200], Y: [350, 1550, 2300], 2: [380, 1500, 2300], 9: [500, 1400, 2350],
};
// Formanten zu einer beliebigen Zungenlage: Mittel der Vokale, gewichtet nach Nähe (1 / Abstand²)
function formantenAus(ort, weite, lippen) {
  const f = [0, 0, 0];
  let summe = 0;
  for (const [s, z] of Object.entries(VOKALE)) {
    const d = ((ort - z.zungeOrt) / 4) ** 2 + ((weite - z.zungeWeite) / 0.4) ** 2 + ((Math.min(lippen, 1.5) - Math.min(z.lippen, 1.5)) / 0.5) ** 2;
    const g = 1 / (d + 0.02) ** 2;
    for (let k = 0; k < 3; k++) f[k] += g * FORMANTEN[s][k];
    summe += g;
  }
  return f.map((x) => x / summe);
}
// Was die Formant-Art spielen soll: Formanten aus Zunge und Lippen, dazu je nach engster Stelle der Konsonanten
// (ohne die Rundung der Lippen beim Vokal):
//   zu + Nase offen: Nasal (tiefes F1, leise)     zu: Verschluss (fast still)
//   0,3 bis 0,7: Zischlaut (Rauschen, Band je nach Ort)     0,7 bis 1: l, r, w (etwas leiser, l und r mit eigenem F2 / F3)
export function formantKlang(zungeOrt, zungeWeite, lippen, enge, velum) {
  const f = formantenAus(zungeOrt, zungeWeite, lippen);
  let laut = 1;
  let rausch = 0;
  let band = 4000;
  const e = enge.reduce((m, x) => (!m || x.weite < m.weite ? x : m), null);
  if (e && e.weite < 0.3) {
    if (velum > 0.1) {
      f[0] = 250;
      f[1] = e.ort >= 40 ? 1000 : e.ort >= 33 ? 1600 : 2200;
      laut = 0.45;
    } else laut = 0.06;
  } else if (e && e.weite < 0.7) {
    rausch = e.rausch ?? 1;
    band = e.ort >= 40 ? 1500 : e.ort >= 37 ? 6000 : e.ort >= 34 ? 5500 : e.ort >= 31 ? 3000 : e.ort >= 26 ? 4000 : 1500;
    laut = 0.35;
  } else if (e && e.weite < 1.0) {
    laut = 0.7;
    if (e.ort >= 30 && e.ort < 33) f[2] = 1700; // englisches r
    if (e.ort >= 34 && e.ort < 38) {
      f[1] = Math.min(f[1], 1200); // l
      f[2] = 2700;
    }
  }
  return { formanten: f, formantLaut: laut, formantRausch: rausch, rauschBand: band };
} // kurze, unbetonte Vokale: bekommen keinen eigenen Ton der Melodie

// welcher Vokal liegt einer Einstellung am nächsten (für die Anzeige; nur die deutschen Buchstaben)
const ANZEIGE = { a: "a", e: "e", i: "i", o: "o", u: "u", E: "ä", 2: "ö", y: "ü", "@": "ə (schwach)" };
export function naechsterVokal(ort, weite, lippen) {
  let bester = "";
  let abstand = Infinity;
  for (const [s, name] of Object.entries(ANZEIGE)) {
    const z = VOKALE[s];
    const d = ((ort - z.zungeOrt) / 4) ** 2 + ((weite - z.zungeWeite) / 0.4) ** 2 + ((Math.min(lippen, 1.5) - Math.min(z.lippen, 1.5)) / 0.5) ** 2;
    if (d < abstand) {
      abstand = d;
      bester = name;
    }
  }
  return abstand < 4 ? bester : "";
}

// ein Schritt der Folge: dauer in Einheiten (eine Einheit = Tempo-Regler), dazu was gilt
//   vokal: Zungenlage (sonst bleibt die Zunge, wo sie war: so färbt der Vokal den Konsonanten, wie beim Sprechen)
//   enge, velum, stimmhaft, an (Luft), betont (bekommt einen Ton der Melodie)
const still = (dauer) => ({ dauer, an: false });
const reibe = (ort, weite, stimmhaft, rausch, dauer = 1, extra = []) => ({ dauer, enge: [{ ort, weite, rausch }, ...extra], stimmhaft });
const nasal = (ort) => ({ dauer: 1, enge: [{ ort, weite: 0 }], velum: 0.4, stimmhaft: 1 });
// Plosiv: zu (stumm oder mit etwas Stimme), dann auf; stimmlose mit kurzem Hauch danach.
// rausch: wie laut der Knall beim Öffnen ist (an den Lippen leiser als hinten)
const plosiv = (ort, stimmhaft, rausch) => [
  { dauer: 0.6, enge: [{ ort, weite: 0, rausch }], stimmhaft: stimmhaft ? 0.4 : 0 },
  ...(stimmhaft ? [] : [{ dauer: 0.35, stimmhaft: 0, enge: [{ ort, weite: 1.2 }] }]),
];
// Gleitlaut: kurz eine Vokal-Lage (j wie i, w wie u)
const gleit = (vokal, lippen) => ({ dauer: 0.6, vokal: { ...VOKALE[vokal], ...(lippen ? { lippen } : {}) }, stimmhaft: 1 });

const KONSONANTEN = {
  p: plosiv(LIPPEN, false, 0.5),
  b: plosiv(LIPPEN, true, 0.5),
  t: plosiv(ZAHN, false, 1),
  d: plosiv(ZAHN, true, 1),
  k: plosiv(WEICH, false, 0.8),
  g: plosiv(WEICH, true, 0.8),
  "?": [{ dauer: 0.35, an: false }], // Knacklaut vor Vokalen am Wortanfang (deutsch: „ein Ei“)
  f: [reibe(LIPPEN, 0.45, 0, 0.35)],
  v: [reibe(LIPPEN, 0.5, 1, 0.25)],
  T: [reibe(ZAEHNE, 0.45, 0, 0.35)], // th in „thing“
  D: [reibe(ZAEHNE, 0.5, 1, 0.2, 0.7)], // th in „this“
  s: [reibe(ZAHN, 0.45, 0, 1)],
  z: [reibe(ZAHN, 0.5, 1, 0.6)],
  S: [reibe(HART, 0.45, 0, 0.9, 1.2, [{ ort: LIPPEN, weite: 0.8 }])],
  Z: [reibe(HART, 0.5, 1, 0.5, 1, [{ ort: LIPPEN, weite: 0.8 }])], // Garage, measure
  C: [reibe(GAUMEN, 0.45, 0, 0.6, 1.1)],
  x: [reibe(ZAEPFCHEN + 2, 0.45, 0, 0.5, 1.1)],
  h: [{ dauer: 0.8, stimmhaft: 0 }],
  m: [nasal(LIPPEN)],
  n: [nasal(ZAHN)],
  N: [nasal(WEICH)],
  l: [{ dauer: 0.9, enge: [{ ort: ZAHN, weite: 0.75 }], stimmhaft: 1 }],
  // deutsches r: hinten am Zäpfchen, kaum Reibung; englisches r: Zunge hochgebogen, Lippen etwas rund
  R: [{ dauer: 0.7, enge: [{ ort: ZAEPFCHEN, weite: 0.66, rausch: 0.12 }], stimmhaft: 1 }],
  r: [{ dauer: 0.8, vokal: VOKALE["3"], enge: [{ ort: 31, weite: 0.8 }, { ort: LIPPEN, weite: 1 }], stimmhaft: 1 }],
  j: [gleit("i")],
  w: [gleit("u", 0.72)],
};
// zusammengesetzte Laute
KONSONANTEN.tS = [...KONSONANTEN.t.slice(0, 1), ...KONSONANTEN.S];
KONSONANTEN.dZ = [...KONSONANTEN.d, ...KONSONANTEN.Z];
KONSONANTEN.ts = [...KONSONANTEN.t.slice(0, 1), ...KONSONANTEN.s];
KONSONANTEN.pf = [...KONSONANTEN.p.slice(0, 1), ...KONSONANTEN.f];

// alle Zeichen, längste zuerst (sonst würde „tS“ als t und S gelesen)
const ZEICHEN = [...Object.keys(VOKALE), ...Object.keys(KONSONANTEN)].sort((x, y) => y.length - x.length);

// Lautschrift in Zeichen zerlegen; was unbekannt ist, kommt in „unbekannt“
export function zerlege(sampa) {
  const teile = [];
  const unbekannt = [];
  let i = 0;
  while (i < sampa.length) {
    const rest = sampa.slice(i);
    if (/^\s+/.test(rest)) {
      i += rest.match(/^\s+/)[0].length;
      teile.push(" ");
      continue;
    }
    if (/^[.,!?;_|]/.test(rest) && !(rest[0] === "?" && VOKALE[rest[1]] !== undefined)) {
      teile.push(rest[0] === "_" || rest[0] === "|" ? "_" : ".");
      i++;
      continue;
    }
    if (rest[0] === "'" || rest[0] === '"' || rest[0] === "%") { // Betonungszeichen: werden übersprungen
      i++;
      continue;
    }
    const z = ZEICHEN.find((k) => rest.startsWith(k));
    if (!z) {
      unbekannt.push(rest[0]);
      i++;
      continue;
    }
    i += z.length;
    if (rest[z.length] === ":") {
      teile.push(z + ":");
      i++;
    } else teile.push(z);
  }
  return { teile, unbekannt };
}

// Lautschrift → Folge von Schritten
export function lautschriftZuFolge(sampa) {
  const { teile } = zerlege(sampa);
  const folge = [];
  for (let k = 0; k < teile.length; k++) {
    const t = teile[k];
    const lang = t.endsWith(":");
    const z = lang ? t.slice(0, -1) : t;
    if (t === " ") continue; // Wortgrenze: in fließender Rede keine Pause
    if (t === "_") folge.push(still(1.5));
    else if (t === ".") folge.push(still(3.5));
    else if (VOKALE[z]) {
      // Doppellaut (aI, aU, OY, eI …): zwei Vokale direkt hintereinander gleiten ineinander, jeder kürzer
      const naechster = teile[k + 1];
      const gleitet = naechster && VOKALE[naechster.replace(":", "")] && !SCHWACH.has(naechster);
      const vorher = teile[k - 1] && VOKALE[teile[k - 1].replace(":", "")];
      const dauer = SCHWACH.has(z) ? 0.9 : lang ? 2.4 : gleitet || vorher ? 1.1 : 1.4;
      folge.push({ dauer, vokal: VOKALE[z], stimmhaft: 1, betont: !SCHWACH.has(z) && !vorher });
    } else if (KONSONANTEN[z]) folge.push(...KONSONANTEN[z].map((s) => ({ ...s })));
  }
  return folge;
}

// Melodie: welche Tonhöhe (als Faktor zum Grundton) der n-te betonte Laut von insgesamt m bekommt
export function tonFuer(art, n, m, zufall) {
  const x = m > 1 ? n / (m - 1) : 0;
  if (art === "fallend") return 2 ** ((2 - 4 * x) / 12); // Aussage: sinkt über den Satz um gut zwei Halbtöne
  if (art === "frage") return 2 ** ((x < 0.75 ? -1 : -1 + ((x - 0.75) / 0.25) * 7) / 12); // am Ende hoch
  if (art === "singen") {
    const moll = [0, 3, 5, 7, 10, 12]; // Moll-Pentatonik: klingt nie falsch, eher klagend
    return 2 ** (moll[Math.floor(zufall() * moll.length)] / 12);
  }
  return 1;
}
