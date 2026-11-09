// Stimmensynthesizer: die Seite. Zusammengesteckt aus
//   stimme-worklet.js  der Klang (Kehlkopf, Rohr, Nase) im Audio-Thread
//   bild.js            Schnitt durch Kopf und Hals, Tastatur, Spektrum; und was unter dem Finger liegt
//   laute.js           wie das Rohr für jeden Laut aussieht, Lautschrift (SAMPA) als Folge davon
//   deutsch.js         deutscher Text → Lautschrift
//   englisch.js        englischer Text → Lautschrift
// Die Seite schickt etwa 60-mal pro Sekunde alle Werte an den Klang; der schickt zurück, wie das Rohr gerade
// aussieht (es folgt den Zielen mit etwas Verzögerung, wie Muskeln).

import { geometrie, wasIstBei, zeichne } from "./bild.js";
import { naechsterVokal, lautschriftZuFolge, zerlege, tonFuer, formantKlang } from "./laute.js";
import { deutschZuLautschrift } from "./deutsch.js";
import { englischZuLautschrift } from "./englisch.js";
import { richteReglerEin } from "/lib/regler.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { alsWav } from "/projekte/databending/js/wav.js";

const VERSTAERKUNG = 2.5; // der Klang kommt leise aus dem Rohr (× 0,125, damit nichts übersteuert)
const NASE = 28;

const canvas = hole("feld");
const ctx = canvas.getContext("2d");
const status = hole("status");
let g = geometrie(canvas.width, canvas.height);

// Form der Nase (wie im Worklet), nur fürs Bild
const nasenForm = new Float32Array(NASE);
for (let i = 0; i < NASE; i++) {
  const d = (2 * i) / NASE;
  nasenForm[i] = Math.min(1.9, d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d));
}

const { einstellung: e, setze } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    aufloesung: () => neueGroesse(),
    sprache: () => {
      text.value = e.sprache === "englisch" ? "Hello, I am a voice made of pipes." : "Hallo, ich bin eine Stimme aus Rohren.";
      uebersetze();
    },
  },
});
function neueGroesse() {
  canvas.width = Number(e.aufloesung);
  canvas.height = Math.round(Number(e.aufloesung) * 0.75);
  g = geometrie(canvas.width, canvas.height);
}

// ---------- Ton ----------
let audio = null;
let knoten = null;
let analyser = null;
let spektrum = null;
let startet = null;
const rohr = { d: new Float32Array(44).fill(1.5), velum: 0.01, f: 120, phase: 0 };
let aufnahme = null; // Liste von Blöcken, solange aufgenommen wird

function starte() {
  startet ??= (async () => {
    audio = new AudioContext();
    await audio.audioWorklet.addModule(new URL("./stimme-worklet.js", import.meta.url));
    knoten = new AudioWorkletNode(audio, "stimme", { numberOfInputs: 0, outputChannelCount: [1] });
    knoten.port.onmessage = (m) => {
      if (m.data.ton) aufnahme?.push(m.data.ton);
      else Object.assign(rohr, m.data);
    };
    const laut = new GainNode(audio, { gain: VERSTAERKUNG });
    analyser = new AnalyserNode(audio, { fftSize: 2048, smoothingTimeConstant: 0.6 });
    spektrum = new Float32Array(analyser.frequencyBinCount);
    knoten.connect(laut).connect(analyser).connect(audio.destination);
    tonKnopf.textContent = "Ton aus";
  })();
  return startet;
}
const tonKnopf = hole("ton");
tonKnopf.addEventListener("click", async () => {
  if (!audio) return starte();
  if (audio.state === "running") {
    await audio.suspend();
    tonKnopf.textContent = "Ton an";
  } else {
    await audio.resume();
    tonKnopf.textContent = "Ton aus";
  }
});

// ---------- Finger und Maus ----------
const finger = new Map(); // pointerId → was er hält (Zunge, Engstelle, Tastatur)
let taste = null;
function koord(ev) {
  const r = canvas.getBoundingClientRect();
  return [((ev.clientX - r.left) * canvas.width) / r.width, ((ev.clientY - r.top) * canvas.height) / r.height];
}
function halte(id, was) {
  finger.set(id, was);
  if (was.art === "zunge") {
    setze("zungeOrt", Math.round(was.ort * 10) / 10);
    setze("zungeWeite", Math.round(was.weite * 100) / 100);
  } else if (was.art === "tasten") {
    let halbtoene = was.x * 24;
    if (e.einrasten) halbtoene = Math.round(halbtoene);
    setze("frequenz", Math.round(e.tastenVon * 2 ** (halbtoene / 12)));
    setze("spannung", Math.round((1 - 0.75 * was.y) * 100) / 100);
    taste = was;
  }
}
canvas.addEventListener("pointerdown", (ev) => {
  starte();
  const was = wasIstBei(g, ...koord(ev));
  if (was.art === "nichts") return;
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  halte(ev.pointerId, was);
});
canvas.addEventListener("pointermove", (ev) => {
  const vorher = finger.get(ev.pointerId);
  if (vorher) halte(ev.pointerId, wasIstBei(g, ...koord(ev), vorher.art));
});
function loslassen(ev) {
  if (finger.get(ev.pointerId)?.art === "tasten") taste = null;
  finger.delete(ev.pointerId);
}
canvas.addEventListener("pointerup", loslassen);
canvas.addEventListener("pointercancel", loslassen);

