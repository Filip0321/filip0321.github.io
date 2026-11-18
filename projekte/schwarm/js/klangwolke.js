// Klangwolke: der Schwarm singt. Eine feste Auswahl von Vögeln bekommt je eine Stimme (ein Oszillator):
//   Höhe im Bild  →  Tonhöhe (oben hoch), über „Umfang“ Oktaven; stufenlos (Glissando, wie ein Theremin-Chor)
//                    oder auf eine Tonleiter gerastet
//   Lage links/rechts  →  Panorama
//   Tempo  →  Lautstärke: wer schnell fliegt, ist laut; ein ruhig kreisender Schwarm wird leise
// Alle Stimmen laufen durch einen Tiefpass und einen Hall (ausgedachte Impulsantwort wie in der Patch-Wand).
// Dazu „Flügelrauschen“: Rauschen durch einen Bandpass, so laut wie der Schwarm im Mittel schnell ist.
//
// Die Stimmen werden 60-mal pro Sekunde nachgeführt, mit setTargetAtTime (Zeitkonstante 30 ms): weich, ohne Knacken.
// Viele Stimmen gleich laut werden schnell zu laut; darum Lautstärke / √Stimmen (Leistung addiert sich).

const LEITERN = {
  stufenlos: null,
  "pentatonik-moll": [0, 3, 5, 7, 10],
  "pentatonik-dur": [0, 2, 4, 7, 9],
  moll: [0, 2, 3, 5, 7, 8, 10],
  ganzton: [0, 2, 4, 6, 8, 10],
};

function hallImpuls(ctx, zeit) {
  const n = Math.ceil(ctx.sampleRate * zeit), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let tief = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate, glatt = Math.min(0.97, 0.7 * (t / zeit));
      tief = tief * glatt + (Math.random() * 2 - 1) * (1 - glatt);
      d[i] = tief * 10 ** ((-3 * t) / zeit);
    }
  }
  return b;
}

export function erstelleKlangwolke() {
  let ctx = null, stimmen = [], summe, tief, hall, nass, aus, rauschBand, rauschPegel, strom;

  function baue(anzahl, form) {
    for (const s of stimmen) s.osc.stop();
    stimmen = Array.from({ length: anzahl }, () => {
      const osc = new OscillatorNode(ctx, { type: form, frequency: 220 });
      const g = new GainNode(ctx, { gain: 0 }), p = new StereoPannerNode(ctx);
      osc.connect(g).connect(p).connect(summe);
      osc.start();
      return { osc, g, p };
    });
  }

  async function an(e) {
    if (!ctx) {
      ctx = new AudioContext();
      summe = new GainNode(ctx);
      tief = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3000 });
      hall = new ConvolverNode(ctx, { buffer: hallImpuls(ctx, 3) });
      nass = new GainNode(ctx, { gain: 0.4 });
      aus = new GainNode(ctx, { gain: 0.8 });
      summe.connect(tief).connect(aus);
      tief.connect(hall).connect(nass).connect(aus);
      aus.connect(ctx.destination);
      strom = ctx.createMediaStreamDestination();
      aus.connect(strom);
      // Flügelrauschen
      const p = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = p.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const q = new AudioBufferSourceNode(ctx, { buffer: p, loop: true });
      rauschBand = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 0.8 });
      rauschPegel = new GainNode(ctx, { gain: 0 });
      q.connect(rauschBand).connect(rauschPegel).connect(tief);
      q.start();
    }
    baue(e.tonStimmen, e.tonForm);
    await ctx.resume();
  }

  function aus_() {
    if (!ctx) return;
    for (const s of stimmen) s.osc.stop();
    stimmen = [];
    rauschPegel.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  // jedes Bild: schwarm aus schwarm.js, breite/hoehe des Feldes, e die Einstellungen
  function nachfuehren(schwarm, breite, hoehe, e) {
    if (!ctx || !stimmen.length) return;
    if (stimmen.length !== e.tonStimmen || stimmen[0].osc.type !== e.tonForm) baue(e.tonStimmen, e.tonForm);
    const t = ctx.currentTime, n = schwarm.n, k = stimmen.length;
    const leiter = LEITERN[e.tonLeiter];
    const grund = 55 * 2 ** e.tonOktave;
    const laut = e.tonLaut / Math.sqrt(k);
    stimmen.forEach((s, j) => {
      const i = Math.floor(((j + 0.5) / k) * n);
      if (i >= n) return s.g.gain.setTargetAtTime(0, t, 0.03);
      const hoch = 1 - schwarm.y[i] / hoehe; // 0 unten, 1 oben
      let oktaven = hoch * e.tonUmfang;
      if (leiter) {
        const stufen = leiter.length * e.tonUmfang, st = Math.round(hoch * (stufen - 1));
        oktaven = Math.floor(st / leiter.length) + leiter[st % leiter.length] / 12;
      }
      const tempo = Math.hypot(schwarm.vx[i], schwarm.vy[i]) / Math.max(1, e.vmax);
      s.osc.frequency.setTargetAtTime(grund * 2 ** oktaven, t, leiter ? 0.01 : 0.03);
      s.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, (schwarm.x[i] / breite) * 2 - 1)), t, 0.03);
      s.g.gain.setTargetAtTime(laut * Math.min(1, tempo * tempo), t, 0.03);
    });
    const m = schwarm.messe();
    rauschPegel.gain.setTargetAtTime(e.tonRauschen * Math.min(1, m.tempo / Math.max(1, e.vmax)) ** 2, t, 0.05);
    rauschBand.frequency.setTargetAtTime(400 + 1600 * m.ordnung, t, 0.1); // geordneter Schwarm: helleres Rauschen
    tief.frequency.setTargetAtTime(e.tonHell, t, 0.05);
    nass.gain.setTargetAtTime(e.tonHall, t, 0.05);
  }

  return {
    an, aus: aus_, nachfuehren,
    liveTon: () => (ctx && stimmen.length ? { spur: strom.stream.getAudioTracks()[0], kanaele: 2, rate: ctx.sampleRate } : null),
  };
}
