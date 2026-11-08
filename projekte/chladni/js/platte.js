// Die schwingende Platte: Eigenformen (Moden) und wie stark jede bei einer Frequenz mitschwingt.
//
// Eine dünne Platte schwingt nicht beliebig, sondern in Eigenformen φ_nm mit eigener Frequenz f_nm. Wird sie an
// einer Stelle (x0, y0) mit der Frequenz f angeregt, ist die Auslenkung die Summe aller Moden (modale Überlagerung):
//
//   u(x, y) = Σ a_nm · φ_nm(x, y),   a_nm = φ_nm(x0, y0) · H(f, f_nm)
//
// H ist die Resonanzkurve eines gedämpften Schwingers (ζ = Dämpfung):
//
//   H = 2ζ · f_nm² / ((f_nm² − f²) + i · 2ζ · f_nm · f)
//
// so geteilt, dass |H| genau bei Resonanz 1 ist. Daneben fällt es schnell ab: je kleiner ζ, desto schärfer.
// Deshalb springt das Bild nur bei bestimmten Tönen in eine klare Figur, dazwischen bewegt sich die Platte kaum.
//
// Eigenformen eines Quadrats (Seite 1):
//   gestützt (Ränder liegen auf):   φ = sin(nπx) · sin(mπy),  f_nm = f0 · (n² + m²) / 2   (exakt nach Kirchhoff)
//   frei (Chladnis Platte):         φ = cos(nπx) · cos(mπy)   (eine Näherung: die echten freien Moden sind nicht
//                                   so einfach, aber die Figuren sehen sehr ähnlich aus; so rechnen die meisten)
// Bei der Plattengleichung (∇⁴ statt ∇²) wächst die Frequenz mit dem Quadrat der Wellenzahl, daher n² + m².
// (n, m) und (m, n) haben dieselbe Frequenz: sie schwingen zusammen, und wie sie sich mischen, hängt von der
// Anregungsstelle ab. Daraus entstehen die typischen Chladni-Figuren.

export const MAX_N = 20; // Moden bis n, m = 20
export const MAX_MODEN = 32; // so viele (die stärksten) gehen in den Shader

// alle Moden mit Frequenz; f0 = Frequenz der Mode (1, 1)
export function moden(rand, f0) {
  const liste = [];
  const start = rand === "frei" ? 0 : 1;
  for (let n = start; n <= MAX_N; n++) {
    for (let m = start; m <= MAX_N; m++) {
      if (n + m < 2) continue; // (0, 0) und (0, 1) / (1, 0) sind beim freien Rand Starrbewegungen
      liste.push({ n, m, f: (f0 * (n * n + m * m)) / 2 });
    }
  }
  return liste;
}

// die Frequenzen, bei denen etwas passiert (für die Auswahl „Resonanzen“), aufsteigend und ohne Doppelte.
// Nur Moden, die an der Anregungsstelle (x0, y0) nicht stillstehen: In der Mitte einer freien Platte ist cos(nπ/2)
// für ungerade n null, diese Moden bekommen dort keinen Stoß und bleiben aus
export function resonanzen(rand, f0, bis, x0, y0) {
  const gesehen = new Map();
  for (const { n, m, f } of moden(rand, f0)) {
    if (f > bis) continue;
    if (Math.abs(form(rand, n, m, x0, y0)) + Math.abs(form(rand, m, n, x0, y0)) < 0.1) continue;
    const schluessel = Math.round(f * 10);
    if (!gesehen.has(schluessel)) gesehen.set(schluessel, { f, paare: [] });
    if (n <= m) gesehen.get(schluessel).paare.push(`${n},${m}`);
  }
  return [...gesehen.values()].sort((a, b) => a.f - b.f);
}

function form(rand, n, m, x, y) {
  return rand === "frei" ? Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) : Math.sin(n * Math.PI * x) * Math.sin(m * Math.PI * y);
}

// die Koeffizienten a_nm (komplex) bei Frequenz f, Anregung an (x0, y0); nur die stärksten MAX_MODEN
// Rückgabe: Float32Array mit je [n, m, re, im] und die Zahl der Moden
export function koeffizienten(liste, rand, f, zeta, x0, y0) {
  const alle = [];
  for (const { n, m, f: fn } of liste) {
    const anregung = form(rand, n, m, x0, y0);
    if (Math.abs(anregung) < 1e-6) continue;
    // H = 2ζ fn² / ((fn² − f²) + i 2ζ fn f) = 2ζ fn² · (a − i b) / (a² + b²)
    const a = fn * fn - f * f;
    const b = 2 * zeta * fn * f;
    const nenner = a * a + b * b;
    const k = (2 * zeta * fn * fn * anregung) / nenner;
    alle.push([n, m, k * a, -k * b]);
  }
  alle.sort((p, q) => Math.hypot(q[2], q[3]) - Math.hypot(p[2], p[3]));
  const daten = new Float32Array(MAX_MODEN * 4);
  const anzahl = Math.min(MAX_MODEN, alle.length);
  for (let i = 0; i < anzahl; i++) daten.set(alle[i], i * 4);
  return { daten, anzahl, staerkste: alle[0] ? Math.hypot(alle[0][2], alle[0][3]) : 0 };
}
