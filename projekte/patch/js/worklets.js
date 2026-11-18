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
// Runde 21:
//   mathe         rechnen mit zwei Signalen (Sample für Sample): + − × min max |a| a>b …
//   folger        Hüllkurvenfolger: wie laut ist es gerade? (gleichrichten, dann glätten, schnell rauf, langsam runter)
//   schwelle      Ton → Takt: meldet, wann ein Signal eine Schwelle überschreitet
//   tropfen       Blasen und Tropfen (Regen, Bach), nach dem Modell von van den Doel
//   knistern      Knistern und Knacken (Feuer, Vinyl, Zweige)
//   zirpen        Grillen, mit Dolbears Gesetz (zirpen schneller, wenn es warm ist)
// Runde 22:
//   schleife      Bandschleife: aufnehmen, im Kreis abspielen, schneller, langsamer, rückwärts, übereinander
//   pling         viele kurze, abklingende Sinustöne zugleich (für Tropfen, Glocken, Holz): je Takt einer
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
// Aussetzer (Runde 21): altes Band verliert stellenweise Magnetschicht, oder es liegt kurz nicht am Kopf an: der Ton
// sackt für 20 bis 150 ms weg (nicht ganz, und weich, über 3 ms geglättet), zu zufälligen Zeiten.
class Band extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "wow", defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: "flutter", defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: "antrieb", defaultValue: 1.5, minValue: 0.1, maxValue: 10 },
      { name: "rauschen", defaultValue: 0.003, minValue: 0, maxValue: 0.05 },
      { name: "aussetzer", defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.loch = 0; // so viele Samples dauert der jetzige Aussetzer noch
    this.tiefe = 1; // Ziel-Lautstärke während des Aussetzers
    this.g = 1; // geglättete Lautstärke
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
      if (this.loch > 0) this.loch--;
      else if (Math.random() < (p.aussetzer[0] * 1.5) / sampleRate) {
        this.loch = Math.round(sampleRate * (0.02 + Math.random() * 0.13));
        this.tiefe = 0.1 + Math.random() * 0.6;
      }
      this.g += ((this.loch > 0 ? this.tiefe : 1) - this.g) * (1 - Math.exp(-1 / (0.003 * sampleRate)));
      for (let c = 0; c < aus.length; c++) {
        const x = ein.length ? (ein[c] ?? ein[0])[i] : 0;
        const buf = this.puffer[c] ?? this.puffer[0];
        buf[this.schreib] = x;
        const pos = this.schreib - versatz, g = Math.floor(pos), b = pos - g;
        const y = buf[(g + 8192) & 8191] * (1 - b) + buf[(g + 1 + 8192) & 8191] * b;
        aus[c][i] = (Math.tanh(a * y) / norm) * this.g + (Math.random() * 2 - 1) * p.rauschen[0];
      }
      this.schreib = (this.schreib + 1) & 8191;
    }
    return true;
  }
}
registerProcessor("band", Band);


// ---------- Mathe (Runde 21) ----------
// Zwei Eingänge A und B, Sample für Sample verrechnet. B ist das Kabel plus der Knopf „B“ (ohne Kabel also eine
// feste Zahl). Danach mal „Faktor“ plus „Versatz“: so macht man aus einem LFO (−1 … 1) einen Bereich, den man
// braucht (zum Beispiel 0 … 1: Faktor 0,5, Versatz 0,5). Das ist in Max [*~] [+~] [abs~] [>~] [min~] …
const RECHNUNGEN = [
  (a, b) => a + b, (a, b) => a - b, (a, b) => a * b, (a, b) => Math.min(a, b), (a, b) => Math.max(a, b),
  (a) => Math.abs(a), (a, b) => (a > b ? 1 : 0), (a, b) => (Math.abs(b) < 1e-6 ? 0 : a / b),
  (a, b) => (b > 0 ? a - b * Math.floor(a / b) : a), // Rest (wie Modulo, auch für negative a)
  (a, b) => (b > 0 ? b * Math.round(a / b) : a), // auf Stufen der Größe b runden
];
class Mathe extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "art", defaultValue: 0, automationRate: "k-rate" },
      { name: "b", defaultValue: 0 },
      { name: "faktor", defaultValue: 1 },
      { name: "versatz", defaultValue: 0 },
    ];
  }
  process([ea, eb], [aus], p) {
    const k = aus[0], f = RECHNUNGEN[Math.round(p.art[0])] ?? RECHNUNGEN[0];
    const a = ea[0], b = eb[0];
    for (let i = 0; i < k.length; i++) {
      const bw = (b ? b[i] : 0) + (p.b.length > 1 ? p.b[i] : p.b[0]);
      k[i] = f(a ? a[i] : 0, bw) * (p.faktor.length > 1 ? p.faktor[i] : p.faktor[0]) + (p.versatz.length > 1 ? p.versatz[i] : p.versatz[0]);
    }
    return true;
  }
}
registerProcessor("mathe", Mathe);

