// Der Klang: läuft im Audio-Thread (AudioWorklet), getrennt von der Seite.
// Er liest die Ebenen am Lesekopf und macht daraus Ton, Fenster für Fenster, solange es läuft.
// Was du unter den laufenden Lesekopf malst, hörst du darum sofort (wie beim ANS-Synthesizer).
//
// Inverse STFT mit Overlap-Add:
//   Alle "sprung" Samples entsteht ein neues Fenster aus der Spalte am Lesekopf:
//   1. Spektrum bauen: jedes Fach bekommt Betrag (aus den Ebenen) und Phase (läuft selbst weiter)
//   2. inverse FFT -> fenster Samples, die genau so klingen
//   3. mit dem Hann-Fenster weich ein- und ausblenden und auf den Ausgang addieren
//   Weil jedes Fenster 4 Sprünge lang ist, liegen immer 4 übereinander.
//
// Zwei Sorten Inhalt, in einem Spektrum zusammengezählt:
//
// Gemalt (Malschicht und Bilder) hat keine Phase. Jedes Fach ist ein Sinus genau auf seiner Mitte,
// seine Phase dreht sich pro Sprung um 2π · k · sprung / fenster weiter. Dann passen die Fenster nahtlos
// aneinander, und eine gleich bleibende Spalte klingt wie ein reiner, durchgehender Ton.
// Die Hann-Fenster addieren sich bei 4-facher Überlappung zu 2: mal 0,5, dann bleibt es gleich laut.
//
// Ton-Ebenen haben ihre echte Phase (ton-analyse.js). Jede hat eigene Phasen, die sich pro Sprung um
// dreh der Spalte am Lesekopf weiterdrehen (Phasen-Vocoder, mit Phasen-Kopplung, siehe unten). Bei Tempo 1 vorwärts ist das genau die
// gespeicherte Phase, schneller, langsamer, rückwärts oder angehalten klingt die Aufnahme in ihrer
// Tonhöhe weiter. Nach einem Sprung des Lesekopfs fängt sie wieder bei der gespeicherten Phase an.
// Ihr Fenster ist schon mit dem Hann-Fenster ausgeschnitten (Analyse), das Ausblenden hier kommt dazu:
// zweimal Hann addiert sich bei 4-facher Überlappung zu 1,5, mal 0,5 sind 0,75, darum hier mal 4/3.
//
// Die Phase läuft immer vorwärts, auch wenn der Lesekopf rückwärts läuft oder steht:
// Die Zeit des Hörers läuft ja weiter. Darum klingt rückwärts hier anders als ein umgedrehter Ton
// (bild-zu-ton): rückwärts wird die Leinwand gelesen, nicht die Samples.
// Festhalten (oder Tempo 0) ist so der spektrale Freeze: eine Spalte klingt endlos weiter.
//
// Worklets sind Module: import geht, aber nur Dinge ohne Seite (kein document, kein window).

import { baueFft } from "/lib/fft.js";
import { amplitudenTabelle, amplitude, rollen, dbZuFaktor } from "./ebenen.js";

const ZWEI_PI = 2 * Math.PI;

class SpektralStimme extends AudioWorkletProcessor {
  constructor(optionen) {
    super();
    this.leinwand = null;
    this.ebenen = [];
    this.laeuft = false;
    this.pos = 0; // Lesekopf in Spalten (mit Komma: zwischen zwei Spalten wird gemischt)
    this.einstellung = { tempo: 1, rueckwaerts: false, schleife: true, halten: false, dynamik: 60, zufall: 0, lautstaerke: 0.3 };
    this.tabelle = amplitudenTabelle(60);
    this.letzteMeldung = 0;
    this.port.onmessage = (event) => this.nachricht(event.data);
    // beim Start und beim Rendern einer WAV kommt alles auf einmal mit (processorOptions)
    const zustand = optionen?.processorOptions?.zustand;
    if (zustand) this.nachricht({ art: "zustand", ...zustand });
  }

