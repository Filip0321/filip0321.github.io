// Rechnen mit Flächen im Raum: Mitte und Größe einer Fläche aus Punkten, Drehen um eine Achse, und die Abbildung
// eines Rechtecks auf ein beliebiges Viereck auf dem Bildschirm (für die Fenster: eine Webseite auf dem Fernseher).
//
// ---------- Homographie ----------
// Ein Rechteck (die Webseite, b × h Pixel) soll genau auf vier Punkte p0 … p3 auf dem Bildschirm fallen (die Ecken
// des Fernsehers, wie die Kamera sie sieht). Eine Verschiebung, Drehung und Scherung reicht dafür nicht: perspektivisch
// gesehen sind gegenüberliegende Kanten nicht mehr parallel. Das kann nur eine projektive Abbildung (Homographie):
//   x' = (a u + b v + c) / (g u + h v + 1),   y' = (d u + e v + f) / (g u + h v + 1)
// mit (u, v) im Einheitsquadrat. Die Teilung durch (g u + h v + 1) ist genau die Teilung durch die Tiefe, die eine
// Kamera macht: weiter entfernte Teile werden kleiner. Acht Unbekannte, vier Eckpunkte mit je x und y: das geht genau
// auf. Lösung nach Heckbert („Fundamentals of Texture Mapping and Image Warping“, 1989), Ecken in der Reihenfolge
// (0,0) → p0, (1,0) → p1, (1,1) → p2, (0,1) → p3:
//   Σx = x0 − x1 + x2 − x3, Σy ebenso. Sind beide 0, ist das Viereck ein Parallelogramm (g = h = 0, nur affin).
//   sonst: Δx1 = x1 − x2, Δx2 = x3 − x2 (y ebenso), det = Δx1 Δy2 − Δx2 Δy1
//          g = (Σx Δy2 − Δx2 Σy) / det,   h = (Δx1 Σy − Σx Δy1) / det
//   a = x1 − x0 + g x1,  b = x3 − x0 + h x3,  c = x0,   d = y1 − y0 + g y1,  e = y3 − y0 + h y3,  f = y0
// CSS kann genau das: transform: matrix3d(…) ist eine 4 × 4-Matrix mit Teilung durch w, und für einen Punkt (X, Y)
// des Elements (z = 0) bleibt davon übrig: x' = (m11 X + m21 Y + m41) / (m14 X + m24 Y + m44), y' ebenso mit m12, m22,
// m42. Mit u = X / b, v = Y / h:  m11 = a/b, m12 = d/b, m14 = g/b, m21 = b/h, m22 = e/h, m24 = h/h, m41 = c, m42 = f.
// Der Browser zeichnet das Element dann verzerrt, und Klicks und Scrollen gehen trotzdem an die richtige Stelle.

export function homographie(breite, hoehe, [p0, p1, p2, p3]) {
  const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  // matrix3d nimmt die Spalten nacheinander
  return `matrix3d(${a / breite},${d / breite},0,${g / breite},${b / hoehe},${e / hoehe},0,${h / hoehe},0,0,1,0,${c},${f},0,1)`;
}

// ---------- Punkte ----------
export const plus = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mal = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const punkt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const kreuz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const laenge = (a) => Math.hypot(a[0], a[1], a[2]);
export const einheit = (a) => mal(a, 1 / (laenge(a) || 1));

// Mitte: einfach der Mittelwert der Ecken (für die Mitte zum Drehen und das Ziel der Kamera reicht das; bei einem
// Viereck ist es genau der Schnitt der Mittellinien)
export function mitteVon(punkte) {
  const s = punkte.reduce(plus, [0, 0, 0]);
  return mal(s, 1 / punkte.length);
}

// Größe: Abstand der entferntesten Ecke von der Mitte (eine Kugel, die die ganze Fläche einschließt; für das
// Aufleuchten im Bild und den Abstand beim Zeigen)
export function radiusVon(punkte, mitte = mitteVon(punkte)) {
  return Math.max(...punkte.map((p) => laenge(minus(p, mitte))));
}

