// Lenia klingt: ein Strich wandert über die Welt wie der Lesekopf im Game of Life (/projekte/game-of-life/gol-ton.js),
// nur dass hier keine Zelle einfach an oder aus ist. Jede Zelle hat einen Wert A zwischen 0 und 1:
//   über der Schwelle  spielt sie,
//   ihr Wert           macht die Note laut oder leise (Anschlagstärke, wie fest man eine Taste drückt).
// Längs des Strichs geht es von tief nach hoch (senkrecht: unten tief, waagerecht: links tief), auf eine Tonleiter
// gerastet. Zellen auf derselben Stufe werden eine Note (sonst wäre ein Wesen ein Cluster aus 30 Tönen); ihre
// Stärke ist das Mittel ihrer Werte, und es klingen höchstens „Stimmen“ Noten zugleich (die stärksten).
//
// Bei 1024 Zellen Breite und 8 Schritten pro Sekunde bräuchte ein Durchgang über alle Spalten 2 Minuten. Darum
// liest der Strich nur „Spalten pro Durchgang“ gleichmäßig verteilte Stellen (16 wie ein Sequenzer, bis 128).
// Gelesen wird nur die eine Spalte (lenia.spalte, 1 × N Zellen von der Grafikkarte), nicht die ganze Welt.
//
// Zeit: wie im Game of Life plant ein Zeitplaner die Noten 120 ms im Voraus mit der Uhr des AudioContext.
// Ins Video kommt der Ton über „Live aufnehmen“ (liveTon); „Video rendern“ bleibt stumm, weil die Welt dafür
// ein zweites Mal ohne Bildschirm laufen müsste.

const TONLEITERN = {
  chromatisch: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  dur: [0, 2, 4, 5, 7, 9, 11],
  moll: [0, 2, 3, 5, 7, 8, 10],
  "pentatonik-dur": [0, 2, 4, 7, 9],
  "pentatonik-moll": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  ganzton: [0, 2, 4, 6, 8, 10],
};

// lenia: aus lenia.js; e: die Einstellungen der Seite (regler.js), Namen ton…; knopf: „Ton an“
export function richteLeniaTonEin(lenia, e, knopf) {
  let ac = null, ausgang = null, strom = null, laeuft = false, uhr = null;
  let start = 0, k = 0, tempoVorher = 0;

  const waagerecht = () => e.tonRichtung === "waagerecht";
  // Lage des Strichs bei Schritt k: Stelle i von „tonSpalten“, als Zelle und als Anteil (0 … 1) für das Bild
  function lage(schritt) {
    const n = lenia.n, s = Number(e.tonSpalten), i = schritt % s;
    const anteil = (i + 0.5) / s;
    // waagerecht von oben nach unten: Zeile 0 der Textur ist unten
    return { zelle: Math.floor((waagerecht() ? 1 - anteil : anteil) * n), anteil: waagerecht() ? 1 - anteil : anteil };
  }

  const grundHz = () => 440 * 2 ** ((12 * (e.tonOktave + 1) + Number(e.tonGrundton) - 69) / 12);

  // Werte auf dem Strich → Noten [{ freq, staerke, pan }]
  function noten(werte, anteil) {
    const n = werte.length, leiter = TONLEITERN[e.tonLeiter];
    const stufen = e.tonUmfang * leiter.length;
    const gruppen = new Map(); // Stufe → { summe, anzahl, pan }
    for (let i = 0; i < n; i++) {
      const a = werte[i];
      if (a < e.tonSchwelle) continue;
      const stufe = Math.round((i / Math.max(1, n - 1)) * (stufen - 1));
      const g = gruppen.get(stufe) ?? { summe: 0, anzahl: 0, pan: 0 };
      g.summe += a;
      g.anzahl++;
      g.pan += waagerecht() ? (i / (n - 1)) * 1.6 - 0.8 : anteil * 1.6 - 0.8;
      gruppen.set(stufe, g);
    }
    const gewaehlt = [...gruppen].sort((x, y) => y[1].summe - x[1].summe).slice(0, e.tonStimmen);
    return gewaehlt.map(([stufe, g]) => ({
      freq: grundHz() * 2 ** (Math.floor(stufe / leiter.length) + leiter[stufe % leiter.length] / 12),
      staerke: (g.summe / g.anzahl) / Math.sqrt(gewaehlt.length), // mittlerer Wert der Zellen = Anschlag
      pan: g.pan / g.anzahl,
    }));
  }

  function spiele({ freq, staerke, pan }, zeit) {
    const osc = new OscillatorNode(ac, { type: e.tonKlang, frequency: freq });
    const huelle = new GainNode(ac, { gain: 0 });
    const panner = new StereoPannerNode(ac, { pan });
    const spitze = staerke * e.tonLaut * (e.tonKlang === "square" || e.tonKlang === "sawtooth" ? 0.4 : 1);
    huelle.gain.setValueAtTime(0, zeit);
    huelle.gain.linearRampToValueAtTime(spitze, zeit + 0.005); // 5 ms Anschlag: ohne knackt es
    huelle.gain.setTargetAtTime(0, zeit + 0.005, e.tonAbklingen / 3);
    osc.connect(huelle).connect(panner).connect(ausgang);
    osc.start(zeit);
    osc.stop(zeit + 0.005 + e.tonAbklingen * 2);
  }

  function plane() {
    if (e.tonTempo !== tempoVorher) {
      start = ac.currentTime - k / e.tonTempo + 1 / e.tonTempo; // neues Tempo ab dem nächsten Schritt
      tempoVorher = e.tonTempo;
    }
    while (start + k / e.tonTempo < ac.currentTime + 0.12) {
      const { zelle, anteil } = lage(k);
      const zeit = Math.max(ac.currentTime, start + k / e.tonTempo);
      for (const note of noten(lenia.spalte(zelle, waagerecht()), anteil)) spiele(note, zeit);
      k++;
    }
  }

  knopf.addEventListener("click", async () => {
    laeuft = !laeuft;
    knopf.textContent = laeuft ? "Ton aus" : "Ton an";
    knopf.setAttribute("aria-pressed", String(laeuft));
    if (!laeuft) {
      clearInterval(uhr);
      return;
    }
    if (!ac) {
      ac = new AudioContext();
      ausgang = new GainNode(ac);
      ausgang.connect(ac.destination);
      strom = ac.createMediaStreamDestination(); // für „Live aufnehmen“
      ausgang.connect(strom);
    }
    await ac.resume();
    k = 0;
    tempoVorher = e.tonTempo;
    start = ac.currentTime + 0.05;
    uhr = setInterval(plane, 25);
  });

  return {
    // der Strich fürs Bild: was man gerade hört (um die Ausgabe-Latenz verzögert), oder null
    kopf() {
      if (!laeuft || !ac) return null;
      const t = ac.currentTime - (ac.outputLatency || 0) - start;
      if (t < 0) return null;
      return { lage: lage(Math.floor(t * tempoVorher)).anteil, zeile: waagerecht() };
    },
    liveTon: () => (laeuft && strom ? { spur: strom.stream.getAudioTracks()[0], kanaele: 2, rate: ac.sampleRate } : null),
  };
}
