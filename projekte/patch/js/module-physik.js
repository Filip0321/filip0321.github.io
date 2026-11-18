// Physikalische Modelle (Runde 24): Blasrohr und Bogen (die Rechnung steht in worklets.js).
// Anders als ein Oszillator klingen sie nicht von selbst: Sie brauchen Druck (Atem, Bogen) am Eingang „Druck“,
// meist von einer Hüllkurve. Ohne Druck: still. Mit zu wenig Druck: ein Hauch, der Ton springt nicht an.

import { log, verstaerker } from "./bausteine.js";
import { linienBild } from "./anzeigen.js";

function wellenleiter(name, titel, arten, texte) {
  return {
    titel,
    gruppe: "Klang",
    baue(ctx) {
      const knoten = new AudioWorkletNode(ctx, name, { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { art: arten?.[0]?.[0] } });
      const p = (n) => knoten.parameters.get(n);
      const tonhoehe = verstaerker(ctx, 1), druck = verstaerker(ctx, 1);
      tonhoehe.connect(p("tonhoehe"));
      druck.connect(p("druck"));
      const aus = verstaerker(ctx, 1);
      knoten.connect(aus);
      const setze = (n) => (v) => p(n).setTargetAtTime(v, ctx.currentTime, 0.01);
      return {
        ein: {
          "Tonhöhe": { art: "ton", ziel: tonhoehe },
          Druck: { art: "ton", ziel: druck, info: texte.druck },
        },
        aus: { aus: { art: "ton", knoten: aus } },
        regler: [
          { name: "frequenz", text: "Frequenz", ...log(30, 2000), wert: 220, einheit: "Hz", setze: setze("frequenz") },
          { name: "staerke", text: texte.staerke, min: 0, max: 1.5, wert: texte.staerkeWert ?? 0.75, setze: setze("staerke") },
          { name: "blatt", text: texte.blatt, min: 0, max: 1, wert: texte.blattWert ?? 0.5, setze: setze("blatt") },
          { name: "luft", text: texte.luft, min: 0, max: 1, wert: texte.luftWert, setze: setze("luft") },
          { name: "pegel", text: "Pegel", min: 0, max: 4, wert: 1, setze: (v) => aus.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
        ],
        wahl: arten ? [{ name: "art", text: "Art", optionen: arten, wert: arten[0][0], setze: (v) => knoten.port.postMessage({ art: v }) }] : [],
        weg: () => knoten.disconnect(),
      };
    },
  };
}

const blasrohr = wellenleiter("blasrohr", "Blasrohr", [["klarinette", "Klarinette (Zylinder, Blatt)"], ["saxophon", "Saxophon (Kegel, Blatt)"], ["floete", "Flöte (Luftkante)"]], {
  druck: "Atem 0 … 1, meist eine Hüllkurve. Ohne Druck kein Ton.",
  staerke: "Stärke", blatt: "Blatt", luft: "Luft", luftWert: 0.15,
});
const bogen = wellenleiter("bogen", "Bogen", null, {
  druck: "Bogengeschwindigkeit 0 … 1, meist eine Hüllkurve. Ohne Bogen kein Ton.",
  staerke: "Stärke", blatt: "Bogendruck", luft: "Stelle", luftWert: 0.3, blattWert: 0.6, staerkeWert: 1,
});

// ---------- Wavetable (Runde 24) ----------
// Acht Frames, je als Rezept von Obertönen (additiv: Frame = Summe von Sinussen k · f mit Stärke a_k). Additiv
// gebaut, weil man dann leicht weniger Obertöne nehmen kann (für hohe Töne) und jeder Frame „sauber“ ist.
//   0 Sinus   1 Dreieck   2 Sägezahn   3 Rechteck   4 schmaler Puls   5 Vokal „a“   6 Vokal „i“   7 Glas (nur 1, 3, 7, 11 …)
// Die Vokale: Obertöne gewichtet nach zwei Formanten (a: 700 und 1200 Hz, i: 300 und 2300 Hz) für einen Grundton
// von 130 Hz, also wie eine Stimme, die „a“ singt. Das wird beim Transponieren mitverschoben (das echte Formant
// bliebe stehen), aber es klingt sprechend, und mit der Position kann man von „a“ nach „i“ gleiten.
const FRAMES = [
  (k) => (k === 1 ? 1 : 0),
  (k) => (k % 2 ? (((k - 1) / 2) % 2 ? -1 : 1) / (k * k) : 0),
  (k) => 1 / k,
  (k) => (k % 2 ? 1 / k : 0),
  (k) => Math.sin((Math.PI * k) / 8) / k,
  (k) => Math.exp(-(((k * 130 - 700) / 150) ** 2)) + 0.6 * Math.exp(-(((k * 130 - 1200) / 200) ** 2)) + 0.3 / k,
  (k) => Math.exp(-(((k * 130 - 300) / 120) ** 2)) + 0.5 * Math.exp(-(((k * 130 - 2300) / 250) ** 2)) + 0.2 / k,
  (k) => ([1, 3, 7, 11, 17, 23].includes(k) ? 1 / Math.sqrt(k) : 0),
];
export const FRAME_NAMEN = ["Sinus", "Dreieck", "Säge", "Rechteck", "Puls", "Vokal a", "Vokal i", "Glas"];
let TABELLEN = null;
function tabellen() {
  if (TABELLEN) return TABELLEN;
  const L = 2048;
  TABELLEN = FRAMES.map((rezept) => [64, 16, 4].map((obertoene) => {
    const t = new Float32Array(L);
    for (let k = 1; k <= obertoene; k++) {
      const a = rezept(k);
      if (!a) continue;
      for (let i = 0; i < L; i++) t[i] += a * Math.sin((2 * Math.PI * k * i) / L);
    }
    let m = 0;
    for (const v of t) m = Math.max(m, Math.abs(v));
    for (let i = 0; i < L; i++) t[i] /= m || 1;
    return t;
  }));
  return TABELLEN;
}
const wavetable = {
  titel: "Wavetable",
  gruppe: "Klang",
  baue(ctx, { bild }) {
    const t = tabellen();
    const knoten = new AudioWorkletNode(ctx, "wavetable", { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { tabellen: t } });
    const p = (n) => knoten.parameters.get(n);
    const tonhoehe = verstaerker(ctx, 1), position = verstaerker(ctx, 1), aus = verstaerker(ctx, 0.5);
    tonhoehe.connect(p("tonhoehe"));
    position.connect(p("position"));
    knoten.connect(aus);
    const w = { position: 0 };
    // Bild: der Frame an der Knopf-Position (überblendet, wie er klingt; ohne Kabel-Modulation)
    const bildchen = linienBild(bild, () => {
      const pos = w.position * (t.length - 1), a = Math.min(t.length - 2, Math.floor(pos)), r = pos - a;
      return Array.from({ length: 128 }, (_, i) => t[a][0][i * 16] * (1 - r) + t[a + 1][0][i * 16] * r);
    }, { unten: -1.1, oben: 1.1 });
    const setze = (n) => (v) => p(n).setTargetAtTime(v, ctx.currentTime, 0.01);
    return {
      ein: {
        "Tonhöhe": { art: "ton", ziel: tonhoehe },
        Position: { art: "ton", ziel: position, info: "wird zur Position addiert: 1,0 = die ganze Tabelle weiter (von Sinus bis Glas)" },
      },
      aus: { aus: { art: "ton", knoten: aus } },
      regler: [
        { name: "frequenz", text: "Frequenz", ...log(20, 4000), wert: 261.63, einheit: "Hz", setze: setze("frequenz") },
        { name: "position", text: "Position", min: 0, max: 1, wert: 0, setze: (v) => { w.position = v; p("position").setTargetAtTime(v, ctx.currentTime, 0.01); } },
        { name: "verstimmen", text: "Unisono", min: 0, max: 50, wert: 0, einheit: "Cent", setze: setze("verstimmen") },
        { name: "pegel", text: "Pegel", min: 0, max: 1, wert: 0.5, setze: (v) => aus.gain.setTargetAtTime(v, ctx.currentTime, 0.02) },
      ],
      extra: bildchen.extra,
      weg: () => {
        bildchen.weg();
        knoten.disconnect();
      },
    };
  },
};

export const PHYSIK_MODULE = { blasrohr, bogen, wavetable };
