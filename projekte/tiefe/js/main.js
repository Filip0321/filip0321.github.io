// Tiefe aus Fotos: hier wird alles verbunden.
//   ausrichten.js  die Fotos zueinander ausrichten (Harris-Ecken, Paare, senkrechter Versatz)
//   stereo.js      vor und nach dem Block Matching (CPU)
//   gpu.js         Block Matching, Ansichten, Punktwolke (WebGL2), Shader in shader.js
//   ausgaben.js    Autostereogramm, Tiefenkarte als PNG, Punktwolke als PLY
//   kamera.js      Kamera für die Punktwolke (aus dem Zeitquader)
//
// Ablauf: Fotos öffnen → ausrichten (automatisch) → Rechnen → Ansichten und Export.

import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin, neueAufnahme, ladeHerunter, zeitstempel, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { farbtabelle, skalaAnker, hexZuRgb } from "/lib/farben.js";
import { ladeVerlauf } from "/lib/verlauf.js";
import { graubild, findeEcken, findePaare, passeAn, richteAus } from "./ausrichten.js";
import { ohneMittel, raeumeAuf, normiere } from "./stereo.js";
import { richteGpuEin } from "./gpu.js";
import { autostereogramm, tiefenkarteBild, plyDatei } from "./ausgaben.js";
import { kamera, flug, kreisZuFlug, vorn } from "./kamera.js";

const bild = hole("bild");
const stapel = hole("stapel");
const meldung = hole("meldung");
const fortschritt = hole("fortschritt");

const gpu = richteGpuEin(bild);
const ANALYSE = 400; // Breite für das Ausrichten

const fotos = { links: null, mitte: null, rechts: null }; // ImageBitmaps
let arbeit = null; // { w, h, farbeRef (ImageData), ausrichtung, drei }
let ergebnis = null; // { t (0 bis 1, −1 ungültig), w, h }
let stereogramm = null; // ImageData, wenn gerechnet
const blickWinkel = { drehung: 0, neigung: 0, abstand: 1.15 };
let flugZustand = kreisZuFlug(blickWinkel);

const { einstellung, setze } = richteReglerEin({
  beiAenderung: () => zeichne(),
  extra: {
    skala: () => neueSkala(),
    ansicht: () => {
      if (einstellung.ansicht === "stereogramm") rechneStereogramm();
      zeigeArt();
    },
    augenabstand: () => einstellung.ansicht === "stereogramm" && rechneStereogramm(),
    stereoTiefe: () => einstellung.ansicht === "stereogramm" && rechneStereogramm(),
    muster: () => einstellung.ansicht === "stereogramm" && rechneStereogramm(),
    steuerung: () => {
      if (einstellung.steuerung === "fliegen") flugZustand = kreisZuFlug(blickWinkel);
    },
  },
});

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}
function zeigeFortschritt(text) {
  fortschritt.textContent = text ?? "";
  fortschritt.hidden = !text;
}
const ruhe = () => new Promise((r) => setTimeout(r, 0));

function neueSkala() {
  gpu.setzeVerlauf(ladeVerlauf(gpu.gl, farbtabelle(skalaAnker(einstellung.skala))));
  zeichne();
}

function zeigeArt() {
  hole("ohneTiefe").hidden = Boolean(ergebnis) || einstellung.ansicht === "anaglyph";
}

// ---------- Fotos öffnen ----------

async function oeffne(platz, datei) {
  if (!datei) return;
  try {
    fotos[platz]?.close();
    // imageOrientation: Handyfotos stehen sonst manchmal quer (die Drehung steht nur in den EXIF-Daten)
    fotos[platz] = await createImageBitmap(datei, { imageOrientation: "from-image" });
    hole(`name-${platz}`).textContent = datei.name;
    ergebnis = null;
    stereogramm = null;
    if (fotos.links && fotos.rechts) await bereiteVor();
  } catch (fehler) {
    zeige(`${datei.name}: ${fehler.message}`);
  }
}

for (const platz of ["links", "mitte", "rechts"]) {
  hole(`datei-${platz}`).addEventListener("change", (e) => oeffne(platz, e.target.files[0]));
}

hole("tauschen").addEventListener("click", async () => {
  [fotos.links, fotos.rechts] = [fotos.rechts, fotos.links];
  const a = hole("name-links").textContent;
  hole("name-links").textContent = hole("name-rechts").textContent;
  hole("name-rechts").textContent = a;
  ergebnis = null;
  if (fotos.links && fotos.rechts) await bereiteVor();
});

