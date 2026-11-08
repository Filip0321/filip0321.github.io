// Chladni-Figuren: die Seite. Zusammengesteckt aus
//   platte.js  Eigenformen der Platte und wie stark jede bei einer Frequenz mitschwingt
//   sand.js    die Körner (springen, wo es schwingt, bleiben liegen, wo es still ist)
//   bild.js    Feld und Zeichnen auf der Grafikkarte
// Die Frequenz kommt vom Regler, wandert von selbst durch einen Bereich oder folgt der Musik.

import { moden, resonanzen, koeffizienten } from "./platte.js";
import { erstelleSand } from "./sand.js";
import { erstelleBild } from "./bild.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const G = 160; // Gitter für den Sand (das Bild selbst rechnet der Shader für jedes Pixel)

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const status = hole("status");
let bild;
try {
  bild = erstelleBild(canvas, G);
} catch (fehler) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = fehler.message;
  throw fehler;
}

// Zufall mit Startwert (der Sand im Video soll so fallen wie in der Vorschau)
let zs = 1;
function rnd() {
  zs = (zs + 0x6d2b79f5) | 0;
  let t = Math.imul(zs ^ (zs >>> 15), 1 | zs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

let sand = null;
let liste = [];
let zeit = 0;
let laeuft = true;
let exportLaeuft = false;
let musikFrequenz = 200; // geglättet, wenn die Frequenz der Musik folgt

const { einstellung: e, setze } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    rand: () => neueModen(),
    grundton: () => neueModen(),
    anregungX: () => spaeter(neueModen),
    anregungY: () => spaeter(neueModen),
    anzahl: () => neuerSand(),
    resonanz: () => {
      if (e.resonanz) setze("frequenz", Math.round(Number(e.resonanz)));
      setze("frequenzArt", "regler");
    },
    bildgroesse: () => {
      canvas.width = canvas.height = Number(e.bildgroesse);
    },
  },
});

function neueModen() {
  liste = moden(e.rand, e.grundton);
  // die Auswahl „Resonanzen“: alle Frequenzen bis 3000 Hz, an denen eine Mode liegt, die hier angeregt wird
  const wahl = document.querySelector('[data-wert="resonanz"]');
  wahl.replaceChildren(new Option("eine wählen …", ""));
  for (const r of resonanzen(e.rand, e.grundton, 3000, e.anregungX, e.anregungY)) {
    wahl.add(new Option(`${Math.round(r.f)} Hz  (${r.paare.join(" | ")})`, r.f));
  }
}
let wartet = 0;
function spaeter(f) {
  clearTimeout(wartet);
  wartet = setTimeout(f, 300);
}
function neuerSand() {
  zs = 7;
  sand = erstelleSand(e.anzahl, rnd);
}
hole("streuen").addEventListener("click", () => sand.streue());
const pauseKnopf = hole("pause");
pauseKnopf.addEventListener("click", () => {
  laeuft = !laeuft;
  pauseKnopf.textContent = laeuft ? "Pause" : "Weiter";
});

// ---------- Musik ----------
const musik = richteAudioreaktivEin({
  ziele: {
    frequenz: "Frequenz steigt",
    aufwirbeln: "Sand springt",
  },
  start: { schlag: "aufwirbeln" },
  beiStart: () => {},
});
// das Spektrum hat 64 Bänder von 30 bis 16000 Hz, logarithmisch (wie in audioreaktiv.js)
const bandFrequenz = (b) => 30 * (16000 / 30) ** ((b + 0.5) / 64);

// ---------- Frequenz ----------
// wandert: von → bis und zurück, logarithmisch (gleiche Zeit pro Oktave, wie man Tonhöhe hört)
function frequenzBei(t) {
  if (e.frequenzArt === "wandert") {
    const phase = (t / e.dauer) % 2;
    const s = phase < 1 ? phase : 2 - phase;
    return e.von * (e.bis / e.von) ** s;
  }
  if (e.frequenzArt === "musik") return musikFrequenz;
  return e.frequenz;
}
function folgeMusik(dt) {
  // das lauteste Band über 100 Hz; geglättet im Logarithmus (sonst springt es bei jedem Ton)
  let beste = -1;
  let wert = 20; // leiser als das gilt als Stille
  for (let b = 0; b < 64; b++) {
    if (bandFrequenz(b) < 100) continue;
    if (musik.spektrum[b] > wert) {
      wert = musik.spektrum[b];
      beste = b;
    }
  }
  if (beste < 0) return;
  const ziel = Math.log(bandFrequenz(beste));
  const jetzt = Math.log(musikFrequenz);
  musikFrequenz = Math.exp(jetzt + (ziel - jetzt) * Math.min(1, dt * 8));
}

