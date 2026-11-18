// Werkzeug-Module (Runde 21): kleine Bausteine wie in Max/MSP oder Pure Data, aus denen man sich selbst baut,
// was fehlt. Jedes macht nur eine Sache.
//   Mathe          zwei Signale verrechnen (+ − × min max …), dann skalieren
//   Folger         wie laut ist es gerade? (Hüllkurvenfolger)
//   Schwelle       aus Ton wird Takt (wenn ein Signal eine Grenze überschreitet)
//   Zufallstakt    jeder Takt geht mit Wahrscheinlichkeit p nach A, sonst nach B (Bernoulli, wie „Branches“)
//   Zähler         zählt Takte: Teiler (jeder 2., 3., 4. …) und die Zahl als Steuerspannung
//   Ringmodulator  Ton mal Sinus: aus jeder Frequenz f werden f + t und f − t (Glocken, Roboter, Daleks)
// Runde 22 (für Natur und Landschaften, die sich nie wiederholen):
//   Zufall         eine Steuerspannung, die sich zufällig bewegt: Spaziergang, glatt oder in Stufen
//   Zufallsgeber   Takte zu zufälligen Zeiten (Poisson), von „ganz zufällig“ bis „gleichmäßig“
//   Tageslauf      eine Uhr für einen ganzen Tag in Minuten: Licht, Morgen, Abend, Nacht als Steuerspannungen
//   Notiz          ein Zettel an der Wand: erklärt, was ein Patch tut

import { Takt } from "./takt.js";
import { log, konstante, verstaerker, leser } from "./bausteine.js";
import { verlaufsBild } from "./anzeigen.js";

