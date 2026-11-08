// Hellschreiber (Rudolf Hell, 1929; „Feld-Hell“ im Zweiten Weltkrieg, heute noch im Amateurfunk): Text wird nicht
// als Buchstaben-Kode gesendet, sondern als Bild. Jeder Buchstabe ist ein kleines Raster, Spalte für Spalte von
// unten nach oben abgetastet: schwarzes Kästchen = Ton an, weißes = Ton aus. Der Empfänger schreibt die Spalten
// wieder nebeneinander auf ein Papierband. Er muss nichts verstehen: was ankommt, wird gedruckt, Störungen auch.
// Darum bleibt Hell lesbar, wo andere Verfahren nur noch Fehler liefern: das Auge liest durch den Dreck.
//
// Zeiten wie Feld-Hell: 14 Kästchen pro Spalte, 245 Kästchen pro Sekunde (eine Spalte 57 ms, ein Buchstabe
// etwa 7 Spalten, also 2,5 Buchstaben pro Sekunde), Ton bei 980 Hz.
// Doppelt drucken: jede Spalte steht zweimal übereinander. Laufen Sender und Empfänger nicht gleich schnell,
// rutscht die Schrift schräg nach oben oder unten, aber eine der beiden Kopien ist immer ganz zu sehen.
//
// Band: { spalten, werte } mit werte[spalte · 14 + reihe] zwischen 0 (Papier) und 1 (Tinte), reihe 0 unten

export const HOEHE = 14;
export const ZEILE = 160; // Spalten pro Zeile auf der Seite (das Band wird umgebrochen)
const ZEILE_HOCH = 2 * HOEHE + 6; // zwei Kopien und etwas Abstand
const PAPIER = [242, 234, 216];
const TINTE = [24, 22, 30];

// ---------- Senden ----------

// Text als Band: in eine 14 Pixel hohe Leinwand schreiben und Pixel für Pixel abtasten
export function textZuBand(text) {
  const zeilen = text.replace(/\r/g, "").split("\n");
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const schrift = "bold 12px monospace";
  ctx.font = schrift;
  const breiten = zeilen.map((z) => Math.ceil(ctx.measureText(z).width));
  // Zeilenumbruch im Text: eine Lücke von 14 Spalten
  c.width = Math.max(1, breiten.reduce((s, b) => s + b + HOEHE, 0) + 12);
  c.height = HOEHE;
  ctx.font = schrift;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  let x = 6;
  zeilen.forEach((z, i) => {
    ctx.fillText(z, x, 11);
    x += breiten[i] + HOEHE;
  });
  const pixel = ctx.getImageData(0, 0, c.width, HOEHE).data;
  const werte = new Float32Array(c.width * HOEHE);
  for (let s = 0; s < c.width; s++) {
    for (let r = 0; r < HOEHE; r++) {
      const y = HOEHE - 1 - r;
      werte[s * HOEHE + r] = pixel[(y * c.width + s) * 4 + 3] > 110 ? 1 : 0; // scharf wie ein Raster
    }
  }
  return { spalten: c.width, werte };
}

// Band → Ton. Grauwerte werden zu leiserem Ton (beim neu Senden eines empfangenen Bandes zählt jeder Dreck mit).
// Die Kanten werden weich (1,5 ms): harte Ein-Aus-Sprünge klicken und machen das Signal breit.
export function sendeBand(band, rate, { traeger = 980, tempo = 245 } = {}) {
  const proKaestchen = rate / tempo;
  const n = Math.ceil(band.werte.length * proKaestchen + rate * 0.3);
  const huelle = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / proKaestchen);
    huelle[i] = k < band.werte.length ? band.werte[k] : 0;
  }
  const weich = glaette(glaette(huelle, Math.round(0.0015 * rate)), Math.round(0.0015 * rate));
  const aus = new Float32Array(n);
  const schritt = (2 * Math.PI * traeger) / rate;
  for (let i = 0; i < n; i++) aus[i] = 0.5 * weich[i] * Math.sin(schritt * i);
  return aus;
}

function glaette(x, laenge) {
  const aus = new Float32Array(x.length);
  let summe = 0;
  for (let i = 0; i < x.length; i++) {
    summe += x[i] - (i >= laenge ? x[i - laenge] : 0);
    aus[i] = summe / laenge;
  }
  return aus;
}

// ---------- Seite zeichnen ----------

export function bandZuBild(werte, spalten) {
  const zeilen = Math.max(1, Math.ceil(spalten / ZEILE));
  const bild = new ImageData(ZEILE, zeilen * ZEILE_HOCH);
  for (let i = 0; i < bild.data.length; i += 4) bild.data.set([...PAPIER, 255], i);
  for (let s = 0; s < spalten; s++) zeichneSpalte(bild, werte, s);
  return bild;
}

