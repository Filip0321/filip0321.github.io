// Ein Oszilloskop im XY-Modus, nachgemacht: links lenkt den Strahl waagerecht ab, rechts senkrecht.
// Was es echt macht und hier nachgemacht wird:
//   Helligkeit   ein Strahl, der langsam über eine Stelle fährt, lässt dort mehr Elektronen: hell. Schnelle
//                Strecken (Sprünge, steile Flanken) sind blass. Hier: Deckkraft jeder Strecke ~ 1 / Länge
//   Nachleuchten der Phosphor leuchtet nach, darum steht die Figur, obwohl der Strahl nur einen Punkt zeichnet.
//                Hier: jedes Bild wird das alte nur etwas abgedunkelt statt gelöscht
//   Raster       acht mal zehn Kästchen, wie auf dem Schirm
// Live kommen die Samples von zwei AnalyserNodes (je Kanal einer), beim Video aus dem gerechneten Ton
// (zeichneSpur ist für beides dieselbe).

const STUFEN = 8; // Deckkraft in so vielen Stufen zeichnen (je ein Pfad statt 2048 einzelner Striche)

// ein Bild des Schirms: das alte abdunkeln, dann die Samples a (x) und b (y) als Leuchtspur dazu
export function zeichneSpur(ctx, a, b, einst) {
  const { width: w, height: h } = ctx.canvas;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0, 0, 0, ${einst.nachleuchten})`;
  ctx.fillRect(0, 0, w, h);
  const pfade = Array.from({ length: STUFEN }, () => new Path2D());
  // Verstärkung wie der Volt-pro-Kästchen-Knopf: bei 1 füllt ±1 den Schirm
  const g = einst.verstaerkung;
  const px = (v) => w / 2 + v * g * (w / 2);
  const py = (v) => h / 2 - v * g * (h / 2);
  for (let i = 1; i < a.length; i++) {
    const x0 = px(a[i - 1]);
    const y0 = py(b[i - 1]);
    const x1 = px(a[i]);
    const y1 = py(b[i]);
    const laenge = Math.hypot(x1 - x0, y1 - y0);
    const deckung = Math.min(1, (einst.helligkeit * 3 * (w / 800)) / (laenge + 1.5));
    const stufe = Math.min(STUFEN - 1, Math.floor(deckung * STUFEN));
    pfade[stufe].moveTo(x0, y0);
    pfade[stufe].lineTo(x1 + 0.01, y1); // ein Punkt (Länge 0) würde sonst nicht gezeichnet
  }
  ctx.globalCompositeOperation = "lighter"; // Licht addiert sich
  ctx.strokeStyle = einst.farbe;
  ctx.lineWidth = Math.max(1, w / 400);
  ctx.lineCap = "round";
  pfade.forEach((p, i) => {
    ctx.globalAlpha = ((i + 1) / STUFEN) * 0.5;
    ctx.stroke(p);
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// das Raster (acht mal zehn Kästchen) in ein Canvas
export function zeichneRaster(ctx) {
  const { width: w, height: h } = ctx.canvas;
  ctx.strokeStyle = "rgba(125, 255, 154, 0.18)";
  ctx.lineWidth = Math.max(1, w / 800);
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    ctx.moveTo((i * w) / 10, 0);
    ctx.lineTo((i * w) / 10, h);
  }
  for (let i = 0; i <= 8; i++) {
    ctx.moveTo(0, (i * h) / 8);
    ctx.lineTo(w, (i * h) / 8);
  }
  ctx.stroke();
}

export function richteSchirmEin(canvas, raster) {
  const ctx = canvas.getContext("2d");
  let links = null;
  let rechts = null;
  let a = null;
  let b = null;
  let laeuft = false;
  const einst = { nachleuchten: 0.25, helligkeit: 1, verstaerkung: 3, farbe: "#7dff9a" };

  function neuesRaster() {
    raster.width = raster.clientWidth * devicePixelRatio || 600;
    raster.height = raster.clientHeight * devicePixelRatio || 600;
    zeichneRaster(raster.getContext("2d"));
  }

  function bild() {
    if (!laeuft) return;
    if (links) {
      links.getFloatTimeDomainData(a);
      rechts.getFloatTimeDomainData(b);
      zeichneSpur(ctx, a, b, einst);
    }
    requestAnimationFrame(bild);
  }

  new ResizeObserver(neuesRaster).observe(raster);

  return {
    einst,
    // zwei AnalyserNodes (links = x, rechts = y)
    verbinde(l, r) {
      links = l;
      rechts = r;
      a = new Float32Array(l.fftSize);
      b = new Float32Array(r.fftSize);
      if (!laeuft) {
        laeuft = true;
        requestAnimationFrame(bild);
      }
    },
  };
}
