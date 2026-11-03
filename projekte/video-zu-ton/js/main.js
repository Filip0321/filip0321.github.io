// Video zu Ton: hier wird alles verbunden. Die Arbeit steckt in den Modulen:
//   quelle.js             Videodatei oder Kamera
//   gpu.js                Video als Textur, Vorbearbeitung, Striche lesen, anzeigen
//   vorbereitung-shader.js  hell, Kanten, Bewegung, Schwelle (/lib/kanten.js)
//   lese-shader.js        Strich -> Helligkeit pro Zeile
//   frequenzen.js         Tonhöhe jeder Zeile (Tonleiter, eigene) und ihre Lage (Zeilendichte)
//   striche.js            die Lesestriche und ihre Einstellungen
//   klang.js              Seite <-> Audio-Thread, Originalton, Ton fürs Video rechnen
//   stimmen-worklet.js    eine Stimme pro Zeile, oder der Strich als Wellenform
//   kopf.js               Striche, Balken und Skala über dem Video
//   ausloeser.js          Objekte auf einem Strich finden: jedes neue spielt eine Note
//   export-video.js       WAV und Video Bild für Bild

import { richteReglerEin } from "/lib/regler.js";
import { richteMausInfoEin, zeigeFrequenz, notenName } from "/lib/maus-info.js";
import { richteExportEin } from "/lib/export.js";
import { video, oeffneDatei, oeffneKamera, istKamera } from "./quelle.js";
import { richteGpuEin } from "./gpu.js";
import { richteKlangEin } from "./klang.js";
import { richteKopfEin } from "./kopf.js";
import { zeilenFrequenzen, zeilenGrenzen, akkord } from "./frequenzen.js";
import { richteAusloeserEin } from "./ausloeser.js";
import { neuerStrich, VORLAGEN, MAX_STRICHE, richteStrichListeEin } from "./striche.js";
import { richteVideoExportEin } from "./export-video.js";

const bild = hole("bild");
const kopfCanvas = hole("kopf");
const stapel = hole("stapel");
const meldung = hole("meldung");
const tonKnopf = hole("ton");
const pauseKnopf = hole("pause");
const fortschritt = hole("fortschritt");

const GREIF_ABSTAND = 12; // Bildpunkte: so nah an einem Strich greift man ihn
const PROFIL_ZEIT = 1; // Sekunden: so träge folgt die Zeilendichte dem Bild (sonst zappeln die Zeilen)

const gpu = richteGpuEin(bild);
const kopf = richteKopfEin(kopfCanvas);
const klang = richteKlangEin();
const ausloeser = richteAusloeserEin();

let quelleDa = false;
let striche = VORLAGEN.einer();
let aktiv = striche[0].id;
let werte = []; // pro Strich: Helligkeit pro Zeile, vom letzten Bild
let grenzen = new Map(); // id -> Grenzen der Zeilen längs des Strichs (frequenzen.js)
let frequenzen = new Map(); // id -> Hz pro Zeile
let profil = [null, null]; // geglättet: wie viel ist wo los, senkrecht und waagerecht
let ausschnitt = null; // [links, unten, rechts, oben] in uv, oder null = ganzes Bild
const eigene = new Map(); // Zeile -> Hz, von Hand festgelegt

const { einstellung } = richteReglerEin({
  beiAenderung: () => {
    sendeEinstellung();
    zeichneNeu();
  },
  extra: {
    zeilen: () => neueZeilen(),
    tief: () => sendeStriche(),
    hoch: () => sendeStriche(),
    tonleiter: () => sendeStriche(),
    leiterGrundton: () => sendeStriche(),
    dichte: () => rechneGrenzen(),
    ausschnittArt: () => passeFeldAn(),
    originalton: () => klang.originalton(einstellung.originalton),
    drehung: () => {
      gpu.setzeDrehung(Number(einstellung.drehung));
      ausschnitt = null; // der Ausschnitt gehörte zum ungedrehten Bild
      if (quelleDa) lese(false);
      passeFeldAn();
    },
  },
});

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}

