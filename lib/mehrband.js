// Mehrband-Anzeige für /lib/audioreaktiv.js: das Spektrum als Balken (logarithmisch, 30 Hz bis 16 kHz, wie man
// hört), darin zwei Grenzen zum Ziehen, die es in Bass, Mitte und Höhen teilen. Über jedem Bereich eine waagrechte
// Linie: so laut ist er gerade (das, was vorher die drei Balken neben den Auswahlfeldern zeigten, die bei schmaler
// Spalte aus der Seite ragten). Darunter eine Spur, die nach links wandert: Schlag, Einsatz und Takt als Striche,
// damit man sieht, ob die Erkennung zur Musik passt.
//
// Achse: x = log(f / VON) / log(BIS / VON), also gleich viele Halbtöne pro Pixel. Dieselbe Teilung wie die 64 Bänder
// von musik.spektrum, darum passt Balken b genau auf x = b / 64.

const VON = 30, BIS = 16000;
const HOEHE = 110, SPUR = 42; // CSS-Pixel
const NAMEN = [["bass", "Bass"], ["mitte", "Mitte"], ["hoehen", "Höhen"]];
const SPUREN = [["schlag", "Schlag"], ["einsatz", "Einsatz"], ["takt", "Takt"]];

const zuX = (hz) => Math.log(hz / VON) / Math.log(BIS / VON);
const zuHz = (x) => VON * (BIS / VON) ** x;
const hzText = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);

