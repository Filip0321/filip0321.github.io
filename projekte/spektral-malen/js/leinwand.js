// Die Leinwand: was eine Spalte und ein Fach ist, und wie Bild, Zeit und Frequenz zusammenhängen.
// Reine Rechnung, ohne HTML, ohne Grafikkarte, ohne Ton.
//
// Die Leinwand ist von Anfang an ein Spektrogramm, wie es die FFT liefert (STFT):
//   Spalte = ein Fenster, das um "sprung" Samples weiterrückt (die Zeit)
//   Fach   = eine Frequenz, k · RATE / fenster Hz (Fach 0 = 0 Hz, Fach fenster/2 = halbe Abtastrate)
// Jede Stelle ist eine Zahl von 0 (still) bis 1 (laut), wie die Helligkeit in bild-zu-ton.
// Die Phase kommt erst mit dem Einfügen von Ton dazu (Fahrplan, Schritt 3); bis dahin erfindet der
// Klang sie selbst (klang-worklet.js).
//
// Warum gleich in Fächern und nicht in Zeilen wie bei bild-zu-ton? Alles, was später kommt
// (Ton einfügen, Kreuzsynthese, Freeze, Verschieben mit dem Phasen-Vocoder), rechnet in Fächern.
// Was man sieht, ist nur eine Ansicht darauf: die Höhe im Bild ist logarithmisch (anzeige-shader.js).

export const RATE = 48000; // wie in /lib/ton.js
export const UEBERLAPPUNG = 4; // jedes Sample liegt in 4 Fenstern (Sprung = Fenster / 4, wie im Spektrogramm)

// dauer in Sekunden, fenster in Samples (Zweierpotenz, weil die FFT das braucht)
export function baueLeinwand({ dauer, fenster }) {
  const sprung = fenster / UEBERLAPPUNG; // Samples pro Spalte
  const spalten = Math.max(1, Math.round((dauer * RATE) / sprung));
  return {
    fenster,
    sprung,
    spalten,
    faecher: fenster / 2 + 1, // 0 bis fenster/2; die obere Hälfte des Spektrums ist nur das Spiegelbild
    fachBreite: RATE / fenster, // Hz zwischen zwei Fächern
    sekundenProSpalte: sprung / RATE,
    dauer: (spalten * sprung) / RATE, // auf ganze Spalten gerundet
  };
}

// Höhe im Bild als Anteil (0 unten, 1 oben) <-> Frequenz, logarithmisch zwischen tief und hoch:
// jede Oktave ist gleich hoch, wie bei bild-zu-ton und im Spektrogramm
export function anteilZuFrequenz(anteil, tief, hoch) {
  return tief * (hoch / tief) ** anteil;
}

export function frequenzZuAnteil(f, tief, hoch) {
  return Math.log(f / tief) / Math.log(hoch / tief);
}

// welches Fach zeigt das Bild bei dieser Frequenz? (das nächste, wie im Anzeige-Shader)
export function frequenzZuFach(f, leinwand) {
  return Math.min(Math.max(Math.round(f / leinwand.fachBreite), 0), leinwand.faecher - 1);
}
