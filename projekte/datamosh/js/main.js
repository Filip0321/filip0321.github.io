// Datamosh: hier wird alles verbunden.
//   quellen.js            Clips öffnen: Videos (über /lib/video-quelle.js, Mediabunny) und Standbilder
//   kodieren.js           jeden Clip neu kodieren (VP8, Keyframe nur am Anfang), gleichmäßige Bildrate
//   schnitt.js            Clips auf Spuren -> Grundfolge (wer liegt wann oben, wo sind Schnitte)
//   folge.js              welche Pakete in welcher Reihenfolge: hier passiert der Mosh
//   dekoder.js            Pakete -> Bilder (VideoDecoder)
//   zeitleiste.js         Schnitt und Ergebnis (Bilder, I, P) zum Ansehen und Bearbeiten
//   ton.js                Ton für das gerenderte Video
//
// Zwei Arten zu arbeiten, die dasselbe ergeben:
//   live    abspielen und dabei springen (S), halten (H gedrückt halten) und heilen (K). Jeder Griff wird
//           als Ereignis gemerkt, mit der Bildnummer.
//   Liste   Ereignisse von Hand eintragen oder die gemerkten ändern und löschen.
// Der Export spielt genau diese Ereignisse noch einmal ab, Bild für Bild: was du live gemacht hast,
// kommt genau so ins Video.

import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin, neueAufnahme, ladeHerunter, zeitstempel, warte, schneideTon } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { oeffneClip } from "./quellen.js";
import { bereite } from "./kodieren.js";
import { lege, baueGrund } from "./schnitt.js";
import { baueFolge, quelleBei, paketVon, pFramesAb } from "./folge.js";
import { baueTon } from "./ton.js";
import { richteDekoderEin } from "./dekoder.js";
import { richteZeitleisteEin } from "./zeitleiste.js";
import { helligkeit } from "/lib/yuv.js";

const bild = hole("bild");
const ctx = bild.getContext("2d");
const stapel = hole("stapel");
const meldung = hole("meldung");
const fortschritt = hole("fortschritt");
const abspielen = hole("abspielen");

let clips = []; // geöffnete Videos, in dieser Reihenfolge hintereinander
let daten = null; // Ergebnis von bereite()
let ereignisse = []; // { art: "sprung" | "halten" | "heilen" | "wiederholen", bei, nach | dauer | liste, mal }
let fluechtig = []; // live ohne Merken: gilt nur bis „Von vorn“, kommt nicht in die Liste und nicht in den Export
let folge = [];
let herkunft = []; // pro Bild der Folge: woher es kommt (folge.js), für Zeitleiste und Ton
let grund = []; // die Grundfolge aus dem Schnitt (schnitt.js)
const iWeg = new Set(); // Schnitte, an denen das I-Frame gelöscht ist (schnitt.js: schnittName)
const iBleibt = new Set(); // Schnitte, an denen es bleibt, auch wenn „an Schnitten moshen“ an ist
let n = 0; // Bild der Folge, das als nächstes kommt
let laeuft = false;
let haelt = null; // das Halten-Ereignis, solange H gedrückt ist
let dekoder = null;
let schleife = Promise.resolve(); // die laufende Abspielschleife (zum Abwarten beim Anhalten)

const { einstellung, setze } = richteReglerEin({
  beiAenderung: () => neueFolge(),
  extra: {},
});
let zeitleiste = null; // weiter unten, braucht die Regler schon
// wer im System „Bewegung reduzieren“ eingestellt hat, bekommt das Flackern gleich gedämpft
if (matchMedia("(prefers-reduced-motion: reduce)").matches) setze("ruhe", 0.6);

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}

// Protokoll: jeder Schritt mit Uhrzeit, auf der Seite sichtbar (und in der Konsole). Hängt etwas, sieht man,
// welcher Schritt der letzte war.
const protokollFeld = hole("protokoll");
const start = performance.now();
function protokoll(text) {
  const zeit = ((performance.now() - start) / 1000).toFixed(2).padStart(7);
  protokollFeld.textContent += `${zeit} s  ${text}\n`;
  protokollFeld.scrollTop = protokollFeld.scrollHeight;
  console.info("[datamosh]", text);
}
hole("protokollKopieren").addEventListener("click", () => navigator.clipboard?.writeText(protokollFeld.textContent));
protokoll(`Browser: ${navigator.userAgent}`);
protokoll(`WebCodecs: VideoDecoder ${typeof VideoDecoder !== "undefined" ? "ja" : "NEIN"}, VideoEncoder ${typeof VideoEncoder !== "undefined" ? "ja" : "NEIN"}`);

function zeigeFortschritt(text) {
  fortschritt.textContent = text ?? "";
  fortschritt.hidden = !text;
}

// an Schnitten moshen: 0 = aus, 1 bis 120 Bilder lang, ganz rechts (121) = nie heilen
const schnittMosh = () => (einstellung.schnitte > 120 ? Infinity : einstellung.schnitte);

// gibt { folge, herkunft } zurück
function baue(mitFluechtigen = true) {
  const alle = mitFluechtigen ? [...ereignisse, ...fluechtig] : ereignisse;
  return baueFolge(daten, grund, alle, { schnitteMoshen: schnittMosh(), heilenNach: einstellung.heilenNach, iWeg, iBleibt });
}

