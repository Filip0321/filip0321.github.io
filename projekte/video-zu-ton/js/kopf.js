// Über dem Video: die Lesestriche, was sie gerade lesen, eine Frequenz-Skala und beim Aufziehen der
// Ausschnitt, auf einem durchsichtigen 2D-Canvas. Alle Lagen sind Anteile des Feldes (0 bis 1),
// y = 0 unten wie im Shader.

const SKALA = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const HELL = "#dddddd";
const LINIE = "rgba(221, 221, 221, 0.3)";
const RAND = "rgba(17, 17, 17, 0.8)";
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

  // eine dünne Linie längs des Strichs bei x (Rand der Lesebreite)
  function rand(s, x) {
    const { width: b, height: h } = canvas;
    ctx.fillStyle = "rgba(221, 221, 221, 0.5)";
    if (s.senkrecht) ctx.fillRect(x, 0, Math.max(1, Math.round(dpr / 2)), h);
    else ctx.fillRect(0, x, b, Math.max(1, Math.round(dpr / 2)));
  }

  // der Strich selbst: eine Fläche von anfang bis ende (so dick, wie er sich zeigt), deckkraft 0 bis 1,
  // mit dunklem Rand, damit man ihn auf Hellem sieht. Dünner als 2 Pixel wird er nie, sonst wäre er weg.
  function strichFlaeche(s, anfang, ende, aktiv, deckkraft) {
    const { width: b, height: h } = canvas;
    const min = 2 * dpr;
    if (ende - anfang < min) {
      const m = (anfang + ende) / 2;
      anfang = m - min / 2;
      ende = m + min / 2;
    }
    const rand = Math.max(1, Math.round(dpr));
    const flaeche = (von, bis) => (s.senkrecht ? ctx.fillRect(von, 0, bis - von, h) : ctx.fillRect(0, von, b, bis - von));
    ctx.fillStyle = RAND;
    flaeche(anfang - rand, anfang);
    flaeche(ende, ende + rand);
    ctx.fillStyle = `rgba(255, 255, 255, ${aktiv ? deckkraft : deckkraft * 0.6})`;
    flaeche(anfang, ende);
  }

  // Wellenform: die gelesene Schwingung als Kurve neben dem Strich (wie auf einem Oszilloskop)
  function kurve(s, grenzen, werte, anfang, ende, farbe) {
    let mittel = 0;
    for (const w of werte) mittel += w;
    mittel /= werte.length;
    ctx.strokeStyle = farbe;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    werte.forEach((w, z) => {
      const p = laengs(s, (grenzen[2 * z] + grenzen[2 * z + 1]) / 2);
      const aus = (w - mittel) * 80 * dpr; // Auslenkung
      const quer = s.senkrecht ? ende + 50 * dpr + aus : anfang - 50 * dpr - aus; // rechts bzw. über dem Strich
      if (s.senkrecht) z ? ctx.lineTo(quer, p) : ctx.moveTo(quer, p);
      else z ? ctx.lineTo(p, quer) : ctx.moveTo(p, quer);
    });
    ctx.stroke();
  }

  // striche: [{ strich, grenzen, werte }]; aktiv: id; skala: { tief, hoch, zeilen } oder null;
  // zeigeStriche: die Striche selbst; deckkraft: wie deckend ihre Fläche ist;
  // balken: zeigen, was jeder Strich liest (Balken, bei der Wellenform die Kurve), in balkenFarbe;
  // rechteck: { links, unten, rechts, oben } (beim Aufziehen des Ausschnitts) oder null
  function zeichne({ striche, aktiv, skala, rechteck, balken = true, zeigeStriche = true, deckkraft = 0.5, balkenFarbe = "#ff4040" }) {
    const { width: b, height: h } = canvas;
    ctx.clearRect(0, 0, b, h);

    // Skala am aktiven Strich: senkrecht links am Rand, waagerecht unten
    const a = striche.find((x) => x.strich.id === aktiv);
    if (skala && a && a.strich.art !== "welle") {
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
      // gelesen wird von anfang bis ende (Lesebreite), gezeigt von sichtAnfang bis sichtEnde (Dicke)
      const lage = (prozent) => {
        const von = s.senkrecht ? (s.mitte - prozent / 200) * quer : (1 - s.mitte - prozent / 200) * quer;
        return [von, von + (prozent / 100) * quer];
      };
      const [anfang, ende] = lage(s.breite);
      const [sichtAnfang, sichtEnde] = s.dickeWieBreite === false ? lage(s.dicke) : [anfang, ende];
      // was der Strich gerade liest: pro Zeile ein Balken daneben (außen an der Fläche), so lang wie hell
      const aussen0 = Math.min(anfang, sichtAnfang);
      const aussen1 = Math.max(ende, sichtEnde);
      ctx.globalAlpha = 0.75;
      if (werte && balken && s.art === "welle") kurve(s, grenzen, werte, aussen0, aussen1, balkenFarbe);
      else if (werte && balken) {
        ctx.fillStyle = balkenFarbe;
        for (let z = 0; z < werte.length; z++) {
          const laenge = werte[z] * 40 * dpr;
          if (laenge < 0.5) continue;
          const p0 = laengs(s, grenzen[2 * z]);
          const p1 = laengs(s, grenzen[2 * z + 1]);
          const von = Math.min(p0, p1);
          const dicke = Math.max(1, Math.abs(p1 - p0) - 1);
          if (s.senkrecht) ctx.fillRect(aussen1 + 2 * dpr, von, laenge, dicke);
          else ctx.fillRect(von, aussen0 - 2 * dpr - laenge, dicke, laenge);
        }
      }
      ctx.globalAlpha = 1;
      if (!zeigeStriche) continue;
      strichFlaeche(s, sichtAnfang, sichtEnde, s.id === aktiv, deckkraft);
      // eigene Dicke und breiter gelesen als gezeigt: die Lesebreite mit zwei feinen Rändern zeigen
      if (s.dickeWieBreite === false && ende - anfang > 6 * dpr && (anfang < sichtAnfang || ende > sichtEnde)) {
        rand(s, anfang);
        rand(s, ende);
      }
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

