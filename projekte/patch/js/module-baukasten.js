// Baukasten (Runde 22b): die Bausteine, aus denen die Klang-Gruppen (klaenge.js) gesteckt sind. Mit ihnen lässt sich
// alles nachbauen, was die kompakten Natur-Module können, und man sieht dabei jeden Schritt.
//   Salve    ein Takt rein, viele heraus: n Schläge im Abstand, mit Zufall und Beschleunigen (Max: [uzi])
//   Kurve    bei jedem Takt eine Form: ein Bogen durch drei Punkte (Tonhöhe einer Silbe) oder eine Hülle (Lautstärke)
//   Shaper   Wellenformer: jeder Wert x wird zu f(x) (weich, hart, falten, gleichrichten, Spitzen, Stufen, Obertöne)
//   Pling    viele angeschlagene, ausklingende Sinustöne zugleich (Tropfen, Holz, Glocken), Sample für Sample

import { Takt } from "./takt.js";
import { log, verstaerker, konstante } from "./bausteine.js";
import { linienBild } from "./anzeigen.js";

// ---------- Salve ----------
// Ein Takt am Eingang plant sofort eine ganze Reihe: Schlag k zur Zeit t + Summe der Abstände davor. Jeder Abstand ist
// „Abstand“ · Beschleunigen^k, plus Zufall. Beschleunigen < 1: immer schneller (ein springender Ball, ein Specht, der
// ausläuft, ist > 1). Anzahl plus „Streuung“ zufällig dazu (eine Amsel singt mal 4, mal 8 Silben).
// Ausgänge: Takt (jeder Schlag), Erster, Ende (nach dem letzten: daran kann die nächste Salve hängen), Nummer (k / 12,
// eine Treppe von Halbtönen: Schlag 1 = 0, Schlag 2 = 1/12 …; mit Mathe zu jeder anderen Treppe).
const salve = {
  titel: "Salve",
  gruppe: "Werkzeug",
  baue(ctx) {
    const takt = new Takt(), erster = new Takt(), ende = new Takt(), nummer = konstante(ctx, 0);
    const w = { anzahl: 4, streuung: 0, abstand: 0.1, zufall: 0, beschleunigen: 1, dauer: 0.5 };
    const los = (t) => {
      const n = Math.max(1, Math.round(w.anzahl + Math.random() * w.streuung));
      let zeit = t, abstand = w.abstand;
      for (let k = 0; k < n; k++) {
        const dauer = abstand * w.dauer;
        takt.sende(zeit, dauer);
        if (k === 0) erster.sende(zeit, dauer);
        nummer.offset.setValueAtTime(k / 12, zeit);
        zeit += abstand * (1 + (Math.random() * 2 - 1) * w.zufall);
        abstand *= w.beschleunigen;
      }
      ende.sende(zeit, 0.05);
    };
    return {
      ein: { Takt: { art: "takt", ziel: los } },
      aus: { Takt: { art: "takt", knoten: takt }, Erster: { art: "takt", knoten: erster }, Ende: { art: "takt", knoten: ende }, Nummer: { art: "ton", knoten: nummer } },
      regler: [
        { name: "anzahl", text: "Anzahl", min: 1, max: 40, wert: 4, schritt: 1, setze: (v) => (w.anzahl = v) },
        { name: "streuung", text: "+ Zufall", min: 0, max: 20, wert: 0, schritt: 1, setze: (v) => (w.streuung = v) },
        { name: "abstand", text: "Abstand", ...log(0.005, 3), wert: 0.1, einheit: "s", setze: (v) => (w.abstand = v) },
        { name: "zufall", text: "Wackeln", min: 0, max: 1, wert: 0, setze: (v) => (w.zufall = v) },
        { name: "beschleunigen", text: "Beschl.", ...log(0.5, 2), wert: 1, setze: (v) => (w.beschleunigen = v) },
        { name: "dauer", text: "Dauer", min: 0.05, max: 1, wert: 0.5, setze: (v) => (w.dauer = v) },
      ],
      weg: () => nummer.stop(),
    };
  },
};

