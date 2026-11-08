// Rechnen im hyperbolischen Raum H³, im Hyperboloid-Modell.
//
// H³ lässt sich nicht verzerrungsfrei in unseren Raum legen (wie eine Kugel nicht ohne Verzerrung auf ein flaches
// Blatt passt). Man rechnet darum in einem vierdimensionalen Raum mit einem anderen Skalarprodukt, dem von
// Minkowski (wie in der Relativitätstheorie):
//   ⟨a, b⟩ = a.x·b.x + a.y·b.y + a.z·b.z − a.w·b.w
// Die Punkte von H³ sind die p mit ⟨p, p⟩ = −1 und p.w > 0 (eine Schale, das „Hyperboloid“). Der Ursprung ist
// (0, 0, 0, 1). Alles, was man in der Euklidischen Geometrie mit cos und sin rechnet, geht hier mit cosh und sinh:
//   Gerade (Geodäte) vom Punkt p in Richtung d:  p(t) = cosh(t)·p + sinh(t)·d     (d mit ⟨d, d⟩ = 1, ⟨p, d⟩ = 0)
//   Ebene mit Normale n (⟨n, n⟩ = 1):            Abstand eines Punkts p = asinh(⟨p, n⟩)
//   Spiegeln an dieser Ebene:                    p ← p − 2⟨p, n⟩·n
// Bewegungen (Lorentz-Transformationen) erhalten ⟨ , ⟩, so wie Drehungen die Länge erhalten.

export const mink = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const mal = (v, s) => v.map((x) => x * s);
const plus = (a, b) => a.map((x, i) => x + b[i]);

// ---------- Kacheln (Waben) ----------
// Ein Körper mit Flächen in Richtung u_i (Einheitsvektoren), jede Fläche im Abstand r vom Mittelpunkt:
//   n_i = (cosh r · u_i, sinh r)        (dann ist ⟨n_i, n_i⟩ = 1 und der Punkt (sinh r · u_i, cosh r) liegt auf ihr)
// Der Winkel α zwischen zwei benachbarten Flächen folgt aus ⟨n_1, n_2⟩ = −cos α, und
//   ⟨n_1, n_2⟩ = cosh²r · cos γ − sinh²r      (γ: Winkel zwischen u_1 und u_2)
// Soll α genau 360° / k sein (k Körper um jede Kante), gibt das r:
//   sinh²r = (cos α + cos γ) / (1 − cos γ)
// Würfel: γ = 90°, cos γ = 0. Dodekaeder: Nachbarflächen liegen um γ mit cos γ = 1/√5 auseinander.
// Im flachen Raum passen genau 4 Würfel um eine Kante (90°). Mehr geht nur, wenn der Raum gekrümmt ist: im
// hyperbolischen werden die Körper „größer innen als außen“, ihre Winkel kleiner, und es passen mehr um eine Kante.
const PHI = (1 + Math.sqrt(5)) / 2;
function richtungen(koerper) {
  if (koerper === "wuerfel") return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Dodekaeder: die Mittelpunkte seiner 12 Flächen zeigen auf die Ecken eines Ikosaeders: (0, ±1, ±φ) zyklisch
  const liste = [];
  for (const a of [1, -1]) for (const b of [PHI, -PHI]) liste.push([0, a, b], [a, b, 0], [b, 0, a]);
  return liste.map((v) => mal(v, 1 / Math.hypot(...v)));
}
export const WABEN = {
  "5,3,4": { name: "Dodekaeder, 4 um jede Kante", koerper: "dodekaeder", k: 4 },
  "4,3,5": { name: "Würfel, 5 um jede Kante", koerper: "wuerfel", k: 5 },
  "5,3,5": { name: "Dodekaeder, 5 um jede Kante", koerper: "dodekaeder", k: 5 },
  "4,3,4": { name: "Würfel, 4 um jede Kante (flach, zum Vergleich)", koerper: "wuerfel", k: 4, flach: true },
};
// Normalen der Flächen (je vec4) für den Shader
export function flaechen(schluessel) {
  const w = WABEN[schluessel];
  const u = richtungen(w.koerper);
  if (w.flach) return { flach: true, normalen: u.map((v) => [...v, 0]), r: 1 };
  const cosG = w.koerper === "wuerfel" ? 0 : 1 / Math.sqrt(5);
  const cosA = Math.cos((2 * Math.PI) / w.k);
  const r = Math.asinh(Math.sqrt((cosA + cosG) / (1 - cosG)));
  return { flach: false, normalen: u.map((v) => [...mal(v, Math.cosh(r)), Math.sinh(r)]), r };
}

