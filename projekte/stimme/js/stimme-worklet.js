// Die Stimme als Klangquelle im Audio-Thread (AudioWorklet): Kehlkopf → Rohr → Lippen und Nase.
// Aufgebaut wie Pink Trombone von Neil Thapen (2017, MIT-Lizenz); Rechnung und Namen hier neu geschrieben.
//
// 1. Glottis (Stimmlippen): sie öffnen und schließen sich periodisch; der Luftstrom dabei hat eine typische
//    Form. Hier nach dem LF-Modell (Liljencrants und Fant 1985) die Ableitung des Luftstroms pro Periode:
//    erst ein wachsender Sinus (Öffnen), dann ein steiler Abfall (Schließen) und ein exponentielles
//    Ausklingen (Rückkehr). Ein Parameter Rd (aus der „Spannung“) formt das alles: gespannte Stimme = kurzer,
//    scharfer Schluss (viele Obertöne), entspannte = weicher, hauchiger. Dazu Atemrauschen, je lockerer desto mehr.
// 2. Vokaltrakt: ein Rohr aus N Stücken mit verschiedenen Durchmessern. Der Schall läuft als zwei Wellen
//    (vorwärts zu den Lippen, rückwärts zum Kehlkopf). An jeder Stelle, wo sich die Fläche A ändert, wird ein Teil
//    zurückgeworfen: k = (A_links − A_rechts) / (A_links + A_rechts) (Kelly und Lochbaum 1962). Die Form des Rohrs
//    bestimmt so, welche Frequenzen verstärkt werden (Formanten): daran erkennt man die Vokale.
// 3. Nasenrohr: hängt am Gaumensegel (Velum); ist es offen, teilt sich der Schall dort in drei Wege.
// 4. Rauschen an Engstellen: wo das Rohr fast zu ist, wird die Luft turbulent: Zischlaute (s, sch, f).
//    Ganz zu (Durchmesser unter 0,3) rauscht nichts; öffnet es sich wieder, läuft die Enge kurz durch den
//    rauschenden Bereich: das ist der Knall der Plosive (p, t, k). Beim Schließen dagegen fast nichts (die Luft
//    staut sich erst, wenn die Stelle zu ist), und jede Engstelle hat ihre eigene Stärke (rausch): an den Lippen
//    und Zähnen (f, th) ist das Rauschen viel leiser als am Zahndamm (s), wie bei echten Stimmen.
// Das Rohr wird zweimal pro Sample gerechnet: so ist jedes Stück kurz genug für ein Rohr von etwa 17 cm.
//
// Zweite Art (art = "formanten"), wie SAM (Software Automatic Mouth, Don't Ask Software 1982, auf C64 und
// Atari): kein Rohr, sondern die Formanten direkt. Bei jedem Puls der Stimmlippen starten drei Schwingungen bei
// F1, F2, F3 neu (Phase 0) und klingen ab; die dritte ist ein Rechteck. Das ist eine sehr grobe Art, drei
// Resonanzen nachzumachen, und genau das macht den metallischen, schnarrenden Klang der alten Sprachchips.
// Zischlaute: Rauschen durch einen Bandpass. Die Formanten kommen von der Seite (laute.js).
//
// Danach für beide: weniger Bits und eine niedrigere Abtastrate (wie ein alter Chip: SAM hatte 4 Bit).

const N = 44; // Stücke im Mund-Rachen-Rohr
const NASE = 28; // Stücke in der Nase
const VELUM = 17; // hier zweigt die Nase ab
const ZUNGE_VON = 10; // Bereich, den die Zunge formt
const ZUNGE_BIS = 32;
const LIPPEN = 39; // ab hier: Lippen

