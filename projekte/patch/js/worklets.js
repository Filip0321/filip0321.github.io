// AudioWorklets: kleine Programme, die direkt im Ton-Faden des Browsers laufen, Sample für Sample, in Blöcken zu
// 128 Samples. Gebraucht für alles, was die fertigen Web-Audio-Bausteine nicht können:
//
//   saite         Karplus-Strong. Eine Rückkopplung über einen DelayNode geht in Web Audio nicht kürzer als ein
//                 Block (128 Samples = 2,7 ms bei 48 kHz), damit wären höchstens 375 Hz möglich. Hier ist die
//                 Verzögerung ein eigener Ringpuffer, so kurz wie nötig.
//   quantisierer  rastet eine Steuerspannung (1,0 pro Oktave) auf die Töne einer Tonleiter.
//   bitcrusher    weniger Bits (Stufen) und eine kleinere Abtastrate: der Klang alter Sampler und Spielkonsolen.
//   tape          Band: Gleichlaufschwankungen (Wow langsam, Flutter schnell) als wandernde Verzögerung, dazu
//                 sanfte Sättigung (tanh) und Bandrauschen.
//
// Eine Datei für alle, geladen mit ctx.audioWorklet.addModule (main.js, beim Klick auf „Ton an“).

// ---------- Saite (Karplus-Strong, 1983) ----------
// Ein Ringpuffer der Länge L = Abtastrate / Frequenz wird mit Rauschen gefüllt (der Anschlag). Dann läuft er im Kreis,
// und bei jedem Durchlauf wird jedes Sample mit seinem Nachbarn gemittelt: y[n] = d · (x[n − L] + x[n − L − 1]) / 2.
// Das Mitteln ist ein Tiefpass: hohe Obertöne sterben schneller als tiefe, genau wie bei einer echten Saite.
// d (knapp unter 1) bestimmt, wie lange sie klingt. „Hell“ mischt zwischen Mitteln und Nicht-Mitteln.
// Die Länge ist nicht ganzzahlig: der Bruchteil wird linear zwischen zwei Puffer-Stellen gelesen (sonst wären
// hohe Töne verstimmt, bei 1000 Hz liegen zwischen zwei ganzzahligen Längen fast 20 Cent).
class Saite extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequenz", defaultValue: 220, minValue: 20, maxValue: 4000 },
      { name: "tonhoehe", defaultValue: 0 }, // 1,0 pro Oktave, kommt aus dem Kabel
      { name: "daempfung", defaultValue: 0.996, minValue: 0.9, maxValue: 0.9999 },
      { name: "hell", defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.puffer = new Float32Array(4096);
    this.schreib = 0;
    this.anschlag = 0; // so viele Samples Rauschen kommen noch
    this.port.onmessage = (e) => (this.anschlagBei = e.data.zeit); // Zeit der Audio-Uhr
    this.anschlagBei = null;
  }
  process(_, [aus], p) {
    const k = aus[0], n = k.length;
    for (let i = 0; i < n; i++) {
      const t = currentTime + i / sampleRate;
      if (this.anschlagBei !== null && t >= this.anschlagBei) {
        this.anschlagBei = null;
        const f0 = p.frequenz[0] * 2 ** p.tonhoehe[0];
        this.anschlag = Math.min(4000, Math.round(sampleRate / f0)); // eine Periode Rauschen
      }
      const f = Math.min(4000, (p.frequenz.length > 1 ? p.frequenz[i] : p.frequenz[0]) * 2 ** (p.tonhoehe.length > 1 ? p.tonhoehe[i] : p.tonhoehe[0]));
      const laenge = Math.max(2, sampleRate / f);
      const ganz = Math.floor(laenge), bruch = laenge - ganz;
      const lies = (abstand) => this.puffer[(this.schreib - abstand + 4096) & 4095];
      const a = lies(ganz) * (1 - bruch) + lies(ganz + 1) * bruch;
      const b = lies(ganz + 1) * (1 - bruch) + lies(ganz + 2) * bruch;
      const hell = p.hell[0];
      let y = p.daempfung[0] * ((1 - hell) * 0.5 * (a + b) + hell * a);
      if (this.anschlag > 0) {
        y += Math.random() * 2 - 1;
        this.anschlag--;
      }
      this.puffer[this.schreib] = y;
      this.schreib = (this.schreib + 1) & 4095;
      k[i] = y;
    }
    for (let c = 1; c < aus.length; c++) aus[c].set(k);
    return true;
  }
}
registerProcessor("saite", Saite);

