// Kamera: kreist um einen Punkt (ziel) mit Gierwinkel (links, rechts), Nickwinkel (hoch, runter) und Abstand.
// Daraus die Ansichtsmatrix (Welt → Kamera, Kamera schaut nach −z, y oben) und die Projektion (Perspektive).
//
// Zwei Arten, sie zu bewegen:
//   frei      ziehen dreht, Mausrad zoomt, mit Umschalt (oder zwei Fingern) ziehen verschiebt
//   parallax  wie ein Blick ins Zimmer durch ein Fenster: die Kamera steht fest und weicht nur ein wenig aus, wenn
//             sich die Maus bewegt oder das Handy gekippt wird. So sieht man die Tiefe, ohne sich zu verlaufen
//             (das ist die Art für eine Startseite)
//   rundblick man steht im Mittelpunkt des Zimmers und dreht sich: dieselbe Kamera, nur mit Abstand fast 0 (das
//             Auge sitzt dann im Ziel, Gier und Nick drehen den Blick um es herum); zoomen über das Sichtfeld
//   oben      Draufsicht für den Grundriss: senkrecht von oben, Norden (−z) ist oben im Bild
//
// Orthografisch (ortho = true, nur im Bearbeiten-Modus, Tasten 1, 3, 7 wie in Blender): keine Perspektive, alles
// gleich groß, egal wie weit weg. Parallele Kanten bleiben parallel, Abstände lassen sich ablesen; so setzt man Ecken
// genau. Ein Punkt (x, y) in Kamerakoordinaten landet bei s · x Pixeln neben der Bildmitte, mit s = Brennweite /
// Abstand (so bleibt beim Umschalten das Ziel gleich groß). Das Auge steht dafür weit hinten (100 m), damit nichts
// vor der Kamera abgeschnitten wird; wie viel man sieht, regelt nur s.

