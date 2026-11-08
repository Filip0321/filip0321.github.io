// Databending wie in Audacity: ein Bild als Rohdaten laden, als Ton bearbeiten, wieder als Bild speichern.
// Hier ohne Umweg über Dateien: die Bytes R, G, B jedes Pixels hintereinander, Zeile für Zeile, sind die Samples.
// Ein Byte 0 bis 255 wird zu −1 bis 1 (128 ist die Mitte, wie bei 8-Bit-Ton ohne Vorzeichen).
//
// Warum das so aussieht, wie es aussieht:
//   Echo um d Bytes     eine Kopie des Bildes, d/3 Pixel weiter (und bei d > Breite·3 eine Zeile tiefer). Ist d
//                       kein Vielfaches von 3, liegt das Rot der Kopie auf dem Grün des Originals: Farben rutschen.
//   Tiefpass            glättet Byte für Byte: R, G und B eines Pixels verschwimmen ineinander (Grau, Farbsäume)
//   Hochpass            nur die Unterschiede bleiben: Kanten und ein Muster aus R-G-B-Streifen
//   Verzerrung, Bitcrush  zu wenig Stufen oder Abgeschnittenes: harte Farbflächen, Banding
//   Rückwärts           Stücke spiegeln: in einem Stück wird B G R zu R G B, die Pixel tauschen Rot und Blau
//   Kanal-Versatz       alles um 1 oder 2 Bytes verschieben: Rot wird Grün wird Blau
//   Tempo               schneller oder langsamer abspielen = mehr oder weniger Bytes pro Zeile: das Bild schert
//   Hall                viele Echos durcheinander (Schroeder: vier Kammfilter nebeneinander, zwei Allpässe
//                       dahinter): das Bild wird zu einem Schleier aus verschmierten, farbig gestreiften Kopien
//   Phaser              Allpässe, deren Frequenz ein LFO verschiebt; gemischt mit dem Original löschen sich
//                       einzelne Frequenzen aus. Im Bild: Wellen, die mit der LFO-Periode durch die Zeilen laufen
//   Flanger             ein sehr kurzes Echo, dessen Verzögerung der LFO hin und her schiebt: das Bild „biegt“
//                       sich, Kanten werden doppelt, im Abstand, der mit der Periode schwankt
//
// Jeder Schritt bekommt das ganze Signal (Float32Array) und darf nur zwischen von und bis (in Samples) etwas
// ändern; das Projekt Databending gibt so jedem markierten Bereich seine eigenen Effekte.

export const bildZuTon = (bild) => {
  const d = bild.data;
  const ton = new Float32Array((d.length / 4) * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) {
    ton[j++] = (d[i] - 128) / 128;
    ton[j++] = (d[i + 1] - 128) / 128;
    ton[j++] = (d[i + 2] - 128) / 128;
  }
  return ton;
};

export function tonZuBild(ton, breite, hoehe) {
  const bild = new ImageData(breite, hoehe);
  const d = bild.data;
  for (let i = 0, j = 0; i < d.length; i += 4) {
    d[i] = ton[j++] * 128 + 128; // Uint8ClampedArray schneidet selbst bei 0 und 255 ab
    d[i + 1] = ton[j++] * 128 + 128;
    d[i + 2] = ton[j++] * 128 + 128;
    d[i + 3] = 255;
  }
  return bild;
}