const findeStrich = (id) => striche.find((s) => s.id === id);

// ---------- Tonhöhen und Lage der Zeilen ----------

function rechneGrenzen() {
  for (const s of striche) {
    const p = profil[s.senkrecht ? 0 : 1];
    grenzen.set(s.id, zeilenGrenzen(einstellung.zeilen, p, einstellung.dichte));
  }
}

function sendeStriche() {
  const hoch = Math.min(einstellung.hoch, 20000);
  const tief = Math.min(Math.max(einstellung.tief, 20), hoch / 2);
  frequenzen = new Map();
  for (const s of striche) {
    frequenzen.set(s.id, zeilenFrequenzen({
      zeilen: einstellung.zeilen,
      tief,
      hoch,
      tonleiter: einstellung.tonleiter,
      grundton: Number(einstellung.leiterGrundton),
      halbtoene: s.halbtoene,
      eigene,
    }));
  }
  klang.striche(klangStriche());
  rechneGrenzen();
  zeichneNeu();
}

// was der Klang von jedem Strich wissen muss
function klangStriche() {
  return striche.map((s) => ({ freq: frequenzen.get(s.id), pan: s.pan, art: s.art, grundton: s.grundton, instrument: s.instrument, nachklang: s.nachklang }));
}

function neueZeilen() {
  profil = [null, null]; // Profile haben so viele Stücke wie Zeilen
  werte = [];
  for (const z of [...eigene.keys()]) if (z >= einstellung.zeilen) eigene.delete(z);
  zeigeEigene();
  sendeStriche();
}

const klangEinstellung = () => ({
  dynamik: einstellung.dynamik,
  glaettung: einstellung.glaettung,
  lautstaerke: einstellung.lautstaerke,
  klangfarbe: einstellung.klangfarbe,
});

function sendeEinstellung() {
  klang.einstellung(klangEinstellung());
}

// ---------- Ausschnitt: Lupe oder Fenster ----------

const GANZ = [0, 0, 1, 1];
function rechtecke() {
  const lupe = ausschnitt && einstellung.ausschnittArt === "lupe";
  return { bereich: lupe ? ausschnitt : GANZ, fenster: ausschnitt && !lupe ? ausschnitt : GANZ };
}

// Feld im Seitenverhältnis dessen, was man sieht (bei der Lupe: des Ausschnitts)
function passeFeldAn() {
  if (!quelleDa) return;
  const [l, u, r, o] = rechtecke().bereich;
  // gedreht um 90° oder 270°: Breite und Höhe tauschen
  const quer = Number(einstellung.drehung) % 2 === 1;
  const [b, h] = quer ? [video.videoHeight, video.videoWidth] : [video.videoWidth, video.videoHeight];
  stapel.style.setProperty("--verhaeltnis", `${b * (r - l)} / ${h * (o - u)}`);
  zeichneNeu();
}

// ---------- Bild für Bild ----------

const vorbereitung = () => ({
  modus: einstellung.modus,
  weich: einstellung.weich,
  verstaerkung: einstellung.verstaerkung,
  schwelle: einstellung.schwelle,
  invertieren: einstellung.invertieren,
});

// das aktuelle Videobild verarbeiten und alle Striche lesen (auch für den Export)
// neu: false = dasselbe Bild noch einmal (dann ist die Bewegung 0)
function lese(neu = true) {
  gpu.ladeBild(video);
  gpu.vorbereite(vorbereitung(), neu);
  const ergebnis = gpu.lies(
    striche.map((s) => ({ mitte: s.mitte, breite: s.breite / 100, senkrecht: s.senkrecht, rueckwaerts: s.rueckwaerts, grenzen: grenzen.get(s.id) })),
    einstellung.zeilen,
    rechtecke(),
  );
  if (!ergebnis) return werte;
  // Profile weich nachführen (Tiefpass wie die Glättung im Klang, hier pro Bild statt pro Sample)
  if (einstellung.dichte > 0) {
    const a = 1 - Math.exp(-1 / (30 * PROFIL_ZEIT));
    profil = ergebnis.profile.map((neues, i) => {
      if (!profil[i]) return neues;
      return profil[i].map((alt, j) => alt + (neues[j] - alt) * a);
    });
    rechneGrenzen();
  }
  werte = ergebnis.werte;
  letzteNoten = findeNoten(werte);
  return werte;
}

