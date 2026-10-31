// Ton aus dem Raster: additive Synthese, pro Zeile ein Sinus, Lautstärke = Helligkeit

import { warte } from "/lib/export.js";

export const RATE = 48000;
const ZWEI_PI = 2 * Math.PI;

// Zeile (0 = unten)
// Frequenz in Hz, logarithmisch zwischen tief und hoch
export function zeileZuFrequenz(zeile, zeilen, tief, hoch) {
  return tief * (hoch / tief) ** (zeile / (zeilen - 1));
}

// Helligkeit -> Lautstärke über dB (auch rauschen.js benutzt das, damit beide gleich laut empfinden)
export function zuAmplitude(luminanz, dynamik) {
  if (!luminanz) return 0; // Schwarz: echte Stille statt nur sehr leise
  const db = (luminanz - 1) * dynamik;
  return 10 ** (db / 20);
}

export async function erzeugeTon(raster, spalten, zeilen, { dauer, tief, hoch, dynamik, beiFortschritt }) {
  const anzahl = Math.round(dauer * RATE);
  const ton = new Float32Array(anzahl); // startet mit 0
  const samplesProSpalte = anzahl / spalten;
  hoch = Math.min(hoch, RATE / 2 - 1); // Nyquist: darüber würde es falsch zurückgespiegelt

  // Amplituden einmal vorausrechnen, nicht in der inneren Schleife
  const amp = new Float32Array(spalten * zeilen);
  for (let i = 0; i < amp.length; i++) amp[i] = zuAmplitude(raster[i], dynamik);

  let letztePause = performance.now();

  const c0 = new Int32Array(anzahl);
  const anteil = new Float32Array(anzahl);
  const c1 = new Int32Array(anzahl);

  for (let n = 0; n < anzahl; n++) {
    const pos = n / samplesProSpalte - 0.5;
    c0[n] = Math.floor(pos);
    anteil[n] = pos - c0[n]; // 0 = genau bei c0, 1 = genau bei c1
    if (c0[n] < 0) {
      c0[n] = 0; 
      anteil[n] = 0;
    }
    c1[n] = Math.min(c0[n] + 1, spalten - 1); // nach der letzten Spaltenmitte: die letzte Spalte
    
  }

  for (let zeile = 0; zeile < zeilen; zeile++) {
    let still = true;
    for (let c = 0; c < spalten; c++) {
      if (amp[c * zeilen + zeile] > 0) {
        still = false;
        break;
      }
    }

    if (!still) {
      const f = zeileZuFrequenz(zeile, zeilen, tief, hoch);
      const schritt = (ZWEI_PI * f) / RATE; 
      // statt Math.sin: ein Pfeil (re, im) auf dem Einheitskreis, der sich pro Sample um "schritt" weiterdreht
      // im ist dann genau sin(phase); gedreht wird wie beim Schmetterling in der FFT
      const c = Math.cos(schritt); // nur einmal pro Zeile ausrechnen
      const s = Math.sin(schritt);
      const start = Math.random() * ZWEI_PI; // zufällig, sonst sind am Anfang alle Sinusse gleichzeitig oben
      let re = Math.cos(start);
      let im = Math.sin(start);

      for (let n = 0; n < anzahl; n++) {
        const a = amp[c0[n] * zeilen + zeile] * (1 - anteil[n]) + amp[c1[n] * zeilen + zeile] * anteil[n];
        ton[n] += a * im;
        // drehen: (re + i·im) · (c + i·s); erst das neue re merken, weil im noch das alte re braucht
        const neuRe = re * c - im * s;
        im = re * s + im * c;
        re = neuRe;
        // Rundungsfehler machen den Pfeil langsam länger oder kürzer: alle 4096 Samples zurück auf Länge 1
        if ((n & 4095) === 0) {
          const laenge = Math.sqrt(re * re + im * im);
          re /= laenge;
          im /= laenge;
        }
      }
    }

    if (performance.now() - letztePause > 50) {
      beiFortschritt?.((zeile + 1) / zeilen); // ?. : nur aufrufen, wenn es übergeben wurde
      await warte();
      letztePause = performance.now();
    }
  }

  normiere(ton);
  return ton;
}

// normieren: 128 Sinusse zusammen sind viel lauter als 1, also auf höchstens 0,9 bringen
// (ändert ton direkt; auch für rauschen.js)
export function normiere(ton) {
  let max = 0;
  for (let n = 0; n < ton.length; n++) {
    const betrag = Math.abs(ton[n]);
    if (betrag > max) max = betrag;
  }
  if (max > 0) {
    // bei max = 0 (ganz schwarzes Bild) nichts tun, sonst durch 0
    const faktor = 0.9 / max;
    for (let n = 0; n < ton.length; n++) ton[n] *= faktor;
  }
}

// für zuWav und den Player: Float32Array -> AudioBuffer (1 Kanal)
export function alsAudioBuffer(ton) {
  const puffer = new AudioBuffer({ length: ton.length, numberOfChannels: 1, sampleRate: RATE });
  puffer.copyToChannel(ton, 0); // die Samples in Kanal 0 kopieren
  return puffer;
}

// rückwärts: dieselben Samples in umgekehrter Reihenfolge, in einem neuen Puffer (der alte bleibt vorwärts)
export function rueckwaerts(puffer) {
  const umgedreht = new AudioBuffer({ length: puffer.length, numberOfChannels: 1, sampleRate: puffer.sampleRate });
  const samples = puffer.getChannelData(0).slice(); // Kopie: reverse() dreht sonst den Originalpuffer mit um
  samples.reverse();
  umgedreht.copyToChannel(samples, 0);
  return umgedreht;
}
