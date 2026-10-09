// Settings

const MAX_PUNKTE = 1000000;
const BILDER_PRO_ANIMATION = 1500;
const MAX_PROBE = 200000;
const GRENZE = 1e6;

let punkte = 600000;
let staerke = 15;
let animiert = true;


// Hilfsfunktion für Gumowski-Mira-Attraktor 

function gmFunktion(x, b) {
  return b * x + (2 * (1 - b) * x * x) / (1 + x * x);
}


// Attraktor-Typen
// hab ich von http://www.3d-meier.de/tut19/Seite1.html

const TYPEN = {
  clifford: {
    name: "Clifford",
    formel: "x' = sin(a·y) + c·cos(a·x)\ny' = sin(b·x) + d·cos(b·y)",
    parameter: ["a", "b", "c", "d"],
    start: [0.1, 0.1], // Startwerte für x und y, die nicht ins Unendliche laufen
    schritt(w, pos) {  // w = Werte, pos = Position
      const x = Math.sin(w.a * pos.y) + w.c * Math.cos(w.a * pos.x);
      const y = Math.sin(w.b * pos.x) + w.d * Math.cos(w.b * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  dejong: {
    name: "Peter de Jong",
    formel: "x' = sin(a·y) - cos(b·x)\ny' = sin(c·x) - cos(d·y)",
    parameter: ["a", "b", "c", "d"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const x = Math.sin(w.a * pos.y) - Math.cos(w.b * pos.x);
      const y = Math.sin(w.c * pos.x) - Math.cos(w.d * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  svensson: {
    name: "Svensson",
    formel: "x' = d·sin(a·x) - sin(b·y)\ny' = c·cos(a·x) + cos(b·y)",
    parameter: ["a", "b", "c", "d"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const x = w.d * Math.sin(w.a * pos.x) - Math.sin(w.b * pos.y);
      const y = w.c * Math.cos(w.a * pos.x) + Math.cos(w.b * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  hopalong: {
    name: "Hopalong",
    formel: "x' = y - sign(x)·√|b·x - c|\ny' = a - x",
    parameter: ["a", "b", "c"],
    start: [0, 0],
    schritt(w, pos) {
      const x = pos.y - Math.sign(pos.x) * Math.sqrt(Math.abs(w.b * pos.x - w.c));
      const y = w.a - pos.x;
      pos.x = x;
      pos.y = y;
    }
  },
  gumowskiMira: {
    name: "Gumowski-Mira",
    formel: "f(x) = b·x + 2·(1 - b)·x² / (1 + x²)\nx' = y + a·(1 - 0.05·y²)·y + f(x)\ny' = -x + f(x')",
    parameter: ["a", "b"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const x = pos.y + w.a * (1 - 0.05 * pos.y * pos.y) * pos.y + gmFunktion(pos.x, w.b);
      const y = -pos.x + gmFunktion(x, w.b);
      pos.x = x;
      pos.y = y;
    }
  },
  tinkerbell: {
    name: "Tinkerbell",
    formel: "x' = x² - y² + a·x + b·y\ny' = 2·x·y + c·x + d·y",
    parameter: ["a", "b", "c", "d"],
    start: [-0.72, -0.64],
    schritt(w, pos) {
      const x = pos.x * pos.x - pos.y * pos.y + w.a * pos.x + w.b * pos.y;
      const y = 2 * pos.x * pos.y + w.c * pos.x + w.d * pos.y;
      pos.x = x;
      pos.y = y;
    }
  },
  ikeda: {
    name: "Ikeda",
    formel: "t = c - 6 / (1 + x² + y²)\nx' = 1 + u·(x·cos t - y·sin t)\ny' = u·(x·sin t + y·cos t)",
    parameter: ["c", "u"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const t = w.c - 6 / (1 + pos.x * pos.x + pos.y * pos.y);
      const x = 1 + w.u * (pos.x * Math.cos(t) - pos.y * Math.sin(t));
      const y = w.u * (pos.x * Math.sin(t) + pos.y * Math.cos(t));
      pos.x = x;
      pos.y = y;
    }
  },
};


// Die Presets und ihre initialen Werte

const PRESETS = [
  { name: "Clifford I", typ: "clifford", werte: { a: -1.4, b: 1.6, c: 1.0, d: 0.7 }, text: "Platzhalter." },
  { name: "Clifford II", typ: "clifford", werte: { a: 1.7, b: 1.7, c: 0.6, d: 1.2 }, text: "Platzhalter." },
  { name: "De Jong I", typ: "dejong", werte: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 }, text: "Platzhalter." },
  { name: "De Jong II", typ: "dejong", werte: { a: -2.7, b: -0.09, c: -0.86, d: -2.2 }, text: "Platzhalter." },
  { name: "Svensson", typ: "svensson", werte: { a: 1.4, b: 1.56, c: 1.4, d: -6.56 }, text: "Platzhalter." },
  { name: "Hopalong I", typ: "hopalong", werte: { a: 0.4, b: 1.0, c: 0.0 }, text: "Platzhalter." },
  { name: "Hopalong II", typ: "hopalong", werte: { a: 0.5, b: -0.3, c: 0.7 }, text: "Platzhalter." },
  { name: "Gumowski-Mira I", typ: "gumowskiMira", werte: { a: 0.008, b: -0.9 }, text: "Platzhalter." },
  { name: "Gumowski-Mira II", typ: "gumowskiMira", werte: { a: 0.0, b: -0.31 }, start: [0.0, 0.5], text: "Platzhalter." },
  { name: "Tinkerbell", typ: "tinkerbell", werte: { a: 0.9, b: -0.6013, c: 2.0, d: 0.5 }, text: "Platzhalter." },
  { name: "Ikeda", typ: "ikeda", werte: { c: 0.00, u: 0.97 }, text: "Platzhalter." },
];


// Canvas als Zeichenfläche

const canvas = document.getElementById("feld");
const ctx = canvas.getContext("2d");

function passeGroesseAn() {
  const dpr = Math.max(window.devicePixelRatio || 1, 2);  // mindestens 2, damit die Punkte auch auf hochauflösenden Displays scharf aussehen
  canvas.width = Math.round(canvas.clientWidth * dpr);    // die Größe des Canvas in CSS-Pixeln * devicePixelRatio = die Größe in echten Pixeln
  canvas.height = Math.round(canvas.clientHeight * dpr);
}


// Zustände  

let typ = TYPEN.clifford;   // Starttyp
let werte = {};
let start = typ.start; 
const pos = { x: start[0], y: start[1] };  // Startposition des Attraktors

let bild = null;
let abbildung = null;
let gezeichnet = 0;
let animationsId = null;


// Berechnung

function laeuftDavon(p) {
  return !Number.isFinite(p.x + p.y) // läuft davon wenn nicht finite
    || Math.abs(p.x) > GRENZE
    || Math.abs(p.y) > GRENZE;
} // läuft der Punkt ins Unendliche?

function bestimmeAbbildung() {
  const probe = { x: start[0], y: start[1] };
  let minX = Infinity;  // der neue wert (min) soll ja sicher kleiner sein
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const schritte = Math.min(punkte, MAX_PROBE);

  for (let i = 0; i < schritte; i++) {
    typ.schritt(werte, probe);
    if (laeuftDavon(probe)) return null;
    if (i < 100) continue;  // ersten 100 Schritte nicht so wichtig (sparen dadurch minimal Zeit)
    if (probe.x < minX) minX = probe.x; // ist der neue Wert kleiner oder größer als der alte
    if (probe.x > maxX) maxX = probe.x;
    if (probe.y < minY) minY = probe.y;
    if (probe.y > maxY) maxY = probe.y;
  }

  const breite = Math.max(maxX - minX, 1e-9);   // die breite der entstandenen Figur
  const hoehe = Math.max(maxY - minY, 1e-9);

  return {
    massstab: Math.min(canvas.width / breite, canvas.height / hoehe) * 0.9,
    mitteX: (minX + maxX) / 2,
    mitteY: (minY + maxY) / 2
  };  // Figur zentrieren durch die in der Probe gewonnenen Infos
}


// Attraktor malen

const hinweis = document.getElementById("hinweis");

function neuesBild() {
  bild = ctx.createImageData(canvas.width, canvas.height);
  const pixel = bild.data;
  for (let i = 0; i < pixel.length; i += 4) {
    pixel[i] = 17;
    pixel[i + 1] = 17;
    pixel[i + 2] = 17;
    pixel[i + 3] = 255;
  }
  pos.x = start[0];
  pos.y = start[1];
  gezeichnet = 0;
  abbildung = bestimmeAbbildung();

  hinweis.textContent = abbildung
    ? ""
    : "Mit diesen Werten läuft der Punkt ins Unendliche. Probier andere Zahlen.";
} // das Bild initialisieren

function punkteHinzufuegen(anzahl) {
  if (!abbildung) {
    gezeichnet = punkte;
    return;
  }

  const w = bild.width;
  const h = bild.height;
  const pixel = bild.data;
  const { massstab, mitteX, mitteY } = abbildung;
  const ende = Math.min(gezeichnet + anzahl, punkte);

  for (; gezeichnet < ende; gezeichnet++) {
    typ.schritt(werte, pos);

    if (laeuftDavon(pos)) {
      gezeichnet = punkte;
      return;
    }

    if (gezeichnet < 100) continue;

    const px = Math.floor(w / 2 + (pos.x - mitteX) * massstab); // die Punkte korrekt bezogen 
    const py = Math.floor(h / 2 + (pos.y - mitteY) * massstab); // auf die neue Mitte setzen
    if (px < 0 || px >= w || py < 0 || py >= h) continue;

    const stelle = (py * w + px) * 4;
    pixel[stelle] += staerke;
    pixel[stelle + 1] += staerke;
    pixel[stelle + 2] += staerke;
  }
}

function zeige() {
  ctx.putImageData(bild, 0, 0);
}

function stoppeAnimation() {
  if (animationsId !== null) {
    cancelAnimationFrame(animationsId);
    animationsId = null;
  }
}

function zeichneSofort() {
  stoppeAnimation();
  neuesBild();
  punkteHinzufuegen(punkte);
  zeige();
}

function zeichneAnimiert() {
  stoppeAnimation();
  neuesBild();
  const proBild = Math.ceil(punkte / BILDER_PRO_ANIMATION);

  function bildSchritt() {
    punkteHinzufuegen(proBild);
    zeige();
    if (gezeichnet < punkte) {
      animationsId = requestAnimationFrame(bildSchritt);
    } else {
      animationsId = null;
    }
  }

  animationsId = requestAnimationFrame(bildSchritt);
}

function zeichne() {
  if (animiert) {
    zeichneAnimiert();
  } else {
    zeichneSofort();
  }
}


// Buttons

const modusEnstehung = document.getElementById("toggle-animiert-sofort");
const punkteFeld = document.getElementById("punkte");
const staerkeFeld = document.getElementById("staerke");

modusEnstehung.addEventListener("click", () => {
  animiert = !animiert;
  modusEnstehung.textContent = animiert ? "Sofort anzeigen" : "Entstehen lassen";
  zeichne();
});

function leseGanzzahl(feld, min, max, bisher) {
  const eingabe = feld.value.trim();
  const zahl = Number(eingabe);

  if (eingabe === "" || !Number.isFinite(zahl)) {
    feld.value = bisher;
    return bisher;
  }

  const ergebnis = Math.min(Math.max(Math.round(zahl), min), max);
  feld.value = ergebnis;
  return ergebnis;
}

punkteFeld.addEventListener("change", () => {
  punkte = leseGanzzahl(punkteFeld, 1000, MAX_PUNKTE, punkte);
  zeichne();
});

staerkeFeld.addEventListener("change", () => {
  staerke = leseGanzzahl(staerkeFeld, 1, 255, staerke);
  zeichne();
});

punkteFeld.value = punkte;
staerkeFeld.value = staerke;


// Presets in HTML

const presetBox = document.querySelector(".presets");
const werteBox = document.querySelector(".werte");
const presetName = document.getElementById("preset-name");
const presetText = document.getElementById("preset-text");
const formelFeld = document.getElementById("formel");

PRESETS.forEach((preset, i) => {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.textContent = preset.name;
  knopf.addEventListener("click", () => waehlePreset(i));
  presetBox.append(knopf);
});

function baueWerteFelder() {
  werteBox.replaceChildren();

  for (const name of typ.parameter) {
    const label = document.createElement("label");
    const feld = document.createElement("input");
    feld.type = "number";
    feld.step = "0.01";
    feld.value = werte[name];

    feld.addEventListener("change", () => {
      const eingabe = feld.value.trim();
      const zahl = Number(eingabe);

      if (eingabe === "" || !Number.isFinite(zahl)) {
        feld.value = werte[name];
        return;
      }

      werte[name] = zahl;
      markiere(-1);
      zeichne();
    });

    label.append(`${name} `, feld);
    werteBox.append(label);
  }
}

function markiere(i) {
  presetBox.querySelectorAll("button").forEach((knopf, j) => {
    knopf.setAttribute("aria-pressed", j === i);
  });

  formelFeld.textContent = typ.formel;

  if (i === -1) {
    presetName.textContent = `${typ.name} – eigene Werte`;
    presetText.textContent = "Du hast die Werte selbst verändert. Schon kleine Änderungen können eine völlig andere Form ergeben.";
  } else {
    presetName.textContent = PRESETS[i].name;
    presetText.textContent = PRESETS[i].text;
  }
}

function waehlePreset(i) {
  const preset = PRESETS[i];
  typ = TYPEN[preset.typ];
  werte = { ...preset.werte };
  start = preset.start || typ.start;
  baueWerteFelder();
  markiere(i);
  zeichne();
}


// Start

window.addEventListener("resize", () => {
  passeGroesseAn();
  zeichneSofort();
});

passeGroesseAn();
waehlePreset(0);

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: () => typ.name.toLowerCase().replace(/\s+/g, "-")
});