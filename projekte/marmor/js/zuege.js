// Die Züge beim Marmorieren und ihre Mathematik (Lu, Jaffer, Jin, Zhao, Mao: „Mathematical Marbling“, IEEE Computer
// Graphics and Applications 2012; Jaffer: „Oseen Flow in Ink Marbling“, 2019).
//
// Beim Marmorieren schwimmt Farbe auf einer dicken Flüssigkeit (Ebru: Wasser mit Tragant, Suminagashi: reines Wasser).
// Die Farbe ist so dünn, dass sie sich nicht mischt, nur verschiebt; die Fläche jeder Farbe bleibt gleich. Jeder Zug
// ist darum eine exakte Abbildung der Ebene auf sich selbst, die die Fläche erhält:
//
//   Tropfen (Mitte c, Radius r): alles, was schon da ist, wird nach außen geschoben, gerade so weit, dass ein Kreis
//     der Fläche π r² frei wird:   p' = c + (p − c) · √(1 + r² / |p − c|²)
//     (ein Ring zwischen den Radien a und b hat danach die Radien √(a² + r²) und √(b² + r²): dieselbe Fläche)
//   Nadel durch die Farbe entlang einer Geraden (Richtung M, Abstand d von der Geraden):
//     p' = p + z · u / (d + u) · M
//     z: wie weit die Nadel zieht, u: wie schnell die Wirkung mit dem Abstand abnimmt (klein: scharfe Spitze)
//     Weil alles nur parallel zur Geraden verschoben wird, bleibt d gleich: die Fläche bleibt erhalten.
//   Kamm: viele Nadeln im Abstand s; d ist der Abstand zur nächsten
//   Welle (Gelgit): p' = p + M · a · sin(2π (p · N) / λ + φ): Streifen quer zu N werden zu Wellen
//   Wirbel um c: jeder Ring dreht sich um den Winkel θ(d) = α · exp(−(d / u)²): außen weniger (wie umgerührt),
//     ab etwa 2u fast gar nicht mehr (mit u / (d + u) wie bei der Nadel würde jeder Wirbel das ganze Blatt drehen)
//     (auch das erhält die Fläche: jeder Ring bleibt, wo er ist, er dreht sich nur in sich)
//   Stift (freihand): ein kurzes Stück Strich, die Farbe rund um die Spitze (c) wird ein Stück z mitgenommen,
//     p' = p + z · (u / (d + u))² · M,  d = |p − c|
//     Das ist eine Näherung und erhält die Fläche nicht genau (die Wirkung hängt nicht nur vom Abstand zur
//     Geraden ab). Bei kurzen Stücken ist der Fehler klein; ein Strich besteht darum aus vielen Stücken. Die
//     Umkehrung hat keine Formel, der Shader findet sie in ein paar Schritten (Fixpunkt: p = q − D(p)).
//
// Gezeichnet wird rückwärts (bild.js): für jedes Pixel alle Züge vom letzten zum ersten umgekehrt anwenden, bis man
// in einem Tropfen landet. Dessen Farbe hat das Pixel. Die Umkehrungen sind alle genau: so bleibt jede Kante scharf,
// in jeder Auflösung, auch nach Hunderten von Zügen (ein Bild, das man Schritt für Schritt verzerrt, würde
// verschwimmen).
//
// Ein Zug ist eine Liste von 8 Zahlen: [art, a, b, c, d, e, f, g]
//   0 Tropfen  [0, cx, cy, r, R, G, B, saat]    (Farbe 0 bis 1)
//   1 Nadel    [1, px, py, winkel, z, u, 0, 0]
//   2 Kamm     [2, px, py, winkel, z, u, s, 0]
//   3 Welle    [3, 0, 0, winkel, a, λ, φ, 0]
//   4 Wirbel   [4, cx, cy, 0, α, u, 0, 0]
//   5 Stift    [5, cx, cy, winkel, z, u, 0, 0]
// Koordinaten: y von 0 (oben) bis 1 (unten), x von 0 bis Breite / Höhe.

export const TROPFEN = 0, NADEL = 1, KAMM = 2, WELLE = 3, WIRBEL = 4, STIFT = 5;

export const tropfen = (c, r, farbe, saat = Math.random()) => [TROPFEN, c[0], c[1], r, ...farbe, saat];
export const nadel = (p, winkel, z, u) => [NADEL, p[0], p[1], winkel, z, u, 0, 0];
export const kamm = (p, winkel, z, u, s) => [KAMM, p[0], p[1], winkel, z, u, s, 0];
export const welle = (winkel, a, lambda, phase = 0) => [WELLE, 0, 0, winkel, a, lambda, phase, 0];
export const wirbel = (c, alpha, u) => [WIRBEL, c[0], c[1], 0, alpha, u, 0, 0];
export const stift = (c, winkel, z, u) => [STIFT, c[0], c[1], winkel, z, u, 0, 0];