// ein Eingriff: gemerkt (Liste, Export) oder nur für jetzt (live ohne Merken)
function greifeEin(e) {
  (einstellung.merken ? ereignisse : fluechtig).push(e);
  neueFolge();
  return e;
}

// ordnen: Spuren neu durchnummerieren (nicht während ein Clip gezogen wird, sonst springt er)
function neueFolge(ordnen = true) {
  if (!daten) return;
  if (ordnen) lege(clips);
  grund = baueGrund(clips, daten.anfaenge);
  ({ folge, herkunft } = baue());
  zeigeEreignisse();
  zeigeStelle();
  zeitleiste.zeige({ folge, herkunft, daten, clips, grund });
}

function zeigeStelle() {
  const q = daten && quelleBei(daten, folge, Math.max(0, n - 1));
  hole("stelle").textContent = q
    ? `Bild ${Math.max(0, n - 1)} von ${folge.length} · Quelle: Clip ${q.clip + 1}, Bild ${q.bild}${q.geheilt ? " (geheilt)" : ""}`
    : "";
}

// ---------- Clips ----------

function zeigeClips() {
  const liste = hole("clipListe");
  liste.replaceChildren();
  clips.forEach((c, i) => {
    const zeile = document.createElement("li");
    const name = document.createElement("span");
    // Bilder: nach dem Vorbereiten genau gezählt (Pakete des Clips), vorher geschätzt aus Dauer mal Bildrate
    const fps = daten?.fps ?? 30;
    const bilder = c.bilderGesamt ?? `etwa ${Math.round(c.dauer * fps)}`;
    name.textContent = `${i + 1}. ${c.name} (${c.art === "bild" ? "Bild" : `${c.dauer.toFixed(1).replace(".", ",")} s`}, ${bilder} Bilder)`;
    zeile.append(name);
    if (c.art === "bild") {
      // ein Standbild steht so lange, wie hier eingestellt (ändern kodiert nur dieses Bild neu)
      const feld = document.createElement("input");
      feld.type = "number";
      feld.min = "0.04";
      feld.step = "0.5";
      feld.value = c.sekunden;
      feld.title = "Sekunden";
      feld.className = "kurz";
      feld.addEventListener("change", () => {
        c.sekunden = Math.max(1 / fps, Number(feld.value) || 1);
        c.laenge = null; // wieder ganz
        veraltet();
      });
      const s = document.createElement("span");
      s.textContent = "s";
      s.className = "einheit";
      zeile.append(feld, s);
    }
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "×";
    weg.title = "entfernen";
    weg.addEventListener("click", () => {
      clips.splice(i, 1);
      veraltet();
    });
    zeile.append(weg);
    liste.append(zeile);
  });
}

// Clips geändert: neu vorbereiten. Waren sie schon vorbereitet, gleich von selbst (kodiert wird nur, was neu ist)
function veraltet() {
  halte();
  zeigeClips();
  hole("vorbereiten").disabled = !clips.length;
  if (daten && clips.length) return vorbereiten();
  daten = null;
  abspielen.disabled = true;
  zeige(clips.length ? "Clips geändert: „Vorbereiten“ drücken." : "");
}

hole("dateien").addEventListener("change", async (event) => {
  const dateien = [...event.target.files];
  event.target.value = "";
  for (const datei of dateien) {
    try {
      clips.push(await oeffneClip(datei));
    } catch (fehler) {
      zeige(`${datei.name}: ${fehler.message}`);
    }
  }
  veraltet();
});

// Paketnummern in den Eingriffen gehören zu den alten Daten. Nach dem neuen Vorbereiten (ein Clip fehlt,
// ein Bild ist länger …) stehen die Pakete woanders: über Clip-Id und Bild im Clip umrechnen.
function ordneUm(alt) {
  const index = new Map(clips.map((c, i) => [c.id, i]));
  const N = daten.pakete.length;
  const um = (e) => {
    const schl = e >= alt.N;
    const p = alt.pakete[schl ? e - alt.N : e];
    const ci = p && index.get(alt.ids[p.clip]);
    if (ci === undefined || p.bild >= clips[ci].bilderGesamt) return null; // Clip weg oder kürzer
    const neu = daten.anfaenge[ci] + p.bild;
    return schl ? neu + N : neu;
  };
  for (const e of ereignisse) {
    if (e.art === "sprung") e.nach = e.nach >= alt.N ? N : um(e.nach) ?? N;
    if (e.liste) e.liste = e.liste.map(um).filter((x) => x !== null);
  }
}

let bereitetVor = null; // läuft gerade: das Versprechen; kommt eine Änderung dazu, wird danach noch einmal vorbereitet
let nochmal = false;
async function vorbereiten() {
  if (!clips.length) return;
  if (bereitetVor) {
    nochmal = true;
    return bereitetVor;
  }
  bereitetVor = (async () => {
    do {
      nochmal = false;
      await einmalVorbereiten();
    } while (nochmal);
  })();
  try {
    await bereitetVor;
  } finally {
    bereitetVor = null;
  }
}
hole("vorbereiten").addEventListener("click", vorbereiten);

