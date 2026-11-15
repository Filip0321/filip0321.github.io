// Kamera: kreist um einen Punkt (ziel) mit Gierwinkel (links, rechts), Nickwinkel (hoch, runter) und Abstand.
// Daraus die Ansichtsmatrix (Welt → Kamera, Kamera schaut nach −z, y oben) und die Projektion (Perspektive).
//
// Zwei Arten, sie zu bewegen:
//   frei      ziehen dreht, Mausrad zoomt, mit Umschalt (oder zwei Fingern) ziehen verschiebt
//   parallax  wie ein Blick ins Zimmer durch ein Fenster: die Kamera steht fest und weicht nur ein wenig aus, wenn
//             sich die Maus bewegt oder das Handy gekippt wird. So sieht man die Tiefe, ohne sich zu verlaufen
//             (das ist die Art für eine Startseite)

export function erstelleKamera({ ziel = [0, 0, 0], gier = 0, nick = 0, abstand = 3, sichtfeld = 60 } = {}) {
  const k = {
    ziel: [...ziel], gier, nick, abstand, sichtfeld,
    // Ausweichen für die Parallaxe (wird zum Winkel addiert, nicht gespeichert)
    extraGier: 0, extraNick: 0,
    ansicht: new Float32Array(16),
    projektion: new Float32Array(16),
    fokus: 1,
    auge: [0, 0, 0],
  };

  // breite, hoehe: Pixel des Bildes
  k.rechne = (breite, hoehe) => {
    const g = k.gier + k.extraGier, n = Math.max(-1.5, Math.min(1.5, k.nick + k.extraNick));
    // Auge auf einer Kugel um das Ziel
    const vorn = [Math.cos(n) * Math.sin(g), Math.sin(n), Math.cos(n) * Math.cos(g)]; // vom Ziel zum Auge
    k.auge = [0, 1, 2].map((i) => k.ziel[i] + vorn[i] * k.abstand);
    schaueAuf(k.ansicht, k.auge, k.ziel);
    const f = 1 / Math.tan((k.sichtfeld * Math.PI) / 360);
    const nah = 0.02, fern = 1000;
    k.projektion.fill(0);
    k.projektion[0] = f / (breite / hoehe);
    k.projektion[5] = f;
    k.projektion[10] = (fern + nah) / (nah - fern);
    k.projektion[11] = -1;
    k.projektion[14] = (2 * fern * nah) / (nah - fern);
    k.fokus = (f * hoehe) / 2; // Brennweite in Pixeln
  };

  // ein Punkt der Welt auf dem Bildschirm (Pixel, y unten) oder null, wenn er hinter der Kamera liegt
  k.aufBildschirm = (p, breite, hoehe) => {
    const m = k.ansicht;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    if (z > -0.05) return null;
    return { x: breite / 2 + (k.fokus * x) / -z, y: hoehe / 2 - (k.fokus * y) / -z, tiefe: -z };
  };

  // Strahl durch ein Pixel (für das Auswählen im Bearbeiten-Modus): Anfang und Richtung in Weltkoordinaten
  k.strahl = (px, py, breite, hoehe) => {
    const m = k.ansicht;
    const d = [(px - breite / 2) / k.fokus, -(py - hoehe / 2) / k.fokus, -1];
    // Kamera → Welt: transponierte Drehung
    const r = [0, 1, 2].map((i) => m[4 * i] * d[0] + m[4 * i + 1] * d[1] + m[4 * i + 2] * d[2]);
    const l = Math.hypot(...r);
    return { anfang: k.auge, richtung: r.map((v) => v / l) };
  };

  return k;
}

// Ansichtsmatrix (Spalten zuerst) für ein Auge, das auf ein Ziel schaut, y oben
function schaueAuf(m, auge, ziel) {
  let z = [auge[0] - ziel[0], auge[1] - ziel[1], auge[2] - ziel[2]];
  z = norm(z);
  let x = norm(kreuz([0, 1, 0], z));
  if (!isFinite(x[0])) x = [1, 0, 0];
  const y = kreuz(z, x);
  m.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -punkt(x, auge), -punkt(y, auge), -punkt(z, auge), 1]);
}
const kreuz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const punkt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a);
  return a.map((v) => v / l);
};
