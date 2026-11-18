// Natur-Module (Runde 21): Geräusche der Natur, nicht aufgenommen, sondern nachgebaut („prozedurales
// Sounddesign“, wie in Andy Farnells Buch „Designing Sound“). Der Weg ist immer derselbe: erst verstehen, WIE das
// Geräusch physikalisch entsteht, dann nur das Wesentliche davon rechnen.
//   Tropfen   Wasser: schwingende Luftblasen (Minnaert, van den Doel) → Regen, Bach, Brunnen
//   Knistern  zufällige Knackser mit sehr ungleicher Stärke → Feuer, Vinyl, Äste
//   Zirpen    Grillen: ein Ton, in Pulse zerhackt; schneller bei Wärme (Dolbear)
//   Wind      Rauschen durch Filter, Stärke als Zufallsspaziergang (Böen), dazu Pfeifen an Kanten
//   Vogel     Silben als Tonhöhen-Bögen, zu Strophen gereiht (Amsel, Meise, Spatz)
//   Frosch    Rufe aus Pulsen durch einen Formanten; Unke, Laubfrosch, Teichfrosch; rufen abwechselnd (Runde 22)
// Runde 22: Eingänge zum Steuern von außen (für Landschaften): Dichte (Tropfen, Knistern), Temperatur (Zirpen),
// Stärke (Wind), Aktivität (Vogel, Frosch). Wie es aus einfachen Modulen gebaut wird, zeigen die Lern-Vorlagen
// („… aus Bausteinen“): dort ist jedes Geräusch eine aufgeklappte Gruppe mit Notizen.
// Die ersten drei rechnen Sample für Sample im Ton-Faden (worklets.js), Wind und Vogel planen Web-Audio-Regler voraus.

import { Takt } from "./takt.js";
import { log, verstaerker, filter, rauschQuelle, leser } from "./bausteine.js";

