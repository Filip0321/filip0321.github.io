// Was im Export zu sehen ist: Felder, Abschnitte und die Bilder der Stufen (gezeichnet von video.js)

import { farbenZahlen } from "/lib/farben.js";
import { rahmenMasse, massstab } from "/lib/export-dialog.js";

const HOEHE = 2160; // Grundhöhe zum Planen (Lücken, Schrift); wie groß es am Ende wird, bestimmt massstab()
const LUECKE = 0.03; // Abstand zwischen Feldern, Anteil der Feldhöhe
const TEXT = 0.14; // Platz für "Runde 3" über einem Feld, Anteil der Feldhöhe

const gerade = (zahl) => zahl - (zahl % 2); // H.264 verlangt gerade Maße

// Stufe als kleines Bild, ein Pixel pro Rasterpunkt (wie zeigeRaster): in der Farbskala oder grau
function rasterBild({ raster, spalten, zeilen }, grau) {
  const klein = document.createElement("canvas");
  klein.width = spalten;
  klein.height = zeilen;
  const c = klein.getContext("2d");
  const daten = c.createImageData(spalten, zeilen);
  const pixel = daten.data;
  for (let y = 0; y < zeilen; y++) {
    for (let x = 0; x < spalten; x++) {
      const v = Math.round(raster[x * zeilen + (zeilen - 1 - y)] * 255); // umdrehen: tief nach unten
      const p = (y * spalten + x) * 4;
      pixel[p] = grau ? v : farbenZahlen[v * 3];
      pixel[p + 1] = grau ? v : farbenZahlen[v * 3 + 1];
      pixel[p + 2] = grau ? v : farbenZahlen[v * 3 + 2];
      pixel[p + 3] = 255;
    }
  }
  c.putImageData(daten, 0, 0);
  return klein;
}

// Pixel eines Bilds, auf breite × hoehe gezogen (weich)
function pixelVon(bild, breite, hoehe) {
  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  c.imageSmoothingQuality = "high";
  c.drawImage(bild, 0, 0, breite, hoehe);
  return c.getImageData(0, 0, breite, hoehe);
}

// Stufe in den Farben des Originals: Helligkeit aus der Stufe, Farbe aus dem Foto
function inOriginalFarben(stufe, foto, breite, hoehe) {
  const neu = pixelVon(rasterBild(stufe, true), breite, hoehe); // die Stufe weich vergrößert: nur ihre Helligkeit zählt
  const alt = pixelVon(foto, breite, hoehe); // das Foto verzerrt wie das Raster
  const a = alt.data;
  const n = neu.data;
  for (let p = 0; p < a.length; p += 4) {
    let r = a[p] / 255;
    let g = a[p + 1] / 255;
    let b = a[p + 2] / 255;
    if (stufe.negativ) {
      // die Stufe ist ein Negativ des Fotos: dann auch die Farben umdrehen
      r = 1 - r;
      g = 1 - g;
      b = 1 - b;
    }
    const y0 = 0.2126 * r + 0.7152 * g + 0.0722 * b; // Helligkeit des Fotos (wie in rastere)
    const y1 = n[p] / 255; // Helligkeit der Stufe (grau: rot = grün = blau)
    // Farbe = Abstand jedes Kanals von der Helligkeit (r − y0 …). Den legen wir auf die neue Helligkeit
    // und stauchen ihn gerade so weit, dass kein Kanal unter 0 oder über 1 rutscht:
    // dunkler werden -> mal y1 / y0, heller werden -> mal (1 − y1) / (1 − y0). Schwarz bleibt schwarz.
    const stauchen = y1 <= y0 ? (y0 > 0 ? y1 / y0 : 0) : y0 < 1 ? (1 - y1) / (1 - y0) : 0;
    a[p] = Math.round((y1 + (r - y0) * stauchen) * 255);
    a[p + 1] = Math.round((y1 + (g - y0) * stauchen) * 255);
    a[p + 2] = Math.round((y1 + (b - y0) * stauchen) * 255);
  }
  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  canvas.getContext("2d").putImageData(alt, 0, 0);
  return canvas;
}

// Bilder der Stufen merken: die Vorschau zeichnet bei jeder Änderung neu, das Rechnen soll nur einmal sein
const gemerkt = new WeakMap(); // Stufe -> Map(Schlüssel -> Bild); fällt mit der Stufe weg

