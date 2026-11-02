// Seite <-> Stimmen (stimmen-worklet.js): startet den Audio-Thread erst nach einem Klick
// (Browser-Regel) und schickt ihm Striche, Helligkeiten und Einstellungen.
//
// Dazu der Originalton des Videos: Das <video> wird über createMediaElementSource in denselben
// AudioContext geleitet und kommt mit einem eigenen Regler dazu (0 = nur der erzeugte Ton).
// Das geht pro <video> nur einmal, darum hängt quelle.js immer am selben Element.

const RATE = 48000;
const WORKLET = new URL("./stimmen-worklet.js", import.meta.url);

export function richteKlangEin() {
  let kontext = null;
  let knoten = null;
  let original = null; // GainNode für den Originalton
  let aufnahmeZiel = null; // für „Live aufnehmen“: alles, was klingt, als MediaStream
  let startet = null;
  const stand = { striche: null, einstellung: {}, originalton: 0, video: null }; // was er beim Start nachgereicht bekommt

  async function starte() {
    startet ??= (async () => {
      kontext = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
      await kontext.audioWorklet.addModule(WORKLET);
      knoten = new AudioWorkletNode(kontext, "stimmen", { outputChannelCount: [2] });
      aufnahmeZiel = kontext.createMediaStreamDestination();
      knoten.connect(kontext.destination);
      knoten.connect(aufnahmeZiel);
      original = new GainNode(kontext, { gain: stand.originalton });
      original.connect(kontext.destination);
      original.connect(aufnahmeZiel);
      sende({ art: "einstellung", werte: stand.einstellung });
      if (stand.striche) sende({ art: "striche", striche: stand.striche });
      if (stand.video) verbindeVideo(stand.video);
    })();
    await startet;
  }

  // ab jetzt kommt der Ton des Videos durch den Regler statt direkt aus dem Lautsprecher
  const verbunden = new WeakSet();
  function verbindeVideo(video) {
    stand.video = video;
    if (!kontext || verbunden.has(video)) return;
    kontext.createMediaElementSource(video).connect(original);
    video.muted = false; // stumm war es nur, damit es ohne Klick abspielen durfte
    verbunden.add(video);
  }

  function sende(nachricht) {
    knoten?.port.postMessage(nachricht);
  }

  return {
    async an() {
      await starte();
      await kontext.resume();
    },
    async aus() {
      await kontext?.suspend();
    },
    laeuft: () => kontext?.state === "running",
    striche(striche) {
      stand.striche = striche;
      sende({ art: "striche", striche });
    },
    werte: (werte) => sende({ art: "werte", werte }),
    einstellung(werte) {
      Object.assign(stand.einstellung, werte);
      sende({ art: "einstellung", werte });
    },
    originalton(wert) {
      stand.originalton = wert;
      if (original) original.gain.value = wert;
    },
    verbindeVideo,
    liveTon: () => (aufnahmeZiel ? { spur: aufnahmeZiel.stream.getAudioTracks()[0], kanaele: 2, rate: RATE } : null),
  };
}

// Den Ton zu einem ganzen Video auf einmal (so schnell es geht, nicht in Echtzeit):
// zeitplan = { fps, bilder, werte: [pro Strich ein Float32Array bilder · zeilen] }
// originalTon: AudioBuffer des Videos oder null, originalton: wie laut er dazukommt
export async function rendere({ striche, einstellung, zeitplan, sekunden, originalTon = null, originalton = 0 }) {
  const offline = new OfflineAudioContext(2, Math.max(1, Math.round(sekunden * RATE)), RATE);
  await offline.audioWorklet.addModule(WORKLET);
  const knoten = new AudioWorkletNode(offline, "stimmen", {
    outputChannelCount: [2],
    processorOptions: { striche, einstellung, zeitplan },
  });
  knoten.connect(offline.destination);
  if (originalTon && originalton > 0) {
    const abspieler = new AudioBufferSourceNode(offline, { buffer: originalTon });
    const regler = new GainNode(offline, { gain: originalton });
    abspieler.connect(regler).connect(offline.destination);
    abspieler.start();
  }
  return offline.startRendering();
}
