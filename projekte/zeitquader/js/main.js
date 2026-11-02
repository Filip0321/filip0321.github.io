// Zeitquader: Slit-Scan, Zeitversatz und Video-Quader. Hier wird alles verbunden:
//   /lib/video-quelle.js  Videodatei Bild für Bild (Mediabunny)
//   /lib/ringpuffer.js    Ringpuffer als Textur-Array
//   gpu.js, shader.js     die drei Ansichten
//   kamera.js             Kamera, die um den Quader kreist
//
// Quelle ist eine Videodatei oder die Kamera (live: Schlitz und Zeitversatz, wie eine Installation).

import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin, neueAufnahme, schneideTon, ladeHerunter, zeitstempel, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { oeffneVideo, ladeTon } from "/lib/video-quelle.js";
import { richteZeitEin } from "./gpu.js";
import { kamera } from "./kamera.js";

const bild = hole("bild");
const stapel = hole("stapel");
const meldung = hole("meldung");
const fortschritt = hole("fortschritt");

const VORSCHAU = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900 ? 480 : 720;
const MAX_SCHLITZE = 4096; // so breit darf ein Schlitzbild höchstens werden (Texturgrenze vieler Geräte)

const gpu = richteZeitEin(bild);
let quelle = null; // Videodatei
let ton = null;
let kameraVideo = null; // <video> mit der Kamera, wenn live
let lauf = null; // { stopp } solange etwas abspielt
const blickWinkel = { drehung: 0.6, neigung: 0.35, abstand: 3.2 };

