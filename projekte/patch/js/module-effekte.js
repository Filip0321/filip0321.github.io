// Neue Effekte (Runde 17): Verzerrung, Bitcrusher, Band, Hall, Chorus, Kompressor, Mehrband, Panorama.

import { log, verstaerker, filter } from "./bausteine.js";

// trocken/nass mischen: ein → trocken → aus und ein → [Effekt] → nass → aus
function mischer(ctx) {
  const ein = verstaerker(ctx, 1), trocken = verstaerker(ctx, 0.5), nass = verstaerker(ctx, 0.5), aus = verstaerker(ctx, 1);
  ein.connect(trocken).connect(aus);
  nass.connect(aus);
  const setze = (m) => {
    // gleiche Lautheit beim Überblenden: cos/sin statt linear (sonst ein Loch in der Mitte)
    trocken.gain.setTargetAtTime(Math.cos((m * Math.PI) / 2), ctx.currentTime, 0.02);
    nass.gain.setTargetAtTime(Math.sin((m * Math.PI) / 2), ctx.currentTime, 0.02);
  };
  return { ein, nass, aus, setze };
}
const mixRegler = (m, wert = 0.5) => ({ name: "mix", text: "Mix", min: 0, max: 1, wert, setze: m.setze });

// ---------- Verzerrung ----------
// Eine Kennlinie biegt jeden Wert: y = tanh(a · x) / tanh(a). Kleine Werte bleiben fast gleich, große werden
// gestaucht: aus einem Sinus wird fast ein Rechteck, es entstehen ungerade Obertöne (wie ein übersteuerter
// Röhrenverstärker). oversample 4x: die Kennlinie läuft auf vierfacher Abtastrate, sonst spiegeln sich die neuen
// hohen Obertöne als Klirren zurück ins Hörbare.
function kennlinie(a, art) {
  const n = 2048, k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    k[i] = art === "falten"
      ? Math.sin(x * a * 0.5 * Math.PI) // Wavefolder: statt zu stauchen faltet die Welle zurück (Buchla, West Coast)
      : art === "hart" ? Math.max(-1, Math.min(1, x * a)) : Math.tanh(a * x) / Math.tanh(a);
  }
  return k;
}
const verzerrung = {
  titel: "Verzerrung",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const m = mischer(ctx);
    const form = ctx.createWaveShaper();
    form.oversample = "4x";
    const ton = filter(ctx, "lowpass", 8000);
    const pegel = verstaerker(ctx, 0.7);
    m.ein.connect(form).connect(ton).connect(pegel).connect(m.nass);
    const w = { a: 4, art: "weich" };
    const neu = () => (form.curve = kennlinie(w.a, w.art));
    neu();
    return {
      ein: { ein: { art: "ton", ziel: m.ein } },
      aus: { aus: { art: "ton", knoten: m.aus } },
      regler: [
        { name: "antrieb", text: "Antrieb", ...log(1, 50), wert: 4, setze: (v) => { w.a = v; neu(); } },
        { name: "ton", text: "Ton", ...log(500, 16000), wert: 8000, einheit: "Hz", setze: (v) => ton.frequency.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "pegel", text: "Pegel", min: 0, max: 1, wert: 0.7, setze: (v) => pegel.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        mixRegler(m, 1),
      ],
      wahl: [{ name: "art", text: "Art", optionen: [["weich", "weich (tanh)"], ["hart", "hart (Clipping)"], ["falten", "falten (Wavefolder)"]], wert: "weich", setze: (v) => { w.art = v; neu(); } }],
    };
  },
};

// ---------- Bitcrusher ----------
const bitcrusher = {
  titel: "Bitcrusher",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const m = mischer(ctx);
    const k = new AudioWorkletNode(ctx, "bitcrusher", { outputChannelCount: [2] });
    m.ein.connect(k).connect(m.nass);
    return {
      ein: { ein: { art: "ton", ziel: m.ein } },
      aus: { aus: { art: "ton", knoten: m.aus } },
      regler: [
        { name: "bits", text: "Bits", min: 1, max: 16, wert: 6, schritt: 1, setze: (v) => k.parameters.get("bits").setValueAtTime(v, ctx.currentTime) },
        { name: "teiler", text: "Rate ÷", min: 1, max: 40, wert: 4, schritt: 1, setze: (v) => k.parameters.get("teiler").setValueAtTime(v, ctx.currentTime) },
        mixRegler(m, 1),
      ],
    };
  },
};

