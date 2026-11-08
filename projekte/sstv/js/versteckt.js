// Bild im Ton versteckt (Steganografie, „verdeckt schreiben“): das Gegenstück zu SSTV.
// SSTV macht das Bild laut und robust: man hört es, und es kommt durch jeden Raum. Hier wird es unhörbar und
// zerbrechlich: es steckt in den untersten Bits der Samples, wo nur Rauschen sein dürfte.
//
// Ein Sample als 16-Bit-Zahl (−32768 bis 32767, wie in einer WAV): das unterste Bit ändert den Ton um
// 1 / 32768, etwa −90 dB, unter jedem Rauschen. Mit „Bits pro Sample“ = k werden die untersten k Bits ersetzt:
// mehr Platz (k Bits pro Sample), aber das Rauschen wird um 6 dB pro Bit lauter (bei 4 Bits etwa −72 dB).
// Platz: 48000 Samples pro Sekunde · k Bits. Bei 1 Bit und 10 Sekunden 60 kB, ein graues Bild von 270 · 220.
//
// Aufbau, Bit für Bit (höchstes Bit eines Bytes zuerst):
//   Kopf, immer 1 Bit pro Sample in den ersten 64 Samples:
//     "STEG" (4 Byte, die Kennung: so weiß der Empfänger, dass etwas drinsteckt)
//     Breite, Höhe (je 2 Byte), Kanäle (1 grau, 3 Farbe), Bits pro Sample (je 1 Byte) = 10 Byte = 80 Bits
//   danach die Pixel: Zeile für Zeile, je Pixel 1 oder 3 Byte, mit k Bits pro Sample
//
// Zerbrechlich: jede Rechnung am Ton (lauter, leiser, Filter, Hall, MP3) würfelt die untersten Bits neu. Schon
// das Normieren nach dem Raum reicht. Dann ist der Kopf kaputt (die Kennung fehlt) und die Pixel sind Rauschen.
// Gelesen wird dann mit den Maßen vom Start (wie ein Empfänger, der das Format kennt), damit man sieht, wie
// viel noch stimmt. Nur eine verlustfreie Kopie (WAV, genau so gespeichert und geladen) behält das Bild.

const KENNUNG = [0x53, 0x54, 0x45, 0x47]; // "STEG"
const KOPF_BITS = 80;

// Ton (−1 bis 1) → 16-Bit-Zahlen und zurück; so wie zuWav schreibt und der Browser liest (Zahl / 32768)
const zuZahl = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32768)));
const zuTon = (q) => q / 32768;

// wie groß darf das Bild sein, damit es in samples passt (Seitenverhältnis wie das Original)
export function passendeGroesse(samples, bits, kanaele, seitenverhaeltnis) {
  const platz = Math.floor(((samples - KOPF_BITS) * bits) / 8 / kanaele); // so viele Pixel
  const hoehe = Math.max(1, Math.floor(Math.sqrt(platz / seitenverhaeltnis)));
  const breite = Math.max(1, Math.min(4096, Math.floor(hoehe * seitenverhaeltnis)));
  return { breite, hoehe: Math.min(4096, hoehe) };
}

// bild: ImageData, schon in der passenden Größe. Zurück: der Ton mit dem Bild darin
export function verstecke(klang, bild, { bits, kanaele }) {
  const bytes = [...KENNUNG, bild.width >> 8, bild.width & 255, bild.height >> 8, bild.height & 255, kanaele, bits];
  for (let i = 0; i < bild.width * bild.height; i++) {
    const [r, g, b] = bild.data.subarray(i * 4, i * 4 + 3);
    if (kanaele === 1) bytes.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
    else bytes.push(r, g, b);
  }
  const ton = new Float32Array(klang.length);
  let bitNr = 0; // das wievielte Bit des Datenstroms
  const naechstesBit = () => {
    const byte = bytes[bitNr >> 3] ?? 0;
    const bit = (byte >> (7 - (bitNr & 7))) & 1;
    bitNr++;
    return bit;
  };
  for (let i = 0; i < klang.length; i++) {
    const k = i < KOPF_BITS ? 1 : bits;
    let wert = 0;
    for (let j = 0; j < k; j++) wert = (wert << 1) | naechstesBit();
    const maske = (1 << k) - 1;
    // die untersten k Bits löschen und durch die Daten ersetzen; & und | gehen auch mit negativen Zahlen,
    // weil JavaScript sie als 32-Bit-Zweierkomplement rechnet (−1 ist …1111)
    const q = (zuZahl(klang[i]) & ~maske) | wert;
    ton[i] = zuTon(Math.max(-32768, Math.min(32767, q)));
  }
  return ton;
}

