// Videodatei Bild für Bild öffnen, mit Mediabunny (WebCodecs). Für alle Zeit-Projekte
// (Chronofotografie, Zeitquader, Datamosh); braucht <script src="/lib/mediabunny.js"> auf der Seite.
//
// Warum nicht ein <video>, wie bei Video zu Ton? Ein <video> spielt ab, so gut es geht, und lässt Bilder
// aus, wenn der Rechner nicht hinterherkommt. Mit currentTime springen geht, ist aber langsam und nicht
// immer bildgenau. Hier wird das Video selbst dekodiert: jedes Bild kommt genau einmal, in Reihenfolge,
// in der Größe, die man braucht (CanvasSink rechnet es gleich klein und dreht Handy-Videos richtig herum).
//
// Hinter Mediabunny steckt WebCodecs: der Video-Dekoder der Grafikkarte, direkt aus JavaScript.
// Jedes dekodierte Bild (VideoFrame) belegt Speicher im Dekoder, bis man es schließt (close()).
// CanvasSink zeichnet es in ein Canvas und schließt es selbst; mit poolSize benutzt er wenige Canvas
// immer wieder, statt für jedes Bild ein neues anzulegen. Darum: ein Bild sofort benutzen (hochladen),
// nicht aufheben, das Canvas ist beim übernächsten Bild schon wieder überschrieben.

import { zuBildDaten } from "./yuv.js";

// Der „CPU-Weg“ für die Quelle: jedes Bild mit copyTo() in den Arbeitsspeicher, selbst von YUV nach RGB
// (yuv.js), dann erst in ein Canvas. Kein drawImage(VideoFrame), also nichts, was die Grafikkarte schwarz
// zeichnen könnte. Langsamer; nur für PCs, auf denen beides andere schwarz bleibt.
async function* cpuBilder(spur, g, von, bis) {
  const senke = new Mediabunny.VideoSampleSink(spur);
  const voll = document.createElement("canvas");
  const aus = document.createElement("canvas");
  aus.width = g.breite;
  aus.height = g.hoehe;
  const ctx = aus.getContext("2d");
  for await (const probe of senke.samples(von, bis)) {
    const bild = probe.toVideoFrame();
    try {
      const daten = await zuBildDaten(bild);
      voll.width = daten.width;
      voll.height = daten.height;
      voll.getContext("2d").putImageData(daten, 0, 0);
      // Handy-Videos sind oft gedreht gespeichert (rotation 90, 180 oder 270): hier zurückdrehen
      const r = probe.rotation ?? 0;
      ctx.save();
      ctx.translate(g.breite / 2, g.hoehe / 2);
      ctx.rotate((r * Math.PI) / 180);
      const quer = r === 90 || r === 270;
      const [b, h] = quer ? [g.hoehe, g.breite] : [g.breite, g.hoehe];
      ctx.drawImage(voll, -b / 2, -h / 2, b, h);
      ctx.restore();
      yield { canvas: aus, timestamp: probe.timestamp };
    } finally {
      bild.close();
      probe.close();
    }
  }
}

export async function oeffneVideo(datei) {
  if (typeof Mediabunny === "undefined" || typeof VideoDecoder === "undefined") {
    throw new Error("Dein Browser kann Videos nicht Bild für Bild dekodieren (WebCodecs fehlt).");
  }
  const eingabe = new Mediabunny.Input({ formats: Mediabunny.ALL_FORMATS, source: new Mediabunny.BlobSource(datei) });
  const spur = await eingabe.getPrimaryVideoTrack();
  if (!spur) throw new Error("In dieser Datei ist kein Video.");
  if (!(await spur.canDecode())) {
    throw new Error(`Diesen Video-Codec (${await spur.getCodec() ?? "unbekannt"}) kann der Browser nicht dekodieren. ProRes geht nie; H.264, HEVC, VP9 und AV1 meistens.`);
  }
  const breite = await spur.getDisplayWidth();
  const hoehe = await spur.getDisplayHeight();
  const anfang = await spur.getFirstTimestamp();
  const ende = await eingabe.computeDuration();
  const statistik = await spur.computePacketStats(120); // die ersten 120 Bilder genügen für die Bildrate
  const fps = statistik.averagePacketRate || 30;

  // Größe auf höchstens maxBreite verkleinert (gerade Zahlen, das mögen Kodierer)
  function groesse(maxBreite) {
    const faktor = Math.min(1, maxBreite / breite);
    const gerade = (x) => Math.max(2, Math.round(x / 2) * 2);
    return { breite: gerade(breite * faktor), hoehe: gerade(hoehe * faktor) };
  }

  // software: den Dekoder der Grafikkarte umgehen. Auf manchen PCs (Chrome, Windows) kommen aus dem
  // Hardware-Dekoder schwarze Bilder, wenn man sie in ein Canvas zeichnet; der Software-Dekoder
  // rechnet im Arbeitsspeicher und hat das Problem nicht (ist dafür langsamer).
  function senke(g, software = false) {
    return new Mediabunny.CanvasSink(spur, {
      width: g.breite,
      height: g.hoehe,
      fit: "fill",
      poolSize: 3,
      ...(software ? { decoderOptions: { hardwareAcceleration: "prefer-software" } } : {}),
    });
  }

  return {
    spur, // für alles, was Mediabunny direkt braucht (z. B. die kodierten Pakete beim Datamosh)
    name: datei.name.replace(/\.[^.]+$/, ""),
    datei,
    breite,
    hoehe,
    anfang,
    dauer: ende - anfang,
    fps,
    groesse,
    // alle Bilder von bis bis (Sekunden ab Anfang des Videos), der Reihe nach: { canvas, timestamp }
    // (software: siehe senke; "cpu": siehe cpuBilder)
    bilder: (g, von, bis, software = false) =>
      software === "cpu" ? cpuBilder(spur, g, anfang + von, anfang + bis) : senke(g, software).canvases(anfang + von, anfang + bis),
    // genau die Bilder zu diesen Zeiten (aufsteigend), z. B. für den Median oder die Takte
    bilderZu: (g, zeiten, software = false) => senke(g, software).canvasesAtTimestamps(zeiten.map((t) => anfang + t)),
  };
}

// der Ton des Videos (für den Takt und als Tonspur im Export), oder null
export async function ladeTon(datei) {
  try {
    return await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await datei.arrayBuffer());
  } catch {
    return null; // kein Ton, oder der Browser kann ihn aus diesem Behälter nicht lesen
  }
}

