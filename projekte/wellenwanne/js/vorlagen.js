// Aufbauten für die Wanne: was an Wänden, Glas und Quellen am Anfang steht.
// Jede Vorlage bekommt die Leinwände aus medium.js (Koordinaten in Zellen, y nach unten) und gibt Quellen zurück
// (x, y von 0 bis 1) und ob die ebene Welle von links an ist. λ ist die Wellenlänge in Zellen (aus der Frequenz).
//
// Was man sieht:
//   zwei Quellen   Interferenz: wo der Weg zu beiden Quellen sich um ganze Wellenlängen unterscheidet, verstärken sie
//                  sich (hell), bei halben löschen sie sich aus (dunkle Linien, Hyperbeln um die beiden Quellen)
//   Einzelspalt    Beugung: hinter einem Spalt von der Breite b läuft die Welle auseinander, mit dunklen Richtungen
//                  bei sin θ = m λ / b
//   Doppelspalt    Youngs Versuch (1801): Streifen bei sin θ = m λ / d (d = Abstand der Spalte), unter der Hülle des
//                  Einzelspalts
//   Gitter         viele Spalte: die hellen Streifen werden schmal und scharf (so trennt ein Gitter Farben)
//   Linse          Glas ist langsamer (c / n); der dicke Teil in der Mitte hält die Welle länger auf als der Rand,
//                  die ebenen Wellen werden zu Kreisen, die sich in einem Brennpunkt treffen
//   Parabol        ein Spiegel als Parabel bündelt eine ebene Welle in ihrem Brennpunkt (wie eine Satellitenschüssel)
//   Ellipse        was in einem Brennpunkt losläuft, trifft sich nach einer Spiegelung im anderen (Flüstergewölbe)

function wandLinie(g, x0, y0, x1, y1, dicke) {
  g.strokeStyle = "#fff";
  g.lineWidth = dicke;
  g.lineCap = "butt";
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

// senkrechte Wand bei x mit Lücken: [Mitte, Breite] in Zellen
function wandMitSpalten(g, x, H, spalte, dicke) {
  const sortiert = [...spalte].sort((a, b) => a[0] - b[0]);
  let y = 0;
  for (const [m, b] of sortiert) {
    wandLinie(g, x, y, x, m - b / 2, dicke);
    y = m + b / 2;
  }
  wandLinie(g, x, y, x, H, dicke);
}

export const VORLAGEN = {
  zweiQuellen: {
    text: "Zwei Quellen (Interferenz)",
    baue: ({ B, H }) => ({ quellen: [{ x: 0.5 - 24 / B, y: 0.5 }, { x: 0.5 + 24 / B, y: 0.5 }], ebene: false }),
  },
  eineQuelle: {
    text: "Eine Quelle",
    baue: () => ({ quellen: [{ x: 0.5, y: 0.5 }], ebene: false }),
  },
  einzelspalt: {
    text: "Einzelspalt (Beugung)",
    baue: ({ wand, B, H }, lambda) => {
      wandMitSpalten(wand, B * 0.35, H, [[H / 2, lambda * 1.5]], 4);
      return { quellen: [], ebene: true };
    },
  },
  doppelspalt: {
    text: "Doppelspalt (Young)",
    baue: ({ wand, B, H }, lambda) => {
      const d = lambda * 3;
      wandMitSpalten(wand, B * 0.35, H, [[H / 2 - d / 2, lambda * 0.8], [H / 2 + d / 2, lambda * 0.8]], 4);
      return { quellen: [], ebene: true };
    },
  },
  gitter: {
    text: "Gitter (viele Spalte)",
    baue: ({ wand, B, H }, lambda) => {
      const d = lambda * 2.2, n = 9;
      const spalte = Array.from({ length: n }, (_, i) => [H / 2 + (i - (n - 1) / 2) * d, lambda * 0.6]);
      wandMitSpalten(wand, B * 0.3, H, spalte, 4);
      return { quellen: [], ebene: true };
    },
  },
  linse: {
    text: "Linse (Glas bündelt)",
    baue: ({ glas, B, H }) => {
      // Sammellinse: Schnitt zweier Kreise (bikonvex), Mitte bei x = 0,35
      const R = H * 0.9, dicke = H * 0.16, cx = B * 0.35, cy = H / 2;
      glas.save();
      glas.beginPath();
      glas.arc(cx - R + dicke / 2, cy, R, 0, Math.PI * 2);
      glas.clip();
      glas.beginPath();
      glas.arc(cx + R - dicke / 2, cy, R, 0, Math.PI * 2);
      glas.fillStyle = "#fff";
      glas.fill();
      glas.restore();
      return { quellen: [], ebene: true };
    },
  },
  parabol: {
    text: "Parabolspiegel (Brennpunkt)",
    baue: ({ wand, B, H }) => {
      // x = Scheitel − y² / (4 f): offen nach links, Brennpunkt f vor dem Scheitel
      const scheitel = B * 0.85, f = B * 0.18;
      wand.strokeStyle = "#fff";
      wand.lineWidth = 4;
      wand.beginPath();
      for (let y = -H * 0.42; y <= H * 0.42; y += 2) {
        const x = scheitel - (y * y) / (4 * f);
        y === -H * 0.42 ? wand.moveTo(x, H / 2 + y) : wand.lineTo(x, H / 2 + y);
      }
      wand.stroke();
      return { quellen: [], ebene: true };
    },
  },
  ellipse: {
    text: "Ellipse (Flüstergewölbe)",
    baue: ({ wand, B, H }) => {
      const a = Math.min(B, H * 1.6) * 0.42, b = a * 0.6, c = Math.sqrt(a * a - b * b);
      wand.strokeStyle = "#fff";
      wand.lineWidth = 4;
      wand.beginPath();
      wand.ellipse(B / 2, H / 2, a, b, 0, 0, Math.PI * 2);
      wand.stroke();
      return { quellen: [{ x: (B / 2 - c) / B, y: 0.5 }], ebene: false, pulse: true };
    },
  },
  leer: {
    text: "Leer (selbst bauen)",
    baue: () => ({ quellen: [], ebene: false }),
  },
};