// Auslösen: neue Objekte auf Strichen dieser Art -> Noten { strich, freq, staerke }
let letzteNoten = [];
function findeNoten(alleWerte) {
  const noten = [];
  striche.forEach((s, i) => {
    if (s.art !== "ausloesen" || !alleWerte[i]) return;
    const freq = frequenzen.get(s.id);
    for (const o of ausloeser.neue(s.id, alleWerte[i], { schwelle: einstellung.objektSchwelle, mindestens: einstellung.mindestens })) {
      const f = freq[Math.round(o.mitte)];
      // Stärke: wie groß und wie hell (ein großes, deutliches Objekt klingt lauter)
      const staerke = Math.min(1, 0.3 + (o.laenge / einstellung.zeilen) * 3) * Math.min(1, o.hell * 1.5);
      const toene = s.akkord ? akkord(f, einstellung.tonleiter, Number(einstellung.leiterGrundton)) : [f];
      for (const t of toene) noten.push({ strich: i, freq: t, staerke: staerke / Math.sqrt(toene.length) });
    }
  });
  return noten;
}

// requestVideoFrameCallback meldet sich genau dann, wenn das Video ein neues Bild hat;
// wo es fehlt (ältere Firefox), eben 60-mal pro Sekunde mit requestAnimationFrame
const proBild = "requestVideoFrameCallback" in HTMLVideoElement.prototype
  ? (aufgabe) => video.requestVideoFrameCallback(aufgabe)
  : (aufgabe) => requestAnimationFrame(aufgabe);

let exportLaeuft = false;
let schleife = 0; // jede neue Quelle startet eine neue Schleife, die alte hört auf
function starteSchleife() {
  const nummer = ++schleife;
  const neuesBild = () => {
    if (nummer !== schleife) return;
    if (!exportLaeuft) {
      klang.werte(lese(true));
      if (letzteNoten.length) klang.noten(letzteNoten);
      zeichneNeu();
    }
    proBild(neuesBild);
  };
  proBild(neuesBild);
}

// ---------- Zeichnen ----------

let rahmenBeimZiehen = null; // Ausschnitt, solange er aufgezogen wird

// fuerExport: was in Bild, Video und Live-Aufnahme soll (Abschnitt Anzeige, „Im Export“); dort auch
// kein Rahmen beim Aufziehen und kein heller „aktiver“ Strich
function zeichneKopf(mitWerten, fuerExport = false) {
  const e = einstellung;
  const mitSkala = fuerExport ? e.exportSkala : e.skala;
  kopf.zeichne({
    striche: striche.map((s, i) => ({ strich: s, grenzen: grenzen.get(s.id), werte: mitWerten[i] ?? null })),
    aktiv: fuerExport ? null : aktiv,
    skala: mitSkala ? { tief: e.tief, hoch: e.hoch, zeilen: e.zeilen } : null,
    balken: fuerExport ? e.exportBalken : e.balken,
    zeigeStriche: fuerExport ? e.exportStriche : e.zeigeStriche,
    deckkraft: e.deckkraft,
    balkenFarbe: e.balkenFarbe,
    rechteck: fuerExport ? null : rahmenBeimZiehen,
  });
}

function zeichneNeu() {
  if (!quelleDa) return;
  gpu.zeichne({ zeigeBearbeitet: einstellung.zeigen === "bearbeitet", ...rechtecke() });
  zeichneKopf(werte);
}