// ---------- Ausrichten ----------

// richtet "anderes" am Referenzfoto aus; Rückgabe: { bild (ImageData), modell, dMin, dMax, anzahl, vertauscht }
function richteAn(referenzKlein, anderes, w, h) {
  const klein = graubild(anderes, ANALYSE);
  const ecken = findeEcken(referenzKlein);
  const paare = findePaare(referenzKlein, klein, ecken, { maxDx: Math.round(ANALYSE * 0.15), maxDy: 14 });
  const m = paare.length >= 6 ? passeAn(paare, klein.w, klein.h) : { a: 0, b: 0, c: 0, dMin: 0, dMax: 30, anzahl: paare.length, vertauscht: false };
  const s = w / ANALYSE; // vom kleinen Bild auf die Arbeitsgröße: der Versatz wächst mit, b und c nicht
  const modell = einstellung.ausrichten ? { a: m.a * s, b: m.b, c: m.c } : { a: 0, b: 0, c: 0 };
  return { bild: richteAus(anderes, w, h, modell), modell, dMin: m.dMin * s, dMax: m.dMax * s, anzahl: m.anzahl, vertauscht: m.vertauscht };
}

async function bereiteVor() {
  const drei = Boolean(fotos.mitte);
  const referenz = drei ? fotos.mitte : fotos.links;
  const w = Math.min(Number(einstellung.breite), referenz.width);
  const h = Math.round((referenz.height * w) / referenz.width);
  zeigeFortschritt("Ausrichten …");
  await ruhe();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(referenz, 0, 0, w, h);
  const farbeRef = ctx.getImageData(0, 0, w, h);
  const refKlein = graubild(referenz, ANALYSE);
  const r = richteAn(refKlein, fotos.rechts, w, h);
  const l = drei ? richteAn(refKlein, fotos.links, w, h) : null;
  arbeit = { w, h, farbeRef, rechts: r.bild, links: l?.bild ?? null, drei };
  gpu.ladeFarbe("links", farbeRef);
  gpu.ladeFarbe("rechts", r.bild);
  stapel.style.setProperty("--verhaeltnis", `${w} / ${h}`);
  zeigeFortschritt(null);

  if (r.vertauscht) {
    zeige("Die Fotos scheinen vertauscht zu sein (das rechte Foto muss weiter rechts aufgenommen sein). „Tauschen“ drücken.");
  } else if (r.anzahl < 6) {
    zeige("Zu wenige gemeinsame Merkpunkte gefunden: Die Fotos sind zu verschieden, zu glatt oder weit auseinander. Ausrichten und Suchbereich bitte von Hand.");
  } else {
    // Suchbereich mit etwas Luft
    setze("dMin", Math.max(-20, Math.floor(r.dMin - 4)));
    setze("dMax", Math.min(250, Math.ceil(r.dMax + 4)));
    const grad = (Math.atan(r.modell.b) * 180) / Math.PI;
    zeige(`${r.anzahl} Merkpunkte. Rechts: ${r.modell.a.toFixed(1).replace(".", ",")} px Höhe, ${grad.toFixed(2).replace(".", ",")}° gedreht. Suchbereich ${einstellung.dMin} bis ${einstellung.dMax} px.`);
  }
  setze("ansicht", "anaglyph");
  zeigeArt();
  zeichne();
}

hole("neuAusrichten").addEventListener("click", () => fotos.links && fotos.rechts && bereiteVor());

// ---------- Rechnen ----------

