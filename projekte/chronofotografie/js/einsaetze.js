// Takt: wo im Ton etwas einsetzt (Schlag, Ton, Silbe). Dann wird ein Bild in die Chronofotografie gelegt,
// statt in festem Abstand. Wie die Einsätze im Spektrogramm, hier kurz und für sich:
//
// Spektraler Fluss (spectral flux): Der Ton wird in kurze Stücke geschnitten (1024 Samples), jedes per
// FFT in Bänder zerlegt. Für jedes Band: wie viel lauter (in dB) ist es als im Stück davor? Nur das
// Lauterwerden zählt (ein Ton, der leiser wird, ist kein Einsatz). Die Summe über alle Bänder ist der Fluss.
// Ein Einsatz ist eine Spitze im Fluss, die deutlich über ihrer Umgebung liegt (gleitender Median plus
// etwas Abstand, je nach Empfindlichkeit), und mindestens 100 ms nach dem letzten.

import { baueFft } from "/lib/fft.js";

const N = 1024;
const SPRUNG = 512;
const BAENDER = 24; // logarithmisch zwischen 60 Hz und 12 kHz
const BODEN = -80; // dB, darunter ist alles gleich still (sonst zählt Rauschen mit)

export function findeEinsaetze(puffer, empfindlichkeit = 0.5) {
  const rate = puffer.sampleRate;
  const mono = new Float32Array(puffer.length);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k);
    for (let i = 0; i < kanal.length; i++) mono[i] += kanal[i] / puffer.numberOfChannels;
  }
  const fft = baueFft(N);
  const hann = Float32Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
  const stueck = new Float32Array(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  // Grenzen der Bänder in Fächern
  const grenzen = [];
  for (let b = 0; b <= BAENDER; b++) grenzen.push(Math.max(1, Math.round((60 * (12000 / 60) ** (b / BAENDER)) / (rate / N))));

  const anzahl = Math.max(0, Math.floor((mono.length - N) / SPRUNG) + 1);
  const fluss = new Float32Array(anzahl);
  let alt = new Float32Array(BAENDER).fill(BODEN);
  for (let s = 0; s < anzahl; s++) {
    for (let n = 0; n < N; n++) stueck[n] = mono[s * SPRUNG + n] * hann[n];
    fft(stueck, re, im);
    const neu = new Float32Array(BAENDER);
    let summe = 0;
    for (let b = 0; b < BAENDER; b++) {
      let energie = 0;
      for (let k = grenzen[b]; k < Math.max(grenzen[b + 1], grenzen[b] + 1); k++) energie += re[k] * re[k] + im[k] * im[k];
      neu[b] = Math.max(10 * Math.log10(energie / N + 1e-12), BODEN);
      if (s > 0 && neu[b] > alt[b]) summe += neu[b] - alt[b];
    }
    fluss[s] = summe;
    alt = neu;
  }

  // Spitzen über dem gleitenden Median (±0,25 s) finden
  const halb = Math.round((0.25 * rate) / SPRUNG);
  const groesster = fluss.reduce((m, x) => Math.max(m, x), 0) || 1;
  const abstand = ((1 - empfindlichkeit) * 0.4 + 0.03) * groesster; // so weit über dem Median muss es sein
  const minAbstand = Math.round((0.1 * rate) / SPRUNG);
  const zeiten = [];
  let letzte = -Infinity;
  for (let s = 1; s < anzahl - 1; s++) {
    if (fluss[s] < fluss[s - 1] || fluss[s] < fluss[s + 1]) continue; // keine Spitze
    const umgebung = Array.from(fluss.subarray(Math.max(0, s - halb), Math.min(anzahl, s + halb + 1))).sort((a, b) => a - b);
    const median = umgebung[umgebung.length >> 1];
    if (fluss[s] > median + abstand && s - letzte >= minAbstand) {
      zeiten.push((s * SPRUNG + N / 2) / rate);
      letzte = s;
    }
  }
  return zeiten;
}
