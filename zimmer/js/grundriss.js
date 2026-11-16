// Grundriss: in der Draufsicht die Ecken des Zimmers anklicken. Daraus
//   der Mittelpunkt (für den Rundblick: dort steht man und dreht sich),
//   die Bodenhöhe (geschätzt aus den Splats im Grundriss; dazu die Augenhöhe),
//   wahlweise ein Zuschnitt: alles außerhalb (plus ein Rand) wird ausgeblendet.
//
// Draufsicht: eine Kamera senkrecht über dem Zimmer mit engem Sichtfeld (25°), fast wie ein Plan. Die Decke würde
// alles verdecken, darum zeigt sie nur Splats unterhalb der Schnitthöhe (zeichnen.js lässt die anderen weg).
//
// Mittelpunkt = Flächenschwerpunkt des Vielecks, nicht der Mittelwert der Ecken: bei einem L-förmigen Zimmer mit
// vielen Ecken an einer Stelle würde der Mittelwert dorthin rutschen. Mit der Gaußschen Trapezformel
// („Shoelace“), über alle Kanten (x₀, z₀) → (x₁, z₁):
//   a  = x₀ z₁ − x₁ z₀          (doppelte Fläche des Dreiecks aus Ursprung und Kante, mit Vorzeichen)
//   A  = ½ Σ a                   (Fläche)
//   Sx = Σ (x₀ + x₁) · a / (6 A),  Sz = Σ (z₀ + z₁) · a / (6 A)
// Der Schwerpunkt kann bei sehr verwinkelten Zimmern außerhalb liegen; dann den Punkt von Hand ziehen.
//
// Drinnen oder draußen (fürs Zuschneiden): ein Strahl vom Punkt nach +x; kreuzt er die Kanten ungerade oft, liegt
// der Punkt drin („Even-odd-Regel“). Dazu bleibt alles, was näher als „Rand“ an einer Kante liegt.

import { z, neu, runde, zeige, bildpunkt } from "./zustand.js";
import { erstelleKamera } from "./kamera.js";

const svg = document.getElementById("grundriss");
const NS = "http://www.w3.org/2000/svg";
let ueberBoden = 1.8; // Schnitthöhe über dem Boden
let eckenSetzen = false;

const g = () => (z.einst.grundriss ??= { punkte: [], mitte: null, boden: null, augenhoehe: 1.6, zuschneiden: false, rand: 0.2 });
const hatGrundriss = () => (z.einst.grundriss?.punkte?.length ?? 0) >= 3;

// ---------- Rechnen ----------
export function schwerpunkt(punkte) {
  let A = 0, sx = 0, sz = 0;
  for (let i = 0; i < punkte.length; i++) {
    const [x0, z0] = punkte[i], [x1, z1] = punkte[(i + 1) % punkte.length];
    const a = x0 * z1 - x1 * z0;
    A += a / 2;
    sx += (x0 + x1) * a;
    sz += (z0 + z1) * a;
  }
  if (Math.abs(A) < 1e-9) return null;
  return [sx / (6 * A), sz / (6 * A)];
}

export function innen(x, zz, punkte) {
  let drin = false;
  for (let i = 0, j = punkte.length - 1; i < punkte.length; j = i++) {
    const [xi, zi] = punkte[i], [xj, zj] = punkte[j];
    if (zi > zz !== zj > zz && x < ((xj - xi) * (zz - zi)) / (zj - zi) + xi) drin = !drin;
  }
  return drin;
}

function abstandZurKante(x, zz, [x0, z0], [x1, z1]) {
  const dx = x1 - x0, dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (zz - z0) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - x0 - t * dx, zz - z0 - t * dz);
}

function nahAmRand(x, zz, punkte, rand) {
  for (let i = 0; i < punkte.length; i++) if (abstandZurKante(x, zz, punkte[i], punkte[(i + 1) % punkte.length]) < rand) return true;
  return false;
}

export function mittelpunkt() {
  const gr = z.einst.grundriss;
  if (gr?.mitte) return gr.mitte;
  if (hatGrundriss()) return schwerpunkt(gr.punkte);
  return [z.kamera.ziel[0], z.kamera.ziel[2]];
}