hole("rechnen").addEventListener("click", async () => {
  if (!arbeit) return zeige("Erst ein linkes und ein rechtes Foto öffnen.");
  const { w, h, drei } = arbeit;
  const knopf = hole("rechnen");
  knopf.disabled = true;
  try {
    const r = einstellung.radius;
    const grauVon = (bildDaten) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").putImageData(bildDaten, 0, 0);
      return ohneMittel(graubild(c, w), r + 1);
    };
    gpu.ladeGrau(drei ? "mitte" : "links", grauVon(arbeit.farbeRef));
    gpu.ladeGrau("rechts", grauVon(arbeit.rechts));
    if (drei) gpu.ladeGrau("links", grauVon(arbeit.links));
    const e = { dMin: Math.round(einstellung.dMin), dMax: Math.round(Math.max(einstellung.dMin + 1, einstellung.dMax)), radius: r, abschneiden: einstellung.abschneiden, besseresPaar: einstellung.besseresPaar };
    const start = performance.now();
    const links = await gpu.rechneDisparitaet(
      drei ? { ...e, referenz: "mitte", anderes: "rechts", drittes: "links", richtung: 1 } : { ...e, referenz: "links", anderes: "rechts", richtung: 1 },
      (a) => zeigeFortschritt(`Block Matching … ${Math.round(a * (drei ? 100 : 50))} %`),
    );
    // Prüfung andersherum (nur mit zwei Fotos): das rechte als Referenz, gesucht wird bei x + d
    const rechts = drei ? null : await gpu.rechneDisparitaet({ ...e, referenz: "rechts", anderes: "links", richtung: -1 }, (a) => zeigeFortschritt(`Prüfen … ${Math.round(50 + a * 50)} %`));
    zeigeFortschritt("Aufräumen …");
    await ruhe();
    const sauber = raeumeAuf(links, rechts, w, h, { eindeutigkeit: einstellung.eindeutigkeit, median: einstellung.median, fuellen: !einstellung.loecherZeigen });
    const { t } = normiere(sauber, { ungueltigZeigen: einstellung.loecherZeigen });
    ergebnis = { t, w, h };
    gpu.ladeTiefe(t, w, h);
    stereogramm = null;
    const anteil = Math.round((sauber.gueltig.reduce((a, b) => a + b, 0) / (w * h)) * 100);
    zeige(`Fertig in ${((performance.now() - start) / 1000).toFixed(1).replace(".", ",")} s. Gültig (${drei ? "eindeutig" : "beide Richtungen einig und eindeutig"}): ${anteil} %.`);
    if (einstellung.ansicht === "anaglyph") setze("ansicht", "tiefenkarte");
    zeigeArt();
    zeichne();
  } catch (fehler) {
    console.error(fehler);
    zeige(`Rechnen ging nicht: ${fehler.message}`);
  } finally {
    knopf.disabled = false;
    zeigeFortschritt(null);
  }
});

// ---------- Zeichnen ----------

const MODI = { anaglyph: 0, tiefenkarte: 1, schaerfe: 2, nebel: 3, farbe: 4, stereogramm: 5 };

function ansichtEinstellung() {
  return {
    modus: MODI[einstellung.ansicht] ?? 0,
    fokus: einstellung.fokus,
    staerke: einstellung.staerke,
    mischung: einstellung.ansicht === "tiefenkarte" ? (einstellung.skala === "grau" ? 0 : 1) : einstellung.mischung,
    nebelFarbe: hexZuRgb(einstellung.nebelFarbe).map((x) => x / 255),
  };
}

function wolkeEinstellung(vp) {
  return {
    vp,
    schritt: einstellung.schritt,
    brennweite: einstellung.brennweite / 24, // Kleinbild: Bildhöhe 24 mm
    relief: einstellung.form === "relief" ? 1 : 0,
    tiefenFaktor: einstellung.tiefenFaktor,
    groesse: einstellung.punktgroesse,
    hintergrund: hexZuRgb(einstellung.wolkeGrund).map((x) => x / 255),
  };
}

const aktuelleKamera = (sv) => (einstellung.steuerung === "fliegen" ? flug(flugZustand, sv) : kamera(blickWinkel, sv));

function zeichne(ziel = gpu, b = Math.round(bild.clientWidth * (devicePixelRatio || 1)), h = Math.round(bild.clientHeight * (devicePixelRatio || 1)), macheKamera = aktuelleKamera) {
  if (!arbeit) return;
  b = Math.max(2, Math.min(b, 2400));
  h = Math.max(2, Math.round((b * arbeit.h) / arbeit.w));
  if (einstellung.ansicht === "wolke" && ergebnis) ziel.zeigeWolke(wolkeEinstellung(macheKamera(b / h).vp), b, h);
  else if (einstellung.ansicht === "anaglyph" || ergebnis) ziel.zeigeAnsicht(ansichtEinstellung(), b, h);
}

