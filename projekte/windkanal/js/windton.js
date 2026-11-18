// Windton: der Kanal singt wie ein Draht im Wind (Äolsharfe).
//
// Hinter einem Zylinder lösen sich die Wirbel abwechselnd oben und unten ab (Kármánsche Wirbelstraße). Ihre Frequenz
// folgt einer erstaunlich festen Regel (Strouhal 1878):
//   f = St · v / D        St ≈ 0,2 über einen weiten Bereich (Re etwa 300 bis 200 000)
// Ein Telefondraht (D = 3 mm) in Wind von 10 m/s: f ≈ 0,2 · 10 / 0,003 ≈ 670 Hz. Das ist das Singen der Leitungen.
//
// main.js misst an der Sonde, wie oft die Querströmung uy das Vorzeichen wechselt, und daraus St. Hier wird St in
// echte Größen übersetzt: Wind in m/s und Draht in mm frei gewählt, f = St · v / D. Der Ton ist Rauschen durch einen
// schmalen Bandpass bei f (so klingen echte Wirbel: kein reiner Ton, ein „pfeifendes“ Rauschen) und ein Sinus bei f,
// beide so laut, wie die Sonde schwankt.
//
// „Harfe“: Eine Saite hat Obertöne n · f0. Die Wirbel regen die Saite an, und die Saite zwingt umgekehrt die Wirbel in
// ihren Takt, wenn f nah an einem Oberton liegt („Lock-in“). Darum springt eine Äolsharfe bei steigendem Wind von
// Oberton zu Oberton, statt zu gleiten. Hier: f wird auf den nächsten Oberton von f0 gerastet.

export function erstelleWindton() {
  let ctx = null, band, sinus, rauschPegel, sinusPegel, tief, aus, strom;

  async function an() {
    ctx ??= new AudioContext();
    await ctx.resume();
    if (band) return;
    const n = ctx.sampleRate * 2, puffer = ctx.createBuffer(1, n, ctx.sampleRate), d = puffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const rauschen = new AudioBufferSourceNode(ctx, { buffer: puffer, loop: true });
    band = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 400, Q: 25 });
    rauschPegel = new GainNode(ctx, { gain: 0 });
    sinus = new OscillatorNode(ctx, { frequency: 400 });
    sinusPegel = new GainNode(ctx, { gain: 0 });
    tief = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 6000 });
    aus = new GainNode(ctx, { gain: 0.5 });
    strom = ctx.createMediaStreamDestination();
    rauschen.connect(band).connect(rauschPegel).connect(tief);
    sinus.connect(sinusPegel).connect(tief);
    tief.connect(aus);
    aus.connect(ctx.destination);
    aus.connect(strom);
    rauschen.start();
    sinus.start();
  }

  function aus_() {
    if (!ctx) return;
    rauschPegel.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    sinusPegel.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  // st: gemessene Strouhal-Zahl (oder null), staerke: 0 … 1 (wie stark die Sonde schwankt), e: Einstellungen
  function nachfuehren(st, staerke, e, windFaktor = 1) {
    if (!band) return;
    const t = ctx.currentTime;
    if (!st || !e.tonAn) {
      rauschPegel.gain.setTargetAtTime(0, t, 0.1);
      sinusPegel.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    let f = (st * e.tonWind * windFaktor) / (e.tonDraht / 1000);
    if (e.tonHarfe) {
      const n = Math.max(1, Math.round(f / e.tonSaite));
      f = n * e.tonSaite;
    }
    f = Math.min(12000, Math.max(30, f));
    band.frequency.setTargetAtTime(f, t, 0.08);
    sinus.frequency.setTargetAtTime(f, t, e.tonHarfe ? 0.01 : 0.08);
    const laut = Math.min(1, staerke) * e.tonLaut;
    rauschPegel.gain.setTargetAtTime(laut * 3 * (1 - e.tonRein), t, 0.08); // ein schmales Band ist leise: mal 3
    sinusPegel.gain.setTargetAtTime(laut * 0.4 * e.tonRein, t, 0.08);
    return f;
  }

  return {
    an,
    aus: aus_,
    nachfuehren,
    liveTon: () => (strom ? { spur: strom.stream.getAudioTracks()[0], kanaele: 2, rate: ctx.sampleRate } : null),
  };
}
