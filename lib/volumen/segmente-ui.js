// Bedienung der Segmente (segmente.js): Liste, das gewählte Segment, Vorlagen, Knöpfe.
// Gemalt und geklickt wird in den Schnitten (ansicht.js → malen), mit den Werkzeugen „Segment: …“.
//
// richteSegmenteEin(api) mit api = { segmente(), geladen(), maske(), histogramm(), kurvenBereich(), neu() }
// gibt { neuesVolumen(), aktualisiere() } zurück. neu(): Volumen und Schnitte neu zeichnen.

import { neuesSegment, schwelle, glaetten, leeren, entfernen, zaehle, merkeSegmente, segmentRueckgaengig, HOECHSTENS } from "./segmente.js";

const hole = (id) => document.getElementById(id);
const hex = (f) => "#" + f.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const ausHex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

// Vorlagen: Name, Bereich, Farbe. CT in Hounsfield-Einheiten; sonst aus Perzentilen (Anteile des Vordergrunds)
const CT_VORLAGEN = [
  ["Gehirn", 15, 55, [240, 180, 175]],
  ["Knochen", 300, 3000, [242, 232, 214]],
  ["Gefäße (Kontrastmittel)", 150, 500, [220, 70, 60]],
  ["Weichteile, Muskeln", 20, 90, [200, 90, 80]],
  ["Fett", -150, -50, [235, 210, 130]],
  ["Hirnwasser", 0, 15, [110, 150, 230]],
  ["Körper (alles außer Luft)", -400, 3000, [226, 170, 140]],
  ["Lunge, Luft im Körper", -950, -400, [150, 190, 240]],
];
const ANTEIL_VORLAGEN = [
  ["dunkle Stellen", 0.0, 0.3, [110, 150, 230]],
  ["mittlere Stellen", 0.35, 0.85, [240, 180, 175]],
  ["helle Stellen", 0.9, 1.0, [250, 220, 120]],
  ["alles (ohne Hintergrund)", 0.0, 1.0, [226, 170, 140]],
];

