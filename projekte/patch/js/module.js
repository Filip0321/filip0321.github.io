// Die Module der Patch-Wand. Jedes ist ein kleines Stück Web-Audio-Graph mit Buchsen:
//
//   ein: { name: { art, ziel } }   art "ton": ziel ist ein AudioNode (Eingang) oder ein AudioParam (Regler, der
//                                  mit Ton gesteuert wird); art "takt": ziel ist eine Funktion (zeit, dauer)
//   aus: { name: { art, knoten } } art "ton": ein AudioNode; art "takt": ein Takt-Ausgang aus takt.js
//   regler: [{ name, text, min, max, wert, schritt, log, einheit, setze(wert) }]  Drehknöpfe im Fenster
//   wahl:   [{ name, text, optionen: [[wert, text], …], wert, setze(wert) }]     Auswahlfelder
//   extra:  (element) => …   eigener Inhalt im Fenster (Schritte des Sequenzers, Bildschirm des Oszilloskops)
//   weg():  alles anhalten und lösen, wenn das Modul gelöscht wird
//
// Ton und Steuerung sind in Web Audio dasselbe: Zahlen, 48 000 je Sekunde. Darum kann jeder Ausgang an jeden
// Regler: ein Kabel an einen AudioParam ADDIERT das Signal zu dessen eigenem Wert (Grundwert vom Knopf + Kabel).
// So funktioniert Modulation: ein LFO an der Grenzfrequenz eines Filters bewegt sie um den Knopfwert herum.
//
// Tonhöhe wie bei echten Modularsystemen „1 Volt pro Oktave“: hier 1,0 pro Oktave. Ein Oszillator rechnet das über
// seinen detune-Regler (in Cent, 1200 Cent = eine Oktave): Kabel → Verstärker ×1200 → detune. Darum klingt eine
// Sequenz in jeder Lage gleich (eine Oktave ist immer eine Verdopplung, egal wie hoch der Grundton steht).

import { Takt } from "./takt.js";

const log = (min, max) => ({ min, max, log: true }); // Knopf logarithmisch (Frequenzen, Zeiten)
const FORMEN = [["sine", "Sinus"], ["triangle", "Dreieck"], ["sawtooth", "Sägezahn"], ["square", "Rechteck"]];

// gemeinsame Bausteine
function verstaerker(ctx, wert = 1) {
  const g = ctx.createGain();
  g.gain.value = wert;
  return g;
}
function konstante(ctx, wert = 0) {
  const k = ctx.createConstantSource();
  k.offset.value = wert;
  k.start();
  return k;
}

