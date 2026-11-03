// Klang der Höhle: ein leiser Drohnen-Ton, der sich mit dem Ort verändert. Kein Lied, eine Atmosphäre
// (wie die Soundscapes, die du magst). Alles Web Audio, keine Aufnahmen:
//
//   Drohne  zwei Sägezähne, eine kleine Sekunde auseinander (55 Hz und knapp 58 Hz): sie schweben
//           gegeneinander und reiben, das klingt unruhig. Dazu leise ein Tritonus darüber.
//   Filter  ein Tiefpass macht daraus ein Brummen. Nah an der Wand ist er enger (dumpf, bedrückend),
//           in offenen Räumen weiter. Ein sehr langsamer LFO lässt ihn „atmen“.
//   Wind    Rauschen durch einen Bandpass; lauter, wenn man geht.
//   Hall    zwei Verzögerungen, die sich gegenseitig zurückspeisen (eine Mini-Höhle). In großen Räumen
//           längere Zeiten, also ein größerer Raum.
//
// stelle({ abstand, geht }) wird etwa 20-mal pro Sekunde aufgerufen; jede Änderung gleitet weich
// (setTargetAtTime), sonst würde es knacken.

export function richteKlangEin() {
  let k = null; // der ganze Aufbau, erst beim Einschalten (Browser erlauben Ton erst nach einem Klick)

  function baue() {
    const ctx = new AudioContext();
    const gesamt = ctx.createGain();
    gesamt.gain.value = 0;
    gesamt.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;
    filter.Q.value = 4;

    const toene = [55, 55 * 1.0595, 55 * 1.414 * 2].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? "sawtooth" : "triangle";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i < 2 ? 0.25 : 0.06;
      o.connect(g).connect(filter);
      o.start();
      return o;
    });

    // LFO: 0,05 Hz (ein Atemzug in 20 Sekunden) bewegt die Filterfrequenz um ±120 Hz
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoTiefe = ctx.createGain();
    lfoTiefe.gain.value = 120;
    lfo.connect(lfoTiefe).connect(filter.frequency);
    lfo.start();

    // Wind: zwei Sekunden Rauschen in Schleife, durch einen Bandpass
    const rauschen = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = rauschen.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = rauschen;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.7;
    const windLaut = ctx.createGain();
    windLaut.gain.value = 0.02;
    wind.connect(windFilter).connect(windLaut);
    wind.start();

    // Hall: trocken + zwei Verzögerungen mit Rückkopplung über Kreuz
    const trocken = ctx.createGain();
    trocken.gain.value = 0.6;
    const v1 = ctx.createDelay(2);
    const v2 = ctx.createDelay(2);
    v1.delayTime.value = 0.31;
    v2.delayTime.value = 0.47;
    const rueck1 = ctx.createGain();
    const rueck2 = ctx.createGain();
    rueck1.gain.value = rueck2.gain.value = 0.45;
    const nass = ctx.createGain();
    nass.gain.value = 0.5;
    for (const quelle of [filter, windLaut]) {
      quelle.connect(trocken);
      quelle.connect(v1);
    }
    v1.connect(rueck1).connect(v2);
    v2.connect(rueck2).connect(v1);
    v1.connect(nass);
    v2.connect(nass);
    trocken.connect(gesamt);
    nass.connect(gesamt);

    return { ctx, gesamt, filter, windLaut, windFilter, v1, v2, rueck1, rueck2, toene };
  }

  return {
    an(ein) {
      if (ein && !k) k = baue();
      if (!k) return;
      if (ein) k.ctx.resume();
      k.gesamt.gain.setTargetAtTime(ein ? 0.35 : 0, k.ctx.currentTime, 0.8); // langsam ein- und ausblenden
    },
    // abstand: zur nächsten Oberfläche (0 bis ~1), geht: 0 bis 1
    stelle({ abstand, geht }) {
      if (!k) return;
      const t = k.ctx.currentTime;
      const offen = Math.min(1, abstand * 3); // 0 = an der Wand, 1 = im freien Raum
      k.filter.frequency.setTargetAtTime(180 + offen * 700, t, 0.5);
      k.filter.Q.setTargetAtTime(6 - offen * 4, t, 0.5);
      k.windLaut.gain.setTargetAtTime(0.015 + geht * 0.08 + offen * 0.02, t, 0.3);
      k.windFilter.frequency.setTargetAtTime(300 + geht * 600, t, 0.3);
      // größerer Raum: längere Echos, mehr Rückkopplung (unter 0,7, sonst schaukelt es sich auf)
      k.v1.delayTime.setTargetAtTime(0.2 + offen * 0.35, t, 1);
      k.v2.delayTime.setTargetAtTime(0.33 + offen * 0.5, t, 1);
      k.rueck1.gain.setTargetAtTime(0.35 + offen * 0.25, t, 1);
      k.rueck2.gain.setTargetAtTime(0.35 + offen * 0.25, t, 1);
      // ganz nah an der Wand sinkt die Drohne einen Hauch (Druck auf den Ohren)
      k.toene[0].frequency.setTargetAtTime(55 * (0.97 + offen * 0.03), t, 1);
    },
  };
}
