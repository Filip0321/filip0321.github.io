// Ton aus dem Raster: additive Synthese, pro Zeile ein Sinus, Lautstärke = Helligkeit
// (von bild-zu-ton, jetzt auch für den Ton der Attraktoren)

import { warte } from "/lib/export.js";

export const RATE = 48000;
const ZWEI_PI = 2 * Math.PI;
const ANSCHLAG_ZEIT = 0.004; // Sekunden bis zur vollen Lautstärke (sofort wäre ein Knacken)
const ABKLINGEN = 5; // angeschlagen: am Ende einer Spalte ist der Ton auf e^−5 ≈ 0,7 % abgeklungen

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

// anschlag: false = jede Spalte klingt gleichmäßig und geht weich in die nächste über,
// true = jede Spalte wird angeschlagen und klingt ab wie eine Saite. Nur so klingt der Ton rückwärts
// anders als vorwärts: gleichmäßige Sinusse sind rückwärts wieder dieselben Sinusse, ein Anschlag
// rückwärts wird zu einem Anschwellen, das plötzlich abreißt (wie bei rückwärts abgespielten Aufnahmen).
// faktor: alle Frequenzen mal faktor (1,5 = eine Quinte höher, 2 = eine Oktave; für die Farb-Stimmen in Bild zu
// Ton), Zeilen über der Nyquist-Frequenz bleiben dann still. normieren: false, wenn mehrere Stimmen erst
// zusammengezählt und dann gemeinsam auf 0,9 gebracht werden (sonst wäre jede Stimme gleich laut)
export async function erzeugeTon(raster, spalten, zeilen, { dauer, tief, hoch, dynamik, anschlag = false, faktor = 1, normieren = true, beiFortschritt }) {
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
  const huellen = anschlag ? new Float32Array(anzahl) : null; // Lautstärke-Verlauf in jeder Spalte (nur angeschlagen)

  for (let n = 0; n < anzahl; n++) {
    const pos = n / samplesProSpalte - 0.5;
    c0[n] = Math.floor(pos);
    anteil[n] = pos - c0[n]; // 0 = genau bei c0, 1 = genau bei c1
    if (c0[n] < 0) {
      c0[n] = 0; 
      anteil[n] = 0;
    }
    c1[n] = Math.min(c0[n] + 1, spalten - 1); // nach der letzten Spaltenmitte: die letzte Spalte

    if (anschlag) {
      // angeschlagen: keine Überblendung zwischen Spalten, jede Spalte für sich ab ihrem Anfang.
      // c0 = c1 = die Spalte, in der n liegt, und anteil = 0: dann ergibt die Mischung unten genau amp[c0],
      // und huellen[n] formt daraus Anschlag und Abklingen
      const spalte = Math.min(Math.floor(n / samplesProSpalte), spalten - 1);
      const inSpalte = n / samplesProSpalte - spalte; // 0 am Anfang der Spalte bis 1 am Ende
      const huelle = Math.min(1, (inSpalte * samplesProSpalte) / (ANSCHLAG_ZEIT * RATE)) * Math.exp(-inSpalte * ABKLINGEN);
      c0[n] = spalte;
      c1[n] = spalte;
      anteil[n] = 0;
      huellen[n] = huelle;
    }
  }

  for (let zeile = 0; zeile < zeilen; zeile++) {
    let still = true;
    for (let c = 0; c < spalten; c++) {
      if (amp[c * zeilen + zeile] > 0) {
        still = false;
        break;
      }
    }

    const f = zeileZuFrequenz(zeile, zeilen, tief, hoch) * faktor;
    if (f >= RATE / 2) still = true;
    if (!still) {
      const schritt = (ZWEI_PI * f) / RATE; 
      // statt Math.sin: ein Pfeil (re, im) auf dem Einheitskreis, der sich pro Sample um "schritt" weiterdreht
      // im ist dann genau sin(phase); gedreht wird wie beim Schmetterling in der FFT
      const c = Math.cos(schritt); // nur einmal pro Zeile ausrechnen
      const s = Math.sin(schritt);
      const start = Math.random() * ZWEI_PI; // zufällig, sonst sind am Anfang alle Sinusse gleichzeitig oben
      let re = Math.cos(start);
      let im = Math.sin(start);

      for (let n = 0; n < anzahl; n++) {
        let a = amp[c0[n] * zeilen + zeile] * (1 - anteil[n]) + amp[c1[n] * zeilen + zeile] * anteil[n];
        if (huellen) a *= huellen[n];
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

  if (normieren) normiere(ton);
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

// für zuWav und den Player: Float32Array -> AudioBuffer (1 Kanal); ein Array aus Float32Arrays gibt Stereo
// (oder mehr Kanäle, einer pro Eintrag)
export function alsAudioBuffer(ton) {
  const kanaele = Array.isArray(ton) ? ton : [ton];
  const puffer = new AudioBuffer({ length: kanaele[0].length, numberOfChannels: kanaele.length, sampleRate: RATE });
  kanaele.forEach((k, i) => puffer.copyToChannel(k, i)); // die Samples in ihre Kanäle kopieren
  return puffer;
}

// rückwärts: dieselben Samples in umgekehrter Reihenfolge, in einem neuen Puffer (der alte bleibt vorwärts)
export function rueckwaerts(puffer) {
  const umgedreht = new AudioBuffer({ length: puffer.length, numberOfChannels: puffer.numberOfChannels, sampleRate: puffer.sampleRate });
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const samples = puffer.getChannelData(k).slice(); // Kopie: reverse() dreht sonst den Originalpuffer mit um
    samples.reverse();
    umgedreht.copyToChannel(samples, k);
  }
  return umgedreht;
}

// alle Kanäle gemittelt (zum Messen, z. B. „Ton zurück ins Bild“ bei Stereo)
export function mono(puffer) {
  if (puffer.numberOfChannels === 1) return puffer.getChannelData(0);
  const aus = new Float32Array(puffer.length);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k);
    for (let i = 0; i < aus.length; i++) aus[i] += kanal[i] / puffer.numberOfChannels;
  }
  return aus;
}

