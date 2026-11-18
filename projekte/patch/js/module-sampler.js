// Band und Samples (Runde 22):
//   Schleife   Bandschleife zum Mitschneiden: im Kreis abspielen, langsamer, rückwärts, Schichten übereinander
//   Sampler    eine Tondatei als Instrument: mit Noten gespielt (Tonhöhe = Abspieltempo), rückwärts, in Schleife
//   Kohle      ein Kohlemikrofon: schmales Band, eine Resonanz, krumme Verzerrung und Rauschen, das mit dem Ton kommt
// Samples aus anderen Projekten: dort als Datei exportieren (Stimme: „sprechen und aufnehmen“, Spektral malen,
// Bild zu Ton …) und hier im Sampler laden. Eine Live-Verbindung zwischen zwei Seiten gibt es im Browser nicht
// (jede Seite hat ihr eigenes AudioContext); die Stimme gibt es darum zusätzlich als eigenes Modul (module-stimme.js).

import { Takt } from "./takt.js";
import { log, verstaerker, filter, rauschQuelle } from "./bausteine.js";
import { legeAb, hole, alsWav, ladeHerunter } from "./tonspeicher.js";

// Runde 33: Datei-Bytes in den Tonspeicher legen und den Schlüssel im Patch vermerken (werte.ton); beim Bauen von
// dort wieder holen. decodeAudioData „verbraucht“ den Puffer (er wird abgelöst), darum vorher eine Kopie.
async function merkeTon(modul, bytes, el) {
  const s = await legeAb(bytes);
  if (!s || !modul) return;
  modul.werte.ton = s;
  el?.dispatchEvent(new Event("change", { bubbles: true }));
}
async function holeTon(modul, lade) {
  const b = modul?.werte.ton && (await hole(modul.werte.ton));
  if (b) lade(b.slice(0), false);
}
function wavKnopf(holePuffer, name) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "als WAV";
  b.title = "die Aufnahme bzw. Datei als WAV herunterladen (zum Weitergeben mit dem Patch)";
  b.addEventListener("click", () => holePuffer() && ladeHerunter(alsWav(holePuffer()), `${name}.wav`));
  return b;
}

const geaendert = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));

