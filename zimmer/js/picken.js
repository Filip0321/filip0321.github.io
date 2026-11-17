// Einen Punkt auf der Oberfläche finden, die unter der Maus zu sehen ist (zum Setzen von Gegenständen und Ecken).
//
// Der Scan hat keine Flächen, nur halb durchsichtige Flecken. „Die Oberfläche“ ist da, wo man beim Hineinschauen
// nicht mehr weiter sieht: Ein Strahl geht vom Auge durch das Pixel. Jeder Splat in der Nähe des Strahls deckt einen
// Teil ab, je nach Deckkraft und je nach Abstand zum Strahl (glockenförmig, wie er gezeichnet wird). Von vorn nach
// hinten wird die Durchlässigkeit multipliziert, genau wie beim Zeichnen:
//   T ← T · (1 − α_i),  am Anfang T = 1
// Die Oberfläche liegt beim ersten Splat, nach dem T unter ½ fällt: dort ist mehr als die Hälfte verdeckt.
// Ein einzelner sehr deckender Floater weit vorn zählt damit nur, wenn er wirklich die Sicht versperrt; viele schwache
// Splats einer Wand zählen zusammen. (Vorher: der vorderste Splat mit genug Deckkraft, das blieb an Floatern hängen.)
// Genau ist es nicht (der wirkliche Fleck ist ein Ellipsoid, hier nur sein Mittelpunkt), aber auf 1–2 cm reicht es.
// Im orthografischen Bild sind alle Strahlen parallel; die Glocke ist dort überall gleich breit (4 Pixel / Maßstab).

export function pickePunkt(k, px, py, szene, breite, hoehe) {
  const { anfang, richtung } = k.strahl(px, py, breite, hoehe);
  const { lage, farbe, anzahl } = szene;
  const winkel = 4 / k.fokus; // Breite der Glocke: etwa 4 Pixel (perspektivisch: wächst mit der Tiefe t)
  const fest = k.ortho ? 4 / k.massstab : 0;
  const treffer = [];
  for (let i = 0; i < anzahl; i++) {
    const a = farbe[4 * i + 3];
    if (a < 3) continue;
    const vx = lage[3 * i] - anfang[0], vy = lage[3 * i + 1] - anfang[1], vz = lage[3 * i + 2] - anfang[2];
    const t = vx * richtung[0] + vy * richtung[1] + vz * richtung[2];
    if (t <= 0.05) continue;
    const qx = vx - t * richtung[0], qy = vy - t * richtung[1], qz = vz - t * richtung[2];
    const q = Math.sqrt(qx * qx + qy * qy + qz * qz) / (fest || t * winkel); // Abstand zum Strahl in „Glockenbreiten“
    if (q > 3) continue;
    treffer.push(t, (a / 255) * Math.exp(-0.5 * q * q));
  }
  // nach Tiefe sortieren (Paare t, α)
  const n = treffer.length / 2;
  const ordnung = Array.from({ length: n }, (_, i) => i).sort((i, j) => treffer[2 * i] - treffer[2 * j]);
  let durch = 1;
  for (const i of ordnung) {
    durch *= 1 - Math.min(0.99, treffer[2 * i + 1]);
    if (durch < 0.5) {
      const t = treffer[2 * i];
      return { punkt: [0, 1, 2].map((j) => anfang[j] + richtung[j] * t), tiefe: t };
    }
  }
  return null;
}
