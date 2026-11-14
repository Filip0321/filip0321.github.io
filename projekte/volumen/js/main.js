// Volumen-Viewer: die Seite. Die Ansicht (Bild, Kamera, Schnitte, Ausblenden, Aufbau, Export) steht in
// /lib/volumen/ (zusammen mit Rayleigh-Taylor benutzt); hier nur, was es nur beim Viewer gibt:
//   laden.js     NIfTI, MetaImage, NRRD, RAW lesen, Testkörper und Mandelbulb rechnen
//   dicom.js     DICOM-Ordner lesen
//   punktwolke.js Punkte und Gaussian Splats als PLY (Farbe wie im Bild)
//   vorlage.js   eigene Seiten für einzelne Scans, die gleich beim Besuch geladen werden

import { ladeDateien, testkoerper, mandelbulb, halbiere } from "./laden.js";
import { erstelleAnsicht } from "/lib/volumen/ansicht.js";
import { zaehlePunkte, erstellePunktdatei, MAX_PUNKTE } from "./punktwolke.js";
import { nachschlagen } from "/lib/volumen/tf.js";
import { segmentBei } from "/lib/volumen/segmente.js";
import { feldAusSegment, feldAusWerten, flaeche, inWelt, alsGlb, alsObj } from "/lib/volumen/netz.js";

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
  aktualisierePunktAusgabe();
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

// ---------- 3D-Export ----------
const punktSchwelle = hole("punktSchwelle");
const punktSchwelleWert = hole("punktSchwelleWert");
const punktSchritt = hole("punktSchritt");
const punktArt = hole("punktArt");
const punktQuelle = hole("punktQuelle");
const punktMindest = hole("punktMindest");
const punktStatus = hole("punktStatus");
const punktExport = hole("punktExport");
const punktGaussianRegler = document.querySelectorAll(".punkt-gauss-option");
let punktDaten = null;

function formatiereWert(wert) {
  return Number(wert).toLocaleString("de-DE", { maximumFractionDigits: 3 });
}
function speichere(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // große Dateien brauchen evtl. länger, bis der Download sie gelesen hat
}
function dateiBasis(v) {
  return (v.name ?? "volumen").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "volumen";
}

// Farbe und Deckkraft wie im Bild (wie im Shader, volumen.js): Kurve, in Segmenten eingefärbt oder nur dort,
// oder Segmente als feste Körper; null = nicht dabei
function farbeWieImBild(mindest) {
  const v = ansicht.geladen();
  const tf = ansicht.tf();
  const seg = ansicht.segmente();
  const anzeige = ansicht.segAnzeige();
  const tint = ansicht.segTint();
  const hell = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return (x, y, z, wert) => {
    let f = nachschlagen(tf, wert);
    if (seg && anzeige > 0) {
      const l = segmentBei(seg, (x + 0.5) / v.b, (y + 0.5) / v.h, (z + 0.5) / v.t);
      const sg = l > 0 ? seg.liste[l - 1] : null;
      const drin = !!sg?.sichtbar;
      if (anzeige === 3) return drin ? [...sg.farbe.map((c) => c / 255), sg.deckkraft] : null;
      if (anzeige === 2 && !drin) return null;
      if (drin) {
        const k = 0.35 + 0.9 * hell(f);
        f = [0, 1, 2].map((i) => f[i] + ((sg.farbe[i] / 255) * k - f[i]) * tint).concat(f[3] * sg.deckkraft);
        f = f.map((c) => Math.min(1, c));
      }
    }
    return f[3] >= mindest ? f : null;
  };
}
function punktOptionen() {
  const wieImBild = punktQuelle.value === "kurve";
  return {
    schwelle: Number(punktSchwelle.value),
    schritt: Number(punktSchritt.value),
    farbe: wieImBild ? farbeWieImBild(Number(punktMindest.value)) : null,
  };
}

function aktualisierePunktAusgabe() {
  const v = ansicht.geladen();
  document.querySelectorAll("[data-punkt]").forEach((el) => (el.hidden = el.dataset.punkt !== punktQuelle.value));
  document.querySelectorAll("[data-netz]").forEach((el) => (el.hidden = el.dataset.netz !== hole("netzQuelle").value));
  punktGaussianRegler.forEach((feld) => (feld.hidden = punktArt.value !== "gaussian"));
  if (!v || !ansicht.tf()) {
    punktStatus.textContent = "Erst ein Volumen laden.";
    punktExport.disabled = true;
    return;
  }
  const alt = Number(punktSchwelle.value);
  punktSchwelle.min = v.min;
  punktSchwelle.max = v.max;
  const bereich = Math.max(0, v.max - v.min);
  punktSchwelle.step = bereich > 1000 ? 1 : Math.max(bereich / 1000, 0.001);
  const start = punktDaten === v && Number.isFinite(alt)
    ? Math.max(v.min, Math.min(v.max, alt))
    : (v.ct ? Math.max(v.min, Math.min(v.max, 300)) : v.min + bereich * 0.5);
  if (punktDaten !== v) hole("netzSchwelle").value = +start.toFixed(2);
  punktDaten = v;
  punktSchwelle.value = start;
  punktSchwelleWert.textContent = formatiereWert(start);
  const o = punktOptionen();
  const anzahl = zaehlePunkte(v, ansicht.maske(), start, o.schritt, MAX_PUNKTE, o.farbe);
  const zuViele = anzahl > MAX_PUNKTE;
  punktStatus.textContent = `${zuViele ? `Mehr als ${MAX_PUNKTE.toLocaleString("de-DE")}` : anzahl.toLocaleString("de-DE")} Punkte bei Schrittweite ${o.schritt}.` +
    (zuViele ? ` Für den Export sind höchstens ${MAX_PUNKTE.toLocaleString("de-DE")} erlaubt: Schrittweite erhöhen oder weniger zeigen.` : "");
  punktExport.disabled = anzahl === 0 || zuViele;
}