// ---------- Schleife ----------
const schleife = {
  titel: "Schleife",
  gruppe: "Bearbeiten",
  baue(ctx, { tempo }) {
    const k = new AudioWorkletNode(ctx, "schleife", { numberOfInputs: 1, outputChannelCount: [2] });
    const p = (n) => k.parameters.get(n);
    const ein = verstaerker(ctx, 1), nass = verstaerker(ctx, 1), trocken = verstaerker(ctx, 1), aus = verstaerker(ctx, 1);
    const tempoEin = verstaerker(ctx, 1);
    ein.connect(k).connect(nass).connect(aus);
    ein.connect(trocken).connect(aus);
    tempoEin.connect(p("tempo"));
    const w = { sekunden: 4, takte: "frei", tempo: 1, richtung: 1, nimmt: false };
    let knopf = null, balken = null, stelle = 0;
    const laengeSetzen = () => {
      // in Takten: 4 Schläge im gemeinsamen Tempo (main.js) je Takt
      const s = w.takte === "frei" ? w.sekunden : (Number(w.takte) * 4 * 60) / tempo();
      p("laenge").setValueAtTime(Math.min(60, s), ctx.currentTime);
    };
    const tempoSetzen = () => p("tempo").setTargetAtTime(w.tempo * w.richtung, ctx.currentTime, 0.05);
    const nimm = (an, t = ctx.currentTime) => {
      w.nimmt = an;
      p("aufnahme").setValueAtTime(an ? 1 : 0, t);
      if (knopf) {
        knopf.setAttribute("aria-pressed", String(an));
        knopf.textContent = an ? "Aufnahme läuft" : "Aufnahme";
      }
    };
    k.port.onmessage = ({ data }) => {
      stelle = data.stelle;
      if (balken) balken.style.setProperty("--stelle", stelle);
    };
    const taktEin = (t, dauer) => {
      // ein Takt schaltet um; mit fester Dauer (Sequenzer): so lange aufnehmen
      nimm(!w.nimmt, t);
      if (w.nimmt && Number.isFinite(dauer) && dauer > 0.05) setTimeout(() => nimm(false), (t - ctx.currentTime + dauer) * 1000);
    };
    taktEin.los = (t) => nimm(false, t);
    return {
      ein: { ein: { art: "ton", ziel: ein }, Aufnahme: { art: "takt", ziel: taktEin }, Tempo: { art: "ton", ziel: tempoEin } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "sekunden", text: "Länge", ...log(0.1, 60), wert: 4, einheit: "s", setze: (v) => { w.sekunden = v; laengeSetzen(); } },
        { name: "tempo", text: "Band", ...log(0.25, 4), wert: 1, setze: (v) => { w.tempo = v; tempoSetzen(); } },
        { name: "halten", text: "Halten", min: 0, max: 1, wert: 0.8, setze: (v) => p("halten").setValueAtTime(v, ctx.currentTime) },
        { name: "nass", text: "Schleife", min: 0, max: 1.5, wert: 1, setze: (v) => nass.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "trocken", text: "Eingang", min: 0, max: 1, wert: 1, setze: (v) => trocken.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [
        { name: "richtung", text: "Richtung", optionen: [["1", "vorwärts"], ["-1", "rückwärts"]], wert: "1", setze: (v) => { w.richtung = Number(v); tempoSetzen(); } },
        { name: "takte", text: "Länge in", optionen: [["frei", "Sekunden"], ["1", "1 Takt"], ["2", "2 Takte"], ["4", "4 Takte"], ["8", "8 Takte"]], wert: "frei", setze: (v) => { w.takte = v; laengeSetzen(); } },
      ],
      extra: (el) => {
        const reihe = document.createElement("div");
        reihe.className = "steuerung knopf-reihe";
        knopf = document.createElement("button");
        knopf.type = "button";
        knopf.textContent = "Aufnahme";
        knopf.setAttribute("aria-pressed", "false");
        knopf.addEventListener("click", () => nimm(!w.nimmt));
        const leer = document.createElement("button");
        leer.type = "button";
        leer.textContent = "Band löschen";
        leer.addEventListener("click", () => k.port.postMessage({ leeren: true }));
        reihe.append(knopf, leer);
        // die Stelle des Kopfs als Balken (CSS-Variable, kein Zeichnen nötig)
        balken = document.createElement("div");
        balken.className = "band-stelle";
        el.append(reihe, balken);
      },
      weg: () => (k.port.onmessage = null),
    };
  },
};

// ---------- Sampler ----------
// Eine Tondatei wird zum Instrument. Jede Note startet eine eigene Abspielquelle (AudioBufferSourceNode, die gibt es
// nur einmal zu benutzen, aber sie sind billig), mit dem Tempo 2^((Note − Grundton) / 12): eine Oktave höher heißt
// doppelt so schnell, also auch halb so lang (wie bei Band, und wie die ersten Sampler, Fairlight und Mellotron).
// Rückwärts: eine umgedrehte Kopie des Puffers. Schleife: zwischen Start und Ende im Kreis, bis die Taste losgeht.
// Die Datei wird nicht mit dem Patch gespeichert (zu groß für den Browser-Speicher): nach dem Neuladen neu wählen.
const sampler = {
  titel: "Sampler",
  gruppe: "Klang",
  baue(ctx, { bild, melde, modul }) {
    const aus = verstaerker(ctx, 0.8);
    const w = { grund: 60, start: 0, laenge: 1, a: 0.005, r: 0.2, richtung: "vor", schleife: "nein", stimmen: "eine" };
    // Runde 28: für Audio-Clips im Arrangement: der Puffer (zum Zeichnen der Wellenform) und der Grundton
    if (modul) modul.audio = { puffer: () => vor, grund: () => w.grund, start: () => w.start, laenge: () => w.laenge };
    let vor = null, rueck = null, c = null, name = null;
    const klingt = new Map(); // Note → [{ quelle, huelle }]
    const zeichneWelle = () => {
      if (!c) return;
      const g = c.getContext("2d"), B = c.width, H = c.height;
      g.clearRect(0, 0, B, H);
      g.fillStyle = getComputedStyle(c).color;
      if (!vor) {
        g.font = "11px monospace";
        g.fillText("keine Datei", 8, H / 2 + 4);
        return;
      }
      const d = vor.getChannelData(0), schritt = Math.max(1, Math.floor(d.length / B));
      for (let x = 0; x < B; x++) {
        let m = 0;
        for (let i = x * schritt; i < Math.min(d.length, (x + 1) * schritt); i += 4) m = Math.max(m, Math.abs(d[i]));
        g.fillRect(x, H / 2 - m * (H / 2 - 2), 1, Math.max(1, 2 * m * (H / 2 - 2)));
      }
      // Start und Ende: außerhalb abgedunkelt
      g.globalAlpha = 0.6;
      g.clearRect(0, 0, w.start * B, H);
      g.clearRect(Math.min(1, w.start + w.laenge) * B, 0, B, H);
      g.globalAlpha = 1;
      g.fillRect(w.start * B, 0, 1, H);
      g.fillRect(Math.min(1, w.start + w.laenge) * B - 1, 0, 1, H);
    };
    const an = (t, n, vel = 0.8, dauer = Infinity) => {
      if (!vor) return;
      // Runde 34: Neustart schneidet ab. Dieselbe Note noch einmal (oder bei „einstimmig“ jede neue Note) beendet, was
      // noch klingt, in 5 ms (sonst lief bei einem neu gestarteten Audio-Clip der alte im Hintergrund weiter)
      for (const [m, liste] of klingt) if (m === n || w.stimmen === "eine") for (const e of liste) {
        e.huelle.gain.setTargetAtTime(0, t, 0.002);
        try { e.q.stop(t + 0.02); } catch {}
      }
      const puffer = w.richtung === "rueck" ? rueck : vor;
      const q = new AudioBufferSourceNode(ctx, { buffer: puffer, playbackRate: 2 ** ((n - w.grund) / 12) });
      const huelle = verstaerker(ctx, 0);
      q.connect(huelle).connect(aus);
      const von = w.start * puffer.duration, lang = Math.max(0.005, Math.min(1 - w.start, w.laenge) * puffer.duration);
      if (w.schleife === "ja") {
        q.loop = true;
        q.loopStart = von;
        q.loopEnd = von + lang;
      }
      huelle.gain.setValueAtTime(0, t);
      huelle.gain.linearRampToValueAtTime(vel, t + w.a);
      q.start(t, von, w.schleife === "ja" ? undefined : lang);
      const eintrag = { q, huelle };
      const liste = klingt.get(n) ?? [];
      liste.push(eintrag);
      klingt.set(n, liste);
      // ohne Schleife endet die Quelle von selbst; mit fester Dauer: dann loslassen
      const echteLaenge = lang / q.playbackRate.value;
      const los = Number.isFinite(dauer) ? t + dauer : w.schleife === "ja" ? null : t + echteLaenge;
      if (los !== null) loslassen(eintrag, Math.max(los, t + w.a), n);
      q.onended = () => {
        const l = klingt.get(n);
        if (l) klingt.set(n, l.filter((x) => x !== eintrag));
      };
    };
    function loslassen(e, t) {
      e.huelle.gain.setTargetAtTime(0, t, Math.max(0.002, w.r / 3));
      try {
        e.q.stop(t + w.r * 1.5 + 0.05);
      } catch {}
    }
    an.aus = (t, n) => {
      for (const e of klingt.get(n) ?? []) loslassen(e, t);
      klingt.delete(n);
    };
    an.alleAus = (t) => [...klingt.keys()].forEach((n) => an.aus(t, n));
    const lade = async (datei, merken = true) => {
      try {
        const bytes = datei instanceof ArrayBuffer ? datei : await datei.arrayBuffer();
        if (merken) merkeTon(modul, bytes.slice(0), name);
        vor = await ctx.decodeAudioData(bytes);
        // rückwärts: jeden Kanal umgedreht kopieren
        rueck = new AudioBuffer({ length: vor.length, numberOfChannels: vor.numberOfChannels, sampleRate: vor.sampleRate });
        for (let k = 0; k < vor.numberOfChannels; k++) rueck.copyToChannel(vor.getChannelData(k).slice().reverse(), k);
        if (name) name.textContent = datei.name ?? "Datei (gespeichert)";
        zeichneWelle();
      } catch {
        melde("Diese Datei kann der Browser nicht lesen.");
      }
    };
    // Takt-Eingang (Runde 24): ein gehaltener Takt (Taster, Tastatur über Noten → Ton) hat Dauer „unendlich“ und
    // schickt sein Ende später mit .los. Das fehlte: der Ton lief bis zum Dateiende, mit Schleife für immer.
    const taktZiel = (t, d) => an(t, w.grund, 0.8, d);
    taktZiel.los = (t) => an.aus(t, w.grund);
    return {
      ein: { Noten: { art: "noten", ziel: an }, Takt: { art: "takt", ziel: taktZiel } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "grund", text: "Grundton", min: 24, max: 96, wert: 60, schritt: 1, setze: (v) => (w.grund = Math.round(v)) },
        { name: "start", text: "Start", min: 0, max: 0.99, wert: 0, setze: (v) => { w.start = v; zeichneWelle(); } },
        { name: "laenge", text: "Länge", ...log(0.002, 1), wert: 1, setze: (v) => { w.laenge = v; zeichneWelle(); } },
        { name: "a", text: "Attack", ...log(0.001, 2), wert: 0.005, einheit: "s", setze: (v) => (w.a = v) },
        { name: "r", text: "Release", ...log(0.005, 5), wert: 0.2, einheit: "s", setze: (v) => (w.r = v) },
        { name: "pegel", text: "Pegel", min: 0, max: 2, wert: 0.8, setze: (v) => aus.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [
        { name: "richtung", text: "Richtung", optionen: [["vor", "vorwärts"], ["rueck", "rückwärts"]], wert: "vor", setze: (v) => (w.richtung = v) },
        { name: "schleife", text: "Schleife", optionen: [["nein", "nein"], ["ja", "ja"]], wert: "nein", setze: (v) => (w.schleife = v) },
        { name: "stimmen", text: "Stimmen", optionen: [["eine", "eine (Neustart schneidet ab)"], ["viele", "viele (übereinander)"]], wert: "eine", setze: (v) => (w.stimmen = v) },
      ],
      extra: (el) => {
        const label = document.createElement("label");
        label.className = "datei-knopf";
        name = document.createElement("span");
        name.textContent = "Tondatei wählen";
        const feld = document.createElement("input");
        feld.type = "file";
        feld.accept = "audio/*";
        feld.addEventListener("change", () => feld.files[0] && lade(feld.files[0]));
        label.append(name, feld);
        c = document.createElement("canvas");
        c.width = 320;
        c.height = 64;
        c.className = "schirm klein";
        const reihe = document.createElement("div");
        reihe.className = "steuerung"; // nur dort versteckt das CSS das eigentliche Dateifeld
        reihe.append(label, wavKnopf(() => vor, "sampler"));
        el.append(reihe, c);
        zeichneWelle();
        holeTon(modul, lade);
      },
      weg: () => an.alleAus(ctx.currentTime),
    };
  },
};

// ---------- Kohle (Kohlemikrofon) ----------
// Im Kohlemikrofon (Hughes und Edison, 1878; bis in die 1980er in jedem Telefonhörer) drückt die Membran auf Körner
// aus Kohle. Je fester, desto besser leiten sie: der Widerstand folgt dem Schalldruck, ein Strom wird zum Ton.
// Das ist von Natur aus krumm:
//   schmales Band   die Membran ist steif und schwer: unter 300 Hz und über 3 bis 4 kHz kommt kaum etwas (das ist
//                   das „Telefon“, und genau das Band, das für Sprachverständlichkeit reicht)
//   Resonanz        die Membran schwingt selbst, um 1 bis 2 kHz: ein Buckel, der näselt
//   Verzerrung      der Kontakt zwischen den Körnern ist nicht linear und nicht symmetrisch (Drücken ist anders als
//                   Loslassen): f(x) = tanh(Antrieb · (x + 0,3 x²)). Das x² macht gerade Obertöne (warm, schmutzig)
//                   und einen Gleichanteil, den der Hochpass danach wieder wegnimmt
//   Rauschen        die Körner knistern und brutzeln, und zwar lauter, wenn Ton ankommt (mehr Strom, mehr Bewegung):
//                   ein Rauschen, dessen Lautstärke dem Pegel des Eingangs folgt (Hüllkurvenfolger aus Gleichrichter
//                   und Tiefpass)
const kohle = {
  titel: "Kohle",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const ein = verstaerker(ctx, 1), nass = verstaerker(ctx, 1), trocken = verstaerker(ctx, 0), aus = verstaerker(ctx, 1);
    const buckel = ctx.createBiquadFilter();
    buckel.type = "peaking";
    buckel.frequency.value = 1700;
    buckel.Q.value = 1.4;
    buckel.gain.value = 9;
    const form = ctx.createWaveShaper();
    form.oversample = "4x"; // Verzerrung erzeugt Obertöne über der halben Abtastrate: vierfach rechnen, sonst klirrt es
    const hoch = filter(ctx, "highpass", 320, 0.7), tief = filter(ctx, "lowpass", 3400, 0.9);
    ein.connect(buckel).connect(form).connect(hoch).connect(tief).connect(nass).connect(aus);
    ein.connect(trocken).connect(aus);
    // Rauschen, das dem Pegel folgt
    const rausch = rauschQuelle(ctx), rauschBand = filter(ctx, "bandpass", 2500, 0.8), rauschLaut = verstaerker(ctx, 0);
    const betrag = ctx.createWaveShaper();
    betrag.curve = new Float32Array(Array.from({ length: 257 }, (_, i) => Math.abs((i - 128) / 128)));
    const glatt = filter(ctx, "lowpass", 15, 0.5), menge = verstaerker(ctx, 0);
    ein.connect(betrag).connect(glatt).connect(menge).connect(rauschLaut.gain);
    rausch.connect(rauschBand).connect(rauschLaut).connect(nass);
    const kurve = (antrieb) => {
      const n = 2048, c = new Float32Array(n), norm = Math.tanh(antrieb * 1.3);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(antrieb * (x + 0.3 * x * x)) / norm;
      }
      return c;
    };
    return {
      ein: { ein: { art: "ton", ziel: ein } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "antrieb", text: "Antrieb", ...log(0.5, 30), wert: 4, setze: (v) => (form.curve = kurve(v)) },
        { name: "buckel", text: "Resonanz", min: 0, max: 18, wert: 9, einheit: "dB", setze: (v) => buckel.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "band", text: "Höhen bis", ...log(1200, 8000), wert: 3400, einheit: "Hz", setze: (v) => tief.frequency.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "knistern", text: "Knistern", min: 0, max: 1, wert: 0.3, setze: (v) => menge.gain.setTargetAtTime(v * 0.6, ctx.currentTime, 0.02) },
        { name: "nass", text: "Kohle", min: 0, max: 1.5, wert: 0.5, setze: (v) => nass.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "trocken", text: "trocken", min: 0, max: 1, wert: 0, setze: (v) => trocken.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      weg: () => rausch.stop(),
    };
  },
};

// ---------- Strecken (Runde 31): Timestretch ----------
// Spielt eine Datei mit eigenem Tempo und eigener Tonhöhe (die Rechnung: worklets.js, „Strecke“). „Tempo folgen“:
// die Datei läuft so schnell, dass ihr eigenes Tempo (Knopf „Original“) zum globalen Tempo passt, ohne dass sich
// die Tonhöhe ändert. Noten: jede Note startet die Datei von vorn, um (Note − Grundton) Halbtöne verschoben; ein
// Noten-Ende hält sie an. So geht sie auch als Audio-Clip im Arrangement (Clips → „Audio-Clip“).
const strecken = {
  titel: "Strecken",
  gruppe: "Klang",
  baue(ctx, { melde, modul, tempo, bild }) {
    const k = new AudioWorkletNode(ctx, "strecke", { numberOfInputs: 0, outputChannelCount: [1] });
    const aus = verstaerker(ctx, 0.8);
    k.connect(aus);
    const p = (n) => k.parameters.get(n);
    const w = { original: 120, folgen: "ja", faktor: 1, grund: 60 };
    let puffer = null, name = null;
    const tempoNeu = () => p("tempo").setValueAtTime(w.folgen === "ja" ? tempo() / w.original : w.faktor, ctx.currentTime);
    const zeichne = () => tempoNeu(); // jedes Bild: falls sich das globale Tempo geändert hat
    if (modul) modul.audio = { puffer: () => puffer, grund: () => w.grund, start: () => 0, laenge: () => 1, strecken: true, dauer: () => (puffer ? puffer.duration * (w.folgen === "ja" ? w.original / tempo() : 1 / w.faktor) : 0) };
    const an = (t, n, vel, d = Infinity) => {
      k.port.postMessage({ zeit: t, ton: n - w.grund });
      if (Number.isFinite(d)) k.port.postMessage({ zeit: t + d, stopp: true });
    };
    an.aus = (t) => k.port.postMessage({ zeit: t, stopp: true });
    an.alleAus = an.aus;
    const takt = (t, d) => an(t, w.grund, 1, d);
    takt.los = an.aus;
    return {
      ein: { Noten: { art: "noten", ziel: an }, Takt: { art: "takt", ziel: takt } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "original", text: "Original", min: 40, max: 220, wert: 120, schritt: 1, einheit: "BPM", setze: (v) => { w.original = v; tempoNeu(); } },
        { name: "faktor", text: "Tempo ×", ...log(0.25, 4), wert: 1, setze: (v) => { w.faktor = v; tempoNeu(); } },
        { name: "tonhoehe", text: "Tonhöhe", min: -24, max: 24, wert: 0, schritt: 1, einheit: "HT", setze: (v) => p("tonhoehe").setValueAtTime(v, ctx.currentTime) },
        { name: "korn", text: "Korn", ...log(0.02, 0.3), wert: 0.08, einheit: "s", setze: (v) => p("korn").setValueAtTime(v, ctx.currentTime) },
        { name: "grund", text: "Grundton", min: 24, max: 96, wert: 60, schritt: 1, setze: (v) => (w.grund = Math.round(v)) },
        { name: "pegel", text: "Pegel", min: 0, max: 2, wert: 0.8, setze: (v) => aus.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [
        { name: "folgen", text: "Tempo folgen", optionen: [["ja", "ja (Original → global)"], ["nein", "nein (Tempo ×)"]], wert: "ja", setze: (v) => { w.folgen = v; tempoNeu(); } },
        { name: "modus", text: "Modus", optionen: [["koerner", "Körner (Flächen, Stimmen)"], ["schlaege", "Schläge (Trommeln)"]], wert: "koerner", setze: (v) => k.port.postMessage({ modus: v }) },
      ],
      extra: (el) => {
        const label = document.createElement("label");
        label.className = "datei-knopf steuerung";
        name = document.createElement("span");
        name.textContent = "Tondatei wählen";
        const feld = document.createElement("input");
        feld.type = "file";
        feld.accept = "audio/*";
        feld.addEventListener("change", async () => {
          const datei = feld.files[0];
          if (!datei) return;
          await ladeStrecke(datei);
        });
        const ladeStrecke = async (datei, merken = true) => {
          try {
            const bytes = datei instanceof ArrayBuffer ? datei : await datei.arrayBuffer();
            if (merken) merkeTon(modul, bytes.slice(0), name);
            puffer = await ctx.decodeAudioData(bytes);
            k.port.postMessage({ puffer: puffer.getChannelData(0).slice(), sr: puffer.sampleRate });
            // die Anschläge für den Modus „Schläge“ (dieselbe Erkennung wie im Schnipsel)
            const d = puffer.getChannelData(0);
            k.port.postMessage({ schlaege: anschlaege(d, puffer.sampleRate, 0, d.length, 256) });
            name.textContent = datei.name ?? "Datei (gespeichert)";
          } catch {
            melde("Diese Datei kann der Browser nicht lesen.");
          }
        };
        label.append(name, feld);
        el.append(label, wavKnopf(() => puffer, "strecken"));
        bild.add(zeichne);
        holeTon(modul, ladeStrecke);
      },
      weg: () => {
        bild.delete(zeichne);
        k.disconnect();
      },
    };
  },
};

// ---------- Schnipsel (Runde 32): Sampler wie bei Teenage Engineering (OP-1, KO II) ----------
// Aufnehmen vom Mikrofon (oder eine Datei), den Ausschnitt mit der Maus ziehen, in bis zu 16 Stücke teilen: gleich
// lang oder an den Anschlägen. Jedes Stück liegt auf einer Taste: Note 60 (C4) ist Stück 1, 61 Stück 2 … Ein Takt
// spielt die Stücke der Reihe nach (aus einem Loop wird ein neu zusammengesetzter: Slicing wie beim Breakbeat).
// Anschläge finden („Onset-Erkennung“): die Energie in 10-ms-Fenstern; ein Anschlag ist, wo sie plötzlich deutlich
// über den Durchschnitt der letzten 100 ms springt. Davon die stärksten, mindestens 60 ms auseinander.
function anschlaege(d, sr, von, bis, anzahl) {
  const F = Math.round(sr * 0.01), e = [];
  for (let i = von; i + F < bis; i += F) {
    let s = 0;
    for (let j = i; j < i + F; j++) s += d[j] * d[j];
    e.push([i, s / F]);
  }
  const kandidaten = [];
  for (let k = 1; k < e.length; k++) {
    const vorher = e.slice(Math.max(0, k - 10), k).reduce((a, x) => a + x[1], 0) / Math.min(10, k);
    if (e[k][1] > vorher * 2.5 && e[k][1] > 1e-4) kandidaten.push([e[k][0], e[k][1] / (vorher + 1e-9)]);
  }
  kandidaten.sort((a, b) => b[1] - a[1]);
  const gewaehlt = [von];
  for (const [i] of kandidaten) {
    if (gewaehlt.length >= anzahl) break;
    if (gewaehlt.every((g) => Math.abs(g - i) > sr * 0.06)) gewaehlt.push(i);
  }
  return gewaehlt.sort((a, b) => a - b);
}

const schnipsel = {
  titel: "Schnipsel",
  gruppe: "Klang",
  baue(ctx, { melde, bild, modul }) {
    const aus = verstaerker(ctx, 0.9);
    const w = { anzahl: 8, tonhoehe: 0, r: 0.02, art: "gleich", choke: "ja" };
    let puffer = null, von = 0, bis = 1, schnitte = [], c = null, naechstes = 0, rec = null, aufKnopf = null;
    const teile = () => {
      if (!puffer) return;
      const d = puffer.getChannelData(0), a = Math.floor(von * d.length), b = Math.floor(bis * d.length);
      if (modul) delete modul.werte.schnitte; // neu geteilt: Handarbeit verworfen
      schnitte = w.art === "anschlag" ? anschlaege(d, puffer.sampleRate, a, b, w.anzahl) : Array.from({ length: w.anzahl }, (_, i) => a + Math.floor(((b - a) * i) / w.anzahl));
      zeichne();
    };
    const zeichne = () => {
      if (!c) return;
      const g = c.getContext("2d"), B = c.width, H = c.height;
      g.clearRect(0, 0, B, H);
      g.fillStyle = getComputedStyle(c).color;
      g.font = "10px monospace";
      if (!puffer) return g.fillText("aufnehmen oder Datei wählen", 8, H / 2 + 4);
      const d = puffer.getChannelData(0), sch = Math.max(1, Math.floor(d.length / B));
      for (let x = 0; x < B; x++) {
        let m = 0;
        for (let i = x * sch; i < Math.min(d.length, (x + 1) * sch); i += 4) m = Math.max(m, Math.abs(d[i]));
        g.globalAlpha = x / B >= von && x / B <= bis ? 1 : 0.3; // außerhalb des Ausschnitts blass
        g.fillRect(x, H / 2 - m * (H / 2 - 2), 1, Math.max(1, 2 * m * (H / 2 - 2)));
      }
      g.globalAlpha = 1;
      schnitte.forEach((s, i) => {
        const x = (s / d.length) * B;
        g.fillRect(x, 0, 1, H);
        g.fillText(String(i + 1), x + 2, 10);
      });
    };
    const lade = async (daten, merken = true) => {
      try {
        if (merken) merkeTon(modul, daten.slice(0), c);
        puffer = await ctx.decodeAudioData(daten);
        // beim Wiederherstellen den gespeicherten Ausschnitt nehmen, sonst alles
        [von, bis] = merken ? [0, 1] : [modul?.werte.von ?? 0, modul?.werte.bis ?? 1];
        teile();
        // von Hand verschobene Schnitte (Runde 33) wiederherstellen
        if (!merken && Array.isArray(modul?.werte.schnitte)) {
          schnitte = modul.werte.schnitte.slice();
          zeichne();
        }
      } catch {
        melde("Diese Aufnahme oder Datei kann der Browser nicht lesen.");
      }
    };
    let laufend = [];
    const spiele = (t, i, vel = 0.9, dauer = Infinity) => {
      if (!puffer || !schnitte.length) return;
      // Runde 34, wie die „Choke“-Gruppe einer Drum-Machine: ein neues Stück beendet das alte (bei „einzeln“)
      if (w.choke === "ja") {
        for (const [q, h] of laufend) {
          h.gain.setTargetAtTime(0, t, 0.002);
          try { q.stop(t + 0.02); } catch {}
        }
        laufend = [];
      }
      const k = ((i % schnitte.length) + schnitte.length) % schnitte.length, sr = puffer.sampleRate;
      const a = schnitte[k] / sr, e = (schnitte[k + 1] ?? Math.floor(bis * puffer.length)) / sr;
      const q = new AudioBufferSourceNode(ctx, { buffer: puffer, playbackRate: 2 ** (w.tonhoehe / 12) }), h = verstaerker(ctx, 0);
      q.connect(h).connect(aus);
      h.gain.setValueAtTime(0, t);
      h.gain.linearRampToValueAtTime(vel, t + 0.002);
      const lang = Math.min(e - a, Number.isFinite(dauer) ? dauer : Infinity);
      h.gain.setTargetAtTime(0, t + lang / q.playbackRate.value, w.r / 3);
      q.start(t, a, e - a);
      laufend.push([q, h]);
      q.onended = () => (laufend = laufend.filter(([x]) => x !== q));
    };
    const noten = (t, n, vel, d) => spiele(t, n - 60, vel, d);
    noten.aus = () => {};
    noten.alleAus = () => {};
    const aufnehmen = async () => {
      if (rec) {
        rec.stop();
        return;
      }
      try {
        const strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const teile_ = [];
        rec = new MediaRecorder(strom);
        rec.ondataavailable = (e) => teile_.push(e.data);
        rec.onstop = async () => {
          strom.getTracks().forEach((t) => t.stop());
          rec = null;
          aufKnopf.setAttribute("aria-pressed", "false");
          await lade(await new Blob(teile_).arrayBuffer());
        };
        rec.start();
        aufKnopf.setAttribute("aria-pressed", "true");
      } catch {
        melde("Kein Zugriff aufs Mikrofon (der Browser fragt; ohne Erlaubnis geht es nicht).");
      }
    };
    return {
      ein: {
        Noten: { art: "noten", ziel: noten, info: "Note 60 (C4) spielt Stück 1, 61 Stück 2 …" },
        Takt: { art: "takt", ziel: (t, d) => spiele(t, naechstes++, 0.9, d), info: "jeder Schlag spielt das nächste Stück (der Reihe nach)" },
      },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "anzahl", text: "Stücke", min: 1, max: 16, wert: 8, schritt: 1, setze: (v) => { w.anzahl = Math.round(v); teile(); } },
        { name: "tonhoehe", text: "Tonhöhe", min: -24, max: 24, wert: 0, schritt: 1, einheit: "HT", setze: (v) => (w.tonhoehe = v) },
        { name: "r", text: "Release", ...log(0.005, 1), wert: 0.02, einheit: "s", setze: (v) => (w.r = v) },
        { name: "pegel", text: "Pegel", min: 0, max: 2, wert: 0.9, setze: (v) => aus.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [
        { name: "art", text: "Teilen", optionen: [["gleich", "gleich lang"], ["anschlag", "an Anschlägen"]], wert: "gleich", setze: (v) => { w.art = v; teile(); } },
        { name: "choke", text: "Stücke", optionen: [["ja", "einzeln (neues beendet altes)"], ["nein", "übereinander"]], wert: "ja", setze: (v) => (w.choke = v) },
      ],
      extra: (el) => {
        const reihe = document.createElement("div");
        reihe.className = "steuerung knopf-reihe";
        aufKnopf = document.createElement("button");
        aufKnopf.type = "button";
        aufKnopf.textContent = "● aufnehmen";
        aufKnopf.setAttribute("aria-pressed", "false");
        aufKnopf.addEventListener("click", aufnehmen);
        const label = document.createElement("label");
        label.className = "datei-knopf";
        label.append("Datei");
        const feld = document.createElement("input");
        feld.type = "file";
        feld.accept = "audio/*";
        feld.addEventListener("change", async () => feld.files[0] && lade(await feld.files[0].arrayBuffer()));
        label.append(feld);
        reihe.append(aufKnopf, label, wavKnopf(() => puffer, "schnipsel"));
        c = document.createElement("canvas");
        c.width = 320;
        c.height = 80;
        c.className = "schirm klein malbar";
        c.title = "ziehen: Ausschnitt wählen (dann wird er neu geteilt)";
        let zug = null, marke = -1;
        const x = (ev) => Math.max(0, Math.min(1, (ev.clientX - c.getBoundingClientRect().left) / c.getBoundingClientRect().width));
        c.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          try { c.setPointerCapture(ev.pointerId); } catch {}
          // Runde 33: nah an einem Schnitt (6 Pixel)? Dann diesen verschieben, statt einen Ausschnitt zu ziehen
          const breite = c.getBoundingClientRect().width;
          marke = puffer ? schnitte.findIndex((sch) => Math.abs((sch / puffer.length - x(ev)) * breite) < 6) : -1;
          if (marke >= 0) return;
          zug = x(ev);
        });
        c.addEventListener("pointermove", (ev) => {
          if (marke >= 0) {
            const links = schnitte[marke - 1] ?? 0, rechts = schnitte[marke + 1] ?? puffer.length;
            schnitte[marke] = Math.max(links + 64, Math.min(rechts - 64, Math.round(x(ev) * puffer.length)));
            return zeichne();
          }
          if (zug === null) return;
          [von, bis] = [Math.min(zug, x(ev)), Math.max(zug, x(ev))];
          zeichne();
        });
        c.addEventListener("pointerup", () => {
          if (marke >= 0) {
            marke = -1;
            if (modul) modul.werte.schnitte = schnitte.slice();
            c.dispatchEvent(new Event("change", { bubbles: true }));
            return;
          }
          if (zug === null) return;
          zug = null;
          if (bis - von < 0.005) [von, bis] = [0, 1]; // nur geklickt: wieder alles
          if (modul) Object.assign(modul.werte, { von, bis });
          c.dispatchEvent(new Event("change", { bubbles: true }));
          teile();
        });
        const hilfe = document.createElement("p");
        hilfe.className = "hinweis";
        hilfe.textContent = "Ziehen: Ausschnitt; an einem Strich ziehen: diesen Schnitt verschieben. C4 spielt Stück 1, Cis4 Stück 2 … Ein Takt spielt die Stücke der Reihe nach. Die Aufnahme bleibt in diesem Browser gespeichert; zum Weitergeben „als WAV“.";
        el.append(reihe, c, hilfe);
        zeichne();
        holeTon(modul, lade);
      },
      weg: () => rec?.stop(),
    };
  },
};