export const TYPEN = {
  // ---------- Klangquellen ----------
  oszillator: {
    titel: "Oszillator",
    gruppe: "Klang",
    baue(ctx) {
      const osc = ctx.createOscillator();
      const tonhoehe = verstaerker(ctx, 1200); // 1,0 → eine Oktave (detune in Cent)
      const fm = verstaerker(ctx, 0); // Frequenzmodulation: Kabel × Tiefe (Hz) → Frequenz
      tonhoehe.connect(osc.detune);
      fm.connect(osc.frequency);
      osc.start();
      return {
        ein: { "Tonhöhe": { art: "ton", ziel: tonhoehe }, FM: { art: "ton", ziel: fm } },
        aus: { aus: { art: "ton", knoten: osc } },
        regler: [
          { name: "frequenz", text: "Frequenz", ...log(20, 4000), wert: 110, einheit: "Hz", setze: (v) => osc.frequency.setTargetAtTime(v, ctx.currentTime, 0.01) },
          { name: "fein", text: "Fein", min: -100, max: 100, wert: 0, einheit: "Cent", setze: (v) => (osc.detune.value = v) },
          { name: "fmTiefe", text: "FM-Tiefe", ...log(1, 2000), wert: 100, einheit: "Hz", setze: (v) => fm.gain.setTargetAtTime(v, ctx.currentTime, 0.01) },
        ],
        wahl: [{ name: "form", text: "Form", optionen: FORMEN, wert: "sawtooth", setze: (v) => (osc.type = v) }],
        weg: () => osc.stop(),
      };
    },
  },

  rauschen: {
    titel: "Rauschen",
    gruppe: "Klang",
    baue(ctx) {
      // zwei Sekunden weißes Rauschen in Schleife (jeder Wert zufällig, alle Frequenzen gleich stark)
      const puffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = puffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const quelle = ctx.createBufferSource();
      quelle.buffer = puffer;
      quelle.loop = true;
      const pegel = verstaerker(ctx, 0.5);
      quelle.connect(pegel);
      quelle.start();
      return {
        ein: {},
        aus: { aus: { art: "ton", knoten: pegel } },
        regler: [{ name: "pegel", text: "Pegel", min: 0, max: 1, wert: 0.5, setze: (v) => (pegel.gain.value = v) }],
        weg: () => quelle.stop(),
      };
    },
  },

  // Bassdrum: ein Sinus, dessen Tonhöhe beim Schlag von hoch nach tief fällt (das „Wumm“), dazu eine kurze
  // Lautstärke-Hüllkurve. Hi-Hat: Rauschen durch einen Hochpass, sehr kurz. Zusammen reicht das für Techno.
  bassdrum: {
    titel: "Bassdrum",
    gruppe: "Klang",
    baue(ctx) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const vca = verstaerker(ctx, 0);
      osc.connect(vca);
      osc.start();
      const w = { tief: 48, hoch: 160, fall: 0.08, laenge: 0.45 };
      const schlag = (t) => {
        osc.frequency.cancelScheduledValues(t);
        osc.frequency.setValueAtTime(w.hoch, t);
        osc.frequency.exponentialRampToValueAtTime(w.tief, t + w.fall);
        vca.gain.cancelScheduledValues(t);
        vca.gain.setValueAtTime(1, t);
        vca.gain.exponentialRampToValueAtTime(0.001, t + w.laenge);
      };
      return {
        ein: { Auslöser: { art: "takt", ziel: schlag } },
        aus: { aus: { art: "ton", knoten: vca } },
        regler: [
          { name: "tief", text: "Ton", ...log(30, 120), wert: 48, einheit: "Hz", setze: (v) => (w.tief = v) },
          { name: "hoch", text: "Anschlag", ...log(60, 600), wert: 160, einheit: "Hz", setze: (v) => (w.hoch = v) },
          { name: "fall", text: "Fall", ...log(0.01, 0.4), wert: 0.08, einheit: "s", setze: (v) => (w.fall = v) },
          { name: "laenge", text: "Länge", ...log(0.05, 2), wert: 0.45, einheit: "s", setze: (v) => (w.laenge = v) },
        ],
        weg: () => osc.stop(),
      };
    },
  },

  hihat: {
    titel: "Hi-Hat",
    gruppe: "Klang",
    baue(ctx) {
      const puffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = puffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const quelle = ctx.createBufferSource();
      quelle.buffer = puffer;
      quelle.loop = true;
      const hoch = ctx.createBiquadFilter();
      hoch.type = "highpass";
      hoch.frequency.value = 7000;
      const vca = verstaerker(ctx, 0);
      quelle.connect(hoch).connect(vca);
      quelle.start();
      const w = { laenge: 0.05 };
      return {
        ein: { Auslöser: { art: "takt", ziel: (t) => {
          vca.gain.cancelScheduledValues(t);
          vca.gain.setValueAtTime(0.6, t);
          vca.gain.exponentialRampToValueAtTime(0.001, t + w.laenge);
        } } },
        aus: { aus: { art: "ton", knoten: vca } },
        regler: [
          { name: "laenge", text: "Länge", ...log(0.01, 0.6), wert: 0.05, einheit: "s", setze: (v) => (w.laenge = v) },
          { name: "farbe", text: "Farbe", ...log(2000, 14000), wert: 7000, einheit: "Hz", setze: (v) => (hoch.frequency.value = v) },
        ],
        weg: () => quelle.stop(),
      };
    },
  },

  mikrofon: {
    titel: "Mikrofon",
    gruppe: "Klang",
    baue(ctx, { melde }) {
      const pegel = verstaerker(ctx, 1);
      let strom = null;
      // erst auf Klick: der Browser fragt dann nach dem Mikrofon
      const extra = (el) => {
        const k = document.createElement("button");
        k.type = "button";
        k.textContent = "Mikrofon öffnen";
        k.addEventListener("click", async () => {
          try {
            const { oeffneMikrofon } = await import("/lib/audio-eingang.js");
            strom = await oeffneMikrofon();
            ctx.createMediaStreamSource(strom).connect(pegel);
            k.textContent = "Mikrofon offen";
            k.disabled = true;
          } catch (f) {
            melde(f.message);
          }
        });
        el.append(k);
      };
      return {
        ein: {},
        aus: { aus: { art: "ton", knoten: pegel } },
        regler: [{ name: "pegel", text: "Pegel", min: 0, max: 4, wert: 1, setze: (v) => (pegel.gain.value = v) }],
        extra,
        weg: () => strom?.getTracks().forEach((t) => t.stop()),
      };
    },
  },

  datei: {
    titel: "Datei",
    gruppe: "Klang",
    baue(ctx, { melde }) {
      const pegel = verstaerker(ctx, 1);
      let quelle = null;
      const extra = (el) => {
        const label = document.createElement("label");
        label.className = "datei-knopf";
        label.textContent = "Tondatei wählen";
        const feld = document.createElement("input");
        feld.type = "file";
        feld.accept = "audio/*";
        label.append(feld);
        feld.addEventListener("change", async () => {
          const f = feld.files[0];
          if (!f) return;
          try {
            const puffer = await ctx.decodeAudioData(await f.arrayBuffer());
            quelle?.stop();
            quelle = ctx.createBufferSource();
            quelle.buffer = puffer;
            quelle.loop = true;
            quelle.connect(pegel);
            quelle.start();
            label.firstChild.textContent = f.name;
          } catch {
            melde("Diese Datei kann der Browser nicht lesen.");
          }
        });
        el.append(label);
      };
      return {
        ein: {},
        aus: { aus: { art: "ton", knoten: pegel } },
        regler: [{ name: "pegel", text: "Pegel", min: 0, max: 2, wert: 1, setze: (v) => (pegel.gain.value = v) }],
        extra,
        weg: () => quelle?.stop(),
      };
    },
  },

  // ---------- Steuerung ----------
  lfo: {
    titel: "LFO",
    gruppe: "Steuerung",
    baue(ctx) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 0.5;
      const tiefe = verstaerker(ctx, 0.5);
      osc.connect(tiefe);
      osc.start();
      return {
        ein: { Tempo: { art: "ton", ziel: osc.frequency } },
        aus: { aus: { art: "ton", knoten: tiefe } },
        regler: [
          { name: "tempo", text: "Tempo", ...log(0.02, 30), wert: 0.5, einheit: "Hz", setze: (v) => (osc.frequency.value = v) },
          { name: "tiefe", text: "Tiefe", min: 0, max: 1, wert: 0.5, setze: (v) => tiefe.gain.setTargetAtTime(v, ctx.currentTime, 0.01) },
        ],
        wahl: [{ name: "form", text: "Form", optionen: FORMEN, wert: "sine", setze: (v) => (osc.type = v) }],
        weg: () => osc.stop(),
      };
    },
  },

  // Hüllkurve ADSR: beim Auslösen in A Sekunden auf 1 (Attack), in D auf S fallen (Decay, Sustain), solange der
  // Ton gehalten wird; danach in R auf 0 (Release). Gerechnet wird alles vorab als Fahrplan für den AudioParam
  // (linearRamp, setTargetAtTime): so ist es auf das Sample genau, auch wenn die Seite gerade ruckelt.
  // setTargetAtTime nähert sich dem Ziel exponentiell: nach einer Zeitkonstante τ sind 63 % geschafft, nach 3τ 95 %.
  // Darum τ = Zeit / 3.
  huellkurve: {
    titel: "Hüllkurve",
    gruppe: "Steuerung",
    baue(ctx) {
      const k = konstante(ctx, 0);
      const w = { a: 0.01, d: 0.2, s: 0.5, r: 0.3 };
      const ausloesen = (t, dauer = 0.2) => {
        const p = k.offset;
        p.cancelAndHoldAtTime?.(t) ?? p.cancelScheduledValues(t);
        p.linearRampToValueAtTime(1, t + w.a);
        p.setTargetAtTime(w.s, t + w.a, w.d / 3);
        if (!Number.isFinite(dauer)) return; // gehalten (MIDI-Taste): Release erst bei .los
        const los = t + Math.max(dauer, w.a);
        p.cancelScheduledValues(los + 1e-4);
        p.setTargetAtTime(0, los, w.r / 3);
      };
      // Taste losgelassen: ab jetzt in R auf 0
      ausloesen.los = (t) => {
        const p = k.offset;
        p.cancelAndHoldAtTime?.(t) ?? p.cancelScheduledValues(t);
        p.setTargetAtTime(0, t, w.r / 3);
      };
      return {
        ein: { Auslöser: { art: "takt", ziel: ausloesen } },
        aus: { aus: { art: "ton", knoten: k } },
        regler: [
          { name: "a", text: "Attack", ...log(0.001, 2), wert: 0.01, einheit: "s", setze: (v) => (w.a = v) },
          { name: "d", text: "Decay", ...log(0.01, 3), wert: 0.2, einheit: "s", setze: (v) => (w.d = v) },
          { name: "s", text: "Sustain", min: 0, max: 1, wert: 0.5, setze: (v) => (w.s = v) },
          { name: "r", text: "Release", ...log(0.01, 5), wert: 0.3, einheit: "s", setze: (v) => (w.r = v) },
        ],
        weg: () => k.stop(),
      };
    },
  },

  // Sequenzer: 8 Schritte, je eine Tonhöhe (Halbtöne) und an/aus. Gibt die Tonhöhe als Steuerspannung aus (1,0 pro
  // Oktave, also Halbtöne / 12) und bei jedem Schritt einen Takt (zum Auslösen von Hüllkurve oder Trommeln).
  sequenzer: {
    titel: "Sequenzer",
    gruppe: "Steuerung",
    baue(ctx, { uhr }) {
      const ton = konstante(ctx, 0);
      const takt = new Takt();
      const schritte = Array.from({ length: 8 }, (_, i) => ({ halbton: [0, 0, 7, 0, 12, 0, 3, 10][i], an: true }));
      let zeige = () => {};
      const w = { tempo: 120, teilung: 4, gate: 0.5 };
      const uhrAbo = uhr.abonniere(() => w.tempo * (w.teilung / 4), (t, nr) => {
        const i = nr % 8, s = schritte[i];
        zeige(i, t);
        if (!s.an) return;
        ton.offset.setValueAtTime(s.halbton / 12, t);
        takt.sende(t, (60 / (w.tempo * (w.teilung / 4))) * w.gate);
      });
      const extra = (el) => {
        const reihe = document.createElement("div");
        reihe.className = "schritte";
        const felder = schritte.map((s, i) => {
          const spalte = document.createElement("div");
          spalte.className = "schritt";
          const r = document.createElement("input");
          r.type = "range";
          r.min = -12;
          r.max = 24;
          r.step = 1;
          r.value = s.halbton;
          r.setAttribute("aria-label", `Schritt ${i + 1}, Halbtöne`);
          r.addEventListener("input", () => {
            s.halbton = Number(r.value);
            zahl.textContent = s.halbton;
          });
          const zahl = document.createElement("span");
          zahl.textContent = s.halbton;
          const an = document.createElement("button");
          an.type = "button";
          an.textContent = i + 1;
          an.setAttribute("aria-pressed", s.an);
          an.addEventListener("click", () => an.setAttribute("aria-pressed", (s.an = !s.an)));
          spalte.append(r, zahl, an);
          return { spalte, r, zahl, an };
        });
        reihe.append(...felder.map((f) => f.spalte));
        el.append(reihe);
        // der leuchtende Schritt: erst, wenn er wirklich klingt (der Takt ist vorausgeplant)
        zeige = (i, t) => setTimeout(() => felder.forEach((f, j) => f.spalte.classList.toggle("jetzt", j === i)), Math.max(0, (t - ctx.currentTime) * 1000));
        // für Speichern und Laden
        el.schritteLesen = () => schritte.map((s) => [s.halbton, s.an]);
        el.schritteSetzen = (liste) => liste?.forEach(([h, a], i) => {
          if (!schritte[i]) return;
          Object.assign(schritte[i], { halbton: h, an: a });
          felder[i].r.value = h;
          felder[i].zahl.textContent = h;
          felder[i].an.setAttribute("aria-pressed", a);
        });
      };
      return {
        ein: {},
        aus: { "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt } },
        regler: [
          { name: "tempo", text: "Tempo", min: 40, max: 200, wert: 120, schritt: 1, einheit: "BPM", setze: (v) => (w.tempo = v) },
          { name: "gate", text: "Länge", min: 0.05, max: 1, wert: 0.5, setze: (v) => (w.gate = v) },
        ],
        wahl: [{ name: "teilung", text: "Noten", optionen: [["4", "Viertel"], ["8", "Achtel"], ["16", "Sechzehntel"]], wert: "8", setze: (v) => (w.teilung = Number(v)) }],
        extra,
        weg: () => {
          uhrAbo();
          ton.stop();
        },
      };
    },
  },

  // Euklidischer Rhythmus: k Schläge so gleichmäßig wie möglich auf n Schritte verteilt (Bjorklund, 2003; Toussaint
  // fand darin viele Rhythmen der Welt: 3 aus 8 ist der Tresillo, 5 aus 8 der Cinquillo). Gleichmäßig verteilen ist
  // dasselbe Problem wie eine schräge Linie aus Pixeln (Bresenham): Schritt i schlägt, wenn
  //   ⌊(i + 1) · k / n⌋ > ⌊i · k / n⌋
  // also immer dann, wenn die laufende Summe k/n eine ganze Zahl überschreitet. „Drehen“ verschiebt das Muster.
  euklid: {
    titel: "Euklid",
    gruppe: "Steuerung",
    baue(ctx, { uhr }) {
      const takt = new Takt();
      const w = { n: 8, k: 3, drehen: 0, tempo: 120, teilung: 16 };
      let anzeige = null;
      const schlaegt = (i) => {
        const j = (((i + w.drehen) % w.n) + w.n) % w.n;
        return Math.floor(((j + 1) * w.k) / w.n) > Math.floor((j * w.k) / w.n);
      };
      const zeichneMuster = (aktiv = -1) => {
        if (!anzeige) return;
        anzeige.textContent = Array.from({ length: w.n }, (_, i) => (i === aktiv ? (schlaegt(i) ? "▣" : "▢") : schlaegt(i) ? "■" : "□")).join("");
      };
      const abo = uhr.abonniere(() => w.tempo * (w.teilung / 4), (t, nr) => {
        const i = nr % w.n;
        setTimeout(() => zeichneMuster(i), Math.max(0, (t - ctx.currentTime) * 1000));
        if (schlaegt(i)) takt.sende(t, 30 / (w.tempo * (w.teilung / 4)));
      });
      const neu = (feld) => (v) => {
        w[feld] = v;
        w.k = Math.min(w.k, w.n);
        zeichneMuster();
      };
      return {
        ein: {},
        aus: { Takt: { art: "takt", knoten: takt } },
        regler: [
          { name: "n", text: "Schritte", min: 2, max: 16, wert: 8, schritt: 1, setze: neu("n") },
          { name: "k", text: "Schläge", min: 0, max: 16, wert: 3, schritt: 1, setze: neu("k") },
          { name: "drehen", text: "Drehen", min: 0, max: 15, wert: 0, schritt: 1, setze: neu("drehen") },
          { name: "tempo", text: "Tempo", min: 40, max: 200, wert: 120, schritt: 1, einheit: "BPM", setze: (v) => (w.tempo = v) },
        ],
        wahl: [{ name: "teilung", text: "Noten", optionen: [["4", "Viertel"], ["8", "Achtel"], ["16", "Sechzehntel"]], wert: "16", setze: (v) => (w.teilung = Number(v)) }],
        extra: (el) => {
          anzeige = document.createElement("p");
          anzeige.className = "muster";
          el.append(anzeige);
          zeichneMuster();
        },
        weg: abo,
      };
    },
  },

  // ---------- Bearbeiten ----------
  filter: {
    titel: "Filter",
    gruppe: "Bearbeiten",
    baue(ctx) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      // Steuerung über detune (Cent): ein Kabel mit 1,0 verschiebt die Grenze um „Mod“ Oktaven; so wirkt ein LFO
      // oben und unten im Spektrum gleich stark (wie man Tonhöhen hört)
      const mod = verstaerker(ctx, 2400);
      mod.connect(f.detune);
      return {
        ein: { ein: { art: "ton", ziel: f }, Grenze: { art: "ton", ziel: mod } },
        aus: { aus: { art: "ton", knoten: f } },
        regler: [
          { name: "grenze", text: "Grenze", ...log(40, 16000), wert: 1200, einheit: "Hz", setze: (v) => f.frequency.setTargetAtTime(v, ctx.currentTime, 0.01) },
          { name: "resonanz", text: "Resonanz", ...log(0.3, 30), wert: 4, setze: (v) => (f.Q.value = v) },
          { name: "mod", text: "Mod", min: 0, max: 6, wert: 2, einheit: "Okt.", setze: (v) => (mod.gain.value = v * 1200) },
        ],
        wahl: [{ name: "typ", text: "Art", optionen: [["lowpass", "Tiefpass"], ["highpass", "Hochpass"], ["bandpass", "Bandpass"], ["notch", "Kerbe"]], wert: "lowpass", setze: (v) => (f.type = v) }],
      };
    },
  },

  // Verstärker (VCA): der Knopf ist der Grundpegel, ein Kabel an „Steuerung“ addiert dazu. Mit Grundpegel 0 und
  // einer Hüllkurve an Steuerung: der Ton ist nur da, solange die Hüllkurve offen ist.
  verstaerker: {
    titel: "Verstärker",
    gruppe: "Bearbeiten",
    baue(ctx) {
      const g = verstaerker(ctx, 0);
      return {
        ein: { ein: { art: "ton", ziel: g }, Steuerung: { art: "ton", ziel: g.gain } },
        aus: { aus: { art: "ton", knoten: g } },
        regler: [{ name: "pegel", text: "Grundpegel", min: 0, max: 1, wert: 0, setze: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.01) }],
      };
    },
  },

  // Echo: Verzögerung mit Rückkopplung. Ein Bruchteil r des Ausgangs geht wieder hinein; jedes Echo ist r-mal so laut
  // wie das davor. r < 1 klingt aus (geometrische Reihe), r ≥ 1 würde immer lauter: darum höchstens 0,95.
  echo: {
    titel: "Echo",
    gruppe: "Bearbeiten",
    baue(ctx) {
      const ein = verstaerker(ctx, 1), aus = verstaerker(ctx, 1);
      const zeit = ctx.createDelay(4);
      const rueck = verstaerker(ctx, 0.4), nass = verstaerker(ctx, 0.4), trocken = verstaerker(ctx, 1);
      ein.connect(trocken).connect(aus);
      ein.connect(zeit);
      zeit.connect(rueck).connect(zeit);
      zeit.connect(nass).connect(aus);
      return {
        ein: { ein: { art: "ton", ziel: ein }, Zeit: { art: "ton", ziel: zeit.delayTime } },
        aus: { aus: { art: "ton", knoten: aus } },
        regler: [
          { name: "zeit", text: "Zeit", ...log(0.01, 2), wert: 0.375, einheit: "s", setze: (v) => zeit.delayTime.setTargetAtTime(v, ctx.currentTime, 0.05) },
          { name: "rueck", text: "Rückkopplung", min: 0, max: 0.95, wert: 0.4, setze: (v) => (rueck.gain.value = v) },
          { name: "nass", text: "Echo", min: 0, max: 1, wert: 0.4, setze: (v) => (nass.gain.value = v) },
        ],
      };
    },
  },

  mischer: {
    titel: "Mischer",
    gruppe: "Bearbeiten",
    baue(ctx) {
      const aus = verstaerker(ctx, 1);
      const kanaele = [1, 2, 3, 4].map(() => {
        const g = verstaerker(ctx, 0.8);
        g.connect(aus);
        return g;
      });
      return {
        ein: Object.fromEntries(kanaele.map((g, i) => [`${i + 1}`, { art: "ton", ziel: g }])),
        aus: { aus: { art: "ton", knoten: aus } },
        regler: kanaele.map((g, i) => ({ name: `k${i + 1}`, text: `${i + 1}`, min: 0, max: 1.5, wert: 0.8, setze: (v) => (g.gain.value = v) })),
      };
    },
  },

  // ---------- Ausgang und Bild ----------
  // Ausgang: Lautstärke, dann ein Begrenzer (ein Kompressor mit hartem Knick und hohem Verhältnis), damit eine wilde
  // Rückkopplung nicht in die Ohren knallt. Von hier geht es an die Lautsprecher und an die Aufnahme.
  ausgang: {
    titel: "Ausgang",
    gruppe: "Ausgang und Bild",
    einmal: true,
    baue(ctx, { lautsprecher }) {
      const g = verstaerker(ctx, 0.5);
      const grenze = ctx.createDynamicsCompressor();
      grenze.threshold.value = -6;
      grenze.knee.value = 0;
      grenze.ratio.value = 20;
      grenze.attack.value = 0.002;
      grenze.release.value = 0.1;
      g.connect(grenze).connect(lautsprecher);
      return {
        ein: { ein: { art: "ton", ziel: g } },
        aus: {},
        regler: [{ name: "laut", text: "Lautstärke", min: 0, max: 1, wert: 0.5, setze: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.02) }],
        weg: () => grenze.disconnect(),
      };
    },
  },

  // Oszilloskop: ein Eingang → Kurve über der Zeit (getriggert an der steigenden Nulllinie, damit sie stillsteht);
  // zwei Eingänge → X gegen Y (Lissajous-Figuren, Oszilloskop-Musik). Nachleuchten wie Phosphor: das alte Bild wird
  // jedes Mal nur ein wenig abgedunkelt statt gelöscht.
  oszilloskop: {
    titel: "Oszilloskop",
    gruppe: "Ausgang und Bild",
    baue(ctx, { bild }) {
      const ax = ctx.createAnalyser(), ay = ctx.createAnalyser();
      ax.fftSize = ay.fftSize = 2048;
      const dx = new Float32Array(2048), dy = new Float32Array(2048);
      const w = { zoom: 1, nachleuchten: 0.85 };
      let leinwand = null, g = null, yVerbunden = () => false;
      const zeichne = () => {
        if (!g) return;
        const B = leinwand.width, H = leinwand.height;
        // Nachleuchten: das alte Bild nicht übermalen, sondern seine Deckkraft verringern (destination-out radiert).
        // Mit einer halbdurchsichtigen Hintergrundfarbe darüber blieb ein grauer Schleier stehen: in 8 Bit kommt
        // c · (1 − a) irgendwann nicht mehr unter den nächsten ganzen Wert. Der Hintergrund kommt aus dem CSS.
        g.globalCompositeOperation = "destination-out";
        g.fillStyle = `rgba(0, 0, 0, ${1 - w.nachleuchten})`;
        g.fillRect(0, 0, B, H);
        g.globalCompositeOperation = "source-over";
        g.strokeStyle = getComputedStyle(leinwand).color;
        g.lineWidth = 1.5;
        g.beginPath();
        ax.getFloatTimeDomainData(dx);
        if (yVerbunden()) {
          ay.getFloatTimeDomainData(dy);
          for (let i = 0; i < dx.length; i++) {
            const x = B / 2 + dx[i] * (B / 2) * w.zoom, y = H / 2 - dy[i] * (H / 2) * w.zoom;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
        } else {
          let start = 0;
          for (let i = 1; i < dx.length / 2; i++) if (dx[i - 1] <= 0 && dx[i] > 0) { start = i; break; }
          for (let i = 0; i < 1024; i++) {
            const x = (i / 1023) * B, y = H / 2 - dx[start + i] * (H / 2) * w.zoom;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
        }
        g.stroke();
      };
      return {
        ein: { X: { art: "ton", ziel: ax }, Y: { art: "ton", ziel: ay } },
        aus: {},
        regler: [
          { name: "zoom", text: "Zoom", ...log(0.1, 10), wert: 1, setze: (v) => (w.zoom = v) },
          { name: "nachleuchten", text: "Nachleuchten", min: 0, max: 0.98, wert: 0.85, setze: (v) => (w.nachleuchten = v) },
        ],
        extra: (el, modul) => {
          leinwand = document.createElement("canvas");
          leinwand.width = leinwand.height = 320;
          leinwand.className = "schirm";
          el.append(leinwand);
          g = leinwand.getContext("2d");
          yVerbunden = () => modul.eingangBelegt("Y");
          bild.add(zeichne);
        },
        weg: () => bild.delete(zeichne),
      };
    },
  },

  // Wellen: eine kleine Wellenwanne (/projekte/wellenwanne, gleiche Rechnung auf der Grafikkarte). Der Ton am Eingang
  // treibt zwei Quellen an: ihre Stärke ist der Pegel (RMS: Wurzel aus dem Mittel der Quadrate der letzten 2048
  // Samples), jeder Takt lässt einen Tropfen an einer zufälligen Stelle fallen. So wird der Patch sichtbar.
  wellen: {
    titel: "Wellen",
    gruppe: "Ausgang und Bild",
    baue(ctx, { bild, melde }) {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      const d = new Float32Array(2048);
      const w = { wellenlaenge: 16, verstaerkung: 3, quellen: 2 };
      let wanne = null, tropfen = [], pegel = 0;
      const zeichne = () => {
        if (!wanne) return;
        a.getFloatTimeDomainData(d);
        let summe = 0;
        for (const v of d) summe += v * v;
        pegel += (Math.sqrt(summe / d.length) - pegel) * 0.3;
        const f = 0.5 / w.wellenlaenge;
        tropfen = tropfen.filter((q) => wanne.zeit - q.start < 1 / f);
        const quellen = [];
        for (let i = 0; i < w.quellen; i++) quellen.push({ x: 0.5 + (i - (w.quellen - 1) / 2) * 0.12, y: 0.5, f, a: pegel * 6, r: 1.5 });
        for (const q of tropfen) quellen.push({ x: q.x, y: q.y, f, a: 1.5, r: 1.5 });
        wanne.rechne(4, { quellen, ebene: { an: false, f, a: 0 }, tau: 200 });
        wanne.zeichne({ art: "auslenkung", verstaerkung: w.verstaerkung, hell: [0.867, 0.867, 0.867], dunkel: [0.067, 0.067, 0.067], wand: [0.867, 0.867, 0.867] });
      };
      return {
        ein: { ein: { art: "ton", ziel: a }, Tropfen: { art: "takt", ziel: (t) => setTimeout(() => wanne && tropfen.push({ x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6, start: wanne.zeit }), Math.max(0, (t - ctx.currentTime) * 1000)) } },
        aus: {},
        regler: [
          { name: "wellenlaenge", text: "Welle", min: 6, max: 40, wert: 16, schritt: 1, setze: (v) => (w.wellenlaenge = v) },
          { name: "verstaerkung", text: "Verstärkung", ...log(0.5, 20), wert: 3, setze: (v) => (w.verstaerkung = v) },
          { name: "quellen", text: "Quellen", min: 0, max: 4, wert: 2, schritt: 1, setze: (v) => (w.quellen = v) },
        ],
        extra: async (el) => {
          const leinwand = document.createElement("canvas");
          leinwand.width = leinwand.height = 256;
          leinwand.className = "schirm";
          el.append(leinwand);
          try {
            const [{ erstelleWanne }, { erstelleMedium }] = await Promise.all([import("/projekte/wellenwanne/js/wanne.js"), import("/projekte/wellenwanne/js/medium.js")]);
            const neu = erstelleWanne(leinwand), medium = erstelleMedium();
            neu.groesse(256, 256);
            medium.groesse(256, 256);
            neu.setzeMedium(medium.textur());
            wanne = neu;
            bild.add(zeichne);
          } catch (f) {
            melde(f.message);
          }
        },
        weg: () => bild.delete(zeichne),
      };
    },
  },

  // Lenia: eine kleine Lenia-Welt (/projekte/lenia, gleiche Rechnung) als Sequenzer. Ein Lesekopf wandert im Takt
  // Spalte für Spalte über die Welt (16 Spalten pro Durchgang). In jeder Spalte sucht er die lebendigste Zelle:
  // ist sie heller als die Schwelle, gibt es einen Takt, und ihre Höhe wird die Tonhöhe (auf eine Tonleiter
  // gerundet). „Dichte“ ist der Anteil lebender Zellen in der Spalte, als langsame Steuerspannung.
  // Die Wesen wandern, also wandert die Melodie: kein Durchgang klingt wie der vorige.
  // Eingänge: „Wesen“ (Takt) setzt ein Wesen an eine zufällige Stelle, „Futter“ (Ton) streut bei lautem Ton
  // zufällige Werte in die Welt; zu viel Futter lässt sie wuchern.
  lenia: {
    titel: "Lenia",
    gruppe: "Steuerung",
    baue(ctx, { uhr, bild, melde }) {
      const ton = konstante(ctx, 0), dichte = konstante(ctx, 0);
      const takt = new Takt();
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      const d = new Float32Array(2048);
      const LEITERN = { penta: [0, 2, 4, 7, 9], moll: [0, 2, 3, 5, 7, 8, 10], dur: [0, 2, 4, 5, 7, 9, 11], chromatisch: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
      const w = { tempo: 110, teilung: 8, umfang: 2, schwelle: 0.4, gate: 0.4, schritte: 2, leiter: "penta", wesen: 0, wild: "neu" };
      let welt = null, setze = null, alleWesen = null, kopf = -1, pegel = 0, wollen = 0, dichteDurchgang = 0;
      const N = 128, SPALTEN = 16;

      // Ein neues Wesen nur dorthin, wo frei ist: im Umkreis von 1,6 R darf nichts leben. Landet es auf einem
      // anderen, entsteht oft ein Klumpen, aus dem die ganze Welt zuwuchert. 30 Versuche; findet sich kein Platz,
      // ist die Welt voll und es kommt keins dazu.
      const setzeWesen = () => {
        const m = alleWesen[w.wesen];
        welt.bearbeite((feld, n) => {
          const r = Math.ceil(1.6 * m.R);
          const frei = (cx, cy) => {
            for (let y = -r; y <= r; y++)
              for (let x = -r; x <= r; x++) {
                if (x * x + y * y > r * r) continue;
                if (feld[((((cy + y) % n) + n) % n * n + ((((cx + x) % n) + n) % n)) * 4] > 0.01) return false;
              }
            return true;
          };
          for (let versuch = 0; versuch < 30; versuch++) {
            const cx = Math.floor(Math.random() * n), cy = Math.floor(Math.random() * n);
            if (!frei(cx, cy)) continue;
            setze(feld, n, m.muster, cx, cy, Math.random() * Math.PI * 2);
            return;
          }
        });
      };
      const regelnSetzen = () => {
        if (!welt) return;
        welt.setzeKern(alleWesen[w.wesen].R);
      };
      const uhrAbo = uhr.abonniere(() => w.tempo * (w.teilung / 4), (t, nr) => {
        if (!welt) return;
        const i = nr % SPALTEN, x = Math.floor(((i + 0.5) / SPALTEN) * N);
        const spalte = welt.spalte(x);
        let best = 0, wo = 0, lebend = 0;
        spalte.forEach((v, y) => {
          if (v > best) [best, wo] = [v, y];
          if (v > 0.1) lebend++;
        });
        setTimeout(() => (kopf = x / N + 0.5 / N), Math.max(0, (t - ctx.currentTime) * 1000));
        dichte.offset.setTargetAtTime(lebend / N, t, 0.05);
        // Wildwuchs: selten verschmelzen zwei Wesen beim Zusammenstoß zu etwas, das die ganze Welt überwuchert
        // (gemessen in etwa einem von drei Testläufen nach 10 bis 20 s). Ist nach einem ganzen Durchgang im
        // Mittel mehr als ein Drittel der gelesenen Zellen lebendig, fängt die Welt mit drei Wesen neu an.
        dichteDurchgang += lebend / N;
        if (i === SPALTEN - 1) {
          if (w.wild === "neu" && dichteDurchgang / SPALTEN > 1 / 3) setTimeout(() => {
            welt.groesse(N);
            for (let k = 0; k < 3; k++) setzeWesen();
          });
          dichteDurchgang = 0;
        }
        if (best < w.schwelle) return;
        // Höhe → Stufe der Tonleiter über „umfang“ Oktaven (unten tief, oben hoch)
        const leiter = LEITERN[w.leiter], stufen = leiter.length * w.umfang;
        const k = Math.min(stufen - 1, Math.floor((wo / N) * stufen));
        const halbton = leiter[k % leiter.length] + 12 * Math.floor(k / leiter.length);
        ton.offset.setValueAtTime(halbton / 12, t);
        takt.sende(t, (60 / (w.tempo * (w.teilung / 4))) * w.gate);
      });

      const zeichne = () => {
        if (!welt) return;
        // Futter: Pegel (RMS) des Eingangs; über 0,05 fallen Krümel, je lauter, desto mehr (voller Sinus, RMS 0,71: 0,33 je Bild, bei 60 Bildern also rund 20 je Sekunde)
        a.getFloatTimeDomainData(d);
        let summe = 0;
        for (const v of d) summe += v * v;
        pegel += (Math.sqrt(summe / d.length) - pegel) * 0.3;
        wollen += Math.max(0, pegel - 0.05) * 0.5;
        if (wollen >= 1) {
          const n = Math.floor(wollen);
          wollen -= n;
          welt.bearbeite((feld) => {
            for (let k = 0; k < n; k++) {
              const cx = Math.random() * N, cy = Math.random() * N;
              for (let y = -3; y <= 3; y++)
                for (let x = -3; x <= 3; x++) {
                  if (x * x + y * y > 9) continue;
                  const j = ((((Math.floor(cy) + y) % N) + N) % N) * N + ((((Math.floor(cx) + x) % N) + N) % N);
                  feld[j * 4] = Math.random();
                }
            }
          });
        }
        const m = alleWesen[w.wesen];
        welt.rechne(w.schritte, { mu: m.mu, sigma: m.sigma, dt: m.dt });
        welt.zeichne({ hell: [0.867, 0.867, 0.867], dunkel: [0.067, 0.067, 0.067], art: "zellen", spalte: kopf });
      };

      return {
        ein: {
          Wesen: { art: "takt", ziel: (t) => setTimeout(() => welt && setzeWesen(), Math.max(0, (t - ctx.currentTime) * 1000)) },
          Futter: { art: "ton", ziel: a },
        },
        aus: { "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt }, Dichte: { art: "ton", knoten: dichte } },
        regler: [
          { name: "tempo", text: "Tempo", min: 40, max: 200, wert: 110, schritt: 1, einheit: "BPM", setze: (v) => (w.tempo = v) },
          { name: "schwelle", text: "Schwelle", min: 0.05, max: 0.95, wert: 0.4, setze: (v) => (w.schwelle = v) },
          { name: "umfang", text: "Oktaven", min: 1, max: 4, wert: 2, schritt: 1, setze: (v) => (w.umfang = v) },
          { name: "gate", text: "Länge", min: 0.05, max: 1, wert: 0.4, setze: (v) => (w.gate = v) },
          { name: "schritte", text: "Leben", min: 0, max: 6, wert: 2, schritt: 1, setze: (v) => (w.schritte = v) },
        ],
        wahl: [
          { name: "teilung", text: "Noten", optionen: [["4", "Viertel"], ["8", "Achtel"], ["16", "Sechzehntel"]], wert: "8", setze: (v) => (w.teilung = Number(v)) },
          { name: "leiter", text: "Tonleiter", optionen: [["penta", "pentatonisch"], ["moll", "Moll"], ["dur", "Dur"], ["chromatisch", "chromatisch"]], wert: "penta", setze: (v) => (w.leiter = v) },
          { name: "wesen", text: "Wesen", optionen: [["0", "Orbium"], ["2", "Gyrorbium"], ["3", "Scutium"], ["6", "Paraptera"]], wert: "0", setze: (v) => { w.wesen = Number(v); regelnSetzen(); } },
          { name: "wild", text: "Wildwuchs", optionen: [["neu", "neu anfangen"], ["lassen", "wuchern lassen"]], wert: "neu", setze: (v) => (w.wild = v) },
        ],
        extra: async (el) => {
          const leinwand = document.createElement("canvas");
          leinwand.width = leinwand.height = 256;
          leinwand.className = "schirm";
          const knoepfe = document.createElement("div");
          knoepfe.className = "schritte";
          const neu = document.createElement("button"), leer = document.createElement("button");
          neu.type = leer.type = "button";
          neu.textContent = "Wesen dazu";
          leer.textContent = "leeren";
          knoepfe.append(neu, leer);
          el.append(leinwand, knoepfe);
          try {
            const [lenia, katalog] = await Promise.all([import("/projekte/lenia/js/lenia.js"), import("/projekte/lenia/js/wesen.js")]);
            setze = lenia.setzeMuster;
            alleWesen = katalog.WESEN.map((x) => ({ ...x, muster: katalog.entpacke(x.zellen) }));
            const neueWelt = lenia.erstelleLenia(leinwand);
            neueWelt.groesse(N);
            welt = neueWelt;
            regelnSetzen();
            for (let k = 0; k < 3; k++) setzeWesen();
            neu.addEventListener("click", setzeWesen);
            leer.addEventListener("click", () => welt.groesse(N));
            bild.add(zeichne);
          } catch (f) {
            melde(f.message);
          }
        },
        weg: () => {
          uhrAbo();
          bild.delete(zeichne);
          ton.stop();
          dichte.stop();
        },
      };
    },
  },

  // Spektrum: die Fourier-Transformation des Eingangs (AnalyserNode), als Spektrogramm, das nach links wandert.
  // Senkrecht logarithmisch (wie man hört): Zeile y ↔ Frequenz 30 Hz · (16000 / 30)^(1 − y / H).
  spektrum: {
    titel: "Spektrum",
    gruppe: "Ausgang und Bild",
    baue(ctx, { bild }) {
      const a = ctx.createAnalyser();
      a.fftSize = 4096;
      a.smoothingTimeConstant = 0;
      const d = new Uint8Array(a.frequencyBinCount);
      let leinwand = null, g = null;
      const zeichne = () => {
        if (!g) return;
        const B = leinwand.width, H = leinwand.height;
        g.drawImage(leinwand, -2, 0);
        a.getByteFrequencyData(d);
        const nyquist = ctx.sampleRate / 2;
        for (let y = 0; y < H; y++) {
          const f = 30 * (16000 / 30) ** (1 - y / H);
          const v = d[Math.min(d.length - 1, Math.round((f / nyquist) * d.length))] / 255;
          g.fillStyle = `rgba(221, 221, 221, ${v * v})`;
          g.clearRect(B - 2, y, 2, 1);
          g.fillRect(B - 2, y, 2, 1);
        }
      };
      return {
        ein: { ein: { art: "ton", ziel: a } },
        aus: {},
        regler: [],
        extra: (el) => {
          leinwand = document.createElement("canvas");
          leinwand.width = 320;
          leinwand.height = 200;
          leinwand.className = "schirm";
          el.append(leinwand);
          g = leinwand.getContext("2d");
          bild.add(zeichne);
        },
        weg: () => bild.delete(zeichne),
      };
    },
  },
};

// weitere Module (Runde 17): eigene Dateien, hier nur dazugelegt; die Reihenfolge der Gruppen bleibt
import { NEUE_MODULE } from "./module-neu.js";
Object.assign(TYPEN, NEUE_MODULE);
