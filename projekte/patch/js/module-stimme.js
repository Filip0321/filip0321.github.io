// Stimme (Runde 22): der Stimmensynthesizer aus /projekte/stimme als Modul. Dieselbe Rechnung (stimme-worklet.js:
// Stimmlippen nach dem LF-Modell, ein Rohr aus 44 Stücken nach Kelly und Lochbaum, Nase, Zischen an Engstellen),
// dieselben Laute (laute.js) und dieselben Sprachregeln (deutsch.js). Hier gesteuert von der Patch-Wand:
//   Noten      singt die Note (die zuletzt gedrückte; eine Stimme hat nur einen Kehlkopf)
//   Tonhöhe    1,0 pro Oktave dazu (Vibrato vom LFO, Gleiten)
//   Vokal      Kabel verschiebt den Vokal-Knopf: 0 … 1 geht u – o – a – e – i, wie ein Formantfilter, aber echt
//   Takt       spricht oder singt den Text (einmal je Takt); ohne Text: Ton an für die Dauer des Takts
// Vokal-Knopf: die Zungen- und Lippenlagen der fünf Vokale (gemessen an echten Formanten, siehe laute.js), dazwischen
// gemischt. Wenn man ihn langsam dreht, gleitet die Stimme wie „uoaei“: man hört die Formanten wandern.
// Alle 15 ms gehen die Werte als Nachricht an den Ton-Faden (wie auf der Stimme-Seite in jedem Bild).

import { Noten } from "./takt.js";
import { log, verstaerker, leser } from "./bausteine.js";
import { VOKALE, lautschriftZuFolge, tonFuer, formantKlang } from "/projekte/stimme/js/laute.js";
import { deutschZuLautschrift } from "/projekte/stimme/js/deutsch.js";

const geladen = new WeakMap(); // ein AudioContext lädt das Programm nur einmal
const ladeStimme = (ctx) => {
  if (!geladen.has(ctx)) geladen.set(ctx, ctx.audioWorklet.addModule("/projekte/stimme/js/stimme-worklet.js"));
  return geladen.get(ctx);
};
const PFAD = ["u", "o", "a", "e", "i"].map((v) => VOKALE[v]);
function vokalBei(t) {
  const u = Math.max(0, Math.min(1, t)) * (PFAD.length - 1), k = Math.min(PFAD.length - 2, Math.floor(u)), f = u - k;
  const a = PFAD[k], b = PFAD[k + 1];
  return { zungeOrt: a.zungeOrt + (b.zungeOrt - a.zungeOrt) * f, zungeWeite: a.zungeWeite + (b.zungeWeite - a.zungeWeite) * f, lippen: a.lippen + (b.lippen - a.lippen) * f };
}

