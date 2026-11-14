// Kurven-Editor für die Transferfunktion, wie in 3D Slicer („Volume Rendering → Advanced“) oder ParaView:
// unten das Histogramm der Werte (logarithmisch, grau), darüber die Kurve. Jeder Punkt ist ein Wert (waagerecht)
// mit einer Deckkraft (senkrecht) und einer Farbe. Zwischen den Punkten wird gemischt.
//
//   ziehen         Punkt verschieben (der erste und letzte bestimmen das Fenster)
//   Klick daneben  neuer Punkt (Farbe aus der Kurve an der Stelle)
//   Doppelklick oder Rechtsklick auf einen Punkt: weg (mindestens zwei bleiben)
//   Farbfeld       Farbe des gewählten Punkts (oder eine Farbskala für die ganze Kurve: setzeSkala)
//   Mausrad        waagerecht zoomen (um die Maus), „ganzer Bereich“ zeigt wieder alles
//
// richteKurveEin({ leinwand, farbe, ganz, beiAenderung }) gibt zurück:
//   setze(punkte), punkte(), setzeHistogramm(h), zeichne()

export function richteKurveEin({ leinwand, farbe, ganz, beiAenderung }) {
  const ctx = leinwand.getContext("2d");
  let punkte = [];
  let h = null; // histogramm.js
  let bereich = [0, 1]; // gezeigte Werte (waagerecht)
  let gewaehlt = -1;
  let zieht = false;
  let skala = null; // Farbskala (256 · 3) statt der Farben der Punkte, oder null

  const hex = (f) => "#" + f.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  const ausHex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

  function groesse() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const b = Math.max(50, Math.round(leinwand.clientWidth * dpr));
    const hh = Math.max(50, Math.round(leinwand.clientHeight * dpr));
    if (leinwand.width !== b || leinwand.height !== hh) {
      leinwand.width = b;
      leinwand.height = hh;
    }
    return [b, hh];
  }
  const RAND = 6; // Pixel oben und unten, damit Punkte bei 0 und 1 ganz zu sehen sind
  const xVon = (w) => ((w - bereich[0]) / (bereich[1] - bereich[0])) * leinwand.width;
  const wVon = (x) => bereich[0] + (x / leinwand.width) * (bereich[1] - bereich[0]);
  const yVon = (a) => RAND + (1 - a) * (leinwand.height - 2 * RAND);
  const aVon = (y) => Math.min(1, Math.max(0, 1 - (y - RAND) / (leinwand.height - 2 * RAND)));

  // Farbe und Deckkraft der Kurve an einem Wert (wie ausPunkten in tf.js)
  function an(w) {
    const [f, a] = anPunkte(w);
    if (!skala) return [f, a];
    const lo = punkte[0][0];
    const hi = punkte[punkte.length - 1][0];
    const k = Math.round(Math.min(1, Math.max(0, (w - lo) / (hi - lo || 1))) * 255);
    return [[skala[k * 3], skala[k * 3 + 1], skala[k * 3 + 2]], a];
  }
  function anPunkte(w) {
    if (w <= punkte[0][0]) return [punkte[0][1], punkte[0][2]];
    for (let k = 0; k < punkte.length - 1; k++) {
      const [w0, f0, a0] = punkte[k];
      const [w1, f1, a1] = punkte[k + 1];
      if (w <= w1) {
        const t = (w - w0) / (w1 - w0 || 1);
        return [f0.map((x, j) => x + (f1[j] - x) * t), a0 + (a1 - a0) * t];
      }
    }
    const l = punkte[punkte.length - 1];
    return [l[1], l[2]];
  }

  function zeichne() {
    const [b, hh] = groesse();
    ctx.clearRect(0, 0, b, hh);
    const stil = getComputedStyle(leinwand);
    const vorn = stil.color || "#fff";
    // Histogramm
    if (h) {
      ctx.fillStyle = "rgba(128, 128, 128, 0.45)";
      const max = Math.log1p(Math.max(...h.zahlen));
      for (let x = 0; x < b; x++) {
        const f0 = Math.floor(h.fach(wVon(x)));
        const f1 = Math.max(f0, Math.floor(h.fach(wVon(x + 1))));
        let z = 0;
        for (let f = Math.max(0, f0); f <= Math.min(h.zahlen.length - 1, f1); f++) z = Math.max(z, h.zahlen[f]);
        const y = (Math.log1p(z) / max) * (hh - 2 * RAND);
        ctx.fillRect(x, hh - RAND - y, 1, y);
      }
    }
    if (punkte.length < 2) return;
    // Fläche unter der Kurve in ihren Farben
    for (let x = 0; x < b; x++) {
      const [f, a] = an(wVon(x));
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(${f.map(Math.round).join(",")}, 0.75)`;
      ctx.fillRect(x, yVon(a), 1, hh - RAND - yVon(a));
    }
    // Linie und Punkte
    ctx.strokeStyle = vorn;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [w, , a] of punkte) ctx.lineTo(xVon(w), yVon(a));
    ctx.stroke();
    punkte.forEach(([w, f, a], i) => {
      ctx.beginPath();
      ctx.arc(xVon(w), yVon(a), i === gewaehlt ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = hex(skala ? an(w)[0] : f);
      ctx.fill();
      ctx.strokeStyle = i === gewaehlt ? "#ff5040" : vorn;
      ctx.lineWidth = i === gewaehlt ? 2.5 : 1.5;
      ctx.stroke();
    });
    // Beschriftung: Werte am Rand und am gewählten Punkt
    ctx.fillStyle = vorn;
    ctx.font = `${Math.round(11 * Math.min(devicePixelRatio || 1, 2))}px monospace`;
    ctx.textBaseline = "top";
    ctx.fillText(String(Math.round(bereich[0])), 3, 2);
    const t = String(Math.round(bereich[1]));
    ctx.fillText(t, b - ctx.measureText(t).width - 3, 2);
    if (gewaehlt >= 0) {
      const [w, , a] = punkte[gewaehlt];
      const s = `${+w.toFixed(1)} · ${Math.round(a * 100)} %`;
      ctx.fillText(s, Math.min(b - ctx.measureText(s).width - 3, Math.max(3, xVon(w) - 30)), 2 + 14 * Math.min(devicePixelRatio || 1, 2));
    }
  }

  function geaendert() {
    zeichne();
    beiAenderung?.(punkte);
  }

  function getroffen(x, y) {
    let beste = -1;
    let d = 12 * Math.min(devicePixelRatio || 1, 2);
    punkte.forEach(([w, , a], i) => {
      const e = Math.hypot(xVon(w) - x, yVon(a) - y);
      if (e < d) {
        d = e;
        beste = i;
      }
    });
    return beste;
  }
  function wo(event) {
    const r = leinwand.getBoundingClientRect();
    return [((event.clientX - r.left) / r.width) * leinwand.width, ((event.clientY - r.top) / r.height) * leinwand.height];
  }
  function waehle(i) {
    gewaehlt = i;
    if (i >= 0 && farbe) farbe.value = hex(punkte[i][1]);
  }

  leinwand.addEventListener("contextmenu", (event) => event.preventDefault());
  leinwand.addEventListener("pointerdown", (event) => {
    if (punkte.length < 2) return;
    const [x, y] = wo(event);
    let i = getroffen(x, y);
    if (event.button === 2) {
      if (i >= 0 && punkte.length > 2) {
        punkte.splice(i, 1);
        waehle(-1);
        geaendert();
      }
      return;
    }
    if (i < 0) {
      // neuer Punkt, eingeordnet nach seinem Wert
      const w = wVon(x);
      const [f] = an(w);
      punkte.push([w, f.map(Math.round), aVon(y)]);
      punkte.sort((p, q) => p[0] - q[0]);
      i = punkte.findIndex((p) => p[0] === w);
      geaendert();
    }
    waehle(i);
    zieht = true;
    leinwand.setPointerCapture(event.pointerId);
    zeichne();
  });
  leinwand.addEventListener("pointermove", (event) => {
    if (!zieht || gewaehlt < 0) return;
    const [x, y] = wo(event);
    // nicht über die Nachbarn hinaus (die Reihenfolge bleibt)
    const links = gewaehlt > 0 ? punkte[gewaehlt - 1][0] : -Infinity;
    const rechts = gewaehlt < punkte.length - 1 ? punkte[gewaehlt + 1][0] : Infinity;
    const eps = (bereich[1] - bereich[0]) * 1e-4;
    punkte[gewaehlt][0] = Math.min(rechts - eps, Math.max(links + eps, wVon(x)));
    punkte[gewaehlt][2] = aVon(y);
    geaendert();
  });
  for (const art of ["pointerup", "pointercancel"]) leinwand.addEventListener(art, () => (zieht = false));
  leinwand.addEventListener("dblclick", (event) => {
    const [x, y] = wo(event);
    const i = getroffen(x, y);
    if (i >= 0 && punkte.length > 2) {
      punkte.splice(i, 1);
      waehle(-1);
      geaendert();
    }
  });
  leinwand.addEventListener("wheel", (event) => {
    event.preventDefault();
    const [x] = wo(event);
    const mitte = wVon(x);
    const f = Math.exp(event.deltaY * 0.0015);
    bereich = [mitte + (bereich[0] - mitte) * f, mitte + (bereich[1] - mitte) * f];
    zeichne();
  }, { passive: false });
  farbe?.addEventListener("input", () => {
    if (gewaehlt < 0) return;
    punkte[gewaehlt][1] = ausHex(farbe.value);
    geaendert();
  });
  ganz?.addEventListener("click", () => {
    if (h) bereich = [h.lo, h.hi];
    zeichne();
  });
  new ResizeObserver(() => zeichne()).observe(leinwand);

  return {
    // punkte: [[Wert, [r, g, b], Deckkraft], …]; zoomt auf die Kurve (mit etwas Rand), wenn sie anders liegt
    setze(neu, { zoomen = true } = {}) {
      punkte = neu.map(([w, f, a]) => [w, [...f], a]);
      gewaehlt = -1;
      if (zoomen && punkte.length >= 2) {
        const lo = punkte[0][0];
        const hi = punkte[punkte.length - 1][0];
        const rand = (hi - lo) * 0.15 || 1;
        bereich = [lo - rand, hi + rand];
      }
      zeichne();
    },
    punkte: () => punkte,
    setzeSkala(neu) {
      skala = neu;
      zeichne();
    },
    setzeHistogramm(neu) {
      h = neu;
      zeichne();
    },
    zeichne,
  };
}
