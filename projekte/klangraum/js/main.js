// Klangraum: die Seite. Eine Aufnahme dehnen (Paulstretch) und in einen gekrümmten Raum stellen (Hall aus Strahlen).
//   paulstretch.js  dehnen ohne tiefer zu werden
//   hall.js         Strahlen durch eine Zelle der hyperbolischen Waben, daraus die Impulsantwort
//   hall-worker.js  rechnet die Strahlen in einem eigenen Thread
// Die Faltung selbst macht der Browser (ConvolverNode), beim Speichern in einem OfflineAudioContext: so schnell,
// wie die Rechnung geht, nicht in Echtzeit.

import { paulstretch } from "./paulstretch.js";
import { impulsantwort, abklingkurve, BAENDER, SCHALL } from "./hall.js";
import { richteReglerEin } from "/lib/regler.js";

const RATE = 48000;
const canvas = hole("feld");
const ctx = canvas.getContext("2d");
const kurve = hole("kurve");
const status = hole("status");
const meldung = hole("meldung");

const { einstellung: e } = richteReglerEin({ beiAenderung: () => {} });

// ---------- Quelle ----------
let quelle = null; // { kanaele: [Float32Array, Float32Array], name }
let audio = null;
const holeAudio = () => (audio ??= new AudioContext({ sampleRate: RATE }));
function setzeQuelle(puffer, name) {
  const k = [0, 1].map((c) => puffer.getChannelData(Math.min(c, puffer.numberOfChannels - 1)).slice());
  quelle = { kanaele: k, name };
  gedehnt = null;
  hole("quelleInfo").textContent = `${name}: ${(k[0].length / RATE).toFixed(1)} s`;
}
hole("datei").addEventListener("change", async (ev) => {
  const datei = ev.target.files[0];
  if (!datei) return;
  try {
    setzeQuelle(await holeAudio().decodeAudioData(await datei.arrayBuffer()), datei.name);
  } catch {
    melde("Diese Datei kann der Browser nicht lesen.");
  }
});
// Mikrofon: aufnehmen, bis man wieder drückt
let rekorder = null;
hole("mikro").addEventListener("click", async () => {
  if (rekorder) return rekorder.stop();
  try {
    const strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const teile = [];
    rekorder = new MediaRecorder(strom);
    rekorder.ondataavailable = (x) => teile.push(x.data);
    rekorder.onstop = async () => {
      strom.getTracks().forEach((t) => t.stop());
      rekorder = null;
      hole("mikro").textContent = "Mikrofon aufnehmen";
      const daten = await new Blob(teile).arrayBuffer();
      setzeQuelle(await holeAudio().decodeAudioData(daten), "Aufnahme");
    };
    rekorder.start();
    hole("mikro").textContent = "Aufnahme beenden";
  } catch {
    melde("Kein Zugriff aufs Mikrofon.");
  }
});
// Beispiel: drei gezupfte Saiten und ein Klick (Karplus-Strong: ein kurzes Rauschen läuft in einer Schleife so
// lang wie eine Periode und wird jedes Mal etwas weicher: es klingt wie eine Saite)
function beispiel() {
  const n = RATE * 3;
  const x = new Float32Array(n);
  for (const [f, start] of [[110, 0], [164.8, 0.6], [220, 1.2]]) {
    const p = Math.round(RATE / f);
    const schleife = new Float32Array(p).map(() => Math.random() * 2 - 1);
    const s = Math.round(start * RATE);
    for (let i = 0; i < n - s; i++) {
      const j = i % p;
      const neu = 0.996 * 0.5 * (schleife[j] + schleife[(j + 1) % p]);
      x[s + i] += schleife[j] * 0.4;
      schleife[j] = neu;
    }
  }
  const k = Math.round(2.1 * RATE);
  for (let i = 0; i < 60; i++) x[k + i] += (1 - i / 60) * (i % 2 ? 0.8 : -0.8); // Klick
  const puffer = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: RATE });
  puffer.copyToChannel(x, 0);
  setzeQuelle(puffer, "Beispiel (Saiten und Klick)");
}
hole("beispiel").addEventListener("click", beispiel);

// ---------- Dehnen ----------
let gedehnt = null; // { schluessel, kanaele }
let abbrechen = false;
async function dehnen() {
  if (!e.dehnen) return quelle.kanaele;
  const schluessel = `${e.faktor}|${e.fenster}`;
  if (gedehnt?.schluessel === schluessel) return gedehnt.kanaele;
  // höchstens 6 Minuten Ergebnis: sonst nur den Anfang der Aufnahme
  const maxEin = Math.floor((360 * RATE) / e.faktor);
  const ein = quelle.kanaele.map((k) => k.subarray(0, maxEin));
  if (maxEin < quelle.kanaele[0].length) melde(`Gedehnt wird nur der Anfang (${(maxEin / RATE).toFixed(1)} s), damit das Ergebnis höchstens 6 Minuten lang wird.`);
  abbrechen = false;
  const aus = await paulstretch(ein, RATE, e.faktor, e.fenster, (x) => (status.textContent = `dehnt … ${Math.round(x * 100)} %`), () => abbrechen);
  if (!aus) return null;
  gedehnt = { schluessel, kanaele: aus };
  return aus;
}

