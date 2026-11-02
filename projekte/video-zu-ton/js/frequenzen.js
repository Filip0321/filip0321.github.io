// Welche Zeile welchen Ton spielt, und wo im Bild jede Zeile liegt. Reine Rechnung.
//
// Tonhöhe: logarithmisch zwischen tief und hoch (jede Oktave gleich viele Zeilen), dann wahlweise
//   auf eine Tonleiter gerastet (der nächste Ton der Leiter), um Halbtöne verschoben (Strich für Strich,
//   so werden mehrere Striche zum Akkord) und einzelne Zeilen von Hand festgelegt.
//
// Lage (Zeilendichte): normal sind alle Zeilen gleich hoch. „Nach Bild“ legt mehr Zeilen dorthin, wo im
//   Bild viel passiert: Das Profil (wie viel ist in jedem Streifen des Bildes los) wird wie eine Verteilung
//   behandelt, und die Grenzen der Zeilen liegen bei gleichen Anteilen davon (Quantile). Die Tonhöhen
//   bleiben gleichmäßig, nur ihr Platz im Bild ändert sich: dort, wo viel los ist, werden die Schritte
//   zwischen den Tönen im Bild kleiner, man hört dort also feiner hin.

export const TONLEITERN = {
  aus: null,
  chromatisch: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  dur: [0, 2, 4, 5, 7, 9, 11],
  moll: [0, 2, 3, 5, 7, 8, 10],
  "pentatonik-dur": [0, 2, 4, 7, 9],
  "pentatonik-moll": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  ganzton: [0, 2, 4, 6, 8, 10],
};

const zuMidi = (f) => 69 + 12 * Math.log2(f / 440);
const zuHz = (m) => 440 * 2 ** ((m - 69) / 12);

// der nächste Ton der Leiter (grundton 0 = C, 9 = A)
function raste(f, leiter, grundton) {
  const m = zuMidi(f);
  let beste = Math.round(m);
  let abstand = Infinity;
  for (let kandidat = Math.floor(m) - 6; kandidat <= Math.ceil(m) + 6; kandidat++) {
    const stufe = (((kandidat - grundton) % 12) + 12) % 12;
    if (!leiter.includes(stufe)) continue;
    if (Math.abs(kandidat - m) < abstand) {
      abstand = Math.abs(kandidat - m);
      beste = kandidat;
    }
  }
  return zuHz(beste);
}

// eigene: Map(zeile -> Hz), gilt vor dem Verschieben (so wandert eine festgelegte Zeile im Akkord mit)
export function zeilenFrequenzen({ zeilen, tief, hoch, tonleiter = "aus", grundton = 0, halbtoene = 0, eigene = new Map() }) {
  const leiter = TONLEITERN[tonleiter];
  const faktor = 2 ** (halbtoene / 12);
  const f = new Float32Array(zeilen);
  for (let z = 0; z < zeilen; z++) {
    let wert = tief * (hoch / tief) ** (z / Math.max(1, zeilen - 1));
    if (leiter) wert = raste(wert, leiter, grundton);
    if (eigene.has(z)) wert = eigene.get(z);
    f[z] = Math.min(wert * faktor, 23000); // nie über die halbe Abtastrate (sonst klingt es falsch zurück)
  }
  return f;
}

// Grenzen der Zeilen längs des Strichs, je (unten, oben) von 0 bis 1.
// profil: wie viel in jedem gleich großen Stück des Bildes los ist (oder null); nachBild: 0 bis 1,
// wie stark das Profil zählt (0 = alle Zeilen gleich groß)
export function zeilenGrenzen(zeilen, profil = null, nachBild = 0) {
  const grenzen = new Float32Array(2 * zeilen);
  if (!profil || nachBild <= 0) {
    for (let z = 0; z < zeilen; z++) {
      grenzen[2 * z] = z / zeilen;
      grenzen[2 * z + 1] = (z + 1) / zeilen;
    }
    return grenzen;
  }
  // Gewicht pro Stück: gleichmäßig gemischt mit dem Profil (sonst bekäme ein leeres Stück gar keine Zeile)
  const n = profil.length;
  const summeProfil = profil.reduce((a, b) => a + b, 0) || 1;
  const gewicht = Array.from(profil, (p) => (1 - nachBild) / n + (nachBild * p) / summeProfil);
  // aufsummiert (Verteilung), dann die Stellen, an denen 1/zeilen, 2/zeilen … erreicht sind
  const stellen = [0];
  let summe = 0;
  let i = 0;
  for (let z = 1; z < zeilen; z++) {
    const ziel = z / zeilen;
    while (i < n && summe + gewicht[i] < ziel) summe += gewicht[i++];
    const innen = i < n ? (ziel - summe) / gewicht[i] : 1; // wie weit im Stück i
    stellen.push(Math.min(1, (i + innen) / n));
  }
  stellen.push(1);
  for (let z = 0; z < zeilen; z++) {
    grenzen[2 * z] = stellen[z];
    grenzen[2 * z + 1] = stellen[z + 1];
  }
  return grenzen;
}

// Dreiklang auf diesem Ton: die übernächste und die vierte Stufe der Leiter darüber
// (in Dur auf C: C, E, G). Ohne Tonleiter: ein Dur-Dreiklang (4 und 7 Halbtöne).
export function akkord(f, tonleiter = "aus", grundton = 0) {
  const leiter = TONLEITERN[tonleiter];
  const m = Math.round(zuMidi(f));
  if (!leiter || leiter.length < 5 || leiter.length === 12) return [f, f * 2 ** (4 / 12), f * 2 ** (7 / 12)];
  const toene = [m];
  for (let k = m + 1; toene.length < 5; k++) {
    if (leiter.includes((((k - grundton) % 12) + 12) % 12)) toene.push(k);
  }
  return [f, zuHz(toene[2]) * (f / zuHz(m)), zuHz(toene[4]) * (f / zuHz(m))]; // Verstimmung von f mitnehmen
}