const mathe = {
  titel: "Mathe",
  gruppe: "Werkzeug",
  baue(ctx) {
    const k = new AudioWorkletNode(ctx, "mathe", { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
    const p = (n) => k.parameters.get(n);
    const a = verstaerker(ctx, 1), b = verstaerker(ctx, 1);
    a.connect(k, 0, 0);
    b.connect(k, 0, 1);
    const ARTEN = [["0", "A + B"], ["1", "A − B"], ["2", "A × B"], ["3", "kleiner (min)"], ["4", "größer (max)"], ["5", "|A| (Betrag)"], ["6", "A > B → 1 sonst 0"], ["7", "A ÷ B"], ["8", "Rest von A ÷ B"], ["9", "A auf Stufen B"]];
    return {
      ein: { A: { art: "ton", ziel: a }, B: { art: "ton", ziel: b } },
      aus: { aus: { art: "ton", knoten: k } },
      regler: [
        { name: "b", text: "B (fest)", min: -2, max: 2, wert: 0, setze: (v) => p("b").setTargetAtTime(v, ctx.currentTime, 0.01) },
        { name: "faktor", text: "Faktor", min: -4, max: 4, wert: 1, setze: (v) => p("faktor").setTargetAtTime(v, ctx.currentTime, 0.01) },
        { name: "versatz", text: "Versatz", min: -2, max: 2, wert: 0, setze: (v) => p("versatz").setTargetAtTime(v, ctx.currentTime, 0.01) },
      ],
      wahl: [{ name: "art", text: "Rechnung", optionen: ARTEN, wert: "0", setze: (v) => p("art").setValueAtTime(Number(v), ctx.currentTime) }],
    };
  },
};

const folger = {
  titel: "Folger",
  gruppe: "Werkzeug",
  baue(ctx) {
    const k = new AudioWorkletNode(ctx, "folger", { outputChannelCount: [1] });
    const p = (n) => k.parameters.get(n);
    return {
      ein: { ein: { art: "ton", ziel: k } },
      aus: { aus: { art: "ton", knoten: k } },
      regler: [
        { name: "attack", text: "Attack", ...log(0.0005, 0.5), wert: 0.005, einheit: "s", setze: (v) => p("attack").setValueAtTime(v, ctx.currentTime) },
        { name: "release", text: "Release", ...log(0.01, 3), wert: 0.15, einheit: "s", setze: (v) => p("release").setValueAtTime(v, ctx.currentTime) },
        { name: "verstaerkung", text: "Verstärkung", ...log(0.1, 20), wert: 2, setze: (v) => p("verstaerkung").setValueAtTime(v, ctx.currentTime) },
      ],
    };
  },
};

// Der Prozessor meldet die genaue Zeit des Überschreitens; bis die Nachricht hier ist, ist diese Zeit schon vorbei
// (ein paar Millisekunden). Ein Takt in der Vergangenheit würde sofort ausgeführt, also ungenau. Darum wird alles um
// „Verzögerung“ (Standard 30 ms) später geschickt: dann liegt es sicher in der Zukunft und kommt gleichmäßig.
const schwelle = {
  titel: "Schwelle",
  gruppe: "Werkzeug",
  baue(ctx) {
    const k = new AudioWorkletNode(ctx, "schwelle", { outputChannelCount: [1] });
    const p = (n) => k.parameters.get(n);
    const takt = new Takt();
    const w = { spaeter: 0.03 };
    k.port.onmessage = ({ data }) => {
      const t = Math.max(ctx.currentTime + 0.005, data.zeit + w.spaeter);
      if (data.an) takt.sende(t, Infinity);
      else takt.loslassen(t);
    };
    return {
      ein: { ein: { art: "ton", ziel: k } },
      aus: { Takt: { art: "takt", knoten: takt }, Gate: { art: "ton", knoten: k } },
      regler: [
        { name: "schwelle", text: "Schwelle", min: -1, max: 1, wert: 0.3, setze: (v) => p("schwelle").setValueAtTime(v, ctx.currentTime) },
        { name: "hysterese", text: "Hysterese", min: 0, max: 0.5, wert: 0.05, setze: (v) => p("hysterese").setValueAtTime(v, ctx.currentTime) },
        { name: "spaeter", text: "Verzögerung", ...log(0.01, 0.2), wert: 0.03, einheit: "s", setze: (v) => (w.spaeter = v) },
      ],
      weg: () => (k.port.onmessage = null),
    };
  },
};

const zufallstakt = {
  titel: "Zufallstakt",
  gruppe: "Werkzeug",
  baue() {
    const a = new Takt(), b = new Takt();
    const w = { p: 0.5 };
    return {
      ein: { Takt: { art: "takt", ziel: (t, d) => (Math.random() < w.p ? a : b).sende(t, d) } },
      aus: { A: { art: "takt", knoten: a }, B: { art: "takt", knoten: b } },
      regler: [{ name: "p", text: "nach A", min: 0, max: 1, wert: 0.5, setze: (v) => (w.p = v) }],
    };
  },
};

// Zähler: jeder Takt zählt eins weiter, bis „bis“, dann wieder 0. Ausgänge: ÷2, ÷3, ÷4, ÷8 (jeder n-te Takt),
// „Ende“ (beim Umlauf) und die Zahl selbst als Spannung (Zahl / 12: so ist sie gleich eine Tonhöhe in Halbtönen,
// eine Treppe hinauf, wie in Max [counter] → [mtof]).
const zaehler = {
  titel: "Zähler",
  gruppe: "Werkzeug",
  baue(ctx) {
    const teiler = { "÷2": new Takt(), "÷3": new Takt(), "÷4": new Takt(), "÷8": new Takt() };
    const ende = new Takt(), zahl = konstante(ctx, 0);
    const w = { bis: 8 };
    let n = 0;
    const zaehle = (t, d) => {
      for (const [name, takt] of Object.entries(teiler)) if (n % Number(name.slice(1)) === 0) takt.sende(t, d);
      zahl.offset.setValueAtTime(n / 12, t);
      n = (n + 1) % w.bis;
      if (n === 0) ende.sende(t, d);
    };
    return {
      ein: { Takt: { art: "takt", ziel: zaehle }, "zurück": { art: "takt", ziel: () => (n = 0) } },
      aus: { ...Object.fromEntries(Object.entries(teiler).map(([k, t]) => [k, { art: "takt", knoten: t }])), Ende: { art: "takt", knoten: ende }, Zahl: { art: "ton", knoten: zahl } },
      regler: [{ name: "bis", text: "bis", min: 2, max: 64, wert: 8, schritt: 1, setze: (v) => (w.bis = Math.round(v)) }],
      weg: () => zahl.stop(),
    };
  },
};

// Ringmodulator: Multiplikation zweier Schwingungen. cos(a)·cos(b) = ½ cos(a − b) + ½ cos(a + b): die Eingangs-
// frequenz verschwindet, übrig bleiben Summe und Differenz. Bei krummen Verhältnissen sind das keine Obertöne mehr
// (nicht mehr ganzzahlig), darum klingt es metallisch, nach Glocke oder Roboter.
// In Web Audio ist Multiplizieren einfach: ein Verstärker mit Grundwert 0, dessen Verstärkung der Träger ist.
const ringmod = {
  titel: "Ringmodulator",
  gruppe: "Bearbeiten",
  baue(ctx) {
    const ein = verstaerker(ctx, 1), mal = verstaerker(ctx, 0), trocken = verstaerker(ctx, 0), aus = verstaerker(ctx, 1);
    const osc = ctx.createOscillator(), traegerEin = verstaerker(ctx, 1200);
    osc.frequency.value = 300;
    traegerEin.connect(osc.detune);
    osc.connect(mal.gain);
    ein.connect(mal).connect(aus);
    ein.connect(trocken).connect(aus);
    osc.start();
    return {
      ein: { ein: { art: "ton", ziel: ein }, "Träger": { art: "ton", ziel: mal.gain }, "Tonhöhe": { art: "ton", ziel: traegerEin } },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "frequenz", text: "Träger", ...log(1, 5000), wert: 300, einheit: "Hz", setze: (v) => osc.frequency.setTargetAtTime(v, ctx.currentTime, 0.01) },
        { name: "trocken", text: "trocken", min: 0, max: 1, wert: 0, setze: (v) => trocken.gain.setTargetAtTime(v, ctx.currentTime, 0.01) },
      ],
      wahl: [{ name: "form", text: "Form", optionen: [["sine", "Sinus"], ["triangle", "Dreieck"], ["square", "Rechteck"]], wert: "sine", setze: (v) => (osc.type = v) }],
      weg: () => osc.stop(),
    };
  },
};

