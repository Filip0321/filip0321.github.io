// Strömung (Stable Fluids nach Jos Stam): die Seite. Die Rechnung steht in fluid.js.
// Tinte kommt aus der Maus (ziehen), aus Strahlen, die von selbst spritzen, aus der Musik oder aus einem Foto.

import { erstelleFluid } from "./fluid.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const stapel = hole("stapel");
let fluid;
try {
  fluid = await erstelleFluid(canvas);
} catch (fehler) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = fehler.message;
  throw fehler;
}

let laeuft = true;
let exportLaeuft = false;
let zeit = 0;
let farbWinkel = 0; // Farbton, der bei „wandert“ weiterläuft
let foto = null;

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    gitter: () => neu(),
    bild: () => neu(),
    format: () => neu(),
    rand: () => neu(),
  },
});

// ---------- Größe ----------
const FORMATE = { quadrat: 1, quer: 16 / 9, hoch: 9 / 16 };
function neu() {
  const seiten = e.format === "foto" && foto ? foto.width / foto.height : FORMATE[e.format] ?? 1;
  // Gitter: Zellen auf der kürzeren Seite; Bild: Pixel auf der längeren
  const g = Number(e.gitter);
  const gb = Math.round(seiten >= 1 ? g * seiten : g);
  const gh = Math.round(seiten >= 1 ? g : g / seiten);
  const lang = Number(e.bild);
  const tb = Math.round(seiten >= 1 ? lang : lang * seiten);
  const th = Math.round(seiten >= 1 ? lang / seiten : lang);
  stapel.style.setProperty("--format", tb / th);
  fluid.neu(gb, gh, tb, th, e.rand === "herum");
  zeit = 0;
}
hole("leeren").addEventListener("click", () => neu());
hole("fotoDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  foto = await createImageBitmap(datei);
  if (e.format === "foto") neu();
  fluid.bildAlsTinte(foto);
});
hole("fotoNochmal").addEventListener("click", () => foto && fluid.bildAlsTinte(foto));
const pauseKnopf = hole("pause");
pauseKnopf.addEventListener("click", () => {
  laeuft = !laeuft;
  pauseKnopf.textContent = laeuft ? "Pause" : "Weiter";
});

// ---------- Farbe ----------
// Farbton (0 bis 1) → rgb
function ton(h) {
  return [0, 2 / 3, 1 / 3].map((v) => Math.min(1, Math.max(0, Math.abs(((h + v) % 1) * 6 - 3) - 1)));
}
function tintenFarbe(versatz = 0) {
  if (e.farbArt === "eigen") return hexZuRgb(e.tintenFarbe).map((x) => x / 255);
  if (e.farbArt === "zwei") return versatz % 2 < 1 ? hexZuRgb(e.tintenFarbe).map((x) => x / 255) : hexZuRgb(e.tintenFarbe2).map((x) => x / 255);
  return ton(farbWinkel + versatz * 0.17);
}
// ein Tintenklecks: Farbe mal Menge, Menge in a
const tinte = (rgb, menge) => [rgb[0] * menge, rgb[1] * menge, rgb[2] * menge, menge];

// ---------- Maus ----------
let maus = null; // { x, y, dx, dy } in 0 bis 1, solange gezogen wird
let mausFarbe = 0;
const stelle = (event) => {
  const r = canvas.getBoundingClientRect();
  return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
};
stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture?.(event.pointerId);
  maus = { ...stelle(event), dx: 0, dy: 0 };
  mausFarbe++;
});
stapel.addEventListener("pointermove", (event) => {
  if (!maus) return;
  const s = stelle(event);
  maus = { x: s.x, y: s.y, dx: maus.dx + s.x - maus.x, dy: maus.dy + s.y - maus.y };
});
for (const art of ["pointerup", "pointercancel"]) stapel.addEventListener(art, () => (maus = null));

// ---------- Musik ----------
const musik = richteAudioreaktivEin({
  ziele: {
    strahl: "Strahlen stärker",
    spritzer: "Spritzer",
    wirbel: "mehr Wirbel",
    farbe: "Farbe wandert",
  },
  start: { bass: "strahl", schlag: "spritzer" },
  beiStart: () => {},
});
let schlagVorher = 0;
let spritzerNr = 0;

