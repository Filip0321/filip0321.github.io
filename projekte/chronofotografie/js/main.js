// Chronofotografie: hier wird alles verbunden. Die Arbeit steckt in den Modulen:
//   quelle.js     Videodatei Bild für Bild (Mediabunny, WebCodecs), Ton
//   gpu.js        Ringpuffer (Textur-Array), Median, Mischen, Anzeigen
//   shader.js     Mischen, Median, Zeigen
//   ablauf.js     Hintergrund, Standbild, Video Bild für Bild
//   einsaetze.js  Takt aus dem Ton
//
// Die Vorschau rechnet klein (höchstens 960 Pixel breit, am Handy 640), der Export noch einmal ganz,
// in einer eigenen GPU-Instanz in der gewählten Größe.

import { richteReglerEin } from "/lib/regler.js";
import { neueAufnahme, schneideTon, ladeHerunter, speichereCanvas, zeitstempel, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { oeffneVideo, ladeTon } from "./quelle.js";
import { richteChronoEin } from "./gpu.js";
import { rechneHintergrund, standbildZeiten, rechneStandbild, videoSchritte } from "./ablauf.js";
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
let ton = null; // AudioBuffer des Videos (oder null)
let einsaetze = [];
let platz = 0; // so viele Bilder passen in den Ringpuffer der Vorschau
let laeuft = null; // { stopp: true/false } solange die Vorschau ein Video abspielt
let beschaeftigt = false;

const { einstellung, felder, setze } = richteReglerEin({
  beiAenderung: () => mischeNeu(),
  extra: {
    empfindlichkeit: () => sucheTakt(),
    takt: () => sucheTakt(),
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
  return {
    von,
    bis: Math.max(einstellung.bis, von + 0.1),
    abstand: einstellung.abstand,
    anzahl: Math.min(einstellung.anzahl, platz),
    takt: einstellung.takt,
    art: einstellung.art,
    abzug: einstellung.abzug,
    schwelle: einstellung.schwelle,
    weich: einstellung.weich,
    deckkraft: einstellung.deckkraft,
    verblassen: einstellung.verblassen,
  };
}

// nur neu mischen (der Puffer bleibt): Mischart, Deckkraft, Verblassen, Abzug wirken sofort
function mischeNeu() {
  if (!quelle || laeuft || beschaeftigt) return;
  if (einstellung.zeigen === "ergebnis") {
    const e = auswahl();
    vorschau.mische({ ...e, fenster: einstellung.modus === "video" ? e.anzahl : Infinity, mitAktuell: einstellung.modus === "video" });
  } else vorschau.zeige(einstellung.zeigen);
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
    const g = quelle.groesse(VORSCHAU);
    platz = vorschau.stelleGroesse(g.breite, g.hoehe, 256);
    stapel.style.setProperty("--verhaeltnis", `${g.breite} / ${g.hoehe}`);
    // Zeitregler auf die Länge des Videos
    for (const name of ["von", "bis"]) felder[name].max = quelle.dauer.toFixed(1);
    setze("von", 0);
    setze("bis", Math.min(quelle.dauer, 10).toFixed(1) * 1);
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

function sucheTakt() {
  const taktInfo = hole("taktInfo");
  if (!einstellung.takt) {
    taktInfo.textContent = "";
    return;
  }
  if (!ton) {
    taktInfo.textContent = "Dieses Video hat keinen Ton (oder der Browser kann ihn nicht lesen).";
    einsaetze = [];
    return;
  }
  einsaetze = findeEinsaetze(ton, einstellung.empfindlichkeit);
  const imBereich = einsaetze.filter((t) => t >= einstellung.von && t <= einstellung.bis).length;
  taktInfo.textContent = `${einsaetze.length} Einsätze gefunden, ${imBereich} im Bereich.`;
}

// ---------- Vorschau rechnen ----------

async function rechne() {
  if (!quelle || beschaeftigt) return;
  halteAn();
  beschaeftigt = true;
  rechnen.disabled = true;
  const e = auswahl();
  const g = quelle.groesse(VORSCHAU);
  try {
    if (e.abzug && !vorschau.hatHintergrund()) {
      zeigeFortschritt("Hintergrund (Median) …");
      await rechneHintergrund(vorschau, quelle, g, e);
    }
    if (einstellung.modus === "standbild") {
      zeigeFortschritt("Bilder holen …");
      const zeiten = standbildZeiten(quelle, e, einsaetze);
      await rechneStandbild(vorschau, quelle, g, e, zeiten);
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
    for await (const { t } of videoSchritte(vorschau, quelle, g, e, einsaetze)) {
      if (lauf.stopp) break;
      zeigeFortschritt(`${t.toFixed(1).replace(".", ",")} s`);
      const soll = start + (t - e.von) * 1000; // wann dieses Bild dran wäre
      const warten = soll - performance.now();
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

rechnen.addEventListener("click", rechne);
hole("anhalten").addEventListener("click", halteAn);
hole("hintergrund").addEventListener("click", async () => {
  if (!quelle || beschaeftigt) return;
  halteAn();
  beschaeftigt = true;
  zeigeFortschritt("Hintergrund (Median) …");
  try {
    await rechneHintergrund(vorschau, quelle, quelle.groesse(VORSCHAU), auswahl());
    setze("zeigen", "hintergrund");
  } finally {
    beschaeftigt = false;
    zeigeFortschritt(null);
    mischeNeu();
  }
});

// ---------- Export in voller Größe ----------
// Eine eigene GPU-Instanz auf einem eigenen Canvas in Exportgröße: Puffer und Hintergrund werden dort
// noch einmal gerechnet. So ist die Vorschau schnell und der Export trotzdem scharf.

const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(bild, einst) });

function exportGroesse() {
  return quelle.groesse(Number(einstellung.exportBreite));
}

function neueExportInstanz(g, e) {
  const leinwand = document.createElement("canvas");
  const chrono = richteChronoEin(leinwand);
  const passt = chrono.stelleGroesse(g.breite, g.hoehe, e.anzahl);
  if (passt < e.anzahl) zeige(`In ${g.breite} × ${g.hoehe} passen nur ${passt} Bilder in den Grafikspeicher, es werden weniger übereinandergelegt.`);
  return { leinwand, chrono, e: { ...e, anzahl: Math.min(e.anzahl, passt) } };
}

hole("bildSpeichern").addEventListener("click", async () => {
  if (!quelle || beschaeftigt) return;
  halteAn();
  const einst = await dialog.oeffne({ art: "bild", ueberschrift: "Bild speichern (volle Größe)" });
  if (!einst) return;
  beschaeftigt = true;
  try {
    const g = exportGroesse();
    const { leinwand, chrono, e } = neueExportInstanz(g, auswahl());
    if (e.abzug) {
      zeigeFortschritt("Hintergrund …");
      await rechneHintergrund(chrono, quelle, g, e);
    }
    zeigeFortschritt("Bilder holen …");
    if (einstellung.modus === "standbild") {
      await rechneStandbild(chrono, quelle, g, e, standbildZeiten(quelle, e, einsaetze));
    } else {
      // im Video-Modus: das letzte Bild des Bereichs, mit allem, was sich bis dahin aufgebaut hat
      for await (const _schritt of videoSchritte(chrono, quelle, g, e, einsaetze)); // nur durchlaufen
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
    const { leinwand, chrono, e } = neueExportInstanz(g, auswahl());
    if (e.abzug) {
      zeigeFortschritt("Hintergrund …");
      await rechneHintergrund(chrono, quelle, g, e);
    }
    const fps = Math.round(quelle.fps);
    const mitTon = einstellung.mitTon && ton;
    const rahmen = document.createElement("canvas");
    const bildMitRahmen = () => mitRahmen(leinwand, einst, rahmen);
    chrono.mische({ ...e, fenster: 0, mitAktuell: false }); // ein erstes Bild für die Größe
    aufnahme = await neueAufnahme(bildMitRahmen(), fps, undefined, mitTon ? { kanaele: ton.numberOfChannels, rate: ton.sampleRate } : null, einst.videoTyp);
    const bilderGesamt = Math.round((e.bis - e.von) * quelle.fps);
    let i = 0;
    for await (const { n } of videoSchritte(chrono, quelle, g, e, einsaetze)) {
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