const { einstellung, felder, setze } = richteReglerEin({
  beiAenderung: () => zeichneNeu(),
  extra: {
    ansicht: () => {
      halteAn();
      zeigeArt();
    },
    dehnung: () => schlitzGroesse && !lauf && zeigeSchlitzbild(),
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

function halteAn() {
  if (lauf) lauf.stopp = true;
  lauf = null;
}

const bereich = () => {
  const von = Math.min(einstellung.von, einstellung.bis);
  return { von, bis: Math.max(einstellung.bis, von + 0.1) };
};

// Feld im passenden Seitenverhältnis (Schlitzbild, Video oder Quader-Ansicht)
function feld(breite, hoehe) {
  stapel.style.setProperty("--verhaeltnis", `${breite} / ${hoehe}`);
}

function zeigeArt() {
  hole("kameraHinweis").hidden = !(kameraVideo && einstellung.ansicht === "quader");
}

// ---------- die drei Ansichten neu zeichnen (ohne neu zu lesen) ----------

let quaderBereit = false;
let schlitzGroesse = null; // { breite, hoehe } des Schlitzbildes, wenn eins da ist
let schlitzVerschiebung = 0;

function quaderEinstellung() {
  return { art: einstellung.art, deckkraft: einstellung.deckkraft, schwelle: einstellung.schwelle, laenge: einstellung.laenge, schnitt: einstellung.schnitt, schnittLage: einstellung.schnittLage };
}

function zeichneQuader(ziel = gpu, breite = bild.clientWidth * (devicePixelRatio || 1), hoehe = bild.clientHeight * (devicePixelRatio || 1), winkel = blickWinkel) {
  const b = Math.round(Math.min(breite, 1600));
  const h = Math.round((b * hoehe) / breite);
  ziel.quader(quaderEinstellung(), kamera(winkel, b / h), b, h);
}

// Schlitzbild in der Anzeige: jedes Bild „dehnung“ Pixel breit (sonst ist ein kurzes Video ein schmaler Streifen)
function schlitzGedehnt({ breite, hoehe }) {
  const senkrecht = einstellung.richtung === "senkrecht";
  return senkrecht ? { breite: breite * einstellung.dehnung, hoehe } : { breite, hoehe: hoehe * einstellung.dehnung };
}

function zeigeSchlitzbild() {
  const { breite, hoehe } = schlitzGedehnt(schlitzGroesse);
  if (!kameraVideo) feld(breite, hoehe);
  const faktor = Math.min(1, 1600 / Math.max(breite, hoehe));
  gpu.zeigeSchlitz(Math.round(breite * faktor), Math.round(hoehe * faktor), schlitzVerschiebung, einstellung.richtung === "senkrecht");
}

function zeichneNeu() {
  if (lauf) return; // während des Abspielens zeichnet die Schleife selbst
  if (einstellung.ansicht === "quader" && quaderBereit) zeichneQuader();
  else if (einstellung.ansicht === "schlitz" && schlitzGroesse) zeigeSchlitzbild();
  else if (einstellung.ansicht === "versatz" && gpu.gefuellt()) gpu.versatz(versatzEinstellung());
}

const versatzEinstellung = (zeit = performance.now() / 1000) => ({ muster: einstellung.muster, tiefe: einstellung.tiefe, zeit });

// ---------- Quelle ----------

hole("datei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  event.target.value = "";
  if (!datei) return;
  halteAn();
  stoppeKamera();
  zeige("");
  try {
    quelle = await oeffneVideo(datei);
    for (const name of ["von", "bis"]) felder[name].max = quelle.dauer.toFixed(1);
    setze("von", 0);
    setze("bis", Number(Math.min(quelle.dauer, 10).toFixed(1)));
    hole("info").textContent = `${quelle.breite} × ${quelle.hoehe}, ${quelle.fps.toFixed(2).replace(".", ",")} Bilder/s, ${quelle.dauer.toFixed(1).replace(".", ",")} s.`;
    ton = await ladeTon(datei);
    zeigeArt();
    await rechne();
  } catch (fehler) {
    console.error(fehler);
    zeige(fehler.message);
  }
});

function stoppeKamera() {
  kameraVideo?.srcObject?.getTracks().forEach((s) => s.stop());
  kameraVideo = null;
}

hole("kamera").addEventListener("click", async () => {
  halteAn();
  try {
    const strom = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    stoppeKamera();
    kameraVideo = document.createElement("video");
    kameraVideo.muted = true;
    kameraVideo.playsInline = true;
    kameraVideo.srcObject = strom;
    await kameraVideo.play();
    quelle = null;
    zeigeArt();
    live();
  } catch (fehler) {
    zeige(fehler.name === "NotAllowedError" ? "Kamera nicht erlaubt." : `Kamera: ${fehler.message}`);
  }
});

// ---------- Rechnen (Datei) ----------

function arbeitsGroesse(maxBreite) {
  return quelle.groesse(maxBreite);
}

async function rechne() {
  if (kameraVideo) return live();
  if (!quelle) return;
  halteAn();
  const meins = { stopp: false };
  lauf = meins;
  const { von, bis } = bereich();
  try {
    if (einstellung.ansicht === "quader") {
      await baueQuader(gpu, arbeitsGroesse(Number(einstellung.quaderBreite)), von, bis, meins);
    } else if (einstellung.ansicht === "schlitz") {
      const g = arbeitsGroesse(VORSCHAU * 2);
      await baueSchlitz(gpu, g, von, bis, meins, (i) => i % 4 === 0 && zeigeSchlitzbild());
    } else {
      await spieleVersatz(meins);
    }
  } catch (fehler) {
    console.error(fehler);
    zeige(`Rechnen ging nicht: ${fehler.message}`);
  } finally {
    if (lauf === meins) lauf = null;
    zeigeFortschritt(null);
    zeichneNeu();
  }
}

// Quader: n Bilder gleichmäßig über den Bereich, Ebene 0 = ältestes
async function baueQuader(ziel, g, von, bis, meins) {
  const n = Math.max(2, Math.min(einstellung.quaderBilder, ziel.stelleGroesse(g.breite, g.hoehe, einstellung.quaderBilder)));
  ziel.stelleGroesse(g.breite, g.hoehe, n);
  const zeiten = Array.from({ length: n }, (_, i) => von + (i / (n - 1)) * (bis - von) * 0.999);
  let i = 0;
  for await (const b of quelle.bilderZu(g, zeiten)) {
    if (meins.stopp) return;
    if (b) ziel.lege(b.canvas);
    if (++i % 8 === 0) {
      zeigeFortschritt(`Quader füllen … ${Math.round((i / n) * 100)} %`);
      await warte();
    }
  }
  ziel.rechneReferenz();
  if (ziel === gpu) {
    quaderBereit = true;
    feld(16, 9);
  }
}

// Schlitz: jedes Bild des Bereichs gibt eine Spalte (oder Zeile); bei sehr vielen Bildern nur jedes k-te
async function baueSchlitz(ziel, g, von, bis, meins, beiBild) {
  const senkrecht = einstellung.richtung === "senkrecht";
  const gesamt = Math.round((bis - von) * quelle.fps);
  const jedes = Math.max(1, Math.ceil(gesamt / MAX_SCHLITZE));
  const anzahl = Math.ceil(gesamt / jedes);
  ziel.stelleGroesse(g.breite, g.hoehe, 2);
  const s = ziel.neuerSchlitz(anzahl, senkrecht);
  if (ziel === gpu) {
    schlitzGroesse = { breite: s.breite, hoehe: s.hoehe };
    schlitzVerschiebung = 0;
  }
  let n = 0;
  let i = 0;
  for await (const b of quelle.bilder(g, von, bis)) {
    if (meins.stopp || i >= anzahl) break;
    if (n++ % jedes) continue;
    ziel.lege(b.canvas);
    ziel.schreibeSchlitz(i, einstellung.lage, senkrecht);
    await beiBild?.(i, anzahl);
    if (++i % 16 === 0) {
      zeigeFortschritt(`Schlitz … ${Math.round((i / anzahl) * 100)} %`);
      await warte();
    }
  }
}

// Zeitversatz: Bild für Bild in Echtzeit abspielen
async function spieleVersatz(meins) {
  const g = arbeitsGroesse(VORSCHAU);
  gpu.stelleGroesse(g.breite, g.hoehe, einstellung.tiefe + 2);
  feld(g.breite, g.hoehe);
  const { von, bis } = bereich();
  const start = performance.now();
  for await (const b of quelle.bilder(g, von, bis)) {
    if (meins.stopp) return;
    gpu.lege(b.canvas);
    gpu.versatz(versatzEinstellung());
    const t = b.timestamp - quelle.anfang - von;
    zeigeFortschritt(`${(t + von).toFixed(1).replace(".", ",")} s`);
    await new Promise((weiter) => setTimeout(weiter, Math.max(0, start + t * 1000 - performance.now())));
  }
}

// ---------- live mit der Kamera ----------

function live() {
  halteAn();
  const meins = { stopp: false };
  lauf = meins;
  const v = kameraVideo;
  const breite = Math.min(VORSCHAU, v.videoWidth);
  const hoehe = Math.round((v.videoHeight * breite) / v.videoWidth / 2) * 2;
  // Schlitz live: so viele Spalten wie die Breite, der neueste Schlitz rechts, alles wandert nach links
  const senkrecht = einstellung.richtung === "senkrecht";
  const spalten = senkrecht ? breite : hoehe;
  gpu.stelleGroesse(breite, hoehe, einstellung.tiefe + 2);
  if (einstellung.ansicht === "schlitz") {
    const s = gpu.neuerSchlitz(spalten, senkrecht);
    schlitzGroesse = { breite: s.breite, hoehe: s.hoehe };
  }
  feld(breite, hoehe);
  let i = 0;
  const schritt = () => {
    if (meins.stopp || kameraVideo !== v) return;
    if (einstellung.ansicht === "versatz") {
      gpu.lege(v);
      gpu.versatz(versatzEinstellung());
    } else if (einstellung.ansicht === "schlitz") {
      gpu.lege(v);
      gpu.schreibeSchlitz(i % spalten, einstellung.lage, senkrecht);
      schlitzVerschiebung = ((i % spalten) + 1) / spalten;
      zeigeSchlitzbild();
      i++;
    }
    requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
}

hole("rechnen").addEventListener("click", rechne);
hole("anhalten").addEventListener("click", () => {
  halteAn();
  zeichneNeu();
});

// ---------- Quader drehen: ziehen dreht, Rad oder Regler zoomt ----------

let ziehen = null;
stapel.addEventListener("pointerdown", (event) => {
  if (einstellung.ansicht !== "quader") return;
  stapel.setPointerCapture(event.pointerId);
  ziehen = { x: event.clientX, y: event.clientY, ...blickWinkel };
});
stapel.addEventListener("pointermove", (event) => {
  if (!ziehen || !stapel.hasPointerCapture(event.pointerId)) return;
  blickWinkel.drehung = ziehen.drehung - (event.clientX - ziehen.x) * 0.01;
  blickWinkel.neigung = Math.max(-1.5, Math.min(1.5, ziehen.neigung + (event.clientY - ziehen.y) * 0.01));
  zeichneNeu();
});
stapel.addEventListener("pointerup", () => (ziehen = null));
stapel.addEventListener("wheel", (event) => {
  if (einstellung.ansicht !== "quader") return;
  event.preventDefault();
  blickWinkel.abstand = Math.max(1, Math.min(10, blickWinkel.abstand * Math.exp(event.deltaY * 0.001)));
  zeichneNeu();
}, { passive: false });

// ---------- Export ----------

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name: () => `zeitquader-${einstellung.ansicht}`,
  anzeige: () => bild, // preserveDrawingBuffer: das letzte Bild steht noch im Canvas
});

const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(bild, einst) });

