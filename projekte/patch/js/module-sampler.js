// Band und Samples (Runde 22):
//   Schleife   Bandschleife zum Mitschneiden: im Kreis abspielen, langsamer, rückwärts, Schichten übereinander
//   Sampler    eine Tondatei als Instrument: mit Noten gespielt (Tonhöhe = Abspieltempo), rückwärts, in Schleife
//   Kohle      ein Kohlemikrofon: schmales Band, eine Resonanz, krumme Verzerrung und Rauschen, das mit dem Ton kommt
// Samples aus anderen Projekten: dort als Datei exportieren (Stimme: „sprechen und aufnehmen“, Spektral malen,
// Bild zu Ton …) und hier im Sampler laden. Eine Live-Verbindung zwischen zwei Seiten gibt es im Browser nicht
// (jede Seite hat ihr eigenes AudioContext); die Stimme gibt es darum zusätzlich als eigenes Modul (module-stimme.js).

import { Takt } from "./takt.js";
import { log, verstaerker, filter, rauschQuelle } from "./bausteine.js";

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
  baue(ctx, { bild, melde }) {
    const aus = verstaerker(ctx, 0.8);
    const w = { grund: 60, start: 0, laenge: 1, a: 0.005, r: 0.2, richtung: "vor", schleife: "nein" };
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
    const lade = async (datei) => {
      try {
        vor = await ctx.decodeAudioData(await datei.arrayBuffer());
        // rückwärts: jeden Kanal umgedreht kopieren
        rueck = new AudioBuffer({ length: vor.length, numberOfChannels: vor.numberOfChannels, sampleRate: vor.sampleRate });
        for (let k = 0; k < vor.numberOfChannels; k++) rueck.copyToChannel(vor.getChannelData(k).slice().reverse(), k);
        if (name) name.textContent = datei.name;
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
        reihe.append(label);
        el.append(reihe, c);
        zeichneWelle();
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

export const SAMPLER_MODULE = { schleife, sampler, kohle };