function rechneStereogramm() {
  if (!ergebnis) return;
  const { t, w, h } = ergebnis;
  let muster = null;
  if (einstellung.muster === "foto") {
    // ein Streifen aus dem Foto als Muster, so breit wie eine Wiederholung
    const c = document.createElement("canvas");
    const b = Math.round(einstellung.augenabstand);
    c.width = b;
    c.height = h;
    c.getContext("2d").putImageData(arbeit.farbeRef, -Math.round(w / 2 - b / 2), 0);
    muster = c.getContext("2d").getImageData(0, 0, b, h);
  }
  stereogramm = autostereogramm(t, w, h, { augenabstand: einstellung.augenabstand, tiefe: einstellung.stereoTiefe, muster });
  gpu.ladeFarbe("extra", stereogramm);
  zeichne();
}

new ResizeObserver(() => zeichne()).observe(bild);

// Klick ins Bild: bei Schärfentiefe dort scharf stellen
bild.addEventListener("click", (event) => {
  if (!ergebnis || einstellung.ansicht !== "schaerfe") return;
  const r = bild.getBoundingClientRect();
  const x = Math.floor(((event.clientX - r.left) / r.width) * ergebnis.w);
  const y = Math.floor(((event.clientY - r.top) / r.height) * ergebnis.h);
  setze("fokus", Number(Math.max(0, ergebnis.t[y * ergebnis.w + x]).toFixed(2)));
  zeichne();
});

// ---------- Punktwolke drehen und fliegen (wie im Zeitquader) ----------

let ziehen = null;
stapel.addEventListener("pointerdown", (event) => {
  if (einstellung.ansicht !== "wolke") return;
  stapel.setPointerCapture(event.pointerId);
  ziehen = { x: event.clientX, y: event.clientY, ...blickWinkel, gier: flugZustand.gier, nick: flugZustand.nick };
});
stapel.addEventListener("pointermove", (event) => {
  if (!ziehen || !stapel.hasPointerCapture(event.pointerId)) return;
  const dx = event.clientX - ziehen.x;
  const dy = event.clientY - ziehen.y;
  if (einstellung.steuerung === "fliegen") {
    flugZustand.gier = ziehen.gier - dx * 0.005;
    flugZustand.nick = Math.max(-1.5, Math.min(1.5, ziehen.nick - dy * 0.005));
  } else {
    blickWinkel.drehung = ziehen.drehung - dx * 0.006;
    blickWinkel.neigung = Math.max(-1.4, Math.min(1.4, ziehen.neigung + dy * 0.006));
  }
  zeichne();
});
stapel.addEventListener("pointerup", () => (ziehen = null));
stapel.addEventListener("wheel", (event) => {
  if (einstellung.ansicht !== "wolke") return;
  event.preventDefault();
  if (einstellung.steuerung === "fliegen") fliege(-event.deltaY * 0.001, 0, 0);
  else blickWinkel.abstand = Math.max(0.2, Math.min(8, blickWinkel.abstand * Math.exp(event.deltaY * 0.001)));
  zeichne();
}, { passive: false });

function fliege(vor, seit, hoch) {
  const v = vorn(flugZustand.gier, flugZustand.nick);
  const r = [-Math.cos(flugZustand.gier), 0, Math.sin(flugZustand.gier)];
  for (let k = 0; k < 3; k++) flugZustand.pos[k] += v[k] * vor + r[k] * seit + (k === 1 ? hoch : 0);
}

const TASTEN = { w: [1, 0, 0], s: [-1, 0, 0], a: [0, -1, 0], d: [0, 1, 0], e: [0, 0, 1], q: [0, 0, -1], arrowup: [1, 0, 0], arrowdown: [-1, 0, 0], arrowleft: [0, -1, 0], arrowright: [0, 1, 0] };
const gedrueckt = new Set();
let flugSchleife = null;
function flugTakt(zeit, vorher = zeit) {
  if (!gedrueckt.size) {
    flugSchleife = null;
    return;
  }
  const tempo = (gedrueckt.has("shift") ? 1.2 : 0.4) * Math.min(0.05, (zeit - vorher) / 1000);
  const r = [0, 0, 0];
  for (const t of gedrueckt) TASTEN[t]?.forEach((x, k) => (r[k] += x));
  fliege(r[0] * tempo, r[1] * tempo, r[2] * tempo);
  zeichne();
  flugSchleife = requestAnimationFrame((jetzt) => flugTakt(jetzt, zeit));
}
document.addEventListener("keydown", (event) => {
  if (einstellung.ansicht !== "wolke" || einstellung.steuerung !== "fliegen" || event.target.closest("input, select, textarea")) return;
  const taste = event.key.toLowerCase();
  if (!(taste in TASTEN) && taste !== "shift") return;
  event.preventDefault();
  gedrueckt.add(taste);
  flugSchleife ??= requestAnimationFrame((zeit) => flugTakt(zeit));
});
document.addEventListener("keyup", (event) => gedrueckt.delete(event.key.toLowerCase()));

