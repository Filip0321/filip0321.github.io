// Startformen: wo am Anfang V (der Fresser) sitzt. Gezeichnet in Weiß auf Schwarz in eine Leinwand so groß
// wie das Gitter; sim.js macht daraus den Anfang und sät nur in Keim-Kästchen von 8 × 8 Zellen (siehe dort).
// Linien sind deshalb mindestens 9 Zellen breit, sonst trifft eine Linie kaum ein ganzes Kästchen. Die Formen sind auf die kürzere Seite bezogen, damit sie rund bleiben.

// Zufall mit festem Startwert (mulberry32): „Zufall“ sät jedes Mal gleich, so lässt sich ein Video wiederholen
function zufall(saat) {
  return () => {
    saat |= 0;
    saat = (saat + 0x6d2b79f5) | 0;
    let t = Math.imul(saat ^ (saat >>> 15), 1 | saat);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// form: "punkt", "kreis", "ring", "quadrat", "linie", "kreuz", "zufall", "text", "foto", "zeichnen"
// extra: { text, foto (Bitmap), schwelle (Foto: wie dunkel gesät wird), saat (Zahl),
//          striche (selbst gezeichnet: [{ breite, punkte: [{ x, y }, …] }], x und y von 0 bis 1) }
export function zeichneStart(b, h, form, extra = {}) {
  const c = document.createElement("canvas");
  c.width = b;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, b, h);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  const m = Math.min(b, h);
  const linie = Math.max(9, m / 50);
  ctx.lineWidth = linie;
  const cx = b / 2;
  const cy = h / 2;
  if (form === "punkt") {
    ctx.fillRect(cx - linie * 2, cy - linie * 2, linie * 4, linie * 4);
  } else if (form === "kreis") {
    // Punkte auf der Kreislinie, je 14 × 14 Zellen, 40 Zellen Abstand. Rein grün: sim.js sät sie genau so
    // (ohne Keim-Kästchen), sonst würden manche Punkte zufällig ganz wegfallen. 14, weil bei Zellteilung ein
    // einzelnes Quadrat bis 10 × 10 ausstirbt, ab 12 × 12 überlebt (in numpy nachgezählt)
    ctx.fillStyle = "#00ff00";
    const r = m * 0.25;
    const anzahl = Math.max(6, Math.round((2 * Math.PI * r) / 40));
    for (let i = 0; i < anzahl; i++) {
      const w = (i / anzahl) * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(w) * r - 7), Math.round(cy + Math.sin(w) * r - 7), 14, 14);
    }
  } else if (form === "ring") {
    ctx.beginPath();
    ctx.arc(cx, cy, m * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (form === "quadrat") {
    ctx.strokeRect(cx - m * 0.25, cy - m * 0.25, m * 0.5, m * 0.5);
  } else if (form === "linie") {
    ctx.beginPath();
    ctx.moveTo(b * 0.15, cy);
    ctx.lineTo(b * 0.85, cy);
    ctx.stroke();
  } else if (form === "kreuz") {
    ctx.beginPath();
    ctx.moveTo(cx - m * 0.3, cy);
    ctx.lineTo(cx + m * 0.3, cy);
    ctx.moveTo(cx, cy - m * 0.3);
    ctx.lineTo(cx, cy + m * 0.3);
    ctx.stroke();
  } else if (form === "zufall") {
    const r = zufall(extra.saat ?? 7);
    for (let i = 0; i < (b * h) / 3000; i++) {
      const g = 10 + r() * 10;
      ctx.fillRect(r() * b, r() * h, g, g);
    }
  } else if (form === "text") {
    // die Schrift so groß, dass der Text in 80 % der Breite passt; gefüllt (die Kästchen lassen innen Lücken)
    let groesse = m * 0.3;
    ctx.font = `bold ${groesse}px sans-serif`;
    const breite = ctx.measureText(extra.text || " ").width;
    if (breite > b * 0.8) groesse *= (b * 0.8) / breite;
    ctx.font = `bold ${groesse}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(extra.text || " ", cx, cy);
  } else if (form === "zeichnen") {
    zeichneStriche(ctx, b, h, extra.striche ?? []);
  } else if (form === "foto" && extra.foto) {
    // das Foto füllend hinein, dann: dunkler als die Schwelle wird gesät (die Kästchen in sim.js zerteilen
    // dunkle Flächen, sonst wäre eine dunkle Fläche ein einziger Klotz, der verhungert)
    const f = Math.max(b / extra.foto.width, h / extra.foto.height);
    ctx.drawImage(extra.foto, (b - extra.foto.width * f) / 2, (h - extra.foto.height * f) / 2, extra.foto.width * f, extra.foto.height * f);
    const bild = ctx.getImageData(0, 0, b, h);
    for (let i = 0; i < b * h; i++) {
      const p = i * 4;
      const hell = (0.2126 * bild.data[p] + 0.7152 * bild.data[p + 1] + 0.0722 * bild.data[p + 2]) / 255;
      const an = hell < extra.schwelle ? 255 : 0;
      bild.data[p] = bild.data[p + 1] = bild.data[p + 2] = an;
    }
    ctx.putImageData(bild, 0, 0);
  }
  return c;
}

// die selbst gezeichneten Striche (auch für die Vorschau beim Zeichnen); breite in Zellen
export function zeichneStriche(ctx, b, h, striche) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const strich of striche) {
    ctx.lineWidth = strich.breite;
    ctx.beginPath();
    strich.punkte.forEach((p, i) => (i ? ctx.lineTo(p.x * b, p.y * h) : ctx.moveTo(p.x * b, p.y * h)));
    // ein einzelner Klick: ein Punkt
    if (strich.punkte.length === 1) ctx.lineTo(strich.punkte[0].x * b + 0.01, strich.punkte[0].y * h);
    ctx.stroke();
  }
}
