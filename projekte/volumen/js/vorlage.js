// Eigene Projektseiten aus dem Volumen-Viewer: Scans, die gleich beim Besuch geladen werden.
// (Rayleigh-Taylor hat seit der Aufteilung eine eigene Seite und benutzt nur die Ansicht aus /lib/volumen/.)
// Statt die ganze Bedienung in jede Seite zu kopieren, holt diese Datei sie aus /projekte/volumen/index.html und
// setzt sie in die Seite ein; dann startet main.js mit einer Voreinstellung. Ändert sich der Viewer, ändern sich alle
// Seiten mit.
//
// einstellung: {
//   daten:        ["pfad/scan.nrrd"]           Dateien, die geladen werden (NRRD, NHDR mit RAW, DICOM-Dateien)
//   verstecke:    ["daten", "simulation", …]   Abschnitte der Bedienung, die die Seite nicht zeigt
//   einstellungen: { regler: wert, … }         nach dem Laden gesetzt (Namen wie data-wert in der Bedienung)
//   lage:         [9 Zahlen]                   Ausrichtung des Volumens (spaltenweise), sonst wie im Viewer
// }

export async function baueSeite(einstellung) {
  const text = await (await fetch("/projekte/volumen/index.html")).text();
  const vorlage = new DOMParser().parseFromString(text, "text/html");
  const main = document.querySelector("main");
  for (const teil of [".feld-rahmen", ".bedienung"]) main.append(document.importNode(vorlage.querySelector(teil), true));
  window.VOLUMEN = einstellung;
  // der Export braucht Mediabunny (ein normales Skript, kein Modul); fehlt es in der Seite, hier nachladen
  if (!window.Mediabunny) {
    await new Promise((fertig) => {
      const s = document.createElement("script");
      s.src = "/lib/mediabunny.js";
      s.onload = s.onerror = fertig;
      document.head.append(s);
    });
  }
  await import("./main.js");
}