// ---------- die Effekte, je eine Funktion: (ton, von, bis, werte) ----------
export const EFFEKTE = {
  echo(t, von, bis, { menge = 0.5, bytes = 2401, rueck = 0.3 }) {
    // y[n] = x[n] + menge · x[n − d] + rueck · y[n − d]: Kopie plus Rückkopplung (mehrere, schwächer werdende Kopien)
    const d = Math.max(1, Math.round(bytes));
    const x = t.slice(von, bis);
    for (let n = von; n < bis; n++) {
      const k = n - von;
      if (k >= d) t[n] = x[k] + menge * x[k - d] + rueck * t[n - d];
    }
  },
  tiefpass(t, von, bis, { staerke = 0.5 }) {
    // einpoliger Tiefpass: jedes Sample geht nur ein Stück auf den neuen Wert zu
    let y = t[von];
    for (let n = von; n < bis; n++) t[n] = y += (1 - staerke) * (t[n] - y);
  },
  hochpass(t, von, bis, { staerke = 0.5 }) {
    let x1 = t[von];
    let y = 0;
    for (let n = von; n < bis; n++) {
      const x = t[n];
      y = staerke * (y + x - x1);
      x1 = x;
      t[n] = y;
    }
  },
  verzerrung(t, von, bis, { staerke = 0.5 }) {
    const g = 1 + staerke * 20;
    const norm = Math.tanh(g);
    for (let n = von; n < bis; n++) t[n] = Math.tanh(t[n] * g) / norm;
  },
  bitcrush(t, von, bis, { bits = 4 }) {
    const q = 2 ** (Math.max(1, Math.round(bits)) - 1);
    for (let n = von; n < bis; n++) t[n] = Math.round(t[n] * q) / q;
  },
  rueckwaerts(t, von, bis, { bytes = 3000 }) {
    const l = Math.max(2, Math.round(bytes));
    for (let a = von; a < bis; a += l) t.subarray(a, Math.min(bis, a + l)).reverse();
  },
  versatz(t, von, bis, { bytes = 1 }) {
    const k = Math.round(bytes);
    if (!k) return;
    const x = t.slice(von, bis);
    for (let n = 0; n < x.length; n++) t[von + n] = x[(n + k) % x.length];
  },
  tempo(t, von, bis, { faktor = 1.01 }) {
    // schneller: das Stück wird mit größeren Schritten gelesen, der Rest wiederholt sich von vorn
    const x = t.slice(von, bis);
    for (let n = 0; n < x.length; n++) t[von + n] = x[Math.floor(n * faktor) % x.length];
  },
  verstaerken(t, von, bis, { faktor = 1.5 }) {
    for (let n = von; n < bis; n++) t[n] *= faktor;
  },
  hall(t, von, bis, { raum = 1, nachhall = 0.8, menge = 0.4 }) {
    // Schroeder-Hall (so ist auch Freeverb gebaut). Ein Kammfilter y[n] = x[n] + g · y[n − L] ist ein Echo, das
    // sich selbst wiederholt. Vier mit Längen ohne gemeinsamen Teiler ergeben zusammen dichte, unregelmäßige
    // Echos. Die zwei Allpässe danach verändern die Lautstärke nicht, nur die Zeit: sie streuen jedes Echo
    // noch einmal in viele kleine. Die Längen sind die von Freeverb bei 44,1 kHz, mal „raum“.
    const kamm = [1557, 1617, 1491, 1422].map((l) => Math.max(1, Math.round(l * raum)));
    const allpass = [556, 225].map((l) => Math.max(1, Math.round(l * raum)));
    const x = t.slice(von, bis);
    const nass = new Float32Array(x.length);
    for (const L of kamm) {
      const y = new Float32Array(x.length);
      for (let n = 0; n < x.length; n++) y[n] = x[n] + (n >= L ? nachhall * y[n - L] : 0);
      for (let n = 0; n < x.length; n++) nass[n] += y[n] * 0.25 * (1 - nachhall); // · (1 − g): gleich laut
    }
    for (const L of allpass) {
      // Allpass: y[n] = −g · x[n] + x[n − L] + g · y[n − L], mit g = 0,5
      const ein = nass.slice();
      for (let n = 0; n < x.length; n++) nass[n] = -0.5 * ein[n] + (n >= L ? ein[n - L] + 0.5 * nass[n - L] : 0);
    }
    for (let n = 0; n < x.length; n++) t[von + n] = x[n] * (1 - menge) + nass[n] * menge * 3;
  },
  phaser(t, von, bis, { periode = 7680, tiefe = 0.8, stufen = 4, rueck = 0.5, menge = 0.5, phase = 0 }) {
    // Ein Allpass erster Ordnung y[n] = a · x[n] + x[n − 1] − a · y[n − 1] lässt alle Frequenzen durch, dreht
    // aber ihre Phase, um so mehr, je näher sie an seiner Eckfrequenz liegen. Hinter mehreren Stufen ist eine
    // Frequenz genau gegenphasig; mit dem Original gemischt fällt sie weg (eine Kerbe). Der LFO schiebt die
    // Eckfrequenz und damit die Kerben hin und her: das „Wusch“ des Phasers.
    // periode in Bytes: bei Breite · 3 läuft eine Welle genau einmal pro Zeile durch (im Bild senkrechte Bänder).
    const n0 = Math.max(1, Math.round(stufen));
    const x1 = new Float32Array(n0); // je Stufe: letzter Eingang
    const y1 = new Float32Array(n0); // und letzter Ausgang
    let zurueck = 0;
    for (let n = von; n < bis; n++) {
      const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * (n - von)) / periode + phase);
      // Eckfrequenz (als Anteil der Abtastrate) zwischen 0,01 und 0,01 + 0,3 · tiefe, logarithmisch wie beim Ohr
      const f = 0.01 * Math.pow(1 + 30 * tiefe, lfo);
      const tn = Math.tan(Math.PI * Math.min(f, 0.49));
      const a = (1 - tn) / (1 + tn);
      let s = t[n] + rueck * zurueck;
      for (let k = 0; k < n0; k++) {
        const y = a * s + x1[k] - a * y1[k];
        x1[k] = s;
        y1[k] = y;
        s = y;
      }
      zurueck = s;
      t[n] = t[n] * (1 - menge) + s * menge;
    }
  },
  flanger(t, von, bis, { periode = 7680, tiefe = 24, rueck = 0.5, menge = 0.5, phase = 0 }) {
    // Echo mit Verzögerung d(n) = 1 + tiefe · (1 + sin)/2, zwischen zwei Samples linear gemischt (d ist keine
    // ganze Zahl). Original plus kurzes Echo ergibt einen Kamm aus Kerben im Spektrum, und weil d wandert,
    // wandern die Kerben: Flanger. Im Bild: eine Kopie, die um d/3 Pixel hin und her rutscht.
    const x = t.slice(von, bis);
    const y = new Float32Array(x.length);
    for (let n = 0; n < x.length; n++) {
      const d = 1 + tiefe * (0.5 + 0.5 * Math.sin((2 * Math.PI * n) / periode + phase));
      const p = n - d;
      const i = Math.floor(p);
      const f = p - i;
      const lies = (q) => (q >= 0 ? x[q] + rueck * y[q] : 0); // Echo mit Rückkopplung
      const echo = i >= 0 ? lies(i) * (1 - f) + lies(i + 1) * f : 0;
      y[n] = x[n] + echo * 0.7;
      t[von + n] = x[n] * (1 - menge) + y[n] * menge;
    }
  },
};