  nachricht(n) {
    if (n.art === "zustand") {
      this.baue(n.leinwand);
      for (const e of n.ebenen) this.setzeEbene(e);
      this.stelle(n.einstellung);
      this.pos = n.pos;
      this.laeuft = n.laeuft ?? false;
    } else if (n.art === "neu") {
      this.baue(n.leinwand);
    } else if (n.art === "ebene") {
      this.setzeEbene(n.ebene);
    } else if (n.art === "weg") {
      this.ebenen = this.ebenen.filter((e) => e.id !== n.id);
      this.ordne();
    } else if (n.art === "eigenschaften") {
      const e = this.ebenen.find((x) => x.id === n.id);
      if (e) Object.assign(e, n.werte);
      this.ordne();
    } else if (n.art === "teil") {
      // ein Stück eines Feldes hat sich geändert (Malen, Auswahl verschieben, Rückgängig)
      this.ebenen.find((x) => x.id === n.id)?.[n.feld].set(n.werte, n.von);
    } else if (n.art === "einstellung") {
      this.stelle(n.werte);
    } else if (n.art === "spiel") {
      this.laeuft = n.laeuft;
    } else if (n.art === "position") {
      this.pos = n.spalte;
    }
  }

  stelle(werte) {
    const alteDynamik = this.einstellung.dynamik;
    Object.assign(this.einstellung, werte);
    if (this.einstellung.dynamik !== alteDynamik || !this.tabelle) this.tabelle = amplitudenTabelle(this.einstellung.dynamik);
  }

  // neue Leinwand: alles neu anlegen, noch ohne Ebenen
  baue(leinwand) {
    const { fenster, sprung, spalten, faecher } = leinwand;
    this.leinwand = leinwand;
    this.ebenen = [];
    this.ordne();
    this.pos = Math.min(this.pos, spalten);
    this.fft = baueFft(fenster);
    this.re = new Float32Array(fenster);
    this.im = new Float32Array(fenster);
    this.stueck = new Float32Array(fenster);
    this.summe = new Float32Array(fenster); // Overlap-Add: hier liegen die Fenster übereinander
    this.gelesen = sprung; // gleich beim ersten Sample ein neues Fenster
    this.hann = new Float32Array(fenster);
    for (let n = 0; n < fenster; n++) this.hann[n] = 0.5 - 0.5 * Math.cos((ZWEI_PI * n) / fenster);
    // Phase jedes gemalten Fachs: zufälliger Start, sonst sind am Anfang alle Sinusse gleichzeitig oben (Knall)
    this.phase = new Float32Array(faecher);
    for (let k = 0; k < faecher; k++) this.phase[k] = Math.random() * ZWEI_PI;
    // um so viel dreht sich Fach k pro Sprung (siehe oben), ganze Umdrehungen weggelassen
    // (wie dreh in ton-analyse.js: kleine Zahlen bleiben im Float32 genau)
    this.spitzen = new Int32Array(faecher); // Phasen-Kopplung der Ton-Ebenen (unten)
    this.spitzenPhi = new Float64Array(faecher);
    this.drehung = new Float32Array(faecher);
    for (let k = 0; k < faecher; k++) {
      const winkel = (ZWEI_PI * k * sprung) / fenster;
      this.drehung[k] = winkel - ZWEI_PI * Math.round(winkel / ZWEI_PI);
    }
  }

  setzeEbene(e) {
    if (e.art === "ton") {
      e.phi = new Float32Array(this.leinwand.faecher); // eigene Phasen dieser Aufnahme
      e.erwartet = NaN; // wo der Lesekopf beim nächsten Fenster sein müsste (sonst: neu anfangen)
      e.vorher = 0; // die Spalte des letzten Fensters (ihr dreh gilt für den Schritt danach)
    }
    const i = this.ebenen.findIndex((x) => x.id === e.id);
    if (i >= 0) this.ebenen[i] = e;
    else this.ebenen.push(e);
    this.ordne();
  }

  ordne() {
    this.rollen = rollen(this.ebenen);
  }