// ---------- Hüllkurvenfolger (Runde 21) ----------
// Gleichrichten (|x|: die negative Hälfte der Welle nach oben klappen), dann ein Tiefpass erster Ordnung, aber mit zwei
// Zeiten: steigt das Signal, folgt er schnell (Attack), fällt es, langsam (Release). Ein Koeffizient k = 1 − e^(−1/(τ·fs))
// heißt: in τ Sekunden 63 % des Wegs. So steuert eine Trommel ein Filter, oder Sprache die Lautstärke eines Pads.
class Folger extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "attack", defaultValue: 0.005, minValue: 0.0001 },
      { name: "release", defaultValue: 0.15, minValue: 0.001 },
      { name: "verstaerkung", defaultValue: 2 },
    ];
  }
  constructor() {
    super();
    this.h = 0;
  }
  process([ein], [aus], p) {
    const k = aus[0], e = ein[0];
    const ka = 1 - Math.exp(-1 / (p.attack[0] * sampleRate)), kr = 1 - Math.exp(-1 / (p.release[0] * sampleRate));
    for (let i = 0; i < k.length; i++) {
      const x = e ? Math.abs(e[i]) : 0;
      this.h += (x - this.h) * (x > this.h ? ka : kr);
      k[i] = this.h * p.verstaerkung[0];
    }
    return true;
  }
}
registerProcessor("folger", Folger);

// ---------- Schwelle (Runde 21) ----------
// Steigt das Signal über die Schwelle, meldet der Prozessor die genaue Zeit an die Seite (port.postMessage); die
// Seite schickt daraus einen Takt. Fällt es unter Schwelle − Hysterese, kommt „los“. Die Hysterese verhindert
// Flattern: ein verrauschtes Signal knapp an der Schwelle würde sonst hundertmal hin und her melden.
// Ausgang: das Gate selbst (1 oder 0) als Ton.
class Schwelle extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "schwelle", defaultValue: 0.3 },
      { name: "hysterese", defaultValue: 0.05, minValue: 0 },
    ];
  }
  constructor() {
    super();
    this.oben = false;
  }
  process([ein], [aus], p) {
    const k = aus[0], e = ein[0], s = p.schwelle[0], h = p.hysterese[0];
    for (let i = 0; i < k.length; i++) {
      const x = e ? e[i] : 0;
      if (!this.oben && x > s) {
        this.oben = true;
        this.port.postMessage({ an: true, zeit: currentTime + i / sampleRate });
      } else if (this.oben && x < s - h) {
        this.oben = false;
        this.port.postMessage({ an: false, zeit: currentTime + i / sampleRate });
      }
      k[i] = this.oben ? 1 : 0;
    }
    return true;
  }
}
registerProcessor("schwelle", Schwelle);

// ---------- Tropfen (Runde 21) ----------
// Wasser klingt nicht nach „Rauschen“, sondern nach Blasen. Fällt ein Tropfen ins Wasser, schließt er eine kleine
// Luftblase ein, und die schwingt wie eine Feder: die Luft drinnen ist die Feder, das Wasser drumherum die Masse.
// Minnaert (1933): Frequenz ≈ 3,26 kHz · mm / Radius. Eine Blase von 1 mm singt bei gut 3 kHz, eine von 5 mm bei
// 650 Hz. Van den Doel (2005) hat daraus ein Klangmodell gemacht: eine Sinusschwingung, die abklingt (Dämpfung
// d = 0,043 · f + 0,0014 · f^1,5 je Sekunde: kleine, hohe Blasen sind schneller weg) und dabei in der Tonhöhe steigt,
// weil die Blase zur Oberfläche aufsteigt: f(t) = f₀ · (1 + ξ · d · t). Das Steigen („plopp“ statt „pling“) macht
// den Wasserklang. Viele davon, zufällig verteilt (Poisson: in jedem Sample mit Wahrscheinlichkeit Rate / fs):
// tausend kleine je Sekunde sind Regen, dreißig große ein Bach.
class Tropfen extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rate", defaultValue: 40, minValue: 0 },
      { name: "rKlein", defaultValue: 1, minValue: 0.1 },
      { name: "rGross", defaultValue: 6, minValue: 0.1 },
      { name: "steigen", defaultValue: 0.1, minValue: 0 },
      { name: "breite", defaultValue: 0.8, minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.blasen = []; // { phase, f0, d, t, a, links, rechts }
    this.bestellt = []; // Zeiten einzelner Tropfen aus dem Takt-Eingang
    this.port.onmessage = (e) => this.bestellt.push(e.data.zeit);
  }
  process(_, [aus], p) {
    const L = aus[0], R = aus[1] ?? aus[0], n = L.length, dt = 1 / sampleRate;
    const chance = p.rate[0] / sampleRate, rk = p.rKlein[0], rg = Math.max(rk, p.rGross[0]), xi = p.steigen[0], br = p.breite[0];
    for (let i = 0; i < n; i++) {
      const jetzt = currentTime + i * dt;
      const bestellt = this.bestellt.length && this.bestellt[0] <= jetzt;
      if (bestellt) this.bestellt.shift();
      if ((bestellt || Math.random() < chance) && this.blasen.length < 96) {
        // viele kleine, wenige große (Zufall hoch 2 schiebt zur kleinen Seite); bestellte eher groß
        const r = rk + (rg - rk) * (bestellt ? 0.5 + 0.5 * Math.random() : Math.random() ** 2);
        const f0 = Math.min(16000, 3260 / r);
        const pan = 0.5 + (Math.random() - 0.5) * br;
        const a = 0.25 * (0.3 + 0.7 * Math.random()) * Math.sqrt(r / rg); // große lauter, aber nicht zu sehr
        this.blasen.push({ phase: 0, f0, d: 0.043 * f0 + 0.0014 * f0 ** 1.5, t: 0, a, links: Math.cos(pan * Math.PI / 2), rechts: Math.sin(pan * Math.PI / 2) });
      }
      let l = 0, r = 0;
      for (let k = this.blasen.length - 1; k >= 0; k--) {
        const b = this.blasen[k];
        const huelle = b.a * Math.exp(-b.d * b.t);
        if (huelle < 1e-4) {
          this.blasen.splice(k, 1);
          continue;
        }
        // kurzer Einschwinger (0,5 ms), sonst knackt der Anfang
        const v = huelle * Math.min(1, b.t * 2000) * Math.sin(b.phase);
        b.phase += 2 * Math.PI * b.f0 * (1 + xi * b.d * b.t) * dt;
        b.t += dt;
        l += v * b.links;
        r += v * b.rechts;
      }
      L[i] = l;
      R[i] = r;
    }
    return true;
  }
}
registerProcessor("tropfen", Tropfen);