// Video und Striche zusammen auf ein Canvas (Bild speichern, Live, Video)
const gesamt = document.createElement("canvas");
const gesamtCtx = gesamt.getContext("2d");
function gesamtBild(mitWerten = werte) {
  gpu.zeichne({ zeigeBearbeitet: einstellung.zeigen === "bearbeitet", ...rechtecke() });
  zeichneKopf(mitWerten, true);
  gesamt.width = bild.width;
  gesamt.height = bild.height;
  gesamtCtx.drawImage(bild, 0, 0); // direkt nach dem Zeichnen, sonst ist WebGL schon leer
  gesamtCtx.drawImage(kopfCanvas, 0, 0, gesamt.width, gesamt.height);
  zeichneKopf(mitWerten); // und wieder so, wie man es auf der Seite sehen will
  return gesamt;
}

function passeGroesseAn() {
  const dpr = window.devicePixelRatio || 1;
  bild.width = Math.round(bild.clientWidth * dpr);
  bild.height = Math.round(bild.clientHeight * dpr);
  kopf.passeGroesseAn();
  zeichneNeu();
}
new ResizeObserver(passeGroesseAn).observe(bild);

// ---------- Quelle ----------

async function nimmQuelle(oeffne) {
  try {
    await oeffne();
    quelleDa = true;
    starteSchleife();
    ausschnitt = null;
    passeFeldAn();
    pauseKnopf.textContent = "Pause";
    hole("exportHinweis").hidden = !istKamera();
    zeige("");
  } catch (fehler) {
    zeige(fehler.message);
  }
}

// ---------- Striche: Liste und Ziehen ----------

const strichListe = richteStrichListeEin({
  liste: hole("strichListe"),
  eigenschaften: hole("strichEigenschaften"),
  beiWahl: (id) => {
    aktiv = id;
    zeigeStriche();
  },
  beiAenderung: (id, aenderung, neuZeigen = false) => {
    Object.assign(findeStrich(id), aenderung);
    sendeStriche(); // Panorama, Halbtöne, Art, Richtung: alles geht an den Klang
    if (neuZeigen) zeigeStriche();
    zeichneNeu(); // auch in der Pause: Lesebreite und Dicke gleich sehen
  },
  beiLoeschen: (id) => {
    striche = striche.filter((s) => s.id !== id);
    if (aktiv === id) aktiv = striche[0].id;
    werte = [];
    sendeStriche(); // zuerst: rechnet auch die Grenzen, die zeigeStriche zum Zeichnen braucht
    zeigeStriche();
  },
});

function zeigeStriche() {
  strichListe.zeige(striche, aktiv);
  hole("strichDazu").disabled = striche.length >= MAX_STRICHE;
  zeichneNeu();
}

function setzeStriche(neue) {
  striche = neue;
  aktiv = striche[0].id;
  werte = [];
  sendeStriche();
  zeigeStriche();
}

// Zeiger -> Anteile im Feld, y = 0 unten
function imFeld(event) {
  const r = bild.getBoundingClientRect();
  return {
    x: Math.min(Math.max((event.clientX - r.left) / r.width, 0), 1),
    y: Math.min(Math.max((r.bottom - event.clientY) / r.height, 0), 1),
    breite: r.width,
    hoehe: r.height,
  };
}

let ziehen = null; // { art: "strich" } oder { art: "ausschnitt", x, y }

function greife(p) {
  // der nächste Strich in Bildpunkten, wenn er nah genug ist
  let bester = null;
  let abstand = GREIF_ABSTAND;
  for (const s of striche) {
    const d = s.senkrecht ? Math.abs(p.x - s.mitte) * p.breite : Math.abs(p.y - s.mitte) * p.hoehe;
    if (d < abstand) {
      abstand = d;
      bester = s;
    }
  }
  return bester;
}

