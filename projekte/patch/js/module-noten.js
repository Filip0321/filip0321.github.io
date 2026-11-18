// Noten-Module (Runde 21): alles für Akkorde und mehrstimmiges Spiel.
//
// Bisher trug ein Kabel EINE Tonhöhe (eine Spannung, wie im echten Modularsystem); ein Akkord brauchte drei
// Oszillatoren, drei Hüllkurven und drei Kabel. Ein Noten-Kabel (takt.js, Klasse Noten) trägt stattdessen
// Nachrichten wie MIDI: „Note 64 an, Anschlag 0,8, Dauer 0,4 s“. Wer zuhört, verteilt sie selbst auf seine Stimmen.
//
//   Tastatur     Computertastatur (wie Ableton), Tasten am Bildschirm und MIDI-Keyboard → Noten
//   Pianoroll    Noten zeichnen: Länge, Anschlag, mehrere gleichzeitig
//   Akkorde      Akkordfolge in einer Tonart (I–V–vi–IV …), mit Stimmführung, Arpeggio, Bass
//   Stimmen      ein mehrstimmiger Synthesizer: bis zu 8 Stimmen, je zwei Oszillatoren, Filter, Hüllkurve
//   Noten → Ton  für die alten Module: eine Tonhöhe (1,0 pro Oktave), ein Takt, Gate und Anschlag
//
// Notennummern wie MIDI: 60 = C4 (das mittlere C), 69 = A4 = 440 Hz, Frequenz = 440 · 2^((n − 69) / 12).

import { Takt, Noten } from "./takt.js";
import { log, konstante, verstaerker, filter, LEITERN, LEITER_WAHL, GRUNDTOENE } from "./bausteine.js";
import { huellkurvenBild } from "./anzeigen.js";
import { neueRolle, wuerfle, RASTER } from "./rolle.js";

const NAMEN = ["C", "Cis", "D", "Es", "E", "F", "Fis", "G", "As", "A", "B", "H"];
export const notenName = (n) => `${NAMEN[((Math.round(n) % 12) + 12) % 12]}${Math.floor(Math.round(n) / 12) - 1}`;
const frequenz = (n) => 440 * 2 ** ((n - 69) / 12);
const SCHWARZ = new Set([1, 3, 6, 8, 10]);
const imFeld = (ev) => ev.target.closest?.("input:not([type=range]), select, textarea, [contenteditable]");
// ein Bild bzw. eine Liste ändert sich: main.js speichert bei „change“ auf der Wand
const geaendert = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));

// ---------- Tastatur ----------
// Belegung wie in Ableton („Computer MIDI Keyboard“): die mittlere Buchstabenreihe sind die weißen Tasten
// (A = C, S = D, D = E …), die Reihe darüber die schwarzen (W = Cis, E = Es, T = Fis …). Gelesen wird ev.code,
// die LAGE der Taste, nicht ihr Aufdruck: auf deutschen Tastaturen liegt Z dort, wo im Englischen Y liegt (As),
// und Y (unten links) dort, wo Z liegt. So passt es auf jeder Tastatur.
// Oktave: Y und X (unten links), Anschlag: C und V. Wie bei MIDI: Taste runter = Note an, Taste los = Note aus.
const TASTEN = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

