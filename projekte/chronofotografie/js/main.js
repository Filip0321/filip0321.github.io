// Chronofotografie: hier wird alles verbunden. Die Arbeit steckt in den Modulen:
//   /lib/video-quelle.js  Videodatei Bild für Bild (Mediabunny, WebCodecs), Ton
//   /lib/ringpuffer.js    Ringpuffer als Textur-Array
//   gpu.js                Einlegen (mit Maske), Grundbild, Median, Mischen, Anzeigen
//   shader.js             die Shader dazu
//   ablauf.js             Grundbild und Median, Standbild, Video Bild für Bild
//   einsaetze.js          Takt aus dem Ton
//
// Die Vorschau rechnet klein (höchstens 960 Pixel breit, am Handy 640), der Export noch einmal ganz,
// in einer eigenen GPU-Instanz in der gewählten Größe.

import { richteReglerEin } from "/lib/regler.js";
import { neueAufnahme, schneideTon, ladeHerunter, speichereCanvas, zeitstempel, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { oeffneVideo, ladeTon } from "/lib/video-quelle.js";
import { richteChronoEin } from "./gpu.js";
import { bereite, standbildZeiten, rechneStandbild, videoSchritte } from "./ablauf.js";
import { findeEinsaetze } from "./einsaetze.js";

const bild = hole("bild");
const stapel = hole("stapel");
const meldung = hole("meldung");
const info = hole("info");
const fortschritt = hole("fortschritt");
const rechnen = hole("rechnen");

const VORSCHAU = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900 ? 640 : 960;

const vorschau = richteChronoEin(bild);
let quelle = null;
let maske = null; // Maskenvideo (aus DaVinci o. Ä.: weiß = Objekt), oder null
let ton = null; // AudioBuffer des Videos oder der Musik (oder null)
let einsaetze = [];
let platz = 0; // so viele Bilder passen in den Ringpuffer der Vorschau
let laeuft = null; // { stopp } solange die Vorschau ein Video abspielt
let beschaeftigt = false;

const { einstellung, felder, setze } = richteReglerEin({
  beiAenderung: () => mischeNeu(),
  extra: {
    empfindlichkeit: () => sucheTakt(),
    takt: () => sucheTakt(),
    grundbild: () => neuesGrundbild(),
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

// die Einstellungen, wie ablauf.js und gpu.js sie wollen
function auswahl() {
  const von = Math.min(einstellung.von, einstellung.bis);
  // ohne Maskenvideo kann die Maske nur aus dem Median kommen
  let art = einstellung.erkennen;
  if (art !== "median" && !maske) art = "median";
  if (einstellung.hintergrund === "keiner") art = "keine";
  return {
    von,
    bis: Math.max(einstellung.bis, von + 0.1),
    abstand: einstellung.abstand,
    anzahl: Math.min(einstellung.anzahl, platz),
    takt: einstellung.takt,
    stroboskop: einstellung.stroboskop,
    art: einstellung.art,
    hintergrund: einstellung.hintergrund,
    grundbild: einstellung.grundbild,
    maske: art,
    radius: einstellung.radius,
    verstaerkung: einstellung.verstaerkung,
    schwelle: einstellung.schwelle,
    weich: einstellung.weich,
    deckkraft: einstellung.deckkraft,
    verblassen: einstellung.verblassen,
  };
}

// nur neu mischen (der Puffer bleibt): Mischart, Deckkraft, Verblassen, Schwelle wirken sofort
function mischeNeu() {
  if (!quelle || laeuft || beschaeftigt) return;
  if (einstellung.zeigen === "ergebnis") {
    const e = auswahl();
    const video = einstellung.modus === "video";
    vorschau.mische({ ...e, fenster: video ? e.anzahl : Infinity, mitAktuell: video && !(e.takt && e.stroboskop) });
  } else vorschau.zeige(einstellung.zeigen);
}

async function neuesGrundbild() {
  if (!quelle || beschaeftigt || laeuft) return;
  beschaeftigt = true;
  try {
    await bereite(vorschau, quelle, quelle.groesse(VORSCHAU), { ...auswahl(), maske: "keine", hintergrund: "grundbild" });
  } finally {
    beschaeftigt = false;
    mischeNeu();
  }
}

// ---------- Video öffnen ----------

hole("datei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  event.target.value = "";
  if (!datei) return;
  halteAn();
  zeige("");
  zeigeFortschritt("Öffnen …");
  try {
    quelle = await oeffneVideo(datei);
    maske = null;
    hole("maskenInfo").textContent = "";
    const g = quelle.groesse(VORSCHAU);
    platz = vorschau.stelleGroesse(g.breite, g.hoehe, 256);
    stapel.style.setProperty("--verhaeltnis", `${g.breite} / ${g.hoehe}`);
    // Zeitregler auf die Länge des Videos
    for (const name of ["von", "bis", "grundbild"]) felder[name].max = quelle.dauer.toFixed(1);
    setze("von", 0);
    setze("bis", Number(Math.min(quelle.dauer, 10).toFixed(1)));
    setze("grundbild", 0);
    felder.anzahl.max = platz;
    if (einstellung.anzahl > platz) setze("anzahl", platz);
    info.textContent = `${quelle.breite} × ${quelle.hoehe}, ${quelle.fps.toFixed(2).replace(".", ",")} Bilder/s, ${quelle.dauer.toFixed(1).replace(".", ",")} s. Vorschau ${g.breite} × ${g.hoehe}, bis zu ${platz} Bilder im Puffer.`;
    ton = await ladeTon(datei);
    einsaetze = [];
    sucheTakt();
    await rechne();
  } catch (fehler) {
    console.error(fehler);
    quelle = null;
    zeige(fehler.message);
  } finally {
    zeigeFortschritt(null);
  }
});

// Maskenvideo: gleich lang wie das Video, weiß = Objekt (z. B. aus DaVinci mit Magic Mask exportiert)
hole("maskenDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  event.target.value = "";
  if (!datei || !quelle) return;
  try {
    maske = await oeffneVideo(datei);
    const passt = Math.abs(maske.dauer - quelle.dauer) < 0.2 && Math.abs(maske.fps - quelle.fps) < 0.5;
    hole("maskenInfo").textContent = `Maske: ${datei.name}` + (passt ? "" : " (Achtung: andere Länge oder Bildrate als das Video, die Bilder passen dann nicht genau)");
    if (einstellung.erkennen === "median") setze("erkennen", "datei");
    zeige("");
  } catch (fehler) {
    zeige(`Maskenvideo: ${fehler.message}`);
  }
});

function sucheTakt() {
  const taktInfo = hole("taktInfo");
  if (!einstellung.takt) {
    taktInfo.textContent = "";
    return;
  }
  if (!ton) {
    taktInfo.textContent = "Dieses Video hat keinen Ton (oder der Browser kann ihn nicht lesen). Wähl eine Musik.";
    einsaetze = [];
    return;
  }
  einsaetze = findeEinsaetze(ton, einstellung.empfindlichkeit);
  const imBereich = einsaetze.filter((t) => t >= einstellung.von && t <= einstellung.bis).length;
  taktInfo.textContent = `${einsaetze.length} Einsätze gefunden, ${imBereich} im Bereich.`;
}

// Musik statt des Videotons: für den Takt, und sie kommt auch ins exportierte Video
hole("musik").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  event.target.value = "";
  if (!datei) return;
  const musik = await ladeTon(datei);
  if (!musik) return zeige(`„${datei.name}“ kann der Browser nicht lesen.`);
  ton = musik;
  zeige("");
  sucheTakt();
  hole("taktInfo").textContent += ` (aus ${datei.name})`;
});

