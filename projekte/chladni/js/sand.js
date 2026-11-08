// Der Sand: viele Körner, jedes springt, wo die Platte schwingt, und bleibt liegen, wo sie still ist.
//
// Auf einer schwingenden Stelle wird ein Korn hochgeworfen und landet ein Stück weiter, in zufälliger Richtung.
// Die Sprungweite wächst mit der Auslenkung A an dieser Stelle. Das ist eine Zufallsbewegung, deren Schrittweite
// vom Ort abhängt, und so eine Bewegung sammelt sich dort, wo die Schritte klein sind: Die Dichte im
// Gleichgewicht ist etwa ∝ 1 / A². An den Knotenlinien (A = 0) bleibt jedes Korn liegen, das dorthin gerät.
// Dazu ein kleiner Sog den Hang hinab (−∇A): Körner rutschen von der Schwingung weg, so werden die Linien schärfer.

export function erstelleSand(anzahl, rnd) {
  const lage = new Float32Array(anzahl * 2);
  function streue() {
    for (let i = 0; i < lage.length; i++) lage[i] = rnd();
  }
  streue();

  // feld: Float32Array G × G mit der Auslenkung (Betrag), Zeile 0 oben
  // w: { sprung (Anteil der Seite pro Sekunde bei A = 1), sog, aufwirbeln (0 bis 1: alle springen), rand ("halten"
  //      oder "fallen": Körner, die über den Rand springen, kommen irgendwo neu auf die Platte, wie nachgestreut) }
  function schritt(feld, G, dt, w) {
    const A = (x, y) => {
      // bilinear im Feld
      const fx = Math.min(G - 1.001, Math.max(0, x * (G - 1)));
      const fy = Math.min(G - 1.001, Math.max(0, y * (G - 1)));
      const ix = fx | 0, iy = fy | 0;
      const tx = fx - ix, ty = fy - iy;
      const i = ix + iy * G;
      return (feld[i] * (1 - tx) + feld[i + 1] * tx) * (1 - ty) + (feld[i + G] * (1 - tx) + feld[i + G + 1] * tx) * ty;
    };
    const h = 1 / G;
    // Sprung pro Bild: Weite · √dt (so ist es eine echte Zufallsbewegung, unabhängig von der Bildrate)
    const weite = w.sprung * Math.sqrt(dt);
    for (let k = 0; k < lage.length; k += 2) {
      let x = lage[k];
      let y = lage[k + 1];
      // höchstens 1: bei starker Resonanz würden die Körner sonst über die Linien hinweg geworfen
      const a = Math.min(A(x, y), 1) + w.aufwirbeln;
      if (a > 1e-4) {
        // Richtung zufällig, Weite ∝ Auslenkung
        const winkel = rnd() * Math.PI * 2;
        const s = weite * a * rnd();
        x += Math.cos(winkel) * s;
        y += Math.sin(winkel) * s;
        // Sog: den Hang der Auslenkung hinab
        if (w.sog > 0) {
          const gx = A(x + h, y) - A(x - h, y);
          const gy = A(x, y + h) - A(x, y - h);
          x -= gx * w.sog * dt;
          y -= gy * w.sog * dt;
        }
      }
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        if (w.rand === "fallen") {
          x = rnd();
          y = rnd();
        } else {
          x = Math.min(1, Math.max(0, x));
          y = Math.min(1, Math.max(0, y));
        }
      }
      lage[k] = x;
      lage[k + 1] = y;
    }
  }

  return { lage, streue, schritt, anzahl };
}
