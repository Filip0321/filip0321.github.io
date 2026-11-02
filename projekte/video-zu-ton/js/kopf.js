// Über dem Video: die Lesestriche, was sie gerade lesen, eine Frequenz-Skala und beim Aufziehen der
// Ausschnitt, auf einem durchsichtigen 2D-Canvas. Alle Lagen sind Anteile des Feldes (0 bis 1),
// y = 0 unten wie im Shader.

const SKALA = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const HELL = "#dddddd";
const LINIE = "rgba(221, 221, 221, 0.3)";
const RAND = "rgba(17, 17, 17, 0.8)";
const BALKEN = "rgba(255, 64, 64, 0.7)";
const SCHRIFT = 12;

export function richteKopfEin(canvas) {
  const ctx = canvas.getContext("2d");
  let dpr = 2;

  function passeGroesseAn() {
    dpr = Math.max(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }

  // Lage l längs eines Strichs (0 bis 1, vom tiefen Ende aus) -> Bildpunkte im Canvas
  function laengs(s, l) {
    const t = s.rueckwaerts ? 1 - l : l;
    return s.senkrecht ? (1 - t) * canvas.height : t * canvas.width;
  }

  // wo auf dem Strich liegt Frequenz f? Zeile mit Komma (logarithmisch), dann in ihren Grenzen
  function lageVon(f, s, grenzen, tief, hoch, zeilen) {
    const z = (Math.log(f / tief) / Math.log(hoch / tief)) * (zeilen - 1) + 0.5; // Mitte von Zeile 0 bei 0,5
    const ganz = Math.min(Math.floor(z), zeilen - 1);
    const rest = z - ganz;
    return grenzen[2 * ganz] + (grenzen[2 * ganz + 1] - grenzen[2 * ganz]) * rest;
  }

  function strichLinie(s, x, aktiv) {
    const { width: b, height: h } = canvas;
    const linie = Math.round(dpr);
    ctx.fillStyle = RAND;
    if (s.senkrecht) ctx.fillRect(x - linie, 0, linie * 3, h);
    else ctx.fillRect(0, x - linie, b, linie * 3);
    ctx.fillStyle = aktiv ? HELL : "rgba(221, 221, 221, 0.5)";
    if (s.senkrecht) ctx.fillRect(x, 0, linie, h);
    else ctx.fillRect(0, x, b, linie);
  }

  // striche: [{ strich, grenzen, werte }]; aktiv: id; skala: { tief, hoch, zeilen } oder null;
  // rechteck: { links, unten, rechts, oben } (beim Aufziehen des Ausschnitts) oder null
  function zeichne({ striche, aktiv, skala, rechteck }) {
    const { width: b, height: h } = canvas;
    ctx.clearRect(0, 0, b, h);

    // Skala am aktiven Strich: senkrecht links am Rand, waagerecht unten
    const a = striche.find((x) => x.strich.id === aktiv);
    if (skala && a && !a.strich.welle) {
      ctx.font = `${SCHRIFT * dpr}px monospace`;
      ctx.lineWidth = 3 * dpr;
      ctx.lineJoin = "round";
      for (const f of SKALA) {
        if (f < skala.tief || f > skala.hoch) continue;
        const p = Math.round(laengs(a.strich, lageVon(f, a.strich, a.grenzen, skala.tief, skala.hoch, skala.zeilen)));
        const text = f < 1000 ? `${f}` : `${f / 1000}k`;
        ctx.fillStyle = LINIE;
        if (a.strich.senkrecht) ctx.fillRect(0, p, b, Math.round(dpr));
        else ctx.fillRect(p, 0, Math.round(dpr), h);
        const [tx, ty] = a.strich.senkrecht ? [4 * dpr, p - 2 * dpr] : [p + 3 * dpr, h - 4 * dpr];
        ctx.textBaseline = "bottom";
        ctx.strokeStyle = RAND;
        ctx.strokeText(text, tx, ty);
        ctx.fillStyle = HELL;
        ctx.fillText(text, tx, ty);
      }
    }

    for (const { strich: s, grenzen, werte } of striche) {
      const quer = s.senkrecht ? b : h;
      const anfang = s.senkrecht ? (s.mitte - s.breite / 200) * quer : (1 - s.mitte - s.breite / 200) * quer;
      const ende = anfang + (s.breite / 100) * quer;
      // was der Strich gerade liest: pro Zeile ein Balken daneben, so lang wie hell
      if (werte) {
        ctx.fillStyle = BALKEN;
        for (let z = 0; z < werte.length; z++) {
          const laenge = werte[z] * 40 * dpr;
          if (laenge < 0.5) continue;
          const p0 = laengs(s, grenzen[2 * z]);
          const p1 = laengs(s, grenzen[2 * z + 1]);
          const von = Math.min(p0, p1);
          const dicke = Math.max(1, Math.abs(p1 - p0) - 1);
          if (s.senkrecht) ctx.fillRect(ende + 2 * dpr, von, laenge, dicke);
          else ctx.fillRect(von, anfang - 2 * dpr - laenge, dicke, laenge);
        }
      }
      strichLinie(s, anfang, s.id === aktiv);
      strichLinie(s, Math.max(ende, anfang + dpr), s.id === aktiv);
    }

    if (rechteck) {
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.lineWidth = dpr;
      ctx.strokeStyle = HELL;
      ctx.strokeRect(rechteck.links * b, (1 - rechteck.oben) * h, (rechteck.rechts - rechteck.links) * b, (rechteck.oben - rechteck.unten) * h);
      ctx.setLineDash([]);
    }
  }

  return { passeGroesseAn, zeichne };
}