// ---------- Video (Runde 33): gechoppt sehen, was man hört ----------
// Ein Video wie ein Schnipsel: in gleich lange Stücke geteilt, Note C4 springt an Stück 1, Cis4 an Stück 2 …, ein
// Takt springt zum nächsten. Bild UND Ton springen zusammen (der Ton des Videos kommt am Ausgang heraus, über
// createMediaElementSource), so sieht man den Schnitt, den man hört: wie Video-Clips in Ableton, nur zerhackt.
// Genauigkeit: ein Video-Element springt nicht sampelgenau (es sucht das nächste Bild, je nach Codec ein paar ms bis
// über 100 ms, wenn es weit bis zum nächsten Schlüsselbild ist). Für glatte Sprünge: Videos mit vielen Schlüsselbildern
// (z. B. in DaVinci als „All-Intra“ oder mit kurzem GOP exportieren). Datamosh-Freunde wissen, warum.
const video = {
  titel: "Video",
  gruppe: "Ausgang und Bild",
  baue(ctx, { melde, modul, bild }) {
    const aus = verstaerker(ctx, 1), w = { anzahl: 8, laenge: 1 };
    const v = document.createElement("video");
    v.playsInline = true;
    v.preload = "auto";
    v.className = "video-schirm";
    let quelle = null, halt = null, naechstes = 0, eigene = Array.isArray(modul?.werte.schnitte) ? modul.werte.schnitte.slice() : null, zeige = () => {};
    // Runde 34: die Stücke einzeln. Ohne Handarbeit gleich lang; mit verschobenen Grenzen (Leiste unter dem Bild) eigene
    // Anfänge in Sekunden. Ein Stück reicht bis zum nächsten Anfang.
    const grenzen = () => (!v.duration ? [] : eigene?.length ? eigene : Array.from({ length: w.anzahl }, (_, i) => (i * v.duration) / w.anzahl));
    let aktiv = -1;
    const springe = (t, i, dauer) => {
      const g = grenzen();
      if (!g.length) return;
      const k = ((i % g.length) + g.length) % g.length, a = g[k], e = g[k + 1] ?? v.duration;
      const warte = Math.max(0, (t - ctx.currentTime) * 1000);
      setTimeout(() => {
        clearTimeout(halt); // ein neues Stück beendet das alte sofort (das Video kann nur eines zeigen)
        v.currentTime = a;
        v.play().catch(() => {});
        aktiv = k;
        const lang = Math.min((e - a) * w.laenge, Number.isFinite(dauer) ? dauer : Infinity);
        halt = setTimeout(() => {
          v.pause();
          aktiv = -1;
        }, lang * 1000);
      }, warte);
    };
    const lade = async (bytes, merken = true) => {
      if (merken) {
        const s = await legeAb(bytes.slice(0));
        if (s && modul) {
          modul.werte.ton = s;
          v.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      v.src = URL.createObjectURL(new Blob([bytes]));
      if (!quelle) {
        quelle = ctx.createMediaElementSource(v);
        quelle.connect(aus);
      }
    };
    const noten = (t, n, vel, d) => springe(t, n - 60, d);
    noten.aus = () => {};
    noten.alleAus = () => {};
    return {
      ein: { Noten: { art: "noten", ziel: noten, info: "C4 springt an Stück 1, Cis4 an Stück 2 …" }, Takt: { art: "takt", ziel: (t, d) => springe(t, naechstes++, d), info: "jeder Schlag: das nächste Stück" } },
      aus: { aus: { art: "ton", knoten: aus, info: "der Ton des Videos (springt mit dem Bild)" } },
      regler: [
        { name: "anzahl", text: "Stücke", min: 1, max: 64, wert: 8, schritt: 1, setze: (x) => {
          const neu = Math.round(x);
          if (neu !== w.anzahl && eigene) {
            eigene = null; // neue Anzahl: wieder gleich lang teilen
            if (modul) delete modul.werte.schnitte;
          }
          w.anzahl = neu;
        } },
        { name: "laenge", text: "Länge", min: 0.05, max: 1, wert: 1, setze: (x) => (w.laenge = x) },
        { name: "pegel", text: "Pegel", min: 0, max: 2, wert: 1, setze: (x) => aus.gain.setTargetAtTime(x, ctx.currentTime, 0.02) },
      ],
      klasse: "breit",
      extra: (el) => {
        const reihe = document.createElement("div");
        reihe.className = "steuerung knopf-reihe";
        const label = document.createElement("label");
        label.className = "datei-knopf";
        label.append("Videodatei");
        const feld = document.createElement("input");
        feld.type = "file";
        feld.accept = "video/*";
        feld.addEventListener("change", async () => {
          if (!feld.files[0]) return;
          try {
            await lade(await feld.files[0].arrayBuffer());
          } catch {
            melde("Dieses Video kann der Browser nicht abspielen.");
          }
        });
        label.append(feld);
        const gross = document.createElement("button");
        gross.type = "button";
        gross.textContent = "Vollbild";
        gross.addEventListener("click", () => v.requestFullscreen?.());
        reihe.append(label, gross);
        // Leiste unter dem Bild: die Stücke mit Nummern, wo das Video gerade steht, und das gerade spielende Stück
        // hervorgehoben. Klick in ein Stück: es spielen. Am Strich ziehen: die Grenze verschieben.
        const c = document.createElement("canvas");
        c.width = 640;
        c.height = 36;
        c.className = "rolle malbar";
        const g = c.getContext("2d");
        zeige = () => {
          if (c.offsetParent === null) return;
          const B = c.width, H = c.height, gr = grenzen(), d = v.duration || 1;
          g.clearRect(0, 0, B, H);
          g.fillStyle = getComputedStyle(c).color;
          g.font = "10px monospace";
          gr.forEach((a, k) => {
            const x0 = (a / d) * B, x1 = ((gr[k + 1] ?? d) / d) * B;
            g.globalAlpha = k === aktiv ? 0.4 : 0.08;
            g.fillRect(x0, 0, x1 - x0, H);
            g.globalAlpha = 1;
            g.fillRect(x0, 0, 1, H);
            g.fillText(String(k + 1), x0 + 3, 12);
          });
          g.fillRect((v.currentTime / d) * B, 0, 2, H);
        };
        const zeit = (ev) => (Math.max(0, Math.min(1, (ev.clientX - c.getBoundingClientRect().left) / c.getBoundingClientRect().width)) * (v.duration || 0));
        let marke = -1;
        c.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!v.duration) return;
          const gr = grenzen(), px = c.getBoundingClientRect().width / v.duration, t = zeit(ev);
          marke = gr.findIndex((a, k) => k > 0 && Math.abs(a - t) * px < 6);
          if (marke > 0) {
            eigene = gr.slice();
            try { c.setPointerCapture(ev.pointerId); } catch {}
            return;
          }
          let k = gr.length - 1;
          while (k > 0 && gr[k] > t) k--;
          springe(ctx.currentTime, k, Infinity);
        });
        c.addEventListener("pointermove", (ev) => {
          if (marke <= 0) return;
          eigene[marke] = Math.max(eigene[marke - 1] + 0.02, Math.min((eigene[marke + 1] ?? v.duration) - 0.02, zeit(ev)));
          v.currentTime = eigene[marke]; // beim Ziehen das Bild an der Grenze zeigen
        });
        c.addEventListener("pointerup", () => {
          if (marke <= 0) return;
          marke = -1;
          if (modul) modul.werte.schnitte = eigene.map((x) => Math.round(x * 1000) / 1000);
          c.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const hilfe = document.createElement("p");
        hilfe.className = "hinweis";
        hilfe.textContent = "Leiste: Klick in ein Stück spielt es, am Strich ziehen verschiebt die Grenze (das Bild zeigt die Stelle). Neue Anzahl: wieder gleich lang.";
        el.append(reihe, v, c, hilfe);
        bild.add(zeige);
        (async () => {
          const b = modul?.werte.ton && (await hole(modul.werte.ton));
          if (b) lade(b, false);
        })();
      },
      weg: () => {
        bild.delete(zeige);
        clearTimeout(halt);
        v.pause();
        if (v.src) URL.revokeObjectURL(v.src);
      },
    };
  },
};

export const SAMPLER_MODULE = { schleife, sampler, strecken, schnipsel, kohle, video };
