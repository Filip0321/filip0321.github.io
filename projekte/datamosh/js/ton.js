// Ton für das gerenderte Video. Vier Möglichkeiten:
//
//   bilder     Der Ton folgt den Bildern: zu jedem Bild der Folge das Stück Ton (1/fps Sekunden), das zu
//              seinem Paket gehört. Wird ein P-Frame wiederholt, wiederholt sich sein Tonstück: ein Stottern
//              wie bei einer hängenden CD. Ein Sprung springt im Ton mit. Läuft alles normal, liegen die
//              Stücke lückenlos hintereinander und man hört den Originalton.
//   durch      Der Ton des Schnitts läuft ungestört durch (wer oben liegt, ist zu hören), egal was der Mosh
//              mit den Bildern macht. Ist das Video länger als der Schnitt (Halten, Wiederholen), ist es
//              am Ende still.
//   datei      eine eigene Tondatei, ab 0 s
//   aus        kein Ton
//
// Alles wird auf 48 kHz und Stereo gebracht. Stücke von 1/fps Sekunden: bei 30 fps sind das 1600 Samples.
// Damit nichts wegdriftet, wird jede Grenze aus der Bildnummer gerechnet (round(i · rate / fps)), nicht
// aufaddiert.

import { ladeTon } from "/lib/video-quelle.js";
import { paketVon } from "./folge.js";

const RATE = 48000;

// den Ton eines Clips einmal laden und am Clip merken (null: kein Ton, z. B. ein Standbild)
async function tonVon(clip) {
  if (clip.art !== "video") return null;
  if (clip.ton === undefined) clip.ton = await ladeTon(clip.datei);
  return clip.ton;
}

// aus quelle (AudioBuffer) ab Sekunde sek "laenge" Samples nach ziel (Stereo-Float32Arrays) ab Stelle "an"
function kopiere(quelle, sek, laenge, ziel, an) {
  if (!quelle) return;
  const a = Math.round(sek * quelle.sampleRate);
  for (let k = 0; k < 2; k++) {
    const kanal = quelle.getChannelData(Math.min(k, quelle.numberOfChannels - 1)); // Mono auf beide Seiten
    for (let n = 0; n < laenge; n++) {
      const q = a + n;
      if (q >= 0 && q < kanal.length) ziel[k][an + n] = kanal[q];
    }
  }
}

export async function baueTon(art, { daten, folge, grund, clips, datei }) {
  if (art === "aus") return null;
  const fps = daten.fps;
  const grenze = (i) => Math.round((i * RATE) / fps);
  const laenge = grenze(folge.length);
  const ziel = [new Float32Array(laenge), new Float32Array(laenge)];

  if (art === "datei") {
    const ton = datei && (await ladeTon(datei));
    if (!ton) throw new Error("Die Tondatei ließ sich nicht lesen.");
    kopiere(ton, 0, laenge, ziel, 0); // ladeTon liefert schon 48 kHz
  } else {
    const toene = await Promise.all(clips.map(tonVon));
    for (let i = 0; i < folge.length; i++) {
      let clip;
      let bild;
      if (art === "bilder") {
        const p = paketVon(daten, folge[i]);
        clip = p.clip;
        bild = p.bild;
      } else {
        const g = grund[i]; // läuft durch: Bild i des Schnitts, ohne Eingriffe
        if (!g) break;
        clip = g.clip;
        bild = g.k;
      }
      // Sekunde im Original: Bild durch Bildrate, plus der erste Zeitstempel des Videos
      kopiere(toene[clip], (clips[clip].anfang ?? 0) + bild / fps, grenze(i + 1) - grenze(i), ziel, grenze(i));
    }
  }
  const puffer = new AudioBuffer({ length: Math.max(1, laenge), numberOfChannels: 2, sampleRate: RATE });
  puffer.copyToChannel(ziel[0], 0);
  puffer.copyToChannel(ziel[1], 1);
  return puffer;
}

// ---------- Ton beim Abspielen ----------
// Dieselbe Zuordnung wie beim Rendern (welches Tonstück gehört zu Bild i), aber Bild für Bild, in dem Moment,
// in dem es gezeigt wird. Jedes Stück ist ein eigener AudioBufferSourceNode, der genau 1/fps Sekunden aus dem
// Ton seines Clips spielt (start(wann, ab, dauer) liest direkt aus dem ganzen Puffer, kopiert nichts).
// Damit die Stücke lückenlos aneinanderliegen, hängen die Startzeiten an einem Anker: Bild k klingt zur
// Zeit t, Bild i also bei t + (i − k)/fps. Stockt die Anzeige und ein Stück käme zu spät, wird der Anker neu
// gesetzt (kurze Lücke statt einer Verschiebung, die sich aufaddiert).
export function richteAbspielTonEin() {
  let ac = null;
  let anker = null; // { k, t }
  let datei = null; // die eigene Tondatei, zu der dateiTon gehört
  let dateiTon = null;
  const laufend = new Set(); // angesetzte Stücke, damit Anhalten sie abbrechen kann

  return {
    // im Klick aufrufen: Browser lassen Ton erst nach einer Geste des Nutzers anlaufen (Autoplay-Regel)
    wecke() {
      ac ??= new AudioContext();
      ac.resume();
      anker = null;
    },
    // vor dem Abspielen: die Töne laden (am Clip gemerkt, wie beim Rendern)
    async lade(art, clips, tonDatei) {
      if (art === "datei") {
        if (tonDatei !== datei) {
          datei = tonDatei;
          dateiTon = tonDatei ? await ladeTon(tonDatei) : null;
        }
      } else if (art !== "aus") await Promise.all(clips.map(tonVon));
    },
    spiele(art, { daten, folge, grund, clips }, i) {
      if (!ac || art === "aus") return;
      let ton;
      let sek;
      if (art === "datei") {
        ton = dateiTon;
        sek = i / daten.fps;
      } else {
        let clip;
        let bild;
        if (art === "bilder") {
          const p = paketVon(daten, folge[i]);
          clip = p.clip;
          bild = p.bild;
        } else {
          const g = grund[i];
          if (!g) return; // länger als der Schnitt: still, wie im Export
          clip = g.clip;
          bild = g.k;
        }
        ton = clips[clip]?.ton;
        sek = (clips[clip]?.anfang ?? 0) + bild / daten.fps;
      }
      if (!ton || sek >= ton.duration) return;
      const dauer = 1 / daten.fps;
      if (!anker || anker.t + (i - anker.k) * dauer < ac.currentTime) anker = { k: i, t: ac.currentTime + 0.03 };
      const q = new AudioBufferSourceNode(ac, { buffer: ton });
      q.connect(ac.destination);
      q.start(anker.t + (i - anker.k) * dauer, sek, dauer);
      laufend.add(q);
      q.onended = () => laufend.delete(q);
    },
    stopp() {
      for (const q of laufend) q.stop();
      laufend.clear();
      anker = null;
    },
  };
}