// zurück aus dem Ton: { bild, kennung (true: der Kopf stimmt), breite, hoehe, kanaele, bits }
// ersatz: { breite, hoehe, kanaele, bits }, falls der Kopf kaputt ist
export function finde(ton, ersatz) {
  let sampleNr = 0;
  let rest = 0; // noch nicht gelesene Bits des aktuellen Samples
  let wert = 0;
  let k = 1;
  const bit = () => {
    if (rest === 0) {
      k = sampleNr < KOPF_BITS ? 1 : kopf.bits;
      wert = sampleNr < ton.length ? zuZahl(ton[sampleNr]) & ((1 << k) - 1) : 0;
      rest = k;
      sampleNr++;
    }
    rest--;
    return (wert >> rest) & 1;
  };
  const byte = () => {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bit();
    return b;
  };
  const kopf = { bits: 1 };
  const gelesen = Array.from({ length: 10 }, byte);
  const kennung = KENNUNG.every((b, i) => gelesen[i] === b);
  const ausKopf = { breite: (gelesen[4] << 8) | gelesen[5], hoehe: (gelesen[6] << 8) | gelesen[7], kanaele: gelesen[8], bits: gelesen[9] };
  const gueltig = kennung && ausKopf.breite > 0 && ausKopf.hoehe > 0 && [1, 3].includes(ausKopf.kanaele) && ausKopf.bits >= 1 && ausKopf.bits <= 8;
  const m = gueltig ? ausKopf : ersatz;
  kopf.bits = m.bits;
  const bild = new ImageData(m.breite, m.hoehe);
  for (let i = 0; i < m.breite * m.hoehe; i++) {
    const [r, g, b] = m.kanaele === 1 ? Array(3).fill(byte()) : [byte(), byte(), byte()];
    bild.data.set([r, g, b, 255], i * 4);
  }
  return { bild, kennung: gueltig, ...m };
}

// nur die versteckten Bits als Ton, laut gemacht: so klingt das Bild (wie Rauschen, denn gute Daten sehen für
// das Ohr zufällig aus; Flächen im Bild hört man als Brummen, weil sich dort die Bytes wiederholen)
export function versteckteBits(ton, bits) {
  const aus = new Float32Array(ton.length);
  for (let i = 0; i < ton.length; i++) {
    const k = i < KOPF_BITS ? 1 : bits;
    const maske = (1 << k) - 1;
    aus[i] = ((zuZahl(ton[i]) & maske) / Math.max(1, maske) - 0.5) * 0.5;
  }
  return aus;
}

// wie viel stimmt noch: Anteil gleicher Bits zwischen zwei Bildern (gleiche Maße), 50 % ist reiner Zufall
export function gleicheBits(a, b, kanaele) {
  if (a.width !== b.width || a.height !== b.height) return null;
  let gleich = 0;
  let alle = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    for (let c = 0; c < kanaele; c++) {
      const x = a.data[i * 4 + c] ^ b.data[i * 4 + c]; // ^: Bits, die verschieden sind
      gleich += 8 - [...x.toString(2)].filter((z) => z === "1").length;
      alle += 8;
    }
  }
  return gleich / alle;
}