// ---------- Hall ----------
const arbeiter = new Worker(new URL("./hall-worker.js", import.meta.url), { type: "module" });
let hall = null; // { schluessel, ir: [L, R], energie, vergleich, wege, hoerer, quelle }
function hallRechnen() {
  const s = { wabe: e.raum, groesse: e.groesse, daempfung: e.daempfung, durchlaessig: e.durchlaessig, dauer: e.dauer, strahlen: Number(e.strahlen) };
  const schluessel = JSON.stringify(s);
  if (hall?.schluessel === schluessel) return Promise.resolve(hall);
  status.textContent = "Strahlen fliegen …";
  return new Promise((ok) => {
    arbeiter.onmessage = (m) => {
      const d = m.data;
      hall = { schluessel, ...d, ir: [0, 1].map((k) => impulsantwort(d.energie, RATE, k)) };
      // auf Energie 1 bringen (dann ist die Mischung unabhängig von Größe und Dämpfung)
      let summe = 0;
      for (const x of hall.ir[0]) summe += x * x;
      const f = 1 / Math.sqrt(summe || 1);
      for (const ir of hall.ir) for (let i = 0; i < ir.length; i++) ir[i] *= f;
      zeigeKurven();
      ok(hall);
    };
    arbeiter.postMessage(s);
  });
}

