// Spektral-Malen: hier wird alles verbunden. Die Arbeit selbst steckt in den Modulen:
//   leinwand.js        was Spalte und Fach sind, Umrechnungen
//   ebenen.js          welche Ebenen es gibt und wie sie zusammen klingen (auch im Audio-Thread)
//   gpu.js             Flächen zum Malen, Tupfer, Anzeige
//   pinsel-shader.js   was ein Tupfer mit einer Fläche macht
//   anzeige-shader.js  wie die Mischung aussieht
//   werkzeuge.js       Pinsel, Radierer, Auswahl, Verschieben, Lesekopf greifen
//   auswahl.js         Auswahl verschieben und kopieren (mit Phasen-Vocoder)
//   bild-ebene.js      Bild -> Ebene
//   ton-analyse.js     Ton -> Ebene (STFT mit Phase)
//   aufnahme.js        Mikrofon und Ton-Dateien
//   klang.js           Seite <-> Audio-Thread, WAV rechnen
//   klang-worklet.js   aus den Ebenen wird Ton
//   kopf.js            Skala, Rahmen und Lesekopf über dem Bild
//   ebenen-liste.js    die Ebenen in der Bedienung
//   projektdatei.js    Leinwand speichern und öffnen

import { richteReglerEin } from "/lib/regler.js";
import { richteMausInfoEin, zeigeFrequenz, notenName, zeigeZeit } from "/lib/maus-info.js";
import { richteExportEin, zuWav, ladeHerunter, zeitstempel } from "/lib/export.js";
import { baueLeinwand, anteilZuFrequenz, frequenzZuFach, RATE } from "./leinwand.js";
import { amplitudenTabelle, mischeAnzeige } from "./ebenen.js";
import { richteGpuEin } from "./gpu.js";
import { richteKlangEin, fuerKlang, rendere } from "./klang.js";
import { richteKopfEin } from "./kopf.js";
import { richteWerkzeugeEin } from "./werkzeuge.js";
import { richteEbenenListeEin } from "./ebenen-liste.js";
import { ladeBild, rastere } from "./bild-ebene.js";
import { analysiere, baueAnalyse, leereTonDaten } from "./ton-analyse.js";
import { starteAufnahme, ladeTon } from "./aufnahme.js";
import { packe, entpacke } from "./projektdatei.js";

const bild = hole("bild");
const kopfCanvas = hole("kopf");
const stapel = hole("stapel");
const meldung = hole("meldung");
const leinwandInfo = hole("leinwandInfo");
const abspielen = hole("abspielen");
const festhalten = hole("festhalten");
const aufnehmen = hole("aufnehmen");

const RUECKGAENGIG_SCHRITTE = 30;
const MAX_WAV = 600; // Sekunden: länger wird eine WAV nie (Tempo 0,05 wären sonst 20 Minuten)

// alles, was sich ändert, an einer Stelle (die Werkzeuge bekommen es mit)
const z = {
  leinwand: null,
  ebenen: [], // die Malschicht zuerst, dann alles Eingefügte
  aktiv: "mal", // id der Ebene, die man gerade bearbeitet
  pos: 0, // Lesekopf in Spalten
  laeuft: false,
  halten: false, // Festhalten: der Lesekopf steht, die Spalte klingt weiter (spektraler Freeze)
  tabelle: null, // Helligkeit -> Lautstärke (ebenen.js), hängt an der Dynamik
  mischung: null, // was man sieht: Lautstärke jeder Stelle, alle Ebenen zusammen
};
let naechsteId = 1;

const kopf = richteKopfEin(kopfCanvas);
const klang = richteKlangEin({ beiPosition, beiEnde, holeZustand });
let gpu = null;
let werkzeuge = null;

const { einstellung, setzeAlle } = richteReglerEin({
  beiAenderung: () => {
    sendeEinstellung();
    zeichneBald();
  },
  extra: {
    farbskala: () => gpu?.waehleFarben(einstellung.farbskala),
    dynamik: () => {
      z.tabelle = amplitudenTabelle(einstellung.dynamik);
      mischeBald();
    },
    zeigen: () => mischeBald(),
  },
});
z.tabelle = amplitudenTabelle(einstellung.dynamik);