// ---------- Zufall (Runde 22) ----------
// Drei Arten, wie sich ein Wert zufällig bewegen kann:
//   Spaziergang  Ornstein-Uhlenbeck wie beim Wind: x ← x − x · dt / T + σ · √dt · Zufall. Zieht zur Mitte zurück
//                (Zeit T: wie lange er braucht), zittert dabei. Nie periodisch: kein Abschnitt kommt so wieder.
//                σ = √(2 / T) · 0,5: dann ist die typische Auslenkung (Standardabweichung) immer 0,5, egal wie
//                langsam. Mal „Stärke“ und plus „Mitte“.
//   glatt        alle T Sekunden ein neues Ziel, dorthin weich (Kosinus) übergeblendet. Ruhiger, wie ein Atmen.
//   Stufen       alle T Sekunden (oder bei jedem Takt am Eingang) ein neuer Wert, sofort. Das ist Sample & Hold
//                auf Rauschen, nur fertig.
// Der Wert wird alle 30 ms neu gesetzt (setTargetAtTime, weich); für Steuerspannungen reicht das, für Ton nicht.
const zufall = {
  titel: "Zufall",
  gruppe: "Werkzeug",
  baue(ctx, { bild }) {
    const k = konstante(ctx, 0), takt = new Takt();
    // „dazu“ (Runde 23): ein Kabel wird zum Ausgang addiert (Wind: Stärke von außen verschiebt die Mitte der Böen)
    const aus = verstaerker(ctx, 1), dazu = verstaerker(ctx, 1);
    k.connect(aus);
    dazu.connect(aus);
    const bildchen = verlaufsBild(ctx, bild, aus, () => 1.5);
    bildchen.an();
    const w = { art: "spaziergang", zeit: 4, staerke: 1, mitte: 0 };
    const normal = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random()); // Box-Muller
    let x = 0, von = 0, nach = 0, seit = 0, zuletzt = ctx.currentTime;
    const ausgeben = (v, t, glatt = 0.03) => k.offset.setTargetAtTime(w.mitte + w.staerke * v, t, glatt);
    const stufe = (t) => {
      x = (Math.random() * 2 - 1);
      k.offset.setValueAtTime(w.mitte + w.staerke * x, t);
      takt.sende(t, 0.05);
    };
    const uhr = setInterval(() => {
      const t = ctx.currentTime, dt = Math.min(0.2, t - zuletzt);
      zuletzt = t;
      if (ctx.state !== "running" || dt <= 0) return;
      if (w.art === "spaziergang") {
        x += (-x / w.zeit) * dt + Math.sqrt(2 / w.zeit) * 0.5 * Math.sqrt(dt) * normal();
        ausgeben(Math.max(-1.5, Math.min(1.5, x)), t);
      } else {
        seit += dt;
        if (seit >= w.zeit) {
          seit = 0;
          if (w.art === "stufen") stufe(t + 0.02);
          else {
            von = nach;
            nach = Math.random() * 2 - 1;
            takt.sende(t + 0.02, 0.05);
          }
        }
        if (w.art === "glatt") ausgeben(von + (nach - von) * (1 - Math.cos(Math.PI * Math.min(1, seit / w.zeit))) / 2, t);
      }
    }, 30);
    return {
      extra: bildchen.extra,
      ein: { Takt: { art: "takt", ziel: (t) => w.art === "stufen" && ((seit = 0), stufe(t)) }, dazu: { art: "ton", ziel: dazu } },
      aus: { aus: { art: "ton", knoten: aus }, Takt: { art: "takt", knoten: takt } },
      regler: [
        { name: "zeit", text: "Zeit", ...log(0.05, 300), wert: 4, einheit: "s", setze: (v) => (w.zeit = v) },
        { name: "staerke", text: "Stärke", min: 0, max: 2, wert: 1, setze: (v) => (w.staerke = v) },
        { name: "mitte", text: "Mitte", min: -1, max: 1, wert: 0, setze: (v) => (w.mitte = v) },
      ],
      wahl: [{ name: "art", text: "Art", optionen: [["spaziergang", "Spaziergang"], ["glatt", "glatt"], ["stufen", "Stufen"]], wert: "spaziergang", setze: (v) => (w.art = v) }],
      weg: () => {
        clearInterval(uhr);
        k.stop();
        bildchen.weg();
      },
    };
  },
};

