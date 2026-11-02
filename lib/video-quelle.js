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

  function senke(g) {
    return new Mediabunny.CanvasSink(spur, { width: g.breite, height: g.hoehe, fit: "fill", poolSize: 3 });
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
    bilder: (g, von, bis) => senke(g).canvases(anfang + von, anfang + bis),
    // genau die Bilder zu diesen Zeiten (aufsteigend), z. B. für den Median oder die Takte
    bilderZu: (g, zeiten) => senke(g).canvasesAtTimestamps(zeiten.map((t) => anfang + t)),
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