const liste = richteEbenenListeEin({
  liste: hole("ebenenListe"),
  eigenschaften: hole("ebenenEigenschaften"),
  beiWahl: (id) => {
    z.aktiv = id;
    zeigeEbenen();
    mischeBald(); // die Ansicht „aktive Ebene“ zeigt jetzt eine andere
  },
  beiAenderung: (id, werte) => aendere(id, werte, false),
  beiLoeschen: (id) => entferne(id),
});

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}

const finde = (id) => z.ebenen.find((e) => e.id === id);
const aktiveEbene = () => finde(z.aktiv);

// was das Bild zeigt: Größe in Bildpunkten (CSS-Pixel), Frequenzbereich, Dynamik
function ansicht() {
  const hoch = Math.min(einstellung.hoch, RATE / 2);
  const tief = Math.min(Math.max(einstellung.tief, 1), hoch / 2); // tief muss unter hoch bleiben
  return { breite: bild.clientWidth, hoehe: bild.clientHeight, tief, hoch, dynamik: einstellung.dynamik };
}

function klangEinstellung() {
  const { tempo, rueckwaerts, schleife, dynamik, zufall, lautstaerke } = einstellung;
  return { tempo, rueckwaerts, schleife, dynamik, zufall, lautstaerke, halten: z.halten };
}

function sendeEinstellung() {
  klang.einstellung(klangEinstellung());
}

// alles, was der Klang beim Start braucht (und das Rechnen einer WAV)
function holeZustand() {
  return {
    leinwand: z.leinwand,
    ebenen: z.ebenen.filter((e) => !e.aufnahme).map(fuerKlang),
    einstellung: klangEinstellung(),
    pos: z.pos,
  };
}

// ---------- Rückgängig ----------
// Jeder Eintrag ist eine Funktion, die den Zustand von vorher wiederherstellt (Malen, Auswahl,
// Ebene einfügen, löschen, verschieben). So braucht Rückgängig nicht zu wissen, was passiert ist.

const rueckgaengig = [];

function merke(zurueck) {
  rueckgaengig.push(zurueck);
  if (rueckgaengig.length > RUECKGAENGIG_SCHRITTE) rueckgaengig.shift();
}

function nimmZurueck() {
  rueckgaengig.pop()?.();
  zeichneBald();
}

// ---------- Anzeige ----------

let zeichnenGeplant = false;
let mischen = null; // [von, bis]: diese Spalten müssen neu gemischt werden

function zeichneBald() {
  if (zeichnenGeplant) return;
  zeichnenGeplant = true;
  requestAnimationFrame(bildDran);
}

// Spalten von bis bis neu mischen (ohne Angabe: alle)
function mischeBald(von = 0, bis = Infinity) {
  if (!z.leinwand) return;
  von = Math.max(0, Math.floor(von));
  bis = Math.min(z.leinwand.spalten - 1, Math.ceil(bis));
  if (von > bis) return;
  mischen = mischen ? [Math.min(mischen[0], von), Math.max(mischen[1], bis)] : [von, bis];
  zeichneBald();
}

function mischeJetzt() {
  if (!mischen) return;
  const [von, bis] = mischen;
  mischen = null;
  const nur = einstellung.zeigen === "aktiv" ? aktiveEbene() : null;
  mischeAnzeige(z.mischung, von, bis, { leinwand: z.leinwand, ebenen: z.ebenen, tabelle: z.tabelle, nur });
  gpu.ladeAnzeige(von, bis, z.mischung);
}

function passeGroesseAn() {
  const dpr = window.devicePixelRatio || 1;
  bild.width = Math.round(bild.clientWidth * dpr);
  bild.height = Math.round(bild.clientHeight * dpr);
  kopf.passeGroesseAn();
  zeichneBald();
}

function zeichneKopf(anteil, mitRahmen) {
  const a = ansicht();
  kopf.zeichne({
    anteil,
    tief: a.tief,
    hoch: a.hoch,
    skala: einstellung.skala,
    rechtecke: mitRahmen ? werkzeuge.rechtecke() : [],
    aufnahme: Boolean(aufnahme),
  });
}