// ---------- Zufallsgeber (Runde 22) ----------
// Takte zu zufälligen Zeiten. Ganz zufällig (Regel 0) ist ein Poisson-Prozess: in jedem Augenblick gleich
// wahrscheinlich, unabhängig davon, wie lange der letzte her ist. Die Abstände sind dann exponentialverteilt:
// Abstand = −ln(U) · Mittel (U gleichverteilt zwischen 0 und 1). So kommen Regentropfen, Knacken im Feuer,
// Rufe von Tieren, die sich nicht abstimmen: mal drei kurz hintereinander, mal lange nichts.
// Regel 1 ist ein Metronom. Dazwischen gemischt: Abstand = Mittel · (Regel + (1 − Regel) · (−ln U)).
// „Dichte“ (Kabel): mal (1 + Kabel). Bei −1 kommt nichts mehr, bei +1 doppelt so oft.
const zufallsgeber = {
  titel: "Zufallsgeber",
  gruppe: "Werkzeug",
  baue(ctx, { modul }) {
    const takt = new Takt(), dichte = leser(ctx);
    const w = { rate: 30, regel: 0, dauer: 0.1 };
    let naechste = null;
    const uhr = setInterval(() => {
      if (ctx.state !== "running") return;
      const jetzt = ctx.currentTime, bis = jetzt + 0.1;
      const faktor = modul.eingangBelegt?.("Dichte") ? Math.max(0, 1 + dichte.wert()) : 1;
      const mittel = 60 / Math.max(0.01, w.rate * faktor);
      if (naechste === null || naechste < jetzt - 0.2) naechste = jetzt + 0.02 + mittel * (w.regel + (1 - w.regel) * -Math.log(Math.random() || 1e-9));
      if (faktor === 0) {
        naechste = null;
        return;
      }
      while (naechste < bis) {
        // Runde 23: Takte, deren Zeit schon vorbei ist, fallen weg. Hing der Browser kurz (bis 0,2 s, z. B. beim
        // Einfügen einer großen Gruppe), kamen sonst alle verpassten auf einmal an: beim Regen 300 Tropfen im selben
        // Sample, alle mit Phase 0, ein Knall (gemessen: Spitze 10 statt 0,5). Für Poisson-Zufall ist Weglassen richtig.
        if (naechste >= jetzt) takt.sende(naechste, w.dauer);
        naechste += mittel * (w.regel + (1 - w.regel) * -Math.log(Math.random() || 1e-9));
      }
    }, 25);
    return {
      ein: { Dichte: { art: "ton", ziel: dichte.knoten } },
      aus: { Takt: { art: "takt", knoten: takt } },
      regler: [
        { name: "rate", text: "je Minute", ...log(0.2, 120000), wert: 30, setze: (v) => (w.rate = v) }, // bis 2000 je Sekunde (Regen)
        { name: "regel", text: "Regel", min: 0, max: 1, wert: 0, setze: (v) => (w.regel = v) },
        { name: "dauer", text: "Dauer", ...log(0.005, 4), wert: 0.1, einheit: "s", setze: (v) => (w.dauer = v) },
      ],
      weg: () => clearInterval(uhr),
    };
  },
};

