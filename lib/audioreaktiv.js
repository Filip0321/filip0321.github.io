// Audioreaktiv: Musik (Datei, Mikrofon oder Systemton) bewegt den Attraktor.
// Vier Signale werden aus dem Ton gelesen, jedes kann ein Ziel steuern (Zoom, Helligkeit, …):
//   Bass, Mitte, Höhen  wie laut dieser Frequenzbereich gerade ist (0 bis 1)
//   Schlag              springt bei einem Schlag im Bass auf 1 und klingt schnell ab
// Dazu das ganze Spektrum in 64 Bändern (musik.spektrum, 0 bis 255): damit verformt der Shader
// den Attraktor selbst (innen Bass, außen Höhen), Stärke über den Regler „Spektrum formt“.
// Die Seite liest jedes Bild musik.wirkung ({ zoom: 0.4, helligkeit: 0.1, … }) und rechnet es
// auf ihre eigenen Werte, ohne die Regler zu verstellen.
//
// Live und beim Video-Export dieselbe Rechnung (signale()): live aus den letzten Samples, die der
// Browser gespielt hat, beim Export aus der dekodierten Datei an der Zeit des Bildes. Nur so sieht
// das Video aus wie die Vorschau, auch wenn ein Bild beim Rendern Sekunden dauert.
//
// Nur bei einer Datei kommen zwei Signale dazu, vorab aus der ganzen Datei gerechnet (/lib/takt-analyse.js):
//   Einsatz  jeder Einsatz (Schlag, Ton, Silbe), genau dann, wenn er kommt; der Schlag oben dagegen merkt ihn
//            erst, wenn er schon da ist, und nur im Bass
//   Takt     jeder Schlag des erkannten Tempos, gleichmäßig wie ein Metronom, auch in leisen Stellen

import { baueFft } from "/lib/fft.js";
import { oeffneMikrofon, oeffneSystemton } from "/lib/audio-eingang.js";
import { meldeKlang } from "/lib/klang-signale.js";
import { analysiereTakt, taktWerte } from "/lib/takt-analyse.js"; // dieselben Signale für Effekte der Sammlung (RGB-Versatz zum Bass …)

const FENSTER = 4096; // Samples pro Messung: bei 48 kHz 85 ms, fein genug für den Bass (12 Hz pro Fach)
const fft = baueFft(FENSTER);
const hann = new Float32Array(FENSTER);
for (let n = 0; n < FENSTER; n++) hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / FENSTER));

const BAENDER = [
  { name: "bass", text: "Bass", von: 20, bis: 150 },
  { name: "mitte", text: "Mitte", von: 150, bis: 2000 },
  { name: "hoehen", text: "Höhen", von: 2000, bis: 12000 },
  { name: "schlag", text: "Schlag" }, // kein eigener Bereich: kommt aus dem Bass
  { name: "einsatz", text: "Einsatz (Datei)" }, // aus der Analyse vorab, nur bei einer Datei
  { name: "takt", text: "Takt (Datei)" },
];
const STILLE = { bass: 0, mitte: 0, hoehen: 0, schlag: 0, einsatz: 0, takt: 0 };

const SPEKTRUM_BAENDER = 64; // so breit ist das Spektrum-Bild im Shader
const SPEKTRUM_VON = 30; // Hz, logarithmisch verteilt wie beim Hören
const SPEKTRUM_BIS = 16000;
const SPEKTRUM_DB = 40; // so viele dB unter dem Lautesten gelten als still

const SPITZE_ZEIT = 4; // Sekunden: so langsam vergisst die Lautstärke-Anpassung einen lauten Moment
const ANSTIEG = 0.03; // Sekunden: so schnell folgt ein Signal, wenn es lauter wird
const ABFALL = 0.25; // … und wenn es leiser wird (langsamer, sonst zappelt es)
const SCHLAG_ABKLINGEN = 0.18;
const SCHLAG_PAUSE = 0.22; // so lange nach einem Schlag zählt kein neuer (sonst doppelt pro Bassdrum)