// einmal pro Bild: erst die gesammelten Tupfer, dann mischen, dann zeichnen
function bildDran() {
  zeichnenGeplant = false;
  if (!z.leinwand) return;
  werkzeuge.tupfeAlle();
  mischeJetzt();
  gpu.zeichne(ansicht());
  zeichneKopf(z.pos / z.leinwand.spalten, true);
}

// ---------- Leinwand ----------

function setzeLeinwand(neu, malWerte = null) {
  gpu.neu(neu); // wirft, wenn sie zu groß für die Grafikkarte ist
  z.leinwand = neu;
  z.mischung = new Float32Array(neu.spalten * neu.faecher);
  const mal = { id: "mal", art: "mal", name: "Malschicht", gain: 0, stumm: false, werte: malWerte ?? new Float32Array(neu.spalten * neu.faecher) };
  z.ebenen = [mal];
  z.aktiv = "mal";
  gpu.neueFlaeche("mal", neu.spalten, malWerte);
  klang.neueLeinwand(neu);
  klang.ebene(mal);
  rueckgaengig.length = 0;
  werkzeuge.neueLeinwand();
  setzeLesekopf(0);
  const ms = (neu.sekundenProSpalte * 1000).toFixed(1).replace(".", ",");
  const hz = neu.fachBreite.toFixed(1).replace(".", ",");
  leinwandInfo.textContent = `${neu.spalten} Spalten zu ${ms} ms, ${neu.faecher} Fächer zu ${hz} Hz`;
  zeigeEbenen();
  mischeBald();
}

function neueLeinwand() {
  if (aufnahme) return zeige("Erst die Aufnahme stoppen.");
  try {
    setzeLeinwand(baueLeinwand({ dauer: einstellung.dauer, fenster: Number(einstellung.fenster) }));
    zeige("");
  } catch (fehler) {
    zeige(fehler.message);
  }
}

// ---------- Ebenen ----------

function zeigeEbenen() {
  liste.zeige(z.ebenen, z.aktiv, z.leinwand);
}

// eine neue Ebene dazu (und aktiv machen)
function fuegeEin(e) {
  z.ebenen.push(e);
  if (e.art === "ton") gpu.neueFlaeche(e.id, e.spalten, e.maske);
  klang.ebene(e);
  z.aktiv = e.id;
  merke(() => entferne(e.id, false));
  zeigeEbenen();
  mischeBald();
}

function entferne(id, merken = true) {
  const i = z.ebenen.findIndex((e) => e.id === id);
  const e = z.ebenen[i];
  if (!e || e.art === "mal") return;
  const nutzer = z.ebenen.filter((x) => x.filter === id); // Ton-Ebenen, die sie als Filter nehmen
  z.ebenen.splice(i, 1);
  gpu.entferneFlaeche(id);
  klang.weg(id);
  for (const x of nutzer) {
    x.filter = null;
    klang.eigenschaften(x.id, { filter: null });
  }
  if (z.aktiv === id) z.aktiv = "mal";
  if (merken) {
    merke(() => {
      z.ebenen.splice(i, 0, e);
      if (e.art === "ton") gpu.neueFlaeche(e.id, e.spalten, e.maske);
      klang.ebene(e);
      for (const x of nutzer) {
        x.filter = id;
        klang.eigenschaften(x.id, { filter: id });
      }
      zeigeEbenen();
      mischeBald();
    });
  }
  zeigeEbenen();
  mischeBald();
}

// Eigenschaften einer Ebene ändern. neuZeigen: die Bedienung neu bauen (nicht, während man an
// einem Regler darin zieht, sonst verschwindet er unter dem Finger)
const BILD_LAGE = ["anfang", "ende", "unten", "oben", "invertieren", "schwelle"];

function aendere(id, werte, neuZeigen = true) {
  const e = finde(id);
  if (!e) return;
  Object.assign(e, werte);
  if (e.art === "bild" && BILD_LAGE.some((name) => name in werte)) {
    // sinnvolle Grenzen: mindestens eine Spalte breit, oben über unten
    e.unten = Math.min(Math.max(e.unten, 1), RATE / 2 - 1);
    e.oben = Math.min(Math.max(e.oben, e.unten * 1.01), RATE / 2);
    e.ende = Math.max(e.ende, e.anfang + 1);
    rastere(e, z.leinwand);
    klang.ebene(e); // die neuen werte ganz
  } else {
    if ("start" in werte) e.start = Math.round(e.start);
    const { gain, stumm, filter, start } = e;
    klang.eigenschaften(id, { gain, stumm, filter, start });
  }
  if (neuZeigen || "stumm" in werte || "filter" in werte) zeigeEbenen();
  mischeBald();
}