// ---------- Rechnen und Abspielen ----------
let ergebnis = null; // AudioBuffer
let spieler = null;
let spielStart = 0;
async function berechne() {
  melde("");
  if (!quelle) beispiel();
  const knopf = hole("los");
  knopf.disabled = true;
  try {
    const trocken = await dehnen();
    if (!trocken) return;
    const mitHall = e.raum !== "aus";
    if (mitHall) await hallRechnen();
    status.textContent = "faltet …";
    const laenge = trocken[0].length + (mitHall ? hall.ir[0].length : 0);
    const off = new OfflineAudioContext(2, laenge, RATE);
    const ein = new AudioBuffer({ length: trocken[0].length, numberOfChannels: 2, sampleRate: RATE });
    trocken.forEach((k, c) => ein.copyToChannel(k, c));
    const q = new AudioBufferSourceNode(off, { buffer: ein });
    const nass = new GainNode(off, { gain: mitHall ? e.mischung : 0 });
    const tr = new GainNode(off, { gain: mitHall ? 1 - e.mischung : 1 });
    q.connect(tr).connect(off.destination);
    if (mitHall) {
      const irPuffer = new AudioBuffer({ length: hall.ir[0].length, numberOfChannels: 2, sampleRate: RATE });
      hall.ir.forEach((k, c) => irPuffer.copyToChannel(k, c));
      const falter = new ConvolverNode(off, { buffer: irPuffer, disableNormalization: true });
      q.connect(falter).connect(nass).connect(off.destination);
    }
    q.start();
    ergebnis = await off.startRendering();
    // auf 0,9 normieren
    let spitze = 0;
    for (let c = 0; c < 2; c++) for (const x of ergebnis.getChannelData(c)) spitze = Math.max(spitze, Math.abs(x));
    if (spitze > 0) for (let c = 0; c < 2; c++) {
      const d = ergebnis.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= 0.9 / spitze;
    }
    status.textContent = `fertig: ${(ergebnis.length / RATE).toFixed(1)} s`;
    spiele();
  } finally {
    knopf.disabled = false;
  }
}
function spiele() {
  halt();
  const a = holeAudio();
  a.resume();
  spieler = new AudioBufferSourceNode(a, { buffer: ergebnis });
  spieler.connect(a.destination);
  spieler.start();
  spielStart = a.currentTime;
  spieler.onended = () => (spieler = null);
}
function halt() {
  spieler?.stop();
  spieler = null;
}
hole("los").addEventListener("click", berechne);
hole("halt").addEventListener("click", () => {
  abbrechen = true;
  halt();
});
hole("speichern").addEventListener("click", () => {
  if (!ergebnis) return melde("Erst berechnen.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(alsWav(ergebnis));
  a.download = `klangraum-${e.raum.replace(/,/g, "")}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
// WAV, 16 Bit, Stereo: Kopf wie in /projekte/databending/js/wav.js, die Samples abwechselnd links und rechts
function alsWav(puffer) {
  const n = puffer.length;
  const b = new ArrayBuffer(44 + n * 4);
  const v = new DataView(b);
  const text = (o, t) => [...t].forEach((z, i) => v.setUint8(o + i, z.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 4, true);
  const l = puffer.getChannelData(0);
  const r = puffer.getChannelData(1);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 32767, true);
  }
  return new Blob([b], { type: "audio/wav" });
}
function melde(text) {
  meldung.hidden = !text;
  meldung.textContent = text;
}

// ---------- Abklingkurven ----------
// Schroeder-Kurven (in dB) der drei Bänder, gestrichelt dieselben im flachen Würfel gleicher Größe
function zeigeKurven() {
  const c = kurve.getContext("2d");
  const W = (kurve.width = kurve.clientWidth * Math.min(2, devicePixelRatio || 1));
  const H = (kurve.height = Math.round(W * 0.4));
  const farben = ["#c0503c", "#e0a040", "#d8cfc2"];
  c.fillStyle = "#0b0908";
  c.fillRect(0, 0, W, H);
  c.font = `${Math.round(H / 14)}px monospace`;
  c.strokeStyle = "#4a1616";
  c.fillStyle = "#d8cfc2";
  for (let db = 0; db >= -60; db -= 20) {
    const y = (-db / 60) * (H - 20) + 4;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y);
    c.stroke();
    c.fillText(`${db} dB`, 4, y + H / 14);
  }
  const t60 = [];
  for (const [liste, strich] of [[hall.energie, []], [hall.vergleich, [6, 5]]]) {
    if (!liste) continue;
    c.setLineDash(strich);
    liste.forEach((en, b) => {
      const k = abklingkurve(en);
      if (strich.length === 0) t60.push(k.t60);
      else t60[b + 3] = k.t60;
      c.strokeStyle = farben[b];
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < k.db.length; i += 4) c.lineTo((i / k.db.length) * W, (Math.min(60, -k.db[i]) / 60) * (H - 20) + 4);
      c.stroke();
    });
  }
  c.setLineDash([]);
  const s = (x) => (x ? `${x.toFixed(2)} s` : "–");
  hole("t60").textContent =
    `Nachhallzeit T60 (tief, mitte, hoch): ${BAENDER.map((_, b) => s(t60[b])).join(", ")}` +
    (hall.vergleich ? `; flacher Würfel gleicher Größe (gestrichelt): ${BAENDER.map((_, b) => s(t60[b + 3])).join(", ")}` : "");
}

// ---------- Bild: Strahlen ----------
// Die Wege der ersten Strahlen, langsam abgespielt (der Schall braucht für 343 m eine Sekunde). Hyperbolisch in der
// Poincaré-Kugel: der ganze unendliche Raum in einer Kugel, ihr Rand ist „unendlich weit weg“.
function zeichne(t) {
  const W = Number(e.aufloesung);
  const H = Math.round(W * 0.75);
  if (canvas.width !== W) {
    canvas.width = W;
    canvas.height = H;
  }
  ctx.fillStyle = "#0b0908";
  ctx.fillRect(0, 0, W, H);
  const r = H * 0.45;
  const cx = W / 2;
  const cy = H / 2;
  ctx.strokeStyle = "#4a1616";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  if (!hall) {
    ctx.fillStyle = "#d8cfc2";
    ctx.font = `${Math.round(H / 22)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("„berechnen“: Strahlen fliegen lassen", cx, cy);
    return;
  }
  const w = t * 0.15; // langsame Drehung, damit man die Tiefe sieht
  const proj = (p) => [cx + r * (p[0] * Math.cos(w) + p[2] * Math.sin(w)), cy - r * p[1]];
  const strecke = e.groesse * 30; // eine Runde der Animation zeigt so viele Meter Weg
  const jetzt = ((t * strecke) / 8) % strecke;
  for (const weg of hall.wege) {
    // Schweif: die letzten 1,5 Zellen hell, davor dunkel
    let ende = weg.m.findIndex((m) => m > jetzt);
    if (ende < 0) ende = weg.m.length;
    ctx.strokeStyle = "rgba(216, 207, 194, 0.12)";
    ctx.beginPath();
    for (let i = 0; i < ende; i++) ctx.lineTo(...proj(weg.p[i]));
    ctx.stroke();
    ctx.strokeStyle = "rgba(224, 160, 64, 0.8)";
    ctx.beginPath();
    for (let i = 0; i < ende; i++) if (weg.m[i] > jetzt - e.groesse * 1.5) ctx.lineTo(...proj(weg.p[i]));
    ctx.stroke();
    if (ende > 0 && ende < weg.m.length) {
      ctx.fillStyle = "#e0a040";
      ctx.fillRect(...proj(weg.p[ende - 1]).map((x) => x - 1), 2, 2);
    }
  }
  ctx.fillStyle = "#c0503c";
  const [hx, hy] = proj(hall.hoerer);
  ctx.beginPath();
  ctx.arc(hx, hy, 3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#d8cfc2";
  const [qx, qy] = proj(hall.quelle);
  ctx.fillRect(qx - 2, qy - 2, 4, 4);
  ctx.font = `${Math.round(H / 30)}px monospace`;
  ctx.textAlign = "left";
  ctx.fillText(`${Math.round(jetzt)} m · ${(jetzt / SCHALL * 1000).toFixed(0)} ms`, 6, H - 8);
}
function schleife(jetzt) {
  zeichne(jetzt / 1000);
  if (spieler && ergebnis) {
    const t = audio.currentTime - spielStart;
    hole("position").textContent = `${t.toFixed(1)} / ${(ergebnis.length / RATE).toFixed(1)} s`;
  }
  requestAnimationFrame(schleife);
}
requestAnimationFrame(schleife);
