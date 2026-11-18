// Das Medium der Wanne, auf der CPU gemalt: Wände, Glas (langsamer: Brechzahl n) und der Schwamm am Rand.
// Zwei unsichtbare Leinwände so groß wie das Gitter, eine für Wände, eine für Glas; daraus wird die Textur für
// wanne.js zusammengesetzt: R = Wand (255), G = n / 3 (n = 1 außerhalb von Glas), B = Dämpfung.
//
// Schwamm: im Streifen der Breite S am Rand (8 % der kürzeren Seite, mindestens 24 Zellen) steigt die Dämpfung
// quadratisch an, d = 0,1 · ((S − Abstand) / S)². Langsam ansteigend, weil schon ein plötzlicher Sprung in der
// Dämpfung wie eine Wand wirkt und zurückwirft. Die Zahlen sind ausprobiert (wanne.js: 0,1 % Energie bleiben).

export function erstelleMedium() {
  const wand = document.createElement("canvas"), glas = document.createElement("canvas");
  const gw = wand.getContext("2d", { willReadFrequently: true }), gg = glas.getContext("2d", { willReadFrequently: true });
  let B = 0, H = 0, n = 1.5;

  function groesse(b, h) {
    B = wand.width = glas.width = b;
    H = wand.height = glas.height = h;
    leeren();
  }
  function leeren() {
    gw.clearRect(0, 0, B, H);
    gg.clearRect(0, 0, B, H);
  }

  // Pinsel: x, y von 0 bis 1 (y oben 0), r in Gitterzellen; art "wand", "glas" oder "radieren"
  function male(art, x0, y0, x1, y1, r) {
    const ziele = art === "radieren" ? [gw, gg] : [art === "glas" ? gg : gw];
    for (const g of ziele) {
      g.globalCompositeOperation = art === "radieren" ? "destination-out" : "source-over";
      g.strokeStyle = g.fillStyle = "#fff";
      g.lineWidth = 2 * r;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(x0 * B, y0 * H);
      g.lineTo(x1 * B, y1 * H);
      g.stroke();
      g.globalCompositeOperation = "source-over";
    }
  }
  // für die Vorlagen: direkter Zugriff auf beide Leinwände (Koordinaten in Zellen)
  const zeichner = () => ({ wand: gw, glas: gg, B, H });

  function textur() {
    const w = gw.getImageData(0, 0, B, H).data, g = gg.getImageData(0, 0, B, H).data;
    const d = new Uint8Array(B * H * 4);
    const S = Math.max(24, Math.round(0.08 * Math.min(B, H)));
    const nWert = Math.round((n / 3) * 255), eins = Math.round(255 / 3);
    for (let y = 0; y < H; y++) {
      const zeile = (H - 1 - y) * B; // WebGL zählt Zeilen von unten
      for (let x = 0; x < B; x++) {
        const i = (y * B + x) * 4, o = (zeile + x) * 4;
        d[o] = w[i + 3] > 127 ? 255 : 0;
        d[o + 1] = g[i + 3] > 127 ? nWert : eins;
        const rand = Math.min(x, y, B - 1 - x, H - 1 - y);
        d[o + 2] = rand < S ? Math.round(0.1 * ((S - rand) / S) ** 2 * 255) : 0;
      }
    }
    return d;
  }

  // ist an dieser Stelle (0 … 1) eine Wand? (für Quellen: nicht in die Wand setzen)
  const istWand = (x, y) => gw.getImageData(Math.floor(x * B), Math.floor(y * H), 1, 1).data[3] > 127;

  return { groesse, leeren, male, zeichner, textur, istWand, setzeBrechzahl: (v) => (n = v), wand, glas };
}
