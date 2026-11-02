// Seite <-> Klang: startet den Audio-Thread (klang-worklet.js) und redet mit ihm über Nachrichten.
//
// Warum ein eigener Thread? Der Ton muss alle paar Millisekunden pünktlich weiterlaufen, egal ob die
// Seite gerade malt, zeichnet oder hängt. Im AudioWorklet läuft der Klang neben der Seite her;
// die beiden teilen sich keinen Speicher, sie schicken sich Nachrichten (port.postMessage).
// Darum hat der Klang seine eigene Kopie aller Ebenen und bekommt jede Änderung geschickt.
//
// Ein AudioContext darf erst nach einem Klick starten (Browser-Regel gegen Lärm beim Öffnen),
// darum entsteht alles erst beim ersten Abspielen. Bis dahin werden Nachrichten nicht geschickt:
// beim Start holt sich der Klang den ganzen Stand auf einmal (holeZustand).
//
// Dieselbe Stimme rechnet auch die WAV: in einem OfflineAudioContext, so schnell es geht statt in
// Echtzeit, mit genau demselben Klang wie beim Hören.

import { RATE } from "./leinwand.js";

const WORKLET = new URL("./klang-worklet.js", import.meta.url); // relativ zu dieser Datei, egal wo die Seite liegt

// was der Klang von einer Ebene braucht (nicht das Bild selbst, nur die Zahlen), als Kopie
export function fuerKlang(e) {
  const gemeinsam = { id: e.id, art: e.art, gain: e.gain, stumm: e.stumm };
  if (e.art !== "ton") return { ...gemeinsam, werte: e.werte.slice() };
  return {
    ...gemeinsam,
    start: e.start,
    spalten: e.spalten,
    filter: e.filter,
    betrag: e.betrag.slice(),
    phase: e.phase.slice(),
    dreh: e.dreh.slice(),
    maske: e.maske.slice(),
  };
}

// welche Speicher bei einer Nachricht übergeben statt kopiert werden (danach gehören sie dem Klang)
function speicherVon(ebene) {
  return ["werte", "betrag", "phase", "dreh", "maske"].filter((f) => ebene[f]).map((f) => ebene[f].buffer);
}

export function richteKlangEin({ beiPosition, beiEnde, holeZustand }) {
  let kontext = null;
  let knoten = null;
  let aufnahmeZiel = null; // für „Live aufnehmen“ im Export: was gerade klingt, als MediaStream
  let startet = null; // Promise, solange addModule noch lädt (zweimal schnell klicken: nur einmal starten)

  async function starte() {
    if (knoten) return;
    startet ??= (async () => {
      kontext = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
      await kontext.audioWorklet.addModule(WORKLET);
      knoten = new AudioWorkletNode(kontext, "spektral-stimme", {
        outputChannelCount: [1],
        processorOptions: { zustand: holeZustand() }, // alles, was bis jetzt passiert ist
      });
      knoten.connect(kontext.destination);
      aufnahmeZiel = kontext.createMediaStreamDestination();
      knoten.connect(aufnahmeZiel);
      knoten.port.onmessage = ({ data }) => {
        if (data.art === "position") beiPosition(data.spalte, data.laeuft);
        else if (data.art === "ende") beiEnde(data.spalte);
      };
    })();
    await startet;
  }

  function sende(nachricht, uebergeben = []) {
    knoten?.port.postMessage(nachricht, uebergeben);
  }

  return {
    laeuftSchon: () => Boolean(knoten),
    neueLeinwand: (leinwand) => sende({ art: "neu", leinwand }),
    ebene(e) {
      if (!knoten) return;
      const kopie = fuerKlang(e);
      sende({ art: "ebene", ebene: kopie }, speicherVon(kopie));
    },
    weg: (id) => sende({ art: "weg", id }),
    eigenschaften: (id, werte) => sende({ art: "eigenschaften", id, werte }),
    // ein Stück eines Feldes: werte = quelle[von .. bis) (als Kopie, die Seite behält ihre)
    teil(id, feld, quelle, von, bis) {
      if (!knoten) return;
      const werte = quelle.slice(von, bis);
      sende({ art: "teil", id, feld, von, werte }, [werte.buffer]);
    },
    einstellung: (werte) => sende({ art: "einstellung", werte }),
    position: (spalte) => sende({ art: "position", spalte }),
    async spiele() {
      await starte();
      await kontext.resume(); // nach einer Pause oder wenn der Browser ihn angehalten hat
      sende({ art: "spiel", laeuft: true });
    },
    halte: () => sende({ art: "spiel", laeuft: false }),
    liveTon: () => (aufnahmeZiel ? { spur: aufnahmeZiel.stream.getAudioTracks()[0], kanaele: 1, rate: RATE } : null),
  };
}

// Der ganze Ton in einem Stück (WAV, Video): zustand wie bei holeZustand, sekunden lang
export async function rendere(zustand, sekunden) {
  const offline = new OfflineAudioContext(1, Math.max(1, Math.round(sekunden * RATE)), RATE);
  await offline.audioWorklet.addModule(WORKLET);
  const knoten = new AudioWorkletNode(offline, "spektral-stimme", {
    outputChannelCount: [1],
    processorOptions: { zustand: { ...zustand, laeuft: true } },
  });
  knoten.connect(offline.destination);
  return offline.startRendering(); // ein AudioBuffer
}
