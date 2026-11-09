// Paulstretch (Nasca Octavian Paul, 2006): einen Klang extrem dehnen, ohne dass er tiefer wird.
//
// Idee: Was man an einem Klang hört, ist vor allem, welche Frequenzen wie laut sind (das Betragsspektrum).
// Die Phasen (wo jede Schwingung gerade steht) hört man kaum, solange sich nichts schnell ändert.
//   1. Ein großes Fenster (Bruchteil einer Sekunde bis Sekunden) aus der Aufnahme nehmen, weich ausblenden
//   2. FFT: Betrag und Phase jeder Frequenz
//   3. die Phasen durch Zufall ersetzen (die Beträge bleiben): das verwischt alles Zeitliche im Fenster
//   4. zurück (inverse FFT), wieder weich ausblenden, ins Ergebnis legen (halb überlappend)
//   5. im Ergebnis um ein halbes Fenster weiter, in der Aufnahme aber nur um ein halbes Fenster / Faktor
// So entstehen aus einer Sekunde Aufnahme „Faktor“ Sekunden, mit denselben Frequenzen. Je größer das Fenster,
// desto glatter und flächiger (Anschläge verschwinden), je kleiner, desto mehr bleibt vom Rhythmus übrig.
//
// Fenster nach Paul: w(x) = (1 − x²)^1,25 für x von −1 bis 1; zweimal angewandt (vor und nach der FFT) und halb
// überlappend ergibt es annähernd gleichmäßige Lautstärke.

import { baueFft } from "/lib/fft.js";

const ffts = new Map();
function fftFuer(n) {
  if (!ffts.has(n)) ffts.set(n, baueFft(n));
  return ffts.get(n);
}

// kanaele: Float32Array je Kanal; faktor ≥ 1; fensterSek: Fenstergröße in Sekunden (wird auf eine Zweierpotenz
// gerundet); fortschritt(0 bis 1); abbrechen(): true = aufhören. Zurück: Float32Array je Kanal
export async function paulstretch(kanaele, rate, faktor, fensterSek, fortschritt = () => {}, abbrechen = () => false) {
  const N = 2 ** Math.round(Math.log2(Math.min(2 ** 17, Math.max(2 ** 10, fensterSek * rate))));
  const halb = N / 2;
  const fft = fftFuer(N);
  const fenster = new Float32Array(N);
  for (let i = 0; i < N; i++) fenster[i] = Math.pow(Math.max(0, 1 - ((2 * i) / N - 1) ** 2), 1.25);
  const laenge = kanaele[0].length;
  const rahmen = Math.ceil((laenge * faktor) / halb) + 1;
  const aus = kanaele.map(() => new Float32Array(rahmen * halb + N));
  const stueck = new Float32Array(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const zurueck = new Float32Array(N);
  let zuletzt = performance.now();
  for (let k = 0; k < rahmen; k++) {
    const start = Math.floor((k * halb) / faktor);
    for (let c = 0; c < kanaele.length; c++) {
      const ein = kanaele[c];
      for (let i = 0; i < N; i++) stueck[i] = (ein[start + i] ?? 0) * fenster[i];
      fft(stueck, re, im);
      // Beträge behalten, Phasen auslosen (jeder Kanal eigene: das macht das Ergebnis breit im Stereo)
      for (let f = 1; f < halb; f++) {
        const betrag = Math.hypot(re[f], im[f]);
        const phase = Math.random() * 2 * Math.PI;
        re[f] = betrag * Math.cos(phase);
        im[f] = betrag * Math.sin(phase);
        re[N - f] = re[f]; // obere Hälfte gespiegelt, damit das Ergebnis reell ist
        im[N - f] = -im[f];
      }
      re[0] = im[0] = im[halb] = 0; // kein Gleichanteil
      fft.invers(re, im, zurueck);
      const ziel = aus[c];
      const o = k * halb;
      for (let i = 0; i < N; i++) ziel[o + i] += zurueck[i] * fenster[i];
    }
    // dem Browser ab und zu Luft lassen (sonst friert die Seite ein) und Fortschritt melden
    if (performance.now() - zuletzt > 40) {
      fortschritt(k / rahmen);
      await new Promise((ok) => setTimeout(ok, 0));
      if (abbrechen()) return null;
      zuletzt = performance.now();
    }
  }
  // auf 0,9 normieren
  let spitze = 0;
  for (const a of aus) for (const x of a) spitze = Math.max(spitze, Math.abs(x));
  if (spitze > 0) for (const a of aus) for (let i = 0; i < a.length; i++) a[i] *= 0.9 / spitze;
  fortschritt(1);
  return aus;
}
