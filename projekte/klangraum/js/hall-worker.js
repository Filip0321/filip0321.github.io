// Die Strahlen in einem eigenen Thread rechnen (ein Web Worker): sonst stünde die Seite still, solange sie fliegen.
// Bekommt die Einstellungen, schickt die Energie je Band und Millisekunde zurück, dazu einige Wege fürs Bild und
// zum Vergleich dieselbe Rechnung in einem flachen Würfel gleicher Größe.

import { verfolge } from "./hall.js";

onmessage = (nachricht) => {
  const e = nachricht.data;
  const flach = e.wabe === "4,3,4";
  const a = verfolge(e, flach);
  const vergleich = flach ? null : verfolge({ ...e, strahlen: Math.min(e.strahlen, 8000) }, true);
  postMessage({
    energie: a.energie,
    vergleich: vergleich?.energie ?? null,
    wege: a.wege.map((w) => ({ p: w.map((x) => x.p), m: w.map((x) => x.m) })),
    hoerer: a.geom.hoererBild,
    quelle: a.geom.quelleBild,
  });
};