// ein Worklet-Modul mit Knöpfen, die direkt seine Parameter stellen.
// mod: { Eingangsname: [Parameter, art] } (Runde 22): ein Kabel an diesen Eingang bewegt den Parameter.
//   art "mal":  Kabel 1,0 verdoppelt den Wert des Knopfs, −1,0 macht ihn null (ein Verstärker mit der Stellung des
//               Knopfs als Verstärkung, dahinter der Parameter: Knopf + Knopf · Kabel)
//   art Zahl:   Kabel 1,0 addiert so viel (Temperatur: 10 °C je 1,0)
function workletModul(ctx, name, knoepfe, extraEin = {}, mod = {}) {
  const k = new AudioWorkletNode(ctx, name, { numberOfInputs: 0, outputChannelCount: [2] });
  const pegel = verstaerker(ctx, 0.8);
  k.connect(pegel);
  const p = (n) => k.parameters.get(n);
  const malKnoten = {};
  const ein = { ...extraEin };
  for (const [eingang, [param, art]] of Object.entries(mod)) {
    const g = verstaerker(ctx, art === "mal" ? 0 : art);
    g.connect(p(param));
    if (art === "mal") malKnoten[param] = g;
    ein[eingang] = { art: "ton", ziel: g };
  }
  return {
    k,
    teil: {
      ein,
      aus: { aus: { art: "ton", knoten: pegel } },
      regler: [
        ...knoepfe.map((r) => ({ ...r, setze: (v) => {
          p(r.name).setValueAtTime(v, ctx.currentTime);
          malKnoten[r.name]?.gain.setValueAtTime(v, ctx.currentTime);
        } })),
        { name: "pegel", text: "Pegel", min: 0, max: 2, wert: 0.8, setze: (v) => pegel.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
    },
  };
}

const tropfen = {
  titel: "Tropfen",
  gruppe: "Natur (kompakt)",
  versteckt: true, // Runde 23: in der Auswahl stehen die Gruppen (klaenge.js); alte Patches laden das Modul weiter
  baue(ctx) {
    const { k, teil } = workletModul(ctx, "tropfen", [
      { name: "rate", text: "Tropfen/s", ...log(0.5, 4000), wert: 40 },
      { name: "rKlein", text: "kleinste", ...log(0.2, 8), wert: 1, einheit: "mm" },
      { name: "rGross", text: "größte", ...log(0.5, 20), wert: 6, einheit: "mm" },
      { name: "steigen", text: "Steigen", min: 0, max: 0.5, wert: 0.1 },
      { name: "breite", text: "Breite", min: 0, max: 1, wert: 0.8 },
    ], {
      Tropfen: { art: "takt", ziel: (t) => k.port.postMessage({ zeit: t }) },
    }, { Dichte: ["rate", "mal"] });
    return teil;
  },
};

const knistern = {
  titel: "Knistern",
  gruppe: "Natur (kompakt)",
  versteckt: true, // Runde 23: in der Auswahl stehen die Gruppen (klaenge.js); alte Patches laden das Modul weiter
  baue(ctx) {
    return workletModul(ctx, "knistern", [
      { name: "rate", text: "Knackser/s", ...log(0.5, 800), wert: 12 },
      { name: "laenge", text: "Länge", ...log(0.0002, 0.02), wert: 0.002, einheit: "s" },
      { name: "knall", text: "Knall", min: 0, max: 1, wert: 0.3 },
      { name: "breite", text: "Breite", min: 0, max: 1, wert: 0.7 },
    ], {}, { Dichte: ["rate", "mal"] }).teil;
  },
};

const zirpen = {
  titel: "Zirpen",
  gruppe: "Natur (kompakt)",
  versteckt: true, // Runde 23: in der Auswahl stehen die Gruppen (klaenge.js); alte Patches laden das Modul weiter
  baue(ctx) {
    return workletModul(ctx, "zirpen", [
      { name: "temperatur", text: "Temperatur", min: 5, max: 35, wert: 24, einheit: "°C" },
      { name: "traeger", text: "Ton", ...log(1500, 9000), wert: 4600, einheit: "Hz" },
      { name: "pulse", text: "Pulse", min: 1, max: 8, wert: 3, schritt: 1 },
      { name: "anzahl", text: "Grillen", min: 1, max: 12, wert: 3, schritt: 1 },
      { name: "zufall", text: "Zufall", min: 0, max: 1, wert: 0.3 },
    ], {}, { Temperatur: ["temperatur", 10] }).teil;
  },
};

// ---------- Wind ----------
// Wind selbst ist lautlos; was man hört, ist Luft, die an Dingen wirbelt. Ein breites Rauschen (rosa: mehr Tiefe)
// durch einen Bandpass, dessen Mitte und Lautstärke mit der Windstärke steigen: stärkerer Wind, höher und lauter.
// Dazu „Pfeifen“: zwei schmale Bänder (hohe Güte), die erst bei starken Böen hörbar werden (Lautstärke ~ Böe²), wie
// Wind an einer Fensterkante oder einem Draht.
// Die Windstärke ist ein Zufallsspaziergang mit Rückstellkraft (Ornstein-Uhlenbeck-Prozess): in jedem kleinen Schritt
//   x ← x + θ · (Mittel − x) · dt + σ · √dt · Zufall
// Der erste Teil zieht zurück zum Mittel (θ: wie schnell, „Tempo“), der zweite schubst zufällig (σ: „Böen“). So
// entstehen Böen, die kommen und gehen, aber nie davonlaufen. Den Wert gibt es auch als Ausgang „Böe“ (0 … 1), um
// damit anderes zu bewegen (Hall, das Rascheln von Blättern …).
const wind = {
  titel: "Wind",
  gruppe: "Natur (kompakt)",
  versteckt: true, // Runde 23: in der Auswahl stehen die Gruppen (klaenge.js); alte Patches laden das Modul weiter
  baue(ctx, { modul }) {
    const staerkeEin = leser(ctx);
    const rauschen = rauschQuelle(ctx);
    // weiß → rosa-ähnlich: ein sanfter Tiefpass genügt hier (das Band schneidet sowieso)
    const weich = filter(ctx, "lowpass", 3000, 0.5);
    const band = filter(ctx, "bandpass", 500, 0.8), laut = verstaerker(ctx, 0);
    const pfeif1 = filter(ctx, "bandpass", 900, 30), pfeif2 = filter(ctx, "bandpass", 1450, 40), pfeifLaut = verstaerker(ctx, 0);
    const lage = ctx.createStereoPanner(), summe = verstaerker(ctx, 1);
    const boe = ctx.createConstantSource();
    boe.start();
    rauschen.connect(weich);
    weich.connect(band).connect(laut).connect(lage);
    rauschen.connect(pfeif1).connect(pfeifLaut);
    rauschen.connect(pfeif2).connect(pfeifLaut);
    pfeifLaut.connect(lage);
    lage.connect(summe);
    const w = { staerke: 0.5, boeen: 0.5, tempo: 0.3, hoehe: 1, pfeifen: 0.3 };
    let x = 0.5, schwenk = 0;
    const SCHRITT = 0.05;
    const uhr = setInterval(() => {
      if (ctx.state !== "running") return;
      const r = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2; // ungefähr normalverteilt
      const mittel = w.staerke + (modul.eingangBelegt?.("Stärke") ? staerkeEin.wert() : 0); // Kabel: + Stärke
      x += w.tempo * (mittel - x) * SCHRITT + w.boeen * 0.8 * Math.sqrt(SCHRITT) * r();
      x = Math.max(0, Math.min(1.2, x));
      schwenk = Math.max(-0.7, Math.min(0.7, schwenk + 0.1 * Math.sqrt(SCHRITT) * r()));
      const t = ctx.currentTime + 0.02, τ = 0.12;
      band.frequency.setTargetAtTime((180 + 900 * x) * w.hoehe, t, τ);
      band.Q.setTargetAtTime(0.6 + x, t, τ);
      laut.gain.setTargetAtTime(0.15 + 1.6 * x * x, t, τ);
      pfeif1.frequency.setTargetAtTime((700 + 500 * x) * w.hoehe, t, τ);
      pfeif2.frequency.setTargetAtTime((1100 + 800 * x) * w.hoehe, t, τ);
      pfeifLaut.gain.setTargetAtTime(w.pfeifen * 6 * Math.max(0, x - 0.35) ** 2, t, τ);
      lage.pan.setTargetAtTime(schwenk, t, 0.5);
      boe.offset.setTargetAtTime(x, t, τ);
    }, SCHRITT * 1000);
    return {
      ein: { "Stärke": { art: "ton", ziel: staerkeEin.knoten } },
      aus: { aus: { art: "ton", knoten: summe }, "Böe": { art: "ton", knoten: boe } },
      regler: [
        { name: "staerke", text: "Stärke", min: 0, max: 1, wert: 0.5, setze: (v) => (w.staerke = v) },
        { name: "boeen", text: "Böen", min: 0, max: 1, wert: 0.5, setze: (v) => (w.boeen = v) },
        { name: "tempo", text: "Tempo", ...log(0.05, 3), wert: 0.3, setze: (v) => (w.tempo = v) },
        { name: "hoehe", text: "Höhe", ...log(0.4, 3), wert: 1, setze: (v) => (w.hoehe = v) },
        { name: "pfeifen", text: "Pfeifen", min: 0, max: 1, wert: 0.3, setze: (v) => (w.pfeifen = v) },
        { name: "pegel", text: "Pegel", min: 0, max: 2, wert: 1, setze: (v) => summe.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      weg: () => {
        clearInterval(uhr);
        rauschen.stop();
        boe.stop();
      },
    };
  },
};

// ---------- Vogel ----------
// Vogelgesang ist fast ein reiner Ton (die Syrinx hat zwei Seiten, die meist eine Linie singen), der sich sehr
// schnell in der Höhe bewegt. Eine Silbe ist hier ein Tonhöhen-Bogen (Anfang, Mitte, Ende in Hz) mit einer
// Lautstärke-Hülle sin², gespielt mit setValueCurveAtTime (eine ganze Kurve auf einmal, sampelgenau). Silben werden zu
// Strophen gereiht, dazwischen Pausen. Jede Art hat ihr Muster:
//   Amsel   flötend, tiefer (1,5–3,5 kHz), weiche Bögen, lange Strophe, endet oft mit leisem Zwitschern
//   Meise   „zi-zi-bä“: hoch, hoch, tiefer, 3–6 Mal wiederholt
//   Spatz   „tschilp“: kurze schnelle Abwärts-Wischer, unregelmäßig
// Am Eingang „Singen“ (Takt) beginnt sofort eine Strophe, sonst singt er von selbst („Häufigkeit“ je Minute).
const zufall = (a, b) => a + Math.random() * (b - a);
const ARTEN_VOGEL = {
  amsel() {
    const silben = [], n = Math.floor(zufall(4, 8)), basis = zufall(1700, 2300);
    for (let i = 0; i < n; i++) {
      const a = basis * zufall(0.8, 1.4), e = a * zufall(0.7, 1.35);
      silben.push({ kurve: [a, (a + e) / 2 * zufall(0.9, 1.25), e], dauer: zufall(0.09, 0.26), pause: zufall(0.02, 0.08), laut: zufall(0.6, 1), vibrato: zufall(0, 25) });
    }
    // zum Schluss oft ein leises, hohes Gezwitscher
    if (Math.random() < 0.6) for (let i = 0; i < Math.floor(zufall(3, 7)); i++) silben.push({ kurve: [zufall(4500, 6000), zufall(3500, 5000)], dauer: zufall(0.025, 0.05), pause: 0.015, laut: 0.35, vibrato: 0 });
    return silben;
  },
  meise() {
    const silben = [], hoch = zufall(6000, 7200), tief = hoch * zufall(0.52, 0.6);
    for (let i = 0; i < Math.floor(zufall(3, 7)); i++) {
      silben.push({ kurve: [hoch * 1.03, hoch], dauer: 0.07, pause: 0.03, laut: 0.8, vibrato: 0 });
      silben.push({ kurve: [tief, tief * 0.97], dauer: 0.1, pause: 0.07, laut: 1, vibrato: 0 });
    }
    return silben;
  },
  spatz() {
    const silben = [];
    for (let i = 0; i < Math.floor(zufall(2, 6)); i++) {
      const a = zufall(4200, 5200);
      silben.push({ kurve: [a, a * 1.1, a * 0.62], dauer: zufall(0.05, 0.09), pause: zufall(0.08, 0.35), laut: zufall(0.7, 1), vibrato: 0 });
    }
    return silben;
  },
};

const vogel = {
  titel: "Vogel",
  gruppe: "Natur (kompakt)",
  versteckt: true, // Runde 23: in der Auswahl stehen die Gruppen (klaenge.js); alte Patches laden das Modul weiter
  baue(ctx, { modul }) {
    const aktiv = leser(ctx); // Aktivität: mal die Häufigkeit (wenn ein Kabel steckt), 0 = schweigt
    const osc = ctx.createOscillator(), huelle = verstaerker(ctx, 0), lage = ctx.createStereoPanner(), pegel = verstaerker(ctx, 0.5);
    const vib = ctx.createOscillator(), vibTiefe = verstaerker(ctx, 0);
    // ein bisschen Rauheit: die zweite Harmonische leise mit (echte Vogelstimmen sind nicht ganz rein)
    const welle = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.08, 0.02]));
    osc.setPeriodicWave(welle);
    vib.frequency.value = 28;
    vib.connect(vibTiefe).connect(osc.frequency);
    osc.connect(huelle).connect(lage).connect(pegel);
    osc.start();
    vib.start();
    const takt = new Takt();
    const w = { art: "amsel", haeufigkeit: 8, hoehe: 1, tempo: 1, lage: 0 };
    let frei = 0; // ab wann wieder gesungen werden kann (Audio-Uhr)
    function strophe(t0) {
      if (t0 < frei) return;
      let t = t0;
      takt.sende(t0, 0.1);
      for (const s of ARTEN_VOGEL[w.art]()) {
        const dauer = s.dauer / w.tempo, n = 24;
        // Tonhöhen-Bogen: durch die Stützpunkte der Silbe weich hindurch (kosinus-gemischt)
        const kurve = new Float32Array(n), hull = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const u = (i / (n - 1)) * (s.kurve.length - 1), k = Math.min(s.kurve.length - 2, Math.floor(u)), f = u - k;
          const m = (1 - Math.cos(Math.PI * f)) / 2;
          kurve[i] = (s.kurve[k] * (1 - m) + s.kurve[k + 1] * m) * w.hoehe;
          hull[i] = s.laut * Math.sin((Math.PI * i) / (n - 1)) ** 2;
        }
        osc.frequency.setValueCurveAtTime(kurve, t, dauer);
        huelle.gain.setValueCurveAtTime(hull, t, dauer);
        vibTiefe.gain.setValueAtTime(s.vibrato * w.hoehe, t);
        t += dauer + s.pause / w.tempo;
      }
      frei = t + 0.05;
    }
    const uhr = setInterval(() => {
      if (ctx.state !== "running") return;
      // im Mittel „Häufigkeit“ Strophen je Minute, zufällig verteilt
      const lust = modul.eingangBelegt?.("Aktivität") ? Math.max(0, aktiv.wert()) : 1;
      if (Math.random() < ((w.haeufigkeit * lust) / 60) * 0.1) strophe(Math.max(ctx.currentTime + 0.05, frei));
    }, 100);
    return {
      ein: { Singen: { art: "takt", ziel: (t) => strophe(Math.max(t, ctx.currentTime + 0.01)) }, "Aktivität": { art: "ton", ziel: aktiv.knoten } },
      aus: { aus: { art: "ton", knoten: pegel }, Strophe: { art: "takt", knoten: takt } },
      regler: [
        { name: "haeufigkeit", text: "je Minute", min: 0, max: 40, wert: 8, setze: (v) => (w.haeufigkeit = v) },
        { name: "hoehe", text: "Höhe", ...log(0.5, 2), wert: 1, setze: (v) => (w.hoehe = v) },
        { name: "tempo", text: "Tempo", ...log(0.5, 2), wert: 1, setze: (v) => (w.tempo = v) },
        { name: "lage", text: "Lage", min: -1, max: 1, wert: 0, setze: (v) => lage.pan.setTargetAtTime(v, ctx.currentTime, 0.05) },
        { name: "pegel", text: "Pegel", min: 0, max: 1, wert: 0.5, setze: (v) => pegel.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [{ name: "art", text: "Art", optionen: [["amsel", "Amsel"], ["meise", "Kohlmeise"], ["spatz", "Spatz"]], wert: "amsel", setze: (v) => (w.art = v) }],
      weg: () => {
        clearInterval(uhr);
        osc.stop();
        vib.stop();
      },
    };
  },
};

// ---------- Frosch (Runde 22) ----------
// Froschrufe entstehen im Kehlkopf: Luft wird zwischen Lunge und Mund hin- und hergepumpt, die Stimmbänder schwingen,
// die Schallblase (beim Teichfrosch zwei an den Mundwinkeln) wirkt als Resonator und strahlt ab. Ein Ruf ist darum
// fast immer eine Folge von Pulsen (Stimmband-Schläge oder Pumpstöße), gefärbt von einer Resonanz (Formant).
// Hier: eine Quelle (Sägezahn oder Rechteck) durch einen Bandpass (die Blase), die Lautstärke als Pulsfolge.
//   Unke (Rotbauchunke)  weiche, tonale „uh“-Rufe um 450 Hz, kurz, sehr regelmäßig, einer nach dem anderen;
//                        im Chor klingt das wie fernes, gläsernes Läuten
//   Laubfrosch           „äpp-äpp-äpp“: Silben von 40 ms, etwa 7 je Sekunde, hoch (um 2 kHz), in langen Reihen
//   Teichfrosch          „ärrrr“, „quak“: schnelle Pulse (25 je Sekunde), tief und schnarrend, in Gruppen
// Abwechseln: echte Frösche im Chor rufen nicht gleichzeitig, sondern in die Lücken der Nachbarn (sie hören einander
// und warten; so wird jeder Ruf von den Weibchen gehört). Ist „abwechseln“ an, wartet ein Frosch, der gerade dran
// wäre, bis der andere fertig ist, plus eine kleine Pause. Daraus entsteht von selbst ein Wechselgesang.
const FROESCHE = {
  unke: { form: "triangle", ton: 440, band: 600, guete: 1.2, ruf: () => [{ dauer: zufall(0.18, 0.28), pulse: 0, steigen: -0.05 }], pause: () => zufall(1, 2.2) },
  laubfrosch: { form: "square", ton: 1100, band: 2300, guete: 4, ruf: () => Array.from({ length: Math.floor(zufall(5, 18)) }, () => ({ dauer: 0.045, luecke: 0.1, pulse: 0, steigen: 0.08 })), pause: () => zufall(2, 8) },
  teichfrosch: { form: "sawtooth", ton: 170, band: 1300, guete: 2.2, ruf: () => Array.from({ length: Math.floor(zufall(2, 6)) }, () => ({ dauer: zufall(0.25, 0.6), luecke: zufall(0.12, 0.3), pulse: 25, steigen: -0.03 })), pause: () => zufall(2, 6) },
};
const frosch = {
  titel: "Frosch",
  gruppe: "Natur (kompakt)",
  versteckt: true, // Runde 23: in der Auswahl stehen die Gruppen (klaenge.js); alte Patches laden das Modul weiter
  baue(ctx, { modul }) {
    const summe = verstaerker(ctx, 0.6), aktiv = leser(ctx);
    const w = { art: "teichfrosch", anzahl: 3, haeufigkeit: 1, hoehe: 1, abwechseln: "ja" };
    let belegtBis = 0;
    const tiere = Array.from({ length: 8 }, (_, i) => {
      const osc = ctx.createOscillator(), band = ctx.createBiquadFilter(), huelle = verstaerker(ctx, 0), lage = ctx.createStereoPanner(), weit = verstaerker(ctx, 1);
      band.type = "bandpass";
      osc.connect(band).connect(huelle).connect(lage).connect(weit).connect(summe);
      osc.start();
      lage.pan.value = i === 0 ? 0 : zufall(-0.9, 0.9);
      weit.gain.value = i === 0 ? 1 : zufall(0.35, 0.9); // manche weiter weg, leiser
      return { osc, band, huelle, eigen: zufall(0.9, 1.12), frei: ctx.currentTime + zufall(0, 3) };
    });
    const stelle = () => {
      const a = FROESCHE[w.art];
      for (const f of tiere) {
        f.osc.type = a.form;
        f.band.frequency.value = a.band * f.eigen * w.hoehe;
        f.band.Q.value = a.guete;
      }
    };
    function rufe(f, t0) {
      const a = FROESCHE[w.art];
      let t = t0;
      for (const s of a.ruf()) {
        const n = Math.max(2, Math.round(s.dauer * 400)), kurve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1), zeit = u * s.dauer;
          let v = Math.sin(Math.PI * u) ** 0.6; // weicher Bogen über die Silbe
          if (s.pulse) v *= Math.max(0, Math.sin(2 * Math.PI * s.pulse * zeit)) ** 3; // Pulse: „rrrr“
          kurve[i] = v;
        }
        f.huelle.gain.setValueCurveAtTime(kurve, t, s.dauer);
        const hz = a.ton * f.eigen * w.hoehe;
        f.osc.frequency.setValueAtTime(hz, t);
        f.osc.frequency.linearRampToValueAtTime(hz * (1 + s.steigen), t + s.dauer);
        t += s.dauer + (s.luecke ?? 0.02);
      }
      return t;
    }
    stelle();
    const uhr = setInterval(() => {
      if (ctx.state !== "running") return;
      const jetzt = ctx.currentTime;
      const lust = modul.eingangBelegt?.("Aktivität") ? Math.max(0, aktiv.wert()) : 1;
      tiere.slice(0, w.anzahl).forEach((f) => {
        if (f.frei > jetzt + 0.1) return;
        let start = Math.max(jetzt + 0.05, f.frei);
        if (w.abwechseln === "ja" && belegtBis > start && Math.random() < 0.9) start = belegtBis + zufall(0.05, 0.2);
        if (start > jetzt + 0.15) return; // noch nicht dran: später wieder fragen
        if (lust <= 0.02 || Math.random() > Math.min(1, lust * w.haeufigkeit)) {
          f.frei = jetzt + zufall(0.5, 2);
          return;
        }
        const ende = rufe(f, start);
        belegtBis = Math.max(belegtBis, ende);
        f.frei = ende + FROESCHE[w.art].pause() / Math.max(0.2, w.haeufigkeit);
      });
    }, 50);
    return {
      ein: { "Aktivität": { art: "ton", ziel: aktiv.knoten } },
      aus: { aus: { art: "ton", knoten: summe } },
      regler: [
        { name: "anzahl", text: "Frösche", min: 1, max: 8, wert: 3, schritt: 1, setze: (v) => (w.anzahl = Math.round(v)) },
        { name: "haeufigkeit", text: "Rufen", ...log(0.1, 3), wert: 1, setze: (v) => (w.haeufigkeit = v) },
        { name: "hoehe", text: "Höhe", ...log(0.5, 2), wert: 1, setze: (v) => { w.hoehe = v; stelle(); } },
        { name: "pegel", text: "Pegel", min: 0, max: 2, wert: 0.6, setze: (v) => summe.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      wahl: [
        { name: "art", text: "Art", optionen: [["teichfrosch", "Teichfrosch"], ["laubfrosch", "Laubfrosch"], ["unke", "Unke"]], wert: "teichfrosch", setze: (v) => { w.art = v; stelle(); } },
        { name: "abwechseln", text: "Abwechseln", optionen: [["ja", "ja (Wechselgesang)"], ["nein", "nein"]], wert: "ja", setze: (v) => (w.abwechseln = v) },
      ],
      weg: () => {
        clearInterval(uhr);
        tiere.forEach((f) => f.osc.stop());
      },
    };
  },
};

export const NATUR_MODULE = { tropfen, knistern, zirpen, wind, vogel, frosch };
