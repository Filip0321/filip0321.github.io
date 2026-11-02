// Datamosh: hier wird alles verbunden.
//   /lib/video-quelle.js  Clips öffnen (Mediabunny)
//   kodieren.js           alle Clips neu kodieren (VP8, Keyframe nur am Anfang jedes Clips)
//   folge.js              welche Pakete in welcher Reihenfolge: hier passiert der Mosh
//   dekoder.js            Pakete -> Bilder (VideoDecoder)
//
// Zwei Arten zu arbeiten, die dasselbe ergeben:
//   live    abspielen und dabei springen (S), halten (H gedrückt halten) und heilen (K). Jeder Griff wird
//           als Ereignis gemerkt, mit der Bildnummer.
//   Liste   Ereignisse von Hand eintragen oder die gemerkten ändern und löschen.
// Der Export spielt genau diese Ereignisse noch einmal ab, Bild für Bild: was du live gemacht hast,
// kommt genau so ins Video.

import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin, neueAufnahme, ladeHerunter, zeitstempel, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { oeffneVideo } from "/lib/video-quelle.js";
import { bereite } from "./kodieren.js";
import { baueFolge, quelleBei, paketVon } from "./folge.js";
import { richteDekoderEin } from "./dekoder.js";

const bild = hole("bild");
const ctx = bild.getContext("2d");
const stapel = hole("stapel");
const meldung = hole("meldung");
const fortschritt = hole("fortschritt");
const abspielen = hole("abspielen");

let clips = []; // geöffnete Videos, in dieser Reihenfolge hintereinander
let daten = null; // Ergebnis von bereite()
let ereignisse = []; // { art: "sprung" | "halten" | "heilen", bei, nach | dauer }
let folge = [];
let n = 0; // Bild der Folge, das als nächstes kommt
let laeuft = false;
let haelt = null; // das Halten-Ereignis, solange H gedrückt ist
let dekoder = null;
let schleife = Promise.resolve(); // die laufende Abspielschleife (zum Abwarten beim Anhalten)

const { einstellung, setze } = richteReglerEin({
  beiAenderung: () => neueFolge(),
  extra: {},
});
// wer im System „Bewegung reduzieren“ eingestellt hat, bekommt das Flackern gleich gedämpft
if (matchMedia("(prefers-reduced-motion: reduce)").matches) setze("ruhe", 0.6);

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}

function zeigeFortschritt(text) {
  fortschritt.textContent = text ?? "";
  fortschritt.hidden = !text;
}

function baue() {
  return baueFolge(daten, ereignisse, { schnitteMoshen: einstellung.schnitte, heilenNach: einstellung.heilenNach });
}

function neueFolge() {
  if (!daten) return;
  folge = baue();
  zeigeEreignisse();
  zeigeStelle();
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
    name.textContent = `${i + 1}. ${c.name} (${c.dauer.toFixed(1).replace(".", ",")} s)`;
    const knopf = (text, titel, aktion) => {
      const k = document.createElement("button");
      k.type = "button";
      k.textContent = text;
      k.title = titel;
      k.addEventListener("click", aktion);
      return k;
    };
    zeile.append(
      name,
      knopf("↑", "nach vorn", () => {
        if (i > 0) [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]];
        veraltet();
      }),
      knopf("×", "entfernen", () => {
        clips.splice(i, 1);
        veraltet();
      }),
    );
    liste.append(zeile);
  });
}

// Clips geändert: neu vorbereiten nötig
function veraltet() {
  halte();
  daten = null;
  zeigeClips();
  hole("vorbereiten").disabled = !clips.length;
  abspielen.disabled = true;
  zeige(clips.length ? "Clips geändert: „Vorbereiten“ drücken." : "");
}

hole("dateien").addEventListener("change", async (event) => {
  const dateien = [...event.target.files];
  event.target.value = "";
  for (const datei of dateien) {
    try {
      clips.push(await oeffneVideo(datei));
    } catch (fehler) {
      zeige(`${datei.name}: ${fehler.message}`);
    }
  }
  veraltet();
});

hole("vorbereiten").addEventListener("click", async () => {
  if (!clips.length) return;
  await halte();
  hole("vorbereiten").disabled = true;
  try {
    daten = await bereite(clips, { breite: Number(einstellung.breite), bitrate: einstellung.bitrate * 1e6, wild: einstellung.wild, beiFortschritt: zeigeFortschritt });
    bild.width = daten.breite;
    bild.height = daten.hoehe;
    stapel.style.setProperty("--verhaeltnis", `${daten.breite} / ${daten.hoehe}`);
    dekoder?.schliesse();
    dekoder = richteDekoderEin(daten, (b) => zeichne(ctx, b));
    n = 0;
    neueFolge();
    abspielen.disabled = false;
    zeige(daten.zeitschichten || einstellung.wild ? "" : "Dein Browser kodiert ohne Zeitschichten: jeder Sprung wird zu Rauschen statt zu wandernden Blöcken (siehe LIESMICH).");
    await zeigeBild(0); // das erste Bild
  } catch (fehler) {
    console.error(fehler);
    zeige(`Vorbereiten ging nicht: ${fehler.message}`);
  } finally {
    hole("vorbereiten").disabled = false;
    zeigeFortschritt(null);
  }
});

