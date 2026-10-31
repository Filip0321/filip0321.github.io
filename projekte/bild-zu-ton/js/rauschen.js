// Ton aus dem Raster über die inverse FFT: pro Fenster ein Spektrum aus dem Bild, die Phase erfunden
// (zufällig, dann mit Griffin-Lim so lange angepasst, bis Phase und Betrag zueinander passen)
import { baueFft } from "/lib/fft.js";
import { warte } from "/lib/export.js";
import { RATE, zuAmplitude, normiere } from "./ton.js";

const N = 4096; // Fenstergröße: 85 ms, Fächer 48000 / 4096 = 11,7 Hz breit
const SPRUNG = N / 4; // 3/4 Überlappung wie im Spektrogramm: jedes Sample liegt in 4 Fenstern
const FAECHER = N / 2 + 1; // Fach 0 bis N/2; die obere Hälfte ist nur das Spiegelbild
const RAND = N; // ein Fenster Luft vorne und hinten: dort liegen weniger Fenster übereinander
const ZWEI_PI = 2 * Math.PI;
const fft = baueFft(N);

// Hann, periodisch (durch N, wie im Spektrogramm): w[n] = 0,5 − 0,5 · cos(2π n / N)
const hann = new Float32Array(N);
for (let n = 0; n < N; n++) hann[n] = 0.5 - 0.5 * Math.cos((ZWEI_PI * n) / N);

// 1. Welche Bildzeile gehört zu welchem Fach? Einmal vorausrechnen, gilt für alle Fenster
function zeilenDerFaecher(zeilen, tief, hoch) {
  const z0 = new Int32Array(FAECHER);
  const anteil = new Float32Array(FAECHER);
  const an = new Uint8Array(FAECHER); // 1 = liegt im Bild, 0 = still
  for (let k = 1; k < FAECHER; k++) { // Fach 0 (0 Hz) liegt nie im Bild: ln(0) = −Unendlich
    const f = (k * RATE) / N;
    const pos = ((zeilen - 1) * Math.log(f / tief)) / Math.log(hoch / tief); // wie in kopf.js
    if (pos < -0.5 || pos > zeilen - 0.5) continue; // unter der tiefsten oder über der höchsten Zeile
    const begrenzt = Math.min(Math.max(pos, 0), zeilen - 1);
    z0[k] = Math.floor(begrenzt);
    anteil[k] = begrenzt - z0[k];
    an[k] = 1;
  }
  return { z0, anteil, an };
}

// 2. Betrag jedes Fachs in jedem Fenster, aus dem Bild (zwischen 2 Spalten und 2 Zeilen gemischt)
function zielBetraege(amp, spalten, zeilen, dauer, fenster, { z0, anteil, an }) {
  const betrag = new Float32Array(fenster * FAECHER);
  for (let m = 0; m < fenster; m++) {
    // Mitte von Fenster m im Ton (am Anfang auch negativ: dann eben Spalte 0)
    const t = (m * SPRUNG + N / 2 - RAND) / RATE;
    const pos = Math.min(Math.max((t / dauer) * spalten - 0.5, 0), spalten - 1); // wie in erzeugeTon
    const c0 = Math.floor(pos);
    const c1 = Math.min(c0 + 1, spalten - 1);
    const cAnteil = pos - c0;
    for (let k = 0; k < FAECHER; k++) {
      if (!an[k]) continue;
      const z1 = Math.min(z0[k] + 1, zeilen - 1);
      // erst zwischen den Zeilen mischen (in beiden Spalten), dann zwischen den Spalten
      const links = amp[c0 * zeilen + z0[k]] * (1 - anteil[k]) + amp[c0 * zeilen + z1] * anteil[k];
      const rechts = amp[c1 * zeilen + z0[k]] * (1 - anteil[k]) + amp[c1 * zeilen + z1] * anteil[k];
      betrag[m * FAECHER + k] = links * (1 - cAnteil) + rechts * cAnteil;
    }
  }
  return betrag;
}

// eine Pause nach spätestens 50 ms, damit die Seite nicht einfriert
function pausenUhr(beiFortschritt) {
  let letzte = performance.now();
  return async (anteil) => {
    if (performance.now() - letzte < 50) return;
    beiFortschritt?.(anteil);
    await warte();
    letzte = performance.now();
  };
}