const tastatur = {
  titel: "Tastatur",
  gruppe: "Noten",
  // mehrere Tastaturen dürfen sein: alle hören auf dieselben Tasten, so lassen sich Instrumente schichten
  baue(ctx, { melde }) {
    const noten = new Noten(), takt = new Takt();
    const ton = konstante(ctx, 0), gate = konstante(ctx, 0), anschlag = konstante(ctx, 0);
    const w = { oktave: 0, anschlag: 0.8, midi: "an" };
    const gehalten = []; // in der Reihenfolge des Drückens
    const vonTaste = new Map(); // ev.code → Note (damit „los“ dieselbe Note trifft, auch wenn die Oktave wechselte)
    let klaviatur = null, anzeige = null;

    const zeige = () => {
      for (const t of klaviatur?.querySelectorAll("[data-note]") ?? []) t.classList.toggle("gedrueckt", gehalten.includes(Number(t.dataset.note)));
      if (anzeige) anzeige.textContent = `${gehalten.length ? gehalten.map(notenName).join(" ") : "–"} · Oktave ${w.oktave >= 0 ? "+" : ""}${w.oktave} · Anschlag ${Math.round(w.anschlag * 127)}`;
    };
    function druecke(n, vel = w.anschlag) {
      if (gehalten.includes(n)) return;
      const t = ctx.currentTime + 0.005;
      gehalten.push(n);
      noten.an(t, n, vel, Infinity);
      ton.offset.setValueAtTime((n - 60) / 12, t);
      anschlag.offset.setValueAtTime(vel, t);
      gate.offset.setValueAtTime(1, t);
      takt.sende(t, Infinity);
      zeige();
    }
    function lasse(n) {
      const i = gehalten.indexOf(n);
      if (i < 0) return;
      const t = ctx.currentTime + 0.005;
      gehalten.splice(i, 1);
      noten.aus(t, n);
      // einstimmig (Tonhöhe, Takt): zurück zur vorigen gehaltenen Taste, ohne neuen Anschlag
      if (gehalten.length) ton.offset.setValueAtTime((gehalten.at(-1) - 60) / 12, t);
      else {
        gate.offset.setValueAtTime(0, t);
        takt.loslassen(t);
      }
      zeige();
    }
    const alleLos = () => [...gehalten].forEach(lasse);

    const runter = (ev) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || imFeld(ev) || document.getElementById("modulsuche")) return;
      if (ev.code === "KeyZ" || ev.code === "KeyX") {
        // KeyZ ist die Lage von Y auf deutschen Tastaturen (unten links)
        w.oktave = Math.max(-4, Math.min(4, w.oktave + (ev.code === "KeyX" ? 1 : -1)));
        baueKlaviatur();
      } else if (ev.code === "KeyC" || ev.code === "KeyV") {
        w.anschlag = Math.max(0.05, Math.min(1, w.anschlag + (ev.code === "KeyV" ? 0.15 : -0.15)));
      } else if (ev.code in TASTEN) {
        const n = 60 + 12 * w.oktave + TASTEN[ev.code];
        vonTaste.set(ev.code, n);
        druecke(n);
      } else return;
      ev.preventDefault();
      zeige();
    };
    const hoch = (ev) => {
      const n = vonTaste.get(ev.code);
      if (n === undefined) return;
      vonTaste.delete(ev.code);
      lasse(n);
    };
    window.addEventListener("keydown", runter);
    window.addEventListener("keyup", hoch);
    window.addEventListener("blur", alleLos); // Fenster verlassen: sonst hinge eine Note für immer

    // MIDI: Noten von jedem angeschlossenen Keyboard (mehrstimmig). addEventListener statt onmidimessage, damit
    // der MIDI-Eingang daneben weiter funktioniert.
    let geraete = [];
    const midiNachricht = (ev) => {
      if (w.midi !== "an") return;
      const [status, a = 0, b = 0] = ev.data, art = status & 0xf0;
      if ((status & 0x0f) === 9) return; // Kanal 10: Pads (Trommeln), die gehören dem MIDI-Eingang
      if (art === 0x90 && b > 0) druecke(a, b / 127);
      else if (art === 0x80 || (art === 0x90 && b === 0)) lasse(a);
    };
    navigator.requestMIDIAccess?.().then((z) => {
      const verbinde = () => {
        for (const e of geraete) e.removeEventListener("midimessage", midiNachricht);
        geraete = [...z.inputs.values()];
        for (const e of geraete) e.addEventListener("midimessage", midiNachricht);
      };
      z.addEventListener("statechange", verbinde);
      verbinde();
    }).catch(() => {});

    // Tasten am Bildschirm: zwei Oktaven ab der eingestellten. Ziehen über die Tasten spielt sie nacheinander.
    function baueKlaviatur() {
      if (!klaviatur) return;
      alleLos();
      klaviatur.replaceChildren();
      const start = 60 + 12 * w.oktave, weisse = [];
      for (let n = start; n < start + 25; n++) if (!SCHWARZ.has(n % 12)) weisse.push(n);
      const breite = 100 / weisse.length;
      weisse.forEach((n) => {
        const t = document.createElement("div");
        t.className = "weiss";
        t.dataset.note = n;
        if (n % 12 === 0) {
          const s = document.createElement("span");
          s.textContent = notenName(n);
          t.style.position = "relative";
          t.append(s);
        }
        klaviatur.append(t);
      });
      for (let n = start; n < start + 25; n++) {
        if (!SCHWARZ.has(n % 12)) continue;
        const links = weisse.filter((x) => x < n).length; // so viele weiße liegen links davon
        const t = document.createElement("div");
        t.className = "schwarz";
        t.dataset.note = n;
        t.style.left = `${(links - 0.3) * breite}%`;
        t.style.width = `${breite * 0.6}%`;
        klaviatur.append(t);
      }
      zeige();
    }
    let zeiger = null, zeigerNote = null;
    const unterZeiger = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-note]");
    const klavierBewegung = (ev) => {
      if (zeiger !== ev.pointerId) return;
      const t = unterZeiger(ev), n = t && klaviatur.contains(t) ? Number(t.dataset.note) : null;
      if (n === zeigerNote) return;
      if (zeigerNote !== null) lasse(zeigerNote);
      zeigerNote = n;
      // Anschlag aus der Höhe: weiter unten auf der Taste = fester (wie beim echten Klavier, wo man tiefer greift)
      if (n !== null) {
        const r = t.getBoundingClientRect();
        druecke(n, Math.max(0.2, Math.min(1, (ev.clientY - r.top) / r.height)));
      }
    };
    const klavierLos = (ev) => {
      if (zeiger !== ev.pointerId) return;
      if (zeigerNote !== null) lasse(zeigerNote);
      zeiger = zeigerNote = null;
    };

    return {
      ein: {},
      aus: {
        Noten: { art: "noten", knoten: noten },
        "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt },
        Gate: { art: "ton", knoten: gate }, Anschlag: { art: "ton", knoten: anschlag },
      },
      regler: [],
      wahl: [{ name: "midi", text: "MIDI-Keyboard", optionen: [["an", "spielt mit"], ["aus", "nicht"]], wert: "an", setze: (v) => (w.midi = v) }],
      extra: (el) => {
        klaviatur = document.createElement("div");
        klaviatur.className = "klaviatur";
        klaviatur.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          zeiger = ev.pointerId;
          klaviatur.setPointerCapture(ev.pointerId);
          klavierBewegung(ev);
        });
        klaviatur.addEventListener("pointermove", klavierBewegung);
        klaviatur.addEventListener("pointerup", klavierLos);
        klaviatur.addEventListener("pointercancel", klavierLos);
        anzeige = document.createElement("p");
        anzeige.className = "hinweis";
        el.append(klaviatur, anzeige);
        baueKlaviatur();
      },
      weg: () => {
        alleLos();
        window.removeEventListener("keydown", runter);
        window.removeEventListener("keyup", hoch);
        window.removeEventListener("blur", alleLos);
        for (const e of geraete) e.removeEventListener("midimessage", midiNachricht);
        [ton, gate, anschlag].forEach((k) => k.stop());
      },
    };
  },
};

