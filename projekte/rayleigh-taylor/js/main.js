// Rayleigh-Taylor: die Seite. Gerechnet wird in /lib/volumen/sim3d.js (Strömung in 3D auf der Grafikkarte),
// gezeigt mit derselben Ansicht wie die CT-Daten im Volumen-Viewer (/lib/volumen/ansicht.js). Hier nur, was es nur
// bei der Simulation gibt: die drei Versuche, starten, weiterrechnen.

import { erstelleAnsicht } from "/lib/volumen/ansicht.js";
import { erstelleSimulation } from "/lib/volumen/sim3d.js";

const hole = (id) => document.getElementById(id);
let sim = null;
let simZeit = 0;
let simLesen = 0;

const ansicht = erstelleAnsicht({
  name: () => `rayleigh-taylor-${e.simArt}`,
  schritt: (dt) => {
    if (sim && ansicht.gezeigt() && !e.simPause) simSchritt(dt);
  },
});
const { e, setze, melde } = ansicht;
// die Vorschau beim Export: die Simulation lässt sich nicht zurückspulen, also steht sie dort still
ansicht.beiVorschau(() => {
  const p = e.simPause;
  e.simPause = true;
  return () => (e.simPause = p);
});

// Voreinstellungen je Versuch: Größe des Tanks (relativ zur Gitterzahl) und wie es aussieht
const VERSUCHE = {
  rt: { nummer: 0, form: [1, 1, 1], name: "Rayleigh-Taylor", skala: "eis", deckkraft: 0.35, gamma: 1.2, von: 0.05 },
  wolken: { nummer: 1, form: [1.5, 1, 1], name: "Wolkentank", skala: "grau", deckkraft: 0.18, gamma: 1.4, von: 0.02 },
  tropfen: { nummer: 2, form: [1, 1.25, 1], name: "Tropfen Tinte", skala: "glut", deckkraft: 0.3, gamma: 1.3, von: 0.03 },
};
function simStarten() {
  try {
    sim ??= erstelleSimulation(ansicht.volumen.gl);
  } catch (fehler) {
    return melde(fehler.message);
  }
  const v = VERSUCHE[e.simArt];
  const N = Number(e.simGitter);
  const groesse = v.form.map((f) => Math.round(f * N));
  sim.neu(groesse, v.nummer, { unruhe: e.simUnruhe, schicht: e.simSchicht, saat: Math.random() * 100 });
  simZeit = 0;
  simLesen = 0;
  const [b, h, t] = groesse;
  ansicht.zeige({ b, h, t, werte: new Float32Array(b * h * t), abstand: [1, 1, 1], name: v.name, ct: false, min: 0, max: 1, textur: () => sim.textur() });
  setze("von", v.von);
  setze("bis", 1);
  setze("skala", v.skala);
  setze("deckkraft", v.deckkraft);
  setze("gamma", v.gamma);
  ansicht.transfer();
}
function simSchritt(dt) {
  const t = dt * e.simTempo;
  if (t <= 0) return;
  // große Zeitschritte in kleinere teilen (höchstens 1/30 s), sonst rechnet die Mitnahme zu grob
  const k = Math.ceil(t / (1 / 30));
  for (let i = 0; i < k; i++) {
    sim.schritt(t / k, { auftrieb: e.simSchwere, salz: e.simSalz, duese: e.simDuese, strahl: e.simStrahl, jacobi: e.simJacobi });
  }
  simZeit += t;
  ansicht.neu();
  if (e.simNeuNach > 0 && simZeit > e.simNeuNach) return simStarten(); // von vorn (läuft immer weiter)
  // ab und zu die Werte auf die CPU holen: für die Schnitte, den Pinsel und „Stück behalten“ (kostet: nicht jedes Bild)
  if (ansicht.schnitteOffen() && simZeit - simLesen > 0.5) {
    simLesen = simZeit;
    sim.lies(ansicht.gezeigt().werte);
    ansicht.zeichneSchnitte();
  }
}
hole("simStart").addEventListener("click", simStarten);
// Versuch gewechselt: gleich neu starten (sonst passt die Form des Tanks nicht zur Auswahl)
for (const n of ["simArt", "simGitter"]) document.querySelector(`[data-wert="${n}"]`).addEventListener("input", simStarten);

simStarten();
ansicht.starte();
