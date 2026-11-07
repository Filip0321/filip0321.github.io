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