// raster: Farbskala, das kleine Raster reicht (video.js vergrößert es scharf)
// verzerrt und original: Farben des Fotos, in voller Feldgröße gerechnet
function stufenBild(stufe, ansicht, breite, hoehe, quellen) {
  const schluessel = ansicht === "raster" ? `raster ${quellen.farbskala}` : `farbig ${breite}×${hoehe}`;
  if (!gemerkt.has(stufe)) gemerkt.set(stufe, new Map());
  const bilder = gemerkt.get(stufe);
  if (!bilder.has(schluessel)) {
    bilder.set(schluessel, ansicht === "raster"
      ? rasterBild(stufe, false)
      : inOriginalFarben(stufe, quellen.foto, breite, hoehe));
  }
  return bilder.get(schluessel);
}

// das jetzige Original (verzerrt oder nicht, das macht die Feldgröße), wie zeigeOriginal in bild.js
function originalBild(original, invertieren, breite, hoehe) {
  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  const c = canvas.getContext("2d");
  c.imageSmoothingQuality = "high";
  c.drawImage(original, 0, 0, breite, hoehe);
  if (invertieren) {
    c.globalCompositeOperation = "difference"; // |Bild − Weiß| = Negativ
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, breite, hoehe);
  }
  return canvas;
}

// Felder in Grundmaßen (vor dem Verkleinern)
function felderAnsicht(verhaeltnis) {
  return { breite: HOEHE * verhaeltnis, hoehe: HOEHE, felder: [{ x: 0, y: 0, breite: HOEHE * verhaeltnis, hoehe: HOEHE }], texte: [] };
}

// zwei Stufen gleich groß, übereinander oder nebeneinander
function felderPaar(verhaeltnis, nebeneinander) {
  const h = HOEHE;
  const b = h * verhaeltnis;
  const luecke = Math.round(h * LUECKE);
  const zweites = nebeneinander ? { x: b + luecke, y: 0 } : { x: 0, y: h + luecke };
  return {
    breite: nebeneinander ? 2 * b + luecke : b,
    hoehe: nebeneinander ? h : 2 * h + luecke,
    felder: [{ x: 0, y: 0, breite: b, hoehe: h }, { ...zweites, breite: b, hoehe: h }],
    texte: [],
  };
}

function felderGitter(anzahl, spalten, verhaeltnis, beschriftung) {
  spalten = Math.min(Math.max(1, spalten), anzahl);
  const reihen = Math.ceil(anzahl / spalten);
  const h = HOEHE / reihen;
  const b = h * verhaeltnis;
  const luecke = h * LUECKE;
  const text = beschriftung ? h * TEXT : 0;
  const felder = [];
  const texte = [];
  for (let i = 0; i < anzahl; i++) {
    const x = luecke + (i % spalten) * (b + luecke);
    const y = luecke + Math.floor(i / spalten) * (text + h + luecke) + text;
    felder.push({ x, y, breite: b, hoehe: h });
    if (beschriftung) texte.push({ inhalt: i === 0 ? "Start" : `Runde ${i}`, x, y: y - text / 2 });
  }
  return {
    breite: luecke + spalten * (b + luecke),
    hoehe: luecke + reihen * (text + h + luecke),
    felder,
    texte,
    schrift: text * 0.6,
  };
}

// wie hoch wird eine Stufe im fertigen Bild? Damit lassen sich Anordnungen vergleichen
function stufenHoehe(plan, einst) {
  const ganz = rahmenMasse(plan.breite, plan.hoehe, einst);
  return plan.felder[0].hoehe * massstab(ganz.breite, ganz.hoehe, einst);
}

// von mehreren Plänen den, bei dem die Stufen am größten werden
function besterPlan(plaene, einst) {
  return plaene.reduce((bester, plan) => (stufenHoehe(plan, einst) > stufenHoehe(bester, einst) ? plan : bester));
}