// ---------- Stimmen ----------
// Ein mehrstimmiger Synthesizer. Jede Stimme: zwei Oszillatoren (gegeneinander verstimmt, „Breite“: die kleine
// Verstimmung lässt sie langsam gegeneinander schweben, das klingt breit wie ein Chor), ein Tiefpass, ein Verstärker.
// Eine Note sucht sich eine freie Stimme; sind alle belegt, wird die älteste genommen („voice stealing“).
//
// Hüllkurven nur mit setTargetAtTime (exponentiell auf ein Ziel zu, Zeitkonstante τ, nach 3τ 95 %): eine neue
// Etappe fängt dort an, wo die alte gerade ist. So knackt nichts, wenn eine klingende Stimme neu angeschlagen wird,
// und es geht auch in Firefox (dort fehlt cancelAndHoldAtTime, mit dem man sonst „anhalten, wo es gerade ist“ sagt).
// Filter-Hüllkurve: die Grenzfrequenz springt beim Anschlag um „Filter-Hk“ Oktaven nach oben (mehr bei festem
// Anschlag) und fällt mit Decay auf Grenze · 2^(Hk · Sustain). Hell beim Anschlag, dann weicher: wie fast jedes
// echte Instrument (eine angeschlagene Saite verliert die Obertöne zuerst).
const MAX_STIMMEN = 8;
const stimmen = {
  titel: "Stimmen",
  gruppe: "Noten",
  baue(ctx, { bild }) {
    const summe = verstaerker(ctx, 0.25);
    const tonhoeheEin = verstaerker(ctx, 1200); // Kabel 1,0 → eine Oktave (Cent), an alle Oszillatoren
    const grenzeEin = verstaerker(ctx, 1200); // Kabel 1,0 → Grenze eine Oktave höher, an alle Filter
    const modell = konstante(ctx, 0); // die Hüllkurve der zuletzt angeschlagenen Stimme (0 … 1): Anzeige und Ausgang
    const w = { a: 0.01, d: 0.4, s: 0.6, r: 0.5, breite: 12, grenze: 1800, reso: 1, fhk: 2, anschlagFilter: 0.5, anzahl: 6, oktave: 0, glide: 0, form: "sawtooth", form2: "sawtooth", mix: 0.5 };
    const anzeige = huellkurvenBild(ctx, bild, w, modell);

    const liste = Array.from({ length: MAX_STIMMEN }, () => {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      const m1 = verstaerker(ctx, 0.5), m2 = verstaerker(ctx, 0.5);
      const f = filter(ctx, "lowpass", w.grenze, w.reso);
      const vca = verstaerker(ctx, 0);
      o1.connect(m1).connect(f);
      o2.connect(m2).connect(f);
      f.connect(vca).connect(summe);
      tonhoeheEin.connect(o1.detune);
      tonhoeheEin.connect(o2.detune);
      grenzeEin.connect(f.detune);
      o1.start();
      o2.start();
      return { o1, o2, m1, m2, f, vca, ton: null, start: -1, frei: 0, gehalten: false };
    });
    const setzeAlle = () => {
      for (const v of liste) {
        v.o1.type = w.form;
        v.o2.type = w.form2;
        v.o1.detune.value = -w.breite / 2;
        v.o2.detune.value = w.breite / 2;
        v.m1.gain.value = 1 - w.mix;
        v.m2.gain.value = w.mix;
        v.f.Q.value = w.reso;
      }
    };

    const τ = (x) => Math.max(0.001, x / 3);
    function loslassen(v, t) {
      v.vca.gain.cancelScheduledValues(t);
      v.vca.gain.setTargetAtTime(0, t, τ(w.r));
      v.f.frequency.cancelScheduledValues(t);
      v.f.frequency.setTargetAtTime(w.grenze, t, τ(w.r));
      v.frei = t + w.r * 1.5;
      v.gehalten = false;
    }
    let zuletzt = null;
    const an = (t, ton, vel = 0.8, dauer = Infinity) => {
      const aktiv = liste.slice(0, w.anzahl);
      // dieselbe Note klingt noch: diese Stimme; sonst eine freie; sonst die älteste
      const v = aktiv.find((x) => x.ton === ton && x.frei > t) ?? aktiv.find((x) => x.frei <= t) ?? aktiv.reduce((a, b) => (a.start <= b.start ? a : b));
      const hz = frequenz(ton + 12 * w.oktave);
      for (const o of [v.o1, v.o2]) {
        o.frequency.cancelScheduledValues(t);
        if (w.glide > 0 && v.start >= 0) o.frequency.setTargetAtTime(hz, t, w.glide / 3);
        else o.frequency.setValueAtTime(hz, t);
      }
      const spitze = 0.15 + 0.85 * vel; // Anschlag → Lautstärke
      const g = v.vca.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(spitze, t, τ(w.a));
      g.setTargetAtTime(spitze * w.s, t + w.a, τ(w.d));
      const oktaven = w.fhk * (1 - w.anschlagFilter + w.anschlagFilter * vel);
      const fp = v.f.frequency;
      fp.cancelScheduledValues(t);
      fp.setTargetAtTime(Math.min(20000, w.grenze * 2 ** oktaven), t, τ(w.a));
      fp.setTargetAtTime(Math.min(20000, w.grenze * 2 ** (oktaven * w.s)), t + w.a, τ(w.d));
      // das Modell (Anzeige und Ausgang „Hüllkurve“) läuft genauso, nur ohne Anschlag (0 … 1)
      modell.offset.cancelScheduledValues(t);
      modell.offset.setTargetAtTime(1, t, τ(w.a));
      modell.offset.setTargetAtTime(w.s, t + w.a, τ(w.d));
      anzeige.angeschlagen(t, dauer);
      Object.assign(v, { ton, start: t, frei: Infinity, gehalten: true });
      zuletzt = v;
      if (Number.isFinite(dauer)) {
        const los = t + Math.max(dauer, 0.005);
        loslassen(v, los);
        modell.offset.cancelScheduledValues(los);
        modell.offset.setTargetAtTime(0, los, τ(w.r));
        v.frei = los + w.r * 1.5;
      }
    };
    an.aus = (t, ton) => {
      for (const v of liste) if (v.ton === ton && v.gehalten) {
        loslassen(v, t);
        if (v === zuletzt) {
          modell.offset.cancelScheduledValues(t);
          modell.offset.setTargetAtTime(0, t, τ(w.r));
          anzeige.losgelassen(t);
        }
      }
    };
    an.alleAus = (t) => liste.forEach((v) => v.gehalten && loslassen(v, t));

    return {
      ein: {
        Noten: { art: "noten", ziel: an },
        "Tonhöhe": { art: "ton", ziel: tonhoeheEin },
        Grenze: { art: "ton", ziel: grenzeEin },
      },
      aus: { aus: { art: "ton", knoten: summe }, "Hüllkurve": { art: "ton", knoten: modell } },
      regler: [
        { name: "a", text: "Attack", ...log(0.001, 4), wert: 0.01, einheit: "s", setze: (v) => (w.a = v) },
        { name: "d", text: "Decay", ...log(0.01, 6), wert: 0.4, einheit: "s", setze: (v) => (w.d = v) },
        { name: "s", text: "Sustain", min: 0, max: 1, wert: 0.6, setze: (v) => (w.s = v) },
        { name: "r", text: "Release", ...log(0.01, 8), wert: 0.5, einheit: "s", setze: (v) => (w.r = v) },
        { name: "grenze", text: "Grenze", ...log(60, 16000), wert: 1800, einheit: "Hz", setze: (v) => (w.grenze = v) },
        { name: "reso", text: "Resonanz", ...log(0.5, 18), wert: 1, setze: (v) => { w.reso = v; setzeAlle(); } },
        { name: "fhk", text: "Filter-Hk", min: 0, max: 5, wert: 2, einheit: "Okt", setze: (v) => (w.fhk = v) },
        { name: "anschlagFilter", text: "F-Anschlag", min: 0, max: 1, wert: 0.5, setze: (v) => (w.anschlagFilter = v) },
        { name: "breite", text: "Breite", min: 0, max: 50, wert: 12, einheit: "Cent", setze: (v) => { w.breite = v; setzeAlle(); } },
        { name: "mix", text: "Osz 2", min: 0, max: 1, wert: 0.5, setze: (v) => { w.mix = v; setzeAlle(); } },
        { name: "anzahl", text: "Stimmen", min: 1, max: MAX_STIMMEN, wert: 6, schritt: 1, setze: (v) => (w.anzahl = v) },
        { name: "glide", text: "Glide", min: 0, max: 1, wert: 0, einheit: "s", setze: (v) => (w.glide = v) },
        { name: "oktave", text: "Oktave", min: -3, max: 3, wert: 0, schritt: 1, setze: (v) => (w.oktave = v) },
        { name: "pegel", text: "Pegel", min: 0, max: 1, wert: 0.25, setze: (v) => summe.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [
        { name: "form", text: "Osz 1", optionen: [["sawtooth", "Sägezahn"], ["square", "Rechteck"], ["triangle", "Dreieck"], ["sine", "Sinus"]], wert: "sawtooth", setze: (v) => { w.form = v; setzeAlle(); } },
        { name: "form2", text: "Osz 2", optionen: [["sawtooth", "Sägezahn"], ["square", "Rechteck"], ["triangle", "Dreieck"], ["sine", "Sinus"]], wert: "sawtooth", setze: (v) => { w.form2 = v; setzeAlle(); } },
      ],
      klasse: "breit",
      extra: anzeige.extra,
      weg: () => {
        for (const v of liste) {
          v.o1.stop();
          v.o2.stop();
        }
        modell.stop();
        anzeige.weg();
      },
    };
  },
};

// ---------- Noten → Ton ----------
// Für die einstimmigen Module (Oszillator, Hüllkurve, Saite …): aus vielen Noten eine Tonhöhe. Welche, wenn mehrere
// klingen? „letzte“ (wie die meisten Synthesizer), „höchste“ (Melodie über einem Akkord) oder „tiefste“ (Bass).
const notenZuTon = {
  titel: "Noten → Ton",
  gruppe: "Noten",
  baue(ctx) {
    const ton = konstante(ctx, 0), gate = konstante(ctx, 0), anschlag = konstante(ctx, 0);
    const takt = new Takt();
    const w = { vorrang: "letzte" };
    const gehalten = [];
    let gleichzeitig = { t: -1, ton: null };
    const besser = (a, b) => (w.vorrang === "hoechste" ? a > b : w.vorrang === "tiefste" ? a < b : true);
    const an = (t, n, vel = 0.8, dauer = Infinity) => {
      // Noten, die genau gleichzeitig kommen (ein Akkord): nur die nach dem Vorrang beste
      if (t === gleichzeitig.t && !besser(n, gleichzeitig.ton)) return;
      gleichzeitig = { t, ton: n };
      ton.offset.setValueAtTime((n - 60) / 12, t);
      anschlag.offset.setValueAtTime(vel, t);
      gate.offset.setValueAtTime(1, t);
      takt.sende(t, dauer);
      if (Number.isFinite(dauer)) gate.offset.setValueAtTime(0, t + dauer);
      else gehalten.push(n);
    };
    an.aus = (t, n) => {
      const i = gehalten.indexOf(n);
      if (i < 0) return;
      gehalten.splice(i, 1);
      if (gehalten.length) ton.offset.setValueAtTime((gehalten.at(-1) - 60) / 12, t);
      else {
        gate.offset.setValueAtTime(0, t);
        takt.loslassen(t);
      }
    };
    an.alleAus = (t) => [...gehalten].forEach((n) => an.aus(t, n));
    return {
      ein: { Noten: { art: "noten", ziel: an } },
      aus: { "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt }, Gate: { art: "ton", knoten: gate }, Anschlag: { art: "ton", knoten: anschlag } },
      regler: [],
      wahl: [{ name: "vorrang", text: "Vorrang", optionen: [["letzte", "letzte"], ["hoechste", "höchste"], ["tiefste", "tiefste"]], wert: "letzte", setze: (v) => (w.vorrang = v) }],
      weg: () => [ton, gate, anschlag].forEach((k) => k.stop()),
    };
  },
};

// ---------- Akkorde ----------
// Akkorde aus einer Tonleiter, wie in der Harmonielehre: auf jede Stufe (I bis VII) werden Terzen der Leiter
// geschichtet, also jeder zweite Ton: Stufe I in C-Dur = C E G, Stufe II = D F A, Stufe VI = A C E. Ob ein Akkord
// Dur oder Moll ist, folgt aus der Leiter von selbst (die Terz über dem Grundton ist 4 oder 3 Halbtöne).
// Römische Zahlen: groß = Dur, klein = Moll, ° = vermindert. Die Popfolge I–V–vi–IV in C ist C–G–Am–F.
//
// Stimmführung: von einem Akkord zum nächsten sollen sich die Stimmen möglichst wenig bewegen (das klingt
// verbunden, wie ein Chor). Dafür werden alle Umkehrungen (der unterste Ton eine Oktave nach oben) in zwei Lagen
// ausprobiert, und genommen wird die mit dem kleinsten Gesamtweg zum vorigen Akkord.
//
// Ein Takt am Eingang ist ein Schlag. Alle „Schläge“ kommt der nächste Akkord. Spielweise: zusammen beim Wechsel,
// auf jedem Schlag neu, oder als Arpeggio (ein Ton je Schlag, auf, ab, auf und ab, zufällig).
// Kommt stattdessen eine Note am Noten-Eingang, wird sie selbst zum Grundton (Begleitautomatik: eine Taste, ein Akkord).
// Zweiter Ausgang „Arpeggio“: jeder Takt am Eingang „Arp-Takt“ spielt den nächsten Ton des jetzigen Akkords (auf, ab,
// auf und ab, zufällig; über „Arp-Okt.“ Oktaven). So kommen Fläche und Arpeggio aus demselben Akkord und bleiben
// zusammen, auch wenn der Arp-Takt viel schneller ist (Sechzehntel unter Vierteln).
const ARTEN = {
  dreiklang: [0, 2, 4], sept: [0, 2, 4, 6], neun: [0, 2, 4, 6, 8], add9: [0, 2, 4, 8],
  sus2: [0, 1, 4], sus4: [0, 3, 4], quart: [0, 3, 6], quinte: [0, 4],
};
const FOLGEN = {
  pop: { text: "I–V–vi–IV (Pop)", folge: [1, 5, 6, 4], leiter: "dur" },
  pop2: { text: "vi–IV–I–V", folge: [6, 4, 1, 5], leiter: "dur" },
  fuenfziger: { text: "I–vi–IV–V (50er)", folge: [1, 6, 4, 5], leiter: "dur" },
  jazz: { text: "ii–V–I–I (Jazz)", folge: [2, 5, 1, 1], leiter: "dur" },
  kanon: { text: "Kanon (Pachelbel)", folge: [1, 5, 6, 3, 4, 1, 4, 5], leiter: "dur" },
  moll: { text: "i–VI–III–VII (Moll)", folge: [1, 6, 3, 7], leiter: "moll" },
  mollTraurig: { text: "i–iv–i–v", folge: [1, 4, 1, 5], leiter: "moll" },
  dorisch: { text: "i–IV (Dorisch, Deep House)", folge: [1, 4, 1, 4], leiter: "dorisch" },
  schwebend: { text: "I–IV–I–IV (Ambient, add9)", folge: [1, 4, 1, 4], leiter: "dur" },
};
const ROEMISCH = ["I", "II", "III", "IV", "V", "VI", "VII"];
// römische Zahl aus dem Abstand zum Grundton der Tonart (Halbtöne): so passt sie auch für Akkorde, die nicht aus der
// Leiter kommen (♭VI aus Moll in einer Dur-Tonart, ♭II als Tritonus-Ersatz)
const ROEMISCH12 = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];

// Runde 22: jedes Feld der Folge für sich. Art (leer: wie oben eingestellt) und Herkunft:
//   e  leitereigen: aus der Tonleiter wie bisher
//   g  geliehen („Modal Interchange“): dieselbe Stufe aus der gleichnamigen anderen Tonart (C-Dur borgt aus c-Moll:
//      iv = Fm, ♭VI = As, ♭VII = B, ♭III = Es). Das klingt nach Filmmusik und Beatles: ein Schatten über Dur.
//   d  Zwischendominante („V von …“): nicht die Stufe selbst, sondern der Dur-Septakkord eine Quinte über ihr. Der
//      zieht stark zu ihr hin (die Terz ist der Leitton, einen Halbton unter dem Ziel). In C: V7/vi = E7 → Am.
//   t  Tritonus-Ersatz: statt dieser Dominante die, deren Grundton einen Tritonus (6 Halbtöne) entfernt liegt. Beide
//      teilen Terz und Septime (nur vertauscht), darum lösen sie gleich auf, aber der Bass geht chromatisch abwärts:
//      in C statt G7 → C: Des7 → C. Jazz.
const HERKUNFT = [["e", "leitereigen"], ["g", "geliehen"], ["d", "V7 davon"], ["t", "Tritonus-Ersatz"]];
const DOMINANTE = { dreiklang: [0, 4, 7], sept: [0, 4, 7, 10], neun: [0, 4, 7, 10, 14], add9: [0, 4, 7, 14], sus4: [0, 5, 7, 10], sus2: [0, 2, 7, 10], quart: [0, 5, 10], quinte: [0, 7] };
const liesFeld = (x) => {
  const [stufe, art = "", her = "e"] = String(x).split(":");
  return { s: Number(stufe) || 0, art, her };
};
const schreibeFeld = (f) => (f.art || f.her !== "e" ? `${f.s}:${f.art}:${f.her}` : `${f.s}`);
function baueFeld(w, f) {
  const art = f.art || w.art;
  if (f.her === "e") return baueAkkord({ ...w, art }, f.s);
  if (f.her === "g") {
    const leiter = LEITERN[w.leiter] ?? LEITERN.dur;
    return baueAkkord({ ...w, art, leiter: leiter.includes(4) ? "moll" : "dur" }, f.s);
  }
  // Dominante zur Stufe f.s: Grundton eine Quinte über deren Grundton (bzw. ein Halbton über, als Tritonus-Ersatz)
  const ziel = baueAkkord({ ...w, art: "dreiklang" }, f.s)[0], unten = 60 + 12 * w.oktave + Number(w.grundton);
  let g = ziel + (f.her === "d" ? 7 : 1);
  while (g - unten >= 12) g -= 12;
  return (DOMINANTE[f.art] ?? DOMINANTE.sept).map((k) => g + k);
}
function feldText(w, f) {
  const noten = baueFeld(w, f), { name, moll, vermindert } = akkordName(noten);
  const tonika = 60 + 12 * w.oktave + Number(w.grundton);
  let zahl = ROEMISCH12[(((noten[0] - tonika) % 12) + 12) % 12];
  if (moll || vermindert) zahl = zahl.toLowerCase();
  if (vermindert) zahl += "°";
  if (f.her === "d" || f.her === "t") {
    const z = baueAkkord({ ...w, art: "dreiklang" }, f.s), zm = akkordName(z).moll;
    const zielZahl = ROEMISCH[f.s - 1];
    zahl = `${f.her === "d" ? "V7" : "♭II7"}/${zm ? zielZahl.toLowerCase() : zielZahl}`;
  }
  return `${zahl} ${name}`;
}

function baueAkkord(w, stufe) {
  const leiter = LEITERN[w.leiter] ?? LEITERN.dur, L = leiter.length;
  const basis = 60 + 12 * w.oktave + Number(w.grundton);
  const d = stufe - 1;
  return ARTEN[w.art].map((k) => basis + leiter[(d + k) % L] + 12 * Math.floor((d + k) / L));
}
function akkordName(noten) {
  const g = noten[0], iv = new Set(noten.map((n) => (((n - g) % 12) + 12) % 12));
  const moll = iv.has(3) && !iv.has(4), vermindert = moll && iv.has(6) && !iv.has(7), uebermaessig = iv.has(4) && iv.has(8) && !iv.has(7);
  let name = NAMEN[((g % 12) + 12) % 12];
  if (vermindert) {
    name += iv.has(10) ? "m7♭5" : "°";
  } else {
    if (moll) name += "m";
    if (uebermaessig) name += "+";
    if (!iv.has(3) && !iv.has(4)) name += iv.has(5) ? "sus4" : iv.has(2) ? "sus2" : "5";
    if (iv.has(11)) name += "maj7";
    else if (iv.has(10)) name += "7";
    if (iv.has(2) && (iv.has(3) || iv.has(4))) name += iv.has(10) || iv.has(11) ? "/9" : "add9";
  }
  return { name, moll, vermindert };
}
// Lage: eng (Grundstellung, dann „Umkehrung“-mal den untersten Ton nach oben), weit (Drop 2: der zweithöchste Ton
// eine Oktave tiefer, so liegen die Töne auseinander wie bei Streichern), Stimmführung (siehe oben)
function lege(noten, w, vorher) {
  let n = [...noten];
  if (w.lage === "eng" || (w.lage === "fuehrung" && !vorher)) {
    for (let k = 0; k < w.umkehrung % n.length; k++) n = [...n.slice(1), n[0] + 12];
    return n;
  }
  if (w.lage === "weit") {
    if (n.length >= 3) n[n.length - 2] -= 12;
    return n.sort((a, b) => a - b);
  }
  let best = n, bestWeg = Infinity;
  const mitte = vorher.reduce((s, x) => s + x, 0) / vorher.length;
  for (let u = 0; u < n.length; u++) {
    let m = [...noten];
    for (let k = 0; k < u; k++) m = [...m.slice(1), m[0] + 12];
    for (const verschieb of [-12, 0, 12]) {
      const kand = m.map((x) => x + verschieb);
      // Weg: jeder Ton zum nächsten Ton des vorigen Akkords, dazu ein kleiner Zug zur Mitte (sonst wandert es davon)
      const weg = kand.reduce((s, x) => s + Math.min(...vorher.map((y) => Math.abs(x - y))), 0)
        + 0.3 * Math.abs(kand.reduce((s, x) => s + x, 0) / kand.length - (60 + 12 * w.oktave + 7))
        + 0.05 * Math.abs(mitte - kand.reduce((s, x) => s + x, 0) / kand.length);
      if (weg < bestWeg) [best, bestWeg] = [kand, weg];
    }
  }
  return best;
}

const akkorde = {
  titel: "Akkorde",
  gruppe: "Noten",
  baue(ctx) {
    const noten = new Noten(), bass = new Noten(), wechsel = new Takt(), arp = new Noten();
    const grundton = konstante(ctx, 0);
    const w = { grundton: "0", leiter: "dur", art: "dreiklang", lage: "fuehrung", umkehrung: 0, oktave: 0, schlaege: 4, spielweise: "zusammen", laenge: 0.9, anschlag: 0.7, bassOktave: -2, arp: "auf", arpOktaven: 2 };
    let arpNr = 0, arpAbstand = 0.125, arpLetzter = -1;
    let folge = [1, 5, 6, 4, 0, 0, 0, 0].map(liesFeld), platz = -1, schlag = 0, akkord = null, vorher = null, abstand = 0.5, letzterSchlag = -1;
    let felder = [], modulRef = null;

    const naechsterPlatz = () => {
      for (let k = 1; k <= 8; k++) {
        const i = (platz + k) % 8;
        if (folge[i].s) return i;
      }
      return -1;
    };
    const dauerAkkord = () => abstand * w.schlaege;
    function spiele(t, liste, dauer, vel = w.anschlag) {
      for (const n of liste) noten.an(t, n, vel, dauer);
    }
    function wechsle(t, feld, i) {
      const roh = baueFeld(w, feld), g = roh[0]; // Grundton des Akkords (vor dem Umlegen)
      akkord = lege(roh, w, vorher);
      vorher = akkord;
      platz = i;
      grundton.offset.setValueAtTime((g - 60) / 12, t);
      bass.an(t, g + 12 * w.bassOktave, w.anschlag, dauerAkkord() * w.laenge);
      wechsel.sende(t, dauerAkkord() * w.laenge);
      arpNr = 0;
      setTimeout(zeigeJetzt, Math.max(0, (t - ctx.currentTime) * 1000));
    }
    const ARP = { auf: (a) => a, ab: (a) => [...a].reverse(), aufab: (a) => [...a, ...[...a].reverse().slice(1, -1)] };
    const schlagKommt = (t, d) => {
      if (letzterSchlag >= 0 && t - letzterSchlag > 0.02 && t - letzterSchlag < 4) abstand = t - letzterSchlag;
      letzterSchlag = t;
      const neu = schlag % w.schlaege === 0;
      schlag++;
      if (neu) {
        const i = naechsterPlatz();
        if (i < 0) return;
        wechsle(t, folge[i], i);
      }
      if (!akkord) return;
      const s = (schlag - 1) % w.schlaege;
      if (w.spielweise === "zusammen") {
        if (neu) spiele(t, akkord, dauerAkkord() * w.laenge);
      } else if (w.spielweise === "schlag") spiele(t, akkord, abstand * w.laenge, w.anschlag * (s === 0 ? 1 : 0.8));
      else {
        const reihe = w.spielweise === "zufall" ? [akkord[Math.floor(Math.random() * akkord.length)]] : [ARP[w.spielweise](akkord)[s % ARP[w.spielweise](akkord).length]];
        spiele(t, reihe, abstand * w.laenge);
      }
    };
    // Begleitautomatik: eine Note am Eingang wird zum Grundton eines Akkords (Art und Lage wie eingestellt).
    // Gesucht wird die Stufe der Leiter, deren Ton der Note am nächsten liegt; liegt sie dazwischen, wird gerundet.
    const notenEin = (t, n, vel, dauer) => {
      const leiter = LEITERN[w.leiter] ?? LEITERN.dur, rel = (((n - Number(w.grundton)) % 12) + 12) % 12;
      let stufe = 1, best = 99;
      leiter.forEach((x, i) => Math.abs(x - rel) < best && ((best = Math.abs(x - rel)), (stufe = i + 1)));
      const a = lege(baueAkkord({ ...w, oktave: Math.floor((n - 60) / 12) }, stufe), w, vorher);
      vorher = a;
      for (const x of a) noten.an(t, x, vel, dauer);
      notenEin.klingt.set(n, a);
    };
    notenEin.klingt = new Map();
    notenEin.aus = (t, n) => {
      for (const x of notenEin.klingt.get(n) ?? []) noten.aus(t, x);
      notenEin.klingt.delete(n);
    };
    const arpTakt = (t) => {
      if (arpLetzter >= 0 && t - arpLetzter > 0.01 && t - arpLetzter < 2) arpAbstand = t - arpLetzter;
      arpLetzter = t;
      if (!akkord) return;
      // der Akkord über mehrere Oktaven ausgebreitet, dann im Muster gelesen
      const breit = [];
      for (let o = 0; o < w.arpOktaven; o++) for (const n of akkord) breit.push(n + 12 * o);
      const reihe = w.arp === "zufall" ? breit : ARP[w.arp](breit);
      const n = w.arp === "zufall" ? breit[Math.floor(Math.random() * breit.length)] : reihe[arpNr % reihe.length];
      arpNr++;
      arp.an(t, n, w.anschlag * (0.8 + 0.2 * Math.random()), arpAbstand * w.laenge);
    };
    const neustart = (t) => {
      schlag = 0;
      platz = -1;
    };

    function zeigeJetzt() {
      felder.forEach((f, i) => f.classList.toggle("jetzt", i === platz));
    }
    function beschrifte() {
      felder.forEach((f, i) => {
        const feld = folge[i], [ss, as, hs] = f.querySelectorAll("select");
        ss.value = String(feld.s);
        as.value = feld.art;
        hs.value = feld.her;
        f.querySelector("span").textContent = feld.s ? feldText(w, feld) : " ";
      });
    }
    const merkeFolge = () => {
      if (modulRef) modulRef.werte.folge = folge.map(schreibeFeld).join(",");
    };

    return {
      ein: {
        Takt: { art: "takt", ziel: schlagKommt },
        Noten: { art: "noten", ziel: notenEin },
        "Arp-Takt": { art: "takt", ziel: arpTakt },
        Neustart: { art: "takt", ziel: neustart },
      },
      aus: {
        Noten: { art: "noten", knoten: noten }, Arpeggio: { art: "noten", knoten: arp }, Bass: { art: "noten", knoten: bass },
        Grundton: { art: "ton", knoten: grundton }, Wechsel: { art: "takt", knoten: wechsel },
      },
      regler: [
        { name: "oktave", text: "Oktave", min: -2, max: 2, wert: 0, schritt: 1, setze: (v) => { w.oktave = v; vorher = null; beschrifte(); } },
        { name: "umkehrung", text: "Umkehrung", min: 0, max: 3, wert: 0, schritt: 1, setze: (v) => (w.umkehrung = v) },
        { name: "laenge", text: "Länge", min: 0.05, max: 1, wert: 0.9, setze: (v) => (w.laenge = v) },
        { name: "anschlag", text: "Anschlag", min: 0.05, max: 1, wert: 0.7, setze: (v) => (w.anschlag = v) },
        { name: "bassOktave", text: "Bass-Okt.", min: -3, max: 0, wert: -2, schritt: 1, setze: (v) => (w.bassOktave = v) },
        { name: "arpOktaven", text: "Arp-Okt.", min: 1, max: 4, wert: 2, schritt: 1, setze: (v) => (w.arpOktaven = Math.round(v)) },
      ],
      wahl: [
        { name: "grundton", text: "Tonart", optionen: GRUNDTOENE, wert: "0", setze: (v) => { w.grundton = v; vorher = null; beschrifte(); } },
        { name: "leiter", text: "Leiter", optionen: LEITER_WAHL.filter(([k]) => k !== "chromatisch"), wert: "dur", setze: (v) => { w.leiter = v; vorher = null; beschrifte(); } },
        { name: "art", text: "Akkord", optionen: [["dreiklang", "Dreiklang"], ["sept", "Septakkord"], ["neun", "Nonenakkord"], ["add9", "add9"], ["sus2", "sus2"], ["sus4", "sus4"], ["quart", "Quarten"], ["quinte", "Quinte (Power)"]], wert: "dreiklang", setze: (v) => { w.art = v; vorher = null; beschrifte(); } },
        { name: "lage", text: "Lage", optionen: [["fuehrung", "Stimmführung"], ["eng", "eng"], ["weit", "weit (Drop 2)"]], wert: "fuehrung", setze: (v) => { w.lage = v; vorher = null; } },
        { name: "schlaege", text: "Schläge", optionen: [["1", "1"], ["2", "2"], ["4", "4"], ["8", "8"], ["16", "16"]], wert: "4", setze: (v) => (w.schlaege = Number(v)) },
        { name: "spielweise", text: "Spielweise", optionen: [["zusammen", "zusammen"], ["schlag", "jeden Schlag"], ["auf", "Arpeggio auf"], ["ab", "Arpeggio ab"], ["aufab", "Arpeggio auf-ab"], ["zufall", "zufällig"]], wert: "zusammen", setze: (v) => (w.spielweise = v) },
        { name: "arp", text: "Arp", optionen: [["auf", "auf"], ["ab", "ab"], ["aufab", "auf-ab"], ["zufall", "zufällig"]], wert: "auf", setze: (v) => (w.arp = v) },
      ],
      klasse: "breit",
      extra: (el, modul) => {
        modulRef = modul;
        if (modul.werte.folge) folge = modul.werte.folge.split(",").concat(["0", "0", "0", "0", "0", "0", "0", "0"]).slice(0, 8).map(liesFeld);
        const vorlage = document.createElement("label");
        vorlage.append("Folge ");
        const vs = document.createElement("select");
        vs.append(new Option("Vorlage …", ""));
        for (const [k, f] of Object.entries(FOLGEN)) vs.append(new Option(f.text, k));
        vs.addEventListener("change", () => {
          const f = FOLGEN[vs.value];
          vs.value = "";
          if (!f) return;
          folge = [...f.folge, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 8).map(liesFeld);
          // die Leiter gehört zur Folge (eine Moll-Folge in Dur klingt anders): die Auswahl oben umstellen
          const ls = modul.el.querySelector('select[data-wahl="leiter"]');
          if (ls && ls.value !== f.leiter) {
            ls.value = f.leiter;
            ls.dispatchEvent(new Event("change", { bubbles: true }));
          }
          if (FOLGEN.schwebend === f) {
            const as = modul.el.querySelector('select[data-wahl="art"]');
            as.value = "add9";
            as.dispatchEvent(new Event("change", { bubbles: true }));
          }
          merkeFolge();
          beschrifte();
          geaendert(el);
        });
        vorlage.append(vs);
        const raster = document.createElement("div");
        raster.className = "folge";
        // je Feld drei Auswahlen: Stufe, Art (– heißt: wie oben), Herkunft
        const ARTEN_WAHL = [["", "Art wie oben"], ["dreiklang", "Dreiklang"], ["sept", "Sept"], ["neun", "None"], ["add9", "add9"], ["sus2", "sus2"], ["sus4", "sus4"], ["quart", "Quarten"], ["quinte", "Quinte"]];
        felder = folge.map((_, i) => {
          const l = document.createElement("div");
          l.className = "feld";
          const auswahl = (name, optionen, setze) => {
            const s = document.createElement("select");
            s.setAttribute("aria-label", `Akkord ${i + 1}: ${name}`);
            for (const [v, t] of optionen) s.append(new Option(t, v));
            s.addEventListener("change", () => {
              setze(s.value);
              merkeFolge();
              beschrifte();
            });
            return s;
          };
          const stufe = auswahl("Stufe", [["0", "–"], ...ROEMISCH.map((r, k) => [String(k + 1), r])], (v) => (folge[i].s = Number(v)));
          const art = auswahl("Art", ARTEN_WAHL, (v) => (folge[i].art = v));
          const her = auswahl("Herkunft", HERKUNFT, (v) => (folge[i].her = v));
          const n = document.createElement("span");
          l.append(stufe, art, her, n);
          return l;
        });
        raster.append(...felder);
        el.append(vorlage, raster);
        beschrifte();
        merkeFolge();
      },
      weg: () => grundton.stop(),
    };
  },
};

// ---------- Pianoroll ----------
// Ein Raster aus Sechzehnteln (waagrecht) und Halbtönen (senkrecht), wie in Ableton (das Feld selbst: rolle.js). Noten:
//   ziehen auf freier Fläche    neue Note, so lang wie gezogen (Anfang: so lang wie die zuletzt benutzte)
//   ziehen an einer Note        verschieben (Zeit und Höhe)
//   ziehen am rechten Rand      Länge
//   Doppelklick, Rechtsklick    löschen
//   Mausrad über einer Note     Anschlag (wie fest; die Note wird heller oder dunkler)
// Gespeichert als Liste [Schritt, Note, Länge, Anschlag] in den Werten des Moduls (also im Patch).
// Swing: jede zweite Sechzehntel kommt etwas später (bei 0,33 im Verhältnis 2 : 1, wie Triolen; MPC-Swing).
const pianoroll = {
  titel: "Pianoroll",
  gruppe: "Noten",
  baue(ctx, { uhr, bild }) {
    const noten = new Noten(), takt = new Takt();
    const ton = konstante(ctx, 0);
    const w = { tempo: 120, takte: 2, tiefste: 48, swing: 0, grundton: "0", leiter: "keine", vorhoeren: "an", raster: 1 };
    let liste = [], modulRef = null, kopf = -1, start = 0;
    const schritte = () => w.takte * 16;

    const abo = uhr.abonniere(() => w.tempo * 4, (t, nr) => {
      const s = (((nr - start) % schritte()) + schritte()) % schritte();
      const sechzehntel = 15 / w.tempo;
      const versatz = s % 2 === 1 ? w.swing * sechzehntel : 0;
      let hoechste = null;
      for (const [schritt, n, laenge, vel] of liste) {
        if (Math.floor(schritt) !== s) continue;
        noten.an(t + versatz + (schritt - s) * sechzehntel, n, vel, laenge * sechzehntel * 0.96);
        if (hoechste === null || n > hoechste[0]) hoechste = [n, laenge * sechzehntel * 0.96];
      }
      if (hoechste) {
        ton.offset.setValueAtTime((hoechste[0] - 60) / 12, t + versatz);
        takt.sende(t + versatz, hoechste[1]);
      }
      setTimeout(() => (kopf = s), Math.max(0, (t - ctx.currentTime) * 1000));
    });
    const neustart = () => {
      // der nächste Schlag ist Schritt 0
      start = Math.ceil((ctx.currentTime + 0.11 - (uhr.nullpunkt ?? 0)) / (15 / w.tempo));
    };

    // ----- Zeichnen und Bearbeiten: die Notenrolle (rolle.js, Runde 23b auch für die Clips) -----
    const speichere = () => {
      if (modulRef) modulRef.werte.noten = liste.map((x) => [...x]);
      rolle.c.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const hoere = (n, vel) => w.vorhoeren === "an" && noten.an(ctx.currentTime + 0.01, n, vel, 0.2);
    const rolle = neueRolle({
      stand: () => ({ liste, schritte: schritte(), tiefste: w.tiefste, grundton: w.grundton, leiter: w.leiter, raster: w.raster, kopf }),
      geaendert: speichere, hoere,
    });
    const zeichne = rolle.zeichne;

    return {
      ein: { Neustart: { art: "takt", ziel: (t) => setTimeout(neustart, Math.max(0, (t - ctx.currentTime) * 1000 - 50)) } },
      aus: { Noten: { art: "noten", knoten: noten }, "Tonhöhe": { art: "ton", knoten: ton }, Takt: { art: "takt", knoten: takt } },
      regler: [
        { name: "tempo", text: "Tempo", min: 40, max: 220, wert: 120, schritt: 1, einheit: "BPM", setze: (v) => (w.tempo = v) },
        { name: "tiefste", text: "Tiefste", min: 24, max: 84, wert: 48, schritt: 1, setze: (v) => (w.tiefste = Math.round(v)) },
        { name: "swing", text: "Swing", min: 0, max: 0.5, wert: 0, setze: (v) => (w.swing = v) },
      ],
      wahl: [
        { name: "takte", text: "Takte", optionen: [["1", "1"], ["2", "2"], ["4", "4"]], wert: "2", setze: (v) => (w.takte = Number(v)) },
        { name: "raster", text: "Raster", optionen: RASTER, wert: "1", setze: (v) => (w.raster = Number(v)) },
        { name: "grundton", text: "Tonart", optionen: GRUNDTOENE, wert: "0", setze: (v) => (w.grundton = v) },
        { name: "leiter", text: "Leiter zeigen", optionen: [["keine", "keine"], ...LEITER_WAHL.filter(([k]) => k !== "chromatisch")], wert: "keine", setze: (v) => (w.leiter = v) },
        { name: "vorhoeren", text: "Vorhören", optionen: [["an", "an"], ["aus", "aus"]], wert: "an", setze: (v) => (w.vorhoeren = v) },
      ],
      klasse: "breit",
      extra: (el, modul) => {
        modulRef = modul;
        liste = (modul.werte.noten ?? []).map((x) => [...x]);
        // Knöpfe: leeren, würfeln (eine Zufallsmelodie in der gezeigten Leiter, sonst Moll-Pentatonik)
        const reihe = document.createElement("div");
        reihe.className = "steuerung knopf-reihe";
        const leer = document.createElement("button"), wuerfel = document.createElement("button");
        leer.type = wuerfel.type = "button";
        leer.textContent = "leeren";
        wuerfel.textContent = "würfeln";
        leer.addEventListener("click", () => {
          liste = [];
          speichere();
        });
        wuerfel.addEventListener("click", () => {
          liste = wuerfle({ schritte: schritte(), tiefste: w.tiefste, grundton: w.grundton, leiter: w.leiter }, rolle.ZEILEN);
          speichere();
        });
        reihe.append(leer, wuerfel);
        const hilfe = document.createElement("p");
        hilfe.className = "hinweis";
        hilfe.textContent = "Ziehen: Note setzen und Länge ziehen. Note ziehen: verschieben, am rechten Rand: Länge. Doppel- oder Rechtsklick: löschen. Mausrad: Anschlag.";
        el.append(rolle.c, reihe, hilfe);
        bild.add(zeichne);
      },
      weg: () => {
        abo();
        bild.delete(zeichne);
        ton.stop();
      },
    };
  },
};

// ---------- Verteiler (Runde 23) ----------
// Mehrstimmig aus einfachen Modulen: der Verteiler nimmt Noten und gibt jede an eine von vier Stimmen weiter, je Stimme
// eine Tonhöhe (1,0 pro Oktave, 0 = C4) und ein Takt (gehalten bis zum Loslassen, wie eine Taste). Hinter jeder Stimme
// steckt dann eine eigene Kette (Oszillator, Hüllkurve, Verstärker): so sieht man, was „4 Stimmen Polyphonie“ heißt.
// Welche Stimme? Eine freie (die am längsten frei ist, damit der Release der letzten ausklingen kann); sind alle
// belegt, die älteste (voice stealing). Dieselbe Note noch einmal: dieselbe Stimme.
const verteiler = {
  titel: "Verteiler",
  gruppe: "Noten",
  baue(ctx) {
    const N = 4;
    const stimmen = Array.from({ length: N }, () => ({ ton: konstante(ctx, 0), takt: new Takt(), anschlag: konstante(ctx, 0), note: null, seit: -1, frei: 0 }));
    const an = (t, n, vel = 0.8, dauer = Infinity) => {
      const s = stimmen.find((x) => x.note === n) ?? [...stimmen].filter((x) => x.note === null).sort((a, b) => a.frei - b.frei)[0] ?? [...stimmen].sort((a, b) => a.seit - b.seit)[0];
      s.note = n;
      s.seit = t;
      s.ton.offset.setValueAtTime((n - 60) / 12, t);
      s.anschlag.offset.setValueAtTime(vel, t);
      s.takt.sende(t, dauer);
      if (Number.isFinite(dauer)) {
        s.note = null;
        s.frei = t + dauer;
      }
    };
    an.aus = (t, n) => {
      for (const s of stimmen) if (s.note === n) {
        s.takt.loslassen(t);
        s.note = null;
        s.frei = t;
      }
    };
    an.alleAus = (t) => stimmen.forEach((s) => s.note !== null && an.aus(t, s.note));
    const aus = {};
    stimmen.forEach((s, i) => {
      aus[`Ton ${i + 1}`] = { art: "ton", knoten: s.ton, info: `Tonhöhe der Stimme ${i + 1}: 1,0 pro Oktave, 0 = C4` };
      aus[`Takt ${i + 1}`] = { art: "takt", knoten: s.takt, info: `Anschlag der Stimme ${i + 1}, gehalten bis die Taste losgeht` };
      aus[`Anschlag ${i + 1}`] = { art: "ton", knoten: s.anschlag, info: "wie fest (0 … 1)" };
    });
    return {
      ein: { Noten: { art: "noten", ziel: an } },
      aus,
      regler: [],
      weg: () => stimmen.forEach((s) => (s.ton.stop(), s.anschlag.stop())),
    };
  },
};

// ---------- Transponieren (Runde 29) ----------
// Reicht Noten weiter, um so viele Halbtöne verschoben (0 = unverändert: dann ist es ein Verteiler, der einen
// Notenstrom an viele Eingänge gibt, z. B. in der Gruppe „Schlegel“). Anschlag × Faktor.
const transponieren = {
  titel: "Transponieren",
  gruppe: "Noten",
  baue() {
    const noten = new Noten(), w = { halbtoene: 0, anschlag: 1 };
    const an = (t, n, vel = 0.8, d = Infinity) => noten.an(t, n + w.halbtoene, Math.min(1, vel * w.anschlag), d);
    an.aus = (t, n) => noten.aus(t, n + w.halbtoene);
    an.alleAus = (t) => noten.alleAus(t);
    return {
      ein: { Noten: { art: "noten", ziel: an } },
      aus: { Noten: { art: "noten", knoten: noten } },
      regler: [
        { name: "halbtoene", text: "Halbtöne", min: -24, max: 24, wert: 0, schritt: 1, setze: (v) => (w.halbtoene = Math.round(v)) },
        { name: "anschlag", text: "Anschlag ×", min: 0, max: 2, wert: 1, setze: (v) => (w.anschlag = v) },
      ],
    };
  },
};

export const NOTEN_MODULE = { tastatur, pianoroll, akkorde, stimmen, notenZuTon, verteiler, transponieren };
