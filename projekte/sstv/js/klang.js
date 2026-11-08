// Ton in Ton: statt eines Bildes geht ein Klang durch den Raum. Zwei Arten:
//   direkt    der Klang selbst geht durch den Raum (Alvin Lucier wörtlich: Runde für Runde bleibt vom Klang nur,
//             was der Raum mag, seine Eigenfrequenzen)
//   verpackt  der Klang wird auf einen Träger moduliert (FM, wie UKW-Radio), geht so durch den Raum und wird
//             wieder ausgepackt. Der Raum stört dann nicht den Klang, sondern das Paket: Hall und Echo geben
//             Verzerrung und Pfeifen, Rauschen gibt Knacken (die FM-Schwelle), ein anderer Takt verschiebt die Mitte
//
// FM (Frequenzmodulation): der Träger schwingt bei traeger Hz, der Klang schiebt ihn hin und her:
//   Frequenz jetzt = traeger + hub · Klang jetzt (Klang zwischen −1 und 1)
// Die Phase ist die aufsummierte Frequenz: φ += 2π · f / rate, das Signal ist sin(φ).
// Auspacken wie beim SSTV-Empfang (empfang.js): mit e^(−i · 2π · traeger · t) mischen, tiefpassen, und der Winkel
// zwischen zwei Samples ist die Abweichung vom Träger, geteilt durch hub ist das der Klang.
// Wie breit das Paket ist (Carson-Regel): etwa 2 · (hub + höchste Frequenz im Klang). Bei 4000 Hz Träger, 1200 Hz
// Hub und 2000 Hz Klang also 800 bis 7200 Hz: das passt durch den nachgerechneten Raum (300 bis 8000 Hz).

import { baueFft } from "/lib/fft.js";

// ---------- Hilfen ----------

// Tiefpass (zwei Biquads, 4. Ordnung) über den OfflineAudioContext; hoch: Hochpass dazu (z. B. gegen Gleichanteil)
export async function filtere(ton, rate, { tief = 0, hoch = 0 } = {}) {
  const ctx = new OfflineAudioContext(1, ton.length, rate);
  const puffer = new AudioBuffer({ length: ton.length, numberOfChannels: 1, sampleRate: rate });
  puffer.copyToChannel(ton, 0);
  let knoten = new AudioBufferSourceNode(ctx, { buffer: puffer });
  const quelle = knoten;
  for (const [art, f] of [["lowpass", tief], ["lowpass", tief], ["highpass", hoch]]) {
    if (!f) continue;
    const filter = new BiquadFilterNode(ctx, { type: art, frequency: f, Q: 0.707 });
    knoten.connect(filter);
    knoten = filter;
  }
  knoten.connect(ctx.destination);
  quelle.start();
  return (await ctx.startRendering()).getChannelData(0);
}

// auf eine Spitze bringen (0,5 wie beim SSTV-Senden)
export function normiere(ton, spitze = 0.5) {
  let max = 0;
  for (const v of ton) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < ton.length; i++) ton[i] *= spitze / max;
  return ton;
}

// eine Tondatei als Mono mit rate Samples pro Sekunde (der Browser rechnet beim Dekodieren um)
export async function ladeTon(datei, rate) {
  const puffer = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await datei.arrayBuffer());
  const ton = new Float32Array(puffer.length);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k);
    for (let i = 0; i < ton.length; i++) ton[i] += kanal[i] / puffer.numberOfChannels;
  }
  return ton;
}

// Testklang, solange keiner geladen ist: ein gezupftes Arpeggio mit Obertönen (in jeder Runde hört man,
// welche Teiltöne der Raum schluckt und welche er verstärkt)
export function testklang(rate) {
  const noten = [220, 277.18, 329.63, 440, 329.63, 277.18, 220, 164.81];
  const proNote = 0.5;
  const ton = new Float32Array(Math.round(noten.length * proNote * rate + rate));
  noten.forEach((f, n) => {
    const start = Math.round(n * proNote * rate);
    for (let i = 0; i < rate * 1.5 && start + i < ton.length; i++) {
      const t = i / rate;
      let v = 0;
      for (let k = 1; k <= 8; k++) v += Math.sin(2 * Math.PI * f * k * t) * Math.exp(-t * (1.5 + k)) / k;
      ton[start + i] += v * 0.3;
    }
  });
  return normiere(ton);
}

// ---------- FM ----------

export function fmPacken(klang, rate, { traeger, hub }) {
  const aus = new Float32Array(klang.length);
  let phase = 0;
  for (let i = 0; i < klang.length; i++) {
    const f = traeger + hub * Math.max(-1, Math.min(1, klang[i]));
    phase += (2 * Math.PI * f) / rate;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    aus[i] = 0.5 * Math.sin(phase);
  }
  return aus;
}

