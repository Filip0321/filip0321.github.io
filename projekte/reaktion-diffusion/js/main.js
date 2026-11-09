// Reaktion-Diffusion: die Seite. Zusammengesteckt aus
//   sim.js     die Rechnung auf der Grafikkarte (Gray-Scott, Ping-Pong, Pinsel, Grenze, Anzeige mit Relief)
//   formen.js  die Startformen (wo am Anfang V sitzt)
//   karte.js   die Karte der Muster (F nach oben, k nach rechts)
// Regler über /lib/regler.js (data-wert), Musik über /lib/audioreaktiv.js, Effekte und Export wie überall.

import { erstelleSim } from "./sim.js";
import { zeichneStart, zeichneStriche } from "./formen.js";
import { richteKarteEin } from "./karte.js";
import { richteReglerEin } from "/lib/regler.js";
import { farbtabelle, skalaAnker } from "/lib/farben.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

// F und k nach Karl Sims (dieselben Werte wie überall, wo dt = 1, Du = 1, Dv = 0,5)
const VORLAGEN = [
  { name: "Zellteilung", F: 0.0367, k: 0.0649 },
  { name: "Korallen", F: 0.0545, k: 0.062 },
  { name: "Labyrinth", F: 0.029, k: 0.057 },
  { name: "Würmer", F: 0.078, k: 0.061 },
  { name: "Löcher", F: 0.039, k: 0.058 },
  { name: "Wellen", F: 0.014, k: 0.045 },
  { name: "Pulsieren", F: 0.025, k: 0.06 },
];

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const stapel = hole("stapel");
let sim;
try {
  sim = erstelleSim(canvas);
} catch (fehler) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = fehler.message;
  throw fehler;
}

let foto = null; // Bitmap fürs Säen und für „F und k aus dem Foto“
let F = VORLAGEN[0].F;
let k = VORLAGEN[0].k;
let laeuft = true;
let einSchritt = false;
let zeit = 0; // Sekunden seit dem Säen (fürs Atmen; beim Video die Zeit des Bildes)
let pinsel = null; // { x, y } in 0 bis 1, solange gezeichnet wird
let schlagVorher = 0;
let zufallSaat = 1;

const { einstellung: e, setze } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    vorlage: () => nimmVorlage(),
    feinheit: () => neu(),
    format: () => neu(),
    form: () => neu(),
    skala: () => sim.setzeTabelle(tabelle()),
    bildgroesse: () => neu(),
  },
});
hole("startText").addEventListener("change", () => e.form === "text" && neu());

// ---------- Muster ----------
const karte = richteKarteEin(hole("karte"), VORLAGEN, (wahl) => {
  F = wahl.F;
  k = wahl.k;
  setze("vorlage", "frei");
});
function nimmVorlage() {
  const v = VORLAGEN.find((x) => x.name === e.vorlage);
  if (!v) return;
  F = v.F;
  k = v.k;
  karte.setze(F, k);
}
// die Auswahl der Vorlagen für dunkel und hell (F und k aus dem Foto) aus derselben Liste bauen
for (const id of ["vorlage", "musterDunkel", "musterHell"]) {
  const wahl = document.querySelector(`[data-wert="${id}"]`);
  for (const v of VORLAGEN) wahl.add(new Option(v.name, v.name));
  if (id === "vorlage") wahl.add(new Option("frei (auf der Karte)", "frei"));
}
setze("vorlage", "Zellteilung");
setze("musterDunkel", "Zellteilung");
setze("musterHell", "Labyrinth");
const fkVon = (name) => VORLAGEN.find((v) => v.name === name) ?? VORLAGEN[0];

// Farben: die Skalen aus /lib/farben.js, dazu „Schwarz auf Weiß“ (ohne V weiß, mit V schwarz)
const WEISS = [[255, 255, 255], [0, 0, 0]];
const tabelle = () => farbtabelle(e.skala === "weiss" ? WEISS : skalaAnker(e.skala));