async function einmalVorbereiten() {
  await halte();
  hole("vorbereiten").disabled = true;
  const alt = daten && { N: daten.pakete.length, pakete: daten.pakete, ids: daten.ids };
  try {
    const wie = { breite: Number(einstellung.breite), bitrate: einstellung.bitrate * 1e6, wild: einstellung.wild, software: daten?.software ?? false, beiFortschritt: zeigeFortschritt };
    protokoll(`Vorbereiten: ${clips.length} Clips, Breite ${wie.breite}`);
    daten = await bereite(clips, wie);
    protokoll(`kodiert: ${daten.pakete.length} Bilder ${daten.breite}×${daten.hoehe} bei ${daten.fps} fps, Zeitschichten ${daten.zeitschichten ? "ja" : "nein"}, Helligkeit der Quelle ${daten.quellHelligkeit.map((h) => h.toFixed(0)).join(", ")}`);
    // schon die Quelle schwarz? Dann liefert der Video-Dekoder der Grafikkarte schwarze Bilder: noch einmal in Software
    // (und wenn das auch schwarz ist: der CPU-Weg, ganz ohne drawImage(VideoFrame))
    for (const [weg, name] of [[true, "Software-Dekoder"], ["cpu", "CPU-Weg"]]) {
      if (daten.quellHelligkeit.some((h) => h >= 2) || daten.software === "cpu") break;
      protokoll(`Quelle schwarz – noch einmal mit ${name}`);
      const neu = await bereite(clips, { ...wie, software: weg });
      protokoll(`${name}: Helligkeit ${neu.quellHelligkeit.map((h) => h.toFixed(0)).join(", ")}`);
      if (neu.quellHelligkeit.some((h) => h >= 2)) daten = neu;
    }
    daten.ids = clips.map((c) => c.id);
    if (alt) ordneUm(alt);
    bild.width = daten.breite;
    bild.height = daten.hoehe;
    stapel.style.setProperty("--verhaeltnis", `${daten.breite} / ${daten.hoehe}`);
    dekoder?.schliesse();
    dekoder = richteDekoderEin(daten, dekodiertesBild, protokoll);
    zeigeClips(); // jetzt mit der genauen Zahl der Bilder
    n = 0;
    neueFolge();
    abspielen.disabled = false;
    zeige(daten.zeitschichten || einstellung.wild ? "" : "Dein Browser kodiert ohne Zeitschichten: jeder Sprung wird zu Rauschen statt zu wandernden Blöcken (siehe LIESMICH).");
    await zeigeBild(0); // das erste Bild
    zeitleiste.markiere(0);
    if (!alt) await pruefeSchwarz();
  } catch (fehler) {
    console.error(fehler);
    protokoll(`Vorbereiten ging nicht: ${fehler.message}`);
    zeige(`Vorbereiten ging nicht: ${fehler.message}`);
  } finally {
    hole("vorbereiten").disabled = false;
    zeigeFortschritt(null);
  }
}

// ---------- Abspielen ----------

// ein dekodiertes Bild zeichnen. „Beruhigen“ legt es nur halb deckend über das vorige: das Flackern
// wird weicher, harte Wechsel werden zu Überblendungen (gegen den epileptischen Eindruck, siehe LIESMICH)
function zeichne(c, b) {
  c.globalAlpha = 1 - einstellung.ruhe;
  c.drawImage(b, 0, 0, c.canvas.width, c.canvas.height);
  c.globalAlpha = 1;
}

// Wohin der Dekoder zeichnet, sagt jedes Paket selbst (dekoder.schicke(paket, ziel)), weil jetzt mehrere
// Pakete gleichzeitig unterwegs sind:
//   null    sichtbar, ins Bild (mit „Beruhigen“)
//   false   nirgendwohin (beim Spulen: nur die Bilder davor müssen durch den Dekoder)
//   Canvas  ganz hinein, ohne „Beruhigen“ (Vorrat beim Abspielen und Rendern; beruhigt wird beim Zeigen)
function dekodiertesBild(b, ziel) {
  if (ziel === false) return;
  if (!ziel) zeichne(ctx, b);
  else ziel.getContext("2d").drawImage(b, 0, 0, ziel.width, ziel.height);
}

// Bild n der Folge zeigen. Weil jedes Bild auf dem vorigen aufbaut, geht das nur der Reihe nach:
// wer zurückspringt, muss von vorn dekodieren (dafür ist es schnell genug)
// Die Pakete gehen voraus, höchstens VORAUS auf einmal (sonst staut sich Speicher im Dekoder)
const VORAUS = 8;
async function zeigeBild(ziel) {
  if (ziel < n || n === 0 || dekoder.gespuelt()) {
    dekoder.neu();
    n = 0;
  }
  const unterwegs = [];
  ziel = Math.min(ziel, folge.length - 1);
  while (n <= ziel) {
    unterwegs.push(dekoder.schicke(paketVon(daten, folge[n]), n === ziel ? null : false));
    n++;
    if (unterwegs.length > VORAUS) await dekoder.warteAuf(unterwegs.shift());
  }
  for (const u of unterwegs) await dekoder.warteAuf(u);
  zeigeStelle();
}