// ---------- Vorschau rechnen ----------

async function rechne() {
  if (!quelle || beschaeftigt) return;
  halteAn();
  beschaeftigt = true;
  rechnen.disabled = true;
  const e = auswahl();
  const g = quelle.groesse(VORSCHAU);
  try {
    // neu rechnen heißt auch: Median und Grundbild neu (Bereich und Zeit können sich geändert haben)
    vorschau.stelleGroesse(g.breite, g.hoehe, 256);
    zeigeFortschritt("Grundbild und Median …");
    await bereite(vorschau, quelle, g, e);
    if (einstellung.modus === "standbild") {
      zeigeFortschritt("Bilder holen …");
      await rechneStandbild(vorschau, quelle, maske, g, e, standbildZeiten(quelle, e, einsaetze));
      setze("zeigen", "ergebnis");
    } else {
      beschaeftigt = false;
      await spiele();
    }
  } catch (fehler) {
    console.error(fehler);
    zeige(`Rechnen ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
    rechnen.disabled = false;
    zeigeFortschritt(null);
  }
}

// Video in der Vorschau: Bild für Bild, nie schneller als in Echtzeit
async function spiele() {
  const lauf = { stopp: false };
  laeuft = lauf;
  hole("anhalten").disabled = false;
  const e = auswahl();
  const g = quelle.groesse(VORSCHAU);
  const start = performance.now();
  try {
    for await (const { t } of videoSchritte(vorschau, quelle, maske, g, e, einsaetze)) {
      if (lauf.stopp) break;
      zeigeFortschritt(`${t.toFixed(1).replace(".", ",")} s`);
      const warten = start + (t - e.von) * 1000 - performance.now(); // wann dieses Bild dran wäre
      await new Promise((weiter) => setTimeout(weiter, Math.max(0, warten)));
    }
  } finally {
    if (laeuft === lauf) laeuft = null;
    hole("anhalten").disabled = true;
    zeigeFortschritt(null);
  }
}

function halteAn() {
  if (laeuft) laeuft.stopp = true;
  laeuft = null;
}

rechnen.addEventListener("click", rechne);
hole("anhalten").addEventListener("click", halteAn);

// ---------- Export in voller Größe ----------
// Eine eigene GPU-Instanz auf einem eigenen Canvas in Exportgröße: Puffer, Grundbild und Median werden
// dort noch einmal gerechnet. So ist die Vorschau schnell und der Export trotzdem scharf.

const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(bild, einst) });

function exportGroesse() {
  return quelle.groesse(Number(einstellung.exportBreite));
}

async function neueExportInstanz(g, e) {
  const leinwand = document.createElement("canvas");
  const chrono = richteChronoEin(leinwand);
  const passt = chrono.stelleGroesse(g.breite, g.hoehe, e.anzahl);
  if (passt < e.anzahl) zeige(`In ${g.breite} × ${g.hoehe} passen nur ${passt} Bilder in den Grafikspeicher, es werden weniger übereinandergelegt.`);
  const e2 = { ...e, anzahl: Math.min(e.anzahl, passt) };
  zeigeFortschritt("Grundbild und Median …");
  await bereite(chrono, quelle, g, e2);
  return { leinwand, chrono, e: e2 };
}

hole("bildSpeichern").addEventListener("click", async () => {
  if (!quelle || beschaeftigt) return;
  halteAn();
  const einst = await dialog.oeffne({ art: "bild", ueberschrift: "Bild speichern (volle Größe)" });
  if (!einst) return;
  beschaeftigt = true;
  try {
    const g = exportGroesse();
    const { leinwand, chrono, e } = await neueExportInstanz(g, auswahl());
    zeigeFortschritt("Bilder holen …");
    if (einstellung.modus === "standbild") {
      await rechneStandbild(chrono, quelle, maske, g, e, standbildZeiten(quelle, e, einsaetze));
    } else {
      // im Video-Modus: das letzte Bild des Bereichs, mit allem, was sich bis dahin aufgebaut hat
      for await (const _schritt of videoSchritte(chrono, quelle, maske, g, e, einsaetze)); // nur durchlaufen
    }
    await speichereCanvas(mitRahmen(leinwand, einst), einst.bildTyp, `${quelle.name}-chrono-${zeitstempel()}`);
  } catch (fehler) {
    console.error(fehler);
    zeige(`Speichern ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
    zeigeFortschritt(null);
  }
});

