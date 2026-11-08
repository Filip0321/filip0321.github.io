// Bild → SSTV-Ton. Ein Oszillator, dessen Frequenz von Abschnitt zu Abschnitt springt, ohne dass die Phase
// springt (phasenstetig: sonst knackt es bei jedem Pixel und der Ton wird breit). Die Phase wird darum nur
// weitergezählt: phase += 2π · f / Abtastrate.
// Zeiten: die Grenzen werden aus der Gesamtzeit gerechnet (Sample = runde(t · Rate)), nicht aufaddiert, sonst
// liefe bei 250 000 Pixeln ein Rundungsfehler auf und das Bild würde schräg.

import { farbStarts, zuYcc, impulse, FREI_VIS, SCHWARZ, WEISS, SYNC, VORTON } from "./modi.js";

// bild: ImageData in der Größe des Modus; m: ein Modus aus MODI oder freierModus()
export function kodiere(bild, m, rate) {
  const teile = []; // [frequenz, dauer]
  const bit = (b) => teile.push([b ? 1100 : 1300, 0.03]);
  // VIS: Vorton, Pause, Vorton, Startbit, 7 Bits, Parität, Stoppbit
  teile.push([VORTON, 0.3], [SYNC, 0.01], [VORTON, 0.3], [SYNC, 0.03]);
  let einsen = 0;
  for (let b = 0; b < 7; b++) {
    einsen += (m.vis >> b) & 1;
    bit((m.vis >> b) & 1);
  }
  bit(einsen % 2); // gerade Parität
  teile.push([SYNC, 0.03]);
  if (m.vis === FREI_VIS) {
    // Kopf des freien Modus: Breite, Höhe, Pixelzeit in µs, je 16 Bits, niedrigstes zuerst, dann ein Stoppbit
    for (const zahl of [m.breite, m.hoehe, Math.round((m.scan / m.breite) * 1e6)]) for (let b = 0; b < 16; b++) bit((zahl >> b) & 1);
    teile.push([SYNC, 0.03]);
  }

  const hell = (v) => SCHWARZ + ((WEISS - SCHWARZ) * Math.max(0, Math.min(255, v))) / 255;
  const d = bild.data;
  const px = m.scan / m.breite;
  if (m.art === "pd") {
    // zwei Zeilen pro Impuls; die Farbe ist der Mittelwert beider Zeilen
    for (let z = 0; z < impulse(m); z++) {
      const y0 = 2 * z;
      const ycc = (y, x) => {
        const i = (y * m.breite + x) * 4;
        return zuYcc(d[i], d[i + 1], d[i + 2]);
      };
      const oben = Array.from({ length: m.breite }, (_, x) => ycc(y0, x));
      const unten = Array.from({ length: m.breite }, (_, x) => ycc(y0 + 1, x));
      teile.push([SYNC, m.sync], [SCHWARZ, m.porch]);
      for (const x of oben.keys()) teile.push([hell(oben[x][0]), px]);
      for (const x of oben.keys()) teile.push([hell((oben[x][1] + unten[x][1]) / 2), px]); // R−Y
      for (const x of oben.keys()) teile.push([hell((oben[x][2] + unten[x][2]) / 2), px]); // B−Y
      for (const x of unten.keys()) teile.push([hell(unten[x][0]), px]);
    }
  } else {
    for (let y = 0; y < m.hoehe; y++) {
      teile.push([SYNC, m.sync], [SCHWARZ, m.porch]);
      for (const { kanal } of farbStarts(m)) {
        for (let x = 0; x < m.breite; x++) teile.push([hell(d[(y * m.breite + x) * 4 + kanal]), px]);
        teile.push([SCHWARZ, m.trenner]);
      }
    }
  }

  const ruhe = Math.round(0.5 * rate); // eine halbe Sekunde Stille vorn und hinten
  const dauer = teile.reduce((s, [, t]) => s + t, 0);
  const ton = new Float32Array(ruhe * 2 + Math.ceil(dauer * rate) + 1);
  let phase = 0;
  let t = 0;
  let i = ruhe;
  for (const [f, laenge] of teile) {
    t += laenge;
    const bis = ruhe + Math.round(t * rate);
    for (; i < bis; i++) {
      phase += (2 * Math.PI * f) / rate;
      ton[i] = 0.5 * Math.sin(phase);
    }
    if (phase > 1e6) phase %= 2 * Math.PI;
  }
  return ton;
}
