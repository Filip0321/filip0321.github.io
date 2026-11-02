// Export Bild für Bild (wie bei bild-zu-ton): nur mit einer Videodatei, nicht mit der Kamera.
//
// Live klingt, was der Browser gerade schafft; ruckelt er, fehlen Bilder. Beim Export wird stattdessen
// jedes Bild einzeln angesprungen (springe), gelesen, und erst danach der ganze Ton auf einmal gerechnet
// (klang.js, rendere: dieselben Stimmen, aber mit allen Helligkeiten im Voraus). So ist es egal, wie
// langsam der Rechner ist, und Bild und Ton passen auf das Bild genau.
//
// Zwei Durchgänge:
//   1. jedes Bild lesen -> Zeitplan (Helligkeiten pro Bild und Strich) -> Ton rechnen
//   2. (nur Video) jedes Bild noch einmal anspringen, mit Strich und Balken zeichnen, mit seinem
//      Stück Ton in das Video schreiben

import { neueAufnahme, schneideTon, ladeHerunter, zeitstempel, warte, zuWav, FPS } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { video, springe, geoeffneteDatei } from "./quelle.js";
import { rendere } from "./klang.js";

// s: was main.js mitgibt:
//   lese(neu)        das aktuelle Bild des Videos verarbeiten und lesen -> Helligkeiten pro Strich
//   zeichne(werte)   das Feld mit diesen Helligkeiten zeichnen -> Canvas (Video und Strich zusammen)
//   klangDaten()     { striche, einstellung, originalton } wie gerade eingestellt
//   fortschritt(text) / zeige(text)
export function richteVideoExportEin(s) {
  const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(s.zeichne(null), einst) });

  async function originalTon() {
    if (s.klangDaten().originalton <= 0) return null;
    try {
      const bytes = await geoeffneteDatei().arrayBuffer();
      return await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes);
    } catch {
      s.zeige("Den Originalton dieses Videos kann der Browser nicht lesen, es kommt nur der erzeugte Ton.");
      return null;
    }
  }

  // Durchgang 1: von, bis als Anteil des Videos
  async function rechneTon(von, bis) {
    const dauer = video.duration;
    const erstes = Math.round(von * dauer * FPS);
    const letztes = Math.max(erstes + 1, Math.round(bis * dauer * FPS));
    const bilder = letztes - erstes;
    const daten = s.klangDaten();
    const werte = daten.striche.map((st) => new Float32Array(bilder * st.freq.length));
    for (let i = 0; i < bilder; i++) {
      await springe((erstes + i) / FPS);
      // beim ersten Bild gibt es kein voriges: zweimal dasselbe, dann ist die Bewegung 0
      if (i === 0) s.lese(true);
      const w = s.lese(i > 0);
      w.forEach((zeile, j) => werte[j].set(zeile, i * zeile.length));
      if (i % 10 === 0) {
        s.fortschritt(`Lesen … ${Math.round((i / bilder) * 100)} %`);
        await warte();
      }
    }
    s.fortschritt("Ton rechnen …");
    const original = await originalTon();
    // Originalton ab der Stelle "von": ein Stück herausschneiden
    const stueck = original && schneideTon(original, Math.round((erstes / FPS) * original.sampleRate), original.length);
    const ton = await rendere({
      striche: daten.striche,
      einstellung: daten.einstellung,
      zeitplan: { fps: FPS, bilder, werte },
      sekunden: bilder / FPS,
      originalTon: stueck,
      originalton: daten.originalton,
    });
    return { ton, werte, erstes, bilder };
  }

  async function mitPause(aufgabe) {
    if (!geoeffneteDatei()) {
      s.zeige("Bild für Bild geht nur mit einer Videodatei. Mit der Kamera nimm „Live aufnehmen“.");
      return;
    }
    const lief = !video.paused;
    const zeit = video.currentTime;
    s.fortschritt("Vorbereiten …"); // ab jetzt liest nur noch der Export (main.js hält die eigene Schleife an)
    video.pause();
    try {
      await aufgabe();
    } catch (fehler) {
      console.error(fehler);
      s.zeige(`Export ging nicht: ${fehler.message}`);
    } finally {
      s.fortschritt(null);
      await springe(zeit);
      if (lief) video.play();
    }
  }

  async function wav() {
    await mitPause(async () => {
      const { ton } = await rechneTon(0, 1);
      ladeHerunter(zuWav(ton), `video-zu-ton-${zeitstempel()}.wav`);
    });
  }

  async function videoRendern() {
    if (!geoeffneteDatei()) return mitPause(async () => {});
    video.pause();
    const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern (Bild für Bild)", zeit: false, bereich: true, laenge: video.duration });
    if (!einst) return;
    await mitPause(async () => {
      const { ton, werte, erstes, bilder } = await rechneTon(einst.von, einst.bis);
      const rahmen = document.createElement("canvas");
      const bildMitRahmen = (quelle) => mitRahmen(quelle, einst, rahmen);
      let aufnahme = null;
      try {
        aufnahme = await neueAufnahme(bildMitRahmen(s.zeichne(null)), FPS, undefined, { kanaele: 2, rate: ton.sampleRate }, einst.videoTyp);
        for (let i = 0; i < bilder; i++) {
          await springe((erstes + i) / FPS);
          const w = werte.map((alle) => {
            const zeilen = alle.length / bilder;
            return alle.subarray(i * zeilen, (i + 1) * zeilen);
          });
          const bild = bildMitRahmen(s.zeichne(w));
          const stueck = schneideTon(ton, Math.round((i / FPS) * ton.sampleRate), Math.round(((i + 1) / FPS) * ton.sampleRate));
          await Promise.all([aufnahme.bild(bild, i / FPS, 1 / FPS), stueck && aufnahme.ton(stueck)]);
          if (i % 5 === 0) {
            s.fortschritt(`Video … ${Math.round((i / bilder) * 100)} %`);
            await warte();
          }
        }
        s.fortschritt("Speichern …");
        ladeHerunter(await aufnahme.fertig(), `video-zu-ton-${zeitstempel()}.${aufnahme.endung}`);
      } catch (fehler) {
        await aufnahme?.abbrechen();
        throw fehler;
      }
    });
  }

  return { wav, videoRendern };
}