// Mono aus allen Kanälen, FENSTER Samples ab "start" (vor dem Anfang: Stille)
function monoStueck(puffer, start, ziel) {
  ziel.fill(0);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k);
    for (let n = 0; n < FENSTER; n++) {
      const i = start + n;
      if (i >= 0 && i < kanal.length) ziel[n] += kanal[i] / puffer.numberOfChannels;
    }
  }
  return ziel;
}

// Ein Zustand für die Glättung, live und beim Export je ein eigener
function neuerZustand() {
  return {
    spitze: { bass: 1e-4, mitte: 1e-4, hoehen: 1e-4 },
    wert: { ...STILLE },
    bassMittel: 0,
    seitSchlag: 1,
    spektrumSpitze: 1e-4,
    spektrum: new Float32Array(SPEKTRUM_BAENDER), // geglättet, 0 bis 1
  };
}

const re = new Float32Array(FENSTER);
const im = new Float32Array(FENSTER);
const stueck = new Float32Array(FENSTER);
const betrag = new Float32Array(FENSTER / 2);

// nähert wert dem Ziel, schnell beim Lauterwerden, langsam beim Leiserwerden
function folge(wert, ziel, dt) {
  const zeit = ziel > wert ? ANSTIEG : ABFALL;
  return wert + (ziel - wert) * (1 - Math.exp(-dt / zeit));
}

// Samples → Signale 0 bis 1 (und z.spektrum). dt: Zeit seit dem letzten Mal (für Glättung und Schlag)
function signale(samples, rate, dt, z) {
  for (let n = 0; n < FENSTER; n++) stueck[n] = samples[n] * hann[n];
  fft(stueck, re, im);
  for (let k = 0; k < FENSTER / 2; k++) betrag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

  // Fach k liegt bei k · rate / FENSTER Hz
  const fach = (hz) => (hz * FENSTER) / rate;

  const roh = {};
  for (const band of BAENDER) {
    if (!band.bis) continue;
    const von = Math.max(1, Math.floor(fach(band.von)));
    const bis = Math.min(FENSTER / 2 - 1, Math.ceil(fach(band.bis)));
    let summe = 0;
    for (let k = von; k <= bis; k++) summe += betrag[k] * betrag[k]; // Energie
    roh[band.name] = Math.sqrt(summe / (bis - von + 1));
  }

  // Lautstärke-Anpassung: geteilt durch das Lauteste der letzten Sekunden, so geht es bei leisen
  // wie bei lauten Stücken von 0 bis 1. Die Spitze sinkt langsam, damit sie sich anpasst.
  const vergessen = Math.exp(-dt / SPITZE_ZEIT);
  for (const name of ["bass", "mitte", "hoehen"]) {
    z.spitze[name] = Math.max(roh[name], z.spitze[name] * vergessen, 1e-4);
    z.wert[name] = folge(z.wert[name], roh[name] / z.spitze[name], dt);
  }

  // Schlag: der Bass springt deutlich über seinen eigenen Durchschnitt der letzten halben Sekunde
  z.seitSchlag += dt;
  const istSchlag = roh.bass > z.bassMittel * 1.5 && roh.bass > z.spitze.bass * 0.3 && z.seitSchlag > SCHLAG_PAUSE;
  z.bassMittel += (roh.bass - z.bassMittel) * (1 - Math.exp(-dt / 0.5));
  if (istSchlag) {
    z.wert.schlag = 1;
    z.seitSchlag = 0;
  } else {
    z.wert.schlag *= Math.exp(-dt / SCHLAG_ABKLINGEN);
  }

  // Spektrum in 64 Bändern, logarithmisch: jedes Band ist gleich viele Halbtöne breit.
  // Pro Band der lauteste Wert seiner Fächer (unten ist ein Band schmaler als ein Fach, dann eben eins),
  // in dB unter dem Lautesten der letzten Sekunden: 0 dB = 1, −40 dB und leiser = 0
  const lautestes = [];
  let spitzeJetzt = 0;
  for (let b = 0; b < SPEKTRUM_BAENDER; b++) {
    const hzVon = SPEKTRUM_VON * (SPEKTRUM_BIS / SPEKTRUM_VON) ** (b / SPEKTRUM_BAENDER);
    const hzBis = SPEKTRUM_VON * (SPEKTRUM_BIS / SPEKTRUM_VON) ** ((b + 1) / SPEKTRUM_BAENDER);
    const von = Math.max(1, Math.floor(fach(hzVon)));
    const bis = Math.min(FENSTER / 2 - 1, Math.max(von, Math.floor(fach(hzBis))));
    let groesster = 0;
    for (let k = von; k <= bis; k++) groesster = Math.max(groesster, betrag[k]);
    lautestes.push(groesster);
    spitzeJetzt = Math.max(spitzeJetzt, groesster);
  }
  z.spektrumSpitze = Math.max(spitzeJetzt, z.spektrumSpitze * vergessen, 1e-4);
  for (let b = 0; b < SPEKTRUM_BAENDER; b++) {
    const db = 20 * Math.log10(lautestes[b] / z.spektrumSpitze + 1e-9);
    const ziel = Math.min(Math.max(1 + db / SPEKTRUM_DB, 0), 1);
    z.spektrum[b] = folge(z.spektrum[b], ziel, dt);
  }
  return z.wert;
}