// grenzen: { a, b } in Hz (Bass bis a, Mitte bis b, Höhen darüber), wird beim Ziehen geändert
// beiAenderung: () => … (zum Beispiel neu zeichnen, wenn nichts läuft)
export function baueMehrband(ziel, grenzen, beiAenderung = () => {}) {
  const box = document.createElement("div");
  box.className = "mehrband";
  const bild = document.createElement("canvas");
  bild.className = "mehrband-spektrum";
  bild.setAttribute("aria-label", "Spektrum mit zwei Grenzen zum Ziehen: Bass, Mitte, Höhen");
  const spur = document.createElement("canvas");
  spur.className = "mehrband-spur";
  spur.setAttribute("aria-label", "Schläge, Einsätze und Takt der letzten Sekunden");
  box.append(bild, spur);
  ziel.prepend(box);

  const g = bild.getContext("2d"), gs = spur.getContext("2d");
  let farbe = "#ddd", grund = "#111", letzte = { werte: {}, spektrum: null };

  function groesse() {
    const dpr = window.devicePixelRatio || 1, b = Math.max(1, Math.round(box.clientWidth * dpr));
    if (bild.width !== b) {
      bild.width = spur.width = b;
      bild.height = Math.round(HOEHE * dpr);
      spur.height = Math.round(SPUR * dpr);
    }
    const stil = getComputedStyle(document.documentElement);
    farbe = stil.getPropertyValue("--text").trim() || farbe;
    grund = stil.getPropertyValue("--bg").trim() || grund;
    return dpr;
  }
  new ResizeObserver(() => {
    groesse();
    zeichne(letzte.werte, letzte.spektrum);
  }).observe(box);

  function zeichne(werte = {}, spektrum = null) {
    letzte = { werte, spektrum };
    const dpr = groesse(), B = bild.width, H = bild.height;
    g.fillStyle = grund;
    g.fillRect(0, 0, B, H);
    g.fillStyle = farbe;
    g.strokeStyle = farbe;
    // Balken
    if (spektrum) {
      const n = spektrum.length;
      g.globalAlpha = 0.45;
      for (let i = 0; i < n; i++) {
        const v = spektrum[i] > 1 ? spektrum[i] / 255 : spektrum[i];
        const x0 = Math.round((i / n) * B), x1 = Math.round(((i + 1) / n) * B);
        g.fillRect(x0, H - v * H, Math.max(1, x1 - x0 - 1), v * H);
      }
      g.globalAlpha = 1;
    }
    // Bereiche: Pegellinie und Name
    const xs = [0, zuX(grenzen.a) * B, zuX(grenzen.b) * B, B];
    g.font = `${11 * dpr}px monospace`;
    g.textBaseline = "top";
    NAMEN.forEach(([name, text], i) => {
      const v = werte[name] ?? 0, y = Math.round(H - v * (H - 16 * dpr)) - dpr;
      g.fillRect(xs[i] + 2 * dpr, y, xs[i + 1] - xs[i] - 4 * dpr, 2 * dpr);
      g.fillText(text, xs[i] + 4 * dpr, 3 * dpr);
    });
    // Grenzen: Linie, runder Griff (Knöpfe dürfen rund sein), Frequenz unten
    g.lineWidth = dpr;
    g.textBaseline = "bottom";
    for (const hz of [grenzen.a, grenzen.b]) {
      const x = Math.round(zuX(hz) * B) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
      g.beginPath();
      g.arc(x, H / 2, 5 * dpr, 0, Math.PI * 2);
      g.fillStyle = grund;
      g.fill();
      g.stroke();
      g.fillStyle = farbe;
      const t = hzText(hz), w = g.measureText(t).width;
      g.fillText(t, Math.min(B - w - 2 * dpr, x + 4 * dpr), H - 2 * dpr);
    }
    // Spur: ein Stück nach links schieben, rechts die neue Spalte (Helligkeit = Wert)
    const S = spur.height, schritt = Math.max(1, Math.round(dpr)), zeile = S / SPUREN.length;
    gs.drawImage(spur, -schritt, 0);
    gs.fillStyle = grund;
    gs.fillRect(spur.width - schritt, 0, schritt, S);
    gs.fillStyle = farbe;
    SPUREN.forEach(([name], i) => {
      const v = werte[name] ?? 0;
      if (v < 0.05) return;
      gs.globalAlpha = Math.min(1, v);
      gs.fillRect(spur.width - schritt, i * zeile + 2 * dpr, schritt, zeile - 4 * dpr);
    });
    gs.globalAlpha = 1;
    // Namen der Spuren links, über einem Streifen Grund (sonst laufen die Striche durch die Schrift)
    gs.font = `${10 * dpr}px monospace`;
    gs.textBaseline = "middle";
    const breite = gs.measureText("Einsatz ").width;
    gs.fillStyle = grund;
    gs.fillRect(0, 0, breite + 4 * dpr, S);
    gs.fillStyle = farbe;
    SPUREN.forEach(([, text], i) => gs.fillText(text, 2 * dpr, (i + 0.5) * zeile));
  }

  // Ziehen: die nähere Grenze nehmen (innerhalb von 12 Pixeln), Abstand mindestens eine halbe Oktave
  let zieht = null;
  const xVon = (ev) => {
    const r = bild.getBoundingClientRect();
    return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  };
  bild.addEventListener("pointerdown", (ev) => {
    const x = xVon(ev), breite = bild.getBoundingClientRect().width;
    const abstand = (hz) => Math.abs(zuX(hz) - x) * breite;
    const naechste = abstand(grenzen.a) <= abstand(grenzen.b) ? "a" : "b";
    if (abstand(grenzen[naechste]) > 12) return;
    zieht = naechste;
    bild.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  bild.addEventListener("pointermove", (ev) => {
    const x = xVon(ev), breite = bild.getBoundingClientRect().width;
    bild.style.cursor = zieht || [grenzen.a, grenzen.b].some((hz) => Math.abs(zuX(hz) - x) * breite < 12) ? "ew-resize" : "";
    if (!zieht) return;
    const hz = zuHz(x), halbeOktave = Math.SQRT2;
    if (zieht === "a") grenzen.a = Math.round(Math.min(Math.max(hz, 40), grenzen.b / halbeOktave));
    else grenzen.b = Math.round(Math.min(Math.max(hz, grenzen.a * halbeOktave), 12000));
    beiAenderung();
    zeichne(letzte.werte, letzte.spektrum);
  });
  bild.addEventListener("pointerup", () => (zieht = null));
  bild.addEventListener("pointercancel", () => (zieht = null));

  zeichne();
  return { zeichne };
}