// Name und Regler jedes Effekts für das Projekt (regler wie in der Sammlung: name, text, min, max, schritt, wert)
export const EFFEKT_BESCHREIBUNG = {
  echo: { name: "Echo", regler: [{ name: "menge", text: "Menge", min: 0, max: 1, schritt: 0.01, wert: 0.5 }, { name: "bytes", text: "Verzögerung (Bytes)", min: 1, max: 60000, schritt: 1, wert: 2401 }, { name: "rueck", text: "Rückkopplung", min: 0, max: 0.95, schritt: 0.01, wert: 0.3 }] },
  tiefpass: { name: "Tiefpass", regler: [{ name: "staerke", text: "Stärke", min: 0, max: 0.99, schritt: 0.01, wert: 0.7 }] },
  hochpass: { name: "Hochpass", regler: [{ name: "staerke", text: "Stärke", min: 0, max: 0.999, schritt: 0.001, wert: 0.9 }] },
  verzerrung: { name: "Verzerrung", regler: [{ name: "staerke", text: "Stärke", min: 0, max: 1, schritt: 0.01, wert: 0.4 }] },
  bitcrush: { name: "Bitcrush", regler: [{ name: "bits", text: "Bits", min: 1, max: 8, schritt: 1, wert: 3 }] },
  rueckwaerts: { name: "Rückwärts", regler: [{ name: "bytes", text: "Stücklänge (Bytes)", min: 2, max: 60000, schritt: 1, wert: 3000 }] },
  versatz: { name: "Kanal-Versatz", regler: [{ name: "bytes", text: "Bytes", min: -2, max: 2, schritt: 1, wert: 1 }] },
  tempo: { name: "Tempo", regler: [{ name: "faktor", text: "Faktor", min: 0.9, max: 1.1, schritt: 0.0005, wert: 1.004 }] },
  verstaerken: { name: "Verstärken", regler: [{ name: "faktor", text: "Faktor", min: 0, max: 4, schritt: 0.05, wert: 1.5 }] },
  hall: { name: "Hall", regler: [{ name: "raum", text: "Raumgröße", min: 0.05, max: 20, schritt: 0.05, wert: 1 }, { name: "nachhall", text: "Nachhall", min: 0, max: 0.97, schritt: 0.01, wert: 0.8 }, { name: "menge", text: "Menge", min: 0, max: 1, schritt: 0.01, wert: 0.4 }] },
  phaser: { name: "Phaser", regler: [{ name: "periode", text: "LFO-Periode (Bytes)", min: 30, max: 200000, schritt: 1, wert: 7680 }, { name: "tiefe", text: "Tiefe", min: 0, max: 1, schritt: 0.01, wert: 0.8 }, { name: "stufen", text: "Stufen", min: 1, max: 12, schritt: 1, wert: 4 }, { name: "rueck", text: "Rückkopplung", min: 0, max: 0.95, schritt: 0.01, wert: 0.5 }, { name: "menge", text: "Menge", min: 0, max: 1, schritt: 0.01, wert: 0.5 }] },
  flanger: { name: "Flanger", regler: [{ name: "periode", text: "LFO-Periode (Bytes)", min: 30, max: 200000, schritt: 1, wert: 7680 }, { name: "tiefe", text: "Tiefe (Bytes)", min: 1, max: 600, schritt: 1, wert: 24 }, { name: "rueck", text: "Rückkopplung", min: 0, max: 0.95, schritt: 0.01, wert: 0.5 }, { name: "menge", text: "Menge", min: 0, max: 1, schritt: 0.01, wert: 0.5 }] },
};