punktSchwelle.addEventListener("input", () => {
  punktSchwelleWert.textContent = formatiereWert(punktSchwelle.value);
});
for (const feld of [punktSchwelle, punktSchritt, punktArt, punktQuelle, punktMindest, hole("netzQuelle")]) feld.addEventListener("change", aktualisierePunktAusgabe);
// die Zahl der Punkte hängt bei „wie im Bild“ an der Kurve und den Segmenten: beim Öffnen des Abschnitts neu zählen
punktExport.closest("details")?.addEventListener("toggle", aktualisierePunktAusgabe);
let gezaehlt = 0;
punktExport.closest("details")?.addEventListener("pointerenter", () => {
  if (performance.now() - gezaehlt < 2000) return; // höchstens alle 2 s (große Scans zählen spürbar)
  gezaehlt = performance.now();
  aktualisierePunktAusgabe();
});

punktExport.addEventListener("click", () => {
  const v = ansicht.geladen();
  if (!v) return;
  try {
    const ausgabe = erstellePunktdatei(v, ansicht.maske(), {
      ...punktOptionen(),
      art: punktArt.value,
      groesse: Number(hole("gaussGroesse").value),
      deckkraft: Number(hole("gaussDeckkraft").value),
      lage: ansicht.lage,
    });
    const name = `${dateiBasis(v)}${ausgabe.gaussian ? "-gaussian-splats.ply" : "-punktwolke.ply"}`;
    speichere(ausgabe.blob, name);
    punktStatus.textContent = `${ausgabe.anzahl.toLocaleString("de-DE")} Punkte exportiert: ${name}`;
  } catch (fehler) {
    punktStatus.textContent = fehler.message;
  }
});

// Netz: Surface Nets aus den Segmenten oder aus einer Schwelle (lib/volumen/netz.js)
const netzStatus = hole("netzStatus");
function netzTeile(format) {
  const v = ansicht.geladen();
  const faktor = Number(hole("netzFaktor").value);
  const ausdehnung = [v.b * v.abstand[0], v.h * v.abstand[1], v.t * v.abstand[2]];
  const echt = hole("netzGroesse").value === "echt";
  const skala = echt ? (format === "glb" ? 0.001 : 1) : 1 / Math.max(...ausdehnung);
  const teile = [];
  if (hole("netzQuelle").value === "segmente") {
    const seg = ansicht.segmente();
    if (!seg?.liste.some((s) => s.sichtbar)) throw new Error("Keine sichtbaren Segmente. Erst im Abschnitt „Segmente“ welche anlegen, oder „aus einer Schwelle“ wählen.");
    seg.liste.forEach((s, i) => {
      if (!s.sichtbar) return;
      // die Segmente sind bei großen Scans schon halb so fein: den Faktor darauf umrechnen
      const feld = feldAusSegment(seg, i + 1, Math.max(1, Math.round(faktor / seg.f)));
      teile.push({ name: s.name, farbe: s.farbe, deckkraft: s.deckkraft >= 0.95 ? 1 : s.deckkraft, netz: inWelt(flaeche(feld), feld, ausdehnung, ansicht.lage, skala) });
    });
  } else {
    const schwelle = Number(hole("netzSchwelle").value);
    const feld = feldAusWerten(v, ansicht.maske(), schwelle, faktor);
    const f = nachschlagen(ansicht.tf(), schwelle);
    const farbe = f[3] > 0.01 ? f.slice(0, 3).map((c) => Math.round(c * 255)) : [233, 220, 196];
    teile.push({ name: `Schwelle ${schwelle}`, farbe, deckkraft: 1, netz: inWelt(flaeche(feld), feld, ausdehnung, ansicht.lage, skala) });
  }
  return teile;
}
for (const [id, format] of [["netzGlb", "glb"], ["netzObj", "obj"]]) {
  hole(id).addEventListener("click", () => {
    const v = ansicht.geladen();
    if (!v) return;
    netzStatus.textContent = "rechnet …";
    // erst die Meldung zeichnen lassen, dann rechnen (das blockiert die Seite ein paar Sekunden)
    setTimeout(() => {
      try {
        const teile = netzTeile(format);
        const dreiecke = teile.reduce((n, t) => n + t.netz.idx.length / 3, 0);
        if (!dreiecke) throw new Error("Das Netz ist leer: Schwelle oder Segmente prüfen.");
        const blob = format === "glb" ? alsGlb(teile) : alsObj(teile);
        const name = `${dateiBasis(v)}-netz.${format}`;
        speichere(blob, name);
        netzStatus.textContent = `${teile.length} ${teile.length === 1 ? "Objekt" : "Objekte"}, ${dreiecke.toLocaleString("de-DE")} Dreiecke, ${(blob.size / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB: ${name}`;
      } catch (fehler) {
        netzStatus.textContent = fehler.message;
      }
    }, 30);
  });
}

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


