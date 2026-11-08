// SSTV-Ton → Bild. Der Empfänger bekommt Samples (vom Mikrofon, aus einer Datei, aus dem nachgemachten Raum)
// in Stücken und baut das Bild Zeile für Zeile, sobald eine Zeile ganz da ist.
//
// 1. Frequenz messen (FM-Demodulation)
//    Das Signal wird mit e^(−i · 2π · 1900 Hz · t) malgenommen: alles rutscht um 1900 Hz nach unten, 1900 Hz liegt
//    bei 0, Schwarz (1500) bei −400, Weiß (2300) bei +400. Ein Tiefpass entfernt das Spiegelbild bei −3800 Hz und
//    Rauschen. Übrig ist eine komplexe Zahl z, die sich dreht, so schnell wie die Frequenz vom Mittelton abweicht.
//    Wie weit sie sich von einem Sample zum nächsten gedreht hat (Winkel von z · konj(z davor)), ist die Frequenz.
// 2. Synchronimpulse finden: 1200 Hz, etwa 5 ms lang. Kürzere sind Rauschen, längere der VIS-Kode.
// 3. Zeilen lesen: ab dem Synchronimpuls weiß man aus dem Modus, wann Grün, Blau und Rot jedes Pixels kommen.
//    Gemittelt wird über die mittleren 60 % jedes Pixels (die Ränder verschmieren mit den Nachbarn).
// 4. Einrasten: die nächste Zeile wird eine Zeilendauer später erwartet. Liegt dort ein Synchronimpuls, gilt
//    dessen Zeit. Laufen Sender und Empfänger nicht genau gleich schnell (zwei Soundkarten sind nie genau gleich),
//    zieht das die Zeilen jedes Mal gerade. Ohne Einrasten wird das Bild schräg: so sah SSTV früher oft aus.
// Frei laufen: gar nicht nach Impulsen suchen, ab dem ersten Sample Zeile für Zeile lesen. Dann wird jeder Ton
// ein Bild (Musik, Stimmen, Rauschen): Tonhöhe ist Helligkeit, Zeit ist der Weg durchs Bild.

import { MODI, FREI_VIS, freierModus, farbStarts, pdStarts, ausYcc, zeilenDauer, zeilenJeImpuls, impulse, SCHWARZ, WEISS, VORTON } from "./modi.js";

const TAPS = 48;
const laenge = (m) => (m.sync > 0.01 ? "lang" : "kurz");

