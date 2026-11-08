// Ein Raum zwischen Lautsprecher und Mikrofon, nachgerechnet (OfflineAudioContext: schneller als Echtzeit).
// Was er mit dem SSTV-Ton macht, und was man im Bild davon sieht:
//   Hall        der Ton von eben klingt nach. In der Fourier-Sprache: zum Ton von jetzt mischt sich der von vor ein
//               paar Millisekunden, mit anderer Frequenz. Der Empfänger misst dann eine Mischfrequenz: das Bild
//               verschmiert nach rechts, und nach jedem hellen Pixel zieht ein Schatten (der Hall ist langsamer
//               als das Bild)
//   Echo        eine Wand: eine Kopie, einige ms später. Im Bild ein Geisterbild, das um so viele Pixel versetzt
//               ist, wie das Echo lang ist (M1: 0,46 ms pro Pixel)
//   Band        Lautsprecher und Mikrofon von Handys geben unten und oben wenig: SSTV liegt zum Glück bei 1–2,3 kHz
//   Rauschen    Lüfter, Straße, Stimmen: einzelne Pixel springen, bei viel Rauschen bunter Schnee
//   Abtastrate  zwei Geräte zählen nie genau gleich schnell (ppm: Millionstel). Ohne Einrasten wird das Bild schräg
//   Gleichlauf  wie ein leierndes Tonband: die Tonhöhe schwankt, die Farben wandern in Wellen
//   Geräusch    ein eigener Ton läuft im Raum mit (Musik, Stimmen, Straße), in Schleife und mit Hall: wo er
//               lauter ist als das SSTV-Signal, schreibt er sich ins Bild

export async function durchDenRaum(signal, rate, w) {
  const dauer = signal.length / rate;
  const laenge = Math.ceil((dauer / (1 + w.ppm * 1e-6) + w.nachhall + 0.5) * rate);
  const ctx = new OfflineAudioContext(1, laenge, rate);
  const puffer = new AudioBuffer({ length: signal.length, numberOfChannels: 1, sampleRate: rate });
  puffer.copyToChannel(signal, 0);
  const quelle = new AudioBufferSourceNode(ctx, { buffer: puffer });
  // Abtastrate daneben: schneller abspielen = alles etwas kürzer und höher (wie ein Gerät, das anders zählt)
  const grund = 1 + w.ppm * 1e-6;
  if (w.leiern > 0) {
    // Gleichlauf: die Geschwindigkeit schwankt langsam (0,7 Hz), um bis zu ±0,5 %
    const kurve = Float32Array.from({ length: Math.ceil(dauer * 50) }, (_, i) => grund * (1 + w.leiern * 0.005 * Math.sin((2 * Math.PI * 0.7 * i) / 50)));
    quelle.playbackRate.setValueCurveAtTime(kurve, 0, dauer);
  } else quelle.playbackRate.value = grund;

  // Band: Lautsprecher und Mikrofon (Hochpass und Tiefpass)
  const unten = new BiquadFilterNode(ctx, { type: "highpass", frequency: w.unten, Q: 0.7 });
  const oben = new BiquadFilterNode(ctx, { type: "lowpass", frequency: w.oben, Q: 0.7 });
  quelle.connect(unten).connect(oben);

  const summe = new GainNode(ctx, { gain: 1 });
  oben.connect(summe); // der direkte Weg
  if (w.hall > 0 && w.nachhall > 0) {
    // Hall: Impulsantwort aus Rauschen, das in nachhall Sekunden um 60 dB leiser wird (e^(−6,9 · t / T60))
    // w.impuls: dieselbe Antwort für mehrere Runden (Lucier: es ist immer derselbe Raum)
    const n = Math.ceil(w.nachhall * rate);
    let ir = w.impuls;
    if (!ir || ir.length !== n) {
      ir = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: rate });
      const d = ir.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / n);
      if ("impuls" in w) w.impuls = ir;
    }
    const hall = new ConvolverNode(ctx, { buffer: ir, normalize: true });
    oben.connect(hall).connect(new GainNode(ctx, { gain: w.hall })).connect(summe);
  }
  if (w.echo > 0) {
    const verzoegerung = new DelayNode(ctx, { delayTime: w.echoZeit / 1000, maxDelayTime: 1 });
    oben.connect(verzoegerung).connect(new GainNode(ctx, { gain: w.echo })).connect(summe);
  }
  if (w.geraeusch && w.geraeuschLaut > 0) {
    const g = new AudioBufferSourceNode(ctx, { buffer: w.geraeusch, loop: true });
    const laut = new GainNode(ctx, { gain: w.geraeuschLaut });
    g.connect(laut).connect(summe);
    g.start();
  }
  summe.connect(ctx.destination);
  quelle.start();
  const aus = (await ctx.startRendering()).getChannelData(0);

  // Rauschen dazu, im Verhältnis zur Lautstärke des Signals (0,5 Amplitude → Effektivwert 0,35)
  if (w.rauschen > 0) {
    const s = 0.35 * w.rauschen;
    for (let i = 0; i < aus.length; i++) {
      // fast normalverteilt: Summe aus drei gleichverteilten Zahlen
      aus[i] += (Math.random() + Math.random() + Math.random() - 1.5) * 2 * s;
    }
  }
  return aus;
}
