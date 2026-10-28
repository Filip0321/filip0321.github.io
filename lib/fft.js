// Eigene FFT, reine Rechnung ohne HTML und Ton, für alle Projekte (Spektrogramm, später Bild → Audio)

// FFT (Fast Fourier Transform) nach Cooley und Tukey
// https://en.wikipedia.org/wiki/Cooley%E2%80%93Tukey_FFT_algorithm
// https://alltools.dev/tools/visualizations/fft-visualizer/?signal=triangle&sr=48000&n=4096
// https://www.youtube.com/watch?v=h7apO7q16V0

// Baut eine FFT für eine feste Länge (Zweierpotenz): die Tabellen werden einmal vorausberechnet,
// zurück kommt die Funktion fft(stueck, re, im) genau für diese Länge.
// So kann es mehrere FFTs nebeneinander geben (4096 fürs Bild, 1024 für die Einsätze),
// jede mit eigenen Tabellen. Die innere Funktion "merkt" sich ihre Tabellen (Closure).
export function baueFft(laenge) {
  // Dasselbe Ergebnis wie die DFT, aber schneller: Eine DFT über N Samples lässt sich in
  // zwei DFTs über N/2 zerlegen (gerade und ungerade Samples), die wieder halbieren und so
  // weiter, bis nur noch Paare übrig sind. Statt N * N Schritten nur N * log2(N).
  const STUFEN = Math.log2(laenge); // z. B. 4096 = 2^12, also 12 Mal halbieren

  // Bit-Umkehr: Nach dem ständigen Aufteilen in "gerade" und "ungerade" liegt Sample i
  // an der Stelle, deren Binärzahl rückwärts gelesen i ergibt (bei 8: 001 -> 100, also 1 -> 4).
  // Einmal vorausberechnen, dann ist das Umsortieren nur noch Nachschlagen.

  // Anfang:            0  1  2  3  4  5  6  7
  // 1. Teilen:        [0  2  4  6][1  3  5  7]      gerade | ungerade
  // 2. Teilen:        [0  4][2  6][1  5][3  7]      in jeder Hälfte wieder gerade | ungerade
  // 3. Teilen:        [0][4][2][6][1][5][3][7]      fertig: Einzelstücke

  // Platz:             0  1  2  3  4  5  6  7
  // Sample dort:       0  4  2  6  1  5  3  7

  const umgedreht = new Uint32Array(laenge); // feste Länge, nur ganze Zahlen, startet mit lauter 0

  // Diese Schleife ersetzt das ganze Aufteilen in gerade und ungerade, alle Stufen auf einmal:
  // sie rechnet aus, wo jedes Sample am Ende landet (verschoben wird erst beim Tauschen in fft()).
  // Das unterste Bit (gerade/ungerade) wird zum obersten (vordere/hintere Hälfte),
  // das zweitunterste zum zweitobersten (Hälfte der Hälfte) usw.
  //
  // Beispiel mit STUFEN = 3 und i = 3 (011):
  //   Start:  rueckwaerts = 000, rest = 011
  //   bit 0:  000 nach links -> 000, unterstes Bit von 011 anhängen (1) -> 001, rest -> 001
  //   bit 1:  001 nach links -> 010, unterstes Bit von 001 anhängen (1) -> 011, rest -> 000
  //   bit 2:  011 nach links -> 110, unterstes Bit von 000 anhängen (0) -> 110, rest -> 000
  //   umgedreht[3] = 110 = 6
  // Ganz für 8: umgedreht = [0, 4, 2, 6, 1, 5, 3, 7]
  for (let i = 0; i < laenge; i++) {
    let rueckwaerts = 0;
    let rest = i;
    for (let bit = 0; bit < STUFEN; bit++) {
      rueckwaerts = (rueckwaerts << 1) | (rest & 1); 
      // << 1 schiebt alle Bits eine Stelle nach links, rechts kommt eine 0 dazu (mal 2) 
      // | x setzt diese neue Stelle rechts auf das Bit x 
      // rest & 1 liefert das unterste Bit (1 bei ungerader Zahl, 0 bei gerader)
      rest >>= 1; 
      // >>= 1 schiebt alle Bits eine Stelle nach rechts. Das unterste fällt weg, das ist dasselbe wie „durch 2, abgerundet“
    }
    umgedreht[i] = rueckwaerts;
  }

  // Drehfaktoren: die Kosinus- und Sinuswerte, die die DFT jedes Mal neu ausgerechnet hat,
  // hier einmal vorausberechnet: Punkte auf dem Einheitskreis beim Winkel 2 * PI * k / laenge.
  // Nur die halbe Runde (bis laenge / 2), mehr braucht der Schmetterling nie, weil k < halb bleibt
  const cosTabelle = new Float32Array(laenge / 2);
  const sinTabelle = new Float32Array(laenge / 2);
  for (let k = 0; k < laenge / 2; k++) {
    cosTabelle[k] = Math.cos((2 * Math.PI * k) / laenge);
    sinTabelle[k] = Math.sin((2 * Math.PI * k) / laenge);
    // 2 * PI * k / laenge ist gleich wie 2 * PI * (k / laenge)
    // also wie weit im Kreis der Winkel ist, von 0 bis 180 Grad
  }

  // stueck: Float32Array(laenge), re und im: Float32Array(laenge), werden überschrieben.
  // Danach steht in re[k] und im[k] Fach k, wie bei der DFT (brauchbar bis k = laenge / 2)
  return function fft(stueck, re, im) {
    // es wird also für jedes stück (so groß wie fenster) komplett von klein zu größer die jeweiligen Sinus, Cosinus nachgeschlagen
    // außerhalb: das Fenster wird um SPRUNG weitergeschoben (ein viertel) und dort ist das nächste Stück 
    // - und dann wird fft fürs neue Stück neu gerechnet
    // 1. in Bit-Umkehr-Reihenfolge kopieren, Imaginärteil fängt bei 0 an
    for (let i = 0; i < laenge; i++) {
      re[umgedreht[i]] = stueck[i]; // ist das sample oder was im Fenster eben gerade liegt
      im[umgedreht[i]] = 0; // Samples sind reelle Zahlen
    }
    // 2. von unten nach oben zusammensetzen: erst Paare (2), dann 4er, 8er … bis laenge
    for (let groesse = 2; groesse <= laenge; groesse *= 2) {
      // Gruppen werden größer
      const halb = groesse / 2;
      const sprungTabelle = laenge / groesse; // kleine Gruppen brauchen nur jeden n-ten Drehfaktor
      // jede Gruppe dieser Größe einmal: bei 8 erst 4 Gruppen à 2, dann 2 à 4, dann 1 à 8
      // anfang springt um groesse, also werden die Gruppen weniger und größer; alle Plätze sind immer dabei
      for (let anfang = 0; anfang < laenge; anfang += groesse) {
        for (let k = 0; k < halb; k++) {
          // Drehfaktor W = cos − i*sin (das Minus wie bei der DFT)
          const wRe = cosTabelle[k * sprungTabelle];
          const wIm = -sinTabelle[k * sprungTabelle];
          const a = anfang + k; // vorher: Fach k der geraden Samples, nachher: Fach k der ganzen Gruppe
          const b = a + halb; // vorher: Fach k der ungeraden Samples, nachher: Fach k + halb der ganzen Gruppe
          // (wRe + i*wIm) * (re[b] + i*im[b]) 
          // = wRe*re[b] + i*wRe*im[b] + i*wIm*re[b] + i*i*wIm*im[b]
          // i*i = -1, also reell: wRe*re[b] - wIm*im[b], imaginär (alles mit i): wRe*im[b] + wIm*re[b]
          const tRe = wRe * re[b] - wIm * im[b];
          const tIm = wRe * im[b] + wIm * re[b];
          // Warum das reicht: Fach k des großen Spektrums = gerade[k] + W * ungerade[k]
          // (W dreht die ungerade Hälfte zurecht, weil die ein Sample später liegt)
          // Fach k + halb braucht denselben Drehfaktor eine halbe Runde weiter,
          // und eine halbe Runde dreht den Pfeil genau um: W wird zu −W
          // Also zwei Fächer mit einer Multiplikation: a + t und a − t (Fächer sind "halb" voneinander entfernt)
          // Reihenfolge wichtig: erst b, dann a, weil b noch das alte a braucht
          re[b] = re[a] - tRe;
          im[b] = im[a] - tIm;
          re[a] += tRe;
          im[a] += tIm;
        }
      }
    }
  };
}

export const FENSTER = 4096; // Samples pro Stück fürs Gesamtbild; Zweierpotenz, weil die FFT das braucht
export const fft = baueFft(FENSTER); // die FFT fürs Gesamtbild, wie bisher