// ---------- Knistern (Runde 21) ----------
// Feuer, Vinyl, brechende Zweige: kurze Knackser zu zufälligen Zeiten. Jeder ist ein Stück Rauschen, das in
// „Länge“ Millisekunden abklingt. Die Stärke ist sehr ungleich verteilt (Zufall hoch 4): fast alle leise, selten
// ein lauter Knall. Genau das macht den Unterschied zwischen „Feuer“ und „gleichmäßigem Prasseln“ (in der Natur
// sind solche Verteilungen oft Potenzgesetze: viele kleine Ereignisse, wenige große).
class Knistern extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rate", defaultValue: 12, minValue: 0 },
      { name: "laenge", defaultValue: 0.002, minValue: 0.0001 },
      { name: "knall", defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: "breite", defaultValue: 0.7, minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.knackser = [];
  }
  process(_, [aus], p) {
    const L = aus[0], R = aus[1] ?? aus[0], n = L.length;
    const chance = p.rate[0] / sampleRate, br = p.breite[0];
    for (let i = 0; i < n; i++) {
      if (Math.random() < chance && this.knackser.length < 64) {
        const gross = Math.random() < p.knall[0] * 0.15;
        const a = gross ? 0.6 + 0.4 * Math.random() : 0.5 * Math.random() ** 4;
        const laenge = p.laenge[0] * (gross ? 2 + Math.random() * 4 : 0.5 + Math.random());
        const pan = 0.5 + (Math.random() - 0.5) * br;
        // Abklingfaktor je Sample: in „laenge“ Sekunden auf 1/e
        this.knackser.push({ a, faktor: Math.exp(-1 / (laenge * sampleRate)), links: Math.cos(pan * Math.PI / 2), rechts: Math.sin(pan * Math.PI / 2), tief: 0 });
      }
      let l = 0, r = 0;
      for (let k = this.knackser.length - 1; k >= 0; k--) {
        const c = this.knackser[k];
        if (c.a < 1e-4) {
          this.knackser.splice(k, 1);
          continue;
        }
        // jeder Knackser leicht tiefpassgefiltert (ein bisschen Holz statt nur Klick)
        c.tief += ((Math.random() * 2 - 1) - c.tief) * 0.5;
        const v = c.tief * c.a;
        c.a *= c.faktor;
        l += v * c.links;
        r += v * c.rechts;
      }
      L[i] = l;
      R[i] = r;
    }
    return true;
  }
}
registerProcessor("knistern", Knistern);