// Normale einer Fläche (senkrecht auf ihr): das Kreuzprodukt zweier Kanten eines Dreiecks aus drei Ecken. Welche
// drei? Die, deren Dreieck am größten ist: so ist das Ergebnis auch dann gut, wenn die Ecken in beliebiger Reihenfolge
// gesetzt wurden (bei einer „Fliege“ heben sich die Kreuzprodukte rundherum sonst auf) oder ein paar fast auf einer
// Linie liegen. Das Vorzeichen ist hier beliebig; wo es zählt, wird zum Auge hin gedreht.
export function normaleVon(punkte) {
  let beste = [0, 0, 0], groesst = 0;
  for (let i = 0; i < punkte.length; i++)
    for (let j = i + 1; j < punkte.length; j++)
      for (let k = j + 1; k < punkte.length; k++) {
        const c = kreuz(minus(punkte[j], punkte[i]), minus(punkte[k], punkte[i]));
        const l = laenge(c);
        if (l > groesst) [beste, groesst] = [c, l];
      }
  return einheit(beste);
}

// Punkt p um die Achse (durch m, Richtung a, Länge 1) um den Winkel w drehen, mit der Formel von Rodrigues:
//   v' = v cos w + (a × v) sin w + a (a · v)(1 − cos w)
export function dreheUm(p, m, a, w) {
  const v = minus(p, m);
  const c = Math.cos(w), s = Math.sin(w);
  return plus(m, plus(plus(mal(v, c), mal(kreuz(a, v), s)), mal(a, punkt(a, v) * (1 - c))));
}

// ---------- Flächen als Objekte: Ecken ordnen, Wölbung, Gitter für die Grafikkarte ----------

// Die vier Ecken so ordnen, wie man sie von vorn sieht: oben links, oben rechts, unten rechts, unten links.
// „Vorn“ ist die Seite der Fläche, auf der das Auge ist (die Normale zeigt zum Auge). „Oben“ ist die Senkrechte der
// Welt, flach in die Fläche gelegt (y minus seinem Anteil entlang der Normale); liegt die Fläche selbst waagerecht
// (Tischplatte), gibt es dieses Oben nicht, dann gilt die Richtung, die von der Kamera aus oben ist.
// Rechts = Oben × Normale (Rechte-Hand-Regel: schaut man gegen die Normale, zeigt das nach rechts).
// Dann jede Ecke als (a, b) in diesen Richtungen; oben links ist die mit dem größten b − a, und von dort geht es im
// Uhrzeigersinn weiter (fallender Winkel atan2(b, a)).
export function ordneEcken(punkte, auge, kameraOben = [0, 1, 0]) {
  const m = mitteVon(punkte);
  let n = normaleVon(punkte);
  if (punkt(n, minus(auge, m)) < 0) n = mal(n, -1);
  let oben = minus([0, 1, 0], mal(n, n[1]));
  if (laenge(oben) < 0.3) oben = minus(kameraOben, mal(n, punkt(kameraOben, n)));
  oben = einheit(oben);
  const rechts = kreuz(oben, n);
  const ab = punkte.slice(0, 4).map((p) => {
    const v = minus(p, m);
    return { p, a: punkt(v, rechts), b: punkt(v, oben) };
  });
  ab.sort((x, y) => Math.atan2(y.b, y.a) - Math.atan2(x.b, x.a));
  const start = ab.reduce((best, e, i) => (e.b - e.a > ab[best].b - ab[best].a ? i : best), 0);
  return { ecken: [0, 1, 2, 3].map((i) => ab[(start + i) % 4].p), normale: n, mitte: m };
}

// Punkt auf der (gewölbten) Fläche: bilinear zwischen den vier Ecken, dazu die Wölbung. Ein gebogener Monitor
// biegt sich in der Waagerechten: die Mitte liegt weiter hinten als die Ränder. Als Kurve reicht eine Parabel durch
// die beiden Ränder (bei so kleinen Biegungen ist sie vom Kreisbogen nicht zu unterscheiden):
//   Versatz(u) = −Wölbung · 4u(1 − u)   entlang der Normale (Wölbung in Metern, positiv: Mitte nach hinten)
// vor: die ganze Fläche um so viele Meter zum Betrachter ziehen (gegen das Flimmern mit den Splats darunter)
export function flaechenPunkt([tl, tr, br, bl], n, u, v, woelbung = 0, vor = 0) {
  const oben = plus(mal(tl, 1 - u), mal(tr, u)), unten = plus(mal(bl, 1 - u), mal(br, u));
  const p = plus(mal(oben, 1 - v), mal(unten, v));
  return plus(p, mal(n, vor - woelbung * 4 * u * (1 - u)));
}