// Boden: die Höhe, unter der nur 3 % der Splats im Grundriss liegen (der unterste Punkt wäre ein Ausreißer)
export function schaetzeBoden() {
  const { lage, anzahl } = z.roh;
  const gr = z.einst.grundriss;
  const schritt = Math.max(1, Math.floor(anzahl / 60000));
  const ys = [];
  for (let i = 0; i < anzahl; i += schritt) {
    if (hatGrundriss() && !innen(lage[3 * i], lage[3 * i + 2], gr.punkte)) continue;
    ys.push(lage[3 * i + 1]);
  }
  if (!ys.length) return z.kamera.ziel[1];
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length * 0.03)];
}

const boden = () => z.einst.grundriss?.boden ?? z.kamera.ziel[1] - 1;
export const schnitthoehe = () => boden() + ueberBoden;

// ---------- Zuschneiden ----------
export function wendeGrundrissAn() {
  const gr = z.einst.grundriss;
  if (!gr?.zuschneiden || !hatGrundriss()) {
    z.szene = z.roh;
  } else {
    const { lage, kov, farbe, anzahl } = z.roh;
    const behalten = [];
    for (let i = 0; i < anzahl; i++) {
      const x = lage[3 * i], zz = lage[3 * i + 2];
      if (innen(x, zz, gr.punkte) || nahAmRand(x, zz, gr.punkte, gr.rand ?? 0.2)) behalten.push(i);
    }
    const n = behalten.length;
    const s = { anzahl: n, lage: new Float32Array(3 * n), kov: new Float32Array(6 * n), farbe: new Uint8Array(4 * n) };
    behalten.forEach((i, j) => {
      s.lage.set(lage.subarray(3 * i, 3 * i + 3), 3 * j);
      s.kov.set(kov.subarray(6 * i, 6 * i + 6), 6 * j);
      s.farbe.set(farbe.subarray(4 * i, 4 * i + 4), 4 * j);
    });
    z.szene = s;
  }
  z.beiNeuerSzene();
}

// ---------- Rundblick-Kamera: im Mittelpunkt, auf Augenhöhe ----------
export function baueRundKamera() {
  const [mx, mz] = mittelpunkt() ?? [z.kamera.ziel[0], z.kamera.ziel[2]];
  const r = z.einst.rundblick ?? {};
  const alt = z.rund;
  z.rund = erstelleKamera({
    ziel: [mx, boden() + (z.einst.grundriss?.augenhoehe ?? 1.6), mz],
    gier: alt?.gier ?? r.gier ?? 0,
    nick: alt?.nick ?? r.nick ?? 0,
    abstand: 0,
    sichtfeld: alt?.sichtfeld ?? r.sichtfeld ?? 75,
  });
  neu();
}

// ---------- Draufsicht ----------
export function setzeDraufsicht(an) {
  z.draufsicht = an;
  svg.toggleAttribute("hidden", !an); // svg kennt die Eigenschaft .hidden nicht, nur das Attribut
  z.ebene.hidden = an;
  if (an && !z.oben.schonBenutzt) {
    // beim ersten Mal: über die Mitte des Scans (ohne Ausreißer), so hoch, dass alles ins Bild passt
    const { lage, anzahl } = z.roh;
    const xs = [], zs = [];
    for (let i = 0; i < anzahl; i += Math.max(1, Math.floor(anzahl / 20000))) {
      xs.push(lage[3 * i]);
      zs.push(lage[3 * i + 2]);
    }
    const grenzen = (a) => (a.sort((p, q) => p - q), [a[Math.floor(a.length * 0.03)], a[Math.floor(a.length * 0.97)]]);
    const [x0, x1] = grenzen(xs), [z0, z1] = grenzen(zs);
    z.oben.ziel = [(x0 + x1) / 2, boden(), (z0 + z1) / 2];
    // die kürzere Bildseite reicht in diesem Abstand über Abstand · tan(Sichtfeld / 2) · 16/9 · kurz/lang
    // (so rechnet kamera.js die Brennweite); das Zimmer soll etwa 80 % davon füllen
    const kurzLang = Math.min(z.canvas.width, z.canvas.height) / Math.max(z.canvas.width, z.canvas.height);
    const halb = Math.tan((z.oben.sichtfeld * Math.PI) / 360) * (16 / 9) * kurzLang;
    z.oben.abstand = (Math.max(x1 - x0, z1 - z0, 1) * 0.62) / halb;
    z.oben.schonBenutzt = true;
  }
  neu();
}