// für den Effekt „Databending“ der Sammlung: welche Schritte aus seinen Reglern werden (Reihenfolge fest)
export const ALLE_SCHRITTE = [
  { art: "versatz", werteAus: (w) => ({ an: Math.round(w.versatz ?? 0) !== 0, bytes: w.versatz }) },
  { art: "echo", werteAus: (w) => ({ an: (w.echoMenge ?? 0) > 0 || (w.echoRueck ?? 0) > 0, menge: w.echoMenge ?? 0.5, bytes: w.echoBytes ?? 2401, rueck: w.echoRueck ?? 0.3 }) },
  { art: "tiefpass", werteAus: (w) => ({ an: (w.tiefpass ?? 0) > 0, staerke: w.tiefpass }) },
  { art: "hochpass", werteAus: (w) => ({ an: (w.hochpass ?? 0) > 0, staerke: w.hochpass }) },
  { art: "verzerrung", werteAus: (w) => ({ an: (w.verzerrung ?? 0) > 0, staerke: w.verzerrung }) },
  { art: "bitcrush", werteAus: (w) => ({ an: (w.bits ?? 8) < 8, bits: w.bits }) },
  { art: "rueckwaerts", werteAus: (w) => ({ an: (w.umkehren ?? 0) > 0, bytes: w.umkehren }) },
  // LFO-Phase wandert mit der Zeit (w.zeit, Umdrehungen pro Sekunde in w.lfoLauf): im Video laufen die Wellen
  { art: "phaser", werteAus: (w) => ({ an: (w.phaser ?? 0) > 0, menge: w.phaser, periode: w.lfoPeriode ?? 7680, tiefe: 0.8, stufen: 4, rueck: 0.5, phase: 2 * Math.PI * (w.lfoLauf ?? 0) * (w.zeit ?? 0) }) },
  { art: "flanger", werteAus: (w) => ({ an: (w.flanger ?? 0) > 0, menge: w.flanger, periode: w.lfoPeriode ?? 7680, tiefe: w.flangerTiefe ?? 24, rueck: 0.5, phase: 2 * Math.PI * (w.lfoLauf ?? 0) * (w.zeit ?? 0) }) },
  { art: "hall", werteAus: (w) => ({ an: (w.hall ?? 0) > 0, menge: w.hall, raum: w.hallRaum ?? 1, nachhall: 0.8 }) },
];

// ein Bild durch eine Liste von Schritten { art, von?, bis?, ...werte } (von, bis in Samples; ohne: alles)
export function biegeBytes(bild, schritte) {
  if (!schritte.length) return bild;
  const t = bildZuTon(bild);
  for (const s of schritte) EFFEKTE[s.art]?.(t, Math.max(0, s.von ?? 0), Math.min(t.length, s.bis ?? t.length), s);
  const aus = tonZuBild(t, bild.width, bild.height);
  // Durchsichtigkeit bleibt, wie sie war (die Bytes von Alpha sind nicht Teil des Tons)
  for (let i = 3; i < aus.data.length; i += 4) aus.data[i] = bild.data[i];
  return aus;
}