// ---------- Zirpen (Runde 21) ----------
// Eine Feldgrille reibt eine Schrillleiste am Flügel über eine Schrillkante: jeder Zahn ein Klick, sehr schnell
// hintereinander, und der Flügel schwingt als Resonator mit seiner Eigenfrequenz (um 4,5 kHz). Darum klingt es wie
// ein reiner, hoher Ton, zerhackt in Pulse (etwa 30 je Sekunde), je 3 bis 4 Pulse ein „Zirp“.
// Grillen sind wechselwarm: ihre Muskeln arbeiten bei Wärme schneller. Amos Dolbear (1897): die Zahl der Zirps pro
// Minute steigt fast genau linear mit der Temperatur; hier N = 7 · T − 30 (T in °C; bei 25 °C also 145 je Minute).
// Mehrere Grillen: jede mit eigener Phase, leicht anderer Tonhöhe und Temperatur (Abstand zum warmen Boden),
// eigener Lage im Raum. Zusammen ergibt das die flirrende Sommernacht.
class Zirpen extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "temperatur", defaultValue: 24 },
      { name: "traeger", defaultValue: 4600, minValue: 500 },
      { name: "pulse", defaultValue: 3, minValue: 1, maxValue: 8 },
      { name: "anzahl", defaultValue: 3, minValue: 1, maxValue: 12 },
      { name: "zufall", defaultValue: 0.3, minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.grillen = Array.from({ length: 12 }, (_, k) => ({
      phase: 0, zirp: Math.random(), verstimmt: 1 + (Math.random() - 0.5) * 0.08, waerme: (Math.random() - 0.5) * 3,
      pan: k === 0 ? 0.5 : Math.random(), laut: k === 0 ? 1 : 0.35 + 0.65 * Math.random(), pause: 0,
    }));
  }
  process(_, [aus], p) {
    const L = aus[0], R = aus[1] ?? aus[0], n = L.length, dt = 1 / sampleRate;
    const anzahl = Math.round(p.anzahl[0]), pulse = Math.round(p.pulse[0]), zufall = p.zufall[0];
    L.fill(0);
    R.fill(0);
    for (let g = 0; g < anzahl; g++) {
      const gr = this.grillen[g];
      const zirpsProSekunde = Math.max(0.2, 7 * (p.temperatur[0] + gr.waerme) - 30) / 60;
      const f = p.traeger[0] * gr.verstimmt, pulsDauer = 1 / 30;
      const links = Math.cos(gr.pan * Math.PI / 2) * gr.laut, rechts = Math.sin(gr.pan * Math.PI / 2) * gr.laut;
      for (let i = 0; i < n; i++) {
        gr.zirp += zirpsProSekunde * dt;
        if (gr.zirp >= 1) {
          gr.zirp -= 1;
          // manchmal setzt eine Grille einen Zirp aus (echte tun das; sonst klingt es wie ein Metronom)
          gr.pause = Math.random() < zufall * 0.3 ? 1 : 0;
        }
        const t = gr.zirp / zirpsProSekunde; // Sekunden seit Beginn des Zirps
        let huelle = 0;
        if (!gr.pause && t < pulse * pulsDauer) {
          const imPuls = (t % pulsDauer) / pulsDauer;
          huelle = imPuls < 0.65 ? Math.sin((Math.PI * imPuls) / 0.65) ** 2 : 0; // Puls: 65 % Ton, Rest still
        }
        gr.phase += 2 * Math.PI * f * dt;
        if (gr.phase > 2 * Math.PI) gr.phase -= 2 * Math.PI;
        const v = 0.35 * huelle * Math.sin(gr.phase);
        L[i] += v * links;
        R[i] += v * rechts;
      }
    }
    return true;
  }
}
registerProcessor("zirpen", Zirpen);


// ---------- Schleife (Runde 22) ----------
// Eine Bandschleife wie bei Eno und Fripp (zwei Revox-Bandmaschinen, 1973) oder einem Loop-Pedal: ein Stück Band
// läuft im Kreis an einem Kopf vorbei, der zugleich liest und (bei „Aufnahme“) schreibt. Hier ist das Band ein
// Ringpuffer, die Stelle des Kopfs eine Kommazahl p, die je Sample um „Tempo“ weiterrückt:
//   Tempo 1     normal;  0,5: halb so schnell, eine Oktave tiefer (wie Band);  −1: rückwärts
//   Aufnahme    an der Stelle p: neu = alt · Halten + Eingang. Halten 1: alles bleibt, Schicht um Schicht
//               (Overdub); 0,7: ältere Schichten werden bei jedem Umlauf leiser und verschwinden langsam, wie
//               Frippertronics; 0: ersetzt.
// Gelesen wird zwischen zwei Stellen gemischt (linear), damit es bei krummem Tempo nicht knirscht. Geschrieben wird
// auf die nächste ganze Stelle; schneller als 1 beim Aufnehmen lässt darum Lücken (hörbar als Rauheit), das ist bei
// echtem Band anders (dort wird die Aufnahme einfach gestaucht).
// Länge: wie lang der Kreis ist (bis 60 s). Der Inhalt bleibt, wenn man sie ändert: kürzer schneidet nur ab.
// Nachricht „leeren“: Band löschen. Zurück an die Seite: alle 50 ms die Stelle (für die Anzeige).
class Schleife extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "laenge", defaultValue: 4, minValue: 0.05, maxValue: 60, automationRate: "k-rate" },
      { name: "tempo", defaultValue: 1, minValue: -4, maxValue: 4 },
      { name: "aufnahme", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "halten", defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.max = Math.ceil(60 * sampleRate);
    this.band = [new Float32Array(this.max), new Float32Array(this.max)];
    this.p = 0;
    this.melden = 0;
    this.port.onmessage = (e) => {
      if (e.data.leeren) for (const b of this.band) b.fill(0);
      if (e.data.anfang) this.p = 0;
    };
  }
  process([ein], [aus], p) {
    const n = aus[0].length, L = Math.max(2, Math.min(this.max, Math.round(p.laenge[0] * sampleRate)));
    const nimmt = p.aufnahme[0] > 0.5, halten = p.halten[0];
    for (let i = 0; i < n; i++) {
      const pos = ((this.p % L) + L) % L, g = Math.floor(pos), b = pos - g, g2 = (g + 1) % L;
      for (let c = 0; c < aus.length; c++) {
        const band = this.band[c] ?? this.band[0];
        aus[c][i] = band[g] * (1 - b) + band[g2] * b;
        if (nimmt) {
          const x = ein.length ? (ein[c] ?? ein[0])[i] : 0;
          const w = b < 0.5 ? g : g2;
          band[w] = band[w] * halten + x;
        }
      }
      this.p = pos + (p.tempo.length > 1 ? p.tempo[i] : p.tempo[0]);
    }
    if (++this.melden >= 18) {
      this.melden = 0;
      this.port.postMessage({ stelle: (((this.p % L) + L) % L) / L });
    }
    return true;
  }
}
registerProcessor("schleife", Schleife);