// ---------- Quantisierer ----------
// Eingang in Oktaven (1,0 = eine Oktave). In Halbtöne (· 12), dann auf den nächsten Ton der Leiter: Oktave abtrennen,
// in der Oktave den nächsten erlaubten Halbton suchen, wieder zusammensetzen. Grundton verschiebt die Leiter.
class Quantisierer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.leiter = [0, 2, 3, 5, 7, 8, 10];
    this.grund = 0;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }
  process([ein], [aus]) {
    const x = ein[0], y = aus[0];
    if (!x) {
      y.fill(0);
      return true;
    }
    for (let i = 0; i < x.length; i++) {
      const ht = x[i] * 12 - this.grund;
      const oktave = Math.floor(ht / 12), rest = ht - oktave * 12;
      let best = this.leiter[0], abst = Infinity;
      for (const s of [...this.leiter, this.leiter[0] + 12]) {
        const d = Math.abs(rest - s);
        if (d < abst) [abst, best] = [d, s];
      }
      y[i] = (oktave * 12 + best + this.grund) / 12;
    }
    return true;
  }
}
registerProcessor("quantisierer", Quantisierer);

// ---------- Bitcrusher ----------
// Stufen: auf 2^bits Werte zwischen −1 und 1 runden. Abtastrate: nur jedes k-te Sample neu nehmen und dazwischen
// halten (das spiegelt hohe Frequenzen an der neuen, tiefen Nyquist-Grenze: das typische Klirren, „Aliasing“).
class Bitcrusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bits", defaultValue: 8, minValue: 1, maxValue: 16 },
      { name: "teiler", defaultValue: 4, minValue: 1, maxValue: 64 },
    ];
  }
  constructor() {
    super();
    this.halten = [0, 0];
    this.zaehler = 0;
  }
  process([ein], [aus], p) {
    if (!ein.length) return true;
    const stufen = 2 ** Math.round(p.bits[0]) / 2, teiler = Math.round(p.teiler[0]);
    for (let i = 0; i < aus[0].length; i++) {
      if (this.zaehler++ % teiler === 0)
        for (let c = 0; c < aus.length; c++) this.halten[c] = Math.round((ein[c] ?? ein[0])[i] * stufen) / stufen;
      for (let c = 0; c < aus.length; c++) aus[c][i] = this.halten[c] ?? this.halten[0];
    }
    return true;
  }
}
registerProcessor("bitcrusher", Bitcrusher);

// ---------- Band (Tape) ----------
// Gleichlauf: ein Bandgerät läuft nie ganz gleichmäßig. Die Abspielstelle wandert darum um eine feste Verzögerung
// herum: Wow (etwa 0,5 Hz, langsam schwimmend) und Flutter (etwa 7 Hz, zittrig). Eine wandernde Verzögerung
// verändert die Tonhöhe (wie der Doppler-Effekt): wird sie länger, klingt es tiefer.
// Dazu Sättigung: tanh(Antrieb · x) / tanh(Antrieb), weiche Rundung lauter Stellen wie Magnetband; und Rauschen.
class Band extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "wow", defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: "flutter", defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: "antrieb", defaultValue: 1.5, minValue: 0.1, maxValue: 10 },
      { name: "rauschen", defaultValue: 0.003, minValue: 0, maxValue: 0.05 },
    ];
  }
  constructor() {
    super();
    this.puffer = [new Float32Array(8192), new Float32Array(8192)];
    this.schreib = 0;
    this.phaseW = 0;
    this.phaseF = 0;
    this.drift = 0; // Wow ist nicht ganz regelmäßig: langsam wandernder Zufall dazu
  }
  process([ein], [aus], p) {
    const n = aus[0].length, mitte = 0.006 * sampleRate; // 6 ms Grundverzögerung
    const a = p.antrieb[0], norm = Math.tanh(a);
    for (let i = 0; i < n; i++) {
      this.phaseW += (0.5 * 2 * Math.PI) / sampleRate;
      this.phaseF += (7 * 2 * Math.PI) / sampleRate;
      this.drift += (Math.random() - 0.5) * 0.0005 - this.drift * 0.00005;
      const versatz = mitte * (1 + p.wow[0] * 0.5 * (Math.sin(this.phaseW) + this.drift) + p.flutter[0] * 0.05 * Math.sin(this.phaseF));
      for (let c = 0; c < aus.length; c++) {
        const x = ein.length ? (ein[c] ?? ein[0])[i] : 0;
        const buf = this.puffer[c] ?? this.puffer[0];
        buf[this.schreib] = x;
        const pos = this.schreib - versatz, g = Math.floor(pos), b = pos - g;
        const y = buf[(g + 8192) & 8191] * (1 - b) + buf[(g + 1 + 8192) & 8191] * b;
        aus[c][i] = Math.tanh(a * y) / norm + (Math.random() * 2 - 1) * p.rauschen[0];
      }
      this.schreib = (this.schreib + 1) & 8191;
    }
    return true;
  }
}
registerProcessor("band", Band);