export function richteSegmenteEin(api) {
  const liste = hole("segListe");
  if (!liste) return null;
  const felder = {
    name: hole("segName"), farbe: hole("segFarbe"), deckkraft: hole("segDeckkraft"),
    von: hole("segVon"), bis: hole("segBis"), vorlage: hole("segVorlage"), nurLeere: hole("segNurLeere"), info: hole("segInfo"),
  };
  let zellen = []; // gezählt nach jeder Änderung

  const s = () => api.segmente();
  const aktiv = () => (s() && s().aktiv > 0 ? s().liste[s().aktiv - 1] : null);

  function vorlagen() {
    const v = api.geladen();
    if (v?.ct) return CT_VORLAGEN.map(([n, a, b, f]) => [n, a, b, f]);
    const h = api.histogramm();
    if (!h) return [];
    return ANTEIL_VORLAGEN.map(([n, a, b, f]) => [n, a === 0 ? h.perzentil(0, true) : h.perzentil(a, true), b === 1 ? h.hi : h.perzentil(b, true), f]);
  }
  function fuelleVorlagen() {
    felder.vorlage.innerHTML = '<option value="">Vorlage …</option>' + vorlagen().map(([n, a, b], i) => `<option value="${i}">${n} (${+a.toFixed(1)} bis ${+b.toFixed(1)})</option>`).join("");
  }

  // Größe einer Zelle in ml (Voxelgröße in mm angenommen, wie bei DICOM und NIfTI üblich)
  function ml(n) {
    const v = api.geladen();
    if (!v) return "";
    const f = [v.b / s().b, v.h / s().h, v.t / s().t];
    const mm3 = v.abstand[0] * f[0] * v.abstand[1] * f[1] * v.abstand[2] * f[2];
    return `${((n * mm3) / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ml`;
  }

  function zeichneListe() {
    const sg = s();
    if (!sg) return;
    liste.innerHTML = "";
    sg.liste.forEach((seg, i) => {
      const nr = i + 1;
      const li = document.createElement("li");
      li.className = "seg-eintrag" + (nr === sg.aktiv ? " aktiv" : "");
      const sicht = document.createElement("input");
      sicht.type = "checkbox";
      sicht.checked = seg.sichtbar;
      sicht.title = "zeigen";
      sicht.addEventListener("change", () => {
        seg.sichtbar = sicht.checked;
        api.neu();
      });
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.innerHTML = `<span class="seg-farbe" style="background:${hex(seg.farbe)}"></span>${seg.name} <small>${ml(zellen[nr] ?? 0)}</small>`;
      knopf.addEventListener("click", () => {
        sg.aktiv = nr;
        aktualisiere();
      });
      li.append(sicht, knopf);
      liste.append(li);
    });
  }
  function zeigeAktiv() {
    const seg = aktiv();
    hole("segAktiv").hidden = !seg;
    if (!seg) return;
    felder.name.value = seg.name;
    felder.farbe.value = hex(seg.farbe);
    felder.deckkraft.value = seg.deckkraft;
  }
  function aktualisiere() {
    if (!s()) return;
    zellen = zaehle(s());
    zeichneListe();
    zeigeAktiv();
    hole("segNeu").disabled = s().liste.length >= HOECHSTENS;
  }
  function geaendert(text) {
    aktualisiere();
    api.neu();
    if (text !== undefined) felder.info.textContent = text;
  }

  hole("segNeu").addEventListener("click", () => {
    if (!s()) return;
    neuesSegment(s());
    geaendert("Neues Segment. Bereich einstellen (oder eine Vorlage wählen), dann „ganzen Bereich füllen“ oder mit „Segment: Klick füllt Zusammenhängendes“ in einen Schnitt klicken.");
  });
  felder.name.addEventListener("input", () => {
    if (aktiv()) aktiv().name = felder.name.value;
    zeichneListe();
  });
  felder.farbe.addEventListener("input", () => {
    if (!aktiv()) return;
    aktiv().farbe = ausHex(felder.farbe.value);
    geaendert();
  });
  felder.deckkraft.addEventListener("input", () => {
    if (!aktiv()) return;
    aktiv().deckkraft = Number(felder.deckkraft.value);
    api.neu();
  });
  felder.vorlage.addEventListener("change", () => {
    const v = vorlagen()[Number(felder.vorlage.value)];
    if (!v) return;
    const [name, von, bis, farbe] = v;
    // eine Vorlage gilt für das gewählte Segment, solange es leer ist; sonst kommt ein neues dazu
    if (!aktiv() || zaehle(s())[s().aktiv] > 0) {
      if (neuesSegment(s()) < 0) return;
    }
    Object.assign(aktiv(), { name, farbe: [...farbe] });
    felder.von.value = +von.toFixed(2);
    felder.bis.value = +bis.toFixed(2);
    felder.vorlage.value = "";
    geaendert(`„${name}“: Bereich ${+von.toFixed(1)} bis ${+bis.toFixed(1)}. Jetzt ganz füllen, oder (meist besser) mit dem Werkzeug „Segment: Klick füllt Zusammenhängendes“ in einen Schnitt klicken.`);
  });
  hole("segAusKurve").addEventListener("click", () => {
    const [von, bis] = api.kurvenBereich();
    felder.von.value = +von.toFixed(2);
    felder.bis.value = +bis.toFixed(2);
  });
  hole("segSchwelle").addEventListener("click", () => {
    if (!aktiv()) neuesSegment(s());
    merkeSegmente(s());
    const n = schwelle(s(), api.geladen(), api.maske(), s().aktiv, Number(felder.von.value), Number(felder.bis.value), felder.nurLeere.checked);
    geaendert(`${n.toLocaleString("de-DE")} Zellen gefüllt.`);
  });
  hole("segGlaetten").addEventListener("click", () => {
    if (!aktiv()) return;
    merkeSegmente(s());
    glaetten(s(), s().aktiv);
    geaendert("Geglättet: kleine Löcher zu, einzelne Krümel weg.");
  });
  hole("segLeeren").addEventListener("click", () => {
    if (!aktiv()) return;
    merkeSegmente(s());
    leeren(s(), s().aktiv);
    geaendert("Geleert.");
  });
  hole("segLoeschen").addEventListener("click", () => {
    if (!aktiv()) return;
    merkeSegmente(s());
    entfernen(s(), s().aktiv);
    geaendert("Gelöscht.");
  });
  hole("segRueck").addEventListener("click", () => {
    if (s() && segmentRueckgaengig(s())) geaendert("Rückgängig gemacht.");
  });

  return {
    neuesVolumen() {
      fuelleVorlagen();
      felder.info.textContent = "";
      aktualisiere();
    },
    aktualisiere,
    bereich: () => [Number(felder.von.value), Number(felder.bis.value)],
    nurLeere: () => felder.nurLeere.checked,
    melde: (text) => (felder.info.textContent = text),
  };
}
