// Histogramm: wie oft jeder Wert vorkommt. Daraus liest man ab, wo Gewebe liegen (jede Gewebeart ist ein Berg: bei
// CT Luft bei −1000, Fett um −100, Weichteile um 40, Knochen als langer flacher Schwanz) und wohin die Punkte der
// Kurve gehören. Gezeichnet wird es logarithmisch, sonst sieht man neben dem riesigen Berg „Luft“ nichts.
//
// Perzentil p: der Wert, unter dem der Anteil p aller Werte liegt (0,5 = Median). „nurVordergrund“: ohne den
// Hintergrund (bei MRT ist der größte Teil des Bildes dunkle Luft um den Kopf, die würde alles verschieben).
// Als Hintergrund gilt alles bis zum Ende des ersten (dunkelsten) Bergs.
//
// Bei großen Volumen wird nur jeder k-te Wert gezählt (höchstens etwa 4 Millionen): für die Form reicht das.

export function histogramm(v, faecher = 512) {
  const zahlen = new Float64Array(faecher);
  const lo = v.min;
  const hi = v.max > v.min ? v.max : v.min + 1;
  const skal = (faecher - 1) / (hi - lo);
  const n = v.werte.length;
  const schritt = Math.max(1, Math.floor(n / 4e6));
  for (let i = 0; i < n; i += schritt) {
    const w = v.werte[i];
    if (Number.isFinite(w)) zahlen[Math.round((w - lo) * skal)]++;
  }
  // Ende des Hintergrunds: vom dunkelsten Berg aus bis zum ersten Tal (weniger als 20 % des Gipfels und nicht mehr
  // fallend), höchstens bis zur Mitte. Gesucht wird in einer geglätteten Fassung: ganzzahlige Daten mit kleinem
  // Wertebereich füllen sonst nur jedes zweite Fach, und jedes leere Fach sähe aus wie ein Tal.
  const breite = Math.max(2, Math.round(faecher / 60));
  const glatt = new Float64Array(faecher);
  for (let i = 0; i < faecher; i++) {
    let s = 0;
    let k = 0;
    for (let j = Math.max(0, i - breite); j <= Math.min(faecher - 1, i + breite); j++, k++) s += zahlen[j];
    glatt[i] = s / k;
  }
  let gipfel = 0;
  for (let i = 1; i < faecher / 4; i++) if (glatt[i] > glatt[gipfel]) gipfel = i;
  let grenze = gipfel;
  while (grenze < faecher / 2 && !(glatt[grenze] < glatt[gipfel] * 0.2 && glatt[grenze] <= glatt[grenze + 1])) grenze++;
  const summe = (ab) => zahlen.slice(ab).reduce((a, b) => a + b, 0);
  const alle = summe(0);
  const vorne = summe(grenze);
  const wert = (fach) => lo + fach / skal;
  return {
    zahlen,
    lo,
    hi,
    wert,
    fach: (w) => (w - lo) * skal,
    perzentil(p, nurVordergrund = false) {
      const ab = nurVordergrund && vorne > alle * 0.02 ? grenze : 0;
      const ziel = p * (nurVordergrund && vorne > alle * 0.02 ? vorne : alle);
      let s = 0;
      for (let i = ab; i < faecher; i++) {
        s += zahlen[i];
        if (s >= ziel) return wert(i);
      }
      return hi;
    },
  };
}