// ---------- Kurve ----------
// Bei jedem Takt läuft eine Form ab, danach steht der Ausgang wieder auf 0.
//   Bogen   von Start über Mitte zu Ende, weich (Kosinus) dazwischen. An die Tonhöhe eines Oszillators (1,0 pro
//           Oktave): der Tonhöhen-Verlauf einer Vogelsilbe, ein Abwärts-Wischer, ein Glissando.
//   Hülle   0 → Spitze → 0 als sin^Form: Form 1 rund, 2 wie eine Glocke (sin², weich an beiden Enden), 0,3 fast
//           ein Kasten. An die Steuerung eines Verstärkers: jede Silbe, jeder Puls, jeder Ruf.
// Streuung: jeder Punkt bekommt bei jedem Takt einen eigenen Zufall dazu (± Streuung): keine Silbe gleicht der
// anderen. Eingang „dazu“ wird einfach addiert (zum Beispiel ein Zufall in Stufen am selben Takt).
// Gerechnet als 16 gerade Stücke (linearRampToValueAtTime), damit eine neue Kurve die alte jederzeit abbrechen kann.
const kurve = {
  titel: "Kurve",
  gruppe: "Werkzeug",
  baue(ctx, { bild }) {
    const k = konstante(ctx, 0), aus = verstaerker(ctx, 1), dazu = verstaerker(ctx, 1);
    let letzter = -1; // Zeit des letzten Anschlags (für den Punkt im Bild)
    k.connect(aus);
    dazu.connect(aus);
    const w = { art: "bogen", start: 0, mitte: 0, ende: 0, dauer: 0.1, streuung: 0, form: 2 };
    const zufall = () => (Math.random() * 2 - 1) * w.streuung;
    const los = (t, d) => {
      letzter = t;
      const dauer = w.dauer > 0 ? w.dauer : Number.isFinite(d) ? d : 0.1;
      const p = k.offset, N = 16;
      p.cancelScheduledValues(t);
      if (w.art === "bogen") {
        const pkt = [w.start + zufall(), w.mitte + zufall(), w.ende + zufall()];
        p.setValueAtTime(pkt[0], t);
        for (let i = 1; i <= N; i++) {
          const u = (i / N) * 2, j = Math.min(1, Math.floor(u)), f = u - j, m = (1 - Math.cos(Math.PI * f)) / 2;
          p.linearRampToValueAtTime(pkt[j] + (pkt[j + 1] - pkt[j]) * m, t + (i / N) * dauer);
        }
      } else {
        const spitze = Math.max(0, w.mitte + zufall());
        p.setValueAtTime(0, t);
        for (let i = 1; i <= N; i++) p.linearRampToValueAtTime(spitze * Math.sin((Math.PI * i) / N) ** w.form, t + (i / N) * dauer);
      }
      p.setValueAtTime(0, t + dauer + 1e-4);
    };
    // Bild: die Form ohne Streuung, Punkt: wo die Kurve gerade läuft (nach Ende verschwindet er)
    const form = (u) => {
      if (w.art === "huelle") return w.mitte * Math.sin(Math.PI * u) ** w.form;
      const v = u * 2, j = Math.min(1, Math.floor(v)), f = v - j, m = (1 - Math.cos(Math.PI * f)) / 2, p = [w.start, w.mitte, w.ende];
      return p[j] + (p[j + 1] - p[j]) * m;
    };
    const grenze = () => Math.max(1, ...[w.start, w.mitte, w.ende].map(Math.abs));
    const bildchen = linienBild(bild, () => Array.from({ length: 64 }, (_, i) => form(i / 63) / grenze()), {
      punkt: () => {
        const u = (ctx.currentTime - letzter) / w.dauer;
        return letzter >= 0 && u >= 0 && u <= 1 ? [u, form(u) / grenze()] : null;
      },
    });
    return {
      extra: bildchen.extra,
      ein: { Takt: { art: "takt", ziel: los }, dazu: { art: "ton", ziel: dazu } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "start", text: "Start", min: -3, max: 3, wert: 0, setze: (v) => (w.start = v) },
        { name: "mitte", text: "Mitte/Spitze", min: -3, max: 3, wert: 0, setze: (v) => (w.mitte = v) },
        { name: "ende", text: "Ende", min: -3, max: 3, wert: 0, setze: (v) => (w.ende = v) },
        { name: "dauer", text: "Dauer", ...log(0.002, 4), wert: 0.1, einheit: "s", setze: (v) => (w.dauer = v) },
        { name: "streuung", text: "Streuung", min: 0, max: 1.5, wert: 0, setze: (v) => (w.streuung = v) },
        { name: "form", text: "Form", ...log(0.2, 8), wert: 2, setze: (v) => (w.form = v) },
      ],
      wahl: [{ name: "art", text: "Art", optionen: [["bogen", "Bogen (Start–Mitte–Ende)"], ["huelle", "Hülle (0–Spitze–0)"]], wert: "bogen", setze: (v) => (w.art = v) }],
      weg: () => {
        k.stop();
        bildchen.weg();
      },
    };
  },
};

