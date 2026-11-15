// Ein Zimmer aus Kästen, solange es noch keinen Scan gibt: Boden, drei Wände, Decke, ein Tisch mit Bildschirm,
// ein Regal mit Büchern, ein Röhrenfernseher, ein Lautsprecher. Nur zum Ausprobieren von Ansicht und Links;
// jede Fläche ist ein Gitter aus flachen Splats (dünn in Richtung der Normale), mit etwas Rauschen in der Farbe.

export function platzhalterZimmer() {
  const lage = [], kov = [], farbe = [];
  let zs = 7;
  const zufall = () => {
    zs = (zs * 16807) % 2147483647;
    return zs / 2147483647;
  };

  // Fläche: Ecke o, zwei Kanten a und b (entlang der Achsen), Farbe [r, g, b] (0 bis 255), Abstand der Splats
  function flaeche(o, a, b, f, schritt = 0.03, rauschen = 14) {
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    const na = Math.max(1, Math.round(la / schritt)), nb = Math.max(1, Math.round(lb / schritt));
    // Radien entlang der Achsen: in a und b halb so groß wie der Abstand (überlappen sich gut), quer fast null
    const r = [0, 1, 2].map((k) => (Math.abs(a[k]) > 1e-6 ? la / na : Math.abs(b[k]) > 1e-6 ? lb / nb : 0.004) * 0.6);
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nb; j++) {
        const u = (i + 0.5) / na, v = (j + 0.5) / nb;
        lage.push(o[0] + a[0] * u + b[0] * v, o[1] + a[1] * u + b[1] * v, o[2] + a[2] * u + b[2] * v);
        kov.push(r[0] * r[0], 0, 0, r[1] * r[1], 0, r[2] * r[2]);
        const d = (zufall() - 0.5) * rauschen;
        farbe.push(...f.map((c) => Math.max(0, Math.min(255, Math.round(c + d)))), 235);
      }
    }
  }

  // Kasten von min bis max, alle sechs Seiten (ohne die, die in ohne steht: "unten" …)
  function kasten(min, max, f, schritt = 0.02, ohne = []) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const dx = [x1 - x0, 0, 0], dy = [0, y1 - y0, 0], dz = [0, 0, z1 - z0];
    const dunkler = (k) => f.map((c) => c * k);
    if (!ohne.includes("unten")) flaeche([x0, y0, z0], dx, dz, dunkler(0.5), schritt);
    flaeche([x0, y1, z0], dx, dz, f, schritt);
    flaeche([x0, y0, z1], dx, dy, dunkler(0.85), schritt);
    flaeche([x0, y0, z0], dx, dy, dunkler(0.7), schritt);
    flaeche([x0, y0, z0], dz, dy, dunkler(0.75), schritt);
    flaeche([x1, y0, z0], dz, dy, dunkler(0.75), schritt);
  }

  // Raum: x −2 … 2, y 0 … 2,6, z −2 … 2; die Wand bei z = 2 fehlt (dort steht die Kamera)
  flaeche([-2, 0, -2], [4, 0, 0], [0, 0, 4], [92, 64, 44], 0.035, 22); // Boden (Holz)
  flaeche([-2, 2.6, -2], [4, 0, 0], [0, 0, 4], [70, 68, 64], 0.05); // Decke
  flaeche([-2, 0, -2], [4, 0, 0], [0, 2.6, 0], [120, 116, 108], 0.035); // hinten
  flaeche([-2, 0, -2], [0, 0, 4], [0, 2.6, 0], [104, 100, 94], 0.035); // links
  flaeche([2, 0, -2], [0, 0, 4], [0, 2.6, 0], [110, 106, 100], 0.035); // rechts

  // Tisch mit Bildschirm (hinten links)
  kasten([-1.5, 0.72, -1.95], [0.2, 0.76, -1.2], [60, 44, 34]);
  for (const x of [-1.45, 0.12]) for (const z of [-1.9, -1.27]) kasten([x, 0, z], [x + 0.05, 0.72, z + 0.05], [40, 30, 24], 0.02, ["unten"]);
  kasten([-0.95, 0.76, -1.75], [-0.35, 1.12, -1.7], [20, 20, 22], 0.012); // Bildschirm
  flaeche([-0.92, 0.79, -1.695], [0.54, 0, 0], [0, 0.3, 0], [70, 120, 160], 0.01, 30); // leuchtender Schirm

  // Regal mit Büchern (rechte Wand): Rückwand, zwei Seiten, fünf Böden, dazwischen Bücher
  const holz = [52, 40, 32];
  kasten([1.92, 0, -1.4], [1.95, 1.9, -0.4], holz);
  kasten([1.6, 0, -1.43], [1.95, 1.9, -1.4], holz, 0.02, ["unten"]);
  kasten([1.6, 0, -0.4], [1.95, 1.9, -0.37], holz, 0.02, ["unten"]);
  for (let fach = 0; fach < 5; fach++) kasten([1.6, fach * 0.465, -1.4], [1.92, fach * 0.465 + 0.03, -0.4], holz);
  for (let fach = 0; fach < 4; fach++) {
    let z = -1.38;
    const y = 0.03 + fach * 0.465;
    while (z < -0.47) {
      const dicke = 0.025 + zufall() * 0.04, hoehe = 0.22 + zufall() * 0.16;
      const f = [[140, 40, 36], [36, 60, 110], [180, 150, 90], [30, 30, 30], [90, 110, 70]][Math.floor(zufall() * 5)];
      kasten([1.66, y, z], [1.9, y + hoehe, Math.min(z + dicke, -0.42)], f, 0.012, ["unten"]);
      z += dicke + 0.004;
    }
  }

  // Röhrenfernseher auf einer Kiste (hinten rechts)
  kasten([0.7, 0, -1.9], [1.3, 0.45, -1.4], [34, 34, 36], 0.025, ["unten"]);
  kasten([0.75, 0.45, -1.85], [1.25, 0.9, -1.45], [24, 24, 26], 0.015);
  flaeche([0.8, 0.5, -1.445], [0.4, 0, 0], [0, 0.33, 0], [110, 170, 150], 0.008, 50); // Rauschen auf dem Schirm

  // Lautsprecher (links vorn)
  kasten([-1.9, 0, -0.3], [-1.6, 0.9, 0.0], [28, 26, 24], 0.02, ["unten"]);
  flaeche([-1.595, 0.5, -0.25], [0, 0, 0.2], [0, 0.2, 0], [12, 12, 12], 0.01);

  const n = lage.length / 3;
  return { anzahl: n, lage: new Float32Array(lage), kov: new Float32Array(kov), farbe: new Uint8Array(farbe) };
}

// passende Einstellungen für das Platzhalter-Zimmer
export const PLATZHALTER = {
  hintergrund: "#111111",
  art: "parallax",
  kamera: { ziel: [0, 1.0, -1.0], gier: 0, nick: -0.12, abstand: 2.6, sichtfeld: 62 },
  dinge: [
    { name: "Projekte", link: "/projekte/", lage: [-0.65, 0.95, -1.72], radius: 0.4 },
    { name: "Video (Datamosh)", link: "/projekte/datamosh/", lage: [1.0, 0.68, -1.65], radius: 0.35 },
    { name: "About", link: "/about/", lage: [1.75, 1.0, -0.9], radius: 0.55 },
    { name: "Ton (Stimme)", link: "/projekte/stimme/", lage: [-1.75, 0.45, -0.15], radius: 0.35 },
  ],
};
