// Ton der geladenen Datei oder Aufnahme als WAV speichern, im Exportbereich

import { zeigeMeldung } from "./seite.js";
import { originalTon, dateiName } from "./datei.js";
import { exportBereich } from "./bereich.js";
import { schneideTon, zuWav, ladeHerunter, zeitstempel } from "/lib/export.js";

const tonSpeichern = hole("tonSpeichern");

tonSpeichern.addEventListener("click", () => {
  zeigeMeldung("");
  if (!originalTon) {
    zeigeMeldung("Erst eine Datei laden oder etwas aufnehmen.");
    return;
  }
  const { von, bis, ganz, zuKurz } = exportBereich();
  if (zuKurz) {
    zeigeMeldung("Der Bereich ist zu kurz.");
    return;
  }
  // Sekunden -> Samples; schneideTon kopiert alle Kanäle
  const rate = originalTon.sampleRate;
  const puffer = ganz ? originalTon : schneideTon(originalTon, Math.round(von * rate), Math.round(bis * rate));
  // WAV statt WebM/MP3: öffnen Ableton und DaVinci ohne Umweg
  ladeHerunter(zuWav(puffer), `${dateiName}-${zeitstempel()}.wav`);
});