// ---------- Pling (Runde 22b) ----------
// Ein Baustein für alles, was angeschlagen wird und ausklingt: ein Sinus, der exponentiell leiser wird. Neu ist, dass
// beliebig viele gleichzeitig klingen dürfen (bis 128): jeder Takt (als Nachricht mit seiner Zeit) startet einen.
// Darum geht damit Regen, was mit einer Hüllkurve nicht geht (die kann nur einen Ton zugleich).
// Beim Start wird das Kabel „Tonhöhe“ an genau diesem Sample gelesen (1,0 pro Oktave): ein Zufall (Stufen) am
// selben Takt gibt so jedem Ton eine eigene Höhe.
//   Abklingen  „fest“: Zeitkonstante τ, nach τ ist er auf 37 %;  „Wasser“: wie eine Blase (van den Doel 2005),
//              d = 0,043 · f + 0,0014 · f^1,5 je Sekunde, kleine hohe Blasen sind schneller weg
//   Steigen    f(t) = f₀ · (1 + Steigen · t / τ): die Tonhöhe rutscht beim Ausklingen hoch (Blase steigt auf),
//              negativ: runter (Trommel, Holz)
//   Breite     jeder Ton an eine zufällige Stelle im Stereobild
class Pling extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequenz", defaultValue: 1000, minValue: 10 },
      { name: "abklingen", defaultValue: 0.1, minValue: 0.0005 },
      { name: "wasser", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "steigen", defaultValue: 0 },
      { name: "breite", defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: "laut", defaultValue: 0.3 },
    ];
  }
  constructor() {
    super();
    this.toene = [];
    this.bestellt = [];
    // Runde 24: Bestellungen, die zu spät ankommen (die Nachricht vom Haupt-Faden hing), spielten bisher alle im selben
    // Sample, alle mit Phase 0: bei Regen oder Bach mit hunderten Tropfen je Sekunde ein Knall (gemessen Spitze 8).
    // Jetzt: mehr als 30 ms zu spät fällt weg; weniger wird über die nächsten 10 ms verstreut (Zufall), statt gestapelt.
    this.port.onmessage = (e) => {
      const b = e.data;
      const spaet = currentTime - b.zeit;
      if (spaet > 0.03) return;
      if (spaet > 0) b.zeit = currentTime + Math.random() * 0.01;
      this.bestellt.push(b);
      this.bestellt.sort((a, c) => a.zeit - c.zeit);
    };
  }
  process([ein], [aus], p) {
    const L = aus[0], R = aus[1] ?? aus[0], n = L.length, dt = 1 / sampleRate, cv = ein[0];
    let neuImBlock = 0;
    for (let i = 0; i < n; i++) {
      const jetzt = currentTime + i * dt;
      while (this.bestellt.length && this.bestellt[0].zeit <= jetzt) {
        const b = this.bestellt.shift();
        // höchstens 12 neue Töne je Block (2,7 ms): mehr sind auch bei starkem Regen nicht echt, sondern ein Stau
        if (++neuImBlock > 12) continue;
        if (this.toene.length >= 128) this.toene.shift(); // der älteste muss weichen
        const f0 = Math.min(18000, p.frequenz[0] * 2 ** (cv ? cv[i] : 0));
        const tau = p.wasser[0] > 0.5 ? 1 / (0.043 * f0 + 0.0014 * f0 ** 1.5) : p.abklingen[0];
        const pan = 0.5 + (Math.random() - 0.5) * p.breite[0];
        this.toene.push({ phase: 0, f0, tau, t: 0, a: p.laut[0] * (b.anschlag ?? 1), steigen: p.steigen[0], links: Math.cos(pan * Math.PI / 2), rechts: Math.sin(pan * Math.PI / 2) });
      }
      let l = 0, r = 0;
      for (let k = this.toene.length - 1; k >= 0; k--) {
        const t = this.toene[k];
        const huelle = t.a * Math.exp(-t.t / t.tau) * Math.min(1, t.t * 4000); // 0,25 ms Einschwingen gegen Knacken
        if (t.t > t.tau * 9) {
          this.toene.splice(k, 1);
          continue;
        }
        const v = huelle * Math.sin(t.phase);
        t.phase += 2 * Math.PI * t.f0 * (1 + (t.steigen * t.t) / t.tau) * dt;
        t.t += dt;
        l += v * t.links;
        r += v * t.rechts;
      }
      L[i] = l;
      R[i] = r;
    }
    return true;
  }
}
registerProcessor("pling", Pling);

