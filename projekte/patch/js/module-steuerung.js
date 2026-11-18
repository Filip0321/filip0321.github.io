// Neue Steuer-Module (Runde 17): MIDI-Eingang, Notenraster, Arpeggiator, Turing-Maschine, Quantisierer,
// Sample & Hold, Glide, Taktwerk, Makros.

import { Takt, Noten } from "./takt.js";
import { log, konstante, filter, leser, LEITERN, LEITER_WAHL, GRUNDTOENE } from "./bausteine.js";

const TEILUNG = [["4", "Viertel"], ["8", "Achtel"], ["16", "Sechzehntel"]];

// ---------- MIDI-Eingang ----------
// Web MIDI (Chrome, Edge; nicht Safari): ein Keyboard wie dein AKAI MPK mini schickt pro Taste drei Bytes:
//   Status (0x90 Note an, 0x80 Note aus, 0xB0 Regler, 0xE0 Pitchbend; die unteren 4 Bit = Kanal 1 bis 16),
//   Notennummer (60 = C4) und Anschlagstärke (0 bis 127; „Note an“ mit 0 heißt auch aus).
// Daraus: Tonhöhe (1,0 pro Oktave, 0 = C4), Gate (1, solange eine Taste gedrückt ist), Anschlag (0 … 1) und ein Takt
// beim Anschlag, der bis zum Loslassen gehalten wird (Hüllkurven bleiben im Sustain). Mehrere Tasten: die zuletzt
// gedrückte klingt (einstimmig wie ein Minimoog); lässt man sie los, springt der Ton zur vorigen, ohne neuen Anschlag.
// Die Pads des MPK mini senden auf Kanal 10 (wie Drum-Computer): sie werden zum Takt „Pad“ statt zu Tönen.
// K1–K4: die Drehregler (beim MPK mini ab Regler-Nummer 70, einstellbar), je 0 … 1.
const midi = {
  titel: "MIDI-Eingang",
  gruppe: "Steuerung",
  baue(ctx, { melde }) {
    const ton = konstante(ctx, 0), gate = konstante(ctx, 0), anschlag = konstante(ctx, 0);
    const regler = [0, 1, 2, 3].map(() => konstante(ctx, 0));
    const takt = new Takt(), pad = new Takt();
    const noten = new Noten(); // Runde 21: alle Tasten zugleich, für Akkorde (Stimmen)
    const w = { kanal: "alle", cc: 70, oktave: 0, biegung: 2 };
    let gehalten = [], biegen = 0, anzeige = null, zugang = null;
    const stimme = (note) => (note - 60 + w.oktave * 12 + biegen * w.biegung) / 12;
    const setzeTon = (t) => gehalten.length && ton.offset.setValueAtTime(stimme(gehalten.at(-1)), t);

    function nachricht(ev) {
      const [status, a = 0, b = 0] = ev.data;
      const art = status & 0xf0, kanal = (status & 0x0f) + 1;
      const t = ctx.currentTime + 0.005;
      if (art === 0x90 && b > 0 && kanal === 10) return pad.sende(t, 0.1);
      if (w.kanal !== "alle" && Number(w.kanal) !== kanal) return;
      if (art === 0x90 && b > 0) {
        gehalten = gehalten.filter((n) => n !== a).concat(a);
        noten.an(t, a + w.oktave * 12, b / 127, Infinity);
        setzeTon(t);
        anschlag.offset.setValueAtTime(b / 127, t);
        gate.offset.setValueAtTime(1, t);
        takt.sende(t, Infinity);
        if (anzeige) anzeige.textContent = `Note ${a} · Anschlag ${b}`;
      } else if (art === 0x80 || (art === 0x90 && b === 0)) {
        if (kanal === 10) return;
        noten.aus(t, a + w.oktave * 12);
        gehalten = gehalten.filter((n) => n !== a);
        if (gehalten.length) setzeTon(t);
        else {
          gate.offset.setValueAtTime(0, t);
          takt.loslassen(t);
        }
      } else if (art === 0xb0) {
        const i = a - w.cc;
        if (i >= 0 && i < 4) regler[i].offset.setTargetAtTime(b / 127, t, 0.01);
      } else if (art === 0xe0) {
        biegen = ((b << 7) | a) / 8192 - 1; // 14 Bit, Mitte 8192 → −1 … 1
        setzeTon(t);
      }
    }

    let geraete = [];
    function anschliessen() {
      if (!zugang) return;
      geraete = [...zugang.inputs.values()];
      for (const e of geraete) e.onmidimessage = nachricht;
      if (anzeige) anzeige.textContent = geraete.length ? geraete.map((e) => e.name).join(", ") : "kein MIDI-Gerät gefunden";
    }
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then((z) => {
        zugang = z;
        z.onstatechange = anschliessen;
        anschliessen();
      }).catch(() => melde("MIDI ist nicht erlaubt worden (in der Adresszeile freigeben)."));
    } else setTimeout(() => melde("Dieser Browser kann kein MIDI (Chrome oder Edge können es)."));

    return {
      ein: {},
      aus: {
        "Tonhöhe": { art: "ton", knoten: ton }, Gate: { art: "ton", knoten: gate }, Anschlag: { art: "ton", knoten: anschlag },
        Takt: { art: "takt", knoten: takt }, Pad: { art: "takt", knoten: pad }, Noten: { art: "noten", knoten: noten },
        K1: { art: "ton", knoten: regler[0] }, K2: { art: "ton", knoten: regler[1] }, K3: { art: "ton", knoten: regler[2] }, K4: { art: "ton", knoten: regler[3] },
      },
      regler: [
        { name: "oktave", text: "Oktave", min: -3, max: 3, wert: 0, schritt: 1, setze: (v) => { w.oktave = v; setzeTon(ctx.currentTime); } },
        { name: "cc", text: "Regler ab", min: 0, max: 124, wert: 70, schritt: 1, setze: (v) => (w.cc = v) },
        { name: "biegung", text: "Biegung", min: 0, max: 12, wert: 2, schritt: 1, einheit: "HT", setze: (v) => (w.biegung = v) },
      ],
      wahl: [{ name: "kanal", text: "Kanal", wert: "alle", optionen: [["alle", "alle"], ...Array.from({ length: 16 }, (_, i) => [String(i + 1), String(i + 1)])], setze: (v) => (w.kanal = v) }],
      extra: (el) => {
        anzeige = document.createElement("p");
        anzeige.className = "hinweis";
        anzeige.textContent = "suche MIDI-Geräte …";
        el.append(anzeige);
        anschliessen();
      },
      weg: () => {
        for (const e of geraete) e.onmidimessage = null;
        [ton, gate, anschlag, ...regler].forEach((k) => k.stop());
      },
    };
  },
};