const stimme = {
  titel: "Stimme",
  gruppe: "Klang",
  baue(ctx, { modul, melde }) {
    const aus = verstaerker(ctx, 1);
    const tonCv = leser(ctx), vokalCv = leser(ctx);
    const w = { frequenz: 110, vokal: 0.5, spannung: 0.6, vibrato: 0.005, tempo: 0.07, laut: 0.8, art: "rohr", dauer: "noten", bits: 16, melodie: "noten" };
    let knoten = null, text = "", gehalten = [], taktBis = 0, folge = null;
    ladeStimme(ctx).then(() => {
      knoten = new AudioWorkletNode(ctx, "stimme", { numberOfInputs: 0, outputChannelCount: [1] });
      knoten.connect(aus);
    }).catch((f) => melde(`Die Stimme ließ sich nicht laden: ${f.message}`));

    const sprich = (t) => {
      const schritte = lautschriftZuFolge(deutschZuLautschrift(text));
      if (!schritte.length) return false;
      const m = schritte.filter((s) => s.betont).length;
      let n = 0;
      for (const s of schritte) if (s.betont) s.ton = w.melodie === "singen" ? tonFuer("singen", n++, m, Math.random) : w.melodie === "fallend" ? tonFuer("fallend", n++, m) : 1;
      folge = { schritte, i: -1, ende: t, zunge: null, lippen: 3, ton: 1 };
      return true;
    };
    // welcher Laut gilt gerade (wie folgeSchritt auf der Stimme-Seite)
    const schritt = () => {
      if (!folge) return null;
      const jetzt = ctx.currentTime;
      if (jetzt < folge.ende && folge.i < 0) return null;
      while (jetzt >= folge.ende) {
        folge.i++;
        if (folge.i >= folge.schritte.length) {
          folge = null;
          return null;
        }
        const s = folge.schritte[folge.i];
        folge.ende += s.dauer * w.tempo;
        if (s.vokal) {
          folge.zunge = s.vokal;
          folge.lippen = s.vokal.lippen;
        }
        if (s.ton) folge.ton = s.ton;
      }
      return folge.schritte[folge.i];
    };

    const uhr = setInterval(() => {
      if (!knoten || ctx.state !== "running") return;
      const s = schritt();
      const v = vokalBei(w.vokal + (modul.eingangBelegt?.("Vokal") ? vokalCv.wert() : 0));
      const zunge = s && folge?.zunge ? folge.zunge : v;
      const lippen = s ? folge.lippen : v.lippen;
      const konsonanten = s?.enge ? [...s.enge] : [];
      const enge = lippen < 1.5 ? [...konsonanten, { ort: 41, weite: lippen }] : konsonanten;
      const velum = Math.max(0.01, s?.velum ?? 0.01);
      let f = gehalten.length ? 440 * 2 ** ((gehalten.at(-1) - 69) / 12) : w.frequenz;
      if (modul.eingangBelegt?.("Tonhöhe")) f *= 2 ** tonCv.wert();
      if (s && folge) f *= folge.ton;
      const an = s ? s.an !== false : w.dauer === "immer" || gehalten.length > 0 || ctx.currentTime < taktBis;
      knoten.port.postMessage({
        frequenz: f, spannung: w.spannung, lautstaerke: w.laut, an, stimmhaft: s ? s.stimmhaft ?? 1 : 1,
        vibrato: w.vibrato, zittern: 0.1, untertoene: 0, zungeOrt: zunge.zungeOrt, zungeWeite: zunge.zungeWeite, enge, velum,
        rauschStaerke: 1, art: w.art, bits: w.bits, abtast: 48000, evp: false,
        ...(w.art === "formanten" ? formantKlang(zunge.zungeOrt, zunge.zungeWeite, lippen, konsonanten, velum) : {}),
      });
    }, 15);

    const notenEin = (t, n, vel, dauer) => {
      setTimeout(() => {
        gehalten = gehalten.filter((x) => x !== n).concat(n);
        if (Number.isFinite(dauer)) setTimeout(() => (gehalten = gehalten.filter((x) => x !== n)), dauer * 1000);
      }, Math.max(0, (t - ctx.currentTime) * 1000));
    };
    notenEin.aus = (t, n) => setTimeout(() => (gehalten = gehalten.filter((x) => x !== n)), Math.max(0, (t - ctx.currentTime) * 1000));
    notenEin.alleAus = () => (gehalten = []);
    const taktEin = (t, dauer) => {
      if (text.trim() && sprich(t)) return;
      taktBis = t + (Number.isFinite(dauer) ? dauer : 0.5);
    };
    return {
      ein: {
        Noten: { art: "noten", ziel: notenEin }, Takt: { art: "takt", ziel: taktEin },
        "Tonhöhe": { art: "ton", ziel: tonCv.knoten }, Vokal: { art: "ton", ziel: vokalCv.knoten },
      },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "vokal", text: "Vokal u–i", min: 0, max: 1, wert: 0.5, setze: (v) => (w.vokal = v) },
        { name: "frequenz", text: "Ton", ...log(50, 600), wert: 110, einheit: "Hz", setze: (v) => (w.frequenz = v) },
        { name: "spannung", text: "Spannung", min: 0, max: 1, wert: 0.6, setze: (v) => (w.spannung = v) },
        { name: "vibrato", text: "Vibrato", min: 0, max: 3, wert: 0.5, einheit: "%", setze: (v) => (w.vibrato = v / 100) },
        { name: "tempo", text: "Sprechen", ...log(0.03, 0.3), wert: 0.07, einheit: "s", setze: (v) => (w.tempo = v) },
        { name: "bits", text: "Bits", min: 2, max: 16, wert: 16, schritt: 1, setze: (v) => (w.bits = v) },
        { name: "laut", text: "Pegel", min: 0, max: 1.5, wert: 0.8, setze: (v) => (w.laut = v) },
      ],
      wahl: [
        { name: "art", text: "Art", optionen: [["rohr", "Rohr (Pink Trombone)"], ["formanten", "Formanten (SAM)"]], wert: "rohr", setze: (v) => (w.art = v) },
        { name: "dauer", text: "Ton", optionen: [["noten", "nur mit Noten oder Takt"], ["immer", "immer"]], wert: "noten", setze: (v) => (w.dauer = v) },
        { name: "melodie", text: "Text", optionen: [["noten", "auf der Note"], ["singen", "singend (Pentatonik)"], ["fallend", "sprechend (fallend)"]], wert: "noten", setze: (v) => (w.melodie = v) },
      ],
      extra: (el) => {
        const feld = document.createElement("input");
        feld.type = "text";
        feld.className = "stimme-text";
        feld.placeholder = "Text (ein Takt spricht ihn)";
        feld.value = modul.werte.text ?? "";
        text = feld.value;
        feld.addEventListener("input", () => {
          text = modul.werte.text = feld.value;
          feld.dispatchEvent(new Event("change", { bubbles: true }));
        });
        el.append(feld);
      },
      weg: () => {
        clearInterval(uhr);
        knoten?.disconnect();
      },
    };
  },
};

export const STIMME_MODULE = { stimme };