// ---------- Runde 24: Physikalische Modelle (Blasrohr, Bogen) ----------
// Statt einen Klang von außen zu formen (Oszillator → Filter), wird das Instrument selbst nachgerechnet: ein Rohr
// oder eine Saite als Verzögerungsleitung („digitaler Wellenleiter“, Julius O. Smith, Stanford, um 1985–1992). Eine
// Welle läuft durch das Rohr, wird am Ende zurückgeworfen und kommt nach der Zeit L / c wieder am Mundstück an. Dort
// sitzt das, was das Instrument zum Klingen bringt: ein Rohrblatt, eine Luftkante, die Lippen, ein Bogen. Alle sind
// NICHTLINEAR (ein Rohrblatt schließt sich bei zu viel Druckunterschied; ein Bogen haftet oder rutscht), und genau
// diese Nichtlinearität in einer Schleife mit Verzögerung schwingt von selbst, mit einem Ton, den die Länge bestimmt.
// Darum klingt ein Wellenleiter lebendig: der Ton „springt an“, je nach Druck mit mehr oder weniger Obertönen, mit
// Geräuschen beim Einschwingen, und bei zu wenig Druck springt er gar nicht an, wie bei einem echten Instrument.
// Die Formeln folgen dem Synthesis ToolKit (STK) von Perry Cook und Gary Scavone (Clarinet, Saxofony, Flute, Brass,
// Bowed), einer Sammlung, die genau diese Modelle offen und einfach gehalten hat.

// Eine Verzögerungsleitung, Länge mit Bruchteil (linear gelesen). tick(x): schreibt x, gibt das Sample von vor d zurück.
class Linie {
  constructor(n = 8192) {
    this.b = new Float32Array(n);
    this.m = n - 1;
    this.i = 0;
    this.letzt = 0;
  }
  tick(x, d) {
    this.i = (this.i + 1) & this.m;
    this.b[this.i] = x;
    const g = Math.floor(d), r = d - g;
    const a = this.b[(this.i - g) & this.m], b = this.b[(this.i - g - 1) & this.m];
    return (this.letzt = a + (b - a) * r);
  }
}
const begrenze = (x, u, o) => (x < u ? u : x > o ? o : x);
const wert = (p, i) => (p.length > 1 ? p[i] : p[0]);