export class Empfaenger {
  // modus: Name aus MODI oder ein Modus (freierModus); frei: ohne Impulse lesen (frei laufen)
  // schwarz, weiss: welche Tonhöhen Schwarz und Weiß sind (SSTV: 1500 und 2300 Hz; für Musik weiter, siehe main.js)
  constructor(rate, { modus = "m1", automatisch = true, einrasten = true, frei = false, schwarz = SCHWARZ, weiss = WEISS } = {}) {
    this.rate = rate;
    this.schwarz = schwarz;
    this.weiss = weiss;
    this.automatisch = automatisch && !frei;
    this.einrasten = einrasten && !frei;
    this.freiLaufen = frei;
    this.setzeModus(modus);
    // gemessene Frequenz jedes Samples (wächst mit)
    this.f = new Float32Array(1 << 20);
    this.n = 0;
    // Demodulation
    this.mischer = 0;
    this.schritt = (2 * Math.PI * VORTON) / rate;
    this.ringRe = new Float32Array(TAPS);
    this.ringIm = new Float32Array(TAPS);
    this.ringPos = 0;
    this.vorRe = 1;
    this.vorIm = 0;
    // Tiefpass (Fenster-Sinc, Hamming), Grenze 1500 Hz: genug für das schnellste Pixel von M2 (0,23 ms)
    const fc = 1500 / rate;
    this.taps = Float32Array.from({ length: TAPS }, (_, i) => {
      const k = i - (TAPS - 1) / 2;
      const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
      return sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (TAPS - 1)));
    });
    // Erkennung
    this.tiefLauf = 0;
    this.tiefAnfang = 0;
    // für die Erkennung geglättet (gleitender Mittelwert über 1 ms): Rauschen soll keinen Impuls zerreißen
    this.glattLaenge = Math.max(1, Math.round(0.001 * rate));
    this.glattRing = new Float32Array(this.glattLaenge).fill(VORTON);
    this.glattSumme = VORTON * this.glattLaenge;
    this.vortonAnfang = 0; // der letzte zusammenhängende Vorton (1900 Hz): von wann bis wann
    this.letzterVorton = -1;
    // Impulse nach Länge getrennt: Martin hat 4,9 ms, PD 20 ms
    this.listen = { kurz: [], lang: [] };
    this.zeiger = { kurz: 0, lang: 0 };
    this.visKandidaten = [];
    // Bild
    this.zustand = "warten"; // warten → bild → fertig
    this.zeile = 0;
    this.naechste = 0;
    this.letzteZeit = 0;
    this.neuesBild();
  }

  setzeModus(modus) {
    this.m = typeof modus === "string" ? MODI[modus] : modus;
  }
  // die Impulse, die zum Modus passen, und wie weit sie verbraucht sind
  get syncs() {
    return this.listen[laenge(this.m)];
  }
  get syncZeiger() {
    return this.zeiger[laenge(this.m)];
  }
  set syncZeiger(wert) {
    this.zeiger[laenge(this.m)] = wert;
  }
  neuesBild() {
    this.bild = new ImageData(this.m.breite, this.m.hoehe);
    for (let i = 3; i < this.bild.data.length; i += 4) this.bild.data[i] = 255;
    this.zeile = 0;
  }

  // ein Stück Samples dazu; zurück: wie viele Zeilen neu fertig sind
  fuettere(samples) {
    const { taps } = this;
    if (this.n + samples.length > this.f.length) {
      let neu = this.f.length * 2;
      while (neu < this.n + samples.length) neu *= 2;
      const g = new Float32Array(neu);
      g.set(this.f.subarray(0, this.n));
      this.f = g;
    }
    const tief = 1350; // darunter: Synchronimpuls (1200 Hz)
    const ms = this.rate / 1000;
    for (let s = 0; s < samples.length; s++) {
      // 1. mischen und tiefpassen
      const x = samples[s];
      this.mischer += this.schritt;
      if (this.mischer > 2 * Math.PI) this.mischer -= 2 * Math.PI;
      this.ringRe[this.ringPos] = x * Math.cos(this.mischer);
      this.ringIm[this.ringPos] = -x * Math.sin(this.mischer);
      this.ringPos = (this.ringPos + 1) % TAPS;
      let re = 0;
      let im = 0;
      for (let k = 0, j = this.ringPos; k < TAPS; k++, j = (j + 1) % TAPS) {
        re += this.ringRe[j] * taps[k];
        im += this.ringIm[j] * taps[k];
      }
      // Drehung seit dem letzten Sample → Frequenz
      const dre = re * this.vorRe + im * this.vorIm;
      const dim = im * this.vorRe - re * this.vorIm;
      this.vorRe = re;
      this.vorIm = im;
      const f = VORTON + (Math.atan2(dim, dre) * this.rate) / (2 * Math.PI);
      const n = this.n++;
      this.f[n] = f;
      const ring = n % this.glattLaenge;
      this.glattSumme += f - this.glattRing[ring];
      this.glattRing[ring] = f;
      const g = this.glattSumme / this.glattLaenge; // die Mitte dieses Mittels liegt 0,5 ms zurück: egal, für alle gleich

      // 2. Synchronimpulse und VIS-Anfänge erkennen
      if (g < tief) {
        if (this.tiefLauf === 0) {
          // das geglättete g hinkt f um eine halbe Glättungslänge hinterher: zurückrechnen, sonst läge jede
          // Zeile 0,5 ms (bei M2 zwei Pixel) zu weit rechts
          this.tiefAnfang = n - (this.glattLaenge >> 1);
          // nach mindestens 150 ms Vorton könnte hier das Startbit des VIS-Kodes anfangen (der Vorton darf ein paar
          // ms vorher aufgehört haben: auf dem Weg von 1900 nach 1200 Hz liegt die Frequenz kurz dazwischen)
          const vorton = this.letzterVorton - this.vortonAnfang;
          if (n - this.letzterVorton < 0.005 * this.rate && vorton > 0.15 * this.rate) this.visKandidaten.push(this.tiefAnfang);
        }
        this.tiefLauf++;
      } else {
        if (this.tiefLauf >= 2.9 * ms && this.tiefLauf <= 7.8 * ms) this.listen.kurz.push(this.tiefAnfang);
        if (this.tiefLauf >= 12 * ms && this.tiefLauf <= 29 * ms) this.listen.lang.push(this.tiefAnfang);
        this.tiefLauf = 0;
        if (Math.abs(g - VORTON) < 150) {
          if (n - this.letzterVorton > 0.003 * this.rate) this.vortonAnfang = n; // kurze Lücken zählen nicht
          this.letzterVorton = n;
        }
      }
    }
    return this.verarbeite();
  }

  mittel(a, b) {
    a = Math.max(0, Math.round(a));
    b = Math.min(this.n, Math.round(b));
    if (b <= a) return this.f[Math.max(0, Math.min(this.n - 1, a))] ?? 0;
    let s = 0;
    for (let i = a; i < b; i++) s += this.f[i];
    return s / (b - a);
  }

  // Median statt Mittelwert: bei Rauschen springt die gemessene Frequenz manchmal weit weg (der Zeiger z geht
  // nahe an 0 vorbei und dreht sich dabei fast beliebig). Ein paar solche Sprünge verschieben den Mittelwert,
  // den Median kaum
  median(a, b) {
    const stueck = this.f.slice(Math.max(0, Math.round(a)), Math.min(this.n, Math.round(b))).sort();
    return stueck.length ? stueck[stueck.length >> 1] : 0;
  }

  // VIS prüfen: Startbit, 7 Bits, Parität, Stoppbit, je 30 ms; jedes Bit muss nach 1100 oder 1300 Hz klingen
  pruefeVis(s) {
    const r = this.rate;
    const fenster = (k) => this.median(s + (k * 0.03 + 0.005) * r, s + (k * 0.03 + 0.025) * r);
    const start = fenster(0);
    const stopp = fenster(9);
    if (Math.abs(start - 1200) > 80 || Math.abs(stopp - 1200) > 80) return null;
    let kode = 0;
    let einsen = 0;
    for (let k = 1; k <= 8; k++) {
      const m = fenster(k);
      if (m < 1020 || m > 1380) return null;
      const bit = m < 1200 ? 1 : 0;
      einsen += bit;
      if (k <= 7) kode |= bit << (k - 1);
    }
    if (einsen % 2) return null; // Parität stimmt nicht
    return kode;
  }

  // Kopf des freien Modus: 48 Bits hinter dem Stoppbit (Breite, Höhe, Pixelzeit in µs)
  leseKopf(s) {
    const r = this.rate;
    const zahlen = [0, 0, 0];
    for (let k = 0; k < 48; k++) {
      const a = s + (0.3 + k * 0.03 + 0.005) * r;
      const m = this.median(a, a + 0.02 * r);
      if (m < 1020 || m > 1380) return null;
      if (m < 1200) zahlen[k >> 4] |= 1 << (k & 15);
    }
    const [breite, hoehe, mikro] = zahlen;
    if (breite < 16 || hoehe < 16 || breite > 4096 || hoehe > 4096 || mikro < 20) return null;
    return freierModus(breite, hoehe, mikro * 1e-6);
  }

  verarbeite() {
    const r = this.rate;
    let neu = 0;
    // VIS: genug Samples für den ganzen Kode (300 ms ab dem Startbit, beim freien Modus 1,47 s mehr)?
    while (this.visKandidaten.length && this.n > this.visKandidaten[0] + 0.31 * r) {
      const s = this.visKandidaten[0];
      const kode = this.pruefeVis(s);
      if (kode === FREI_VIS && this.n < s + 1.8 * r) break; // der Kopf ist noch nicht ganz da: warten
      this.visKandidaten.shift();
      if (kode === null || this.freiLaufen) continue;
      let modus = Object.values(MODI).find((m) => m.vis === kode);
      let anfang = s + 0.3 * r; // die erste Zeile fängt direkt nach dem Stoppbit an
      if (kode === FREI_VIS) {
        modus = this.leseKopf(s);
        if (!modus) continue;
        anfang += 1.47 * r;
      }
      if (!modus) continue; // ein Modus, den es hier nicht gibt
      if (this.automatisch || kode === FREI_VIS) this.setzeModus(modus);
      this.visKode = kode;
      this.neuesBild();
      this.zustand = "bild";
      this.naechste = anfang;
      // ältere Synchronimpulse zählen nicht mehr
      while (this.syncZeiger < this.syncs.length && this.syncs[this.syncZeiger] < this.naechste - 0.01 * r) this.syncZeiger++;
    }
    if (this.zustand === "warten" && this.freiLaufen) {
      this.zustand = "bild";
      this.naechste = 0;
    }
    // kein VIS gehört (mittendrin eingeschaltet, oder zu verrauscht): anfangen, sobald zwei Synchronimpulse genau
    // eine Zeile auseinander liegen. Ein einzelner könnte Rauschen sein
    // Automatisch: jeder Modus hat seine eigene Zeilendauer, also verrät der Abstand auch den Modus
    if (this.zustand === "warten") {
      const kandidaten = this.automatisch ? Object.values(MODI) : [this.m];
      for (const modus of kandidaten) {
        const art = laenge(modus);
        const anfang = this.findePaar(this.zeiger[art], zeilenDauer(modus) * r, this.listen[art]);
        if (anfang === null) continue;
        if (modus !== this.m) {
          this.setzeModus(modus);
          this.neuesBild();
        }
        this.zustand = "bild";
        this.naechste = anfang;
        break;
      }
    }
    const zeile = zeilenDauer(this.m) * r;
    while (this.zustand === "bild" && this.n > this.naechste + zeile + 0.01 * r) {
      // 4. einrasten: der Synchronimpuls, der am nächsten an der erwarteten Stelle liegt (höchstens 6 ms daneben)
      let t0 = this.naechste;
      if (this.einrasten) {
        let bester = null;
        while (this.syncZeiger < this.syncs.length && this.syncs[this.syncZeiger] < this.naechste + 0.006 * r) {
          const s = this.syncs[this.syncZeiger++];
          if (Math.abs(s - this.naechste) < 0.006 * r && (bester === null || Math.abs(s - this.naechste) < Math.abs(bester - this.naechste))) bester = s;
        }
        if (bester !== null) t0 = bester;
        // vier Zeilen ohne Synchronimpuls: vermutlich aus dem Takt (falscher Anfang, ein Aussetzer). Neu suchen:
        // ein Paar im Abstand einer Zeile, und von dort aus auf die erwartete Stelle hochrechnen
        this.verloren = bester === null ? (this.verloren ?? 0) + 1 : 0;
        if (this.verloren >= 4) {
          const paar = this.findePaar(Math.max(0, this.syncZeiger - 20), zeile);
          if (paar !== null) {
            const k = Math.round((this.naechste - paar) / zeile);
            t0 = paar + k * zeile;
            this.verloren = 0;
          }
        }
      }
      this.leseZeile(t0);
      neu++;
      this.naechste = t0 + zeile;
      if (++this.zeile >= impulse(this.m)) this.zustand = "fertig";
    }
    return neu;
  }

  // wie weit das Bild ist (Bildzeilen, bei PD zwei je Impuls)
  get fertigeZeilen() {
    return this.zeile * zeilenJeImpuls(this.m);
  }

  // zwei Synchronimpulse ab dem Zeiger, die eine Zeile auseinander liegen (auf 0,5 % genau): der erste, oder null
  findePaar(ab, zeile, liste = this.syncs) {
    for (let i = ab; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length && liste[j] - liste[i] < zeile * 1.01; j++) {
        if (Math.abs(liste[j] - liste[i] - zeile) < zeile * 0.005) return liste[i];
      }
    }
    return null;
  }

  leseZeile(t0) {
    const { m, rate: r, bild } = this;
    const px = m.scan / m.breite;
    const d = bild.data;
    const wert = (ab, x) => (255 * (this.mittel(t0 + (ab + (x + 0.2) * px) * r, t0 + (ab + (x + 0.8) * px) * r) - this.schwarz)) / (this.weiss - this.schwarz);
    if (m.art === "pd") {
      // zwei Bildzeilen: Y oben, R−Y, B−Y (für beide), Y unten
      const [yo, cr, cb, yu] = pdStarts(m);
      for (let x = 0; x < m.breite; x++) {
        const rot = wert(cr, x);
        const blau = wert(cb, x);
        for (const [zeile, ab] of [[2 * this.zeile, yo], [2 * this.zeile + 1, yu]]) {
          const farbe = ausYcc(wert(ab, x), rot, blau);
          const i = (zeile * m.breite + x) * 4;
          d[i] = farbe[0];
          d[i + 1] = farbe[1];
          d[i + 2] = farbe[2];
        }
      }
      return;
    }
    for (const { kanal, ab } of farbStarts(m)) {
      for (let x = 0; x < m.breite; x++) d[(this.zeile * m.breite + x) * 4 + kanal] = wert(ab, x);
    }
  }

  // die gerade gemessene Frequenz (für die Anzeige)
  jetzt() {
    return this.n ? this.mittel(this.n - this.rate * 0.02, this.n) : 0;
  }
}
