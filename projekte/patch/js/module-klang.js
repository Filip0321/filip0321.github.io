// Neue Klangquellen (Runde 17): Wellenform zum Zeichnen, FM-Operator, Saite, Zungen (Akkordeon, Harmonium), Snare.

import { log, verstaerker, konstante, filter, rauschQuelle } from "./bausteine.js";

// Obertöne zeichnen: 16 Balken, Balken n ist die Stärke des n-ten Obertons (Frequenz n · f). Daraus macht
// createPeriodicWave eine Wellenform (Fourier-Reihe: jede periodische Welle ist eine Summe solcher Sinusse).
// Vorlagen zeigen das: Sägezahn = alle Obertöne mit 1/n, Rechteck = nur die ungeraden mit 1/n.
const OBERTOENE = 16;
const WELLEN = {
  saege: Array.from({ length: OBERTOENE }, (_, i) => 1 / (i + 1)),
  rechteck: Array.from({ length: OBERTOENE }, (_, i) => (i % 2 === 0 ? 1 / (i + 1) : 0)),
  orgel: [1, 0.7, 0, 0.5, 0, 0.3, 0, 0.25, 0, 0, 0, 0.12, 0, 0, 0, 0.1], // Fußlagen 8′, 4′, 2′, 1′ (Zugriegel)
  hohl: [1, 0, 0.6, 0, 0.4, 0, 0.2, 0, 0.1, 0, 0, 0, 0, 0, 0, 0], // Klarinette: fast nur ungerade
  glas: [1, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0, 0],
};

const wellenform = {
  titel: "Wellenform",
  gruppe: "Klang",
  baue(ctx) {
    const osc = ctx.createOscillator();
    const tonhoehe = verstaerker(ctx, 1200);
    const fm = verstaerker(ctx, 0);
    tonhoehe.connect(osc.detune);
    fm.connect(osc.frequency);
    osc.start();
    const anteile = WELLEN.saege.slice();
    const setzeWelle = () => {
      const real = new Float32Array(OBERTOENE + 1), imag = new Float32Array(OBERTOENE + 1);
      anteile.forEach((a, i) => (imag[i + 1] = a));
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag)); // normalisiert: gleich laut, egal wie viele Balken
    };
    setzeWelle();
    let zeichneBalken = () => {};
    return {
      ein: { "Tonhöhe": { art: "ton", ziel: tonhoehe }, FM: { art: "ton", ziel: fm } },
      aus: { aus: { art: "ton", knoten: osc } },
      regler: [
        { name: "frequenz", text: "Frequenz", ...log(20, 12000), wert: 110, einheit: "Hz", setze: (v) => osc.frequency.setTargetAtTime(v, ctx.currentTime, 0.01) },
        { name: "fmTiefe", text: "FM-Tiefe", ...log(1, 2000), wert: 100, einheit: "Hz", setze: (v) => fm.gain.setTargetAtTime(v, ctx.currentTime, 0.01) },
      ],
      wahl: [{
        name: "vorlage", text: "Vorlage", wert: "", optionen: [["", "–"], ["saege", "Sägezahn"], ["rechteck", "Rechteck"], ["orgel", "Orgel"], ["hohl", "hohl (Klarinette)"], ["glas", "Glas"]],
        setze: (v) => {
          if (!v) return;
          WELLEN[v].forEach((a, i) => (anteile[i] = a));
          setzeWelle();
          zeichneBalken();
        },
      }],
      extra: (el) => {
        const c = document.createElement("canvas");
        c.width = 320;
        c.height = 110;
        c.className = "schirm obertoene";
        c.setAttribute("aria-label", "16 Obertöne: ziehen stellt ihre Stärke");
        el.append(c);
        const g = c.getContext("2d");
        zeichneBalken = () => {
          // die Farbe der Seite (--text); beim ersten Zeichnen hängt das Fenster noch nicht an der Wand, dann
          // hat der Canvas selbst noch keine berechneten Stile
          const farbe = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#dddddd";
          g.clearRect(0, 0, c.width, c.height);
          g.fillStyle = farbe;
          const b = c.width / OBERTOENE;
          anteile.forEach((a, i) => g.fillRect(i * b + 2, c.height * (1 - a), b - 4, c.height * a));
        };
        zeichneBalken();
        let zieht = false;
        const stelle = (ev) => {
          const r = c.getBoundingClientRect();
          const i = Math.floor(((ev.clientX - r.left) / r.width) * OBERTOENE);
          if (i < 0 || i >= OBERTOENE) return;
          anteile[i] = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height));
          setzeWelle();
          zeichneBalken();
        };
        c.addEventListener("pointerdown", (ev) => { zieht = true; c.setPointerCapture(ev.pointerId); stelle(ev); ev.stopPropagation(); });
        c.addEventListener("pointermove", (ev) => zieht && stelle(ev));
        c.addEventListener("pointerup", () => (zieht = false));
        // Speichern wie beim Sequenzer (main.js liest schritteLesen und ruft beim Laden schritteSetzen)
        el.schritteLesen = () => anteile.map((a) => Math.round(a * 1000) / 1000);
        el.schritteSetzen = (liste) => {
          liste?.forEach((a, i) => (anteile[i] = a));
          setzeWelle();
          zeichneBalken();
        };
      },
      weg: () => osc.stop(),
    };
  },
};