// Nach dem Vorbereiten: Ist das erste Bild schwarz, obwohl die Quelle es nicht ist, zeichnet die Grafikkarte
// die VideoFrames schwarz. Dann der CPU-Weg (dekoder.js), und wenn das auch nicht hilft, ein anderer Dekoder.
async function pruefeSchwarz() {
  const quelle = daten.quellHelligkeit[0] ?? 0;
  let h = helligkeit(bild);
  protokoll(`erstes Bild: Helligkeit ${h.toFixed(0)} (Quelle ${quelle.toFixed(0)})`);
  if (quelle < 8 || h >= 2) return;
  for (const versuch of [{ cpu: true }, { cpu: true, hardware: "no-preference" }, { cpu: false, hardware: "no-preference" }]) {
    dekoder.stelleUm(versuch);
    n = 0;
    await zeigeBild(0);
    h = helligkeit(bild);
    protokoll(`  damit: Helligkeit ${h.toFixed(0)}`);
    if (h >= 2) return;
  }
  zeige("Das dekodierte Bild bleibt schwarz. Bitte das Protokoll (unten) kopieren und schicken.");
}

function spiele() {
  if (!daten || laeuft) return;
  schleife = spieleSchleife();
}

// Abspielen mit Vorrat: Der Dekoder läuft bis zu VORRAT Bilder voraus und legt sie in kleine Canvas;
// gezeigt wird im festen Takt. Braucht ein Bild länger (ein großer Keyframe, ein voller Rechner), zehrt die
// Anzeige vom Vorrat, statt zu stocken. Preis: Eingriffe wirken ein paar Bilder später (bei 3 etwa 0,1 s).
const VORRAT = 4; // eins mehr als früher: manche Dekoder geben ein Bild erst nach dem nächsten Paket heraus
const vorrat = [];

async function spieleSchleife() {
  if (n >= folge.length) {
    n = 0;
    fluechtig = []; // von vorn: die flüchtigen Eingriffe sind vorbei
    ({ folge, herkunft } = baue());
    dekoder.neu();
  }
  laeuft = true;
  abspielen.textContent = "Anhalten";
  const dauer = 1000 / daten.fps;
  while (vorrat.length < VORRAT + 1) vorrat.push(document.createElement("canvas"));
  for (const c of vorrat) {
    c.width = bild.width;
    c.height = bild.height;
  }
  // nach dem Spülen (dekoder.js) braucht der Dekoder einen Keyframe: alles bis hierher noch einmal durch,
  // ohne zu zeigen und ohne auf die letzten Bilder zu warten (die kommen, sobald es weitergeht)
  if (dekoder.gespuelt() && n > 0) {
    const bis = n;
    dekoder.neu();
    const unterwegs = [];
    for (n = 0; n < bis; n++) {
      unterwegs.push(dekoder.schicke(paketVon(daten, folge[n]), false));
      if (unterwegs.length > VORAUS) await dekoder.warteAuf(unterwegs.shift());
    }
  }
  let gezeigt = n; // das nächste Bild, das auf den Bildschirm kommt
  let naechstes = performance.now();
  const bilder = []; // pro Bild der Folge: das Versprechen des Dekoders, dass es im Vorrat liegt
  try {
    while (laeuft && gezeigt < folge.length) {
      // vorausschicken, solange der Vorrat nicht voll ist
      while (laeuft && n < folge.length && n - gezeigt < VORRAT) {
        if (haelt) {
          // H gedrückt: das Halten wird jedes Bild länger, die Folge neu gebaut
          haelt.dauer++;
          ({ folge, herkunft } = baue());
        }
        bilder[n] = dekoder.schicke(paketVon(daten, folge[n]), vorrat[n % vorrat.length]);
        n++;
      }
      // zeigen, wenn es Zeit ist
      const warten = naechstes - performance.now();
      if (warten > 0) await new Promise((weiter) => setTimeout(weiter, warten));
      if (gezeigt < n) {
        if (!(await dekoder.warteAuf(bilder[gezeigt]))) break; // false: der Dekoder wurde neu gestartet (Anhalten)
        bilder[gezeigt] = null;
        zeichne(ctx, vorrat[gezeigt % vorrat.length]);
        gezeigt++;
        zeitleiste?.markiere(gezeigt - 1);
        if (gezeigt % 5 === 0) zeigeStelle();
      }
      naechstes = Math.max(naechstes + dauer, performance.now() - dauer); // nach einer langen Pause nicht aufholen
    }
  } catch (fehler) {
    console.error(fehler);
    protokoll(`Abspielen: ${fehler.message}`);
    zeige(`Der Dekoder ist ausgestiegen (${fehler.message}). Von vorn abspielen hilft meistens.`);
    dekoder.neu();
    n = 0;
  } finally {
    laeuft = false;
    haelt = null;
    abspielen.textContent = "Abspielen";
    zeigeEreignisse();
    zeigeStelle();
  }
}

// anhalten und warten, bis die Schleife wirklich steht (sonst dekodieren zwei gleichzeitig)
// Hängt sie (früher: ein Dekoder, der ein Bild nie herausgibt), wird der Dekoder nach 1,5 s neu gestartet.
// Dabei bekommt jedes offene Bild „false“, und die Schleife hört auf. Vorher wartete „Video rendern“ hier ewig.
async function halte() {
  laeuft = false;
  const zeit = (ms) => new Promise((r) => setTimeout(() => r("zeit"), ms));
  if ((await Promise.race([schleife, zeit(1500)])) !== "zeit") return;
  protokoll("Abspielschleife hing – Dekoder neu gestartet");
  dekoder?.neu();
  n = 0;
  if ((await Promise.race([schleife.catch(() => {}), zeit(1500)])) === "zeit") protokoll("Abspielschleife hängt immer noch");
  schleife = Promise.resolve();
}