// band: wie hoch der Klang reicht (Hz); der Tiefpass auf dem gemischten Signal lässt hub + band durch
export async function fmAuspacken(signal, rate, { traeger, hub, band }) {
  const TAPS = 96;
  const fc = Math.min(0.45, (hub + band) / rate);
  const taps = Float32Array.from({ length: TAPS }, (_, i) => {
    const k = i - (TAPS - 1) / 2;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    return sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (TAPS - 1)));
  });
  // mischen: Träger auf 0 Hz
  const n = signal.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const schritt = (2 * Math.PI * traeger) / rate;
  for (let i = 0; i < n; i++) {
    const w = schritt * i;
    re[i] = signal[i] * Math.cos(w);
    im[i] = -signal[i] * Math.sin(w);
  }
  // tiefpassen und den Winkel von z · konj(z davor) messen
  const aus = new Float32Array(n);
  const staerke = new Float32Array(n); // |z|: wie stark der Träger gerade ist
  let vorRe = 1;
  let vorIm = 0;
  const zuKlang = rate / (2 * Math.PI * hub);
  for (let i = 0; i < n; i++) {
    let zr = 0;
    let zi = 0;
    for (let k = 0; k < TAPS; k++) {
      const j = i - k;
      if (j < 0) break;
      zr += re[j] * taps[k];
      zi += im[j] * taps[k];
    }
    const dre = zr * vorRe + zi * vorIm;
    const dim = zi * vorRe - zr * vorIm;
    // Begrenzen: ohne Signal (Stille, Knacken) springt der Winkel wild, das würde laut
    aus[i] = Math.max(-1.5, Math.min(1.5, Math.atan2(dim, dre) * zuKlang));
    staerke[i] = Math.hypot(zr, zi);
    vorRe = zr;
    vorIm = zi;
  }
  // Rauschsperre (Squelch, wie am Funkgerät): wo der Träger fehlt (vor dem Anfang, nach dem Ende), misst der
  // Winkel nur Rauschen, und das wäre der lauteste Teil. Dort leise, mit weichen Kanten (10 ms gemittelt)
  const laenge = Math.round(0.01 * rate);
  let mittel = 0;
  for (const v of staerke) mittel += v / n;
  let summe = 0;
  for (let i = 0; i < n + laenge; i++) {
    if (i < n) summe += staerke[i];
    if (i >= laenge) summe -= staerke[i - laenge];
    const mitte = i - (laenge >> 1);
    if (mitte < 0 || mitte >= n) continue;
    const offen = Math.max(0, Math.min(1, (summe / laenge / mittel - 0.25) / 0.25));
    aus[mitte] *= offen;
  }
  // was über band liegt, ist Rauschen aus dem Auspacken; Gleichanteil (Träger etwas daneben) raus
  return filtere(aus, rate, { tief: band, hoch: 20 });
}

// ---------- Spektrogramm als Bild (für Stufen und Anzeige) ----------
// Zeit nach rechts, Frequenz nach oben (logarithmisch von 40 Hz bis 12 kHz, wie man hört), Lautstärke in dB
const N = 1024;
const fftKlein = baueFft(N);
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

export function spektrogramm(ton, rate, { breite = 480, hoehe = 200, markeBei = -1 } = {}) {
  const bild = new ImageData(breite, hoehe);
  const stueck = new Float32Array(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const db = new Float32Array(N / 2);
  // welches Fach zu welcher Bildzeile gehört
  const fach = Int32Array.from({ length: hoehe }, (_, y) => {
    const f = 40 * Math.pow(12000 / 40, 1 - y / (hoehe - 1));
    return Math.min(N / 2 - 1, Math.round((f * N) / rate));
  });
  for (let x = 0; x < breite; x++) {
    const mitte = Math.round(((x + 0.5) / breite) * ton.length);
    for (let i = 0; i < N; i++) {
      const j = mitte - N / 2 + i;
      stueck[i] = j >= 0 && j < ton.length ? ton[j] * hann[i] : 0;
    }
    fftKlein(stueck, re, im);
    // so bezogen, dass ein voller Sinus (Amplitude 1) 0 dB hat: das Hann-Fenster gibt ihm im Spektrum N / 4
    for (let k = 0; k < N / 2; k++) db[k] = 10 * Math.log10((re[k] * re[k] + im[k] * im[k]) / ((N / 4) * (N / 4)) + 1e-12);
    for (let y = 0; y < hoehe; y++) {
      // −90 dB schwarz, −6 dB (Spitze 0,5) weiß; dazwischen über Violett und Bernstein
      const w = Math.max(0, Math.min(1, (db[fach[y]] + 90) / 84));
      const p = (y * breite + x) * 4;
      bild.data[p] = 255 * w ** 0.8;
      bild.data[p + 1] = 255 * w ** 1.6;
      bild.data[p + 2] = 255 * (0.8 * w ** 3 + 0.5 * w * (1 - w));
      bild.data[p + 3] = 255;
    }
  }
  if (markeBei >= 0) {
    const x = Math.round(markeBei * (breite - 1));
    for (let y = 0; y < hoehe; y++) bild.data.set([255, 60, 60, 255], (y * breite + x) * 4);
  }
  return bild;
}