// Blasrohr: art = klarinette | saxophon | floete (Nachricht { art } oder processorOptions). Ein Blech-Modell (Lippen
// als schwingendes Ventil, STK Brass) habe ich versucht: es sprang hier nicht verlässlich an, darum fehlt es noch.
//   druck    der Atem, 0 … 1 (meist eine Hüllkurve am Eingang): wie fest geblasen wird
//   staerke  größter Druck (bei Druck 1)
//   luft     Rauschen im Atem
//   blatt    Härte des Rohrblatts (Klarinette, Saxophon), Länge des Luftstrahls (Flöte)
class Blasrohr extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequenz", defaultValue: 220, minValue: 20, maxValue: 2000 },
      { name: "tonhoehe", defaultValue: 0 },
      { name: "druck", defaultValue: 0 },
      { name: "staerke", defaultValue: 0.75, minValue: 0, maxValue: 1.5 },
      { name: "luft", defaultValue: 0.15, minValue: 0, maxValue: 1 },
      { name: "blatt", defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ];
  }
  constructor(o) {
    super();
    this.art = o?.processorOptions?.art ?? "klarinette";
    this.port.onmessage = (e) => e.data.art && (this.art = e.data.art);
    this.l0 = new Linie();
    this.l1 = new Linie();
    this.z = 0; // Zustand des Schleifenfilters
    this.z2 = 0;
    this.dcx = 0;
    this.dcy = 0;
  }
  process(_, [aus], p) {
    const k = aus[0], n = k.length, sr = sampleRate;
    for (let i = 0; i < n; i++) {
      const f = begrenze(wert(p.frequenz, i) * 2 ** wert(p.tonhoehe, i), 20, 2000);
      const atem0 = Math.max(0, wert(p.druck, i)) * wert(p.staerke, i);
      const atem = atem0 * (1 + wert(p.luft, i) * (Math.random() * 2 - 1));
      const blatt = wert(p.blatt, i);
      let y = 0;
      if (this.art === "klarinette") {
        // Zylinder, an einem Ende zu: Die Welle muss zweimal hin und her, und am offenen Ende kehrt sich ihr Vorzeichen
        // um. Daher schwingt das Rohr bei Wellenlänge = 4 · Länge, und nur ungerade Obertöne passen hinein (der hohle,
        // „holzige“ Klang). Die Leitung ist eine halbe Periode lang.
        const d = 0.5 * sr / f - 1.5;
        const rohr = this.l0.letzt;
        const gefiltert = 0.5 * (rohr + this.z); // Verluste: hohe Frequenzen verlieren mehr (Mittelwert zweier Samples)
        this.z = rohr;
        const unterschied = -0.95 * gefiltert - atem; // Druck im Rohr gegen Druck im Mund
        // Rohrblatt: je größer der Unterschied, desto weiter schließt es (Kennlinie, Härte = Steigung)
        const blattK = begrenze(0.7 + (-0.44 + 0.26 * blatt) * unterschied, -1, 1);
        y = this.l0.tick(atem + unterschied * blattK, d);
      } else if (this.art === "saxophon") {
        // Kegel: ein Kegel schwingt (anders als der Zylinder) mit allen Obertönen, wie eine offene Röhre. STK baut ihn
        // aus zwei Leitungen, das Rohrblatt sitzt zwischen ihnen (Position 0,2); das gibt die Kerben im Spektrum.
        // STK setzt das Blatt bei 0,2 der Länge. Gemessen (Runde 24) sprang der Ton so oft auf die Oktave oder
        // Duodezime (überblasen); stabil auf dem Grundton blieb er mit dem Blatt bei 0,4 und etwas mehr Verlust
        // im Rohr (ein zusätzlicher Tiefpass dämpft die oberen Moden, die sonst „gewinnen“).
        const d = sr / f - 3, pos = 0.35 + 0.1 * blatt;
        const rohr = this.l0.letzt;
        this.z2 = 0.7 * rohr + 0.3 * this.z2;
        const gefiltert = 0.5 * (this.z2 + this.z);
        this.z = this.z2;
        const temp = -0.95 * gefiltert;
        y = temp - this.l1.letzt;
        const unterschied = atem - y;
        const blattK = begrenze(0.7 + 0.3 * unterschied, -1, 1);
        this.l1.tick(temp, Math.max(1, pos * d));
        this.l0.tick(atem - unterschied * blattK - temp, Math.max(1, (1 - pos) * d));
        y *= 0.3;
      } else if (this.art === "floete") {
        // Flöte: kein Blatt, sondern ein Luftstrahl, der über eine Kante bläst und hin und her kippt (mal ins Rohr,
        // mal daneben). Der Strahl braucht Zeit bis zur Kante: eine zweite, kurze Leitung (ein Drittel des Rohrs).
        // Die Kennlinie x · (x² − 1) ist der Strahl, der an der Kante geteilt wird.
        // STK stimmt das Rohr auf 2/3 der Frequenz und bläst über. Gemessen (Runde 24) sprang es hier nicht sicher
        // an; stabil über C4 … C6 schwingt es mit einem Rohr von zwei Perioden und einem Strahl von einem Viertel davon
        // (Strahl Viertel: Blatt 0,5), und mit Druck um 1 (darum Faktor 1,4 auf den Atem).
        const d = sr / (f * 0.5) - 2, dj = d * (0.2 + 0.1 * blatt);
        const pol = 0.7 - (0.1 * 22050) / sr;
        this.z = (1 - pol) * this.l1.letzt + pol * this.z; // Verluste im Rohr (Tiefpass)
        const temp = this.dc(this.z);
        // STK bläst die Flöte mit etwa doppeltem Druck (1,5) und Rauschen unabhängig vom Druck
        const atemF = 1.4 * atem0 + Math.min(1, 4 * atem0) * wert(p.luft, i) * 0.5 * (Math.random() * 2 - 1); // kein Atem: kein Rauschen
        let pd = atemF - 0.5 * temp;
        pd = this.l0.tick(pd, Math.max(1, dj));
        pd = begrenze(pd * (pd * pd - 1), -1, 1) + 0.5 * temp;
        y = this.dc2(0.3 * this.l1.tick(pd, d)); // der Atem hat einen Gleichanteil; am Ausgang weg damit
      }
      k[i] = Number.isFinite(y) ? y : ((this.l0 = new Linie()), (this.l1 = new Linie()), 0);
    }
    for (let c = 1; c < aus.length; c++) aus[c].set(k);
    return true;
  }
  dc2(x) {
    this.dc2y = x - (this.dc2x ?? 0) + 0.995 * (this.dc2y ?? 0);
    this.dc2x = x;
    return this.dc2y;
  }
  dc(x) {
    // Gleichanteil weg: y = x − x₁ + 0,995 · y₁
    this.dcy = x - this.dcx + 0.995 * this.dcy;
    this.dcx = x;
    return this.dcy;
  }
}
registerProcessor("blasrohr", Blasrohr);

