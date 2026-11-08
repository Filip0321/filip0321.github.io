// SSTV (Slow-Scan Television): Bilder als Töne, seit 1957 im Amateurfunk, heute auch von der ISS gesendet.
// Ein normales Fernsehbild braucht Megahertz; über ein Funkgerät für Sprache passen nur etwa 3 kHz. Also wird das
// Bild langsam gesendet, Zeile für Zeile, Pixel für Pixel, und die Helligkeit ist eine Tonhöhe:
//   1500 Hz = schwarz, 2300 Hz = weiß, dazwischen linear
//   1200 Hz = Synchronimpuls (eine neue Zeile fängt an), tiefer als jedes Pixel, daher nicht zu verwechseln
//
// Drei Arten von Modi:
//   Martin (Martin Emmerson, 1980er)   jede Zeile: Grün, Blau, Rot, je alle Pixel. 320 × 256
//   PD (Paul Turner, Don Rotier, 1990er)  ein Impuls für ZWEI Zeilen: Helligkeit der ersten, Farbe (R−Y und B−Y,
//       für beide Zeilen gemeinsam), Helligkeit der zweiten. Farbe in halber Auflösung, wie bei JPEG und
//       Fernsehen: das Auge sieht Helligkeit schärfer als Farbe. Darum gehen hier 640 × 496 und 800 × 616
//   Frei (nur hier)   wie Martin, aber Breite, Höhe und Zeit pro Pixel frei; die Werte stehen im Ton selbst,
//       hinter dem VIS-Kode 127 (den kein Standard benutzt). Andere Programme lesen das nicht
//
// Vor dem Bild kommt der VIS-Kode (Vertical Interval Signaling): ein Ton, an dem der Empfänger merkt, dass etwas
// kommt, und eine 7-Bit-Zahl, die sagt, welcher Modus. Bits sind 30 ms lang: 1100 Hz = 1, 1300 Hz = 0, das
// niedrigste Bit zuerst, dann ein Paritätsbit (gerade Zahl von Einsen).

const martin = (name, vis, scan) => ({ name, art: "martin", vis, breite: 320, hoehe: 256, sync: 4.862e-3, porch: 0.572e-3, scan, trenner: 0.572e-3 });
const pd = (name, vis, breite, hoehe, scan) => ({ name, art: "pd", vis, breite, hoehe, sync: 20e-3, porch: 2.08e-3, scan });

export const MODI = {
  m1: martin("Martin M1", 44, 146.432e-3),
  m2: martin("Martin M2", 40, 73.216e-3),
  pd120: pd("PD-120", 95, 640, 496, 121.6e-3),
  pd180: pd("PD-180", 96, 640, 496, 183.04e-3),
  pd290: pd("PD-290", 94, 800, 616, 228.8e-3),
};

export const FREI_VIS = 127;

// ein freier Modus: Breite, Höhe, Zeit pro Pixel (Sekunden)
export function freierModus(breite, hoehe, pixel) {
  return { name: `Frei ${breite} × ${hoehe}`, art: "martin", frei: true, vis: FREI_VIS, breite, hoehe, sync: 4.862e-3, porch: 0.572e-3, scan: breite * pixel, trenner: 0.572e-3 };
}

// Zeilen pro Synchronimpuls (PD: zwei)
export const zeilenJeImpuls = (m) => (m.art === "pd" ? 2 : 1);
export const impulse = (m) => m.hoehe / zeilenJeImpuls(m);
// Zeit von einem Impuls zum nächsten
export const zeilenDauer = (m) => (m.art === "pd" ? m.sync + m.porch + 4 * m.scan : m.sync + m.porch + 3 * (m.scan + m.trenner));
// VIS (0,91 s), beim freien Modus dazu der Kopf mit Breite, Höhe, Pixelzeit (48 Bits und ein Stoppbit)
export const kopfDauer = (m) => 0.91 + (m.frei ? 49 * 0.03 : 0);
export const bildDauer = (m) => kopfDauer(m) + impulse(m) * zeilenDauer(m);

// Martin: wo in einer Zeile jede Farbe anfängt (Sekunden nach dem Anfang des Impulses), in Sendereihenfolge
export function farbStarts(m) {
  const g = m.sync + m.porch;
  const b = g + m.scan + m.trenner;
  const r = b + m.scan + m.trenner;
  return [
    { kanal: 1, ab: g }, // Grün
    { kanal: 2, ab: b }, // Blau
    { kanal: 0, ab: r }, // Rot
  ];
}

// PD: Y der ersten Zeile, R−Y, B−Y, Y der zweiten (je eine scan-Zeit)
export const pdStarts = (m) => [0, 1, 2, 3].map((k) => m.sync + m.porch + k * m.scan);

// Farbe ↔ YCrCb (ITU-R BT.601, wie in den PD-Modi festgelegt: Y 16–235, Cr und Cb um 128)
export function zuYcc(r, g, b) {
  return [
    16 + (65.738 * r + 129.057 * g + 25.064 * b) / 256,
    128 + (112.439 * r - 94.154 * g - 18.285 * b) / 256,
    128 + (-37.945 * r - 74.494 * g + 112.439 * b) / 256,
  ];
}
export function ausYcc(y, cr, cb) {
  const c = y - 16;
  const d = cb - 128;
  const e = cr - 128;
  return [(298.082 * c + 408.583 * e) / 256, (298.082 * c - 100.291 * d - 208.12 * e) / 256, (298.082 * c + 516.411 * d) / 256];
}

export const SCHWARZ = 1500;
export const WEISS = 2300;
export const SYNC = 1200;
export const VORTON = 1900;
