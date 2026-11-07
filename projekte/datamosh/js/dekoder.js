// Dekoder: Pakete der Folge -> Bilder. Ein VideoDecoder (WebCodecs) mit VP8 in Software.
//
// Der Trick ist, dass ein Dekoder nicht prüft, ob die Pakete zusammengehören. Ein P-Frame sagt nur
// „nimm das letzte Bild und verschiebe diese Blöcke“. Ist das letzte Bild aus einem anderen Clip, tut er
// genau das, mit dem falschen Bild. Das ist Datamoshing.
// "prefer-software": der Software-Dekoder (libvpx) rechnet bei Unstimmigkeiten weiter; Hardware-Dekoder
// brechen eher ab.
//
// Runde 5: Warum es auf dem PC hing (Zen) oder schwarz blieb (Chrome)
//   1. Manche Dekoder geben ein Bild erst heraus, wenn schon das nächste Paket da ist (Verzögerung).
//      Vorher wurde nach jedem Paket auf sein Bild gewartet: Das Bild kam nie, alles stand still, und
//      „Video rendern“ wartete ewig darauf, dass die Abspielschleife aufhört.
//      Jetzt: Pakete werden vorausgeschickt (schicke), jedes bekommt ein Versprechen für sein Bild, die
//      Bilder kommen in derselben Reihenfolge heraus. Wer auf ein Bild wartet, wartet höchstens kurz;
//      dann wird der Dekoder gespült (flush), und spätestens dann kommt alles heraus.
//      Haken: Nach flush() verlangt WebCodecs einen Keyframe. Darum merkt sich der Dekoder das (gespuelt),
//      und wer weiter will, fängt von vorn an.
//   2. drawImage(VideoFrame) zeichnet auf manchen Grafikkarten schwarz. Der Ausweg ist der „CPU-Weg“:
//      die Pixel mit copyTo() in den Arbeitsspeicher holen, selbst von YUV nach RGB rechnen und mit
//      putImageData zeichnen. Langsamer, aber ohne Grafikkarte dazwischen.

import { zuBildDaten } from "/lib/yuv.js";