// wo eingefügt wird: am Lesekopf (steht er ganz am Ende, dann vorn)
function einfuegeSpalte() {
  const s = Math.floor(z.pos);
  return s >= z.leinwand.spalten - 2 ? 0 : s;
}

async function bildEinfuegen(datei) {
  try {
    const quelle = await ladeBild(datei);
    const a = ansicht();
    const { spalten } = z.leinwand;
    // so breit, dass das Bild unverzerrt so hoch ist wie die Ansicht
    const anfang = einfuegeSpalte();
    const breite = ((a.hoehe * (quelle.breite / quelle.hoehe)) / a.breite) * spalten;
    const e = {
      id: `e${naechsteId++}`,
      art: "bild",
      name: datei.name,
      gain: -12, // ein weißes Bild ist sonst in jedem Fach 0 dB: sehr laut, und tanh macht es hart
      stumm: false,
      quelle,
      anfang,
      ende: Math.min(spalten, anfang + Math.max(1, breite)),
      unten: a.tief,
      oben: a.hoch,
      invertieren: false,
      schwelle: 0,
    };
    rastere(e, z.leinwand);
    fuegeEin(e);
    zeige("");
  } catch (fehler) {
    zeige(`Das Bild ließ sich nicht öffnen: ${fehler.message}`);
  }
}

async function tonEinfuegen(datei) {
  try {
    const samples = await ladeTon(datei);
    const start = einfuegeSpalte();
    const platz = z.leinwand.spalten - start;
    const ton = analysiere(samples, z.leinwand, platz);
    fuegeEin({ id: `e${naechsteId++}`, art: "ton", name: datei.name, gain: 0, stumm: false, filter: null, start, ...ton });
    const sekunden = samples.length / RATE;
    const passt = platz * z.leinwand.sekundenProSpalte;
    zeige(sekunden > passt + 0.05 ? `Gekürzt: ${sekunden.toFixed(1)} s Ton, bis zum Ende der Leinwand passen ${passt.toFixed(1)} s.` : "");
  } catch (fehler) {
    zeige(`Der Ton ließ sich nicht öffnen: ${fehler.message}`);
  }
}

// ---------- Aufnehmen ab Lesekopf ----------
// Während der Aufnahme sieht man sie schon wachsen (Spalte für Spalte analysiert); klingen tut sie
// erst danach, sonst hört das Mikrofon sich selbst. Am Ende wird sie aus dem sauber umgerechneten
// Ton noch einmal ganz analysiert.

let aufnahme = null; // { ebene, stoppe } solange aufgenommen wird
let aufnahmeZaehler = 1;

async function starteOderStoppeAufnahme() {
  if (aufnahme) return stoppeAufnahme();
  const { leinwand } = z;
  const start = einfuegeSpalte();
  const platz = leinwand.spalten - start;
  const e = {
    id: `e${naechsteId++}`,
    art: "ton",
    name: `Aufnahme ${aufnahmeZaehler++}`,
    gain: 0,
    stumm: false,
    filter: null,
    start,
    aufnahme: true,
    ...leereTonDaten(platz, leinwand.faecher),
  };
  const analyse = baueAnalyse(leinwand);
  const puffer = new Float32Array(platz * leinwand.sprung); // mehr passt nicht auf die Leinwand
  let laenge = 0;
  let fertig = 0; // so viele Spalten sind schon analysiert

  aufnahme = { ebene: e, stoppe: null };
  aufnehmen.textContent = "Aufnahme stoppen";
  z.ebenen.push(e);
  z.aktiv = e.id;
  zeigeEbenen();

  try {
    const mikrofon = await starteAufnahme((stueck) => {
      if (!aufnahme) return;
      const passt = Math.min(stueck.length, puffer.length - laenge);
      puffer.set(stueck.subarray(0, passt), laenge);
      laenge += passt;
      const bis = Math.min(analyse.fertigBis(laenge, false), platz - 1);
      if (bis >= fertig) {
        analyse.spaltenRechnen(e, puffer, laenge, fertig, bis);
        mischeBald(start + fertig, start + bis);
        fertig = bis + 1;
      }
      if (laenge >= puffer.length) stoppeAufnahme(); // Leinwand zu Ende
    });
    aufnahme.stoppe = mikrofon.stoppe;
    zeige("Aufnahme läuft. Mit Kopfhörern kannst du dabei abspielen, ohne dass das Mikrofon es hört.");
  } catch (fehler) {
    z.ebenen = z.ebenen.filter((x) => x !== e);
    z.aktiv = "mal";
    aufnahme = null;
    aufnehmen.textContent = "Aufnehmen";
    zeigeEbenen();
    mischeBald();
    zeige(fehler.message);
  }
}