  neuesFenster() {
    const { fenster, sprung, spalten, faecher } = this.leinwand;
    const { re, im, stueck, summe, hann, tabelle } = this;
    const { zufall, tempo, rueckwaerts, halten } = this.einstellung;

    // was schon fertig ist, nach vorn schieben und hinten Platz für das neue Fenster machen
    summe.copyWithin(0, sprung);
    summe.fill(0, fenster - sprung);

    // gemalte Phasen immer weiterdrehen, auch in der Pause und wenn ein Fach still ist:
    // sonst passt sie nicht mehr, wenn es wieder klingt.
    // zufall wackelt dazu: bei 0 reine Töne, bei 1 ist die Phase jedes Mal neu (Rauschen)
    for (let k = 1; k < faecher - 1; k++) {
      let phi = this.phase[k] + this.drehung[k] + zufall * Math.PI * (2 * Math.random() - 1);
      this.phase[k] = phi - ZWEI_PI * Math.floor(phi / ZWEI_PI); // klein halten, sonst wird die Zahl ungenau
    }

    if (!this.laeuft) {
      for (const { ebene } of this.rollen.toene) ebene.erwartet = NaN; // beim Weiterspielen neu ansetzen
      return;
    }

    // Spalte am Lesekopf: zwischen den beiden nächsten Spalten mischen (bei langsamem Tempo weicher)
    const p = Math.min(Math.max(this.pos, 0), spalten - 1);
    const c0 = Math.floor(p);
    const c1 = Math.min(c0 + 1, spalten - 1);
    const a = p - c0;
    const b0 = c0 * faecher;
    const b1 = c1 * faecher;
    const schritt = halten ? 0 : rueckwaerts ? -tempo : tempo;

    re.fill(0);
    im.fill(0);
    let etwas = false;

    // 1. gemalt: Beträge aller klingenden Flächen addieren
    const { flaechig, toene } = this.rollen;
    if (flaechig.length) {
      const faktoren = flaechig.map((e) => dbZuFaktor(e.gain));
      for (let k = 1; k < faecher - 1; k++) {
        let amp = 0;
        for (let j = 0; j < flaechig.length; j++) {
          const w = flaechig[j].werte;
          const wert = w[b0 + k] * (1 - a) + w[b1 + k] * a;
          if (wert > 0) amp += amplitude(tabelle, wert) * faktoren[j];
        }
        if (amp <= 0) continue;
        // Betrag fenster / 2: die inverse FFT teilt durch fenster, und Fach k und sein Spiegelbild
        // ergeben zusammen das Doppelte. So wird aus amplitude 1 ein Sinus mit Ausschlag 1.
        const betrag = amp * fenster * 0.5;
        re[k] = betrag * Math.cos(this.phase[k]);
        im[k] = betrag * Math.sin(this.phase[k]);
        etwas = true;
      }
    }

    // 2. Ton-Ebenen: jede mit eigener Phase (Phasen-Vocoder)
    for (const { ebene: e, filter: f } of toene) {
      const lokal = p - e.start; // Lesekopf in der Aufnahme
      if (lokal < 0 || lokal > e.spalten - 1) {
        e.erwartet = NaN;
        continue;
      }
      const l0 = Math.floor(lokal);
      const l1 = Math.min(l0 + 1, e.spalten - 1);
      const la = lokal - l0;
      const lb0 = l0 * faecher;
      const lb1 = l1 * faecher;
      // gesprungen (Lesekopf gezogen, Schleife, gerade hineingelaufen)? Dann bei der gespeicherten Phase anfangen
      const neuAnsetzen = !(Math.abs(lokal - e.erwartet) < 1e-3);
      const vorher = e.vorher * faecher;
      const g = dbZuFaktor(e.gain) * fenster / 3; // fenster / 4 wie beim Messen, mal 4/3 (siehe oben)
      const fg = f ? dbZuFaktor(f.gain) : 1;
      const { spitzen, spitzenPhi } = this;

      // Phasen-Kopplung (identity phase locking, Laroche und Dolson 1999):
      // Ein Ton liegt nicht in einem Fach, sondern verschmiert über 3 bis 4 (das Hann-Fenster).
      // Drehte jedes Fach seine Phase für sich weiter, liefen die Nachbarn auseinander und löschten sich
      // teilweise aus: es klingt leiser und verwaschen („phasig“), besonders rückwärts und angehalten.
      // Darum dreht nur die Spitze (das lauteste Fach eines Tons) weiter; jedes Fach daneben behält
      // seinen gemessenen Abstand zur Spitze. Bei Tempo 1 vorwärts kommt weiterhin genau die Aufnahme heraus.
      let anzahl = 0;
      const b = e.betrag;
      for (let k = 0; k < faecher; k++) {
        const m = b[lb0 + k];
        if (m > 0 && (k === 0 || m > b[lb0 + k - 1]) && (k === faecher - 1 || m >= b[lb0 + k + 1])) spitzen[anzahl++] = k;
      }
      for (let i = 0; i < anzahl; i++) {
        const k = spitzen[i];
        let phi = neuAnsetzen ? e.phase[lb0 + k] : e.phi[k] + e.dreh[vorher + k];
        phi += zufall * Math.PI * (2 * Math.random() - 1); // zufall wackelt die ganze Spitze mit ihren Nachbarn
        spitzenPhi[i] = phi;
      }

      // alle Fächer, auch 0 Hz und die halbe Abtastrate: eine Aufnahme hat dort echten Inhalt
      // (tiefer Bass streut ins Fach 0); ohne die beiden wäre sie hörbar verändert
      let j = 0; // die nächste Spitze (Spitzen und k laufen beide aufwärts)
      for (let k = 0; anzahl && k < faecher; k++) {
        while (j + 1 < anzahl && spitzen[j + 1] - k < k - spitzen[j]) j++;
        let phi = spitzenPhi[j] + e.phase[lb0 + k] - e.phase[lb0 + spitzen[j]];
        phi -= ZWEI_PI * Math.floor(phi / ZWEI_PI);
        e.phi[k] = phi;
        const betrag = b[lb0 + k] * (1 - la) + b[lb1 + k] * la;
        if (betrag <= 0) continue;
        const maske = e.maske[lb0 + k] * (1 - la) + e.maske[lb1 + k] * la;
        let m = betrag * amplitude(tabelle, maske) * g;
        if (f) m *= amplitude(tabelle, f.werte[b0 + k] * (1 - a) + f.werte[b1 + k] * a) * fg; // Kreuzsynthese
        if (m <= 0) continue;
        re[k] += m * Math.cos(phi);
        im[k] += m * Math.sin(phi);
        etwas = true;
      }
      e.vorher = l0;
      e.erwartet = lokal + schritt;
    }

    if (etwas) {
      // Spiegelbild in der oberen Hälfte (konjugiert): nur dann kommt ein reiner Ton ohne Imaginärteil heraus.
      // Fach 0 und fenster / 2 sind ihr eigenes Spiegelbild (vom Imaginärteil nimmt invers nichts mit)
      for (let k = 1; k < faecher - 1; k++) {
        re[fenster - k] = re[k];
        im[fenster - k] = -im[k];
      }
      this.fft.invers(re, im, stueck);
      // Hann-Fenster, und 0,5, weil sich 4 Hann-Fenster zu 2 addieren
      for (let n = 0; n < fenster; n++) summe[n] += stueck[n] * hann[n] * 0.5;
    }

    this.weiter(schritt);
  }