// ---------- Notenraster ----------
// Ein Sequenzer wie die Piano-Roll in Ableton: Zeilen sind die Töne einer Tonleiter (unten tief), Spalten die
// Schritte. Ein Klick setzt oder löscht eine Note. Einstimmig: stehen in einem Schritt mehrere, klingt die höchste.
// „Bindung“ (der Haken unter einer Spalte): diese Note schließt ohne neuen Anschlag an die vorige an. So spielt man
// Acid-Läufe: zusammen mit Glide gleitet der Ton, und die Hüllkurve bleibt offen.
const notenraster = {
  titel: "Notenraster",
  gruppe: "Steuerung",
  baue(ctx, { uhr }) {
    const ton = konstante(ctx, 0);
    const takt = new Takt(), akzent = konstante(ctx, 0);
    const w = { tempo: 120, teilung: 16, gate: 0.5, leiter: "moll", grund: 9, oktave: -1, zeilen: 12, schritte: 16 };
    const MAX = 32;
    // pro Schritt: Zeile oder −1 (Pause), Bindung, Akzent
    let raster = Array.from({ length: MAX }, () => ({ zeile: -1, bindung: false, akzent: false }));
    let zeige = () => {}, baueRaster = () => {};
    const halbton = (zeile) => {
      const l = LEITERN[w.leiter];
      return w.grund + 12 * (w.oktave + Math.floor(zeile / l.length)) + l[zeile % l.length];
    };
    const abo = uhr.abonniere(() => w.tempo * (w.teilung / 4), (t, nr) => {
      const i = nr % w.schritte, s = raster[i];
      zeige(i, t);
      if (s.zeile < 0) return;
      ton.offset.setValueAtTime(halbton(s.zeile) / 12, t);
      akzent.offset.setValueAtTime(s.akzent ? 1 : 0, t);
      // gebunden: die nächste Note kommt ohne neuen Anschlag; dafür hält diese bis zum nächsten Schritt
      const naechste = raster[(i + 1) % w.schritte];
      const lang = naechste.bindung && naechste.zeile >= 0;
      if (!s.bindung) takt.sende(t, (60 / (w.tempo * (w.teilung / 4))) * (lang ? 1.02 : w.gate));
    });
    return {
      ein: {},
      aus: { "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt }, Akzent: { art: "ton", knoten: akzent } },
      regler: [
        { name: "tempo", text: "Tempo", min: 40, max: 220, wert: 120, schritt: 1, einheit: "BPM", setze: (v) => (w.tempo = v) },
        { name: "gate", text: "Länge", min: 0.05, max: 1, wert: 0.5, setze: (v) => (w.gate = v) },
        { name: "oktave", text: "Oktave", min: -3, max: 2, wert: -1, schritt: 1, setze: (v) => (w.oktave = v) },
      ],
      wahl: [
        { name: "teilung", text: "Noten", optionen: TEILUNG, wert: "16", setze: (v) => (w.teilung = Number(v)) },
        { name: "leiter", text: "Tonleiter", optionen: LEITER_WAHL, wert: "moll", setze: (v) => { w.leiter = v; baueRaster(); } },
        { name: "grund", text: "Grundton", optionen: GRUNDTOENE, wert: "9", setze: (v) => { w.grund = Number(v); baueRaster(); } },
        { name: "schritte", text: "Schritte", optionen: [["8", "8"], ["16", "16"], ["32", "32"]], wert: "16", setze: (v) => { w.schritte = Number(v); baueRaster(); } },
        { name: "zeilen", text: "Zeilen", optionen: [["8", "8"], ["12", "12"], ["16", "16"], ["24", "24"]], wert: "12", setze: (v) => { w.zeilen = Number(v); baueRaster(); } },
      ],
      extra: (el) => {
        const tabelle = document.createElement("div");
        tabelle.className = "notenraster";
        el.append(tabelle);
        const namen = ["C", "Cis", "D", "Es", "E", "F", "Fis", "G", "As", "A", "B", "H"];
        let zellen = [];
        baueRaster = () => {
          tabelle.replaceChildren();
          tabelle.style.setProperty("--spalten", w.schritte);
          zellen = [];
          for (let z = w.zeilen - 1; z >= 0; z--) {
            const name = document.createElement("span");
            name.className = "raster-name";
            name.textContent = namen[((halbton(z) % 12) + 12) % 12];
            tabelle.append(name);
            for (let i = 0; i < w.schritte; i++) {
              const b = document.createElement("button");
              b.type = "button";
              b.className = "raster-zelle";
              if (i % 4 === 0) b.classList.add("viertel");
              b.setAttribute("aria-label", `Schritt ${i + 1}, ${name.textContent}`);
              b.setAttribute("aria-pressed", String(raster[i].zeile === z));
              b.addEventListener("click", () => {
                raster[i].zeile = raster[i].zeile === z ? -1 : z;
                zellen.forEach((zz) => zz.i === i && zz.b.setAttribute("aria-pressed", String(raster[i].zeile === zz.z)));
              });
              tabelle.append(b);
              zellen.push({ b, i, z });
            }
          }
          // unten: Bindung und Akzent je Spalte
          for (const [art, text] of [["bindung", "⌒"], ["akzent", ">"]]) {
            const name = document.createElement("span");
            name.className = "raster-name";
            name.textContent = text;
            name.title = art === "bindung" ? "Bindung: ohne neuen Anschlag an die vorige Note" : "Akzent: Ausgang „Akzent“ ist 1";
            tabelle.append(name);
            for (let i = 0; i < w.schritte; i++) {
              const b = document.createElement("button");
              b.type = "button";
              b.className = `raster-zelle ${art}`;
              b.setAttribute("aria-label", `Schritt ${i + 1}: ${art}`);
              b.setAttribute("aria-pressed", String(raster[i][art]));
              b.addEventListener("click", () => b.setAttribute("aria-pressed", String((raster[i][art] = !raster[i][art]))));
              tabelle.append(b);
              zellen.push({ b, i, z: art });
            }
          }
        };
        baueRaster();
        zeige = (i, t) => setTimeout(() => zellen.forEach((zz) => zz.b.classList.toggle("jetzt", zz.i === i)), Math.max(0, (t - ctx.currentTime) * 1000));
        el.schritteLesen = () => raster.map((s) => [s.zeile, s.bindung, s.akzent]);
        el.schritteSetzen = (liste) => {
          liste?.forEach(([zeile, bindung, akzent], i) => i < MAX && (raster[i] = { zeile, bindung: !!bindung, akzent: !!akzent }));
          baueRaster();
        };
      },
      weg: () => { abo(); ton.stop(); akzent.stop(); },
    };
  },
};

// ---------- Arpeggiator ----------
// Spielt einen Akkord als Folge einzelner Töne, ein Ton pro Takt am Eingang. Grundton aus dem Kabel (z. B. vom
// MIDI-Eingang: eine Taste halten, und der Akkord darauf läuft) plus dem Regler „Grundton“.
// Mit „nur bei Gate“ läuft er nur, solange am Gate-Eingang mehr als 0,5 anliegt (Taste gedrückt).
const AKKORDE = {
  dur: [0, 4, 7], moll: [0, 3, 7], sus4: [0, 5, 7], vermindert: [0, 3, 6],
  dur7: [0, 4, 7, 10], moll7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], moll9: [0, 3, 7, 10, 14], quinte: [0, 7],
};
const arpeggiator = {
  titel: "Arpeggiator",
  gruppe: "Steuerung",
  baue(ctx) {
    const ton = konstante(ctx, 0);
    const takt = new Takt();
    const grund = leser(ctx), gateLeser = leser(ctx);
    const w = { akkord: "moll7", muster: "auf", oktaven: 2, halbton: 0, laenge: 0.5, nurGate: "immer" };
    let i = 0;
    const folge = () => {
      const a = AKKORDE[w.akkord], liste = [];
      for (let o = 0; o < w.oktaven; o++) for (const n of a) liste.push(n + 12 * o);
      return liste;
    };
    const schritt = (t, dauer = 0.15) => {
      if (w.nurGate === "gate" && gateLeser.wert() < 0.5) {
        i = 0; // Taste los: beim nächsten Anschlag wieder vorn anfangen
        return;
      }
      const l = folge(), n = l.length;
      let k;
      if (w.muster === "auf") k = i % n;
      else if (w.muster === "ab") k = n - 1 - (i % n);
      else if (w.muster === "zufall") k = Math.floor(Math.random() * n);
      else {
        // auf und ab ohne die Enden doppelt: 0 1 2 3 2 1 0 1 …
        const p = 2 * (n - 1) || 1, j = i % p;
        k = j < n ? j : p - j;
      }
      i++;
      ton.offset.setValueAtTime(grund.wert() + (w.halbton + l[k]) / 12, t);
      // Länge 0,5 = so lang wie der eingehende Takt (der hält meist halb so lang wie sein Abstand)
      takt.sende(t, (Number.isFinite(dauer) ? dauer : 0.15) * w.laenge * 2);
    };
    return {
      ein: {
        Takt: { art: "takt", ziel: schritt },
        "Grundton": { art: "ton", ziel: grund.knoten },
        Gate: { art: "ton", ziel: gateLeser.knoten },
      },
      aus: { "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt } },
      regler: [
        { name: "oktaven", text: "Oktaven", min: 1, max: 4, wert: 2, schritt: 1, setze: (v) => (w.oktaven = v) },
        { name: "halbton", text: "Grundton", min: -24, max: 24, wert: 0, schritt: 1, einheit: "HT", setze: (v) => (w.halbton = v) },
        { name: "laenge", text: "Länge", min: 0.05, max: 1, wert: 0.5, setze: (v) => (w.laenge = v) },
      ],
      wahl: [
        { name: "akkord", text: "Akkord", wert: "moll7", optionen: [["dur", "Dur"], ["moll", "Moll"], ["sus4", "sus4"], ["vermindert", "vermindert"], ["dur7", "Dur 7"], ["moll7", "Moll 7"], ["maj7", "maj7"], ["moll9", "Moll 9"], ["quinte", "Quinte"]], setze: (v) => (w.akkord = v) },
        { name: "muster", text: "Muster", wert: "auf", optionen: [["auf", "auf"], ["ab", "ab"], ["aufab", "auf und ab"], ["zufall", "zufällig"]], setze: (v) => { w.muster = v; i = 0; } },
        { name: "nurGate", text: "Läuft", wert: "immer", optionen: [["immer", "immer"], ["gate", "nur bei Gate"]], setze: (v) => (w.nurGate = v) },
      ],
      weg: () => ton.stop(),
    };
  },
};

// ---------- Turing-Maschine ----------
// Nach Tom Whitwell (Music Thing Modular, 2012): ein Schieberegister aus 16 Bits, das bei jedem Takt um eins
// weiterrückt. Das Bit, das hinten herausfällt, kommt vorn wieder hinein, mit der Wahrscheinlichkeit „Wandel“
// umgedreht. Wandel 0: eine feste Schleife von „Länge“ Schritten, die sich endlos wiederholt. Wandel klein: die
// Schleife verändert sich langsam, wie ein Musiker, der variiert. Wandel 0,5: reiner Zufall.
// Die unteren 8 Bits als Zahl (0 … 255) sind die Spannung: durch den Quantisierer wird daraus eine Melodie.
const turing = {
  titel: "Turing-Maschine",
  gruppe: "Steuerung",
  baue(ctx) {
    const ton = konstante(ctx, 0), zufall = konstante(ctx, 0);
    const takt = new Takt();
    const w = { wandel: 0.1, laenge: 8, umfang: 2 };
    let register = Math.floor(Math.random() * 65536), anzeige = null;
    const schritt = (t, dauer) => {
      const n = w.laenge;
      let bit = (register >> (n - 1)) & 1;
      if (Math.random() < w.wandel) bit ^= 1;
      register = ((register << 1) | bit) & ((1 << n) - 1);
      const wert = (register & 255) / 255;
      ton.offset.setValueAtTime(wert * w.umfang, t);
      zufall.offset.setValueAtTime(Math.random(), t);
      if (register & 1) takt.sende(t, dauer);
      if (anzeige) setTimeout(() => (anzeige.textContent = register.toString(2).padStart(n, "0").replace(/0/g, "□").replace(/1/g, "■")), Math.max(0, (t - ctx.currentTime) * 1000));
    };
    return {
      ein: { Takt: { art: "takt", ziel: schritt } },
      aus: { "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt }, Zufall: { art: "ton", knoten: zufall } },
      regler: [
        { name: "wandel", text: "Wandel", min: 0, max: 0.5, wert: 0.1, setze: (v) => (w.wandel = v) },
        { name: "laenge", text: "Länge", min: 2, max: 16, wert: 8, schritt: 1, setze: (v) => (w.laenge = v) },
        { name: "umfang", text: "Umfang", min: 0.25, max: 4, wert: 2, einheit: "Okt.", setze: (v) => (w.umfang = v) },
      ],
      extra: (el) => {
        anzeige = document.createElement("p");
        anzeige.className = "muster";
        el.append(anzeige);
      },
      weg: () => { ton.stop(); zufall.stop(); },
    };
  },
};

// ---------- Quantisierer ----------
// rastet eine Tonhöhe (1,0 pro Oktave) auf die nächste Stufe einer Tonleiter: Zufall wird Melodie (worklets.js)
const quantisierer = {
  titel: "Quantisierer",
  gruppe: "Steuerung",
  baue(ctx) {
    const knoten = new AudioWorkletNode(ctx, "quantisierer", { numberOfInputs: 1, outputChannelCount: [1] });
    const w = { leiter: "moll", grund: 9 };
    const sende = () => knoten.port.postMessage({ leiter: LEITERN[w.leiter], grund: w.grund });
    return {
      ein: { ein: { art: "ton", ziel: knoten } },
      aus: { aus: { art: "ton", knoten } },
      wahl: [
        { name: "leiter", text: "Tonleiter", optionen: LEITER_WAHL, wert: "moll", setze: (v) => { w.leiter = v; sende(); } },
        { name: "grund", text: "Grundton", optionen: GRUNDTOENE, wert: "9", setze: (v) => { w.grund = Number(v); sende(); } },
      ],
      weg: () => knoten.disconnect(),
    };
  },
};

// ---------- Sample & Hold ----------
// Bei jedem Takt den jetzigen Wert des Eingangs festhalten, bis zum nächsten Takt. Ohne Kabel (Quelle „Zufall“):
// jedes Mal eine neue Zufallszahl. Die klassische „Computer-Melodie“ aus Science-Fiction-Filmen.
const sampleHold = {
  titel: "Sample & Hold",
  gruppe: "Steuerung",
  baue(ctx) {
    const aus = konstante(ctx, 0);
    const ein = leser(ctx);
    const w = { quelle: "zufall", umfang: 1 };
    return {
      ein: { ein: { art: "ton", ziel: ein.knoten }, Auslöser: { art: "takt", ziel: (t) => aus.offset.setValueAtTime(w.quelle === "zufall" ? (Math.random() * 2 - 1) * w.umfang : ein.wert(), t) } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [{ name: "umfang", text: "Umfang", min: 0, max: 2, wert: 1, setze: (v) => (w.umfang = v) }],
      wahl: [{ name: "quelle", text: "Quelle", optionen: [["zufall", "Zufall"], ["eingang", "Eingang"]], wert: "zufall", setze: (v) => (w.quelle = v) }],
      weg: () => aus.stop(),
    };
  },
};

// ---------- Glide ----------
// Gleiten zwischen Tönen (Portamento, die TB-303-Läufe): ein Tiefpass auf der Steuerspannung. Ein Biquad lässt
// Gleichspannung durch (Frequenz 0), schneidet aber Sprünge weich: Grenzfrequenz f = 1 / (2π · Zeit).
const glide = {
  titel: "Glide",
  gruppe: "Steuerung",
  baue(ctx) {
    const f = filter(ctx, "lowpass", 10, 0.5); // Güte 0,5: ohne Überschwingen
    return {
      ein: { ein: { art: "ton", ziel: f } },
      aus: { aus: { art: "ton", knoten: f } },
      regler: [{ name: "zeit", text: "Zeit", ...log(0.005, 2), wert: 0.06, einheit: "s", setze: (v) => f.frequency.setValueAtTime(1 / (2 * Math.PI * v), ctx.currentTime) }],
    };
  },
};

// ---------- Taktwerk ----------
// Takt umformen: nur jeden n-ten durchlassen (Teiler), jeden mit Wahrscheinlichkeit p (lebendige Hi-Hats), und
// Swing: jeder zweite Schlag kommt später, um einen Anteil des Abstands zum vorigen (0,5 = halb, das „Triolen-
// Gefühl“ von Hip-Hop und House; die MPC hat das berühmt gemacht).
const taktwerk = {
  titel: "Taktwerk",
  gruppe: "Steuerung",
  baue() {
    const takt = new Takt();
    const w = { teiler: 1, chance: 1, swing: 0 };
    let n = 0, letzte = null, abstand = 0.125;
    const ein = (t, dauer) => {
      if (letzte !== null) abstand = Math.min(2, Math.max(0.01, t - letzte));
      letzte = t;
      const k = n++;
      if (k % w.teiler !== 0) return;
      if (Math.random() > w.chance) return;
      const spaet = (k / w.teiler) % 2 === 1 ? w.swing * abstand * w.teiler * 0.5 : 0;
      takt.sende(t + spaet, dauer);
    };
    return {
      ein: { Takt: { art: "takt", ziel: ein } },
      aus: { Takt: { art: "takt", knoten: takt } },
      regler: [
        { name: "teiler", text: "Teiler", min: 1, max: 16, wert: 1, schritt: 1, setze: (v) => (w.teiler = v) },
        { name: "chance", text: "Chance", min: 0, max: 1, wert: 1, setze: (v) => (w.chance = v) },
        { name: "swing", text: "Swing", min: 0, max: 0.75, wert: 0, setze: (v) => (w.swing = v) },
      ],
    };
  },
};

// ---------- Makros ----------
// Vier Knöpfe als Steuerspannung (0 … 1 mal Bereich): von hier aus mehrere Dinge auf einmal bewegen.
const makros = {
  titel: "Makros",
  gruppe: "Steuerung",
  baue(ctx) {
    const k = [0, 1, 2, 3].map(() => konstante(ctx, 0));
    return {
      ein: {},
      aus: Object.fromEntries(k.map((x, i) => [`M${i + 1}`, { art: "ton", knoten: x }])),
      regler: k.map((x, i) => ({ name: `m${i + 1}`, text: `M${i + 1}`, min: -1, max: 1, wert: 0, setze: (v) => x.offset.setTargetAtTime(v, ctx.currentTime, 0.01) })),
      weg: () => k.forEach((x) => x.stop()),
    };
  },
};

export const STEUERUNG = { midi, notenraster, arpeggiator, turing, quantisierer, sampleHold, glide, taktwerk, makros };