export function richteAudioreaktivEin({
  ziele,           // { zoom: "Zoom", helligkeit: "Helligkeit", … }: was die Seite bewegen kann
  start = {},      // { bass: "zoom", … }: Zuordnung am Anfang
  beiStart,        // () => …: Musik läuft los, die Seite soll ihre Bild-Schleife starten
}) {
  const quelleWahl = hole("musik-quelle");
  const dateiKnopf = hole("musik-datei-knopf");
  const dateiFeld = hole("musik-datei");
  const spieler = hole("musik-spieler");
  const baenderBox = hole("musik-baender");
  const formRegler = hole("musik-form");
  const zeigeForm = () => (formRegler.nextElementSibling.textContent = formRegler.value); // <output> dahinter
  formRegler.addEventListener("input", zeigeForm);
  zeigeForm();
  const meldung = hole("musik-meldung");

  let audio = null;
  let analyser = null;
  let aufnahmeZiel = null; // alles, was gerade klingt, als MediaStream: für „Live aufnehmen“ mit Ton
  let dateiQuelle = null;
  let liveQuelle = null; // Mikrofon oder Systemton
  let liveStrom = null;
  let ton = null; // die dekodierte Datei: fürs Video (Ton und Signale an der Zeit jedes Bildes)
  let takt = null; // { einsaetze, bpm, schlaege } der Datei (takt-analyse.js)
  let zustand = neuerZustand();
  const samples = new Float32Array(FENSTER);

  const wirkung = {}; // ziel → Summe der Signale, die darauf zeigen (mal Stärke)
  const spektrum = new Uint8Array(SPEKTRUM_BAENDER); // fürs Spektrum-Bild im Shader
  const zuordnung = {}; // band → { wahl: <select>, staerke: <input>, anzeige: <meter> }

  // pro Signal eine Zeile: Name, wohin, wie stark, und ein Balken, der zeigt, was gerade ankommt
  for (const band of BAENDER) {
    const wahl = document.createElement("select");
    wahl.append(new Option("nichts", ""));
    for (const [ziel, text] of Object.entries(ziele)) wahl.append(new Option(text, ziel));
    wahl.value = start[band.name] ?? "";
    const staerke = document.createElement("input");
    staerke.type = "range";
    staerke.min = 0;
    staerke.max = 2;
    staerke.step = 0.05;
    staerke.value = 1;
    staerke.setAttribute("aria-label", `Stärke ${band.text}`);
    const anzeige = document.createElement("meter");
    anzeige.min = 0;
    anzeige.max = 1;
    const gruppe = document.createElement("span");
    gruppe.className = "steuerung-gruppe";
    gruppe.append(wahl, staerke, anzeige);
    const label = document.createElement("label");
    label.append(`${band.text} `, gruppe);
    baenderBox.append(label);
    zuordnung[band.name] = { wahl, staerke, anzeige };
  }

  // Signale → Wirkung auf die Ziele; spektrumWerte (0 bis 1) → spektrum (0 bis 255)
  function verteile(werte, spektrumWerte = null) {
    meldeKlang(werte);
    for (const ziel of Object.keys(ziele)) wirkung[ziel] = 0;
    for (const band of BAENDER) {
      const { wahl, staerke, anzeige } = zuordnung[band.name];
      anzeige.value = werte[band.name];
      if (wahl.value) wirkung[wahl.value] += werte[band.name] * Number(staerke.value);
    }
    for (let b = 0; b < SPEKTRUM_BAENDER; b++) spektrum[b] = spektrumWerte ? Math.round(spektrumWerte[b] * 255) : 0;
  }
  verteile(STILLE);

  function baueAudio() {
    if (audio) return;
    audio = new AudioContext();
    analyser = audio.createAnalyser();
    analyser.fftSize = FENSTER; // nur für getFloatTimeDomainData: die letzten FENSTER Samples
    aufnahmeZiel = audio.createMediaStreamDestination();
    dateiQuelle = audio.createMediaElementSource(spieler); // ab jetzt geht der Ton der Datei durch Web Audio
    dateiQuelle.connect(analyser);
    dateiQuelle.connect(audio.destination);
    dateiQuelle.connect(aufnahmeZiel);
  }

  function stoppeLive() {
    liveQuelle?.disconnect();
    liveQuelle = null;
    liveStrom?.getTracks().forEach((spur) => spur.stop()); // erst dann geht die Aufnahme-Anzeige im Browser aus
    liveStrom = null;
  }

  // Quelle wählen: Datei (Knopf und Player sichtbar), Mikrofon oder Systemton (sofort starten)
  async function setzeQuelle() {
    const art = quelleWahl.value;
    dateiKnopf.hidden = art !== "datei";
    spieler.hidden = art !== "datei";
    meldung.textContent = "";
    stoppeLive();
    if (art === "datei") {
      verteile(STILLE);
      return;
    }
    spieler.pause();
    baueAudio();
    try {
      liveStrom = art === "mikrofon" ? await oeffneMikrofon() : await oeffneSystemton();
    } catch (fehler) {
      meldung.textContent = fehler.message;
      quelleWahl.value = "datei";
      setzeQuelle();
      return;
    }
    liveQuelle = audio.createMediaStreamSource(liveStrom);
    liveQuelle.connect(analyser); // nicht auf die Lautsprecher: beim Mikrofon pfiffe es, den Systemton hört man schon
    liveQuelle.connect(aufnahmeZiel);
    // die Freigabe endet von außen (Knopf „Freigabe beenden“ des Browsers): zurück auf Datei
    liveStrom.getAudioTracks()[0].addEventListener("ended", () => {
      if (quelleWahl.value === "datei") return;
      quelleWahl.value = "datei";
      setzeQuelle();
      meldung.textContent = "Freigabe beendet, zurück auf Datei.";
    });
    await audio.resume(); // Browser starten Ton erst nach einem Klick
    zustand = neuerZustand();
    beiStart();
  }
  quelleWahl.addEventListener("change", setzeQuelle);
  setzeQuelle();

  // Datei: abspielen und zugleich ganz dekodieren (für den Export)
  dateiFeld.addEventListener("change", async () => {
    const datei = dateiFeld.files[0];
    if (!datei) return;
    baueAudio();
    exportTabelle = null; // gehörte zur alten Datei
    takt = null;
    if (spieler.src.startsWith("blob:")) URL.revokeObjectURL(spieler.src);
    spieler.src = URL.createObjectURL(datei);
    meldung.textContent = "";
    try {
      ton = await audio.decodeAudioData(await datei.arrayBuffer());
    } catch {
      ton = null;
      meldung.textContent = "Die Datei kann der Browser nicht lesen.";
      return;
    }
    takt = analysiereTakt(ton);
    const tempo = takt.bpm ? `etwa ${Math.round(takt.bpm)} BPM` : "kein Tempo (zu kurz)";
    meldung.textContent = `${takt.einsaetze.length} Einsätze, ${tempo}. Einsatz und Takt kommen genau mit der Musik.`;
  });

  spieler.addEventListener("play", async () => {
    baueAudio();
    await audio.resume();
    zustand = neuerZustand();
    beiStart();
  });
  spieler.addEventListener("pause", () => verteile(STILLE));

  // läuft gerade etwas? (Datei spielt oder Mikrofon bzw. Systemton ist an)
  function laeuft() {
    return Boolean(liveStrom) || (!spieler.paused && !spieler.ended);
  }

  // live, einmal pro Bild: dt in Sekunden seit dem letzten Bild
  function schritt(dt) {
    if (!laeuft() || !analyser) return;
    analyser.getFloatTimeDomainData(samples); // die letzten FENSTER Samples, die gespielt wurden
    const werte = signale(samples, audio.sampleRate, Math.max(dt, 1 / 240), zustand);
    // Einsatz und Takt: nur, wenn die Datei spielt (beim Mikrofon gibt es keine Analyse vorab)
    Object.assign(werte, liveStrom ? { einsatz: 0, takt: 0 } : taktWerte(takt, spieler.currentTime));
    verteile(werte, zustand.spektrum);
  }

  // Export: alle Bilder einmal vorausrechnen (Glättung und Schlag hängen vom Bild davor ab,
  // darum der Reihe nach), dann kann die Vorschau auch direkt zu Bild i springen
  let exportTabelle = null; // [{ werte, spektrum }, …], ein Eintrag pro Bild
  function exportStart(n, fps) {
    if (!ton) {
      exportTabelle = null;
      return;
    }
    if (exportTabelle?.length === n) return; // schon gerechnet (die Vorschau ruft start oft auf)
    const z = neuerZustand();
    exportTabelle = [];
    const stueckDaten = new Float32Array(FENSTER);
    for (let i = 0; i < n; i++) {
      // wie live: die FENSTER Samples, die bis zu diesem Bild gespielt wurden
      const ende = Math.round((i / fps) * ton.sampleRate);
      monoStueck(ton, ende - FENSTER, stueckDaten);
      const werte = { ...signale(stueckDaten, ton.sampleRate, 1 / fps, z), ...taktWerte(takt, i / fps) }; // Kopien: z ändert sich weiter
      exportTabelle.push({ werte, spektrum: z.spektrum.slice() });
    }
  }

  function exportBild(i) {
    if (!exportTabelle) return;
    const { werte, spektrum: s } = exportTabelle[Math.min(i, exportTabelle.length - 1)];
    verteile(werte, s);
  }

  function exportEnde() {
    exportTabelle = null;
    verteile(STILLE);
  }

  // für Szenen: wohin jedes Signal geht und wie stark, dazu „Spektrum formt“
  function zuordnungLesen() {
    const ergebnis = { form: Number(formRegler.value) };
    for (const [band, { wahl, staerke }] of Object.entries(zuordnung)) {
      ergebnis[band] = { ziel: wahl.value, staerke: Number(staerke.value) };
    }
    return ergebnis;
  }
  function zuordnungSetzen(gespeichert = {}) {
    for (const [band, { wahl, staerke }] of Object.entries(zuordnung)) {
      if (!gespeichert[band]) continue;
      wahl.value = gespeichert[band].ziel;
      staerke.value = gespeichert[band].staerke;
    }
    if (gespeichert.form !== undefined) formRegler.value = gespeichert.form;
    zeigeForm();
  }

  return {
    wirkung,
    spektrum,
    zuordnungLesen,
    zuordnungSetzen,
    spektrumStaerke: () => Number(formRegler.value),
    laeuft,
    schritt,
    tonFuerExport: () => ton, // AudioBuffer der Datei oder null (Mikrofon und Systemton kann man nicht rendern)
    // für „Live aufnehmen“: alles, was gerade klingt (Datei, Mikrofon oder Systemton), als Tonspur
    liveTon: () => (audio ? { spur: aufnahmeZiel.stream.getAudioTracks()[0], kanaele: 2, rate: audio.sampleRate } : null),
    exportStart,
    exportBild,
    exportEnde,
  };
}

