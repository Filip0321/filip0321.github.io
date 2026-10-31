import { zeigeMeldung } from "./seite.js";
import { originalTon, dateiName, gesamtDb } from "./datei.js";
import { baueExport, mitAchsen, frageExport, zeichneVideoBild } from "./png-export.js";
import { exportBereich } from "./bereich.js";
import { neueAufnahme, schneideTon, ladeHerunter, zeitstempel, warte, FPS } from "/lib/export.js";
import { mitRahmen } from "/lib/export-dialog.js";

const videoSpeichern = hole("videoSpeichern");

// der Ton im Bereich als eigener Puffer, wahlweise umgedreht (rückwärts)
function ausschnitt(ton, von, bis, umdrehen) {
  const anfang = Math.round(von * ton.sampleRate);
  const ende = Math.round(bis * ton.sampleRate);
  const stueck = new AudioBuffer({ length: ende - anfang, numberOfChannels: ton.numberOfChannels, sampleRate: ton.sampleRate });
  for (let k = 0; k < ton.numberOfChannels; k++) {
    const samples = ton.getChannelData(k).slice(anfang, ende); // Kopie: reverse() dreht sonst die Datei selbst um
    if (umdrehen) samples.reverse();
    stueck.copyToChannel(samples, k);
  }
  return stueck;
}

videoSpeichern.addEventListener("click", async () => {
  zeigeMeldung("");
  if (!gesamtDb || !originalTon) {
    zeigeMeldung("Erst eine Datei laden.");
    return;
  }
  if (typeof Mediabunny === "undefined" || typeof VideoEncoder === "undefined") {
    zeigeMeldung("Dein Browser kann keine Videos kodieren.");
    return;
  }

  const einst = await frageExport("video"); // Rahmen, Format, Größe, Bereich, Ablauf, rückwärts
  if (!einst) return; // abgebrochen
  if (exportBereich().zuKurz) {
    zeigeMeldung("Der Bereich ist zu kurz.");
    return;
  }

  videoSpeichern.disabled = true; // nicht zweimal gleichzeitig
  let aufnahme = null;
  try {
    // Hintergrund einmal (Gesamtbild, Achsen, Einsätze), danach pro Bild nur kopieren, Strich darüber
    // von, bis: der Exportbereich in Sekunden (ohne Bereich die ganze Datei)
    const exp = baueExport(mitAchsen.checked, "anzeige");
    const { von, bis } = exp;
    const rahmen = document.createElement("canvas");
    rahmen.width = exp.bild.width;
    rahmen.height = exp.bild.height;
    const c = rahmen.getContext("2d");
    const mitRand = document.createElement("canvas"); // jedes Bild mit Rahmen hier hinein (ein Canvas für alle)

    const ton = ausschnitt(originalTon, von, bis, einst.rueckwaerts); // fängt bei 0 an, wie das Video
    aufnahme = await neueAufnahme(mitRahmen(rahmen, einst, mitRand), FPS, "#111111", {
      kanaele: ton.numberOfChannels,
      rate: ton.sampleRate,
    }, einst.videoTyp);

    const anzahl = Math.ceil((bis - von) * FPS); // so viele Bilder, wie der Bereich lang ist
    const rate = ton.sampleRate;
    let letztePause = performance.now();
    for (let i = 0; i < anzahl; i++) {
      const t = i / FPS; // Zeit im Video (fängt bei 0 an)
      const zeitImTon = einst.rueckwaerts ? bis - t : von + t; // rückwärts läuft der Strich vom Ende zum Anfang
      zeichneVideoBild(c, exp, zeitImTon, einst);

      // der Ton für genau dieses Bild: bis zum nächsten Bild
      const tonStueck = schneideTon(ton, Math.round(t * rate), Math.round(((i + 1) / FPS) * rate));
      // Bild und Ton gleichzeitig abgeben und auf beide warten
      await Promise.all([aufnahme.bild(mitRahmen(rahmen, einst, mitRand), t, 1 / FPS), tonStueck && aufnahme.ton(tonStueck)]);

      if (performance.now() - letztePause > 50) {
        videoSpeichern.textContent = `Video ... ${Math.round(((i + 1) / anzahl) * 100)} %`;
        await warte();
        letztePause = performance.now();
      }
    }

    videoSpeichern.textContent = "Speichern ...";
    const richtung = einst.rueckwaerts ? "-rueckwaerts" : "";
    ladeHerunter(await aufnahme.fertig(), `${dateiName}-spektrogramm${richtung}-${zeitstempel()}.${aufnahme.endung}`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeigeMeldung(`Das Video ist fehlgeschlagen: ${fehler.message}`);
  } finally {
    videoSpeichern.disabled = false;
    videoSpeichern.textContent = "Video speichern";
  }
});