abspielen.addEventListener("click", () => (laeuft ? halte() : spiele()));
hole("vonVorn").addEventListener("click", async () => {
  await halte();
  fluechtig = [];
  if (daten) {
    ({ folge, herkunft } = baue());
    await zeigeBild(0);
    zeitleiste.markiere(0);
  }
});

// ---------- live eingreifen: springen und halten ----------

// wohin ein Sprung geht
function sprungZiel() {
  const q = quelleBei(daten, folge, Math.max(0, n - 1));
  const { anfaenge, pakete } = daten;
  const naechsterClip = (q.clip + 1) % anfaenge.length;
  if (einstellung.sprungArt === "zufall") return Math.floor(Math.random() * pakete.length);
  if (einstellung.sprungArt === "gleich") {
    // dieselbe Stelle im nächsten Clip (oder dessen Ende, wenn er kürzer ist)
    const ende = naechsterClip + 1 < anfaenge.length ? anfaenge[naechsterClip + 1] - 1 : pakete.length - 1;
    return Math.min(anfaenge[naechsterClip] + q.bild, ende);
  }
  return anfaenge[naechsterClip] + 1; // Anfang des nächsten Clips, ohne seinen Keyframe
}

function springe() {
  if (!daten) return;
  greifeEin({ art: "sprung", bei: n, nach: sprungZiel() });
}

function heile() {
  if (!daten) return;
  greifeEin({ art: "heilen", bei: n });
}

function halteFest(an) {
  if (!daten) return;
  if (an && !haelt) {
    haelt = { art: "halten", bei: n, dauer: 0 };
    (einstellung.merken ? ereignisse : fluechtig).push(haelt);
  } else if (!an && haelt) {
    if (!haelt.dauer) {
      // nur kurz getippt
      ereignisse = ereignisse.filter((e) => e !== haelt);
      fluechtig = fluechtig.filter((e) => e !== haelt);
    }
    haelt = null;
    neueFolge();
  }
}

hole("springen").addEventListener("click", springe);
hole("heilen").addEventListener("click", heile);
const haltenKnopf = hole("halten");
haltenKnopf.addEventListener("pointerdown", () => halteFest(true));
for (const ende of ["pointerup", "pointerleave", "pointercancel"]) haltenKnopf.addEventListener(ende, () => halteFest(false));

document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea")) return;
  const taste = event.key.toLowerCase();
  if (event.code === "Space") {
    event.preventDefault(); // sonst „klickt“ die Leertaste zusätzlich den Knopf, der gerade den Fokus hat
    if (!event.repeat) laeuft ? halte() : spiele();
    return;
  }
  // Zeitleiste: Pfeile, Pos1, Ende, A, B, Esc (Pfeile dürfen wiederholen, wenn man sie gedrückt hält)
  if (!laeuft && zeitleiste.taste(event)) {
    event.preventDefault();
    return;
  }
  if (event.key === "Delete" && zeitleiste.auswahl()) {
    hole("auswahlWeg").click();
    return;
  }
  if (event.repeat) return;
  if (taste === "s") springe();
  else if (taste === "k") heile();
  else if (taste === "h") halteFest(true);
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") event.preventDefault();
  if (event.key.toLowerCase() === "h") halteFest(false);
});

// ---------- Ereignisse als Liste ----------

function zeigeEreignisse() {
  const liste = hole("ereignisListe");
  liste.replaceChildren();
  [...ereignisse].sort((a, b) => a.bei - b.bei).forEach((e) => {
    const zeile = document.createElement("li");
    const text = document.createElement("span");
    const q = daten && e.art === "sprung" ? daten.pakete[e.nach] : null;
    text.textContent = {
      sprung: () => (q ? `Bild ${e.bei}: Sprung nach Clip ${q.clip + 1}, Bild ${q.bild}` : `Bild ${e.bei}: Rest gelöscht`),
      wiederholen: () => `Bild ${e.bei}: ${e.liste.length} Bilder ${e.mal}× wiederholt`,
      ersetzen: () =>
        ({
          löschen: `Bild ${e.bei}: ${e.weg} Bilder gelöscht`,
          wiederholen: `Bild ${e.bei}: ${e.liste.length} Bilder eingesetzt (wiederholt)`,
          umkehren: `Bild ${e.bei}: ${e.weg} Bilder rückwärts`,
          mischen: `Bild ${e.bei}: ${e.weg} Bilder durch P-Frames von Clip ${e.vonClip + 1} ersetzt`,
        })[e.wie] ?? `Bild ${e.bei}: ${e.weg} Bilder ersetzt durch ${e.liste.length}`,
      halten: () => `Bild ${e.bei}: halten, ${e.dauer} Bilder`,
      heilen: () => `Bild ${e.bei}: heilen`,
    }[e.art]();
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "×";
    weg.title = "löschen";
    weg.addEventListener("click", () => {
      ereignisse = ereignisse.filter((x) => x !== e);
      if (e.um) verschiebeEreignisse(e.ab, -e.um); // was dahinter verschoben wurde, rückt zurück
      neueFolge();
    });
    zeile.append(text, weg);
    liste.append(zeile);
  });
  hole("ereignisInfo").textContent = ereignisse.length ? `${ereignisse.length} Eingriffe, ${folge.length} Bilder` : "noch keine Eingriffe";
}