// FM (John Chowning, 1973; Yamaha DX7): ein Oszillator (Modulator) verändert die Frequenz eines zweiten (Träger)
// so schnell, dass man es nicht als Vibrato hört, sondern als neue Obertöne. Seitenbänder liegen bei
// Träger ± k · Modulator. Ganzzahliges Verhältnis (1, 2, 3): harmonisch, wie Saiten und Bläser. Krummes
// (1,41, 3,5): unharmonisch, wie Glocken und Metall. Index = Hub / Modulatorfrequenz: wie viele Seitenbänder
// hörbar sind, also wie hell. Eine Hüllkurve am Index ist der klassische Glocken- und E-Piano-Klang:
// hell beim Anschlag, dann weicher.
const fmop = {
  titel: "FM-Operator",
  gruppe: "Klang",
  baue(ctx) {
    const traeger = ctx.createOscillator(), modulator = ctx.createOscillator();
    const tonhoehe = verstaerker(ctx, 1200);
    tonhoehe.connect(traeger.detune);
    tonhoehe.connect(modulator.detune);
    const hub = verstaerker(ctx, 0); // Modulator → Hub (Hz) → Trägerfrequenz
    const indexMod = verstaerker(ctx, 0); // Kabel am Index: × (Modulatorfrequenz) dazu
    modulator.connect(hub).connect(traeger.frequency);
    indexMod.connect(hub.gain);
    traeger.start();
    modulator.start();
    const w = { f: 220, verhaeltnis: 2, index: 2 };
    const stelle = () => {
      modulator.frequency.setTargetAtTime(w.f * w.verhaeltnis, ctx.currentTime, 0.01);
      traeger.frequency.setTargetAtTime(w.f, ctx.currentTime, 0.01);
      hub.gain.setTargetAtTime(w.index * w.f * w.verhaeltnis, ctx.currentTime, 0.01);
      indexMod.gain.value = w.f * w.verhaeltnis; // Kabel 1,0 = Index + 1
    };
    stelle();
    return {
      ein: { "Tonhöhe": { art: "ton", ziel: tonhoehe }, Index: { art: "ton", ziel: indexMod } },
      aus: { aus: { art: "ton", knoten: traeger } },
      regler: [
        { name: "frequenz", text: "Frequenz", ...log(20, 4000), wert: 220, einheit: "Hz", setze: (v) => { w.f = v; stelle(); } },
        { name: "verhaeltnis", text: "Verhältnis", min: 0.25, max: 8, wert: 2, setze: (v) => { w.verhaeltnis = v; stelle(); } },
        { name: "index", text: "Index", min: 0, max: 12, wert: 2, setze: (v) => { w.index = v; stelle(); } },
      ],
      wahl: [{ name: "form", text: "Träger", optionen: [["sine", "Sinus"], ["triangle", "Dreieck"]], wert: "sine", setze: (v) => (traeger.type = v) }],
      weg: () => { traeger.stop(); modulator.stop(); },
    };
  },
};