// Zufall mit Startwert (die Vorlagen sollen bei gleichem Startwert gleich aussehen)
export function zufallVon(saat) {
  let a = (Math.floor(saat * 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vorlagen: klassische Muster als Folge von Zügen. breite: Breite / Höhe; farben: Liste [r, g, b] (0 bis 1)
export const VORLAGEN = {
  // Battal (türkisch, „Steinmuster“): viele Tropfen nebeneinander, jeder drückt die anderen zu Vielecken
  battal(breite, farben, z) {
    const zuege = [];
    // so viele, dass am Ende fast keine freie Wasserfläche bleibt (Summe der Flächen ≈ 1,5 × Blatt)
    const n = Math.round(260 * breite);
    for (let i = 0; i < n; i++) zuege.push(tropfen([z() * breite, z()], 0.02 + z() * 0.045, farben[i % farben.length], z()));
    return zuege;
  },
  // Gelgit: erst Battal, dann mit dem Kamm hin und zurück. Zurück um einen halben Zinkenabstand versetzt: genau
  // auf denselben Linien zurück würde den ersten Zug wieder aufheben (die Abbildung ist umkehrbar!)
  gelgit(breite, farben, z) {
    const zuege = VORLAGEN.battal(breite, farben, z);
    const s = 0.1;
    zuege.push(kamm([0, 0], 0, 0.1, 0.015, s));
    zuege.push(kamm([0, s / 2], Math.PI, 0.1, 0.015, s));
    return zuege;
  },
  // Tarak („Kamm“): Gelgit, dann quer noch einmal mit feinem Kamm: die Federn
  tarak(breite, farben, z) {
    const zuege = VORLAGEN.gelgit(breite, farben, z);
    zuege.push(kamm([0, 0], Math.PI / 2, 0.12, 0.01, 0.045));
    return zuege;
  },
  // Bülbül yuvası („Nachtigallennest“): Gelgit, dann an vielen Stellen kleine Wirbel
  nachtigall(breite, farben, z) {
    const zuege = VORLAGEN.gelgit(breite, farben, z);
    const n = Math.round(breite * 5);
    for (let i = 0; i < n; i++) for (let j = 0; j < 5; j++) zuege.push(wirbel([(i + 0.5) * (breite / n), (j + 0.5) / 5], (j % 2 ? 1 : -1) * 7, 0.05));
    return zuege;
  },
  // Suminagashi (japanisch, „treibende Tusche“): abwechselnd Tusche und klares Wasser in dieselbe Mitte, das gibt
  // Ringe; dann ein Hauch, der sie verzieht (hier: ein Wirbel und eine weiche Nadel)
  suminagashi(breite, farben, z) {
    const zuege = [];
    const mitten = [[breite * (0.3 + z() * 0.15), 0.35 + z() * 0.2], [breite * (0.6 + z() * 0.15), 0.55 + z() * 0.2]];
    for (const c of mitten) {
      for (let i = 0; i < 30; i++) zuege.push(tropfen(c, 0.035 + (i % 3) * 0.008, i % 2 ? [0.96, 0.94, 0.9] : farben[(i >> 1) % farben.length], z()));
    }
    zuege.push(wirbel([breite * 0.5, 0.5], 2.5, 0.2));
    zuege.push(nadel([0, 0.4 + z() * 0.2], 0.3, 0.25, 0.08));
    zuege.push(nadel([breite * 0.3, 0], 1.9, 0.15, 0.05));
    return zuege;
  },
  // Wellen: Battal, dann eine Welle quer und eine längs
  wellen(breite, farben, z) {
    const zuege = VORLAGEN.battal(breite, farben, z);
    zuege.push(welle(0, 0.05, 0.25, z() * 6));
    zuege.push(welle(Math.PI / 2, 0.03, 0.13, z() * 6));
    return zuege;
  },
};

export const PALETTEN = {
  ebru: ["#1f3a6b", "#c9a14a", "#a8322b", "#1b1b1b", "#e8e0cc"],
  suminagashi: ["#111111", "#4a4a4a", "#1d2b3a"],
  ochsenblut: ["#5b0b0b", "#1a1012", "#d9cfc0", "#8c1c13", "#2b2b2b"],
  meer: ["#0b3c5d", "#328cc1", "#d9b310", "#f2f2f2", "#1d2731"],
  herbst: ["#6b2d12", "#c46a1a", "#e6b34a", "#3b4a2a", "#efe4cf"],
};