hole("ereignisDazu").addEventListener("click", () => {
  if (!daten) return;
  const bei = Math.max(0, Math.round(Number(hole("neuBei").value)));
  const art = hole("neuArt").value;
  if (art === "halten") {
    ereignisse.push({ art: "halten", bei, dauer: Math.max(1, Math.round(Number(hole("neuWert").value))) });
  } else if (art === "heilen") {
    ereignisse.push({ art: "heilen", bei });
  } else {
    const clip = Math.min(Math.max(1, Math.round(Number(hole("neuClip").value))), daten.anfaenge.length) - 1;
    const bildImClip = Math.max(0, Math.round(Number(hole("neuWert").value)));
    ereignisse.push({ art: "sprung", bei, nach: Math.min(daten.anfaenge[clip] + bildImClip, daten.pakete.length - 1) });
  }
  neueFolge();
});
hole("neuArt").addEventListener("input", () => {
  const art = hole("neuArt").value;
  hole("neuClipLabel").hidden = art !== "sprung";
  hole("neuWertLabel").hidden = art === "heilen";
  hole("neuWertText").textContent = art === "sprung" ? "Bild im Clip" : "wie viele Bilder";
});
hole("alleWeg").addEventListener("click", () => {
  ereignisse = [];
  neueFolge();
});

// ---------- Zeitleiste (Schnitt und Ergebnis, wie Avidemux) ----------

// Stelle zeigen. Kommen viele hintereinander (Pfeiltaste gedrückt), gilt nur die letzte: es dekodiert
// immer nur einer, und wer wartet, nimmt dann gleich das neueste Ziel.
let stelleZiel = null;
let stelleLaeuft = false;
async function geheZu(i) {
  stelleZiel = i;
  zeitleiste.markiere(i);
  if (stelleLaeuft) return;
  stelleLaeuft = true;
  try {
    await halte();
    while (stelleZiel !== null) {
      const z = stelleZiel;
      stelleZiel = null;
      try {
        await zeigeBild(z);
      } catch (fehler) {
        protokoll(`Stelle zeigen: ${fehler.message}`);
        n = 0; // beim nächsten Mal von vorn
      }
    }
  } finally {
    stelleLaeuft = false;
  }
}

zeitleiste = richteZeitleisteEin(hole("zeitleisteRahmen"), {
  beiStelle: geheZu,
  beiAuswahl: (a) => {
    const sek = (x) => (x / (daten?.fps ?? 30)).toFixed(2).replace(".", ",");
    hole("auswahlInfo").textContent = a ? `Auswahl: Bild ${a[0]} bis ${a[1]} (${a[1] - a[0] + 1} Bilder, ${sek(a[1] - a[0] + 1)} s)` : "keine Auswahl (ziehen, Umschalt-Klick, oder A und B)";
  },
  // ein Clip wird gezogen ("ziehen") oder ist losgelassen ("fertig")
  beiClip: (wann) => neueFolge(wann === "fertig"),
  beiClipWahl: (c) => {
    hole("clipInfo").textContent = `gewählt: ${c.name}, Spur ${c.spur + 1}, ab Bild ${c.start}, Bild ${c.von} bis ${c.von + c.laenge - 1} des Clips`;
  },
});

// Eingriffe hinter einer Stelle verschieben sich, wenn davor Bilder wegfallen oder dazukommen
function verschiebeEreignisse(abBild, um) {
  for (const e of ereignisse) if (e.bei >= abBild) e.bei += um;
}

// wie viele Bilder der Auswahl aus dem Schnitt kommen (die anderen sind eingesetzt: gehalten, wiederholt …)
const ausDemSchnitt = (von, bis) => herkunft.slice(von, bis + 1).filter((h) => h.art !== "einschub").length;

// die Auswahl durch eine Liste ersetzen; Eingriffe darin fallen weg (ihre Wirkung steckt schon in der
// Liste oder ist gelöscht), die dahinter rücken nach
function ersetzeAuswahl(wie, liste, extra = {}) {
  const a = zeitleiste.auswahl();
  if (!a || !daten) return;
  const [von, bis] = a;
  const um = liste.length - (bis - von + 1);
  ereignisse = ereignisse.filter((e) => e.bei < von || e.bei > bis);
  verschiebeEreignisse(bis + 1, um);
  ereignisse.push({ art: "ersetzen", wie, bei: von, weg: ausDemSchnitt(von, bis), liste, ab: bis + 1 + Math.min(0, um), um, ...extra });
  zeitleiste.setzeAuswahl(liste.length ? [von, von + liste.length - 1] : null);
  neueFolge();
}

// Löschen: die Auswahl fällt weg, danach geht es weiter, als wäre nichts gewesen. Löschst du den roten
// Keyframe am Schnitt, laufen die P-Frames danach auf dem alten Bild weiter: wie in Avidemux.
hole("auswahlWeg").addEventListener("click", () => ersetzeAuswahl("löschen", []));

// Wiederholen: die Auswahl noch "mal" Mal direkt dahinter (P-Frames verdoppeln: die Bewegung läuft weiter)
hole("auswahlWiederholen").addEventListener("click", () => {
  const a = zeitleiste.auswahl();
  if (!a || !daten) return;
  const [von, bis] = a;
  const mal = Math.max(1, Math.round(Number(hole("wiederholMal").value)));
  const stueck = folge.slice(von, bis + 1);
  const liste = [];
  for (let k = 0; k <= mal; k++) liste.push(...stueck); // das Original und mal Kopien
  ersetzeAuswahl("wiederholen", liste);
});

