// Einsätze und Tempo einer ganzen Tondatei, vorab gerechnet (nicht live): dann weiß man jeden Schlag schon,
// bevor er kommt, und ein Video aus der Datei sitzt auf den Millisekunden genau auf der Musik.
//
// 1. Spektraler Fluss: die Datei in kurze Stücke (1024 Samples, alle 512 eins), pro Stück das Spektrum. Wie viel
//    ist in jedem Fach lauter geworden als im Stück davor? (Nur lauter zählt: ein Einsatz ist etwas Neues, ein
//    Ausklingen nicht.) Auf einer Log-Skala (log(1 + 100 · Betrag)), sonst bestimmt nur der Bass.
// 2. Einsätze: Spitzen im Fluss, die deutlich über ihrer Umgebung (0,2 s rundherum) liegen, mindestens 90 ms
//    auseinander.
// 3. Tempo: der Fluss mit sich selbst verschoben verglichen (Autokorrelation). Bei der Verschiebung um einen
//    Schlag passt er am besten auf sich. Gesucht zwischen 60 und 200 BPM, mit einer leichten Vorliebe für die Mitte
//    um 120 (sonst gewinnt oft das halbe oder doppelte Tempo, das passt ja auch). Wechseln sich laute und leise
//    Schläge ab (Bassdrum, Hi-Hat), passt die Verschiebung um zwei Schläge besser als um einen: unter 90 BPM wird
//    darum das doppelte Tempo genommen, wenn es auch noch passt (mehr als ein Viertel so gut).
// 4. Schläge: das Raster mit diesem Abstand so verschieben, dass möglichst viel Fluss auf den Strichen liegt.
// Grenze: ein festes Tempo. Wird ein Stück schneller oder langsamer, laufen die Schläge mit der Zeit daneben.

import { baueFft } from "/lib/fft.js";

const N = 1024;
const SPRUNG = 512;
const fft = baueFft(N);
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