// Bogen: die gestrichene Saite (STK Bowed). Die Saite ist in zwei Stücke geteilt, vom Bogen bis zum Steg und vom
// Bogen bis zum Sattel (Griffbrett). Am Bogen: Haften oder Rutschen. Ist die Geschwindigkeit der Saite nahe der des
// Bogens, klebt sie mit (hohe Reibung), sonst rutscht sie (wenig Reibung). Diese Kennlinie (|x| + 0,75)^−4 macht aus
// gleichmäßigem Ziehen die Sägezahn-Bewegung, die Helmholtz um 1860 gesehen hat.
//   druck    Bogengeschwindigkeit 0 … 1 (eine Hüllkurve)
//   staerke  größte Geschwindigkeit
//   blatt    Bogendruck: wenig = luftig, flötend (Flageolett-artig); viel = rau, kratzig
//   luft     wo der Bogen streicht: nah am Steg (0) = hell, „sul ponticello“; weiter weg (1) = weich, „sul tasto“
class Bogen extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequenz", defaultValue: 220, minValue: 20, maxValue: 2000 },
      { name: "tonhoehe", defaultValue: 0 },
      { name: "druck", defaultValue: 0 },
      { name: "staerke", defaultValue: 0.75, minValue: 0, maxValue: 1.5 },
      { name: "luft", defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: "blatt", defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.hals = new Linie();
    this.steg = new Linie();
    this.z = 0;
  }
  process(_, [aus], p) {
    const k = aus[0], n = k.length, sr = sampleRate;
    const pol = 0.75 - (0.2 * 22050) / sr;
    for (let i = 0; i < n; i++) {
      const f = begrenze(wert(p.frequenz, i) * 2 ** wert(p.tonhoehe, i), 20, 2000);
      const basis = sr / f - 4, beta = 0.06 + 0.2 * wert(p.luft, i);
      // Bogengeschwindigkeit: in STK 0,03 + 0,2 · Stärke. Gemessen (Runde 24) fiel die Saite damit oft in die
      // „doppelte Rutschbewegung“ (zwei Rutscher je Periode: eine Oktave zu hoch). Das Schelleng-Diagramm sagt:
      // für jede Geschwindigkeit gibt es ein Fenster für den Bogendruck. Langsamer ziehen hält sie im Fenster.
      const v = Math.max(0, wert(p.druck, i)) * 0.12 * wert(p.staerke, i);
      const steigung = 5 - 4 * wert(p.blatt, i);
      this.z = 0.95 * (1 - pol) * this.steg.letzt + pol * this.z; // Saite verliert am Steg Höhen
      const vomSteg = -this.z, vomSattel = -this.hals.letzt;
      const saite = vomSteg + vomSattel;
      const diff = v - saite;
      const reib = Math.min(1, (Math.abs(diff * steigung) + 0.75) ** -4);
      const neu = diff * reib;
      this.hals.tick(vomSteg + neu, Math.max(1, basis * (1 - beta)));
      const y = this.steg.tick(vomSattel + neu, Math.max(1, basis * beta));
      k[i] = Number.isFinite(y) ? y : ((this.hals = new Linie()), (this.steg = new Linie()), 0);
    }
    for (let c = 1; c < aus.length; c++) aus[c].set(k);
    return true;
  }
}
registerProcessor("bogen", Bogen);

// ---------- Runde 24: Wavetable ----------
// Eine Wellentabelle: acht einzelne Perioden („Frames“), zwischen denen die Position überblendet (wie in Abletons
// Wavetable, Serum, PPG Wave von 1981). Die Tabellen rechnet module-physik.js und schickt sie mit; je Frame drei
// Fassungen mit weniger Obertönen für hohe Töne („Mipmaps“), damit nichts über die halbe Abtastrate hinaus spiegelt.
// Zwei Stimmen, gegeneinander verstimmt (Unisono): die Schwebung macht den Klang breit.
class Wavetable extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequenz", defaultValue: 220, minValue: 10, maxValue: 8000 },
      { name: "tonhoehe", defaultValue: 0 },
      { name: "position", defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: "verstimmen", defaultValue: 0, minValue: 0, maxValue: 50 },
      { name: "stimmen", defaultValue: 2, minValue: 1, maxValue: 7, automationRate: "k-rate" },
    ];
  }
  constructor(o) {
    super();
    this.t = o.processorOptions.tabellen; // [Frame][Stufe] → Float32Array(2048)
    this.ph = Array.from({ length: 7 }, () => Math.random()); // freie Phasen: sonst starten alle gleich und „wischen“
  }
  process(_, [aus], p) {
    const k = aus[0], n = k.length, L = 2048, F = this.t.length;
    for (let i = 0; i < n; i++) {
      const f = Math.min(8000, wert(p.frequenz, i) * 2 ** wert(p.tonhoehe, i));
      const pos = begrenze(wert(p.position, i), 0, 1) * (F - 1), a = Math.min(F - 2, Math.floor(pos)), r = pos - a;
      const stufe = f < 300 ? 0 : f < 1200 ? 1 : 2; // 64, 16 oder 4 Obertöne
      const ta = this.t[a][stufe], tb = this.t[a + 1][stufe];
      // Runde 25: bis zu 7 Stimmen (Supersaw, Roland JP-8000, 1996: sieben Sägezähne, gegeneinander verstimmt).
      // Die Verstimmung verteilt sich gleichmäßig von −Unisono/2 bis +Unisono/2 Cent.
      const cent = wert(p.verstimmen, i), N = Math.round(p.stimmen[0]);
      let y = 0;
      for (let v = 0; v < N; v++) {
        const lage = N === 1 ? 0 : (v / (N - 1)) * 2 - 1;
        const fv = f * 2 ** ((lage * cent) / 2400);
        this.ph[v] = (this.ph[v] + fv / sampleRate) % 1;
        const x = this.ph[v] * L, j = Math.floor(x), q = x - j, j2 = (j + 1) & (L - 1);
        const sa = ta[j] + (ta[j2] - ta[j]) * q, sb = tb[j] + (tb[j2] - tb[j]) * q;
        y += sa + (sb - sa) * r;
      }
      k[i] = y / Math.sqrt(N * 2); // mehr Stimmen: lauter wie Rauschen (√N), nicht wie gleiche Töne (N)
    }
    for (let c = 1; c < aus.length; c++) aus[c].set(k);
    return true;
  }
}
registerProcessor("wavetable", Wavetable);
