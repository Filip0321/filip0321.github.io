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

  // Gleiche Werte für Live-Ausgabe und Offline-Export. Damit folgen beide exakt derselben Tonhöhen-,
  // Panorama- und Lautstärkerechnung.
  function werteFuerExport(schwarm, breite, hoehe, e) {
    const n = schwarm.n, k = e.tonStimmen;
    const leiter = LEITERN[e.tonLeiter];
    const grund = 55 * 2 ** e.tonOktave;
    const laut = e.tonLaut / Math.sqrt(Math.max(1, k));
    const stimmenWerte = Array.from({ length: k }, (_, j) => {
      const i = Math.floor(((j + 0.5) / k) * n);
      if (i >= n) return { freq: grund, pan: 0, laut: 0 };
      const hoch = 1 - schwarm.y[i] / hoehe;
      let oktaven = hoch * e.tonUmfang;
      if (leiter) {
        const stufen = leiter.length * e.tonUmfang;
        const stufe = Math.round(hoch * (stufen - 1));
        oktaven = Math.floor(stufe / leiter.length) + leiter[stufe % leiter.length] / 12;
      }
      const tempo = Math.hypot(schwarm.vx[i], schwarm.vy[i]) / Math.max(1, e.vmax);
      return {
        freq: grund * 2 ** oktaven,
        pan: Math.max(-1, Math.min(1, (schwarm.x[i] / breite) * 2 - 1)),
        laut: laut * Math.min(1, tempo * tempo),
      };
    });
    const m = schwarm.messe();
    return {
      stimmen: stimmenWerte,
      rauschPegel: e.tonRauschen * Math.min(1, m.tempo / Math.max(1, e.vmax)) ** 2,
      rauschFrequenz: 400 + 1600 * m.ordnung,
      hell: e.tonHell,
      hall: e.tonHall,
      leiter: Boolean(leiter),
    };
  }

  // Jedes Bild: Schwarmpositionen in die gleichen Werte übersetzen wie beim Live-Ton.
  function nachfuehren(schwarm, breite, hoehe, e) {
    if (!ctx || !stimmen.length) return;
    if (stimmen.length !== e.tonStimmen || stimmen[0].osc.type !== e.tonForm) baue(e.tonStimmen, e.tonForm);
    const t = ctx.currentTime;
    const werte = werteFuerExport(schwarm, breite, hoehe, e);
    stimmen.forEach((s, j) => {
      const v = werte.stimmen[j];
      s.osc.frequency.setTargetAtTime(v.freq, t, werte.leiter ? 0.01 : 0.03);
      s.p.pan.setTargetAtTime(v.pan, t, 0.03);
      s.g.gain.setTargetAtTime(v.laut, t, 0.03);
    });
    rauschPegel.gain.setTargetAtTime(werte.rauschPegel, t, 0.05);
    rauschBand.frequency.setTargetAtTime(werte.rauschFrequenz, t, 0.1);
    tief.frequency.setTargetAtTime(werte.hell, t, 0.05);
    nass.gain.setTargetAtTime(werte.hall, t, 0.05);
  }

  // Den Schwarmklang für ein gerendertes Video offline rechnen. Die Werte kommen Bild für Bild aus derselben
  // Simulation wie das Video; das Audio läuft dadurch auch dann synchron, wenn der Export schneller als Echtzeit ist.
  async function rendereExport(zeitplan, e, fps = 30) {
    if (!ctx || !stimmen.length || !zeitplan.length) return null;
    const rate = ctx.sampleRate;
    const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil((zeitplan.length / fps) * rate)), rate);
    const summe = new GainNode(offline);
    const tief = new BiquadFilterNode(offline, { type: "lowpass", frequency: e.tonHell });
    const hall = new ConvolverNode(offline, { buffer: hallImpuls(offline, 3) });
    const nass = new GainNode(offline, { gain: 0.4 });
    const aus = new GainNode(offline, { gain: 0.8 });
    summe.connect(tief).connect(aus);
    tief.connect(hall).connect(nass).connect(aus);
    aus.connect(offline.destination);

    const stimmenOffline = Array.from({ length: e.tonStimmen }, () => {
      const osc = new OscillatorNode(offline, { type: e.tonForm, frequency: 220 });
      const gain = new GainNode(offline, { gain: 0 });
      const pan = new StereoPannerNode(offline);
      osc.connect(gain).connect(pan).connect(summe);
      osc.start();
      return { osc, gain, pan };
    });

    const rauschen = offline.createBuffer(1, rate * 2, rate);
    const rauschenDaten = rauschen.getChannelData(0);
    for (let i = 0; i < rauschenDaten.length; i++) rauschenDaten[i] = Math.random() * 2 - 1;
    const quelle = new AudioBufferSourceNode(offline, { buffer: rauschen, loop: true });
    const band = new BiquadFilterNode(offline, { type: "bandpass", frequency: 900, Q: 0.8 });
    const pegel = new GainNode(offline, { gain: 0 });
    quelle.connect(band).connect(pegel).connect(tief);
    quelle.start();

    zeitplan.forEach((werte, i) => {
      const t = i / fps;
      werte.stimmen.forEach((v, j) => {
        const s = stimmenOffline[j];
        s.osc.frequency.setTargetAtTime(v.freq, t, werte.leiter ? 0.01 : 0.03);
        s.pan.pan.setTargetAtTime(v.pan, t, 0.03);
        s.gain.gain.setTargetAtTime(v.laut, t, 0.03);
      });
      pegel.gain.setTargetAtTime(werte.rauschPegel, t, 0.05);
      band.frequency.setTargetAtTime(werte.rauschFrequenz, t, 0.1);
      tief.frequency.setTargetAtTime(werte.hell, t, 0.05);
      nass.gain.setTargetAtTime(werte.hall, t, 0.05);
    });
    return offline.startRendering();
  }

  return {
    an, aus: aus_, nachfuehren, werteFuerExport, rendereExport,
    aktiv: () => Boolean(ctx && stimmen.length),
    liveTon: () => (ctx && stimmen.length ? { spur: strom.stream.getAudioTracks()[0], kanaele: 2, rate: ctx.sampleRate } : null),
  };
}