// ---------- Größe und Säen ----------
const FORMATE = { quadrat: 1, "1:1": 1, quer: 16 / 9, "16:9": 16 / 9, "4:3": 4 / 3, hoch: 9 / 16, "9:16": 9 / 16, "4:5": 4 / 5, "3:2": 3 / 2, "21:9": 21 / 9 };
function neu() {
  const seiten = e.format === "foto" && foto ? foto.width / foto.height : FORMATE[e.format] ?? 1;
  // Feinheit = Zellen auf der längeren Seite
  const b = Math.round(seiten >= 1 ? e.feinheit : e.feinheit * seiten);
  const h = Math.round(seiten >= 1 ? e.feinheit / seiten : e.feinheit);
  sim.groesse(b, h);
  // Bildgröße: „auto“ doppelt so fein wie das Gitter (bilinear dazwischen), höchstens 2048; sonst so viele Pixel
  // auf der längeren Seite. Feiner als das Gitter lohnt sich vor allem mit „Kante“ (glatte Linien statt Treppen)
  const f = e.bildgroesse === "auto" ? Math.min(2, 2048 / Math.max(b, h)) : Number(e.bildgroesse) / Math.max(b, h);
  canvas.width = Math.round(b * f);
  canvas.height = Math.round(h * f);
  stapel.style.setProperty("--format", b / h);
  stapel.style.setProperty("--verhaeltnis", b / h); // rd.css: Seitenverhältnis des Felds
  // selbst zeichnen: erst leer und still, gesät wird mit „los wachsen“
  zeichnet = e.form === "zeichnen";
  sim.saeen(zeichneStart(b, h, zeichnet ? "leer" : e.form, { text: hole("startText").value, foto, schwelle: e.fotoSchwelle, saat: zufallSaat }));
  zeichnung.width = b;
  zeichnung.height = h;
  zeigeZeichnung();
  zeit = 0;
}

// ---------- Startlinie selbst zeichnen ----------
// die Striche liegen als Linien über dem Feld (eigene Leinwand, kommt nicht in den Export); „los wachsen“ sät sie
const zeichnung = hole("zeichnung");
let zeichnet = false;
let striche = []; // [{ breite (Zellen), punkte: [{ x, y }] }], bleiben auch nach dem Säen (für „neu säen“)
function zeigeZeichnung() {
  zeichnung.hidden = !zeichnet;
  const z = zeichnung.getContext("2d");
  z.clearRect(0, 0, zeichnung.width, zeichnung.height);
  z.strokeStyle = "rgba(255, 255, 255, 0.85)";
  zeichneStriche(z, zeichnung.width, zeichnung.height, striche);
}
hole("losWachsen").addEventListener("click", () => {
  if (!zeichnet) neu(); // schon gewachsen: noch einmal von vorn mit denselben Strichen
  const { width: b, height: h } = zeichnung;
  sim.saeen(zeichneStart(b, h, "zeichnen", { striche }));
  zeichnet = false;
  zeigeZeichnung();
  zeit = 0;
  laeuft = true;
  pauseKnopf.textContent = "Pause";
});
hole("strichZurueck").addEventListener("click", () => {
  striche.pop();
  zeigeZeichnung();
});
hole("stricheLeeren").addEventListener("click", () => {
  striche = [];
  if (e.form === "zeichnen") neu();
});
hole("neuSaeen").addEventListener("click", () => {
  zufallSaat++; // „Zufall“ sät beim nächsten Mal anders
  neu();
});
hole("fotoDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  foto = await createImageBitmap(datei);
  sim.setzeFoto(foto);
  if (e.form === "foto" || e.format === "foto") neu();
});

const pauseKnopf = hole("pause");
pauseKnopf.addEventListener("click", () => {
  laeuft = !laeuft;
  pauseKnopf.textContent = laeuft ? "Pause" : "Weiter";
});
hole("schritt").addEventListener("click", () => (einSchritt = true));

// ---------- Zeichnen ----------
// ziehen auf dem Bild sät (oder löscht), auch während es läuft
const stelle = (event) => {
  const r = canvas.getBoundingClientRect();
  return { x: (event.clientX - r.left) / r.width, y: 1 - (event.clientY - r.top) / r.height };
};
// beim Zeichnen der Startlinie: ein Strich (y von oben, wie in der Leinwand)
let strich = null;
stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture?.(event.pointerId);
  if (zeichnet) {
    const p = stelle(event);
    strich = { breite: e.strichBreite, punkte: [{ x: p.x, y: 1 - p.y }] };
    striche.push(strich);
    zeigeZeichnung();
    return;
  }
  pinsel = stelle(event);
});
stapel.addEventListener("pointermove", (event) => {
  if (strich) {
    const p = stelle(event);
    strich.punkte.push({ x: p.x, y: 1 - p.y });
    zeigeZeichnung();
  } else if (pinsel) pinsel = stelle(event);
});
for (const art of ["pointerup", "pointercancel"]) {
  stapel.addEventListener(art, () => {
    pinsel = null;
    strich = null;
  });
}

// ---------- Musik ----------
// musik.wirkung.<ziel> ist 0 bis etwa 2 (wie stark das zugeordnete Signal gerade ist)
const musik = richteAudioreaktivEin({
  ziele: {
    tempo: "Wachstum schneller",
    saat: "Schlag sät neu",
    radius: "Radius atmet",
    futter: "Futter (F) steigt",
    farbe: "Farbe wandert",
  },
  start: { bass: "tempo", schlag: "saat" },
  beiStart: () => {},
});