export function erstelleKamera({ ziel = [0, 0, 0], gier = 0, nick = 0, abstand = 3, sichtfeld = 60 } = {}) {
  const k = {
    ziel: [...ziel], gier, nick, abstand, sichtfeld,
    // Ausweichen für die Parallaxe (wird zum Winkel addiert, nicht gespeichert)
    extraGier: 0, extraNick: 0,
    // Bildmitte verschieben (−1 bis 1, wie die Bildschirmkoordinaten von WebGL): der Blick bleibt, nur die Stelle,
    // an der die Blickachse auf dem Bild landet, rückt zur Seite. Wie ein Shift-Objektiv: so kann ein Gegenstand
    // links im Bild stehen und rechts ist Platz für seinen Text, ohne dass die Kamera schräg auf ihn schaut
    versatzX: 0, versatzY: 0,
    ortho: false,
    ansicht: new Float32Array(16),
    projektion: new Float32Array(16),
    fokus: 1,
    auge: [0, 0, 0],
  };

  // breite, hoehe: Pixel des Bildes
  k.rechne = (breite, hoehe) => {
    if (k.oben) {
      // senkrecht von oben: „oben“ im Bild ist −z (bei y nach oben gibt es sonst keine eindeutige Richtung)
      k.auge = [k.ziel[0], k.ziel[1] + k.abstand, k.ziel[2]];
      schaueAuf(k.ansicht, k.auge, k.ziel, [0, 0, -1]);
    } else {
      // senkrecht von oben oder unten (± 90°) nur im orthografischen Bild (Taste 7 im Bearbeiten-Modus)
      const grenze = k.ortho ? Math.PI / 2 : 1.5;
      const g = k.gier + k.extraGier, n = Math.max(-grenze, Math.min(grenze, k.nick + k.extraNick));
      // Auge auf einer Kugel um das Ziel
      const vorn = [Math.cos(n) * Math.sin(g), Math.sin(n), Math.cos(n) * Math.cos(g)]; // vom Ziel zum Auge
      k.auge = [0, 1, 2].map((i) => k.ziel[i] + vorn[i] * (k.ortho ? 100 : k.abstand));
      // Abstand fast 0 (Rundblick): Auge und Ziel fielen zusammen, die Blickrichtung wäre unbestimmt; darum
      // schaut das Auge dann auf einen Punkt in der Gegenrichtung
      // genau von oben oder unten gibt es kein „oben“ (y fällt mit der Blickrichtung zusammen): dann ist oben im Bild
      // die Richtung, in die die Gier zeigt (bei Gier 0 also −z, wie in der Draufsicht)
      const steil = Math.abs(Math.sin(n)) > 0.999;
      const oben = steil ? [-Math.sin(g) * Math.sign(n), 0, -Math.cos(g) * Math.sign(n)] : [0, 1, 0];
      schaueAuf(k.ansicht, k.auge, k.abstand < 1e-3 ? k.auge.map((a, i) => a - vorn[i]) : k.ziel, oben);
    }
    // Sichtfeld: bisher galt es für die Höhe. Dann sieht man quer mehr, je breiter das Bild ist: ein Handy quer
    // (etwa 2,2 : 1) zeigt waagerecht fast 120°, hochkant nur knapp 40°. Jetzt gilt es für die LANGE Seite, so
    // als wäre das Bild 16 : 9 und das Sichtfeld seine Höhe. Ein 16:9-Bildschirm sieht damit genau aus wie vorher,
    // und ein Handy zeigt quer und hochkant dasselbe, nur gedreht (die Brennweite hängt nur noch von der langen
    // Seite ab).
    const lang = Math.max(breite, hoehe);
    k.fokus = lang / 2 / (Math.tan((k.sichtfeld * Math.PI) / 360) * (16 / 9)); // Brennweite in Pixeln
    const nah = 0.02, fern = 1000;
    k.projektion.fill(0);
    if (k.ortho) {
      // x_ndc = 2 s x / Breite + Versatz; z linear zwischen nah und fern
      k.massstab = k.fokus / Math.max(1e-3, k.abstand); // Pixel pro Meter
      k.projektion[0] = (2 * k.massstab) / breite;
      k.projektion[5] = (2 * k.massstab) / hoehe;
      k.projektion[10] = -2 / (fern - nah);
      k.projektion[12] = k.versatzX;
      k.projektion[13] = k.versatzY;
      k.projektion[14] = -(fern + nah) / (fern - nah);
      k.projektion[15] = 1;
      return;
    }
    k.massstab = 0;
    k.projektion[0] = (2 * k.fokus) / breite;
    k.projektion[5] = (2 * k.fokus) / hoehe;
    // Versatz: x_ndc = (P0·x + P8·z) / −z = P0·x / −z − P8, also P8 = −Versatz (ebenso y mit P9)
    k.projektion[8] = -k.versatzX;
    k.projektion[9] = -k.versatzY;
    k.projektion[10] = (fern + nah) / (nah - fern);
    k.projektion[11] = -1;
    k.projektion[14] = (2 * fern * nah) / (nah - fern);
  };

  // ein Punkt der Welt auf dem Bildschirm (Pixel, y unten) oder null, wenn er hinter der Kamera liegt
  k.aufBildschirm = (p, breite, hoehe) => {
    const m = k.ansicht;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    if (z > -0.05) return null;
    // tiefe: im orthografischen Bild die Tiefe, bei der die Perspektive denselben Maßstab hätte (für Größen in Pixeln)
    if (k.ortho) return { x: (breite / 2) * (1 + k.versatzX) + k.massstab * x, y: (hoehe / 2) * (1 - k.versatzY) - k.massstab * y, tiefe: k.fokus / k.massstab, echt: -z };
    return {
      x: (breite / 2) * (1 + k.versatzX) + (k.fokus * x) / -z,
      y: (hoehe / 2) * (1 - k.versatzY) - (k.fokus * y) / -z,
      tiefe: -z,
      echt: -z,
    };
  };

  // Richtung (Gier, Nick), in die die Kamera schauen muss, damit p in der Bildmitte liegt (für Rundblick und Fahrt)
  k.richtungZu = (p) => {
    const d = [k.auge[0] - p[0], k.auge[1] - p[1], k.auge[2] - p[2]]; // „vorn“ zeigt vom Ziel zum Auge
    const l = Math.hypot(...d) || 1;
    return { gier: Math.atan2(d[0], d[2]), nick: Math.asin(d[1] / l), abstand: l };
  };

  // Strahl durch ein Pixel (für das Auswählen im Bearbeiten-Modus): Anfang und Richtung in Weltkoordinaten
  k.strahl = (px, py, breite, hoehe) => {
    const m = k.ansicht;
    if (k.ortho) {
      // alle Strahlen parallel (Blickrichtung), der Anfang wandert mit dem Pixel über die Bildebene
      const dx = (px - (breite / 2) * (1 + k.versatzX)) / k.massstab, dy = -(py - (hoehe / 2) * (1 - k.versatzY)) / k.massstab;
      const anfang = [0, 1, 2].map((i) => k.auge[i] + m[4 * i] * dx + m[4 * i + 1] * dy);
      return { anfang, richtung: [-m[2], -m[6], -m[10]] };
    }
    const d = [(px - (breite / 2) * (1 + k.versatzX)) / k.fokus, -(py - (hoehe / 2) * (1 - k.versatzY)) / k.fokus, -1];
    // Kamera → Welt: transponierte Drehung
    const r = [0, 1, 2].map((i) => m[4 * i] * d[0] + m[4 * i + 1] * d[1] + m[4 * i + 2] * d[2]);
    const l = Math.hypot(...r);
    return { anfang: k.auge, richtung: r.map((v) => v / l) };
  };

  // Blickrichtungen der Kamera in Weltkoordinaten (Zeilen der Ansichtsmatrix): rechts, oben, nach vorn ins Bild
  k.achsen = () => {
    const m = k.ansicht;
    return { rechts: [m[0], m[4], m[8]], oben: [m[1], m[5], m[9]], vorwaerts: [-m[2], -m[6], -m[10]] };
  };

  return k;
}

// Ansichtsmatrix (Spalten zuerst) für ein Auge, das auf ein Ziel schaut; oben: welche Richtung im Bild oben ist
function schaueAuf(m, auge, ziel, oben = [0, 1, 0]) {
  let z = [auge[0] - ziel[0], auge[1] - ziel[1], auge[2] - ziel[2]];
  z = norm(z);
  let x = norm(kreuz(oben, z));
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