hole("videoRendern").addEventListener("click", async () => {
  if (!quelle && einstellung.ansicht !== "quader") return zeige("Video rendern geht mit einer Videodatei. Mit der Kamera nimm „Live aufnehmen“.");
  if (einstellung.ansicht === "quader" && !quaderBereit) return zeige("Erst einen Quader rechnen.");
  halteAn();
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
  if (!einst) return;
  const meins = { stopp: false };
  lauf = meins;
  let aufnahme = null;
  try {
    const leinwand = document.createElement("canvas");
    const ziel = richteZeitEin(leinwand);
    const rahmen = document.createElement("canvas");
    const mitR = () => mitRahmen(leinwand, einst, rahmen);
    const { von, bis } = bereich();
    const breiteExport = Number(einstellung.exportBreite);
    let bildNr = 0;
    const fps = einstellung.ansicht === "quader" ? 30 : Math.round(quelle.fps);
    const mitTon = einstellung.ansicht !== "quader" && einstellung.mitTon && ton;
    const neu = async () => {
      aufnahme ??= await neueAufnahme(mitR(), fps, undefined, mitTon ? { kanaele: ton.numberOfChannels, rate: ton.sampleRate } : null, einst.videoTyp);
    };
    const schreibe = async () => {
      await neu();
      const t = bildNr / fps;
      const stueck = mitTon && schneideTon(ton, Math.round((von + t) * ton.sampleRate), Math.round((von + t + 1 / fps) * ton.sampleRate));
      await Promise.all([aufnahme.bild(mitR(), t, 1 / fps), stueck && aufnahme.ton(stueck)]);
      bildNr++;
    };

    if (einstellung.ansicht === "quader") {
      // Kamerafahrt: einmal rundherum
      const g = arbeitsGroesse(Number(einstellung.quaderBreite));
      await baueQuader(ziel, g, von, bis, meins);
      const n = Math.round(einstellung.fahrt * fps);
      const h = Math.round((breiteExport * 9) / 16 / 2) * 2;
      for (let i = 0; i < n && !meins.stopp; i++) {
        zeichneQuader(ziel, breiteExport, h, { ...blickWinkel, drehung: blickWinkel.drehung + (2 * Math.PI * i) / n });
        await schreibe();
        if (i % 10 === 0) zeigeFortschritt(`Kamerafahrt … ${Math.round((i / n) * 100)} %`);
      }
    } else if (einstellung.ansicht === "schlitz") {
      // das Schlitzbild wächst Bild für Bild
      const g = arbeitsGroesse(breiteExport);
      await baueSchlitz(ziel, g, von, bis, meins, async () => {
        ziel.zeigeSchlitz(...schlitzMasse(ziel));
        await schreibe();
      });
    } else {
      const g = arbeitsGroesse(breiteExport);
      ziel.stelleGroesse(g.breite, g.hoehe, einstellung.tiefe + 2);
      for await (const b of quelle.bilder(g, von, bis)) {
        if (meins.stopp) break;
        ziel.lege(b.canvas);
        ziel.versatz(versatzEinstellung(bildNr / fps));
        await schreibe();
        if (bildNr % 10 === 0) zeigeFortschritt(`Video … ${(bildNr / fps).toFixed(1)} s`);
      }
    }
    zeigeFortschritt("Speichern …");
    if (aufnahme) ladeHerunter(await aufnahme.fertig(), `zeitquader-${einstellung.ansicht}-${zeitstempel()}.${aufnahme.endung}`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    if (lauf === meins) lauf = null;
    zeigeFortschritt(null);
  }
});

// Größe, in der das (wachsende) Schlitzbild ins Video kommt: das ganze Schlitzbild, höchstens 3840 breit
function schlitzMasse() {
  const senkrecht = einstellung.richtung === "senkrecht";
  const { von, bis } = bereich();
  const anzahl = Math.min(MAX_SCHLITZE, Math.round((bis - von) * quelle.fps));
  const g = arbeitsGroesse(Number(einstellung.exportBreite));
  const [b, h] = senkrecht ? [anzahl * einstellung.dehnung, g.hoehe] : [g.breite, anzahl * einstellung.dehnung];
  const f = Math.min(1, 3840 / Math.max(b, h));
  return [Math.round((b * f) / 2) * 2, Math.round((h * f) / 2) * 2];
}

zeigeArt();
