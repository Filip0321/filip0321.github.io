// Mikrofon → Hauptthread: das Worklet schickt jedes Stück Samples (128 auf einmal) per Nachricht weiter.
// Gesammelt in Stücken von 2048, damit nicht 375 Nachrichten pro Sekunde unterwegs sind.
class Mithoeren extends AudioWorkletProcessor {
  constructor() {
    super();
    this.puffer = new Float32Array(2048);
    this.pos = 0;
  }
  process(eingaenge) {
    const kanal = eingaenge[0]?.[0];
    if (kanal) {
      for (let i = 0; i < kanal.length; i++) {
        this.puffer[this.pos++] = kanal[i];
        if (this.pos === this.puffer.length) {
          this.port.postMessage(this.puffer);
          this.puffer = new Float32Array(2048);
          this.pos = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("sstv-mithoeren", Mithoeren);