// Dreiecke (x, y, z, u, v) für die Grafikkarte: 24 Streifen in der Waagerechten (wegen der Wölbung), einer senkrecht
export function gitter(ecken, n, woelbung = 0, vor = 0, spalten = 24) {
  const d = [];
  const ecke = (u, v) => [...flaechenPunkt(ecken, n, u, v, woelbung, vor), u, 1 - v];
  for (let i = 0; i < spalten; i++) {
    const u0 = i / spalten, u1 = (i + 1) / spalten;
    const a = ecke(u0, 0), b = ecke(u1, 0), c = ecke(u1, 1), e = ecke(u0, 1);
    d.push(...a, ...e, ...b, ...b, ...e, ...c);
  }
  return new Float32Array(d);
}

// „cover“ wie in CSS: das Bild füllt die Fläche ganz, was übersteht, wird gleichmäßig an beiden Seiten abgeschnitten.
// Ergebnis: Versatz und Größe des sichtbaren Teils in Bildkoordinaten (0 … 1)
export function ausschnitt(flaecheB, flaecheH, bildB, bildH) {
  const f = flaecheB / flaecheH, b = bildB / bildH;
  if (!isFinite(f) || !isFinite(b)) return [0, 0, 1, 1];
  return b > f ? [(1 - f / b) / 2, 0, f / b, 1] : [0, (1 - b / f) / 2, 1, b / f];
}

// Durchstößt die Strecke a → b die Fläche (Vieleck aus punkte)? Erst der Schnittpunkt mit ihrer Ebene
//   t = (n · (m − a)) / (n · (b − a)),  nur 0 ≤ t ≤ 1 zählt
// dann, ob er im Vieleck liegt: beide in die Ebene gelegt (zwei Richtungen u, v in ihr) und mit der Even-odd-Regel
// gezählt (wie beim Grundriss). Für das Herumgehen: Flächen sind Wände.
export function schneidetFlaeche(a, b, punkte) {
  const m = mitteVon(punkte), n = normaleVon(punkte);
  const d = minus(b, a), nenner = punkt(n, d);
  if (Math.abs(nenner) < 1e-9) return false;
  const t = punkt(n, minus(m, a)) / nenner;
  if (t < 0 || t > 1) return false;
  const q = plus(a, mal(d, t));
  const u = einheit(minus(punkte[1], punkte[0])), v = kreuz(n, u);
  const zwei = (p) => [punkt(minus(p, m), u), punkt(minus(p, m), v)];
  const [x, y] = zwei(q), ecken = punkte.map(zwei);
  let drin = false;
  for (let i = 0, j = ecken.length - 1; i < ecken.length; j = i++) {
    const [xi, yi] = ecken[i], [xj, yj] = ecken[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

// Schnittpunkt eines Strahls mit der Ebene einer Fläche (für das Setzen von Ecken auf Hilfsflächen); null, wenn er
// sie nicht trifft. innen: nur zählen, wenn der Punkt im Vieleck liegt.
export function strahlAufFlaeche(anfang, richtung, punkte, innen = true) {
  const weit = plus(anfang, mal(richtung, 1000));
  if (innen) {
    if (!schneidetFlaeche(anfang, weit, punkte)) return null;
  }
  const m = mitteVon(punkte), n = normaleVon(punkte), nenner = punkt(n, richtung);
  if (Math.abs(nenner) < 1e-9) return null;
  const t = punkt(n, minus(m, anfang)) / nenner;
  return t > 0 ? { punkt: plus(anfang, mal(richtung, t)), tiefe: t } : null;
}