// ---------- Kamera ----------
// Die Kamera ist ein Rahmen aus vier Vektoren: rechts, oben, vorn (Richtungen, ⟨v, v⟩ = 1) und ihr Ort (⟨p, p⟩ = −1).
// Im flachen Raum dasselbe mit dem üblichen Skalarprodukt und dem Ort (x, y, z, 1).
export function neueKamera() {
  return { rechts: [1, 0, 0, 0], oben: [0, 1, 0, 0], vorn: [0, 0, 1, 0], ort: [0, 0, 0, 1], paritaet: 0 };
}
const drehe = (a, b, w) => [plus(mal(a, Math.cos(w)), mal(b, -Math.sin(w))), plus(mal(a, Math.sin(w)), mal(b, Math.cos(w)))];
// umsehen: gieren (um „oben“) und nicken (um „rechts“); geht in beiden Räumen gleich
export function schaue(k, gier, nick) {
  [k.rechts, k.vorn] = drehe(k.rechts, k.vorn, gier);
  [k.oben, k.vorn] = drehe(k.oben, k.vorn, nick);
}
// gehen: s Einheiten in Richtung „richtung“ (ein Feld der Kamera). Hyperbolisch: der Ort wandert die Geodäte
// entlang, die Richtung dreht sich mit (cosh/sinh statt 1/s); flach: einfach dazuzählen
export function gehe(k, richtung, s, flach) {
  const v = k[richtung];
  if (flach) {
    k.ort = plus(k.ort, mal(v, s));
    return;
  }
  const ort = plus(mal(k.ort, Math.cosh(s)), mal(v, Math.sinh(s)));
  k[richtung] = plus(mal(k.ort, Math.sinh(s)), mal(v, Math.cosh(s)));
  k.ort = ort;
}
// Rechnungsfehler wegräumen (Gram-Schmidt mit dem passenden Skalarprodukt), sonst driftet der Rahmen
export function richteAus(k, flach) {
  if (flach) {
    k.ort[3] = 1;
    for (const n of ["rechts", "oben", "vorn"]) k[n][3] = 0;
  } else {
    k.ort = mal(k.ort, 1 / Math.sqrt(-mink(k.ort, k.ort)));
  }
  const fertig = [];
  for (const n of ["vorn", "oben", "rechts"]) {
    let v = k[n];
    if (!flach) v = plus(v, mal(k.ort, mink(v, k.ort))); // senkrecht zum Ort machen (in den Tangentialraum)
    for (const f of fertig) v = plus(v, mal(f, -mink(v, f)));
    k[n] = mal(v, 1 / Math.sqrt(mink(v, v)));
    fertig.push(k[n]);
  }
}
// Hat die Kamera ihre Zelle verlassen, wird sie zurückgeholt. Hyperbolisch: an der Fläche gespiegelt (die Waben
// sehen von jeder Zelle aus gleich aus, also ändert sich das Bild nicht, nur die Zahlen bleiben klein; ohne das
// wüchsen sie wie cosh der zurückgelegten Strecke, und nach 30 Einheiten wäre die Genauigkeit weg). Flach: um
// eine Zellbreite verschoben. Die Parität (gerade oder ungerade Zahl Spiegelungen) braucht der Shader für die
// zwei Farben der Zellen.
export function holeZurueck(k, f) {
  for (let runde = 0; runde < 4; runde++) {
    let schlimmste = -1;
    let wert = 0;
    f.normalen.forEach((n, i) => {
      const d = f.flach ? mink(k.ort, n) - 1 : mink(k.ort, n);
      if (d > wert) {
        wert = d;
        schlimmste = i;
      }
    });
    if (schlimmste < 0) return;
    const n = f.normalen[schlimmste];
    if (f.flach) {
      k.ort = plus(k.ort, mal(n, -2));
    } else {
      for (const name of ["rechts", "oben", "vorn", "ort"]) k[name] = plus(k[name], mal(n, -2 * mink(k[name], n)));
    }
    k.paritaet ^= 1;
  }
}
