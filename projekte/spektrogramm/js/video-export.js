import { zeigeMeldung, LESEKOPF_FARBE } from "./seite.js";
import { gesamtDb, originalTon, dateiName } from "./datei.js";
import { baueExport, mitAchsen } from "./png-export.js";
import { exportBereich } from "./bereich.js";
import { neueAufnahme, schneideTon, ladeHerunter, zeitstempel, warte, FPS } from "/lib/export.js";

const videoSpeichern = hole("videoSpeichern");
const KOPF_BREITE = 3; 

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
  if (exportBereich().zuKurz) {
    zeigeMeldung("Der Bereich ist zu kurz.");
    return;
  }

  videoSpeichern.disabled = true; // nicht zweimal gleichzeitig
  let aufnahme = null;
  try {
    // Hintergrund einmal (Gesamtbild, Achsen, Einsätze), danach pro Bild nur kopieren und Strich darüber
    // Immer "wie angezeigt": eine Spalte pro Stück wäre für ein Video zu breit (H.264 schafft etwa 4096 Pixel)
    // von, bis: der Exportbereich in Sekunden (ohne Bereich die ganze Datei)
    const { bild, links, oben, breite, hoehe, zeitZuX, von, bis } = baueExport(mitAchsen.checked, "anzeige");
    const rahmen = document.createElement("canvas"); 
    rahmen.width = bild.width;
    rahmen.height = bild.height;
    const c = rahmen.getContext("2d");

    const ton = { kanaele: originalTon.numberOfChannels, rate: originalTon.sampleRate };
    aufnahme = await neueAufnahme(rahmen, FPS, "#111111", ton);

    const anzahl = Math.ceil((bis - von) * FPS); // so viele Bilder, wie der Bereich lang ist
    const rate = originalTon.sampleRate;
    let letztePause = performance.now();
    for (let i = 0; i < anzahl; i++) {
      const t = i / FPS; // Zeit im Video (fängt bei 0 an)
      const zeitImTon = von + t; // dieselbe Stelle in der Datei
      c.drawImage(bild, 0, 0);
      // ganz am Anfang und Ende liegt die Zeit vor der ersten bzw. hinter der letzten Stückmitte
      const x = Math.min(Math.max(Math.round(links + zeitZuX(zeitImTon)), links), links + breite - KOPF_BREITE);
      c.fillStyle = LESEKOPF_FARBE;
      c.fillRect(x, oben, KOPF_BREITE, hoehe);

      // der Ton für genau dieses Bild: bis zum nächsten Bild, aber nicht über das Bereichsende
      const anfang = Math.round(zeitImTon * rate);
      const ende = Math.round(Math.min(von + (i + 1) / FPS, bis) * rate);
      const tonStueck = schneideTon(originalTon, anfang, ende);
      // Bild und Ton gleichzeitig abgeben und auf beide warten
      await Promise.all([aufnahme.bild(rahmen, t, 1 / FPS), tonStueck && aufnahme.ton(tonStueck)]);

      if (performance.now() - letztePause > 50) {
        videoSpeichern.textContent = `Video … ${Math.round(((i + 1) / anzahl) * 100)} %`;
        await warte();
        letztePause = performance.now();
      }
    }

    videoSpeichern.textContent = "Speichern …";
    ladeHerunter(await aufnahme.fertig(), `${dateiName}-spektrogramm-${zeitstempel()}.mp4`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeigeMeldung(`Das Video ist fehlgeschlagen: ${fehler.message}`);
  } finally {
    videoSpeichern.disabled = false;
    videoSpeichern.textContent = "Video speichern";
  }
});