// ---------- Band ----------
// Tape: Gleichlauf (Wow, Flutter), Sättigung und Rauschen im Worklet; danach ein Tiefpass, weil Band und
// Tonkopf die Höhen verlieren (je öfter überspielt, desto dumpfer: „Alter“).
const band = {
  titel: "Band",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const k = new AudioWorkletNode(ctx, "band", { outputChannelCount: [2] });
    const alter = filter(ctx, "lowpass", 9000, 0.6);
    // Kopfbuckel (Runde 21): Tonköpfe heben die Tiefen um 60–120 Hz leicht an (die Spaltbreite des Kopfs passt dort
    // gerade zur Wellenlänge auf dem Band). Ein Glockenfilter (peaking) bei 90 Hz macht das nach: der „warme“ Bass.
    const kopf = ctx.createBiquadFilter();
    kopf.type = "peaking";
    kopf.frequency.value = 90;
    kopf.Q.value = 0.9;
    kopf.gain.value = 2;
    const ein = verstaerker(ctx, 1);
    ein.connect(k).connect(kopf).connect(alter);
    const p = (n) => k.parameters.get(n);
    return {
      ein: { ein: { art: "ton", ziel: ein } },
      aus: { aus: { art: "ton", knoten: alter } },
      regler: [
        { name: "wow", text: "Wow", min: 0, max: 1, wert: 0.3, setze: (v) => p("wow").setValueAtTime(v, ctx.currentTime) },
        { name: "flutter", text: "Flutter", min: 0, max: 1, wert: 0.2, setze: (v) => p("flutter").setValueAtTime(v, ctx.currentTime) },
        { name: "antrieb", text: "Sättigung", ...log(0.2, 8), wert: 1.5, setze: (v) => p("antrieb").setValueAtTime(v, ctx.currentTime) },
        { name: "rauschen", text: "Rauschen", min: 0, max: 0.03, wert: 0.003, setze: (v) => p("rauschen").setValueAtTime(v, ctx.currentTime) },
        { name: "alter", text: "Alter", ...log(1500, 16000), wert: 9000, einheit: "Hz", setze: (v) => alter.frequency.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "kopf", text: "Kopfbuckel", min: 0, max: 8, wert: 2, einheit: "dB", setze: (v) => kopf.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "aussetzer", text: "Aussetzer", min: 0, max: 1, wert: 0, setze: (v) => p("aussetzer").setValueAtTime(v, ctx.currentTime) },
      ],
    };
  },
};

// ---------- Hall ----------
// Faltungshall: der ConvolverNode faltet den Ton mit einer Impulsantwort (was ein Raum aus einem Klatschen macht).
// Hier ausgedacht statt aufgenommen: Rauschen, das exponentiell leiser wird (Nachhallzeit = bis −60 dB), links und
// rechts verschieden (Breite). Dämpfung: ein Tiefpass, der mit der Zeit enger wird, weil Luft und Wände hohe
// Frequenzen schneller schlucken. Vorverzögerung: Abstand zwischen Direktschall und erster Reflexion.
function impuls(ctx, zeit, daempfung) {
  const n = Math.ceil(ctx.sampleRate * zeit), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let tief = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      const huelle = 10 ** ((-3 * t) / zeit); // −60 dB nach „zeit“
      const glatt = Math.min(0.99, daempfung * (t / zeit)); // Tiefpass wird mit der Zeit enger
      tief = tief * glatt + (Math.random() * 2 - 1) * (1 - glatt);
      d[i] = tief * huelle;
    }
  }
  return b;
}
const hall = {
  titel: "Hall",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const m = mischer(ctx);
    const vor = ctx.createDelay(0.2), faltung = ctx.createConvolver();
    m.ein.connect(vor).connect(faltung).connect(m.nass);
    const w = { zeit: 2.5, daempfung: 0.6 };
    let uhr = 0;
    const neu = () => {
      clearTimeout(uhr); // beim Drehen nicht bei jedem Schritt neu rechnen
      uhr = setTimeout(() => (faltung.buffer = impuls(ctx, w.zeit, w.daempfung)), 80);
    };
    faltung.buffer = impuls(ctx, w.zeit, w.daempfung);
    return {
      ein: { ein: { art: "ton", ziel: m.ein } },
      aus: { aus: { art: "ton", knoten: m.aus } },
      regler: [
        { name: "zeit", text: "Nachhall", ...log(0.2, 12), wert: 2.5, einheit: "s", setze: (v) => { w.zeit = v; neu(); } },
        { name: "daempfung", text: "Dämpfung", min: 0, max: 0.99, wert: 0.6, setze: (v) => { w.daempfung = v; neu(); } },
        { name: "vor", text: "Vorverz.", ...log(0.001, 0.2), wert: 0.02, einheit: "s", setze: (v) => vor.delayTime.setTargetAtTime(v, ctx.currentTime, 0.02) },
        mixRegler(m, 0.35),
      ],
    };
  },
};