  // Lesekopf eine Spalte weiter (mal Tempo), am Ende von vorn oder anhalten
  weiter(schritt) {
    this.pos += schritt;
    const ende = this.leinwand.spalten; // pos läuft von 0 bis spalten (danach ist die letzte Spalte vorbei)
    if (this.pos >= ende || this.pos < 0) {
      if (this.einstellung.schleife) {
        this.pos = ((this.pos % ende) + ende) % ende; // auch für negative Zahlen richtig
      } else {
        this.pos = Math.min(Math.max(this.pos, 0), ende);
        this.laeuft = false;
        this.port.postMessage({ art: "ende", spalte: this.pos });
      }
    }
  }

  process(_eingaenge, ausgaenge) {
    const aus = ausgaenge[0][0];
    if (!this.leinwand) return true; // noch keine Leinwand: Stille
    const { lautstaerke } = this.einstellung;
    for (let i = 0; i < aus.length; i++) {
      if (this.gelesen >= this.leinwand.sprung) {
        this.neuesFenster();
        this.gelesen = 0;
      }
      // tanh: weich begrenzen. Viele laute Fächer zusammen ergeben weit mehr als 1;
      // statt hart abzuschneiden (Knacken) wird es oben immer flacher, bis höchstens 1
      aus[i] = Math.tanh(this.summe[this.gelesen] * lautstaerke);
      this.gelesen++;
    }
    // der Seite etwa 60-mal pro Sekunde sagen, wo der Lesekopf ist (currentTime: Sekunden im Audio-Thread)
    if (currentTime - this.letzteMeldung > 1 / 60) {
      this.letzteMeldung = currentTime;
      this.port.postMessage({ art: "position", spalte: this.pos, laeuft: this.laeuft });
    }
    return true; // weiterlaufen, auch wenn gerade nichts klingt
  }
}

registerProcessor("spektral-stimme", SpektralStimme);