export function analysiereTakt(puffer) {
  const rate = puffer.sampleRate;
  const mono = new Float32Array(puffer.length);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k);
    for (let i = 0; i < mono.length; i++) mono[i] += kanal[i] / puffer.numberOfChannels;
  }
  const stuecke = Math.max(0, Math.floor((mono.length - N) / SPRUNG) + 1);
  const proSekunde = rate / SPRUNG;
  const zeitVon = (s) => (s * SPRUNG + N / 2) / rate;

  // 1. Fluss
  const fluss = new Float32Array(stuecke);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const stueck = new Float32Array(N);
  let vorher = new Float32Array(N / 2);
  let jetzt = new Float32Array(N / 2);
  for (let s = 0; s < stuecke; s++) {
    for (let i = 0; i < N; i++) stueck[i] = mono[s * SPRUNG + i] * hann[i];
    fft(stueck, re, im);
    let summe = 0;
    for (let k = 1; k < N / 2; k++) {
      jetzt[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      if (s > 0) summe += Math.max(0, jetzt[k] - vorher[k]);
    }
    fluss[s] = summe;
    [vorher, jetzt] = [jetzt, vorher];
  }
  let groesster = 0;
  for (const v of fluss) groesster = Math.max(groesster, v);
  if (groesster > 0) for (let s = 0; s < stuecke; s++) fluss[s] /= groesster;

  // 2. Einsätze
  const umgebung = Math.round(0.2 * proSekunde);
  const nah = Math.max(1, Math.round(0.035 * proSekunde));
  const abstand = Math.round(0.09 * proSekunde); // höchstens elf pro Sekunde (Sechzehntel bei 165 BPM)
  const einsaetze = [];
  let letzter = -abstand;
  for (let s = 1; s < stuecke - 1; s++) {
    let mittel = 0;
    let anzahl = 0;
    let spitze = true;
    for (let j = Math.max(0, s - umgebung); j <= Math.min(stuecke - 1, s + umgebung); j++) {
      mittel += fluss[j];
      anzahl++;
      if (Math.abs(j - s) <= nah && fluss[j] > fluss[s]) spitze = false;
    }
    mittel /= anzahl;
    if (spitze && fluss[s] > mittel * 1.5 + 0.03 && s - letzter >= abstand) {
      einsaetze.push({ t: zeitVon(s), staerke: Math.min(1, fluss[s] / (mittel * 4 + 0.05)) });
      letzter = s;
    }
  }

  // 3. Tempo (nur ab etwa vier Sekunden sinnvoll)
  let bpm = null;
  let schlaege = [];
  if (stuecke > proSekunde * 4) {
    // nur die Spitzen über dem eigenen Durchschnitt (der Grundpegel würde jede Verschiebung gut aussehen lassen)
    const roh = Float32Array.from(fluss, (v, s) => {
      let m = 0;
      let n = 0;
      for (let j = Math.max(0, s - umgebung); j <= Math.min(stuecke - 1, s + umgebung); j++, n++) m += fluss[j];
      return Math.max(0, v - m / n);
    });
    let besteGuete = -1;
    let besteVerschiebung = 0;
    for (let v = Math.floor((60 / 200) * proSekunde); v <= Math.ceil((60 / 60) * proSekunde); v++) {
      let summe = 0;
      for (let s = 0; s + v < stuecke; s++) summe += roh[s] * roh[s + v];
      summe /= stuecke - v;
      const tempo = (60 * proSekunde) / v;
      const vorliebe = Math.exp(-0.5 * Math.log2(tempo / 120) ** 2); // ein Oktave daneben: 0,6
      if (summe * vorliebe > besteGuete) {
        besteGuete = summe * vorliebe;
        besteVerschiebung = v;
      }
    }
    // fein: zwischen den ganzen Stücken (die Verschiebung mit Komma, über die Parabel durch drei Nachbarn)
    const guete = (v) => {
      let summe = 0;
      for (let s = 0; s + v < stuecke; s++) summe += roh[s] * roh[s + v];
      return summe / (stuecke - v);
    };
    // langsam, aber das doppelte Tempo passt auch: das nehmen (siehe oben)
    // (die halbe Verschiebung liegt selten genau auf einem ganzen Stück: die beste der drei Nachbarn)
    const halb = [-1, 0, 1].map((d) => Math.round(besteVerschiebung / 2) + d).reduce((a, b) => (guete(b) > guete(a) ? b : a));
    if ((60 * proSekunde) / besteVerschiebung < 90 && guete(halb) > guete(besteVerschiebung) / 4) besteVerschiebung = halb;
    const [a, b, c] = [guete(besteVerschiebung - 1), guete(besteVerschiebung), guete(besteVerschiebung + 1)];
    const feinVerschiebung = besteVerschiebung + (a - c !== 0 && a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0);
    const periode = feinVerschiebung / proSekunde; // Sekunden pro Schlag
    bpm = 60 / periode;
    // 4. Raster anlegen: welcher Versatz trifft am meisten Fluss?
    let besterVersatz = 0;
    let besteSumme = -1;
    for (let o = 0; o < 64; o++) {
      const versatz = (o / 64) * periode;
      let summe = 0;
      for (let t = versatz; t < mono.length / rate; t += periode) {
        const s = Math.round((t * rate - N / 2) / SPRUNG);
        if (s >= 0 && s < stuecke) summe += roh[s];
      }
      if (summe > besteSumme) {
        besteSumme = summe;
        besterVersatz = versatz;
      }
    }
    for (let t = besterVersatz; t < mono.length / rate; t += periode) schlaege.push(t);
  }
  return { einsaetze, bpm, schlaege };
}

// der letzte Eintrag einer sortierten Liste von Zeiten, der nicht nach t liegt (−1: keiner)
function davor(liste, t, zeit = (x) => x) {
  let lo = 0;
  let hi = liste.length - 1;
  let ergebnis = -1;
  while (lo <= hi) {
    const mitte = (lo + hi) >> 1;
    if (zeit(liste[mitte]) <= t) {
      ergebnis = mitte;
      lo = mitte + 1;
    } else hi = mitte - 1;
  }
  return ergebnis;
}

// die beiden Signale zur Zeit t (Sekunden in der Datei), je 0 bis 1:
//   einsatz  springt bei jedem Einsatz auf seine Stärke und klingt in abklingen Sekunden auf ein Drittel ab
//   takt     dasselbe auf jedem Schlag des Rasters, immer voll (gleichmäßig, auch wo die Musik leise ist)
export function taktWerte(analyse, t, abklingen = 0.15) {
  if (!analyse) return { einsatz: 0, takt: 0 };
  const e = davor(analyse.einsaetze, t, (x) => x.t);
  const s = davor(analyse.schlaege, t);
  return {
    einsatz: e < 0 ? 0 : analyse.einsaetze[e].staerke * Math.exp(-(t - analyse.einsaetze[e].t) / abklingen),
    takt: s < 0 ? 0 : Math.exp(-(t - analyse.schlaege[s]) / abklingen),
  };
}
