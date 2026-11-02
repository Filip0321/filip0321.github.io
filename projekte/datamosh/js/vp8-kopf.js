// Den Kopf eines VP8-Pakets lesen (RFC 6386, Abschnitt 9). Nur so weit, wie der Datamosh es braucht:
// Erneuert dieses Paket das Bezugsbild ("last")? Und behält es seine Wahrscheinlichkeiten?
//
// Warum das wichtig ist: VP8 packt fast alles (Bewegungsvektoren, Koeffizienten) mit einem
// „Bool-Kodierer“ (arithmetisches Kodieren). Der braucht für jedes Bit eine Wahrscheinlichkeit, und ein
// P-Frame darf diese Wahrscheinlichkeiten für alle FOLGENDEN Bilder ändern ("refresh_entropy_probs").
// Springt man mitten in einen anderen Clip, hat der Dekoder die Wahrscheinlichkeiten des falschen Clips
// und liest die Bits falsch: keine verschobenen Blöcke mehr, sondern Rauschen. Das war das „pure Glitchen“.
// Abhilfe in kodieren.js: mit zwei Zeitschichten kodieren (L1T2), dann ändert kein Paket die
// Wahrscheinlichkeiten dauerhaft. Hier wird nur nachgesehen, ob das geklappt hat.
//
// Der Bool-Dekoder: eine Zahl "wert" und ein Bereich "breite" (128 bis 255). Für ein Bit mit
// Wahrscheinlichkeit p (von 256, dass es 0 ist) wird der Bereich geteilt; liegt der Wert darüber, ist
// das Bit 1. Danach wird der Bereich wieder auf mindestens 128 verdoppelt und neue Bits nachgeschoben.

function boolDekoder(daten, start) {
  let i = start + 2;
  let wert = (daten[start] << 8) | daten[start + 1];
  let breite = 255;
  let bits = 0;
  function bit(p = 128) {
    const teil = 1 + (((breite - 1) * p) >> 8);
    const grenze = teil << 8;
    let ergebnis = 0;
    if (wert >= grenze) {
      ergebnis = 1;
      breite -= teil;
      wert -= grenze;
    } else {
      breite = teil;
    }
    while (breite < 128) {
      wert <<= 1;
      breite <<= 1;
      if (++bits === 8) {
        bits = 0;
        wert |= daten[i++] ?? 0;
      }
    }
    return ergebnis;
  }
  // n Bits, das höchste zuerst
  const zahl = (n) => {
    let x = 0;
    for (let k = 0; k < n; k++) x = (x << 1) | bit();
    return x;
  };
  return { zahl };
}

export function leseKopf(daten) {
  const marke = daten[0] | (daten[1] << 8) | (daten[2] << 16);
  const key = !(marke & 1);
  const b = boolDekoder(daten, key ? 10 : 3); // ein Keyframe hat dazwischen noch Startcode und Größe
  const L = b.zahl;
  if (key) L(2); // Farbraum, Clamping
  if (L(1)) {
    // Segmente
    const karte = L(1);
    if (L(1)) {
      L(1);
      for (let k = 0; k < 4; k++) if (L(1)) L(8); // 7 Bit Quantisierer + Vorzeichen
      for (let k = 0; k < 4; k++) if (L(1)) L(7); // 6 Bit Filter + Vorzeichen
    }
    if (karte) for (let k = 0; k < 3; k++) if (L(1)) L(8);
  }
  L(1 + 6 + 3); // Filterart, -stärke, -schärfe
  if (L(1) && L(1)) for (let k = 0; k < 8; k++) if (L(1)) L(7);
  L(2); // Anzahl Partitionen
  L(7); // Quantisierer
  for (let k = 0; k < 5; k++) if (L(1)) L(5);
  if (key) return { key, wahrscheinlichkeitenBleiben: L(1) === 1, erneuertLetztes: true };
  const golden = L(1);
  const alt = L(1);
  if (!golden) L(2);
  if (!alt) L(2);
  L(2); // Vorzeichen-Bias
  const bleiben = L(1) === 1;
  return { key, wahrscheinlichkeitenBleiben: bleiben, erneuertLetztes: L(1) === 1 };
}