function bewegeStrich(p) {
  const s = findeStrich(aktiv);
  s.mitte = s.senkrecht ? p.x : p.y;
  zeichneNeu();
}

stapel.addEventListener("pointerdown", (event) => {
  if (!quelleDa || event.button > 0) return;
  stapel.setPointerCapture(event.pointerId);
  const p = imFeld(event);
  if (einstellung.werkzeug === "ausschnitt") {
    ziehen = { art: "ausschnitt", x: p.x, y: p.y };
    return;
  }
  const gegriffen = greife(p);
  if (gegriffen && gegriffen.id !== aktiv) {
    aktiv = gegriffen.id;
    zeigeStriche();
  }
  ziehen = { art: "strich" };
  if (!gegriffen) bewegeStrich(p); // daneben geklickt: der aktive Strich springt hin
});

stapel.addEventListener("pointermove", (event) => {
  if (!ziehen || !stapel.hasPointerCapture(event.pointerId)) return;
  const p = imFeld(event);
  if (ziehen.art === "strich") bewegeStrich(p);
  else {
    rahmenBeimZiehen = { links: Math.min(ziehen.x, p.x), rechts: Math.max(ziehen.x, p.x), unten: Math.min(ziehen.y, p.y), oben: Math.max(ziehen.y, p.y) };
    zeichneNeu();
  }
});

function lassLos() {
  if (ziehen?.art === "ausschnitt" && rahmenBeimZiehen) {
    const r = rahmenBeimZiehen;
    rahmenBeimZiehen = null;
    if (r.rechts - r.links > 0.02 && r.oben - r.unten > 0.02) {
      // vom Feld (das bei der Lupe schon ein Ausschnitt ist) zurück ins ganze Video
      const [l, u, re, o] = rechtecke().bereich;
      ausschnitt = [l + r.links * (re - l), u + r.unten * (o - u), l + r.rechts * (re - l), u + r.oben * (o - u)];
      passeFeldAn();
    }
  }
  ziehen = null;
  zeichneNeu();
}
stapel.addEventListener("pointerup", lassLos);
stapel.addEventListener("pointercancel", lassLos);

// ---------- Eigene Frequenzen für einzelne Zeilen ----------

function zeigeEigene() {
  const text = [...eigene.entries()].sort((a, b) => a[0] - b[0]).map(([z, f]) => `Zeile ${z}: ${zeigeFrequenz(f)}`);
  hole("eigeneListe").textContent = text.length ? text.join(", ") : "keine";
}

hole("eigeneSetzen").addEventListener("click", () => {
  const zeile = Math.round(Number(hole("eigeneZeile").value));
  const hz = Number(hole("eigeneHz").value);
  if (!(zeile >= 0 && zeile < einstellung.zeilen && hz >= 20 && hz <= 20000)) {
    zeige(`Zeile 0 bis ${einstellung.zeilen - 1} und 20 bis 20000 Hz.`);
    return;
  }
  zeige("");
  eigene.set(zeile, hz);
  zeigeEigene();
  sendeStriche();
});
hole("eigeneLoeschen").addEventListener("click", () => {
  eigene.clear();
  zeigeEigene();
  sendeStriche();
});

// ---------- Maus-Info: welcher Strich, welche Zeile, welcher Ton ----------

richteMausInfoEin(stapel, hole("mausInfo"), (x, y) => {
  if (!quelleDa) return null;
  const s = findeStrich(aktiv);
  const g = grenzen.get(s.id);
  // Lage längs des aktiven Strichs (vom tiefen Ende aus)
  let l = s.senkrecht ? 1 - y : x;
  if (s.rueckwaerts) l = 1 - l;
  let zeile = 0;
  while (zeile < einstellung.zeilen - 1 && g[2 * zeile + 1] < l) zeile++;
  const nummer = striche.indexOf(s) + 1;
  if (s.art === "welle") return `Strich ${nummer} · Wellenform, ${zeigeFrequenz(s.grundton)} ${notenName(s.grundton)}\nZeile ${zeile}: ${Math.round((werte[striche.indexOf(s)]?.[zeile] ?? 0) * 100)} %`;
  const f = frequenzen.get(s.id)[zeile];
  const hell = werte[striche.indexOf(s)]?.[zeile] ?? 0;
  return `Strich ${nummer} · Zeile ${zeile} · ${zeigeFrequenz(f)} ${notenName(f)}\nam Strich: ${Math.round(hell * 100)} % hell`;
});