// Punkt auf dem Bildschirm → (x, z) auf der Bodenebene
function aufBoden(ev) {
  const [px, py] = bildpunkt(ev);
  const { anfang, richtung } = z.oben.strahl(px, py, z.canvas.width, z.canvas.height);
  const t = (boden() - anfang[1]) / richtung[1];
  return [anfang[0] + richtung[0] * t, anfang[2] + richtung[2] * t];
}

// (x, z) → CSS-Pixel über dem Canvas
function aufSchirm([x, zz]) {
  const p = z.oben.aufBildschirm([x, boden(), zz], z.canvas.width, z.canvas.height);
  const f = z.canvas.clientWidth / z.canvas.width;
  return p ? [p.x * f, p.y * f] : [NaN, NaN];
}

// ein Klick in die Draufsicht (aus steuerung.js, nur wenn kaum gezogen wurde)
z.klickOben = (ev) => {
  if (!eckenSetzen) return;
  const p = aufBoden(ev).map(runde);
  const punkte = g().punkte;
  // nahe an einer Kante (12 Pixel)? Dann dort einfügen, sonst hinten anhängen
  const [cx, cy] = bildpunkt(ev).map((v) => v * (z.canvas.clientWidth / z.canvas.width));
  let beste = -1, besterAbstand = 12;
  if (punkte.length >= 3) {
    for (let i = 0; i < punkte.length; i++) {
      const a = aufSchirm(punkte[i]), b = aufSchirm(punkte[(i + 1) % punkte.length]);
      const d = abstandZurKante(cx, cy, a, b);
      if (d < besterAbstand) [beste, besterAbstand] = [i, d];
    }
  }
  if (beste >= 0) punkte.splice(beste + 1, 0, p);
  else punkte.push(p);
  grundrissGeaendert();
};

let zuschnittUhr = 0;
function grundrissGeaendert(sofort = false) {
  const gr = g();
  if (hatGrundriss() && gr.bodenVonHand !== true) gr.boden = runde(schaetzeBoden());
  if (felder.boden) felder.boden.value = gr.boden ?? "";
  baueRundKamera();
  neu();
  // Zuschneiden kostet bei einer Million Splats spürbar: erst, wenn eine Weile nichts geändert wurde
  clearTimeout(zuschnittUhr);
  if (gr.zuschneiden) zuschnittUhr = setTimeout(wendeGrundrissAn, sofort ? 0 : 400);
}

// ---------- Zeichnen der Ecken (SVG über dem Canvas, in jedem Bild aus main.js) ----------
let ziehePunkt = null;
export function zeichneGrundriss() {
  if (!z.draufsicht) return;
  const gr = g();
  const ecken = gr.punkte.map(aufSchirm);
  const teile = [];
  if (ecken.length >= 2) {
    const pfad = ecken.map(([x, y]) => `${x},${y}`).join(" ");
    teile.push(`<polygon points="${pfad}" class="flaeche"/>`);
  }
  ecken.forEach(([x, y], i) => teile.push(`<circle cx="${x}" cy="${y}" r="7" data-ecke="${i}" class="ecke"/>`));
  const m = mittelpunkt();
  if (m) {
    const [x, y] = aufSchirm(m);
    teile.push(`<g class="mitte${gr.mitte ? " von-hand" : ""}" data-mitte="1"><circle cx="${x}" cy="${y}" r="11"/>` +
      `<line x1="${x - 16}" y1="${y}" x2="${x + 16}" y2="${y}"/><line x1="${x}" y1="${y - 16}" x2="${x}" y2="${y + 16}"/></g>`);
  }
  svg.innerHTML = teile.join("");
}