// ---------- ein Schritt ----------
function schritt(dt) {
  zeit += dt;
  const w = musik.wirkung;
  farbWinkel = (farbWinkel + dt * (e.farbTempo + 0.3 * (w.farbe ?? 0))) % 1;
  const { gb, gh } = fluid.groesse();
  const r = e.klecks / 100;
  const kraft = [];
  const farbe = [];
  // Maus: Kraft in Richtung der Bewegung (in Zellen pro Sekunde), Tinte an derselben Stelle
  if (maus) {
    const vx = (maus.dx / dt) * gb * e.kraft * 0.1;
    const vy = (maus.dy / dt) * gh * e.kraft * 0.1;
    kraft.push({ x: maus.x, y: maus.y, r, wert: [vx, vy, 0, 0] });
    if (Math.hypot(maus.dx, maus.dy) > 0 || e.tintBeiKlick) farbe.push({ x: maus.x, y: maus.y, r, wert: tinte(tintenFarbe(mausFarbe), e.menge * 0.6) });
    maus.dx = maus.dy = 0;
  }
  // Strahlen: auf einem Kreis verteilt, drehen sich langsam, spritzen zur Mitte hin (leicht schräg, das gibt Wirbel)
  const staerke = e.strahlKraft * (1 + 2 * (w.strahl ?? 0));
  for (let i = 0; i < e.strahlen; i++) {
    const winkel = (i / e.strahlen) * Math.PI * 2 + zeit * e.strahlDrehen;
    const x = 0.5 + Math.cos(winkel) * 0.35;
    const y = 0.5 + Math.sin(winkel) * 0.35;
    const richtung = winkel + Math.PI + 0.35; // zur Mitte, etwas daneben
    kraft.push({ x, y, r: r * 0.8, wert: [Math.cos(richtung) * staerke * gb * 0.01, Math.sin(richtung) * staerke * gh * 0.01, 0, 0] });
    farbe.push({ x, y, r: r * 0.8, wert: tinte(tintenFarbe(i), e.menge * dt * 6) });
  }
  // Musik: ein Schlag spritzt an einer zufälligen Stelle in eine zufällige Richtung
  const s = w.spritzer ?? 0;
  if (s > 0.6 && schlagVorher <= 0.6) {
    spritzerNr++;
    const x = 0.15 + Math.random() * 0.7;
    const y = 0.15 + Math.random() * 0.7;
    const a = Math.random() * Math.PI * 2;
    kraft.push({ x, y, r: r * 1.5, wert: [Math.cos(a) * gb * 2 * e.kraft, Math.sin(a) * gh * 2 * e.kraft, 0, 0] });
    farbe.push({ x, y, r: r * 1.5, wert: tinte(tintenFarbe(spritzerNr * 3), e.menge) });
  }
  schlagVorher = s;
  fluid.schritt({
    dt,
    verblassen: e.verblassen,
    bremsen: e.bremsen,
    wirbel: e.wirbel * (1 + 2 * (w.wirbel ?? 0)),
    jacobi: e.jacobi,
    druckBehalten: e.druckBehalten,
    kraft,
    farbe,
  });
}
function zeige() {
  const art = { tinte: 0, tempo: 1, linien: 2, linienTinte: 3, linienFarbe: 4, schlieren: 5 }[e.ansicht];
  fluid.zeige({
    grund: hexZuRgb(e.grund).map((x) => x / 255), art, staerke: e.deckkraft, laenge: e.linienLaenge, koernung: e.linienKorn, zeit: zeit * e.linienFluss,
    schlierenArt: Number(e.schlierenArt), schlierenStaerke: e.schlierenStaerke, messerWinkel: e.messerWinkel,
  });
}

let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(1 / 30, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    if (laeuft && dt > 0) schritt(dt);
    zeige();
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
const render = {
  start(n) {
    exportLaeuft = true;
    musik.exportStart(n, 30);
  },
  bild(i, dt) {
    musik.exportBild(i);
    schritt(dt);
    zeige();
  },
  ende() {
    musik.exportEnde();
    exportLaeuft = false;
  },
  merke() {
    const zurueck = fluid.merke();
    const vorherZeit = zeit;
    const vorherFarbe = farbWinkel;
    return () => {
      zurueck();
      zeit = vorherZeit;
      farbWinkel = vorherFarbe;
    };
  },
  // Vorschau: von hier aus i Bilder weiter (höchstens 300)
  vorschau(i, n, dt) {
    for (let j = 0; j < Math.min(i, 300); j++) schritt(dt);
    zeige();
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "stroemung",
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
  ton: () => musik.tonFuerExport(),
});

neu();
requestAnimationFrame(schleife);