// ---------- Ton hören ----------
let audio = null;
let oszillator = null;
let lautstaerke = null;
function tonJetzt(f) {
  const an = e.tonHoeren && e.frequenzArt !== "musik" && laeuft && !exportLaeuft;
  if (an && !audio) {
    audio = new AudioContext();
    oszillator = audio.createOscillator();
    lautstaerke = audio.createGain();
    lautstaerke.gain.value = 0;
    oszillator.connect(lautstaerke).connect(audio.destination);
    oszillator.start();
  }
  if (!audio) return;
  const t = audio.currentTime;
  oszillator.frequency.setTargetAtTime(f, t, 0.02);
  lautstaerke.gain.setTargetAtTime(an ? e.lautstaerke * 0.3 : 0, t, 0.05);
}
// für das Video: derselbe Sinus als Tonspur, mit der Frequenz, die zur Zeit jedes Bildes gilt
function sinusFuer(sekunden, ab) {
  const rate = 48000;
  const n = Math.ceil(sekunden * rate);
  const puffer = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: rate });
  const d = puffer.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * frequenzBei(ab + i / rate)) / rate; // Phase aufsummieren, sonst knackt es beim Wandern
    d[i] = Math.sin(phase) * e.lautstaerke * 0.3;
  }
  return puffer;
}

// ---------- ein Schritt ----------
let k = null;
let f = 200;
function schritt(dt) {
  zeit += dt;
  if (e.frequenzArt === "musik") folgeMusik(dt);
  f = frequenzBei(zeit) * (1 + 0.5 * (musik.wirkung.frequenz ?? 0));
  k = koeffizienten(liste, e.rand, f, e.daempfung, e.anregungX, e.anregungY);
  const feld = bild.feld(k, e.rand === "frei");
  sand.schritt(feld, G, dt, {
    sprung: e.sprung,
    sog: e.sog,
    aufwirbeln: 0.3 * (musik.wirkung.aufwirbeln ?? 0),
    rand: e.randArt,
  });
}
function zeichne() {
  if (!k) k = koeffizienten(liste, e.rand, frequenzBei(zeit), e.daempfung, e.anregungX, e.anregungY);
  const zuZahl = (hex) => hexZuRgb(hex).map((x) => x / 255);
  bild.zeige({
    k,
    frei: e.rand === "frei",
    grund: zuZahl(e.plattenFarbe),
    schwingung: zuZahl(e.schwingungFarbe),
    zeigen: e.schwingungZeigen,
    sand: [...zuZahl(e.sandFarbe), e.sandDeckkraft],
    groesse: e.korn * (canvas.width / 1024),
    lage: sand.lage,
    anzahl: sand.anzahl,
  });
}
function zeigeStatus() {
  // die nächste Resonanz und wie stark die Platte gerade schwingt
  let naechste = null;
  for (const m of liste) if (!naechste || Math.abs(m.f - f) < Math.abs(naechste.f - f)) naechste = m;
  const staerke = k ? k.staerkste : 0;
  status.textContent = `${Math.round(f)} Hz · nächste Resonanz ${Math.round(naechste.f)} Hz (${naechste.n}, ${naechste.m}) · Schwingung ${staerke.toFixed(2)}`;
}

// ---------- Schleife ----------
let vorher = performance.now();
let statusZeit = 0;
function schleife(jetzt) {
  // max(0, …): der Zeitstempel des ersten Bildes kann vor „vorher“ liegen, dann wäre dt negativ und √dt im Sand NaN
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    if (laeuft) schritt(dt);
    tonJetzt(f);
    zeichne();
    statusZeit += dt;
    if (statusZeit > 0.2) {
      statusZeit = 0;
      zeigeStatus();
    }
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
const render = {
  start(n) {
    exportLaeuft = true;
    tonJetzt(f);
    musik.exportStart(n, 30);
  },
  bild(i, dt) {
    musik.exportBild(i);
    schritt(dt);
    zeichne();
  },
  ende() {
    musik.exportEnde();
    exportLaeuft = false;
  },
  merke() {
    const lage = sand.lage.slice();
    const zeitVorher = zeit;
    const freqVorher = musikFrequenz;
    return () => {
      sand.lage.set(lage);
      zeit = zeitVorher;
      musikFrequenz = freqVorher;
      zeichne();
    };
  },
  // Vorschau: von hier aus i Bilder weiter (höchstens 300)
  vorschau(i, n, dt) {
    for (let j = 0; j < Math.min(i, 300); j++) schritt(dt);
    zeichne();
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "chladni",
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
  // Ton im Video: die Musikdatei, sonst (bei „Ton hören“) der Sinus der Platte
  tonFuer: (sekunden) => musik.tonFuerExport() ?? (e.tonHoeren && e.frequenzArt !== "musik" ? sinusFuer(sekunden, zeit) : null),
});

canvas.width = canvas.height = Number(e.bildgroesse);
neueModen();
neuerSand();
requestAnimationFrame(schleife);
