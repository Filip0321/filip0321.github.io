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
import { richteZeitleisteEin } from "./zeitleiste.js";

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

function zeigeFortschritt(text) {
  fortschritt.textContent = text ?? "";
  fortschritt.hidden = !text;
}

// an Schnitten moshen: 0 = aus, 1 bis 120 Bilder lang, ganz rechts (121) = nie heilen
const schnittMosh = () => (einstellung.schnitte > 120 ? Infinity : einstellung.schnitte);

function baue(mitFluechtigen = true) {
  const alle = mitFluechtigen ? [...ereignisse, ...fluechtig] : ereignisse;
  return baueFolge(daten, alle, { schnitteMoshen: schnittMosh(), heilenNach: einstellung.heilenNach });
}

// ein Eingriff: gemerkt (Liste, Export) oder nur für jetzt (live ohne Merken)
function greifeEin(e) {
  (einstellung.merken ? ereignisse : fluechtig).push(e);
  neueFolge();
  return e;
}

function neueFolge() {
  if (!daten) return;
  folge = baue();
  zeigeEreignisse();
  zeigeStelle();
  zeitleiste.zeige(folge, daten, einstellung.pxBild);
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
    const bilder = daten ? (daten.anfaenge[i + 1] ?? daten.pakete.length) - daten.anfaenge[i] : null;
    name.textContent = `${i + 1}. ${c.name} (${c.dauer.toFixed(1).replace(".", ",")} s, ${bilder ?? `etwa ${Math.round(c.dauer * c.fps)}`} Bilder)`;
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
    dekoder = richteDekoderEin(daten, dekodiertesBild);
    zeigeClips(); // jetzt mit der genauen Zahl der Bilder
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

// Wohin der Dekoder zeichnet: beim Spulen direkt ins Bild, beim Abspielen in einen Vorrat (siehe unten)
let zeichenZiel = null; // null = sichtbar
let zielRuhig = false; // ins Ziel auch mit „Beruhigen“ (Export), sonst ganz (Vorrat beim Abspielen)
function dekodiertesBild(b) {
  if (!zeichenZiel) zeichne(ctx, b);
  else if (zielRuhig) zeichne(zeichenZiel.getContext("2d"), b);
  else zeichenZiel.getContext("2d").drawImage(b, 0, 0, zeichenZiel.width, zeichenZiel.height);
}

// Bild n der Folge zeigen. Weil jedes Bild auf dem vorigen aufbaut, geht das nur der Reihe nach:
// wer zurückspringt, muss von vorn dekodieren (dafür ist es schnell genug)
async function zeigeBild(ziel) {
  zeichenZiel = null;
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

// Abspielen mit Vorrat: Der Dekoder läuft bis zu VORRAT Bilder voraus und legt sie in kleine Canvas;
// gezeigt wird im festen Takt. Braucht ein Bild länger (ein großer Keyframe, ein voller Rechner), zehrt die
// Anzeige vom Vorrat, statt zu stocken. Preis: Eingriffe wirken ein paar Bilder später (bei 3 etwa 0,1 s).
const VORRAT = 3;
const vorrat = [];

async function spieleSchleife() {
  if (n >= folge.length) {
    n = 0;
    fluechtig = []; // von vorn: die flüchtigen Eingriffe sind vorbei
    folge = baue();
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
  let gezeigt = n; // das nächste Bild, das auf den Bildschirm kommt
  let naechstes = performance.now();
  try {
    while (laeuft && gezeigt < folge.length) {
      // dekodieren, solange der Vorrat nicht voll ist
      while (laeuft && n < folge.length && n - gezeigt < VORRAT) {
        if (haelt) {
          // H gedrückt: das Halten wird jedes Bild länger, die Folge neu gebaut
          haelt.dauer++;
          folge = baue();
        }
        zeichenZiel = vorrat[n % vorrat.length];
        await dekoder.dekodiere(paketVon(daten, folge[n]));
        n++;
      }
      // zeigen, wenn es Zeit ist
      const warten = naechstes - performance.now();
      if (warten > 0) await new Promise((weiter) => setTimeout(weiter, warten));
      if (gezeigt < n) {
        zeichne(ctx, vorrat[gezeigt % vorrat.length]);
        gezeigt++;
        zeitleiste?.markiere(gezeigt - 1);
        if (gezeigt % 5 === 0) zeigeStelle();
      }
      naechstes = Math.max(naechstes + dauer, performance.now() - dauer); // nach einer langen Pause nicht aufholen
    }
  } catch (fehler) {
    console.error(fehler);
    zeige(`Der Dekoder ist ausgestiegen (${fehler.message}). Von vorn abspielen hilft meistens.`);
    dekoder.neu();
    n = 0;
  } finally {
    laeuft = false;
    haelt = null;
    zeichenZiel = null;
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
  fluechtig = [];
  if (daten) {
    folge = baue();
    await zeigeBild(0);
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

// ---------- Zeitleiste (wie Avidemux) ----------

zeitleiste = richteZeitleisteEin(hole("zeitleiste"), {
  beiStelle: async (i) => {
    await halte();
    await zeigeBild(i);
    zeitleiste.markiere(i);
  },
  beiAuswahl: (a) => {
    hole("auswahlInfo").textContent = a ? `Auswahl: Bild ${a[0]} bis ${a[1]} (${a[1] - a[0] + 1} Bilder)` : "keine Auswahl (ziehen oder Umschalt-Klick)";
  },
});

// Eingriffe hinter einer Stelle verschieben sich, wenn davor Bilder wegfallen oder dazukommen
function verschiebeEreignisse(abBild, um) {
  for (const e of ereignisse) if (e.bei >= abBild) e.bei += um;
}

// Löschen: von a bis b fällt weg, danach geht es mit dem Bild weiter, das nach b kam. Das ist ein Sprung
// bei a dorthin (liegt dort ein Keyframe, nimmt der Sprung das Bild danach: wie in Avidemux, wenn man
// den I-Frame am Schnitt löscht, laufen die P-Frames auf dem alten Bild weiter)
hole("auswahlWeg").addEventListener("click", () => {
  const a = zeitleiste.auswahl();
  if (!a || !daten) return;
  const [von, bis] = a;
  const danach = folge[bis + 1];
  const quelle = danach === undefined ? daten.pakete.length : danach >= daten.pakete.length ? danach - daten.pakete.length : danach;
  ereignisse = ereignisse.filter((e) => e.bei < von || e.bei > bis);
  verschiebeEreignisse(bis + 1, -(bis - von + 1));
  ereignisse.push({ art: "sprung", bei: von, nach: quelle });
  zeitleiste.hebeAuf();
  neueFolge();
});

// Wiederholen: die Auswahl noch "mal" Mal direkt dahinter (P-Frames verdoppeln: die Bewegung läuft weiter)
hole("auswahlWiederholen").addEventListener("click", () => {
  const a = zeitleiste.auswahl();
  if (!a || !daten) return;
  const [von, bis] = a;
  const mal = Math.max(1, Math.round(Number(hole("wiederholMal").value)));
  verschiebeEreignisse(bis + 1, (bis - von + 1) * mal);
  ereignisse.push({ art: "wiederholen", bei: bis + 1, liste: folge.slice(von, bis + 1), mal });
  zeitleiste.hebeAuf();
  neueFolge();
});
hole("auswahlAufheben").addEventListener("click", () => zeitleiste.hebeAuf());

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
  try {
    await halte();
    const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
    if (!einst) return;
    const rahmen = document.createElement("canvas");
    const mitR = () => mitRahmen(leinwand, einst, rahmen);
    const folge = baue(false); // nur die gemerkten Eingriffe, ohne die flüchtigen
    zeichenZiel = leinwand;
    zielRuhig = true; // „Beruhigen“ gilt auch im Video
    dekoder.neu();
    n = 0;
    await dekoder.dekodiere(paketVon(daten, folge[0]));
    try {
      aufnahme = await neueAufnahme(mitR(), daten.fps, undefined, null, einst.videoTyp);
    } catch (fehler) {
      // kann der Browser kein MP4 (H.264) kodieren, eben WebM
      console.warn(fehler);
      aufnahme = await neueAufnahme(mitR(), daten.fps, undefined, null, "webm");
      zeige("MP4 ging hier nicht, das Video wird WebM.");
    }
    for (let i = 0; i < folge.length; i++) {
      if (i > 0) await dekoder.dekodiere(paketVon(daten, folge[i]));
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
    zeichenZiel = null;
    zielRuhig = false;
    zeigeFortschritt(null);
    await zeigeBild(0).catch(() => {}); // die Vorschau wieder auf den Anfang
  }
});

zeigeClips();
zeigeEreignisse();
