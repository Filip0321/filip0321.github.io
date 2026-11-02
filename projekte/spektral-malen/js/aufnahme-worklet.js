// Aufnahme im Audio-Thread: sammelt, was vom Mikrofon kommt, und schickt es in Stücken zur Seite.
// Der Browser liefert 128 Samples auf einmal; einzeln verschickt wären das 375 Nachrichten pro Sekunde,
// darum werden sie erst gesammelt.

const STUECK = 4096; // etwa 0,1 Sekunden

class Aufnahme extends AudioWorkletProcessor {
  constructor() {
    super();
    this.puffer = new Float32Array(STUECK);
    this.n = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "stopp") {
        this.schicke();
        this.port.postMessage("fertig");
      }
    };
  }

  schicke() {
    if (!this.n) return;
    const stueck = this.puffer.slice(0, this.n);
    this.port.postMessage(stueck, [stueck.buffer]);
    this.n = 0;
  }

  process(eingaenge) {
    const kanaele = eingaenge[0];
    if (kanaele?.length) {
      // Stereo und mehr: alle Kanäle zusammen (Mitte)
      for (let i = 0; i < kanaele[0].length; i++) {
        let s = 0;
        for (const kanal of kanaele) s += kanal[i];
        this.puffer[this.n++] = s / kanaele.length;
        if (this.n === STUECK) this.schicke();
      }
    }
    return true;
  }
}

registerProcessor("aufnahme", Aufnahme);