// einst: alles aus dem Fenster (allgemein + Felder des Projekts), video: true/false
// quellen: { raster, spalten, zeilen, original, invertieren, foto, farbskala, puffer, stufen, toene, rueckwaerts }
export function baueSzene(einst, quellen, video) {
  const { stufen } = quellen;
  const mitStufen = einst.inhalt === "stufen" && stufen.length > 0;
  const paar = mitStufen && video && einst.anordnung === "paar";
  const ansicht = einst.ansicht; // "raster", "verzerrt" oder "original", wie die Anzeige auf der Seite
  const pixelig = ansicht === "raster"; // Rasterpunkte scharf, alles andere weich

  // Seitenverhältnis: Raster und verzerrt wie das Raster (Spalten : Zeilen), original wie das Foto
  const raster = mitStufen ? stufen[0] : quellen;
  const verhaeltnis = ansicht === "original"
    ? quellen.foto.width / quellen.foto.height
    : raster.spalten / raster.zeilen;

  let plan;
  if (!mitStufen) plan = felderAnsicht(verhaeltnis);
  else if (paar) {
    // quer: übereinander, hochkant: nebeneinander (was eben größer wird)
    plan = besterPlan([felderPaar(verhaeltnis, false), felderPaar(verhaeltnis, true)], einst);
  } else if (einst.spalten > 0) {
    plan = felderGitter(stufen.length, einst.spalten, verhaeltnis, einst.beschriftung);
  } else {
    // 0 = automatisch: jede Spaltenzahl ausprobieren
    const plaene = [];
    for (let spalten = 1; spalten <= stufen.length; spalten++) {
      plaene.push(felderGitter(stufen.length, spalten, verhaeltnis, einst.beschriftung));
    }
    plan = besterPlan(plaene, einst);
  }

  // Rahmen drum, dann alles mit einem Maßstab verkleinern, bis es passt
  const ganz = rahmenMasse(plan.breite, plan.hoehe, einst);
  const s = massstab(ganz.breite, ganz.hoehe, einst); // füllt den Kasten aus "Größe", quer wie hochkant
  const breite = gerade(Math.round(ganz.breite * s));
  const hoehe = gerade(Math.round(ganz.hoehe * s));
  const px = (wert) => Math.round(wert * s);
  const felder = plan.felder.map((f) => ({
    x: px(ganz.x + f.x),
    y: px(ganz.y + f.y),
    breite: px(f.breite),
    hoehe: px(f.hoehe),
  }));
  const texte = plan.texte.map((t) => ({ inhalt: t.inhalt, x: px(ganz.x + t.x), y: px(ganz.y + t.y) }));

  // die Abschnitte: was in welchem Feld liegt, solange welcher Ton läuft
  let abschnitte;
  if (!mitStufen) {
    const feld = felder[0];
    const bild = pixelig
      ? rasterBild(quellen, false)
      : originalBild(quellen.original, quellen.invertieren, feld.breite, feld.hoehe);
    abschnitte = [{
      puffer: quellen.puffer,
      ebenen: [{
        bild,
        feld,
        entsteht: video && einst.ablauf === "aufbauen",
        strich: video,
        skala: true,
        pixelig,
      }],
    }];
  } else {
    const bildVon = (i, feld) => stufenBild(stufen[i], ansicht, feld.breite, feld.hoehe, quellen);
    abschnitte = stufen.map((stufe, k) => {
      const letzte = k === stufen.length - 1;
      const ebenen = [];
      if (paar) {
        // oben klingt Stufe k, unten entsteht k + 1; danach rückt sie nach oben
        ebenen.push({ bild: bildVon(k, felder[0]), feld: felder[0], strich: true, skala: true, pixelig });
        if (!letzte) ebenen.push({ bild: bildVon(k + 1, felder[1]), feld: felder[1], entsteht: true, strich: true, skala: true, pixelig });
      } else {
        // Gitter: alles vor k bleibt stehen, k klingt, k + 1 entsteht
        for (let j = 0; j < k; j++) ebenen.push({ bild: bildVon(j, felder[j]), feld: felder[j], pixelig });
        ebenen.push({ bild: bildVon(k, felder[k]), feld: felder[k], strich: video, pixelig });
        if (video && !letzte) ebenen.push({ bild: bildVon(k + 1, felder[k + 1]), feld: felder[k + 1], entsteht: true, strich: true, pixelig });
      }
      return { puffer: quellen.toene?.[k], ebenen };
    });
  }

  const weiss = einst.hintergrund === "#ffffff";
  return {
    breite,
    hoehe,
    innen: { x: px(ganz.x), y: px(ganz.y), breite: px(plan.breite), hoehe: px(plan.hoehe) },
    rahmenFarbe: einst.rahmen === "aus" ? einst.hintergrund : einst.rahmenFarbe,
    hintergrund: einst.hintergrund,
    textFarbe: weiss ? "#111111" : "#dddddd",
    schrift: px(plan.schrift ?? 0),
    texte,
    rueckwaerts: quellen.rueckwaerts, // video.js: Strich von rechts nach links, Töne umgedreht
    strichBreite: Math.max(2, Math.round((3 * Math.min(breite, hoehe)) / 1080)), // 3 Pixel bei 1080
    abschnitte,
  };
}
