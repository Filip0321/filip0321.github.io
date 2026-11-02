// Dekoder: Pakete der Folge -> Bilder. Ein VideoDecoder (WebCodecs) mit VP8 in Software.
//
// Der Trick ist, dass ein Dekoder nicht prüft, ob die Pakete zusammengehören. Ein P-Frame sagt nur
// „nimm das letzte Bild und verschiebe diese Blöcke“. Ist das letzte Bild aus einem anderen Clip, tut er
// genau das, mit dem falschen Bild. Das ist Datamoshing.
// "prefer-software": der Software-Dekoder (libvpx) rechnet bei Unstimmigkeiten weiter; Hardware-Dekoder
// brechen eher ab.

export function richteDekoderEin({ codec, breite, hoehe }, beiBild) {
  let dekoder = null;
  let wartend = null; // Promise-Auflöser für das nächste Bild
  let fehler = null;
  let nummer = 0;

  function neu() {
    if (dekoder && dekoder.state !== "closed") dekoder.close();
    fehler = null;
    dekoder = new VideoDecoder({
      output: (bild) => {
        beiBild(bild); // zeichnen
        bild.close(); // sofort wieder freigeben, sonst bleibt der Dekoder nach ein paar Bildern stehen
        wartend?.();
        wartend = null;
      },
      error: (e) => {
        fehler = e;
        wartend?.();
        wartend = null;
      },
    });
    dekoder.configure({ codec, codedWidth: breite, codedHeight: hoehe, hardwareAcceleration: "prefer-software" });
  }

  // ein Paket dekodieren und warten, bis sein Bild gezeichnet ist
  // (VP8 sortiert nicht um: zu jedem Paket kommt genau ein Bild, in derselben Reihenfolge)
  function dekodiere(paket) {
    if (!dekoder || dekoder.state === "closed") neu();
    return new Promise((fertig, fehlschlag) => {
      wartend = () => (fehler ? fehlschlag(fehler) : fertig());
      try {
        // jedes Mal ein neues Paket: dieselben Daten, aber eine eigene, fortlaufende Zeit
        dekoder.decode(new EncodedVideoChunk({ type: paket.typ, timestamp: nummer++ * 33333, data: paket.daten }));
      } catch (e) {
        wartend = null;
        fehlschlag(e);
      }
    });
  }

  return { neu, dekodiere, schliesse: () => dekoder?.state !== "closed" && dekoder?.close() };
}
