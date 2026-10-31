// Export der Foto-Effekte über das gemeinsame Export-Fenster (/lib/export-dialog.js)
// Drei Wege:
//   Bild speichern  das fertige Bild (beim Video: das Bild an der Stelle, wo es gerade steht)
//   Video aus Bild  ein Foto mit bewegten Effekten (VHS, CRT, Video-Overlays) Bild für Bild rendern
//   Video aus Video jedes Bild des Videos durch die Effekte (Mediabunny.Conversion), der Ton bleibt
// Rahmen, Format, Größe, Dateityp, Bereich und das CRT-Häkchen kommen aus dem Fenster.

import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { ladeHerunter, zeitstempel, speichereCanvas, neueAufnahme, FPS, warte, repariereMp4, waehleTonCodec } from "/lib/export.js";

const MAX_SEKUNDEN = 30; // ein Foto als Video: Bild für Bild dauert, darum kurz

function knopf(text) {
  const k = document.createElement("button");
  k.type = "button";
  k.textContent = text;
  return k;
}

export function richteFotoExportEin({
  ziel,          // wohin die Knöpfe kommen
  art,           // () => "bild", "video" oder null (noch nichts geladen)
  rechner,       // () => async (t) => Canvas: das fertige Bild zur Zeit t in Sekunden (ohne Vergleichslinie)
  zeichneSample, // async (sample, t) => Canvas: ein Bild aus dem Video durch die Effekte (für die Konvertierung)
  video,         // () => { datei, dauer, jetzt, breite, hoehe, fit } des geladenen Videos
  anhalten,      // () => Funktion, die danach alles wiederherstellt (Video weiterlaufen lassen, Overlays zurück)
  zuschnitt,     // () => Anteil oder null: CRT als letzter Effekt mit Wölbung nach außen
  hintergrund,   // () => Farbe hinter durchsichtigen Stellen im Video
  durchsichtig,  // () => true, wenn das Bild durchsichtig bleiben soll (PNG ohne Rahmen)
  sperre,        // (gesperrt) => die Bedienung der Seite sperren, solange gerechnet wird
}) {
  const bildKnopf = knopf("Bild speichern");
  const videoKnopf = knopf("Video speichern");
  ziel.append(bildKnopf, videoKnopf);
  const dateiname = () => `foto-effekte-${zeitstempel()}`;

  // nur beim Foto als Video: wie lang (beim Video ergibt sich die Länge aus der Datei)
  const felder = document.createElement("div");
  felder.className = "steuerung nur-video";
  felder.innerHTML = `<label>Sekunden <input type="number" min="1" max="${MAX_SEKUNDEN}" step="1" value="5"></label>`;
  const sekundenFeld = felder.querySelector("input");

  function leseSekunden() {
    let sekunden = Math.round(Number(sekundenFeld.value));
    if (!Number.isFinite(sekunden)) sekunden = 5;
    sekunden = Math.min(Math.max(sekunden, 1), MAX_SEKUNDEN);
    sekundenFeld.value = sekunden;
    return sekunden;
  }

  let rechne = null; // der Rechner für das gerade offene Fenster
  let laenge = () => leseSekunden(); // Sekunden, über die die Zeitleiste geht
  let standbild = 0; // Bild speichern: diese Zeit (beim Video die Stelle, wo es stand)

  const fenster = erstelleExportDialog({
    felder,
    zuschnitt,
    zeichneVorschau: async (allgemein, zeit) => {
      const t = zeit === null ? standbild : zeit * laenge();
      return mitRahmen(await rechne(t), { ...allgemein, durchsichtig: durchsichtig() });
    },
  });

  function bedienung(gesperrt) {
    bildKnopf.disabled = gesperrt;
    videoKnopf.disabled = gesperrt;
    sperre(gesperrt);
  }

  // Knöpfe erst, wenn etwas geladen ist
  function aktualisiere() {
    const nichts = art() === null;
    bildKnopf.disabled = nichts;
    videoKnopf.disabled = nichts || typeof Mediabunny === "undefined" || typeof VideoEncoder === "undefined";
  }

  // Fenster öffnen, solange es offen ist, steht alles (Video angehalten); danach wie vorher
  async function frage(optionen) {
    const zurueck = anhalten();
    standbild = art() === "video" ? video().jetzt : 0;
    rechne = rechner();
    felder.hidden = !(optionen.art === "video" && art() === "bild"); // Sekunden nur beim Foto als Video
    laenge = art() === "video" ? () => video().dauer : () => leseSekunden();
    const einst = await fenster.oeffne({ ...optionen, laenge });
    return { einst, zurueck };
  }

  bildKnopf.addEventListener("click", async () => {
    const { einst, zurueck } = await frage({ art: "bild", ueberschrift: "Bild speichern" });
    try {
      if (einst) {
        const bild = mitRahmen(await rechne(standbild), { ...einst, durchsichtig: durchsichtig() });
        await speichereCanvas(bild, einst.bildTyp, dateiname());
      }
    } catch (fehler) {
      console.error(fehler);
      alert(`Das Bild konnte nicht gespeichert werden: ${fehler.message}`);
    } finally {
      zurueck();
    }
  });

  videoKnopf.addEventListener("click", async () => {
    const { einst, zurueck } = await frage({ art: "video", ueberschrift: "Video speichern" });
    if (!einst) {
      zurueck();
      return;
    }
    bedienung(true);
    try {
      if (art() === "video") await videoAusVideo(einst);
      else await videoAusBild(einst);
    } catch (fehler) {
      console.error(fehler);
      alert(`Beim Rendern ist ein Fehler aufgetreten: ${fehler.message}`);
    } finally {
      videoKnopf.textContent = "Video speichern";
      zurueck();
      bedienung(false);
    }
  });

  // Foto als Video: Bild für Bild, Zeit = i / FPS; nur die Bilder im Bereich kommen hinein
  async function videoAusBild(einst) {
    const n = Math.round(leseSekunden() * FPS);
    const erstes = Math.round(einst.von * (n - 1));
    const letztes = Math.max(erstes, Math.round(einst.bis * (n - 1)));
    const leinwand = document.createElement("canvas"); // ein Canvas für alle Bilder: gleiche Größe
    const mitRand = (bild) => mitRahmen(bild, einst, leinwand);

    let aufnahme = null;
    try {
      aufnahme = await neueAufnahme(mitRand(await rechne(erstes / FPS)), FPS, hintergrund(), null, einst.videoTyp);
      for (let i = erstes; i <= letztes; i++) {
        await aufnahme.bild(mitRand(await rechne(i / FPS)), (i - erstes) / FPS, 1 / FPS);
        videoKnopf.textContent = `Rendern … ${Math.round(((i - erstes + 1) / (letztes - erstes + 1)) * 100)} %`;
        await warte();
      }
      videoKnopf.textContent = "Speichern …";
      ladeHerunter(await aufnahme.fertig(), `${dateiname()}.${aufnahme.endung}`);
    } catch (fehler) {
      await aufnahme?.abbrechen();
      throw fehler;
    }
  }

  // Video durch die Effekte: Mediabunny liest die Datei, verkleinert jedes Bild auf breite × hoehe (fit),
  // gibt es an process, wir setzen Effekte und Rahmen darauf, Mediabunny kodiert das Ergebnis wieder.
  // Der Ton wird mitgenommen; trim schneidet den Bereich aus.
  async function videoAusVideo(einst) {
    const v = video();
    const typ = einst.videoTyp;
    const leinwand = document.createElement("canvas");
    // die Größe nach Rahmen und Format einmal ausrechnen: process muss immer gleich große Bilder liefern
    const probe = document.createElement("canvas");
    probe.width = v.breite;
    probe.height = v.hoehe;
    mitRahmen(probe, einst, leinwand);
    const breite = leinwand.width;
    const hoehe = leinwand.height;

    const start = einst.von * v.dauer;
    const ende = Math.max(start + 1 / FPS, einst.bis * v.dauer);

    const input = new Mediabunny.Input({
      source: new Mediabunny.BlobSource(v.datei),
      formats: Mediabunny.ALL_FORMATS,
    });
    const output = new Mediabunny.Output({
      format: typ === "webm" ? new Mediabunny.WebMOutputFormat() : new Mediabunny.Mp4OutputFormat(),
      target: new Mediabunny.BufferTarget(),
    });

    // Ton: bei MP4 lieber AAC (Handy, WhatsApp), das lädt waehleTonCodec unter Firefox nach
    const tonSpur = await input.getPrimaryAudioTrack();
    let audio = { discard: true };
    if (tonSpur) {
      const codec = await waehleTonCodec(tonSpur.numberOfChannels, tonSpur.sampleRate, typ);
      audio = codec ? { codec } : { discard: true }; // kein Codec: lieber ohne Ton als gar nicht
    }

    const conversion = await Mediabunny.Conversion.init({
      input,
      output,
      trim: { start, end: ende },
      video: {
        width: v.breite,
        height: v.hoehe,
        fit: v.fit,
        processedWidth: breite,
        processedHeight: hoehe,
        // sample.timestamp zählt ab dem Anfang des Bereichs (trim.start ist dann 0);
        // Effekte und Overlays brauchen die Zeit in der Originaldatei, darum start dazu
        process: async (sample) => mitRahmen(await zeichneSample(sample, start + sample.timestamp), einst, leinwand),
      },
      audio,
    });
    if (!conversion.isValid) {
      throw new Error(`Dein Browser kann dieses Video nicht als ${typ.toUpperCase()} speichern. Versuch den anderen Dateityp.`);
    }
    conversion.onProgress = (anteil) => {
      videoKnopf.textContent = `Rendern … ${Math.round(anteil * 100)} %`;
    };
    await conversion.execute();

    videoKnopf.textContent = "Speichern …";
    // Firefox schreibt die H.264-Beschreibung kaputt (WhatsApp lehnt ab): wie bei allen anderen reparieren
    const daten = typ === "mp4" ? repariereMp4(output.target.buffer) : output.target.buffer;
    ladeHerunter(new Blob([daten], { type: `video/${typ}` }), `${dateiname()}.${typ}`);
  }

  aktualisiere();
  return { aktualisiere };
}
