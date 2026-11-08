// Die Welle: die Bytes des Bildes als Wellenform, mit Auswahl, Bereichen und Abspielkopf.
// Bei Millionen Samples und ein paar hundert Pixeln Breite steht jede Spalte für Tausende Samples: gezeichnet
// wird darum pro Spalte ein senkrechter Strich vom kleinsten zum größten Wert darin (wie Audacity).
//
// beiAuswahl(von, bis): der Nutzer hat gezogen (in Samples)

export function richteWelleEin(canvas, { beiAuswahl, beiZeiger }) {
  const ctx = canvas.getContext("2d");
  let ton = null; // Float32Array
  let ansicht = [0, 1]; // sichtbarer Teil in Samples
  let auswahl = null; // [von, bis]
  let bereiche = []; // [{ von, bis, farbe }]
  let kopf = null; // Abspielkopf in Samples
  let einrasten = (n) => n; // auf Zeilengrenzen runden (main.js)

  const px = () => window.devicePixelRatio || 1;
  const sampleBei = (x) => Math.round(ansicht[0] + (x / canvas.clientWidth) * (ansicht[1] - ansicht[0]));
  const xVon = (n) => ((n - ansicht[0]) / (ansicht[1] - ansicht[0])) * canvas.width;

  function zeichne() {
    const w = Math.round(canvas.clientWidth * px());
    const h = Math.round(canvas.clientHeight * px());
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    if (!ton) return;
    // die Welle: außen (grau) vom Kleinsten zum Größten, innen (hell) die mittlere Lautstärke (RMS). Bei Bildern
    // reicht der Rand oft fast von −1 bis 1 (ein einziges dunkles und ein helles Byte genügen), erst die Mitte
    // zeigt, wo das Bild hell, dunkel oder unruhig ist
    const [a, z] = ansicht;
    const proSpalte = (z - a) / w;
    const aussen = new Path2D();
    const innen = new Path2D();
    for (let x = 0; x < w; x++) {
      const von = Math.floor(a + x * proSpalte);
      const bis = Math.max(von + 1, Math.floor(a + (x + 1) * proSpalte));
      let klein = 1;
      let gross = -1;
      let summe = 0;
      let quadrate = 0;
      let n = 0;
      // bei sehr vielen Samples pro Spalte nur jedes k-te ansehen (die Form bleibt, es geht schneller)
      const schritt = Math.max(1, Math.floor((bis - von) / 400));
      for (let i = von; i < bis && i < ton.length; i += schritt) {
        const s = ton[i];
        if (s < klein) klein = s;
        if (s > gross) gross = s;
        summe += s;
        quadrate += s * s;
        n++;
      }
      if (!n) continue;
      const mitte = summe / n;
      const rms = Math.sqrt(Math.max(0, quadrate / n - mitte * mitte));
      aussen.moveTo(x + 0.5, (0.5 - gross / 2) * h);
      aussen.lineTo(x + 0.5, (0.5 - klein / 2) * h + 1);
      innen.moveTo(x + 0.5, (0.5 - (mitte + rms) / 2) * h);
      innen.lineTo(x + 0.5, (0.5 - (mitte - rms) / 2) * h + 1);
    }
    ctx.strokeStyle = "#5a5a5a";
    ctx.stroke(aussen);
    ctx.strokeStyle = "#e8e8e8";
    ctx.stroke(innen);
    // Bereiche (in ihrer Farbe) und Auswahl darüber, halb durchsichtig, mit einer Linie an den Rändern
    const spanne = (von, bis, farbe, deckung) => {
      const x0 = xVon(von);
      const x1 = Math.max(x0 + 1, xVon(bis));
      ctx.globalAlpha = deckung;
      ctx.fillStyle = farbe;
      ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.globalAlpha = 1;
      ctx.fillRect(x0, 0, px(), h);
      ctx.fillRect(x1 - px(), 0, px(), h);
    };
    for (const b of bereiche) spanne(b.von, b.bis, b.farbe, 0.25);
    if (auswahl) spanne(auswahl[0], auswahl[1], "#ffffff", 0.2);
    if (kopf !== null) {
      ctx.fillStyle = "#ff5544";
      ctx.fillRect(xVon(kopf), 0, 2 * px(), h);
    }
  }

  // ziehen: auswählen (mit Einrasten auf ganze Zeilen)
  let anker = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (!ton) return;
    canvas.setPointerCapture(event.pointerId);
    anker = sampleBei(event.offsetX);
    auswahl = [einrasten(anker), einrasten(anker)];
    zeichne();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!ton) return;
    beiZeiger?.(sampleBei(event.offsetX));
    if (anker === null) return;
    const n = sampleBei(event.offsetX);
    auswahl = [einrasten(Math.min(anker, n), "ab"), einrasten(Math.max(anker, n), "auf")];
    zeichne();
  });
  const fertig = () => {
    if (anker === null) return;
    anker = null;
    if (auswahl && auswahl[1] > auswahl[0]) beiAuswahl(auswahl[0], auswahl[1]);
  };
  canvas.addEventListener("pointerup", fertig);
  canvas.addEventListener("pointercancel", fertig);
  new ResizeObserver(zeichne).observe(canvas);

  return {
    setzeTon(neu) {
      const neuGeladen = !ton || ton.length !== neu.length;
      ton = neu;
      if (neuGeladen) ansicht = [0, neu.length];
      zeichne();
    },
    setzeAuswahl(a) {
      auswahl = a;
      zeichne();
    },
    setzeBereiche(b) {
      bereiche = b;
      zeichne();
    },
    setzeKopf(n) {
      kopf = n;
      zeichne();
    },
    setzeEinrasten(f) {
      einrasten = f;
    },
    zoome(von, bis) {
      if (!ton) return;
      const rand = (bis - von) * 0.05;
      ansicht = [Math.max(0, von - rand), Math.min(ton.length, bis + rand)];
      if (ansicht[1] - ansicht[0] < 100) ansicht = [0, ton.length];
      zeichne();
    },
    ganz() {
      if (ton) ansicht = [0, ton.length];
      zeichne();
    },
  };
}
