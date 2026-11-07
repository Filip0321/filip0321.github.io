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

// Runde 5: jeder Clip wird für sich kodiert und das Ergebnis am Clip gemerkt (clip.kodiert). Kommt ein Clip
// dazu oder ändert sich die Länge eines Standbilds, wird nur dieser eine neu kodiert. Die anderen bleiben,
// solange Größe, Bildrate, Bitrate und „wild“ gleich sind.
//
// Gleichmäßige Bildrate: Viele Videos haben keine feste Bildrate (variable frame rate). Ein Standbild, aus
// DaVinci oder vom Handy als Video gespeichert, besteht oft nur aus ein paar Bildern, die jeweils sekundenlang
// gelten. Früher wurde jedes gespeicherte Bild genau einmal kodiert: aus 10 Sekunden wurden 3 Bilder.
// Jetzt wird abgetastet wie bei einem Film: zu jeder Zeit i / fps das Bild, das gerade gilt.

import { leseKopf } from "./vp8-kopf.js";
import { helligkeit } from "/lib/yuv.js";

const CODEC = "vp8";
const VORSCHAU_BREITE = 64; // Bildchen für die Zeitleiste

export async function bereite(clips, { breite, bitrate, wild = false, software = false, beiFortschritt }) {
  // gemeinsame Größe: die des ersten Clips, auf "breite" verkleinert, gerade Zahlen
  const g = clips[0].groesse(breite);
  // gemeinsame Bildrate: die des ersten Videos (Standbilder haben keine)
  const fps = Math.round(clips.find((c) => c.art === "video")?.fps ?? 30) || 30;

  const pakete = []; // { daten (Uint8Array), typ, clip, bild }
  const schluessel = []; // dasselbe Bild als Keyframe, zum Heilen
  const vorschau = []; // pro Paket ein kleines Bild (ImageBitmap) für die Zeitleiste
  const anfaenge = []; // Index des ersten Pakets jedes Clips
  const quellHelligkeit = []; // pro Clip: wie hell das erste Bild ist (0 = schwarz), zur Fehlersuche
  let zeitschichten = true;

  for (let c = 0; c < clips.length; c++) {
    const clip = clips[c];
    const merkmal = JSON.stringify({ g, fps, bitrate, wild, software, sekunden: clip.art === "bild" ? clip.sekunden : null });
    if (clip.kodiert?.merkmal !== merkmal) {
      clip.kodiert = { merkmal, ...(await kodiereClip(clip, g, fps, { bitrate, wild, software, beiFortschritt: (t) => beiFortschritt?.(`Clip ${c + 1}/${clips.length}: ${t}`) })) };
    }
    const k = clip.kodiert;
    anfaenge.push(pakete.length);
    k.pakete.forEach((p, n) => {
      p.clip = k.schluessel[n].clip = c;
      p.bild = k.schluessel[n].bild = n;
    });
    pakete.push(...k.pakete);
    schluessel.push(...k.schluessel);
    vorschau.push(...k.vorschau);
    quellHelligkeit.push(k.helligkeit);
    zeitschichten &&= k.zeitschichten;
    clip.bilderGesamt = k.pakete.length;
  }
  return { pakete, schluessel, vorschau, anfaenge, fps, breite: g.breite, hoehe: g.hoehe, codec: CODEC, zeitschichten, quellHelligkeit, software };
}

// Die Bilder eines Clips, gleichmäßig abgetastet, alle in dasselbe Canvas (leinwand) gezeichnet.
// Ein Bild gilt ab seinem Zeitstempel bis zum nächsten; Zielzeit i / fps bekommt das Bild, das dann gilt
// (mit einem halben Bild Spielraum, damit 29,97 und 30 nicht ständig um eins danebenliegen).
async function* gleichmaessig(clip, leinwand, fps, software) {
  const ctx = leinwand.getContext("2d");
  const n = Math.max(1, Math.round(clip.dauer * fps));
  if (clip.art === "bild") {
    ctx.drawImage(clip.bitmap, 0, 0, leinwand.width, leinwand.height);
    for (let i = 0; i < n; i++) yield i;
    return;
  }
  const halb = 0.5 / fps;
  let i = 0;
  let hatBild = false;
  for await (const b of clip.bilder(clip.groesse(leinwand.width), 0, clip.dauer, software)) {
    const t = b.timestamp - clip.anfang; // Sekunden ab Anfang des Clips
    if (!hatBild) {
      ctx.drawImage(b.canvas, 0, 0, leinwand.width, leinwand.height); // vor dem ersten Bild: das erste Bild
      hatBild = true;
    }
    while (i < n && i / fps + halb < t) yield i++; // bis hierher gilt noch das vorige Bild
    ctx.drawImage(b.canvas, 0, 0, leinwand.width, leinwand.height);
  }
  while (i < n) yield i++; // das letzte Bild gilt bis zum Ende
}

async function kodiereClip(clip, g, fps, { bitrate, wild, software, beiFortschritt }) {
  const pakete = [];
  const schluessel = [];
  const vorschau = [];
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
  const einstellung = { codec: CODEC, width: g.breite, height: g.hoehe, bitrate, framerate: fps, latencyMode: "quality", scalabilityMode: "L1T2" };
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
  const hoeheVorschau = Math.max(1, Math.round((VORSCHAU_BREITE * g.hoehe) / g.breite));
  let hell = 0;
  const gesamt = Math.max(1, Math.round(clip.dauer * fps));

  for await (const i of gleichmaessig(clip, leinwand, fps, software)) {
    if (i === 0) hell = helligkeit(leinwand);
    const bild = new VideoFrame(leinwand, { timestamp: Math.round((i * 1e6) / fps) });
    kodierer.encode(bild, { keyFrame: i === 0 }); // Keyframe nur am Anfang des Clips
    heiler.encode(bild, { keyFrame: true }); // und jedes Bild noch einmal als Keyframe
    bild.close();
    vorschau.push(createImageBitmap(leinwand, { resizeWidth: VORSCHAU_BREITE, resizeHeight: hoeheVorschau, resizeQuality: "low" }));
    // nicht mehr als ein paar Bilder vorauslaufen (sonst sammelt sich Speicher im Kodierer)
    while (kodierer.encodeQueueSize > 4 || heiler.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
    if (i % 15 === 0) beiFortschritt?.(`${Math.round((i / gesamt) * 100)} %`);
    if (fehler) throw fehler;
  }
  await Promise.all([kodierer.flush(), heiler.flush()]);
  kodierer.close();
  heiler.close();
  if (fehler) throw fehler;

  for (let n = 0; n < pakete.length; n++) {
    Object.assign(pakete[n], leseKopf(pakete[n].daten));
    Object.assign(schluessel[n], leseKopf(schluessel[n].daten));
  }
  // hat es geklappt? (sonst glitcht jeder Sprung zu Rauschen, main.js sagt es dann)
  zeitschichten = zeitschichten && [...pakete, ...schluessel].every((p) => !p.wahrscheinlichkeitenBleiben);
  return { pakete, schluessel, vorschau: await Promise.all(vorschau), helligkeit: hell, zeitschichten };
}