// ---------- Shaper ----------
// Ein Wellenformer (WaveShaperNode): jeder Wert x wird durch eine Kennlinie f(x) ersetzt. Zuerst mal „Antrieb“ (und
// plus „Schief“, das verschiebt die Welle und macht die Verzerrung unsymmetrisch: gerade Obertöne, wie Röhren).
//   weich     tanh: rundet ab, wie Band und Röhre
//   hart      abschneiden bei ±1: Fuzz, Rechteck
//   falten    sin: was über 1 hinausgeht, klappt zurück (Wavefolder, Buchla, Westküste): bei viel Antrieb
//             immer mehr Zacken, metallisch
//   betrag    |x|: die untere Hälfte nach oben, Frequenz verdoppelt (Oktave höher)
//   halb      max(0, x): nur die obere Hälfte
//   spitzen   max(0, x)^8: aus jeder Welle wird ein schmaler Impuls. Ein Impuls durch ein Filter klingt wie ein
//             Anschlag: so entstehen Frosch-Pulse, Knarren, „Glottis“
//   stufen    auf wenige Stufen gerundet (wie der Bitcrusher, aber ohne kleinere Abtastrate)
//   eigene    selbst gemalt (Runde 24): mit der Maus über das Bild ziehen. 33 Stützpunkte von −1 bis 1, dazwischen
//             gerade Linien. Malt man auf eine andere Kennlinie, wird sie zuerst übernommen und dann verändert.
//   obertöne  Tschebyschow-Polynome: T₂(x) = 2x² − 1 macht aus einem Sinus genau seine Oktave, T₃ = 4x³ − 3x genau
//             die Duodezime. Gemischt nach „Mix“: ein Sinus bekommt gezielt Obertöne (additiv ohne Oszillatoren)
// Vierfach überabgetastet (oversample 4x): Verzerrung macht Obertöne über der halben Abtastrate, die sonst als
// falsche, tiefere Töne zurückspiegeln würden (Aliasing).
const KENNLINIEN = {
  weich: (x) => Math.tanh(x),
  hart: (x) => Math.max(-1, Math.min(1, x)),
  falten: (x) => Math.sin(x),
  betrag: (x) => Math.abs(x) * 2 - 1,
  halb: (x) => Math.max(0, x),
  spitzen: (x) => Math.max(0, Math.min(1, x)) ** 8,
  stufen: (x) => Math.round(Math.max(-1, Math.min(1, x)) * 4) / 4,
  obertoene: (x) => {
    const y = Math.max(-1, Math.min(1, x));
    return 0.5 * (2 * y * y - 1) + 0.5 * (4 * y * y * y - 3 * y);
  },
};
const shaper = {
  titel: "Shaper",
  gruppe: "Bearbeiten",
  baue(ctx, { bild }) {
    const ein = verstaerker(ctx, 1), form = ctx.createWaveShaper(), nass = verstaerker(ctx, 1), trocken = verstaerker(ctx, 0), aus = verstaerker(ctx, 1);
    form.oversample = "4x";
    ein.connect(form).connect(nass).connect(aus);
    ein.connect(trocken).connect(aus);
    const w = { art: "weich", antrieb: 2, schief: 0 };
    const N = 33;
    let punkte = Array.from({ length: N }, (_, i) => (i / (N - 1)) * 2 - 1), modulRef = null; // eigene: am Anfang die Diagonale
    const eigene = (u) => {
      const x = ((Math.max(-1, Math.min(1, u)) + 1) / 2) * (N - 1), j = Math.min(N - 2, Math.floor(x)), r = x - j;
      return punkte[j] + (punkte[j + 1] - punkte[j]) * r;
    };
    const neu = () => {
      // die Kennlinie gilt für Eingänge von −1 bis 1; Antrieb und Schief sind hineingerechnet
      const n = 4096, c = new Float32Array(n), f = w.art === "eigene" ? eigene : KENNLINIEN[w.art];
      // eigene: genau die gemalte Linie; der Antrieb ist dann eine Verstärkung davor (über ±1 bleibt die Linie am Rand)
      const eigen = w.art === "eigene", treiben = eigen ? 1 : w.antrieb;
      ein.gain.setTargetAtTime(eigen ? w.antrieb : 1, ctx.currentTime, 0.01);
      for (let i = 0; i < n; i++) c[i] = f(((i / (n - 1)) * 2 - 1) * treiben + w.schief);
      form.curve = c;
    };
    // Bild: die Kennlinie, waagrecht der Eingang −1 … 1, senkrecht was herauskommt (die Diagonale wäre „unverändert“)
    const bildchen = linienBild(bild, () => (form.curve ? Array.from({ length: 128 }, (_, i) => form.curve[Math.round((i / 127) * (form.curve.length - 1))]) : [0, 0]), { unten: -1.1, oben: 1.1 });
    // Malen: waagrecht ist der Eingang, senkrecht der Ausgang (wie im Bild). Ein Punkt der Leinwand trifft die
    // Stelle u = Eingang + Schief der Kennlinie; dort wird der Stützpunkt gesetzt.
    const male = (c, ev, vorher) => {
      const r = c.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, yPx = ((ev.clientY - r.top) / r.height) * c.height;
      const y = Math.max(-1, Math.min(1, 1.1 - ((yPx - 4) / (c.height - 8)) * 2.2)); // Umkehrung von linienBild (unten −1,1, oben 1,1)
      const u = x * 2 - 1 + w.schief;
      const j = Math.round(((Math.max(-1, Math.min(1, u)) + 1) / 2) * (N - 1));
      // zwischen dem letzten und diesem Punkt auffüllen, damit schnelles Ziehen keine Lücken lässt
      const von = vorher ?? j;
      for (let k = Math.min(von.j ?? j, j); k <= Math.max(von.j ?? j, j); k++) {
        const t = (von.j ?? j) === j ? 1 : (k - von.j) / (j - von.j);
        punkte[k] = von.y === undefined ? y : von.y + (y - von.y) * t;
      }
      return { j, y };
    };
    const umstellen = () => {
      if (w.art === "eigene") return;
      // die gerade gezeigte Kennlinie übernehmen (ohne Antrieb), dann darauf malen
      const f = KENNLINIEN[w.art];
      punkte = Array.from({ length: N }, (_, i) => Math.max(-1, Math.min(1, f((i / (N - 1)) * 2 - 1))));
      w.art = "eigene";
      const s = modulRef?.el.querySelector('select[data-wahl="art"]');
      if (s) s.value = "eigene";
      if (modulRef) modulRef.werte.art = "eigene";
    };
    return {
      extra: (el, modul) => {
        modulRef = modul;
        if (Array.isArray(modul.werte.punkte) && modul.werte.punkte.length === N) {
          punkte = modul.werte.punkte.slice();
          if (w.art === "eigene") neu();
        }
        bildchen.extra(el);
        const c = el.querySelector("canvas");
        if (!c) return;
        c.classList.add("malbar");
        c.title = "malen: ziehen (eigene Kennlinie)";
        let zug = null;
        c.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          try { c.setPointerCapture(ev.pointerId); } catch {}
          umstellen();
          zug = male(c, ev, null);
          neu();
        });
        c.addEventListener("pointermove", (ev) => {
          if (!zug) return;
          zug = male(c, ev, zug);
          neu();
        });
        const los = () => {
          if (!zug) return;
          zug = null;
          modul.werte.punkte = punkte.map((v) => Math.round(v * 1000) / 1000);
          c.dispatchEvent(new Event("change", { bubbles: true }));
        };
        c.addEventListener("pointerup", los);
        c.addEventListener("pointercancel", los);
      },
      weg: () => bildchen.weg(),
      ein: { ein: { art: "ton", ziel: ein } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "antrieb", text: "Antrieb", ...log(0.2, 40), wert: 2, setze: (v) => { w.antrieb = v; neu(); } },
        { name: "schief", text: "Schief", min: -1, max: 1, wert: 0, setze: (v) => { w.schief = v; neu(); } },
        { name: "nass", text: "Mix", min: 0, max: 1.5, wert: 1, setze: (v) => nass.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        { name: "trocken", text: "trocken", min: 0, max: 1, wert: 0, setze: (v) => trocken.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [{ name: "art", text: "Kennlinie", optionen: [["weich", "weich (tanh)"], ["hart", "hart"], ["falten", "falten"], ["betrag", "Betrag"], ["halb", "halb"], ["spitzen", "Spitzen"], ["stufen", "Stufen"], ["obertoene", "Obertöne (T₂ + T₃)"], ["eigene", "eigene (malen)"]], wert: "weich", setze: (v) => { w.art = v; neu(); } }],
    };
  },
};