async function stoppeAufnahme() {
  const laufend = aufnahme;
  const stoppe = laufend?.stoppe;
  if (!stoppe) return;
  laufend.stoppe = null; // nicht zweimal
  aufnehmen.disabled = true;
  const { ebene: e } = laufend;
  let samples = new Float32Array(0);
  try {
    samples = await stoppe();
  } catch (fehler) {
    zeige(`Aufnahme: ${fehler.message}`);
  }
  // zu lang für die Leinwand: abschneiden
  samples = samples.subarray(0, (z.leinwand.spalten - e.start) * z.leinwand.sprung);
  z.ebenen = z.ebenen.filter((x) => x !== e);
  aufnahme = null;
  aufnehmen.textContent = "Aufnehmen";
  aufnehmen.disabled = false;
  if (samples.length) {
    delete e.aufnahme;
    Object.assign(e, analysiere(samples, z.leinwand, z.leinwand.spalten - e.start));
    fuegeEin(e);
    zeige("");
  } else {
    z.aktiv = "mal";
    zeigeEbenen();
    mischeBald();
  }
}

// ---------- Lesekopf und Abspielen ----------

function setzeLesekopf(spalte) {
  z.pos = Math.min(Math.max(spalte, 0), z.leinwand.spalten);
  klang.position(z.pos);
  zeichneBald();
}

let ziehtKopf = false;
function beiPosition(spalte) {
  if (ziehtKopf) return;
  z.pos = spalte;
  zeichneBald();
}

function beiEnde(spalte) {
  z.pos = spalte;
  z.laeuft = false;
  abspielen.textContent = "Abspielen";
  zeichneBald();
}

async function spielOderHalte() {
  if (z.laeuft) {
    klang.halte();
    z.laeuft = false;
    abspielen.textContent = "Abspielen";
    return;
  }
  // am Ende angekommen (ohne Schleife): von vorn, sonst wäre es sofort wieder vorbei
  const amEnde = einstellung.rueckwaerts ? z.pos <= 0 : z.pos >= z.leinwand.spalten;
  if (amEnde && !z.halten) setzeLesekopf(einstellung.rueckwaerts ? z.leinwand.spalten : 0);
  z.laeuft = true;
  abspielen.textContent = "Anhalten";
  try {
    await klang.spiele();
  } catch (fehler) {
    zeige(`Ton geht nicht: ${fehler.message}`);
    z.laeuft = false;
    abspielen.textContent = "Abspielen";
  }
}

function schalteFesthalten() {
  z.halten = !z.halten;
  festhalten.setAttribute("aria-pressed", String(z.halten));
  sendeEinstellung();
}

// ---------- Maus-Info ----------

richteMausInfoEin(stapel, hole("mausInfo"), (x, y) => {
  if (!z.leinwand) return null;
  const a = ansicht();
  const { spalten, faecher, fachBreite, sekundenProSpalte } = z.leinwand;
  const spalte = Math.min(Math.floor(x * spalten), spalten - 1);
  const f = anteilZuFrequenz(1 - y, a.tief, a.hoch); // y kommt von oben
  const fach = frequenzZuFach(f, z.leinwand);
  const amp = z.mischung[spalte * faecher + fach];
  const pegel = amp > 0 ? `${Math.round(20 * Math.log10(amp))} dB` : "still";
  // Fach: welches Fach dort liegt und welche Frequenz es wirklich spielt
  // zwei Zeilen (\n, im CSS white-space: pre), sonst ist das Schild am Handy breiter als das Bild
  return `${zeigeZeit(spalte * sekundenProSpalte)} · ${zeigeFrequenz(f)} ${notenName(f)}\nFach ${fach} = ${zeigeFrequenz(fach * fachBreite)} · ${pegel}`;
});