// ---------- Tageslauf (Runde 22) ----------
// Ein Tag in „Tag“ Minuten. Die Uhrzeit läuft mit der Audio-Uhr. Ausgänge (0 … 1):
//   Licht   Sonnenhöhe: sin(2π · (Stunde − 6) / 24), unter null ist Nacht (dann 0). Mittags 1.
//   Nacht   das Gegenstück (wie tief die Sonne unter dem Horizont steht, weich auf 1 begrenzt)
//   Morgen  eine Glocke um 6 Uhr (Gauß, ±1,2 h): die Dämmerung, wenn die Vögel am meisten singen
//   Abend   eine Glocke um 20 Uhr: Abenddämmerung, Amseln, die ersten Grillen und Frösche
//   Zeit    der Tag als Sägezahn von 0 (Mitternacht) bis 1
// Damit lassen sich ganze Ebenen ein- und ausblenden, oder Dinge steuern, die von der Tageszeit abhängen (die
// Temperatur, und mit Dolbear die Grillen). „Start“ setzt die Uhr.
const tageslauf = {
  titel: "Tageslauf",
  gruppe: "Werkzeug",
  baue(ctx, { bild }) {
    const aus = { Licht: konstante(ctx, 0), Nacht: konstante(ctx, 0), Morgen: konstante(ctx, 0), Abend: konstante(ctx, 0), Zeit: konstante(ctx, 0) };
    const w = { tag: 12, laeuft: "ja" };
    let stunde = 7, zuletzt = ctx.currentTime, anzeige = null;
    const glocke = (h, mitte, breite) => {
      const d = ((h - mitte + 36) % 24) - 12; // kürzester Abstand auf dem Kreis der Stunden
      return Math.exp(-0.5 * (d / breite) ** 2);
    };
    const rechne = () => {
      const t = ctx.currentTime, dt = Math.min(0.5, t - zuletzt);
      zuletzt = t;
      if (ctx.state === "running" && w.laeuft === "ja") stunde = (stunde + (dt * 24) / (w.tag * 60)) % 24;
      const sonne = Math.sin((2 * Math.PI * (stunde - 6)) / 24);
      const werte = { Licht: Math.max(0, sonne), Nacht: Math.min(1, Math.max(0, -sonne) * 3), Morgen: glocke(stunde, 6, 1.2), Abend: glocke(stunde, 20, 1.2), Zeit: stunde / 24 };
      for (const [n, v] of Object.entries(werte)) aus[n].offset.setTargetAtTime(v, t, 0.1);
      if (anzeige) anzeige.textContent = `${String(Math.floor(stunde)).padStart(2, "0")}:${String(Math.floor((stunde % 1) * 60)).padStart(2, "0")} Uhr`;
    };
    const uhr = setInterval(rechne, 100);
    return {
      ein: {},
      aus: Object.fromEntries(Object.entries(aus).map(([n, k]) => [n, { art: "ton", knoten: k }])),
      regler: [
        { name: "tag", text: "Tag", ...log(0.5, 240), wert: 12, einheit: "min", setze: (v) => (w.tag = v) },
        { name: "start", text: "Start", min: 0, max: 24, wert: 7, einheit: "Uhr", setze: (v) => ((stunde = v), rechne()) },
      ],
      wahl: [{ name: "laeuft", text: "Uhr", optionen: [["ja", "läuft"], ["nein", "steht"]], wert: "ja", setze: (v) => (w.laeuft = v) }],
      extra: (el) => {
        anzeige = document.createElement("p");
        anzeige.className = "tageszeit";
        el.append(anzeige);
        rechne();
      },
      weg: () => {
        clearInterval(uhr);
        Object.values(aus).forEach((k) => k.stop());
      },
    };
  },
};

