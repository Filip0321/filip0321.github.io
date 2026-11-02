// Vorbereiten: alle Clips hintereinander dekodieren und selbst neu kodieren, als VP8.
//
// Warum neu kodieren, statt die Pakete der Originaldatei zu nehmen?
//   - Wir wissen dann genau, wo Keyframes sind: einer am Anfang jedes Clips, sonst keiner.
//     Kameras setzen alle 1 bis 2 Sekunden einen, und jeder davon würde den Mosh „reparieren“.
//   - Alle Clips haben dieselbe Größe und denselben Codec: nur dann kann man Pakete des einen Clips
//     auf Bilder des anderen anwenden.
//   - VP8, weil sein Dekoder (libvpx) fehlende Bezugsbilder hinnimmt und einfach weiterrechnet. VP9 bricht
//     dann mit einem Fehler ab, H.264 können manche Browser gar nicht kodieren (ausprobiert).
//
// Ein Paket (EncodedVideoChunk) ist entweder "key" (das ganze Bild, I-Frame) oder "delta" (nur, was sich
// gegenüber dem vorigen Bild ändert, P-Frame: Bewegungsvektoren und ein Rest).
//
// Dazu ein zweiter Kodierer, der JEDES Bild als Keyframe kodiert ("schluessel"). Die stehen nicht im
// normalen Ablauf, sie sind zum Heilen da: ein Keyframe mitten im Mosh, und das Bild ist wieder sauber.
// Die P-Frames danach passen fast genau dazu (sie erwarten das Bild des ersten Kodierers, bekommen das
// des zweiten, und beide zeigen dasselbe Bild in fast derselben Qualität).

import { leseKopf } from "./vp8-kopf.js";

const CODEC = "vp8";

export async function bereite(clips, { breite, bitrate, wild = false, beiFortschritt }) {
  // gemeinsame Größe: die des ersten Clips, auf "breite" verkleinert, gerade Zahlen
  const g = clips[0].groesse(breite);
  const fps = Math.round(clips[0].fps) || 30;
  const pakete = []; // { daten (Uint8Array), typ, clip, bild }
  const anfaenge = []; // Index des ersten Pakets jedes Clips

  const schluessel = []; // dasselbe Bild als Keyframe, zum Heilen
  let fehler = null;
  const kopiere = (ziel) => (paket) => {
    const daten = new Uint8Array(paket.byteLength);
    paket.copyTo(daten);
    ziel.push({ daten, typ: paket.type });
  };
  const kodierer = new VideoEncoder({ output: kopiere(pakete), error: (e) => (fehler = e) });
  const heiler = new VideoEncoder({ output: kopiere(schluessel), error: (e) => (fehler = e) });
  // L1T2: zwei Zeitschichten. Jedes zweite Bild ist ein Bezugsbild, die dazwischen bauen nur darauf auf.
  // Die Schichten selbst brauchen wir nicht, aber der Kodierer schreibt dann jedes Paket so, dass es die
  // Wahrscheinlichkeiten des Bool-Kodierers nicht dauerhaft ändert (vp8-kopf.js). Erst dadurch verschiebt
  // ein Sprung Blöcke, statt die Bits falsch zu lesen.
  let einstellung = { codec: CODEC, width: g.breite, height: g.hoehe, bitrate, framerate: fps, latencyMode: "quality", scalabilityMode: "L1T2" };
  // wild: absichtlich ohne, dann liest der Dekoder nach jedem Sprung die Bits falsch (Rauschen statt Blöcke)
  let zeitschichten = !wild && (await VideoEncoder.isConfigSupported(einstellung)).supported;
  if (!zeitschichten) {
    delete einstellung.scalabilityMode;
    if (!(await VideoEncoder.isConfigSupported(einstellung)).supported) {
      throw new Error("Dein Browser kann kein VP8 kodieren (Safari kann es oft nicht). Am besten Chrome oder Firefox.");
    }
  }
  kodierer.configure(einstellung);
  // Keyframes brauchen viel mehr Daten als P-Frames: mit derselben Bitrate wären sie verwaschen
  heiler.configure({ ...einstellung, bitrate: Math.max(bitrate * 6, 6e6) });

  // gleiche Größe für alle: jedes Bild in ein Canvas dieser Größe zeichnen (andere Seitenverhältnisse
  // werden gestreckt; beim Moshen sieht man das kaum)
  const leinwand = document.createElement("canvas");
  leinwand.width = g.breite;
  leinwand.height = g.hoehe;
  const ctx = leinwand.getContext("2d");

  let nummer = 0;
  for (let c = 0; c < clips.length; c++) {
    anfaenge.push(nummer);
    const clip = clips[c];
    let i = 0;
    for await (const b of clip.bilder(clip.groesse(breite), 0, clip.dauer)) {
      ctx.drawImage(b.canvas, 0, 0, g.breite, g.hoehe);
      const bild = new VideoFrame(leinwand, { timestamp: Math.round((nummer * 1e6) / fps) });
      kodierer.encode(bild, { keyFrame: i === 0 }); // Keyframe nur am Anfang eines Clips
      heiler.encode(bild, { keyFrame: true }); // und jedes Bild noch einmal als Keyframe
      bild.close();
      nummer++;
      i++;
      // nicht mehr als ein paar Bilder vorauslaufen (sonst sammelt sich Speicher im Kodierer)
      while (kodierer.encodeQueueSize > 4 || heiler.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (i % 15 === 0) beiFortschritt?.(`Clip ${c + 1}/${clips.length}: ${Math.round((i / (clip.dauer * clip.fps)) * 100)} %`);
      if (fehler) throw fehler;
    }
  }
  await Promise.all([kodierer.flush(), heiler.flush()]);
  kodierer.close();
  heiler.close();
  if (fehler) throw fehler;

  // jedem Paket sagen, zu welchem Clip und Bild es gehört (die Ausgabe kommt in derselben Reihenfolge)
  pakete.forEach((p, n) => {
    Object.assign(p, leseKopf(p.daten));
    Object.assign(schluessel[n], leseKopf(schluessel[n].daten));
    let c = anfaenge.length - 1;
    while (anfaenge[c] > n) c--;
    p.clip = schluessel[n].clip = c;
    p.bild = schluessel[n].bild = n - anfaenge[c];
  });
  // hat es geklappt? (sonst glitcht jeder Sprung zu Rauschen, main.js sagt es dann)
  zeitschichten = zeitschichten && [...pakete, ...schluessel].every((p) => !p.wahrscheinlichkeitenBleiben);
  return { pakete, schluessel, anfaenge, fps, breite: g.breite, hoehe: g.hoehe, codec: CODEC, zeitschichten };
}