export function richteDekoderEin({ codec, breite, hoehe }, beiBild, protokoll = () => {}) {
  let dekoder = null;
  let offen = []; // { ziel, fertig } pro geschicktem Paket, in Reihenfolge
  let fehler = null;
  let nummer = 0;
  let gespuelt = false;
  let cpuWeg = false; // true: Pixel selbst umrechnen statt drawImage(VideoFrame)
  let beschleunigung = "prefer-software";
  let kette = Promise.resolve(); // der CPU-Weg ist asynchron, die Bilder müssen trotzdem der Reihe nach
  const zwischen = document.createElement("canvas"); // CPU-Weg: hierhin putImageData, dann wie gewohnt zeichnen
  let gezaehlt = 0; // Bilder seit neu(), fürs Protokoll

  function ausgabe(bild) {
    const o = offen.shift();
    gezaehlt++;
    if (gezaehlt === 1) protokoll(`erstes Bild aus dem Dekoder: ${bild.format ?? "?"} ${bild.codedWidth}×${bild.codedHeight}${cpuWeg ? " (CPU-Weg)" : ""}`);
    if (!cpuWeg) {
      try {
        beiBild(bild, o?.ziel);
      } catch (e) {
        protokoll(`Zeichnen ging nicht: ${e.message}`);
      } finally {
        bild.close(); // sofort wieder freigeben, sonst bleibt der Dekoder nach ein paar Bildern stehen
      }
      o?.fertig(true);
      return;
    }
    kette = kette.then(async () => {
      try {
        const daten = await zuBildDaten(bild);
        zwischen.width = daten.width;
        zwischen.height = daten.height;
        zwischen.getContext("2d").putImageData(daten, 0, 0);
        beiBild(zwischen, o?.ziel);
      } catch (e) {
        protokoll(`CPU-Weg ging nicht: ${e.message}`);
      } finally {
        bild.close();
        o?.fertig(true);
      }
    });
  }

  function neu() {
    if (dekoder && dekoder.state !== "closed") dekoder.close();
    // wer noch auf ein Bild wartet, bekommt „false“ (kein Bild), statt ewig zu warten
    for (const o of offen) o.fertig(false);
    offen = [];
    fehler = null;
    gespuelt = false;
    gezaehlt = 0;
    dekoder = new VideoDecoder({
      output: ausgabe,
      error: (e) => {
        fehler = e;
        protokoll(`Dekoder-Fehler: ${e.message}`);
        for (const o of offen) o.fertig(false);
        offen = [];
      },
    });
    dekoder.configure({ codec, codedWidth: breite, codedHeight: hoehe, hardwareAcceleration: beschleunigung });
  }

  // ein Paket abschicken, ohne zu warten. Gibt ein Versprechen zurück: true, wenn sein Bild gezeichnet ist
  // ziel: wohin das Bild soll (wird an beiBild weitergegeben)
  function schicke(paket, ziel = null) {
    if (!dekoder || dekoder.state === "closed") neu();
    if (fehler) return Promise.reject(fehler);
    if (gespuelt && paket.typ !== "key") return Promise.reject(new Error("nach dem Spülen braucht der Dekoder erst einen Keyframe"));
    if (paket.typ === "key") gespuelt = false;
    return new Promise((fertig, fehlschlag) => {
      const eintrag = { ziel, fertig };
      offen.push(eintrag);
      try {
        // jedes Mal ein neues Paket: dieselben Daten, aber eine eigene, fortlaufende Zeit
        dekoder.decode(new EncodedVideoChunk({ type: paket.typ, timestamp: nummer++ * 33333, data: paket.daten }));
      } catch (e) {
        offen = offen.filter((x) => x !== eintrag); // sonst kämen die Bilder danach zum falschen Paket
        fehlschlag(e);
      }
    });
  }

  // auf ein Versprechen von schicke() warten. Arbeitet der Dekoder noch (decodeQueueSize > 0), wird
  // einfach weiter gewartet. Steht er still, obwohl Bilder offen sind, hält er sie zurück: dann spülen.
  // Kommt nach 5 s immer noch nichts, gibt es einen Fehler statt ewigen Wartens.
  async function warteAuf(versprechen) {
    const zeit = (ms) => new Promise((r) => setTimeout(() => r("zeit"), ms));
    const ende = performance.now() + 5000;
    while (performance.now() < ende) {
      const r = await Promise.race([versprechen, zeit(150)]);
      if (r !== "zeit") return r;
      if (fehler) throw fehler;
      if (dekoder.state === "configured" && dekoder.decodeQueueSize === 0 && offen.length && !gespuelt) {
        protokoll(`Dekoder hält Bilder zurück (${offen.length} offen) – spüle`);
        gespuelt = true;
        dekoder.flush().catch((e) => protokoll(`Spülen ging nicht: ${e.message}`));
      }
    }
    throw new Error(`Der Dekoder antwortet nicht (Zustand ${dekoder.state}, ${offen.length} Bilder offen, Warteschlange ${dekoder.decodeQueueSize})`);
  }

  // wie früher: ein Paket dekodieren und warten, bis sein Bild gezeichnet ist
  const dekodiere = (paket, ziel = null) => warteAuf(schicke(paket, ziel));

  return {
    neu,
    schicke,
    warteAuf,
    dekodiere,
    gespuelt: () => gespuelt,
    // auf den CPU-Weg oder einen anderen Dekoder umschalten (gilt ab dem nächsten neu())
    stelleUm({ cpu, hardware } = {}) {
      if (cpu !== undefined) cpuWeg = cpu;
      if (hardware !== undefined) beschleunigung = hardware;
      protokoll(`Dekoder: ${cpuWeg ? "CPU-Weg" : "drawImage"}, ${beschleunigung}`);
    },
    // schließen; wer noch auf ein Bild wartet, bekommt sofort „false“ (sonst wartete er 5 s auf einen
    // Dekoder, den es nicht mehr gibt)
    schliesse() {
      if (dekoder && dekoder.state !== "closed") dekoder.close();
      for (const o of offen) o.fertig(false);
      offen = [];
    },
  };
}