// ---------- Pling ----------
const pling = {
  titel: "Pling",
  gruppe: "Klang",
  baue(ctx) {
    const k = new AudioWorkletNode(ctx, "pling", { numberOfInputs: 1, outputChannelCount: [2] });
    const p = (n) => k.parameters.get(n);
    const tonhoehe = verstaerker(ctx, 1);
    tonhoehe.connect(k);
    const setze = (n) => (v) => p(n).setValueAtTime(v, ctx.currentTime);
    return {
      ein: {
        Takt: { art: "takt", ziel: (t, d, anschlag) => k.port.postMessage({ zeit: t, anschlag }) },
        "Tonhöhe": { art: "ton", ziel: tonhoehe },
        // Runde 29: Noten direkt (jede Note ein Anschlag auf ihrer Höhe, die Frequenz gilt für C4): Akkorde gehen
        Noten: { art: "noten", ziel: Object.assign((t, n, vel = 0.8) => k.port.postMessage({ zeit: t, anschlag: vel, ton: n }), { aus: () => {}, alleAus: () => {} }) },
      },
      aus: { aus: { art: "ton", knoten: k } },
      regler: [
        { name: "frequenz", text: "Frequenz", ...log(30, 12000), wert: 1000, einheit: "Hz", setze: setze("frequenz") },
        { name: "abklingen", text: "Abklingen", ...log(0.001, 8), wert: 0.1, einheit: "s", setze: setze("abklingen") },
        { name: "steigen", text: "Steigen", min: -1, max: 1, wert: 0, setze: setze("steigen") },
        { name: "breite", text: "Breite", min: 0, max: 1, wert: 0.5, setze: setze("breite") },
        { name: "laut", text: "Pegel", min: 0, max: 1, wert: 0.3, setze: setze("laut") },
      ],
      wahl: [{ name: "wasser", text: "Abklingen", optionen: [["0", "fest"], ["1", "wie Wasser (aus der Höhe)"]], wert: "0", setze: (v) => p("wasser").setValueAtTime(Number(v), ctx.currentTime) }],
    };
  },
};

export const BAUKASTEN_MODULE = { salve, kurve, shaper, pling };
