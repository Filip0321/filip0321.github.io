// Game of Life klingt: ein Strich liest das Feld, jede lebende Zelle auf ihm ist eine Note. Längs des Strichs
// geht es von tief nach hoch (senkrecht: unten tief, waagerecht: links tief), auf eine Tonleiter gerastet,
// damit es Musik wird und nicht nur Cluster.
//
// Zwei Arten, den Strich zu führen:
//   läuft  der Strich wandert Spalte für Spalte (oder Zeile für Zeile) über das Feld wie ein Lesekopf, in
//          seinem Tempo. Das Feld ist ein Sequencer, der sich selbst schreibt: das Leben ändert die Noten,
//          während sie gespielt werden. Gleiter wandern als Melodien durch, Blinker sind Triller.
//   steht  der Strich bleibt an einer Stelle, und das Spiel macht den Takt: in jeder Generation (alle 100 ms)
//          wird er neu gelesen. „nur neue Zellen“: eine Note, wenn eine Zelle auf dem Strich lebendig wird
//          (wie ein Auto, das über eine Linie fährt, Video zu Ton „Auslösen“); „alle Zellen“: jede Generation
//          alles, was auf ihm lebt (ein Puls im Tempo des Spiels). Pause = Stille.
//
// Zeit: live plant ein Zeitplaner die Noten 120 ms im Voraus mit der Uhr des AudioContext (setTimeout allein
// wäre ungenau, die Noten würden stolpern). Beim Video wird dasselbe ohne Echtzeit gerechnet: das Feld wird auf
// einer Kopie weitergespielt, Generation für Generation (g · 100 ms, wie render.bild in gol.js), und jede Note
// in einen OfflineAudioContext gesetzt. Darum klingt das Video genau wie das, was man im Video sieht.
//
// Eine Note: Dreieck, Sinus, Rechteck oder Sägezahn mit kurzem Anschlag und Abklingen. Viele Zellen auf
// derselben Note machen sie lauter; mehr als „Stimmen“ verschiedene Noten auf einmal klingen nicht (die mit den
// meisten Zellen bleiben), sonst wird ein volles Feld nur Rauschen.

import { richteReglerEin } from "/lib/regler.js";

const INTERVALL = 0.1; // Sekunden pro Generation, wie in gol.js
// wie in Video zu Ton (js/frequenzen.js): Halbtöne über dem Grundton
const TONLEITERN = {
  aus: null, // stufenlos: jede Zelle ihre eigene Höhe, logarithmisch
  chromatisch: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  dur: [0, 2, 4, 5, 7, 9, 11],
  moll: [0, 2, 3, 5, 7, 8, 10],
  "pentatonik-dur": [0, 2, 4, 7, 9],
  "pentatonik-moll": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  ganzton: [0, 2, 4, 6, 8, 10],
};