// ---------- Notiz (Runde 22) ----------
// Ein Zettel: Text, der mit dem Patch gespeichert wird. Die Lern-Vorlagen erklären damit Schritt für Schritt,
// was die Module daneben tun. Eigene Gedanken lassen sich genauso danebenschreiben.
const notiz = {
  titel: "Notiz",
  gruppe: "Werkzeug",
  baue() {
    return {
      ein: {},
      aus: {},
      regler: [],
      extra: (el, modul) => {
        const feld = document.createElement("textarea");
        feld.className = "notiz-text";
        feld.rows = 6;
        feld.value = modul.werte.text ?? "";
        feld.setAttribute("aria-label", "Notiz");
        feld.addEventListener("input", () => {
          modul.werte.text = feld.value;
          feld.dispatchEvent(new Event("change", { bubbles: true })); // speichern (main.js hört auf change)
        });
        // so hoch wie der Text
        const passe = () => {
          feld.style.height = "auto";
          feld.style.height = `${feld.scrollHeight + 2}px`;
        };
        feld.addEventListener("input", passe);
        requestAnimationFrame(passe);
        el.append(feld);
      },
    };
  },
};

// ---------- Taster (Runde 23) ----------
// Ein Knopf zum Drücken: solange gedrückt, ist Gate 1 und der Takt gehalten (wie eine Taste: Hüllkurve bleibt offen,
// „los“ beim Loslassen). „Umschalten“: einmal drücken an, nochmal aus. Dazu eine Taste der Computertastatur
// (Feld „Taste“, ein Buchstabe oder eine Zahl). So sagt man der Stimme, wann sie sprechen soll.
const taster = {
  titel: "Taster",
  gruppe: "Werkzeug",
  baue(ctx, { modul }) {
    const takt = new Takt(), gate = konstante(ctx, 0);
    const w = { art: "tasten" };
    let an = false, knopf = null;
    const setze = (neu) => {
      if (neu === an) return;
      an = neu;
      const t = ctx.currentTime + 0.005;
      gate.offset.setValueAtTime(an ? 1 : 0, t);
      if (an) takt.sende(t, Infinity);
      else takt.loslassen(t);
      knopf?.setAttribute("aria-pressed", String(an));
    };
    const runter = () => setze(w.art === "umschalten" ? !an : true);
    const hoch = () => w.art === "tasten" && setze(false);
    const tastatur = (ev, druck) => {
      const taste = modul.werte.taste;
      if (!taste || ev.repeat || ev.key.toLowerCase() !== taste.toLowerCase()) return;
      if (ev.target.closest?.("input:not([type=range]), select, textarea")) return;
      ev.preventDefault(); // sonst rollt z. B. die Leertaste die Seite oder drückt den Knopf, der gerade den Fokus hat
      druck ? runter() : hoch();
    };
    const tRunter = (ev) => tastatur(ev, true), tHoch = (ev) => tastatur(ev, false);
    window.addEventListener("keydown", tRunter);
    window.addEventListener("keyup", tHoch);
    return {
      ein: {},
      aus: { Takt: { art: "takt", knoten: takt }, Gate: { art: "ton", knoten: gate, info: "1 solange gedrückt (oder eingeschaltet), sonst 0" } },
      regler: [],
      wahl: [{ name: "art", text: "Art", optionen: [["tasten", "tasten (solange gedrückt)"], ["umschalten", "umschalten"]], wert: "tasten", setze: (v) => (w.art = v) }],
      extra: (el) => {
        knopf = document.createElement("button");
        knopf.type = "button";
        knopf.className = "taster-knopf";
        knopf.textContent = "drücken";
        knopf.setAttribute("aria-pressed", "false");
        knopf.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          try { knopf.setPointerCapture(ev.pointerId); } catch {} // (ohne echten Zeiger, z. B. ausgelöst aus Code, gibt es nichts zu fangen)
          runter();
        });
        knopf.addEventListener("pointerup", hoch);
        knopf.addEventListener("pointercancel", hoch);
        const label = document.createElement("label");
        label.append("Taste ");
        const feld = document.createElement("input");
        feld.type = "text";
        feld.maxLength = 1;
        feld.size = 2;
        feld.value = modul.werte.taste ?? "";
        feld.addEventListener("input", () => {
          modul.werte.taste = feld.value;
          feld.dispatchEvent(new Event("change", { bubbles: true }));
        });
        label.append(feld);
        const reihe = document.createElement("div");
        reihe.className = "steuerung knopf-reihe";
        reihe.append(knopf, label);
        el.append(reihe);
      },
      weg: () => {
        window.removeEventListener("keydown", tRunter);
        window.removeEventListener("keyup", tHoch);
        gate.stop();
      },
    };
  },
};

export const WERKZEUG_MODULE = { mathe, folger, schwelle, zufallstakt, zaehler, ringmod, zufall, zufallsgeber, tageslauf, notiz, taster };
