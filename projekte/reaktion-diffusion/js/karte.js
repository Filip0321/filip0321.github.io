// Die Karte der Muster: k nach rechts, F nach oben. Jeder Punkt ist ein anderes Gray-Scott-System. Eingezeichnet:
//   die Vorlagen (Punkte mit Namen)
//   die Linie k = √F / 2 − F: rechts davon (größeres k) gibt es keinen gleichmäßigen Zustand mit V > 0 mehr,
//   eine gleichmäßige Fläche V stirbt dort aus. Herleitung: ohne Ausbreitung (∇² = 0) gilt im Gleichgewicht
//   U · V = F + k und F · (1 − U) = U · V², das hat Lösungen mit V > 0 nur, solange (F + k)² ≤ F / 4
//   (Pearson 1993). Die Muster leben in einem Band um diese Linie: links davon füllen sie (Labyrinthe, Löcher),
//   knapp rechts davon halten sich nur noch Flecken, weil jeder sich Futter aus seiner Umgebung holt; die teilen
//   sich dann (Zellteilung). Weit rechts stirbt alles, weit links wird alles gleichmäßig voll.
// Klicken oder ziehen setzt F und k.

export const BEREICH = { kVon: 0.03, kBis: 0.075, fVon: 0.0, fBis: 0.1 };

export function richteKarteEin(canvas, vorlagen, beiWahl) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const zuX = (k) => ((k - BEREICH.kVon) / (BEREICH.kBis - BEREICH.kVon)) * W;
  const zuY = (F) => H - ((F - BEREICH.fVon) / (BEREICH.fBis - BEREICH.fVon)) * H;
  let jetzt = { F: 0.0367, k: 0.0649 };

  function zeichne() {
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, W, H);
    // Gitter
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 9) * W, 0);
      ctx.lineTo((i / 9) * W, H);
      ctx.moveTo(0, (i / 10) * H);
      ctx.lineTo(W, (i / 10) * H);
      ctx.stroke();
    }
    // die Grenze des Lebens
    ctx.strokeStyle = "rgba(255,120,80,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const F = BEREICH.fVon + ((BEREICH.fBis - BEREICH.fVon) * i) / 200;
      const k = Math.sqrt(F) / 2 - F;
      const [x, y] = [zuX(k), zuY(F)];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Vorlagen
    ctx.font = `${Math.round(W / 26)}px monospace`;
    for (const v of vorlagen) {
      ctx.fillStyle = "#9ad";
      ctx.beginPath();
      ctx.arc(zuX(v.k), zuY(v.F), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(v.name, zuX(v.k) + 5, zuY(v.F) - 4);
    }
    // jetzt
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(zuX(jetzt.k), zuY(jetzt.F), 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ccc";
    ctx.fillText(`F ${jetzt.F.toFixed(4)}  k ${jetzt.k.toFixed(4)}`, 6, H - 8);
  }

  let zieht = false;
  const nimm = (event) => {
    const r = canvas.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width;
    const y = 1 - (event.clientY - r.top) / r.height;
    jetzt = { k: BEREICH.kVon + x * (BEREICH.kBis - BEREICH.kVon), F: BEREICH.fVon + y * (BEREICH.fBis - BEREICH.fVon) };
    zeichne();
    beiWahl(jetzt);
  };
  canvas.addEventListener("pointerdown", (event) => {
    zieht = true;
    canvas.setPointerCapture?.(event.pointerId);
    nimm(event);
  });
  canvas.addEventListener("pointermove", (event) => zieht && nimm(event));
  canvas.addEventListener("pointerup", () => (zieht = false));
  zeichne();
  return {
    setze(F, k) {
      jetzt = { F, k };
      zeichne();
    },
  };
}