// Umkehren: dieselben Pakete rückwärts. Jeder P-Frame verschiebt dann von der falschen Seite aus; die Bewegung
// läuft nicht einfach zurück, sie verschmiert anders (ausprobieren: mit „wiederholen“ zusammen)
hole("auswahlUmkehren").addEventListener("click", () => {
  const a = zeitleiste.auswahl();
  if (a) ersetzeAuswahl("umkehren", folge.slice(a[0], a[1] + 1).reverse());
});

// Mischen: in der Auswahl die P-Frames eines anderen Clips statt der eigenen. Fremde Bewegung auf dem
// Bild von hier, so lang wie die Auswahl; danach laufen die eigenen P-Frames weiter (auf dem gemoshten Bild)
hole("auswahlMischen").addEventListener("click", () => {
  const a = zeitleiste.auswahl();
  if (!a || !daten) return;
  const clip = Math.min(Math.max(1, Math.round(Number(hole("mischClip").value))), clips.length) - 1;
  const ab = Math.max(0, Math.round(Number(hole("mischAb").value)));
  ersetzeAuswahl("mischen", pFramesAb(daten, clip, ab, a[1] - a[0] + 1), { vonClip: clip });
});

// I-Frames in der Auswahl löschen oder zurückholen. Am Schnitt: der Schnitt merkt es sich (iWeg / iBleibt).
// Ein geheilter Keyframe aus einem „heilen“-Eingriff: der Eingriff fällt weg.
hole("auswahlI").addEventListener("click", () => {
  const a = zeitleiste.auswahl();
  if (!a || !daten) return;
  let geaendert = 0;
  for (let i = Math.max(1, a[0]); i <= a[1]; i++) {
    const h = herkunft[i];
    if (h.schnitt) {
      if (h.iWeg) {
        iWeg.delete(h.schnitt);
        if (einstellung.schnitte > 0) iBleibt.add(h.schnitt);
      } else {
        iWeg.add(h.schnitt);
        iBleibt.delete(h.schnitt);
      }
      geaendert++;
    } else if (folge[i] >= daten.pakete.length) {
      const vorher = ereignisse.length;
      ereignisse = ereignisse.filter((e) => !(e.art === "heilen" && e.bei === i));
      geaendert += vorher - ereignisse.length;
    }
  }
  if (!geaendert) zeige("In der Auswahl ist kein I-Frame, das sich löschen lässt (geheilt durch „Heilen nach“ oder „an Schnitten moshen“ regeln die Regler).");
  else zeige("");
  neueFolge();
});

// Fremdes Bild als I-Frame: ein Standbild, ein Bild lang, auf eine neue oberste Spur an die Stelle (Anfang der
// Auswahl, sonst die blaue Linie). Danach geht der Clip darunter ohne I-Frame weiter: seine P-Frames bewegen
// das fremde Bild. Geht überall, nicht nur an einem Schnitt.
hole("iBild").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  event.target.value = "";
  if (!datei || !daten) return;
  const i = zeitleiste.auswahl()?.[0] ?? Math.max(0, zeitleiste.stelle());
  const t = herkunft[i]?.t;
  if (t === undefined) return;
  const darunter = grund.find((g) => g.t === t);
  try {
    const clip = await oeffneClip(datei);
    clip.sekunden = 1 / daten.fps; // genau ein Bild
    clip.spur = -1; // über allen anderen
    clip.start = t;
    clips.push(clip);
    iBleibt.add(`${clip.id}:0`); // das fremde Bild selbst ist der neue I-Frame
    if (darunter) iWeg.add(`${darunter.id}:${darunter.k + 1}`); // danach: ohne I-Frame weiter
    zeigeClips();
    await vorbereiten();
    const unten = darunter && clips.find((c) => c.id === darunter.id);
    zeige(`„${clip.name}“ ist jetzt an Bild ${i} das I-Frame (oberste Spur im Schnitt). Danach bewegen die P-Frames von „${unten?.name ?? "dem Clip darunter"}“ es weiter. Der Rest der P-Frames malt das Original langsam zurück; mit wenig Bitrate bleibt das fremde Bild länger.`);
  } catch (fehler) {
    zeige(`${datei.name}: ${fehler.message}`);
  }
});

hole("auswahlAufheben").addEventListener("click", () => zeitleiste.hebeAuf());
hole("zoomRein").addEventListener("click", () => zeitleiste.zoome(1.5));
hole("zoomRaus").addEventListener("click", () => zeitleiste.zoome(1 / 1.5));
hole("zoomGanz").addEventListener("click", () => zeitleiste.ganz());

// Spuren tauschen: die Spur des gewählten Clips mit der darüber oder darunter (oben gewinnt)
function tauscheSpur(richtung) {
  const c = zeitleiste.gewaehlt();
  if (!c) return zeige("Erst einen Clip im Schnitt anklicken.");
  const a = c.spur;
  const b = a + richtung;
  if (b < 0) return;
  for (const x of clips) {
    if (x.spur === a) x.spur = b;
    else if (x.spur === b) x.spur = a;
  }
  neueFolge();
}
hole("spurHoch").addEventListener("click", () => tauscheSpur(-1));
hole("spurRunter").addEventListener("click", () => tauscheSpur(1));
// den gewählten Clip an die Stelle legen (sein Anfang springt dorthin)
hole("clipHierher").addEventListener("click", () => {
  const c = zeitleiste.gewaehlt();
  const t = herkunft[zeitleiste.stelle()]?.t;
  if (!c || t === undefined) return zeige("Erst einen Clip anklicken und eine Stelle wählen.");
  c.start = t;
  neueFolge();
});

