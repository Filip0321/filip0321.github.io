// Gemeinsame kleine Bausteine für die Module (module.js hat dieselben noch einmal für sich)

export const log = (min, max) => ({ min, max, log: true }); // Knopf logarithmisch (Frequenzen, Zeiten)
export const FORMEN = [["sine", "Sinus"], ["triangle", "Dreieck"], ["sawtooth", "Sägezahn"], ["square", "Rechteck"]];

export function verstaerker(ctx, wert = 1) {
  const g = ctx.createGain();
  g.gain.value = wert;
  return g;
}

export function konstante(ctx, wert = 0) {
  const k = ctx.createConstantSource();
  k.offset.value = wert;
  k.start();
  return k;
}

export function filter(ctx, typ, frequenz, q = 0.707) {
  const f = ctx.createBiquadFilter();
  f.type = typ;
  f.frequency.value = frequenz;
  f.Q.value = q;
  return f;
}

// zwei Sekunden weißes Rauschen in Schleife
export function rauschQuelle(ctx) {
  const puffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = puffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const q = ctx.createBufferSource();
  q.buffer = puffer;
  q.loop = true;
  q.start();
  return q;
}

// Den jetzigen Wert eines Ton-Eingangs lesen (für Takt-Module: Grundton des Arpeggiators, Sample & Hold).
// Ein AnalyserNode hält die zuletzt gespielten Samples; das letzte davon ist der Wert „jetzt“.
export function leser(ctx) {
  const a = ctx.createAnalyser();
  a.fftSize = 32;
  const d = new Float32Array(32);
  return { knoten: a, wert: () => (a.getFloatTimeDomainData(d), d[31]) };
}

// Tonleitern in Halbtönen über dem Grundton
export const LEITERN = {
  dur: [0, 2, 4, 5, 7, 9, 11],
  moll: [0, 2, 3, 5, 7, 8, 10],
  dorisch: [0, 2, 3, 5, 7, 9, 10],
  phrygisch: [0, 1, 3, 5, 7, 8, 10],
  "pentatonik-moll": [0, 3, 5, 7, 10],
  "pentatonik-dur": [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  "harmonisch-moll": [0, 2, 3, 5, 7, 8, 11],
  bhairav: [0, 1, 4, 5, 7, 8, 11], // indischer Raga (Morgen), wie Doppel-Harmonisch
  chromatisch: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const LEITER_WAHL = [["moll", "Moll"], ["dur", "Dur"], ["dorisch", "Dorisch"], ["phrygisch", "Phrygisch"],
  ["pentatonik-moll", "Pentatonik Moll"], ["pentatonik-dur", "Pentatonik Dur"], ["blues", "Blues"],
  ["harmonisch-moll", "Harmonisch Moll"], ["bhairav", "Raga Bhairav"], ["chromatisch", "chromatisch"]];
export const GRUNDTOENE = ["C", "Cis", "D", "Es", "E", "F", "Fis", "G", "As", "A", "B", "H"].map((n, i) => [String(i), n]);