// Saite: Karplus-Strong im AudioWorklet (worklets.js). Ein Takt zupft; die Tonhöhe kommt wie überall als 1,0 pro Oktave.
const saite = {
  titel: "Saite",
  gruppe: "Klang",
  baue(ctx) {
    const knoten = new AudioWorkletNode(ctx, "saite", { numberOfInputs: 0, outputChannelCount: [1] });
    const p = (n) => knoten.parameters.get(n);
    const tonhoehe = verstaerker(ctx, 1);
    tonhoehe.connect(p("tonhoehe"));
    return {
      ein: {
        "Tonhöhe": { art: "ton", ziel: tonhoehe },
        Zupfen: { art: "takt", ziel: (t) => knoten.port.postMessage({ zeit: t }) },
      },
      aus: { aus: { art: "ton", knoten } },
      regler: [
        { name: "frequenz", text: "Frequenz", ...log(30, 2000), wert: 110, einheit: "Hz", setze: (v) => p("frequenz").setValueAtTime(v, ctx.currentTime) },
        { name: "klingen", text: "Klingen", min: 0.9, max: 0.9999, wert: 0.996, setze: (v) => p("daempfung").setValueAtTime(v, ctx.currentTime) },
        { name: "hell", text: "Hell", min: 0, max: 1, wert: 0.3, setze: (v) => p("hell").setValueAtTime(v, ctx.currentTime) },
      ],
      weg: () => knoten.disconnect(),
    };
  },
};