hole("videoRendern").addEventListener("click", async () => {
  if (!quelle || beschaeftigt) return;
  halteAn();
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
  if (!einst) return;
  beschaeftigt = true;
  let aufnahme = null;
  try {
    const g = exportGroesse();
    const { leinwand, chrono, e } = await neueExportInstanz(g, auswahl());
    const fps = Math.round(quelle.fps);
    const mitTon = einstellung.mitTon && ton;
    const rahmen = document.createElement("canvas");
    const bildMitRahmen = () => mitRahmen(leinwand, einst, rahmen);
    chrono.mische({ ...e, fenster: 0, mitAktuell: false }); // ein erstes Bild für die Größe
    aufnahme = await neueAufnahme(bildMitRahmen(), fps, undefined, mitTon ? { kanaele: ton.numberOfChannels, rate: ton.sampleRate } : null, einst.videoTyp);
    const bilderGesamt = Math.round((e.bis - e.von) * quelle.fps);
    let i = 0;
    for await (const { n } of videoSchritte(chrono, quelle, maske, g, e, einsaetze)) {
      const t = (n - 1) / fps;
      const stueck = mitTon && schneideTon(ton, Math.round((e.von + t) * ton.sampleRate), Math.round((e.von + t + 1 / fps) * ton.sampleRate));
      await Promise.all([aufnahme.bild(bildMitRahmen(), t, 1 / fps), stueck && aufnahme.ton(stueck)]);
      if (++i % 5 === 0) {
        zeigeFortschritt(`Video … ${Math.min(100, Math.round((i / bilderGesamt) * 100))} %`);
        await warte();
      }
    }
    zeigeFortschritt("Speichern …");
    ladeHerunter(await aufnahme.fertig(), `${quelle.name}-chrono-${zeitstempel()}.${aufnahme.endung}`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
    zeigeFortschritt(null);
  }
});
