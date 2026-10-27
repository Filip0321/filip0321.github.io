import { canvas2, ctx2, ansicht, dpr } from "./seite.js";
import { SKALA, frequenzZuAnteil, beschriftung } from "./frequenzen.js";
import { grenzeTief, grenzeHoch } from "./filter.js";

export function zeichneSkala() {
  ctx2.clearRect(0, 0, canvas2.width, canvas2.height); // durchsichtig
  ctx2.font = `${12 * dpr}px monospace`;
  ctx2.textBaseline = "bottom"; 
  
  // Frequenz senkrecht (tief unten) beim Spektrogramm und beim Gesamtbild, sonst waagerecht
  const senkrecht = ansicht.value === "spektrogramm" || ansicht.value === "aufnahme";
  const aTief = frequenzZuAnteil(grenzeTief);
  const aHoch = frequenzZuAnteil(grenzeHoch);

  // [von, bis, farbe] als Anteile auf der Log-Achse, 0 = 20 Hz, 1 = 20 kHz
  const BEREICHE = [
    [0, aTief, "rgba(70, 110, 255, 0.13)"], // Tiefen: blau
    [aTief, aHoch, "rgba(70, 220, 120, 0.10)"], // Mitten: grün
    [aHoch, 1, "rgba(221, 221, 221, 0.07)"], // Höhen: hell
  ];

  for (const [von, bis, farbe] of BEREICHE) {
    ctx2.fillStyle = farbe;
    if (senkrecht) {
      // tiefe Töne unten: das obere Ende des Bands ist das kleinere y
      const yOben = canvas2.height * (1 - bis);
      const yUnten = canvas2.height * (1 - von);
      ctx2.fillRect(0, yOben, canvas2.width, yUnten - yOben);
    } else {
      ctx2.fillRect(
        canvas2.width * von,
        0,
        canvas2.width * (bis - von),
        canvas2.height,
      );
    }
  }

  for (const f of SKALA) {
    const anteil = frequenzZuAnteil(f);
    const text = beschriftung(f);

    if (senkrecht) {
      const y = Math.round(canvas2.height * (1 - anteil));
      ctx2.fillStyle = "rgba(221, 221, 221, 0.3)";
      ctx2.fillRect(0, y, canvas2.width, 1); // waagerechte Linie
      ctx2.fillStyle = "rgba(221, 221, 221, 0.9)";
      ctx2.fillText(text, 4 * dpr, y - 2 * dpr); // Zahl links über der Linie
    } else {
      const x = Math.round(canvas2.width * anteil);
      ctx2.fillStyle = "rgba(221, 221, 221, 0.3)";
      ctx2.fillRect(x, 0, 1, canvas2.height); // senkrechte Linie
      ctx2.fillStyle = "rgba(221, 221, 221, 0.9)";
      ctx2.fillText(text, x + 3 * dpr, canvas2.height - 4 * dpr); // Zahl unten rechts neben der Linie
    }
  }
}