function zeichneSpalte(bild, werte, s) {
  const x = s % ZEILE;
  const oben = Math.floor(s / ZEILE) * ZEILE_HOCH;
  for (let r = 0; r < HOEHE; r++) {
    const v = Math.max(0, Math.min(1, werte[s * HOEHE + r]));
    const farbe = PAPIER.map((p, k) => p + (TINTE[k] - p) * v);
    for (const kopie of [0, HOEHE]) bild.data.set([...farbe, 255], ((oben + kopie + HOEHE - 1 - r) * ZEILE + x) * 4);
  }
}

// ---------- Empfangen ----------
// Wie ein Hell-Schreiber: Ton bei traeger heraushören (mischen und tiefpassen wie beim SSTV-Empfang, hier nur
// die Stärke, nicht die Frequenz), mit der eigenen Uhr in Kästchen teilen und drucken. Keine Synchronisation:
// das ist der Witz. Die Lautstärke regelt sich selbst (schnell hoch, langsam runter), damit leise Aufnahmen
// genauso schwarz drucken.
export class HellEmpfaenger {
  constructor(rate, { traeger = 980, tempo = 245 } = {}) {
    this.rate = rate;
    this.schritt = (2 * Math.PI * traeger) / rate;
    this.phase = 0;
    this.proKaestchen = rate / tempo;
    this.grenze = this.proKaestchen;
    this.zaehler = 0;
    this.summe = 0;
    this.anzahl = 0;
    this.pegel = 1e-4;
    this.abfall = Math.exp(Math.log(0.5) / (2 * rate)); // halbiert sich in 2 s
    // Tiefpass für I und Q: zwei Biquads (Butterworth) bei 300 Hz, genug für 245 Kästchen pro Sekunde
    const w = (2 * Math.PI * 300) / rate;
    const a = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + a;
    this.k = { b0: (1 - Math.cos(w)) / 2 / a0, b1: (1 - Math.cos(w)) / a0, b2: (1 - Math.cos(w)) / 2 / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - a) / a0 };
    this.filter = Array.from({ length: 4 }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
    this.werte = new Float32Array(HOEHE * 4096);
    this.spalten = 0;
    this.kaestchen = 0; // in der laufenden Spalte
    this.bild = bandZuBild(this.werte, 1);
    this.m = { name: "Hellschreiber", breite: ZEILE, hoehe: this.bild.height };
    this.zustand = "bild";
    this.letzterPegel = 0;
  }

  biquad(f, x) {
    const { b0, b1, b2, a1, a2 } = this.k;
    const y = b0 * x + b1 * f.x1 + b2 * f.x2 - a1 * f.y1 - a2 * f.y2;
    f.x2 = f.x1;
    f.x1 = x;
    f.y2 = f.y1;
    f.y1 = y;
    return y;
  }

  fuettere(samples) {
    const [i1, i2, q1, q2] = this.filter;
    for (let s = 0; s < samples.length; s++) {
      this.phase += this.schritt;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      const x = samples[s];
      const re = this.biquad(i2, this.biquad(i1, x * Math.cos(this.phase)));
      const im = this.biquad(q2, this.biquad(q1, -x * Math.sin(this.phase)));
      const staerke = 2 * Math.hypot(re, im);
      this.pegel = Math.max(staerke, this.pegel * this.abfall, 1e-4);
      this.summe += staerke / this.pegel;
      this.anzahl++;
      this.zaehler++;
      if (this.zaehler >= this.grenze) {
        this.grenze += this.proKaestchen;
        this.schreibe(this.summe / this.anzahl);
        this.summe = 0;
        this.anzahl = 0;
      }
    }
    this.letzterPegel = this.pegel;
  }

  schreibe(v) {
    // etwas Kontrast: der Grund (Rauschen, Hall) wird heller, das Volle bleibt schwarz
    const wert = Math.max(0, Math.min(1, (v - 0.2) / 0.6));
    const s = this.spalten;
    if ((s + 1) * HOEHE > this.werte.length) {
      const g = new Float32Array(this.werte.length * 2);
      g.set(this.werte);
      this.werte = g;
    }
    this.werte[s * HOEHE + this.kaestchen] = wert;
    if (++this.kaestchen === HOEHE) {
      this.kaestchen = 0;
      this.spalten++;
      if (Math.ceil(this.spalten / ZEILE) * ZEILE_HOCH > this.bild.height) {
        this.bild = bandZuBild(this.werte, this.spalten); // eine Zeile mehr
        this.m = { name: "Hellschreiber", breite: ZEILE, hoehe: this.bild.height };
      } else zeichneSpalte(this.bild, this.werte, s);
    }
  }

  get band() {
    return { spalten: this.spalten, werte: this.werte.slice(0, this.spalten * HOEHE) };
  }
  statusText() {
    return `Hellschreiber · ${this.spalten} Spalten · etwa ${Math.round(this.spalten / 7)} Zeichen`;
  }
}