// ---------- Export ----------

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name: "datamosh",
  anzeige: () => bild,
});

const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(bild, einst) });

// Video rendern: dieselbe Folge noch einmal von vorn, so schnell es geht, mit demselben Dekoder wie beim
// Abspielen (ein zweiter Dekoder lief in Zen/Firefox nicht an; einer, der beim Abspielen geht, geht hier auch)
hole("videoRendern").addEventListener("click", async () => {
  if (!daten) return zeige("Erst vorbereiten.");
  let aufnahme = null;
  const leinwand = document.createElement("canvas");
  leinwand.width = daten.breite;
  leinwand.height = daten.hoehe;
  const lctx = leinwand.getContext("2d");
  // wie beim Abspielen: Pakete gehen voraus, jedes in sein eigenes kleines Canvas (Ring), beruhigt wird
  // erst beim Zeichnen in die Leinwand, der Reihe nach
  const ring = Array.from({ length: VORAUS + 1 }, () => {
    const c = document.createElement("canvas");
    c.width = daten.breite;
    c.height = daten.hoehe;
    return c;
  });
  try {
    protokoll("Rendern: anhalten …");
    await halte();
    protokoll("Rendern: Fenster öffnen");
    const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
    if (!einst) return protokoll("Rendern: abgebrochen");
    const rahmen = document.createElement("canvas");
    const mitR = () => mitRahmen(leinwand, einst, rahmen);
    const folge = baue(false).folge; // nur die gemerkten Eingriffe, ohne die flüchtigen
    protokoll(`Rendern: ${folge.length} Bilder, ${einst.videoTyp}, Ton: ${einstellung.tonArt}`);
    // der Ton wird vorher ganz gebaut (ton.js) und dann Bild für Bild mitgegeben
    zeigeFortschritt("Ton …");
    const ton = await baueTon(einstellung.tonArt, { daten, folge, grund, clips, datei: hole("tonDatei").files[0] });
    const grenze = (i) => Math.round((i * (ton?.sampleRate ?? 0)) / daten.fps);
    dekoder.neu();
    n = 0;
    const bilder = [];
    let geschickt = 0;
    const schickeBis = (k) => {
      for (; geschickt < folge.length && geschickt <= k; geschickt++) {
        bilder[geschickt] = dekoder.schicke(paketVon(daten, folge[geschickt]), ring[geschickt % ring.length]);
      }
    };
    // Bild i: abwarten und beruhigt in die Leinwand
    const holeBild = async (i) => {
      schickeBis(i + VORAUS - 1);
      if (!(await dekoder.warteAuf(bilder[i]))) throw new Error("Der Dekoder wurde mittendrin neu gestartet");
      bilder[i] = null;
      zeichne(lctx, ring[i % ring.length]);
    };
    await holeBild(0);
    protokoll("Rendern: erstes Bild da, Aufnahme starten");
    try {
      aufnahme = await neueAufnahme(mitR(), daten.fps, undefined, ton && { kanaele: 2, rate: ton.sampleRate }, einst.videoTyp, einst.videoQualitaet);
    } catch (fehler) {
      // kann der Browser kein MP4 (H.264) kodieren, eben WebM
      console.warn(fehler);
      protokoll(`MP4 ging nicht (${fehler.message}), nehme WebM`);
      aufnahme = await neueAufnahme(mitR(), daten.fps, undefined, ton && { kanaele: 2, rate: ton.sampleRate }, "webm", einst.videoQualitaet);
      zeige("MP4 ging hier nicht, das Video wird WebM.");
    }
    for (let i = 0; i < folge.length; i++) {
      if (i > 0) await holeBild(i);
      const stueck = ton && schneideTon(ton, grenze(i), grenze(i + 1));
      await Promise.all([aufnahme.bild(mitR(), i / daten.fps, 1 / daten.fps), stueck && aufnahme.ton(stueck)]);
      if (i % 15 === 0) {
        zeigeFortschritt(`Video … ${Math.round((i / folge.length) * 100)} %`);
        await warte();
      }
    }
    zeigeFortschritt("Speichern …");
    protokoll("Rendern: speichern");
    ladeHerunter(await aufnahme.fertig(), `datamosh-${zeitstempel()}.${aufnahme.endung}`);
    protokoll("Rendern: fertig");
  } catch (fehler) {
    console.error(fehler);
    protokoll(`Rendern ging nicht: ${fehler.message}`);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    zeigeFortschritt(null);
    await zeigeBild(0).catch(() => {}); // die Vorschau wieder auf den Anfang
  }
});

zeigeClips();
zeigeEreignisse();

// zum Nachsehen in der Konsole (F12): datamosh.folge, datamosh.herkunft, datamosh.clips …
window.datamosh = {
  get folge() {
    return folge;
  },
  get herkunft() {
    return herkunft;
  },
  get grund() {
    return grund;
  },
  get daten() {
    return daten;
  },
  clips,
  ereignisse: () => ereignisse,
};