class Stimme extends AudioWorkletProcessor {
  constructor() {
    super();
    this.p = {
      frequenz: 120, // Hz
      spannung: 0.6, // 0 locker, hauchig … 1 gepresst
      lautstaerke: 0.8,
      an: true, // fließt Luft?
      stimmhaft: 1, // schwingen die Stimmlippen (0: nur Luft, für s, f, h, Flüstern)
      vibrato: 0.005, // Anteil der Frequenz
      zittern: 0.1, // unregelmäßiges Wackeln der Tonhöhe
      untertoene: 0, // jeder zweite Puls schwächer: die Periode verdoppelt sich (Knarren, Growl)
      zungeOrt: 17.5,
      zungeWeite: 2.5,
      enge: [], // [{ ort, weite, rausch }]: Engstellen von Zungenspitze und Lippen (weite 0 = zu; rausch 0 bis 1, ohne: 1)
      velum: 0.01, // Öffnung zur Nase
      rauschStaerke: 1,
      aufnahme: false,
      art: "rohr", // oder "formanten" (SAM)
      formanten: [500, 1500, 2500], // nur für „formanten“: F1, F2, F3 in Hz
      formantLaut: 1, // wie laut die Formanten klingen (bei Nasalen und Verschlüssen leiser)
      formantRausch: 0, // Zischen bei „formanten“ (0 bis 1)
      rauschBand: 4000, // … um diese Frequenz
      bits: 16, // weniger: gröber (4 wie SAM)
      abtast: 48000, // Abtastrate des Chips in Hz (darunter: Treppen, Spiegelfrequenzen)
    };
    this.port.onmessage = (e) => Object.assign(this.p, e.data);
    // Rohr: Durchmesser (Ziel und aktuell), Wellen nach rechts R und links L
    this.d = new Float32Array(N).fill(1.5);
    this.dVorher = new Float32Array(N).fill(1.5); // für „schließt sich gerade“
    this.ziel = new Float32Array(N).fill(1.5);
    this.R = new Float32Array(N);
    this.L = new Float32Array(N);
    this.jR = new Float32Array(N + 1);
    this.jL = new Float32Array(N + 1);
    this.k = new Float32Array(N + 1);
    this.A = new Float32Array(N);
    // Nase: feste Form (eng am Anfang, weiter in der Mitte, zum Nasenloch wieder enger)
    this.nd = new Float32Array(NASE);
    for (let i = 0; i < NASE; i++) {
      const d = (2 * i) / NASE;
      this.nd[i] = Math.min(1.9, d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d));
    }
    this.nR = new Float32Array(NASE);
    this.nL = new Float32Array(NASE);
    this.njR = new Float32Array(NASE + 1);
    this.njL = new Float32Array(NASE + 1);
    this.nk = new Float32Array(NASE + 1);
    this.nA = new Float32Array(NASE);
    for (let i = 0; i < NASE; i++) this.nA[i] = this.nd[i] * this.nd[i];
    this.velum = 0.01;
    // Glottis
    this.phase = 0;
    this.pulsNr = 0;
    this.f = 120;
    this.form = null;
    this.neueForm(0.6);
    this.zeit = 0;
    this.luft = 0; // geglättet: Luft an/aus ohne Knacken
    this.schwingen = 1;
    this.rauschFilter = { a: 0, b: 0 }; // Bandpass fürs Zischen
    this.atemFilter = { a: 0, b: 0 }; // … und fürs Atemrauschen (zweimal hintereinander: schmaler, weniger Zischeln)
    this.atemFilter2 = { a: 0, b: 0 };
    this.tief = 0; // Tiefpass am Ausgang
    this.tiefA = 1 - Math.exp((-2 * Math.PI * 7000) / sampleRate);
    this.blockZaehler = 0;
    this.fz = { f: [500, 1500, 2500], a: 0, rs: 0, rf: 4000 }; // Formanten, die gerade klingen (gleiten zu den Zielen)
    this.samFilter = { a: 0, b: 0 };
    this.halte = 0; // Abtastrate senken: Wert halten
    this.halteZaehler = 0;
  }

  // SAM-Art: ein Sample aus den drei Formanten (siehe oben). laut: Stimme, hauch: Atemrauschen
  formantSample(laut, hauch, rate) {
    const p = this.p;
    const z = this.fz;
    // zu den Zielen gleiten (etwa 10 ms), sonst springen die Laute hart
    for (let k = 0; k < 3; k++) z.f[k] += (p.formanten[k] - z.f[k]) * 0.005;
    z.a += (p.formantLaut - z.a) * 0.005;
    z.rs += (p.formantRausch - z.rs) * 0.005;
    z.rf += (p.rauschBand - z.rf) * 0.005;
    const t = this.phase / this.f; // Sekunden seit dem letzten Puls
    const w = 2 * Math.PI * t;
    // abklingende Schwingungen: so klingt eine Resonanz mit der Bandbreite B nach einem Stoß (e^(−πBt))
    const s =
      Math.exp(-Math.PI * 90 * t) * Math.sin(w * z.f[0]) +
      0.6 * Math.exp(-Math.PI * 110 * t) * Math.sin(w * z.f[1]) +
      0.3 * Math.exp(-Math.PI * 170 * t) * (Math.sin(w * z.f[2]) >= 0 ? 1 : -1);
    const fc = Math.min(1.2, 2 * Math.sin((Math.PI * z.rf) / rate));
    const rausch = this.bandpass(this.samFilter, Math.random() * 2 - 1, fc) * z.rs * this.luft * p.lautstaerke * p.rauschStaerke * 0.07;
    return s * laut * z.a * 0.19 + rausch + hauch * 0.25;
  }

  // LF-Modell: aus der Spannung (0 bis 1) die Form eines Pulses (Fant 1995, „Rd“-Parameter)
  neueForm(spannung) {
    const Rd = Math.min(2.7, Math.max(0.5, 3 * (1 - spannung)));
    const Ra = -0.01 + 0.048 * Rd; // Rückkehrzeit
    const Rk = 0.224 + 0.118 * Rd; // wie schief der Puls ist
    const Rg = ((Rk / 4) * (0.5 + 1.2 * Rk)) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));
    const Ta = Ra;
    const Tp = 1 / (2 * Rg); // Spitze des Luftstroms
    const Te = Tp + Tp * Rk; // Schluss
    // Ausklingen nach dem Schluss: e^(−ε(t − Te)), so dass der Puls am Periodenende bei 0 ankommt
    const eps = 1 / Ta;
    const shift = Math.exp(-eps * (1 - Te));
    const delta = 1 - shift;
    const rhsIntegral = ((1 / eps) * (shift - 1) + (1 - Te) * shift) / delta;
    const untenGesamt = -(Te - Tp) / 2 + rhsIntegral;
    const obenGesamt = -untenGesamt;
    // Öffnen: E0 · e^(αt) · sin(ωt), so dass die Fläche (der Luftstrom) über die Periode 0 ergibt
    const omega = Math.PI / Tp;
    const s = Math.sin(omega * Te);
    const y = (-Math.PI * s * obenGesamt) / (Tp * 2);
    const alpha = Math.log(Math.max(y, 1e-9)) / (Tp / 2 - Te);
    const E0 = -1 / (s * Math.exp(alpha * Te));
    this.form = { alpha, E0, eps, shift, delta, Te, omega };
  }
  puls(t) {
    const f = this.form;
    if (t > f.Te) return (-Math.exp(-f.eps * (t - f.Te)) + f.shift) / f.delta;
    return f.E0 * Math.exp(f.alpha * t) * Math.sin(f.omega * t);
  }

  // Ziel-Durchmesser aus Zunge und Engstellen
  formeRohr() {
    const p = this.p;
    for (let i = 0; i < N; i++) {
      // Grundform: eng am Kehlkopf, weit im Rachen und Mund
      let d = i < 7 ? 0.6 : i < 12 ? 1.1 : 1.5;
      // Zunge: ein Bogen (Kosinus), der den Mund zwischen Rachen und Zungenspitze verengt; Ort = wo der
      // Zungenrücken am höchsten ist, Weite = wie weit er dort vom Gaumen weg ist
      // (der Bogen reicht bis zu den Lippen; seine Breite misst sich am Zungenkörper von 10 bis 32)
      if (i >= ZUNGE_VON && i < LIPPEN) {
        const t = (1.1 * Math.PI * (p.zungeOrt - i)) / (ZUNGE_BIS - ZUNGE_VON);
        const weite = 2 + (p.zungeWeite - 2) / 1.5;
        let bogen = (1.5 - weite + 1.7) * Math.cos(t);
        if (i === LIPPEN - 1) bogen *= 0.8;
        if (i === ZUNGE_VON || i === LIPPEN - 2) bogen *= 0.94;
        d = 1.5 - bogen;
      }
      this.ziel[i] = Math.max(0, d);
    }
    // Engstellen (Zungenspitze, Lippen): weiche Delle um den Ort, hinten breiter (der Zungenrücken ist breit)
    for (const e of p.enge) {
      const breite = e.ort < 25 ? 10 : e.ort < LIPPEN ? 5 : 3;
      for (let i = 0; i < N; i++) {
        const r = Math.abs(i - e.ort);
        if (r >= breite) continue;
        const w = 0.5 + 0.5 * Math.cos((Math.PI * r) / breite);
        this.ziel[i] = Math.min(this.ziel[i], e.weite * w + this.ziel[i] * (1 - w));
      }
    }
  }

  process(_, ausgaenge) {
    const aus = ausgaenge[0][0];
    const p = this.p;
    this.formeRohr();
    // das Rohr bewegt sich nicht sofort (Muskeln brauchen Zeit): pro Block ein Stück zum Ziel; schließen geht schneller
    this.dVorher.set(this.d);
    for (let i = 0; i < N; i++) {
      const schritt = this.ziel[i] < this.d[i] ? 0.06 : 0.04;
      this.d[i] += Math.max(-schritt, Math.min(schritt, this.ziel[i] - this.d[i]));
      this.A[i] = this.d[i] * this.d[i];
    }
    for (let i = 1; i < N; i++) {
      const s = this.A[i - 1] + this.A[i];
      this.k[i] = s === 0 ? 0.999 : (this.A[i - 1] - this.A[i]) / s;
    }
    // Velum: Fläche des ersten Nasenstücks folgt der Einstellung
    this.velum += (p.velum - this.velum) * 0.1;
    this.nA[0] = this.velum * this.velum;
    for (let i = 1; i < NASE; i++) this.nk[i] = (this.nA[i - 1] - this.nA[i]) / (this.nA[i - 1] + this.nA[i]);
    // Rauschen an jeder Engstelle: nur, wo sie fast zu ist (0,3 bis 0,7) – stärker, je enger
    const zischOrte = [];
    for (const e of p.enge) {
      const i = Math.min(N - 2, Math.max(2, Math.round(e.ort)));
      const d = this.d[i];
      const duenn = Math.min(1, Math.max(0, 8 * (0.7 - d)));
      const offen = Math.min(1, Math.max(0, 30 * (d - 0.3)));
      const schliesst = d < this.dVorher[i] - 0.01 ? 0.15 : 1;
      const staerke = duenn * offen * schliesst * (e.rausch ?? 1);
      if (staerke > 0) zischOrte.push({ i, staerke });
    }
    const rate = sampleRate;
    for (let n = 0; n < aus.length; n++) {
      this.zeit += 1 / rate;
      this.luft += ((p.an ? 1 : 0) - this.luft) * 0.004;
      this.schwingen += (p.stimmhaft - this.schwingen) * 0.004;
      // Tonhöhe mit Vibrato und Zittern (zwei langsame, nicht verwandte Sinus: eine echte Stimme ist nie ganz gerade)
      this.f += (p.frequenz - this.f) * 0.002;
      const t = this.zeit;
      const wackeln = 1 + p.vibrato * Math.sin(2 * Math.PI * t * 6) + 0.02 * p.zittern * (Math.sin(t * 4.07) * Math.sin(t * 2.15) + 0.5 * Math.sin(t * 13.3) * Math.sin(t * 7.9));
      this.phase += (this.f * wackeln) / rate;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.pulsNr++;
        this.neueForm(p.spannung); // neue Spannung erst am Anfang einer Periode (sonst knackt es)
      }
      const laut = this.luft * this.schwingen * p.lautstaerke * Math.pow(p.spannung, 0.25);
      const unter = this.pulsNr % 2 ? 1 - p.untertoene : 1;
      let stimme = this.puls(this.phase) * laut * unter;
      // Atemrauschen: gefiltert, im Takt der Glottis (mehr, wenn sie offen ist), mehr bei lockerer Stimme;
      // ohne Schwingen (Flüstern, h) rauscht nur der Atem
      const atem = this.bandpass(this.atemFilter2, this.bandpass(this.atemFilter, Math.random() * 2 - 1, 0.07), 0.07) * 0.5;
      const offenheit = this.schwingen > 0.5 ? 0.2 + 0.3 * Math.max(0, Math.sin(Math.PI * 2 * this.phase)) : 0.5;
      const hauch = (1 - Math.sqrt(p.spannung)) * this.schwingen + 0.3 * (1 - this.schwingen);
      stimme += atem * hauch * offenheit * this.luft * p.lautstaerke * 1.5;
      // Zischen: Bandpass um etwa 2 kHz
      const zisch = this.bandpass(this.rauschFilter, Math.random() * 2 - 1, 0.3) * this.luft * p.rauschStaerke * p.lautstaerke * 0.25;
      let wert;
      if (p.art === "formanten") {
        wert = this.formantSample(laut * unter, atem * hauch * offenheit * this.luft * p.lautstaerke * 1.5, rate);
      } else {
        let lippen = 0;
        let nase = 0;
        for (let doppelt = 0; doppelt < 2; doppelt++) {
          // Zischen an seinem Ort einspeisen (halb nach vorn, halb zurück)
          for (const z of zischOrte) {
            this.R[z.i + 1] += zisch * z.staerke * 0.5;
            this.L[z.i + 1] += zisch * z.staerke * 0.5;
          }
          // Ränder: die Glottis wirft fast alles zurück und speist die Stimme ein; die offenen Lippen werfen umgekehrt zurück
          this.jR[0] = this.L[0] * 0.75 + stimme;
          this.jL[N] = this.R[N - 1] * -0.85;
          for (let i = 1; i < N; i++) {
            const w = this.k[i] * (this.R[i - 1] + this.L[i]);
            this.jR[i] = this.R[i - 1] - w;
            this.jL[i] = this.L[i] + w;
          }
          // Abzweig zur Nase: drei Rohre treffen sich am Velum. Alle ankommenden Wellen zusammen werden nach
          // Fläche aufgeteilt: in jedes Rohr geht (2·A_Rohr / Summe aller A) · (alles, was ankam) − (was aus ihm kam).
          // Mit zwei Rohren ist das genau die Formel mit k oben; ein fast geschlossenes Velum (kleines A) lässt kaum etwas hinein.
          const v = VELUM;
          const a0 = this.A[v - 1], a1 = this.A[v], an = this.nA[0];
          const summe = a0 + a1 + an;
          if (summe > 0) {
            const ankommend = this.R[v - 1] + this.L[v] + this.nL[0];
            this.jL[v] = ((2 * a0) / summe) * ankommend - this.R[v - 1];
            this.jR[v] = ((2 * a1) / summe) * ankommend - this.L[v];
            this.njR[0] = ((2 * an) / summe) * ankommend - this.nL[0];
          }
          for (let i = 0; i < N; i++) {
            this.R[i] = this.jR[i] * 0.999;
            this.L[i] = this.jL[i + 1] * 0.999;
          }
          lippen += this.R[N - 1];
          // Nase
          this.njL[NASE] = this.nR[NASE - 1] * -0.85;
          for (let i = 1; i < NASE; i++) {
            const w = this.nk[i] * (this.nR[i - 1] + this.nL[i]);
            this.njR[i] = this.nR[i - 1] - w;
            this.njL[i] = this.nL[i] + w;
          }
          for (let i = 0; i < NASE; i++) {
            this.nR[i] = this.njR[i] * 0.995;
            this.nL[i] = this.njL[i + 1] * 0.995;
          }
          nase += this.nR[NASE - 1];
        }
        // sanfter Tiefpass bei 7 kHz: nimmt das feine Zischeln über allem weg (das Rohr hat dort ohnehin keine Formanten mehr)
        wert = (lippen + nase) * 0.125;
      }
      this.tief += this.tiefA * (wert - this.tief);
      let y = this.tief;
      // alter Chip: Abtastrate senken (jeden Wert eine Weile halten) und weniger Stufen (Bits)
      if (p.abtast < rate) {
        this.halteZaehler += p.abtast / rate;
        if (this.halteZaehler >= 1) {
          this.halteZaehler -= 1;
          this.halte = y;
        }
        y = this.halte;
      }
      if (p.bits < 16) {
        const stufen = 2 ** (p.bits - 1);
        y = Math.round(y * 2.5 * stufen) / stufen / 2.5; // 2,5: so laut wird es danach (Verstärkung auf der Seite)
      }
      aus[n] = Math.max(-1, Math.min(1, y));
    }
    for (let c = 1; c < ausgaenge[0].length; c++) ausgaenge[0][c].set(aus);
    if (p.aufnahme) this.port.postMessage({ ton: aus.slice() });
    // dem Bild sagen, wie das Rohr gerade aussieht (für die Zeichnung), etwa 50-mal pro Sekunde
    if (++this.blockZaehler % 7 === 0) this.port.postMessage({ d: this.d.slice(), velum: this.velum, f: this.f, phase: this.phase });
    return true;
  }

  // Bandpass zweiter Ordnung (State Variable Filter): f ≈ 2·sin(π·Mitte/Rate), liefert das Band
  bandpass(z, x, f) {
    z.a += f * z.b;
    const hoch = x - z.a - 0.5 * z.b;
    z.b += f * hoch;
    return z.b;
  }
}

registerProcessor("stimme", Stimme);