// ---------- Sprechen ----------
// Die Folge läuft an der Uhr des Tons (audio.currentTime): so stimmt die Aufnahme, auch wenn ein Bild ruckelt.
let folge = null;
let stumm = false; // nach „sprechen und speichern“: still, bis der Nachhall aufgenommen ist
let zs = 1;
function rnd() {
  zs = (zs + 0x6d2b79f5) | 0;
  let t = Math.imul(zs ^ (zs >>> 15), 1 | zs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
async function sprich(mitAufnahme) {
  await starte();
  if (audio.state !== "running") await audio.resume();
  const schritte = lautschriftZuFolge(lautschrift.value);
  if (!schritte.length) return;
  // Melodie: jeder Vokal bekommt seinen Ton, Konsonanten behalten den des Vokals davor
  zs = 3;
  const m = schritte.filter((s) => s.betont).length;
  let n = 0;
  for (const s of schritte) if (s.betont) s.ton = tonFuer(e.melodie, n++, m, rnd);
  folge = { schritte, i: -1, ende: audio.currentTime + 0.05, zunge: null, lippen: 3, ton: 1, mitAufnahme };
  if (mitAufnahme) starteAufnahme();
}
// Text → Lautschrift, sobald sich Text oder Sprache ändern; die Lautschrift kann man danach von Hand verbessern
const text = hole("text");
const lautschrift = hole("lautschrift");
const unbekanntText = hole("unbekannt");
function uebersetze() {
  lautschrift.value = (e.sprache === "englisch" ? englischZuLautschrift : deutschZuLautschrift)(text.value);
  pruefe();
}
function pruefe() {
  const { unbekannt } = zerlege(lautschrift.value);
  unbekanntText.textContent = unbekannt.length ? `unbekannte Zeichen (werden übersprungen): ${[...new Set(unbekannt)].join(" ")}` : "";
}
text.addEventListener("input", uebersetze);
lautschrift.addEventListener("input", pruefe);
hole("sprechen").addEventListener("click", () => sprich(false));
hole("sprechenAufnehmen").addEventListener("click", () => sprich(true));
hole("anhalten").addEventListener("click", () => beendeFolge());
function beendeFolge() {
  const mitAufnahme = folge?.mitAufnahme;
  folge = null;
  if (mitAufnahme) {
    stumm = true;
    setTimeout(() => {
      stoppeAufnahme();
      stumm = false;
    }, 300); // den Nachhall noch mitnehmen
  }
}
// welcher Schritt gilt gerade
function folgeSchritt() {
  if (!folge || !audio) return null;
  const jetzt = audio.currentTime;
  while (jetzt >= folge.ende) {
    folge.i++;
    if (folge.i >= folge.schritte.length) {
      if (e.wiederholen && !folge.mitAufnahme) {
        folge.i = 0;
      } else {
        beendeFolge();
        return null;
      }
    }
    const s = folge.schritte[folge.i];
    folge.ende += s.dauer * e.tempo;
    if (s.vokal) {
      folge.zunge = s.vokal;
      folge.lippen = s.vokal.lippen;
    }
    if (s.ton) folge.ton = s.ton;
  }
  return folge.i >= 0 ? folge.schritte[folge.i] : { an: false };
}

// ---------- Musik ----------
const musik = richteAudioreaktivEin({
  ziele: {
    frequenz: "Tonhöhe steigt",
    mund: "Mund geht auf",
    laut: "lauter",
  },
  start: { mitte: "mund" },
  beiStart: () => {},
});
const bandFrequenz = (b) => 30 * (16000 / 30) ** ((b + 0.5) / 64);
let musikFrequenz = 110;
// der lauteste Ton zwischen 80 und 1000 Hz, in Oktaven verschoben, bis er auf die Tastatur passt
function folgeMusik(dt) {
  let beste = -1;
  let wert = 20;
  for (let b = 0; b < 64; b++) {
    const f = bandFrequenz(b);
    if (f < 80 || f > 1000) continue;
    if (musik.spektrum[b] > wert) {
      wert = musik.spektrum[b];
      beste = b;
    }
  }
  if (beste < 0) return;
  let f = bandFrequenz(beste);
  while (f < e.tastenVon) f *= 2;
  while (f > e.tastenVon * 4) f /= 2;
  const jetzt = Math.log(musikFrequenz);
  musikFrequenz = Math.exp(jetzt + (Math.log(f) - jetzt) * Math.min(1, dt * 10));
}

// ---------- alles an den Klang ----------
function werte(schritt) {
  const w = musik.wirkung;
  const zunge = schritt && folge?.zunge ? folge.zunge : e;
  const lippen = schritt ? folge.lippen : e.lippen;
  const konsonanten = [];
  for (const f of finger.values()) if (f.art === "enge") konsonanten.push({ ort: f.ort, weite: f.weite });
  if (schritt?.enge) konsonanten.push(...schritt.enge);
  const enge = lippen < 1.5 ? [...konsonanten, { ort: 41, weite: lippen }] : konsonanten;
  const velum = Math.max(e.nase, schritt?.velum ?? 0.01);
  const zungeWeite = Math.min(3.5, zunge.zungeWeite + 1.2 * (w.mund ?? 0));
  let frequenz = e.frequenzArt === "musik" ? musikFrequenz : e.frequenz;
  if (schritt) frequenz *= folge.ton;
  return {
    frequenz: frequenz * (1 + 0.5 * (w.frequenz ?? 0)),
    spannung: e.spannung,
    lautstaerke: Math.min(1.5, e.lautstaerke * (1 + (w.laut ?? 0))),
    an: stumm ? false : schritt ? schritt.an !== false : e.dauerton || taste !== null,
    stimmhaft: (schritt ? schritt.stimmhaft ?? 1 : 1) * e.stimmlippen,
    vibrato: e.vibrato,
    zittern: e.zittern,
    untertoene: e.untertoene,
    zungeOrt: zunge.zungeOrt,
    zungeWeite,
    enge,
    velum,
    rauschStaerke: e.zischen,
    art: e.klangArt,
    bits: e.bits,
    abtast: e.abtast,
    ...(e.klangArt === "formanten" ? formantKlang(zunge.zungeOrt, zungeWeite, lippen, konsonanten, velum) : {}),
  };
}

// ---------- Aufnahme (WAV) ----------
const aufnahmeKnopf = hole("aufnahme");
const aufnahmeText = hole("aufnahmeText");
async function starteAufnahme() {
  await starte();
  aufnahme = [];
  knoten.port.postMessage({ aufnahme: true });
  aufnahmeKnopf.textContent = "Aufnahme beenden";
  aufnahmeText.textContent = "nimmt auf …";
}
function stoppeAufnahme() {
  if (!aufnahme) return;
  knoten.port.postMessage({ aufnahme: false });
  const bloecke = aufnahme;
  aufnahme = null;
  aufnahmeKnopf.textContent = "Aufnahme starten";
  const n = bloecke.reduce((s, b) => s + b.length, 0);
  const samples = new Float32Array(n);
  let o = 0;
  for (const b of bloecke) {
    for (let i = 0; i < b.length; i++) samples[o + i] = b[i] * VERSTAERKUNG;
    o += b.length;
  }
  aufnahmeText.textContent = `${(n / audio.sampleRate).toFixed(1)} s aufgenommen`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(alsWav(samples, audio.sampleRate));
  a.download = "stimme.wav";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
aufnahmeKnopf.addEventListener("click", () => (aufnahme ? stoppeAufnahme() : starteAufnahme()));

// ---------- Schleife ----------
let vorher = performance.now();
let statusZeit = 0;
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  musik.schritt(dt);
  if (e.frequenzArt === "musik") folgeMusik(dt);
  const schritt = folgeSchritt();
  const w = werte(schritt);
  if (knoten) knoten.port.postMessage(w);
  if (analyser) analyser.getFloatFrequencyData(spektrum);
  zeichne(ctx, g, {
    d: rohr.d,
    nase: nasenForm,
    velum: rohr.velum,
    phase: rohr.phase,
    stimmhaft: w.an ? w.stimmhaft : 0,
    zungeOrt: w.zungeOrt,
    zungeWeite: w.zungeWeite,
    finger: [...finger.values()].filter((f) => f.art === "enge"),
    taste,
    frequenz: rohr.f,
    tastenVon: e.tastenVon,
    spektrum: analyser ? spektrum : null,
    rate: audio?.sampleRate ?? 48000,
    beschriftung: e.beschriftung,
  }, {
    grund: e.grundFarbe,
    fleisch: e.fleischFarbe,
    luft: e.luftFarbe,
    linie: e.linienFarbe,
    griff: e.griffFarbe,
  });
  if (!audio) {
    ctx.fillStyle = e.linienFarbe;
    ctx.font = `${Math.round(canvas.height / 22)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("klicken: Ton an", canvas.width * 0.72, canvas.height * 0.3);
  }
  statusZeit += dt;
  if (statusZeit > 0.2) {
    statusZeit = 0;
    const vokal = naechsterVokal(w.zungeOrt, w.zungeWeite, schritt ? folge.lippen : e.lippen);
    status.textContent = `${Math.round(rohr.f)} Hz · Zunge ${w.zungeOrt.toFixed(1)} / ${w.zungeWeite.toFixed(2)}` + (vokal && w.enge.every((x) => x.ort > 40) ? ` · klingt nach „${vokal}“` : "") + (folge ? " · spricht" : "");
  }
  requestAnimationFrame(schleife);
}

neueGroesse();
uebersetze();
requestAnimationFrame(schleife);
