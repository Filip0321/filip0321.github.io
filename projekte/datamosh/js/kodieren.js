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

const CODEC = "vp8";

export async function bereite(clips, { breite, bitrate, beiFortschritt }) {
  // gemeinsame Größe: die des ersten Clips, auf "breite" verkleinert, gerade Zahlen
  const g = clips[0].groesse(breite);
  const fps = Math.round(clips[0].fps) || 30;
  const pakete = []; // { daten (Uint8Array), typ, clip, bild }
  const anfaenge = []; // Index des ersten Pakets jedes Clips

  let fehler = null;
  const kodierer = new VideoEncoder({
    output: (paket) => {
      const daten = new Uint8Array(paket.byteLength);
      paket.copyTo(daten);
      pakete.push({ daten, typ: paket.type });
    },
    error: (e) => (fehler = e),
  });
  const einstellung = { codec: CODEC, width: g.breite, height: g.hoehe, bitrate, framerate: fps, latencyMode: "quality" };
  if (!(await VideoEncoder.isConfigSupported(einstellung)).supported) {
    throw new Error("Dein Browser kann kein VP8 kodieren (Safari kann es oft nicht). Am besten Chrome oder Firefox.");
  }
  kodierer.configure(einstellung);

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
      bild.close();
      nummer++;
      i++;
      // nicht mehr als ein paar Bilder vorauslaufen (sonst sammelt sich Speicher im Kodierer)
      while (kodierer.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (i % 15 === 0) beiFortschritt?.(`Clip ${c + 1}/${clips.length}: ${Math.round((i / (clip.dauer * clip.fps)) * 100)} %`);
      if (fehler) throw fehler;
    }
  }
  await kodierer.flush();
  kodierer.close();
  if (fehler) throw fehler;

  // jedem Paket sagen, zu welchem Clip und Bild es gehört (die Ausgabe kommt in derselben Reihenfolge)
  pakete.forEach((p, n) => {
    let c = anfaenge.length - 1;
    while (anfaenge[c] > n) c--;
    p.clip = c;
    p.bild = n - anfaenge[c];
  });
  return { pakete, anfaenge, fps, breite: g.breite, hoehe: g.hoehe, codec: CODEC };
}