// ---------- Export ----------

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name: () => `tiefe-${einstellung.ansicht}`,
  anzeige: () => bild, // preserveDrawingBuffer: das Bild steht noch im Canvas
});

const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(bild, einst) });

hole("tiefenkarte").addEventListener("click", () => {
  if (!ergebnis) return zeige("Erst rechnen.");
  tiefenkarteBild(ergebnis.t, ergebnis.w, ergebnis.h).toBlob((b) => ladeHerunter(b, `tiefenkarte-${zeitstempel()}.png`));
});

hole("ply").addEventListener("click", () => {
  if (!ergebnis) return zeige("Erst rechnen.");
  const e = wolkeEinstellung(null);
  ladeHerunter(plyDatei(ergebnis.t, arbeit.farbeRef.data, ergebnis.w, ergebnis.h, { ...e, relief: e.relief === 1 }), `punktwolke-${zeitstempel()}.ply`);
});

// Kamerafahrt um die Punktwolke als Video (2,5D: man sieht hinter Kanten, aber dort ist nichts, also Lücken)
hole("videoRendern").addEventListener("click", async () => {
  if (!ergebnis) return zeige("Erst rechnen.");
  setze("ansicht", "wolke");
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Kamerafahrt", zeit: false });
  if (!einst) return;
  let aufnahme = null;
  const leinwand = document.createElement("canvas");
  const ziel = richteGpuEin(leinwand);
  try {
    // dieselben Daten in den zweiten Kontext (jeder Kontext hat seine eigenen Texturen)
    ziel.ladeFarbe("links", arbeit.farbeRef);
    ziel.ladeTiefe(ergebnis.t, ergebnis.w, ergebnis.h);
    ziel.ladeGrau("links", { l: new Float32Array(ergebnis.w * ergebnis.h), w: ergebnis.w, h: ergebnis.h }); // nur für die Größe
    const fps = 30;
    const n = Math.round(einstellung.fahrtDauer * fps);
    const b = Math.round(Number(einstellung.exportBreite) / 2) * 2;
    const h = Math.round((b * arbeit.h) / arbeit.w / 2) * 2;
    const rahmen = document.createElement("canvas");
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const s = Math.sin(t * 2 * Math.PI);
      const k = {
        wackeln: (sv) => kamera({ ...blickWinkel, drehung: blickWinkel.drehung + s * 0.18, neigung: blickWinkel.neigung + Math.cos(t * 2 * Math.PI) * 0.05 }, sv),
        schwenk: (sv) => flug({ pos: [s * 0.25, 0, blickWinkel.abstand], gier: Math.PI, nick: 0 }, sv),
        hinein: (sv) => flug({ pos: [0, 0, blickWinkel.abstand * (1 - 0.5 * (0.5 - 0.5 * Math.cos(t * Math.PI)))], gier: Math.PI, nick: 0 }, sv),
      }[einstellung.fahrt];
      ziel.zeigeWolke(wolkeEinstellung(k(b / h).vp), b, h);
      aufnahme ??= await neueAufnahme(mitRahmen(leinwand, einst, rahmen), fps, undefined, null, einst.videoTyp, einst.videoQualitaet);
      await aufnahme.bild(mitRahmen(leinwand, einst, rahmen), i / fps, 1 / fps);
      if (i % 10 === 0) {
        zeigeFortschritt(`Kamerafahrt … ${Math.round(t * 100)} %`);
        await warte();
      }
    }
    zeigeFortschritt("Speichern …");
    ladeHerunter(await aufnahme.fertig(), `tiefe-fahrt-${zeitstempel()}.${aufnahme.endung}`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    ziel.gl.getExtension("WEBGL_lose_context")?.loseContext();
    zeigeFortschritt(null);
  }
});

if (!gpu.mitFloat) zeige("Achtung: Dein Browser kann nicht in Float-Texturen zeichnen, das Block Matching geht hier nicht.");
neueSkala();
zeigeArt();

