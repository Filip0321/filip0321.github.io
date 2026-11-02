// Mikrofon aufnehmen: liefert die Samples in Stücken, schon auf 48 kHz umgerechnet.
//
// Die Aufnahme läuft in einem eigenen AudioContext mit der Rate des Geräts, nicht im 48-kHz-Kontext
// des Klangs: Firefox (und Zen) verweigern ein Mikrofon in einem Kontext mit anderer Rate.
// Weicht die Rate ab (z. B. 44,1 kHz), wird während der Aufnahme einfach gerade zwischen zwei Samples
// gerechnet (lineare Interpolation, gut genug zum Zuschauen), am Ende einmal sauber mit dem Browser
// (OfflineAudioContext). Das Ergebnis am Ende ist das, was in die Ebene kommt.

import { oeffneMikrofon } from "/lib/audio-eingang.js";
import { RATE } from "./leinwand.js";

const WORKLET = new URL("./aufnahme-worklet.js", import.meta.url);

// beiStueck(samples48k): neue Samples (auf 48 kHz), während aufgenommen wird
// Rückgabe: { stoppe() } -> Promise mit allen Samples auf 48 kHz
export async function starteAufnahme(beiStueck) {
  const strom = await oeffneMikrofon();
  const kontext = new AudioContext(); // Rate wie das Gerät
  await kontext.audioWorklet.addModule(WORKLET);
  const quelle = kontext.createMediaStreamSource(strom);
  const knoten = new AudioWorkletNode(kontext, "aufnahme", { numberOfOutputs: 1 });
  // ein Knoten läuft nur, wenn am Ende jemand zuhört: also an den Ausgang, aber stumm
  const stumm = new GainNode(kontext, { gain: 0 });
  quelle.connect(knoten).connect(stumm).connect(kontext.destination);

  const rate = kontext.sampleRate;
  const roh = []; // alle Stücke in der Rate des Geräts
  const schritt = rate / RATE; // so viele Geräte-Samples pro 48-kHz-Sample
  let lesePos = 0; // nächstes 48-kHz-Sample, gemessen in Geräte-Samples
  let vorige = 0; // letztes Sample des vorigen Stücks (zum Verbinden über die Grenze)
  let gelesen = 0; // so viele Geräte-Samples kamen vor diesem Stück

  function umrechnen(stueck) {
    if (rate === RATE) return stueck;
    const aus = [];
    while (lesePos < gelesen + stueck.length - 1) {
      const i = lesePos - gelesen; // Stelle in diesem Stück (mit Komma)
      const j = Math.floor(i);
      const a = j < 0 ? vorige : stueck[j];
      const b = stueck[j + 1];
      aus.push(a + (b - a) * (i - j));
      lesePos += schritt;
    }
    vorige = stueck[stueck.length - 1];
    gelesen += stueck.length;
    return Float32Array.from(aus);
  }

  let fertig = null;
  knoten.port.onmessage = ({ data }) => {
    if (data === "fertig") {
      fertig?.();
      return;
    }
    roh.push(data);
    beiStueck(umrechnen(data));
  };

  async function stoppe() {
    await new Promise((weiter) => {
      fertig = weiter;
      knoten.port.postMessage("stopp");
    });
    strom.getTracks().forEach((spur) => spur.stop()); // Mikrofon wieder frei (das Lämpchen geht aus)
    await kontext.close();

    const laenge = roh.reduce((n, s) => n + s.length, 0);
    const alle = new Float32Array(laenge);
    let pos = 0;
    for (const s of roh) {
      alle.set(s, pos);
      pos += s.length;
    }
    if (rate === RATE || !laenge) return alle;
    // sauber umrechnen: der Browser spielt die Aufnahme in einen 48-kHz-Kontext ab
    const offline = new OfflineAudioContext(1, Math.round((laenge * RATE) / rate), RATE);
    const puffer = new AudioBuffer({ length: laenge, numberOfChannels: 1, sampleRate: rate });
    puffer.copyToChannel(alle, 0);
    const abspieler = new AudioBufferSourceNode(offline, { buffer: puffer });
    abspieler.connect(offline.destination);
    abspieler.start();
    return (await offline.startRendering()).getChannelData(0);
  }

  return { stoppe };
}

// eine Ton-Datei (auch ein Video mit Ton) -> Samples auf 48 kHz, alle Kanäle zusammen
//
// Am iPhone ging das nicht: Safari dekodiert in einem OfflineAudioContext nicht jede Datei (und ältere
// Versionen kennen dort nur die alte Schreibweise mit Rückruf statt Promise). Darum drei Versuche:
//   1. OfflineAudioContext mit 48 kHz: rechnet die Rate gleich mit um (Chrome, Firefox)
//   2. ein normaler AudioContext, mit Rückruf und Promise zugleich (Safari)
//   3. danach selbst auf 48 kHz umrechnen, falls die Rate noch anders ist
async function dekodiere(bytes) {
  try {
    return await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.slice(0)); // slice: decodeAudioData verbraucht den Speicher
  } catch {
    // weiter mit Versuch 2
  }
  const Kontext = window.AudioContext || window.webkitAudioContext;
  const kontext = new Kontext();
  try {
    return await new Promise((fertig, fehler) => {
      const versprechen = kontext.decodeAudioData(bytes.slice(0), fertig, fehler);
      versprechen?.catch?.(fehler); // neue Browser geben zusätzlich ein Promise zurück
    });
  } finally {
    kontext.close?.();
  }
}

async function auf48k(puffer) {
  if (puffer.sampleRate === RATE) return puffer;
  const offline = new OfflineAudioContext(puffer.numberOfChannels, Math.ceil(puffer.duration * RATE), RATE);
  const abspieler = new AudioBufferSourceNode(offline, { buffer: puffer });
  abspieler.connect(offline.destination);
  abspieler.start();
  return offline.startRendering();
}

export async function ladeTon(datei) {
  let puffer;
  try {
    puffer = await auf48k(await dekodiere(await datei.arrayBuffer()));
  } catch {
    throw new Error(`„${datei.name}“ kann dieser Browser nicht lesen. Am iPhone gehen m4a, mp3, wav und aif sicher.`);
  }
  const samples = new Float32Array(puffer.length);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k);
    for (let i = 0; i < kanal.length; i++) samples[i] += kanal[i] / puffer.numberOfChannels;
  }
  return samples;
}