// ---------- WAV, Bild, Video ----------

// der ganze Ton einmal durch, wie eingestellt (Tempo, Richtung, Festhalten, Phase zufällig, Lautstärke)
async function rechneTon() {
  const { leinwand } = z;
  const steht = z.halten || einstellung.tempo === 0;
  let sekunden = steht ? leinwand.dauer : leinwand.dauer / einstellung.tempo + leinwand.fenster / RATE;
  sekunden = Math.min(sekunden, MAX_WAV);
  const zustand = holeZustand();
  zustand.einstellung.schleife = false;
  zustand.pos = steht ? z.pos : einstellung.rueckwaerts ? leinwand.spalten : 0;
  return rendere(zustand, sekunden);
}

hole("wavSpeichern").addEventListener("click", async (event) => {
  const knopf = event.currentTarget;
  knopf.disabled = true;
  knopf.textContent = "Rechne …";
  try {
    const puffer = await rechneTon();
    ladeHerunter(zuWav(puffer), `spektral-malen-${zeitstempel()}.wav`);
  } catch (fehler) {
    zeige(`WAV ging nicht: ${fehler.message}`);
  } finally {
    knopf.disabled = false;
    knopf.textContent = "WAV speichern";
  }
});

// Bild und Lesekopf zusammen auf einem Canvas (für Bild speichern, Live und Video)
const gesamt = document.createElement("canvas");
const gesamtCtx = gesamt.getContext("2d");

function zeichneGesamt(pos) {
  mischeJetzt();
  gpu.zeichne(ansicht());
  zeichneKopf(pos / z.leinwand.spalten, false);
  gesamt.width = bild.width;
  gesamt.height = bild.height;
  gesamtCtx.drawImage(bild, 0, 0); // direkt nach dem Zeichnen, sonst ist WebGL schon leer
  gesamtCtx.drawImage(kopfCanvas, 0, 0, gesamt.width, gesamt.height);
  return gesamt;
}

// Lesekopf zur Zeit t (Sekunden) im Video: wie in der WAV einmal von vorn bis hinten (oder rückwärts)
let videoStart = 0;
function posImVideo(t) {
  const { spalten, sekundenProSpalte } = z.leinwand;
  if (z.halten || einstellung.tempo === 0) return videoStart;
  const weit = Math.min((t * einstellung.tempo) / sekundenProSpalte, spalten);
  return einstellung.rueckwaerts ? spalten - weit : weit;
}

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name: "spektral-malen",
  anzeige: () => zeichneGesamt(z.pos),
  endbild: (t) => zeichneGesamt(posImVideo(t)),
  render: {
    start: () => {
      if (z.laeuft) spielOderHalte(); // anhalten, das Video bestimmt den Lesekopf
      videoStart = z.pos;
    },
    bild: () => {},
    vorschau: () => {},
    ende: () => zeichneBald(),
    merke: () => {
      const pos = z.pos;
      return () => setzeLesekopf(pos);
    },
  },
  ton: () => rechneTon(), // der Ton zum Video (ein Promise, /lib/export.js wartet darauf)
  liveTon: () => klang.liveTon(),
});

// ---------- Speichern und Öffnen ----------

hole("speichern").addEventListener("click", async () => {
  if (aufnahme) return zeige("Erst die Aufnahme stoppen.");
  const { leinwand } = z;
  const kopfDaten = {
    version: 1,
    spalten: leinwand.spalten,
    fenster: leinwand.fenster,
    einstellung: { ...einstellung },
    aktiv: z.aktiv,
    pos: z.pos,
    naechsteId,
    // werte eines Bildes nicht speichern, die werden aus dem Bild neu gerechnet
    ebenen: z.ebenen.map((e) => (e.art === "bild" ? { ...e, werte: undefined } : e)),
  };
  try {
    ladeHerunter(await packe(kopfDaten), `spektral-malen-${zeitstempel()}.spektral`);
  } catch (fehler) {
    zeige(`Speichern ging nicht: ${fehler.message}`);
  }
});

