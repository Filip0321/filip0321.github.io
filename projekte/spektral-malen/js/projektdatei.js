// Leinwand speichern und öffnen: alles in einer Datei (.spektral), damit man später weitermalen kann.
//
// Der Aufbau ist absichtlich einfach:
//   8 Bytes  "SPKMAL01" (woran man die Datei erkennt, mit Version)
//   4 Bytes  wie lang der Kopf ist
//   Kopf     JSON: Leinwand, Einstellungen, Ebenen, und wo deren Zahlen liegen
//   Teile    die Zahlen selbst (Float32Array), jedes auf eine durch 4 teilbare Stelle gerückt,
//            damit man sie ohne Kopieren wieder als Float32Array lesen kann
// Dann wird das Ganze mit gzip gepackt (CompressionStream): eine Leinwand ist meist fast leer,
// und Nullen packen sich gut. Kann der Browser das nicht, wird ungepackt gespeichert;
// beim Öffnen wird an den ersten zwei Bytes erkannt, ob gepackt ist (gzip fängt immer mit 1f 8b an).

const KENNUNG = "SPKMAL01";

// kopf: alles, was JSON sein kann. Zahlenfelder darin als { teil: Float32Array } angeben,
// sie werden herausgenommen und hinten angehängt
export async function packe(kopf) {
  const teile = [];
  const json = JSON.stringify(kopf, (_schluessel, wert) => {
    if (wert instanceof Float32Array) {
      teile.push(wert);
      return { teil: teile.length - 1 };
    }
    return wert;
  });
  const kopfBytes = new TextEncoder().encode(json);
  const auffuellen = (n) => (4 - (n % 4)) % 4;

  const stuecke = [new TextEncoder().encode(KENNUNG), new Uint32Array([kopfBytes.length]), kopfBytes];
  let laenge = 12 + kopfBytes.length;
  stuecke.push(new Uint8Array(auffuellen(laenge)));
  laenge += auffuellen(laenge);
  const lage = [];
  for (const t of teile) {
    lage.push({ stelle: laenge, anzahl: t.length });
    stuecke.push(t);
    laenge += t.byteLength;
  }
  // die Lage der Teile ganz hinten, als letztes JSON (der Kopf war da schon geschrieben)
  const lageBytes = new TextEncoder().encode(JSON.stringify(lage));
  stuecke.push(lageBytes, new Uint32Array([lageBytes.length]));

  const roh = new Blob(stuecke);
  if (typeof CompressionStream === "undefined") return roh;
  return new Response(roh.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

export async function entpacke(datei) {
  let puffer = await datei.arrayBuffer();
  const anfang = new Uint8Array(puffer, 0, 2);
  if (anfang[0] === 0x1f && anfang[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("Dieser Browser kann die Datei nicht entpacken.");
    puffer = await new Response(new Blob([puffer]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }
  if (new TextDecoder().decode(new Uint8Array(puffer, 0, 8)) !== KENNUNG) {
    throw new Error("Das ist keine Spektral-Malen-Datei.");
  }
  const kopfLaenge = new DataView(puffer).getUint32(8, true);
  const json = new TextDecoder().decode(new Uint8Array(puffer, 12, kopfLaenge));
  const lageLaenge = new DataView(puffer).getUint32(puffer.byteLength - 4, true);
  const lage = JSON.parse(new TextDecoder().decode(new Uint8Array(puffer, puffer.byteLength - 4 - lageLaenge, lageLaenge)));
  // { teil: n } wird wieder zum Float32Array (slice: eigener Speicher, nicht die ganze Datei festhalten)
  return JSON.parse(json, (_schluessel, wert) => {
    if (wert && typeof wert === "object" && Number.isInteger(wert.teil) && Object.keys(wert).length === 1) {
      const { stelle, anzahl } = lage[wert.teil];
      return new Float32Array(puffer, stelle, anzahl).slice();
    }
    return wert;
  });
}