// Zungen: Akkordeon und Harmonium. Eine Zunge aus Metall schwingt im Luftstrom und schneidet ihn in Pulse: ein
// Klang mit sehr vielen Obertönen (hier ein schmaler Puls, aus zwei gegeneinander verschobenen Sägezähnen).
// Register:
//   8′          eine Zunge in der gespielten Lage
//   16′ + 8′    dazu eine eine Oktave tiefer (voller, Bandoneon)
//   Musette     drei Zungen, zwei davon gegeneinander verstimmt: die Schwebung (das „Wabern“ des französischen
//               Akkordeons) ist der Abstand ihrer Frequenzen, bei 15 Cent und 220 Hz etwa 2 Mal pro Sekunde
//   Harmonium   8′ + 4′ (eine Oktave höher), weicher gefiltert, wie das indische Harmonium
// Balg: Luftstrom, wirkt auf die Lautstärke (ein Kabel von einer Hüllkurve oder einem MIDI-Regler).
const REGISTER = {
  "8": [[0, 0]],
  "16+8": [[0, 0], [-12, 0]],
  musette: [[0, 0], [0, -1], [0, 1]],
  harmonium: [[0, 0], [12, 0]],
};
const zungen = {
  titel: "Zungen",
  gruppe: "Klang",
  baue(ctx) {
    const tonhoehe = verstaerker(ctx, 1200);
    const summe = verstaerker(ctx, 0.25);
    const ton = filter(ctx, "lowpass", 3000, 0.5); // Holzgehäuse und Verdeck dämpfen die Höhen
    const koerper = filter(ctx, "peaking", 1100, 1.2); // Resonanz des Gehäuses
    koerper.gain.value = 5;
    const balg = verstaerker(ctx, 0); // Grundpegel + Kabel
    summe.connect(koerper).connect(ton).connect(balg);
    const w = { f: 220, verstimmung: 15, register: "musette" };
    let stimmen = [];
    const baueStimmen = () => {
      for (const s of stimmen) s.forEach((o) => o.stop());
      stimmen = REGISTER[w.register].map(([okt, schwebung]) => {
        // Puls = Sägezahn − verschobener Sägezahn; Breite 20 %: so klingt eine Zunge eher nasal als hohl
        const a = ctx.createOscillator(), b = ctx.createOscillator();
        a.type = b.type = "sawtooth";
        const minus = verstaerker(ctx, -1), verzoegerung = ctx.createDelay(0.1);
        for (const o of [a, b]) {
          tonhoehe.connect(o.detune);
          o.frequency.value = w.f * 2 ** (okt / 12);
          o.detune.value = schwebung * w.verstimmung;
          o.start();
        }
        verzoegerung.delayTime.value = 0.2 / (w.f * 2 ** (okt / 12));
        a.connect(summe);
        b.connect(verzoegerung).connect(minus).connect(summe);
        a.verzoegerung = verzoegerung;
        return [a, b];
      });
    };
    baueStimmen();
    return {
      ein: { "Tonhöhe": { art: "ton", ziel: tonhoehe }, Balg: { art: "ton", ziel: balg.gain } },
      aus: { aus: { art: "ton", knoten: balg } },
      regler: [
        { name: "frequenz", text: "Frequenz", ...log(40, 1000), wert: 220, einheit: "Hz", setze: (v) => { w.f = v; baueStimmen(); } },
        { name: "verstimmung", text: "Schwebung", min: 0, max: 40, wert: 15, einheit: "Cent", setze: (v) => { w.verstimmung = v; stimmen.forEach((s, i) => s.forEach((o) => (o.detune.value = REGISTER[w.register][i][1] * v))); } },
        { name: "hell", text: "Hell", ...log(500, 8000), wert: 3000, einheit: "Hz", setze: (v) => ton.frequency.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "luft", text: "Grundluft", min: 0, max: 1, wert: 0, setze: (v) => balg.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [{
        name: "register", text: "Register", wert: "musette",
        optionen: [["8", "8′"], ["16+8", "16′ + 8′"], ["musette", "Musette"], ["harmonium", "Harmonium (8′ + 4′)"]],
        setze: (v) => {
          w.register = v;
          ton.frequency.value = v === "harmonium" ? 1800 : 3000;
          baueStimmen();
        },
      }],
      weg: () => stimmen.forEach((s) => s.forEach((o) => o.stop())),
    };
  },
};

// Snare: zwei Teile wie bei der Drum-Maschine (TR-808/909): ein kurzer Ton (das Fell, mit fallender Tonhöhe) und
// Rauschen durch einen Hochpass (der Teppich aus Drahtspiralen unter dem Fell).
const snare = {
  titel: "Snare",
  gruppe: "Klang",
  baue(ctx) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    const fell = verstaerker(ctx, 0);
    osc.connect(fell);
    osc.start();
    const rauschen = rauschQuelle(ctx);
    const hoch = filter(ctx, "highpass", 1500);
    const teppich = verstaerker(ctx, 0);
    rauschen.connect(hoch).connect(teppich);
    const aus = verstaerker(ctx, 0.8);
    fell.connect(aus);
    teppich.connect(aus);
    const w = { ton: 190, mischung: 0.6, laenge: 0.18 };
    const schlag = (t) => {
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(w.ton * 1.6, t);
      osc.frequency.exponentialRampToValueAtTime(w.ton, t + 0.03);
      for (const [g, stark, l] of [[fell, 1 - w.mischung, w.laenge * 0.6], [teppich, w.mischung, w.laenge]]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(stark, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + l);
      }
    };
    return {
      ein: { Auslöser: { art: "takt", ziel: schlag } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "ton", text: "Ton", ...log(100, 400), wert: 190, einheit: "Hz", setze: (v) => (w.ton = v) },
        { name: "mischung", text: "Teppich", min: 0, max: 1, wert: 0.6, setze: (v) => (w.mischung = v) },
        { name: "laenge", text: "Länge", ...log(0.05, 0.8), wert: 0.18, einheit: "s", setze: (v) => (w.laenge = v) },
        { name: "farbe", text: "Farbe", ...log(500, 8000), wert: 1500, einheit: "Hz", setze: (v) => (hoch.frequency.value = v) },
      ],
      weg: () => { osc.stop(); rauschen.stop(); },
    };
  },
};

export const KLANG = { wellenform, fmop, saite, zungen, snare };