// ---------- Abspielen ----------

// ein dekodiertes Bild zeichnen. „Beruhigen“ legt es nur halb deckend über das vorige: das Flackern
// wird weicher, harte Wechsel werden zu Überblendungen (gegen den epileptischen Eindruck, siehe LIESMICH)
function zeichne(c, b) {
  c.globalAlpha = 1 - einstellung.ruhe;
  c.drawImage(b, 0, 0, c.canvas.width, c.canvas.height);
  c.globalAlpha = 1;
}

// Bild n der Folge zeigen. Weil jedes Bild auf dem vorigen aufbaut, geht das nur der Reihe nach:
// wer zurückspringt, muss von vorn dekodieren (dafür ist es schnell genug)
async function zeigeBild(ziel) {
  if (ziel < n || n === 0) {
    dekoder.neu();
    n = 0;
  }
  while (n <= ziel && n < folge.length) {
    await dekoder.dekodiere(paketVon(daten, folge[n]));
    n++;
  }
  zeigeStelle();
}

function spiele() {
  if (!daten || laeuft) return;
  schleife = spieleSchleife();
}

async function spieleSchleife() {
  if (n >= folge.length) {
    n = 0;
    dekoder.neu();
  }
  laeuft = true;
  abspielen.textContent = "Anhalten";
  const dauer = 1000 / daten.fps;
  let naechstes = performance.now();
  try {
    while (laeuft && n < folge.length) {
      if (haelt) {
        // H gedrückt: das Halten wird jedes Bild länger, die Folge neu gebaut
        haelt.dauer++;
        folge = baue();
      }
      await dekoder.dekodiere(paketVon(daten, folge[n]));
      n++;
      if (n % 5 === 0) zeigeStelle();
      naechstes += dauer;
      await new Promise((weiter) => setTimeout(weiter, Math.max(0, naechstes - performance.now())));
    }
  } catch (fehler) {
    console.error(fehler);
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
function halte() {
  laeuft = false;
  return schleife;
}

abspielen.addEventListener("click", () => (laeuft ? halte() : spiele()));
hole("vonVorn").addEventListener("click", async () => {
  await halte();
  if (daten) await zeigeBild(0);
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
  ereignisse.push({ art: "sprung", bei: n, nach: sprungZiel() });
  neueFolge();
}

function heile() {
  if (!daten) return;
  ereignisse.push({ art: "heilen", bei: n });
  neueFolge();
}

function halteFest(an) {
  if (!daten) return;
  if (an && !haelt) {
    haelt = { art: "halten", bei: n, dauer: 0 };
    ereignisse.push(haelt);
  } else if (!an && haelt) {
    if (!haelt.dauer) ereignisse = ereignisse.filter((e) => e !== haelt); // nur kurz getippt
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
      sprung: () => `Bild ${e.bei}: Sprung nach Clip ${(q?.clip ?? 0) + 1}, Bild ${q?.bild ?? "?"}`,
      halten: () => `Bild ${e.bei}: halten, ${e.dauer} Bilder`,
      heilen: () => `Bild ${e.bei}: heilen`,
    }[e.art]();
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "×";
    weg.title = "löschen";
    weg.addEventListener("click", () => {
      ereignisse = ereignisse.filter((x) => x !== e);
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

// ---------- Export ----------

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name: "datamosh",
  anzeige: () => bild,
});

const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(bild, einst) });

hole("videoRendern").addEventListener("click", async () => {
  if (!daten) return zeige("Erst vorbereiten.");
  await halte();
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
  if (!einst) return;
  let aufnahme = null;
  // eigener Dekoder und eigenes Canvas: dieselbe Folge noch einmal von vorn, so schnell es geht
  const leinwand = document.createElement("canvas");
  leinwand.width = daten.breite;
  leinwand.height = daten.hoehe;
  const lctx = leinwand.getContext("2d");
  const export_ = richteDekoderEin(daten, (b) => zeichne(lctx, b));
  try {
    const rahmen = document.createElement("canvas");
    const mitR = () => mitRahmen(leinwand, einst, rahmen);
    export_.neu();
    await export_.dekodiere(paketVon(daten, folge[0]));
    aufnahme = await neueAufnahme(mitR(), daten.fps, undefined, null, einst.videoTyp);
    for (let i = 0; i < folge.length; i++) {
      if (i > 0) await export_.dekodiere(paketVon(daten, folge[i]));
      await aufnahme.bild(mitR(), i / daten.fps, 1 / daten.fps);
      if (i % 15 === 0) {
        zeigeFortschritt(`Video … ${Math.round((i / folge.length) * 100)} %`);
        await warte();
      }
    }
    zeigeFortschritt("Speichern …");
    ladeHerunter(await aufnahme.fertig(), `datamosh-${zeitstempel()}.${aufnahme.endung}`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    export_.schliesse();
    zeigeFortschritt(null);
  }
});

zeigeClips();
zeigeEreignisse();