// ---------- ein Bild ----------
let farbVerschiebung = 0;
function werteJetzt() {
  const w = musik.wirkung;
  // Atmen: der Radius schwingt langsam (Periode in Sekunden), dazu die Musik
  const atmen = e.atmen * Math.sin((2 * Math.PI * zeit) / e.periode) + 0.15 * (w.radius ?? 0);
  // ein Schlag sät an einer zufälligen Stelle innerhalb der Grenze
  let saat = [0, 0, 0, 0];
  const s = w.saat ?? 0;
  if (s > 0.6 && schlagVorher <= 0.6) {
    const winkel = Math.random() * Math.PI * 2;
    const abstand = Math.random() * (e.grenze === "kreis" ? e.radius * 0.4 : 0.45);
    saat = [0.5 + Math.cos(winkel) * abstand, 0.5 + Math.sin(winkel) * abstand, 0.025, 1];
  }
  schlagVorher = s;
  const d = fkVon(e.musterDunkel);
  const h = fkVon(e.musterHell);
  return {
    F: F + 0.004 * (w.futter ?? 0),
    k,
    fkFoto: [d.F, d.k, h.F, h.k],
    art: { gleich: 0, verlauf: 1, foto: 2 }[e.fkArt],
    spanne: e.spanne,
    radius: e.grenze === "kreis" ? Math.max(0.05, e.radius * (1 + atmen)) : 0,
    rand: e.rand,
    richtung: e.richtung,
    winkel: (e.winkel * Math.PI) / 180,
    pinsel: pinsel ? [pinsel.x, pinsel.y, e.pinselGroesse / 100, e.pinselArt === "saeen" ? 1 : -1] : saat,
  };
}
function anzeige() {
  return {
    wert: e.wert === "uv" ? 1 : 0,
    kontrast: e.kontrast,
    verschieben: farbVerschiebung,
    relief: e.relief,
    licht: (e.licht * Math.PI) / 180,
    umkehren: e.umkehren ? 1 : 0,
    kante: e.kante,
  };
}
// schritte: so viele Schritte für dieses Bild; dt: Sekunden seit dem letzten
function bild(schritte, dt) {
  zeit += dt;
  farbVerschiebung = (farbVerschiebung + 0.2 * (musik.wirkung.farbe ?? 0) * dt) % 1;
  if (schritte > 0) sim.schritte(schritte, werteJetzt());
  sim.zeige(anzeige());
}

let vorher = performance.now();
let exportLaeuft = false;
function schleife(jetzt) {
  const dt = Math.min(0.1, Math.max(0, (jetzt - vorher) / 1000)); // der erste Zeitstempel kann vor „vorher“ liegen
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    // Tempo: Schritte pro Bild bei 60 Bildern pro Sekunde; die Musik macht es bis dreimal so schnell
    let n = laeuft && !zeichnet ? Math.round(e.tempo * (dt * 60) * (1 + 2 * (musik.wirkung.tempo ?? 0))) : 0;
    if (einSchritt) {
      n = Math.max(n, 1);
      einSchritt = false;
    }
    // auch in der Pause: der Pinsel malt (ein Schritt, damit er im Zustand ankommt)
    if (!laeuft && pinsel && !zeichnet) n = 1;
    bild(n, laeuft ? dt : 0);
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
// Video: jedes Bild bekommt tempo · (dt · 60) Schritte, so wächst es im Video so schnell wie in der Vorschau
const render = {
  start(n) {
    exportLaeuft = true;
    musik.exportStart(n, 30);
  },
  bild(i, dt) {
    musik.exportBild(i);
    bild(Math.round(e.tempo * dt * 60 * (1 + 2 * (musik.wirkung.tempo ?? 0))), dt);
  },
  ende() {
    musik.exportEnde();
    exportLaeuft = false;
  },
  merke() {
    const zurueck = sim.merke();
    const zeitVorher = zeit;
    return () => {
      zurueck();
      zeit = zeitVorher;
    };
  },
  // Bild i der Vorschau: von hier aus i Bilder weiter (höchstens 600, sonst dauert die Vorschau zu lange)
  vorschau(i, n, dt) {
    const bilder = Math.min(i, 600);
    sim.schritte(Math.round(e.tempo * dt * 60) * bilder, werteJetzt());
    sim.zeige(anzeige());
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "reaktion-diffusion",
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
  ton: () => musik.tonFuerExport(),
});

sim.setzeTabelle(tabelle());
neu();
requestAnimationFrame(schleife);