// ---------- Export ----------

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name: "video-zu-ton",
  anzeige: () => gesamtBild(),
  liveTon: () => klang.liveTon(),
});

const videoExport = richteVideoExportEin({
  lese: (neu) => ({ werte: lese(neu).map((w) => w.slice()), noten: letzteNoten }),
  vergiss: () => ausloeser.vergiss(),
  zeichne: (mitWerten) => {
    if (mitWerten) {
      gpu.ladeBild(video);
      gpu.vorbereite(vorbereitung(), false);
    }
    return gesamtBild(mitWerten ?? werte);
  },
  klangDaten: () => ({
    striche: klangStriche(),
    einstellung: klangEinstellung(),
    originalton: einstellung.originalton,
  }),
  fortschritt: (text) => {
    exportLaeuft = text !== null;
    fortschritt.textContent = text ?? "";
    fortschritt.hidden = text === null;
  },
  zeige,
});

// ---------- Knöpfe ----------

function beiDatei(id, aktion) {
  hole(id).addEventListener("change", (event) => {
    const datei = event.target.files[0];
    event.target.value = "";
    if (datei) aktion(datei);
  });
}
beiDatei("datei", (datei) => nimmQuelle(() => oeffneDatei(datei)));
hole("kamera").addEventListener("click", () => nimmQuelle(() => oeffneKamera(true)));
hole("rueckkamera").addEventListener("click", () => nimmQuelle(() => oeffneKamera(false)));
hole("ganzesBild").addEventListener("click", () => {
  ausschnitt = null;
  passeFeldAn();
});
hole("strichDazu").addEventListener("click", () => {
  if (striche.length >= MAX_STRICHE) return;
  const s = neuerStrich({ mitte: Math.random() * 0.8 + 0.1 });
  striche.push(s);
  aktiv = s.id;
  sendeStriche();
  zeigeStriche();
});
for (const [id, vorlage] of [["vorlageEiner", "einer"], ["vorlageStereo", "stereo"], ["vorlageAkkord", "akkord"]]) {
  hole(id).addEventListener("click", () => setzeStriche(VORLAGEN[vorlage]()));
}
hole("wavSpeichern").addEventListener("click", () => videoExport.wav());
hole("videoRendern").addEventListener("click", () => videoExport.videoRendern());

pauseKnopf.addEventListener("click", () => {
  if (!quelleDa) return;
  if (video.paused) {
    video.play();
    pauseKnopf.textContent = "Pause";
  } else {
    video.pause();
    pauseKnopf.textContent = "Weiter";
    // dasselbe Bild noch einmal: Bewegung wird 0 (sonst klänge die letzte Bewegung ewig weiter)
    klang.werte(lese(false));
    zeichneNeu();
  }
});

tonKnopf.addEventListener("click", async () => {
  try {
    if (klang.laeuft()) await klang.aus();
    else {
      await klang.an();
      klang.verbindeVideo(video); // Originalton über den Regler
    }
    tonKnopf.textContent = klang.laeuft() ? "Ton aus" : "Ton an";
    tonKnopf.setAttribute("aria-pressed", String(klang.laeuft()));
  } catch (fehler) {
    zeige(`Ton geht nicht: ${fehler.message}`);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea, button")) return;
  if (event.code === "Space") {
    event.preventDefault();
    pauseKnopf.click();
  }
});

// ---------- Start ----------

sendeEinstellung();
zeigeEigene();
sendeStriche();
zeigeStriche();