hole("oeffnen").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  event.target.value = ""; // dieselbe Datei noch einmal wählen soll auch gehen
  if (!datei) return;
  if (aufnahme) return zeige("Erst die Aufnahme stoppen.");
  try {
    const p = await entpacke(datei);
    if (z.laeuft) spielOderHalte();
    setzeAlle({ ...p.einstellung, dauer: Math.round((p.spalten * p.fenster) / 4 / RATE), fenster: String(p.fenster) });
    const leinwand = baueLeinwand({ dauer: (p.spalten * p.fenster) / 4 / RATE, fenster: p.fenster });
    const mal = p.ebenen.find((e) => e.art === "mal");
    setzeLeinwand(leinwand, mal.werte);
    Object.assign(z.ebenen[0], { ...mal, werte: z.ebenen[0].werte });
    klang.eigenschaften("mal", { gain: mal.gain, stumm: mal.stumm });
    for (const e of p.ebenen) {
      if (e.art === "mal") continue;
      if (e.art === "bild") rastere(e, leinwand);
      z.ebenen.push(e);
      if (e.art === "ton") gpu.neueFlaeche(e.id, e.spalten, e.maske);
      klang.ebene(e);
    }
    naechsteId = p.naechsteId;
    z.aktiv = finde(p.aktiv) ? p.aktiv : "mal";
    setzeLesekopf(p.pos);
    zeigeEbenen();
    mischeBald();
    zeige("");
  } catch (fehler) {
    zeige(`Öffnen ging nicht: ${fehler.message}`);
  }
});

// ---------- Knöpfe und Tasten ----------

hole("neueLeinwand").addEventListener("click", neueLeinwand);
hole("rueckgaengig").addEventListener("click", nimmZurueck);
hole("auswahlStille").addEventListener("click", () => werkzeuge.auswahlStille());
abspielen.addEventListener("click", spielOderHalte);
festhalten.addEventListener("click", schalteFesthalten);
aufnehmen.addEventListener("click", starteOderStoppeAufnahme);
hole("anfang").addEventListener("click", () => setzeLesekopf(einstellung.rueckwaerts ? z.leinwand.spalten : 0));

// Datei-Knöpfe: gleiche Datei zweimal hintereinander soll auch gehen (value leeren)
function beiDatei(id, aktion) {
  hole(id).addEventListener("change", (event) => {
    const datei = event.target.files[0];
    event.target.value = "";
    if (datei) aktion(datei);
  });
}
beiDatei("bildDatei", bildEinfuegen);
beiDatei("tonDatei", tonEinfuegen);

document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea, button")) return; // dort gehören die Tasten dem Feld
  const taste = event.key.toLowerCase();
  if (event.code === "Space") {
    event.preventDefault(); // sonst scrollt die Seite
    spielOderHalte();
  } else if ((event.ctrlKey || event.metaKey) && taste === "z") {
    event.preventDefault();
    nimmZurueck();
  } else if (taste === "f" && !event.ctrlKey && !event.metaKey) {
    schalteFesthalten();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    werkzeuge.auswahlStille();
  } else if (event.key === "Escape") {
    werkzeuge.auswahlWeg();
  }
});

// ---------- Start ----------

try {
  gpu = richteGpuEin(bild);
  gpu.waehleFarben(einstellung.farbskala);
  werkzeuge = richteWerkzeugeEin({
    bild,
    stapel,
    gpu,
    klang,
    einstellung,
    z,
    ansicht,
    aktiveEbene,
    mischeBald,
    zeichneBald,
    merke,
    zeige,
    aendere,
    setzeLesekopf: (spalte) => {
      ziehtKopf = true; // beim Ziehen bestimmt die Hand, nicht der Klang
      setzeLesekopf(spalte);
    },
  });
  stapel.addEventListener("pointerup", () => (ziehtKopf = false));
  stapel.addEventListener("pointercancel", () => (ziehtKopf = false));
  new ResizeObserver(passeGroesseAn).observe(bild);
  sendeEinstellung();
  neueLeinwand();
} catch (fehler) {
  zeige(fehler.message);
}