// Phase als Pfeil der Länge 1 (cos, sin) statt als Winkel: spart in jedem Durchgang
// Millionen Mal cos, sin und atan2 (wie beim drehenden Pfeil in erzeugeTon)
// 3. Beträge + Phasen -> Ton (inverse STFT mit Overlap-Add)
async function setzeZusammen(betrag, { pRe, pIm }, fenster, laenge, pause) {
  const puffer = new Float32Array(laenge);
  const summe = new Float32Array(laenge);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const stueck = new Float32Array(N);
  for (let m = 0; m < fenster; m++) {
    const basis = m * FAECHER;
    // Spektrum bauen: Betrag mal Pfeil -> re und im
    for (let k = 0; k < FAECHER; k++) {
      re[k] = betrag[basis + k] * pRe[basis + k];
      im[k] = betrag[basis + k] * pIm[basis + k];
    }
    im[0] = 0; // Fach 0 und N/2 sind bei einem echten Ton reell
    im[N / 2] = 0;
    // Spiegeln: die obere Hälfte ist die untere rückwärts, mit umgedrehtem im (sonst kein reeller Ton)
    for (let k = 1; k < N / 2; k++) {
      re[N - k] = re[k];
      im[N - k] = -im[k];
    }
    fft.invers(re, im, stueck);
    // noch einmal mit Hann gewichten und an seiner Stelle aufaddieren
    const anfang = m * SPRUNG;
    for (let n = 0; n < N; n++) {
      puffer[anfang + n] += hann[n] * stueck[n];
      summe[anfang + n] += hann[n] * hann[n];
    }
    await pause((m + 1) / fenster);
  }
  // durch die Summe der Fenster teilen: sonst pumpt die Lautstärke im Takt der Fenster
  for (let i = 0; i < laenge; i++) if (summe[i] > 1e-6) puffer[i] /= summe[i];
  return puffer;
}

// 4. Ton -> Phasen (die STFT, nur die Richtung jedes Fachs wird gebraucht): für Griffin-Lim
async function phasenVon(puffer, fenster, { pRe, pIm }, pause) {
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const stueck = new Float32Array(N);
  for (let m = 0; m < fenster; m++) {
    const anfang = m * SPRUNG;
    for (let n = 0; n < N; n++) stueck[n] = puffer[anfang + n] * hann[n];
    fft(stueck, re, im);
    for (let k = 0; k < FAECHER; k++) {
      // auf Länge 1 bringen: nur die Richtung zählt, der Betrag kommt wieder aus dem Bild
      const laengeK = Math.hypot(re[k], im[k]);
      const i = m * FAECHER + k;
      if (laengeK > 1e-12) {
        pRe[i] = re[k] / laengeK;
        pIm[i] = im[k] / laengeK;
      } // bei 0 (Stille) die alte Richtung behalten
    }
    await pause((m + 1) / fenster);
  }
}

// durchgaenge: wie oft Griffin-Lim die Phase nachbessert (0 = reines Zufallsrauschen)
export async function erzeugeRauschen(raster, spalten, zeilen, { dauer, tief, hoch, dynamik, durchgaenge = 0, beiFortschritt }) {
  hoch = Math.min(hoch, RATE / 2 - 1); // Nyquist, wie in erzeugeTon
  const anzahl = Math.round(dauer * RATE);
  const laenge = anzahl + 2 * RAND;
  const fenster = Math.floor((laenge - N) / SPRUNG) + 1; // so viele passen ganz in den Puffer

  const amp = new Float32Array(spalten * zeilen);
  for (let i = 0; i < amp.length; i++) amp[i] = zuAmplitude(raster[i], dynamik);
  const betrag = zielBetraege(amp, spalten, zeilen, dauer, fenster, zeilenDerFaecher(zeilen, tief, hoch));

  // Anfang: zufällige Phasen, jedes Fach in jedem Fenster anders
  const phase = { pRe: new Float32Array(fenster * FAECHER), pIm: new Float32Array(fenster * FAECHER) };
  for (let i = 0; i < phase.pRe.length; i++) {
    const winkel = Math.random() * ZWEI_PI;
    phase.pRe[i] = Math.cos(winkel);
    phase.pIm[i] = Math.sin(winkel);
  }

  // Griffin-Lim: Ton bauen, wieder zerlegen, nur die Phasen behalten, Beträge wieder aus dem Bild
  // Fortschritt: jeder Durchgang ist zwei Mal alle Fenster, dazu das letzte Zusammensetzen
  const schritte = 2 * durchgaenge + 1;
  for (let d = 0; d < durchgaenge; d++) {
    const puffer = await setzeZusammen(betrag, phase, fenster, laenge, pausenUhr((a) => beiFortschritt?.((2 * d + a) / schritte)));
    await phasenVon(puffer, fenster, phase, pausenUhr((a) => beiFortschritt?.((2 * d + 1 + a) / schritte)));
  }
  const puffer = await setzeZusammen(betrag, phase, fenster, laenge, pausenUhr((a) => beiFortschritt?.((schritte - 1 + a) / schritte)));

  const ton = puffer.slice(RAND, RAND + anzahl); // nur die Mitte: dort liegen überall 4 Fenster
  normiere(ton);
  return ton;
}