// ---------- Chorus ----------
// Zwei kurze Verzögerungen (10 bis 25 ms), deren Länge ein langsamer LFO bewegt: zwei leicht verstimmte Kopien,
// links und rechts gegenläufig. Klingt wie mehrere Spieler zugleich (Streicher, Juno-Flächen).
const chorus = {
  titel: "Chorus",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const m = mischer(ctx);
    const teile = ctx.createChannelMerger(2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.4;
    lfo.start();
    const tiefe = verstaerker(ctx, 0.004);
    lfo.connect(tiefe);
    const minus = verstaerker(ctx, -1);
    tiefe.connect(minus);
    [tiefe, minus].forEach((mod, c) => {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = 0.018;
      mod.connect(d.delayTime);
      m.ein.connect(d).connect(teile, 0, c);
    });
    teile.connect(m.nass);
    return {
      ein: { ein: { art: "ton", ziel: m.ein } },
      aus: { aus: { art: "ton", knoten: m.aus } },
      regler: [
        { name: "tempo", text: "Tempo", ...log(0.05, 5), wert: 0.4, einheit: "Hz", setze: (v) => (lfo.frequency.value = v) },
        { name: "tiefe", text: "Tiefe", ...log(0.0005, 0.01), wert: 0.004, einheit: "s", setze: (v) => tiefe.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        mixRegler(m, 0.5),
      ],
      weg: () => lfo.stop(),
    };
  },
};

// ---------- Kompressor ----------
// Macht Lautes leiser: über der Schwelle wird jeder dB Überschuss durch das Verhältnis geteilt (4:1 → aus 8 dB
// über der Schwelle werden 2). Attack/Release: wie schnell er zupackt und loslässt. Danach wieder lauter machen
// („Aufholen“), dann ist alles dichter. Die Anzeige zeigt, um wie viel dB er gerade absenkt.
const kompressor = {
  titel: "Kompressor",
  gruppe: "Bearbeiten",
  baue(ctx, { bild }) {
    const k = ctx.createDynamicsCompressor();
    const auf = verstaerker(ctx, 1);
    k.connect(auf);
    let anzeige = null;
    const zeichne = () => anzeige && (anzeige.value = -k.reduction);
    return {
      ein: { ein: { art: "ton", ziel: k } },
      aus: { aus: { art: "ton", knoten: auf } },
      regler: [
        { name: "schwelle", text: "Schwelle", min: -60, max: 0, wert: -24, einheit: "dB", setze: (v) => (k.threshold.value = v) },
        { name: "verhaeltnis", text: "Verhältnis", ...log(1, 20), wert: 4, setze: (v) => (k.ratio.value = v) },
        { name: "attack", text: "Attack", ...log(0.001, 0.3), wert: 0.01, einheit: "s", setze: (v) => (k.attack.value = v) },
        { name: "release", text: "Release", ...log(0.02, 1), wert: 0.2, einheit: "s", setze: (v) => (k.release.value = v) },
        { name: "aufholen", text: "Aufholen", min: 0, max: 24, wert: 6, einheit: "dB", setze: (v) => auf.gain.setTargetAtTime(10 ** (v / 20), ctx.currentTime, 0.02) },
      ],
      extra: (el) => {
        const l = document.createElement("label");
        l.className = "reduktion";
        l.append("Absenkung ");
        anzeige = document.createElement("meter");
        anzeige.min = 0;
        anzeige.max = 24;
        l.append(anzeige);
        el.append(l);
        bild.add(zeichne);
      },
      weg: () => bild.delete(zeichne),
    };
  },
};

// ---------- Mehrband ----------
// Teilt in Tiefen, Mitten und Höhen (Linkwitz-Riley: zwei Butterworth-Filter hintereinander, Güte 0,707; an der
// Trennfrequenz sind beide Seiten je −6 dB und addieren sich wieder zu einer glatten Summe). Jedes Band einzeln
// heraus (zum Weiterbearbeiten, z. B. nur die Tiefen komprimieren) und als Summe mit eigenem Pegel pro Band.
function zweifach(ctx, typ, f) {
  const a = filter(ctx, typ, f), b = filter(ctx, typ, f);
  a.connect(b);
  return { ein: a, aus: b, setze: (v) => [a, b].forEach((x) => x.frequency.setTargetAtTime(v, ctx.currentTime, 0.02)) };
}
const mehrband = {
  titel: "Mehrband",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const ein = verstaerker(ctx, 1);
    const tief = zweifach(ctx, "lowpass", 200), hochA = zweifach(ctx, "highpass", 200);
    const mitte = zweifach(ctx, "lowpass", 2500), hoch = zweifach(ctx, "highpass", 2500);
    ein.connect(tief.ein);
    ein.connect(hochA.ein);
    hochA.aus.connect(mitte.ein);
    hochA.aus.connect(hoch.ein);
    const pegel = [verstaerker(ctx, 1), verstaerker(ctx, 1), verstaerker(ctx, 1)];
    const summe = verstaerker(ctx, 1);
    [tief.aus, mitte.aus, hoch.aus].forEach((b, i) => b.connect(pegel[i]).connect(summe));
    const db = (g) => (v) => g.gain.setTargetAtTime(10 ** (v / 20), ctx.currentTime, 0.02);
    return {
      ein: { ein: { art: "ton", ziel: ein } },
      aus: { Summe: { art: "ton", knoten: summe }, Tief: { art: "ton", knoten: pegel[0] }, Mitte: { art: "ton", knoten: pegel[1] }, Hoch: { art: "ton", knoten: pegel[2] } },
      regler: [
        { name: "grenze1", text: "Tief bis", ...log(40, 1000), wert: 200, einheit: "Hz", setze: (v) => { tief.setze(v); hochA.setze(v); } },
        { name: "grenze2", text: "Mitte bis", ...log(500, 12000), wert: 2500, einheit: "Hz", setze: (v) => { mitte.setze(v); hoch.setze(v); } },
        { name: "tief", text: "Tief", min: -24, max: 12, wert: 0, einheit: "dB", setze: db(pegel[0]) },
        { name: "mitte", text: "Mitte", min: -24, max: 12, wert: 0, einheit: "dB", setze: db(pegel[1]) },
        { name: "hoch", text: "Hoch", min: -24, max: 12, wert: 0, einheit: "dB", setze: db(pegel[2]) },
      ],
    };
  },
};

// ---------- Panorama ----------
const panorama = {
  titel: "Panorama",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const p = ctx.createStereoPanner();
    const mod = verstaerker(ctx, 1);
    mod.connect(p.pan);
    return {
      ein: { ein: { art: "ton", ziel: p }, Lage: { art: "ton", ziel: mod } },
      aus: { aus: { art: "ton", knoten: p } },
      regler: [{ name: "lage", text: "Lage", min: -1, max: 1, wert: 0, setze: (v) => p.pan.setTargetAtTime(v, ctx.currentTime, 0.02) }],
    };
  },
};

export const EFFEKTE = { verzerrung, bitcrusher, band, hall, chorus, kompressor, mehrband, panorama };
