// Volumen-Viewer: die Seite. Die Ansicht (Bild, Kamera, Schnitte, Ausblenden, Aufbau, Export) steht in
// /lib/volumen/ (zusammen mit Rayleigh-Taylor benutzt); hier nur, was es nur beim Viewer gibt:
//   laden.js     NRRD/RAW lesen, Testkörper und Mandelbulb rechnen
//   dicom.js     DICOM-Ordner lesen
//   vorlage.js   eigene Seiten für einzelne Scans, die gleich beim Besuch geladen werden

import { ladeDateien, testkoerper, mandelbulb, halbiere } from "./laden.js";
import { erstelleAnsicht } from "/lib/volumen/ansicht.js";

// Voreinstellung einer eigenen Projektseite (vorlage.js); im Viewer selbst leer
const VOR = window.VOLUMEN ?? {};
for (const d of document.querySelectorAll("[data-teil]")) d.hidden = (VOR.verstecke ?? []).includes(d.dataset.teil);
const hole = (id) => document.getElementById(id);

let geladen = null;
const ansicht = erstelleAnsicht({
  extra: { aufloesung: () => zeige(geladen) },
  name: () => `volumen-${(geladen?.name ?? "leer").replace(/\.[^.]+$/, "")}`,
});
const { e, melde } = ansicht;

function zeige(v) {
  if (!v) return;
  geladen = v;
  ansicht.zeige(v, e.aufloesung === "halb" ? halbiere(v) : v);
  ["abstandX", "abstandY", "abstandZ"].forEach((id, i) => (hole(id).value = +v.abstand[i].toFixed(3)));
}

// ---------- Laden ----------
for (const id of ["datei", "ordner"]) hole(id).addEventListener("change", async (event) => {
  if (!event.target.files.length) return;
  melde("lädt …");
  try {
    zeige(await ladeDateien(event.target.files));
  } catch (fehler) {
    melde(fehler.message);
  }
});
// Voxelgröße von Hand (bei .raw ohne Kopf): ändert nur die Form, die Werte bleiben
for (const [i, id] of ["abstandX", "abstandY", "abstandZ"].entries()) {
  hole(id).addEventListener("change", () => {
    if (!geladen) return;
    const x = Number(hole(id).value);
    if (!(x > 0)) return;
    geladen.abstand[i] = x;
    const vol = ansicht.gezeigt();
    if (vol !== geladen) vol.abstand[i] = x * 2; // halbiert: doppelt so große Voxel
    ansicht.formNeu();
  });
}
hole("test").addEventListener("click", () => zeige(testkoerper(160)));
hole("bulb").addEventListener("click", () => zeige(mandelbulb(160)));

// Start: Dateien von der Voreinstellung, oder der Testkopf
async function anfangen() {
  if (VOR.daten) {
    melde("lädt …");
    try {
      const dateien = await Promise.all(VOR.daten.map(async (pfad) => new File([await (await fetch(pfad)).blob()], pfad.split("/").pop())));
      zeige(await ladeDateien(dateien));
    } catch (fehler) {
      melde(`Die Daten ließen sich nicht laden (${fehler.message}).`);
      zeige(testkoerper(128));
    }
  } else zeige(testkoerper(128));
  for (const [k, w] of Object.entries(VOR.einstellungen ?? {})) ansicht.setze(k, w);
  if (VOR.lage) ansicht.lage = VOR.lage;
  ansicht.transfer();
}
anfangen();
ansicht.starte();