// Ecken und Mitte ziehen, Ecke mit Rechtsklick oder Doppelklick löschen
svg.addEventListener("pointerdown", (ev) => {
  const ecke = ev.target.closest("[data-ecke]");
  const mitte = ev.target.closest("[data-mitte]");
  if (!ecke && !mitte) return;
  ev.stopPropagation();
  if (ecke && ev.button === 2) return loescheEcke(Number(ecke.dataset.ecke));
  svg.setPointerCapture(ev.pointerId);
  ziehePunkt = ecke ? Number(ecke.dataset.ecke) : "mitte";
});
svg.addEventListener("pointermove", (ev) => {
  if (ziehePunkt === null) return;
  const p = aufBoden(ev).map(runde);
  if (ziehePunkt === "mitte") g().mitte = p;
  else g().punkte[ziehePunkt] = p;
  baueRundKamera();
  neu();
});
svg.addEventListener("pointerup", () => {
  if (ziehePunkt === null) return;
  ziehePunkt = null;
  grundrissGeaendert();
});
svg.addEventListener("dblclick", (ev) => {
  const ecke = ev.target.closest("[data-ecke]");
  if (ecke) loescheEcke(Number(ecke.dataset.ecke));
});
svg.addEventListener("contextmenu", (ev) => ev.preventDefault());
function loescheEcke(i) {
  g().punkte.splice(i, 1);
  grundrissGeaendert();
}

// ---------- Leiste ----------
const felder = {};
export function richteGrundrissEin() {
  const hole = (id) => document.getElementById(id);
  Object.assign(felder, {
    boden: hole("gr-boden"),
    auge: hole("gr-auge"),
    schnitt: hole("gr-schnitt"),
    zuschneiden: hole("gr-zuschneiden"),
    rand: hole("gr-rand"),
    drehen: hole("gr-drehen"),
  });
  const gr = z.einst.grundriss;
  felder.boden.value = gr?.boden ?? "";
  felder.auge.value = gr?.augenhoehe ?? 1.6;
  felder.zuschneiden.checked = !!gr?.zuschneiden;
  felder.rand.value = gr?.rand ?? 0.2;
  felder.schnitt.value = ueberBoden;
  felder.drehen.value = z.einst.rundblick?.drehen ?? 2;

  const draufKnopf = hole("gr-draufsicht");
  draufKnopf.addEventListener("click", () => {
    setzeDraufsicht(!z.draufsicht);
    draufKnopf.classList.toggle("aktiv", z.draufsicht);
    if (!z.draufsicht && eckenSetzen) eckenKnopf.click();
  });
  const eckenKnopf = hole("gr-ecken");
  eckenKnopf.addEventListener("click", () => {
    eckenSetzen = !eckenSetzen;
    eckenKnopf.classList.toggle("aktiv", eckenSetzen);
    if (eckenSetzen && !z.draufsicht) draufKnopf.click();
    zeige(eckenSetzen ? "Ecken anklicken (der Reihe nach, rundherum). Ziehen verschiebt die Ansicht, Ecken lassen sich ziehen, Rechtsklick löscht." : "", 6000);
  });
  hole("gr-leeren").addEventListener("click", () => {
    g().punkte = [];
    g().mitte = null;
    grundrissGeaendert(true);
  });
  hole("gr-mitte-auto").addEventListener("click", () => {
    g().mitte = null;
    grundrissGeaendert();
  });
  felder.boden.addEventListener("change", () => {
    const v = parseFloat(felder.boden.value);
    g().boden = isFinite(v) ? v : null;
    g().bodenVonHand = isFinite(v); // dann nicht mehr neu schätzen
    grundrissGeaendert();
  });
  felder.auge.addEventListener("input", () => {
    g().augenhoehe = Number(felder.auge.value) || 1.6;
    baueRundKamera();
  });
  felder.schnitt.addEventListener("input", () => {
    ueberBoden = Number(felder.schnitt.value);
    neu();
  });
  felder.zuschneiden.addEventListener("change", () => {
    g().zuschneiden = felder.zuschneiden.checked;
    if (g().zuschneiden && !hatGrundriss()) zeige("Erst einen Grundriss mit mindestens drei Ecken zeichnen.", 3000);
    wendeGrundrissAn();
  });
  felder.rand.addEventListener("change", () => {
    g().rand = Number(felder.rand.value) || 0;
    if (g().zuschneiden) wendeGrundrissAn();
  });
  felder.drehen.addEventListener("change", () => {
    (z.einst.rundblick ??= {}).drehen = Number(felder.drehen.value) || 0;
  });
}