// holeZustand: () => { gitter, SPALTEN, ZEILEN, regeln: [überlebt1, überlebt2, belebt] } wie gerade in gol.js
// neuZeichnen: () => das Feld neu zeichnen (der Strich bewegt sich auch, wenn das Spiel pausiert)
export function richteGolTonEin(holeZustand, neuZeichnen = () => {}) {
  const { einstellung: e } = richteReglerEin({ beiAenderung: () => neuZeichnen() });

  // ---------- der Strich ----------
  // Lage des Strichs: Spalte (senkrecht) oder Zeile (waagerecht); läuft er, aus der Zeit, sonst aus dem Regler
  const laenge = (z) => (e.tonRichtung === "waagerecht" ? z.ZEILEN : z.SPALTEN); // so viele Lagen gibt es
  const lageFest = (z) => Math.min(laenge(z) - 1, Math.round(e.tonLage * (laenge(z) - 1)));
  // die Zellen auf dem Strich, Index 0 = tief (senkrecht unten, waagerecht links)
  function zellen(z, lage) {
    const n = e.tonRichtung === "waagerecht" ? z.SPALTEN : z.ZEILEN;
    const aus = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      aus[i] = e.tonRichtung === "waagerecht" ? z.gitter[lage * z.SPALTEN + i] : z.gitter[(z.ZEILEN - 1 - i) * z.SPALTEN + lage];
    }
    return aus;
  }
  // Panorama: senkrecht, wo der Strich steht; waagerecht, wo die Zelle auf ihm liegt
  const panVon = (z, lage, i, n) => (e.tonRichtung === "waagerecht" ? i / Math.max(1, n - 1) : lage / Math.max(1, z.SPALTEN - 1)) * 1.6 - 0.8;

  // ---------- Noten ----------
  const grundHz = () => 440 * 2 ** ((12 * (e.tonOktave + 1) + Number(e.tonGrundton) - 69) / 12);
  // auf dem Strich lebendige Zellen (an: Uint8Array, 1 = spielt) -> [{ freq, staerke, pan }]
  function noten(z, lage, an) {
    const n = an.length;
    const leiter = TONLEITERN[e.tonLeiter];
    const stufen = leiter ? e.tonUmfang * leiter.length : 0;
    const gruppen = new Map(); // Stufe (oder Zelle bei stufenlos) -> { anzahl, summePan }
    for (let i = 0; i < n; i++) {
      if (!an[i]) continue;
      const hoehe = i / Math.max(1, n - 1); // 0 tief, 1 hoch
      const stufe = leiter ? Math.round(hoehe * (stufen - 1)) : i;
      const g = gruppen.get(stufe) ?? { anzahl: 0, pan: 0, hoehe };
      g.anzahl++;
      g.pan += panVon(z, lage, i, n);
      gruppen.set(stufe, g);
    }
    const gewaehlt = [...gruppen].sort((a, b) => b[1].anzahl - a[1].anzahl || a[0] - b[0]).slice(0, e.tonStimmen);
    return gewaehlt.map(([stufe, g]) => {
      const freq = leiter
        ? grundHz() * 2 ** (Math.floor(stufe / leiter.length) + leiter[stufe % leiter.length] / 12)
        : grundHz() * 2 ** (g.hoehe * e.tonUmfang); // stufenlos über den ganzen Umfang
      return { freq, staerke: Math.min(1, 0.5 + g.anzahl * 0.15) / Math.sqrt(gewaehlt.length), pan: g.pan / g.anzahl };
    });
  }

  function spiele(ctx, { freq, staerke, pan }, zeit) {
    const osc = new OscillatorNode(ctx, { type: e.tonKlang, frequency: freq });
    const huelle = new GainNode(ctx, { gain: 0 });
    const panner = new StereoPannerNode(ctx, { pan });
    const spitze = staerke * e.tonLaut * (e.tonKlang === "square" || e.tonKlang === "sawtooth" ? 0.4 : 1); // die sind lauter
    huelle.gain.setValueAtTime(0, zeit);
    huelle.gain.linearRampToValueAtTime(spitze, zeit + 0.005); // 5 ms Anschlag: ohne knackt es
    huelle.gain.setTargetAtTime(0, zeit + 0.005, e.tonAbklingen / 3); // nach „Abklingen“ Sekunden fast still
    osc.connect(huelle).connect(panner).connect(ctx.destination);
    osc.start(zeit);
    osc.stop(zeit + 0.005 + e.tonAbklingen * 2);
  }

  // steht: was in dieser Generation spielt (vorher: die Zellen auf dem Strich eine Generation davor)
  function stehendSpielt(jetzt, vorher) {
    if (e.tonSpielt === "alle") return jetzt;
    return jetzt.map((v, i) => (v && !vorher?.[i] ? 1 : 0)); // nur, was gerade lebendig wurde
  }

  // ---------- live ----------
  let ac = null;
  let laeuft = false;
  let start = 0; // AudioContext-Zeit von Schritt 0 (läuft)
  let k = 0; // der nächste Schritt, der geplant wird (zählt immer weiter, Lage = k mod Länge)
  let uhr = null;
  let tempoVorher = 0;
  let vorher = null; // steht: die Zellen beim letzten Lesen
  let vorherGitter = null; // steht: neu gelesen wird nur, wenn das Spiel einen Schritt gemacht hat
  let letzteLage = -1;

  function plane() {
    const z = holeZustand();
    if (e.tonArt === "steht") {
      // das Spiel ist der Takt: gelesen wird, sobald das Gitter ein anderes ist (schritt() tauscht die Arrays)
      const lage = lageFest(z);
      const jetzt = zellen(z, lage);
      if (z.gitter !== vorherGitter || !vorher || vorher.length !== jetzt.length) {
        const an = stehendSpielt(jetzt, vorher);
        if (vorherGitter) for (const note of noten(z, lage, an)) spiele(ac, note, ac.currentTime + 0.01);
        vorherGitter = z.gitter;
        vorher = jetzt;
      }
    } else {
      if (e.tonTempo !== tempoVorher) {
        start = ac.currentTime - k / e.tonTempo + 1 / e.tonTempo; // neues Tempo ab dem nächsten Schritt, ohne Sprung
        tempoVorher = e.tonTempo;
      }
      while (start + k / e.tonTempo < ac.currentTime + 0.12) {
        const lage = laufLage(z, k);
        const zeit = Math.max(ac.currentTime, start + k / e.tonTempo);
        for (const note of noten(z, lage, zellen(z, lage))) spiele(ac, note, zeit);
        k++;
      }
    }
    // der Strich hat sich bewegt: neu zeichnen (läuft das Spiel, zeichnet es ohnehin alle 100 ms)
    const lage = lageJetzt(z);
    if (lage !== letzteLage) {
      letzteLage = lage;
      neuZeichnen();
    }
  }
  // senkrecht von links nach rechts, waagerecht von oben nach unten
  const laufLage = (z, schritt) => {
    const n = laenge(z);
    const i = schritt % n;
    return e.tonRichtung === "waagerecht" ? n - 1 - i : i;
  };

  const knopf = hole("tonAn");
  knopf.addEventListener("click", async () => {
    laeuft = !laeuft;
    knopf.textContent = laeuft ? "Ton aus" : "Ton an";
    knopf.setAttribute("aria-pressed", String(laeuft));
    if (!laeuft) {
      clearInterval(uhr);
      neuZeichnen(); // der Strich verschwindet
      return;
    }
    ac ??= new AudioContext();
    await ac.resume();
    k = 0;
    vorher = null;
    vorherGitter = null;
    tempoVorher = e.tonTempo;
    start = ac.currentTime + 0.05;
    uhr = setInterval(plane, 25);
  });

  // ---------- Strich zeichnen (gol.js ruft das am Ende von zeichne) ----------
  let exportZeit = null; // beim Video: die Zeit des Bildes; sonst null (live)
  function lageJetzt(z) {
    if (e.tonArt === "steht") return laeuft || exportZeit !== null ? lageFest(z) : null;
    if (exportZeit !== null) return laufLage(z, Math.floor(exportZeit * e.tonTempo));
    if (!laeuft || !ac) return null;
    // was man gerade hört: der Strich hinkt um die Ausgabe-Latenz nach
    const t = ac.currentTime - (ac.outputLatency || 0) - start;
    return t < 0 ? null : laufLage(z, Math.floor(t * tempoVorher));
  }
  function zeichneKopf(ctx, zelle) {
    const z = holeZustand();
    const lage = lageJetzt(z);
    if (lage === null) return;
    ctx.save();
    ctx.globalAlpha = e.tonDeckkraft;
    ctx.fillStyle = e.tonFarbe;
    if (e.tonRichtung === "waagerecht") ctx.fillRect(0, lage * zelle, z.SPALTEN * zelle, zelle);
    else ctx.fillRect(lage * zelle, 0, zelle, z.ZEILEN * zelle);
    ctx.restore();
  }

  // ---------- Video ----------
  // ein Schritt des Lebens auf einer Kopie (dieselben Regeln wie schritt() in gol.js, Ränder laufen herum)
  function schrittAuf(alt, neu, S, Z, [a, b, c]) {
    for (let y = 0; y < Z; y++) {
      for (let x = 0; x < S; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx || dy) n += alt[((y + dy + Z) % Z) * S + ((x + dx + S) % S)];
          }
        }
        neu[y * S + x] = (alt[y * S + x] ? n === a || n === b : n === c) ? 1 : 0;
      }
    }
  }

  // der Ton für ein Video von sekunden Länge, ab dem Feld, wie es jetzt ist
  async function rendere(sekunden) {
    if (!laeuft) return null; // ohne „Ton an“ bleibt das Video stumm, wie bisher
    const rate = 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(sekunden * rate), rate);
    const jetzt = holeZustand();
    const z = { ...jetzt, gitter: jetzt.gitter.slice() };
    let neu = new Uint8Array(z.gitter.length);
    let generation = 0;
    const weiterBis = (zeit) => {
      while (generation < Math.floor(zeit / INTERVALL + 1e-9)) {
        schrittAuf(z.gitter, neu, z.SPALTEN, z.ZEILEN, z.regeln);
        [z.gitter, neu] = [neu, z.gitter];
        generation++;
      }
    };
    if (e.tonArt === "steht") {
      // eine Lesung pro Generation; die erste ist nur der Vergleich (wie live: erst ab dem ersten Schritt)
      const lage = lageFest(z);
      let alt = zellen(z, lage);
      for (let g = 1; g * INTERVALL < sekunden; g++) {
        weiterBis(g * INTERVALL);
        const an = zellen(z, lage);
        for (const note of noten(z, lage, stehendSpielt(an, alt))) spiele(ctx, note, g * INTERVALL);
        alt = an;
      }
    } else {
      for (let s = 0; s / e.tonTempo < sekunden; s++) {
        const zeit = s / e.tonTempo;
        weiterBis(zeit);
        const lage = laufLage(z, s);
        for (const note of noten(z, lage, zellen(z, lage))) spiele(ctx, note, zeit);
      }
    }
    return ctx.startRendering();
  }

  return {
    zeichneKopf,
    rendere,
    exportZeit: (t) => (exportZeit = t),
    exportEnde: () => (exportZeit = null),
  };
}
