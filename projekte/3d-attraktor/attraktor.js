// Settings, Startwerte

const MAX_PUNKTE = 1000000;
const BILDER_PRO_ANIMATION = 1500;
const START_ABSTAND = 2.5;
const BRENNWEITE = 2;
const MIN_ABSTAND = 0.2;
const MAX_ABSTAND = 20;
const ZOOM_EMPFINDLICHKEIT = 0.001;
const EMPFINDLICHKEIT = 0.01;
const START_WINKEL = 0.6;
const START_NEIGUNG = 0.35;
const GRENZE = 1e6;

let punkte = 600000;
let staerke = 15;
let animiert = true;
let dreht = false;


// Attraktor-Typen

const TYPEN = {
  lorenz: {
    name: "Lorenz",
    formel: "x' = a·(y - x)\ny' = x·(b - z) - y\nz' = x·y - c·z",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.005,
    start: [0.1, 0, 0],
    schritt(w, p, dt) {
      const dx = w.a * (p.y - p.x);
      const dy = p.x * (w.b - p.z) - p.y;
      const dz = p.x * p.y - w.c * p.z;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  aizawa: {
    name: "Aizawa",
    formel: "x' = (z - b)·x - d·y\ny' = d·x + (z - b)·y\nz' = c + a·z - z³/3 - (x² + y²)·(1 + e·z) + f·z·x³",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"], ["e", "e"], ["f", "f"]],
    dt: 0.01,
    start: [0.1, 0, 0],
    schritt(w, p, dt) {
      const dx = (p.z - w.b) * p.x - w.d * p.y;
      const dy = w.d * p.x + (p.z - w.b) * p.y;
      const dz = w.c + w.a * p.z - (p.z * p.z * p.z) / 3
        - (p.x * p.x + p.y * p.y) * (1 + w.e * p.z)
        + w.f * p.z * p.x * p.x * p.x;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  thomas: {
    name: "Thomas",
    formel: "x' = sin(y) - b·x\ny' = sin(z) - b·y\nz' = sin(x) - b·z",
    parameter: [["b", "b"]],
    dt: 0.05,
    start: [1.1, 1.1, -0.01],
    schritt(w, p, dt) {
      const dx = Math.sin(p.y) - w.b * p.x;
      const dy = Math.sin(p.z) - w.b * p.y;
      const dz = Math.sin(p.x) - w.b * p.z;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  halvorsen: {
    name: "Halvorsen",
    formel: "x' = -a·x - 4y - 4z - y²\ny' = -a·y - 4z - 4x - z²\nz' = -a·z - 4x - 4y - x²",
    parameter: [["a", "a"]],
    dt: 0.005,
    start: [-1.48, -1.51, 2.04],
    schritt(w, p, dt) {
      const dx = -w.a * p.x - 4 * p.y - 4 * p.z - p.y * p.y;
      const dy = -w.a * p.y - 4 * p.z - 4 * p.x - p.z * p.z;
      const dz = -w.a * p.z - 4 * p.x - 4 * p.y - p.x * p.x;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  arneodo: {
    name: "Arneodo",
    formel: "x' = y\ny' = z\nz' = -a·x - b·y - z + c·x³",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.01,
    start: [0.2, 0.2, -0.75],
    schritt(w, p, dt) {
      const dx = p.y;
      const dy = p.z;
      const dz = -w.a * p.x - w.b * p.y - p.z + w.c * p.x * p.x * p.x;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  burkeShaw: {
    name: "Burke-Shaw",
    formel: "x' = -s·(x + y)\ny' = -y - s·x·z\nz' = s·x·y + v",
    parameter: [["s", "s"], ["v", "v"]],
    dt: 0.005,
    start: [0.6, 0, 0],
    schritt(w, p, dt) {
      const dx = -w.s * (p.x + p.y);
      const dy = -p.y - w.s * p.x * p.z;
      const dz = w.s * p.x * p.y + w.v;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  chenLee: {
    name: "Chen-Lee",
    formel: "x' = a·x - y·z\ny' = b·y + x·z\nz' = c·z + x·y / 3",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.003,
    start: [1, 0, 4.5],
    schritt(w, p, dt) {
      const dx = w.a * p.x - p.y * p.z;
      const dy = w.b * p.y + p.x * p.z;
      const dz = w.c * p.z + (p.x * p.y) / 3;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  dadras: {
    name: "Dadras",
    formel: "x' = y - a·x + b·y·z\ny' = c·y - x·z + z\nz' = d·x·y - e·z",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"], ["e", "e"]],
    dt: 0.005,
    start: [1, 1, 1],
    schritt(w, p, dt) {
      const dx = p.y - w.a * p.x + w.b * p.y * p.z;
      const dy = w.c * p.y - p.x * p.z + p.z;
      const dz = w.d * p.x * p.y - w.e * p.z;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  fourWing: {
    name: "Four-Wing",
    formel: "x' = a·x + y·z\ny' = b·x + c·y - x·z\nz' = -z - x·y",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.05,
    start: [1.3, -0.18, 0.01],
    schritt(w, p, dt) {
      const dx = w.a * p.x + p.y * p.z;
      const dy = w.b * p.x + w.c * p.y - p.x * p.z;
      const dz = -p.z - p.x * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  newtonLeipnik: {
    name: "Newton-Leipnik",
    formel: "x' = -a·x + y + 10·y·z\ny' = -x - 0.4·y + 5·x·z\nz' = b·z - 5·x·y",
    parameter: [["a", "a"], ["b", "b"]],
    dt: 0.01,
    start: [0.349, 0, -0.16],
    schritt(w, p, dt) {
      const dx = -w.a * p.x + p.y + 10 * p.y * p.z;
      const dy = -p.x - 0.4 * p.y + 5 * p.x * p.z;
      const dz = w.b * p.z - 5 * p.x * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  noseHoover: {
    name: "Nose-Hoover",
    formel: "x' = y\ny' = -x + y·z\nz' = a - y²",
    parameter: [["a", "a"]],
    dt: 0.01,
    start: [1, 0, 0],
    schritt(w, p, dt) {
      const dx = p.y;
      const dy = -p.x + p.y * p.z;
      const dz = w.a - p.y * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  rucklidge: {
    name: "Rucklidge",
    formel: "x' = -k·x + a·y - y·z\ny' = x\nz' = -z + y²",
    parameter: [["k", "k"], ["a", "a"]],
    dt: 0.01,
    start: [1, 0, 4.5],
    schritt(w, p, dt) {
      const dx = -w.k * p.x + w.a * p.y - p.y * p.z;
      const dy = p.x;
      const dz = -p.z + p.y * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  }
};


// Presets mit ihren Startwerten 

const PRESETS = [
  { name: "Lorenz", typ: "lorenz", werte: { a: 10, b: 28, c: 2.6667 }, text: "Platzhalter." },
  { name: "Aizawa", typ: "aizawa", werte: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 }, text: "Platzhalter." },
  { name: "Thomas I", typ: "thomas", werte: { b: 0.208186 }, text: "Platzhalter." },
  { name: "Thomas II", typ: "thomas", werte: { b: 0.192 }, text: "Platzhalter." },
  { name: "Thomas III", typ: "thomas", werte: { b: 0.092 }, text: "Platzhalter." },
  { name: "Halvorsen", typ: "halvorsen", werte: { a: 1.4 }, text: "Platzhalter." },
  { name: "Arneodo", typ: "arneodo", werte: { a: -5, b: 3.5, c: -1 }, text: "Platzhalter." },
  { name: "Burke-Shaw", typ: "burkeShaw", werte: { s: 10, v: 4.272 }, text: "Platzhalter." },
  { name: "Chen-Lee", typ: "chenLee", werte: { a: 5, b: -10, c: -0.38 }, text: "Platzhalter." },
  { name: "Dadras", typ: "dadras", werte: { a: 3, b: 2.7, c: 1.7, d: 2, e: 9 }, text: "Platzhalter." },
  { name: "Four-Wing", typ: "fourWing", werte: { a: 0.2, b: 0.01, c: -0.4 }, text: "Platzhalter." },
  { name: "Newton-Leipnik", typ: "newtonLeipnik", werte: { a: 0.4, b: 0.175 }, text: "Platzhalter." },
  { name: "Nose-Hoover", typ: "noseHoover", werte: { a: 1.5 }, text: "Platzhalter." },
  { name: "Rucklidge", typ: "rucklidge", werte: { k: 2, a: 6.7 }, text: "Platzhalter." }
];


// Canvas als Quelle für das Bild

const canvas = document.getElementById("feld");
const ctx = canvas.getContext("2d");

let bild = null;
let pixel32 = null;

function passeGroesseAn() {
  const dpr = Math.max(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  bild = ctx.createImageData(canvas.width, canvas.height);
  pixel32 = new Uint32Array(bild.data.buffer);
} // siehe 2d-Attraktor dateien


// Variablen und start

let typ = TYPEN.lorenz; // erster Attraktor
let werte = {};

const daten = new Float32Array(MAX_PUNKTE * 3);
let anzahl = 0;
let sichtbar = 0;

let winkel = START_WINKEL;
let neigung = START_NEIGUNG;
let abstand = START_ABSTAND;
let animationsId = null;
let geplant = false;


// Punkte berechnen

function laeuftDavon(p) {
  return !Number.isFinite(p.x + p.y + p.z)
    || Math.abs(p.x) > GRENZE
    || Math.abs(p.y) > GRENZE
    || Math.abs(p.z) > GRENZE;
}

function berechnePunkte() {
  const p = { x: typ.start[0], y: typ.start[1], z: typ.start[2] };
  anzahl = 0;

  for (let i = 0; i < 1000; i++) {
    typ.schritt(werte, p, typ.dt);
    if (laeuftDavon(p)) return;
  }

  for (let i = 0; i < punkte; i++) {
    typ.schritt(werte, p, typ.dt);
    if (laeuftDavon(p)) break;
    daten[i * 3] = p.x;
    daten[i * 3 + 1] = p.z;
    daten[i * 3 + 2] = p.y;
    anzahl++;
  }

  normalisiere();
}

function normalisiere() {
  const ende = anzahl * 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < ende; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (daten[i + k] < min[k]) min[k] = daten[i + k];
      if (daten[i + k] > max[k]) max[k] = daten[i + k];
    }
  }

  const mitte = [0, 1, 2].map(k => (min[k] + max[k]) / 2);
  let radius = 0;

  for (let i = 0; i < ende; i += 3) {
    for (let k = 0; k < 3; k++) {
      daten[i + k] -= mitte[k];
    }
    const abstand = Math.hypot(daten[i], daten[i + 1], daten[i + 2]);
    if (abstand > radius) radius = abstand;
  }

  if (radius === 0) {
    anzahl = 0;
    return;
  }

  for (let i = 0; i < ende; i++) {
    daten[i] /= radius;
  }
}


// Zeichnen

function zeichne() {
  const w = canvas.width;
  const h = canvas.height;
  const pixel = bild.data;

  pixel32.fill(0xFF111111);

  const cosW = Math.cos(winkel);
  const sinW = Math.sin(winkel);
  const cosN = Math.cos(neigung);
  const sinN = Math.sin(neigung);
  const groesse = (Math.min(w, h) / 2) * 0.9;
  const ende = sichtbar * 3;

  for (let i = 0; i < ende; i += 3) {
    const x = daten[i];
    const y = daten[i + 1];
    const z = daten[i + 2];

    const x1 = x * cosW + z * sinW;
    const z1 = -x * sinW + z * cosW;

    const y2 = y * cosN - z1 * sinN;
    const z2 = y * sinN + z1 * cosN;

    const tiefe = abstand - z2;
    if (tiefe < 0.05) continue;

    const f = BRENNWEITE / tiefe;

    const px = Math.floor(w / 2 + x1 * f * groesse);
    const py = Math.floor(h / 2 - y2 * f * groesse);
    if (px < 0 || px >= w || py < 0 || py >= h) continue;

    const stelle = (py * w + px) * 4;
    pixel[stelle] += staerke;
    pixel[stelle + 1] += staerke;
    pixel[stelle + 2] += staerke;
  }

  ctx.putImageData(bild, 0, 0);
}

function planeZeichnen() {
  if (geplant || animationsId !== null) return;
  geplant = true;
  requestAnimationFrame(() => {
    geplant = false;
    zeichne();
  });
}

function stoppeAnimation() {
  if (animationsId !== null) {
    cancelAnimationFrame(animationsId);
    animationsId = null;
  }
}

function zeichneSofort() {
  stoppeAnimation();
  sichtbar = anzahl;
  zeichne();
}

function zeichneAnimiert() {
  stoppeAnimation();
  sichtbar = 0;
  const proBild = Math.max(1, Math.ceil(anzahl / BILDER_PRO_ANIMATION));

  function bildSchritt() {
    sichtbar = Math.min(sichtbar + proBild, anzahl);
    zeichne();
    if (sichtbar < anzahl) {
      animationsId = requestAnimationFrame(bildSchritt);
    } else {
      animationsId = null;
    }
  }

  animationsId = requestAnimationFrame(bildSchritt);
}

function darstellen() {
  if (animiert) {
    zeichneAnimiert();
  } else {
    zeichneSofort();
  }
}

const hinweis = document.getElementById("hinweis");

function neuBerechnen() {
  berechnePunkte();

  if (anzahl === 0) {
    hinweis.textContent = "Mit diesen Werten läuft der Punkt sofort ins Unendliche. Probier andere Zahlen.";
  } else if (anzahl < punkte) {
    hinweis.textContent = `Mit diesen Werten läuft der Punkt nach ${anzahl.toLocaleString("de-DE")} Schritten ins Unendliche.`;
  } else {
    hinweis.textContent = "";
  }

  darstellen();
}


// Drehen und Zoomen 

const zeiger = new Map();
let letzterFingerAbstand = 0;

function fingerAbstand() {
  const [a, b] = [...zeiger.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function setzeAbstand(neu) {
  abstand = Math.min(Math.max(neu, MIN_ABSTAND), MAX_ABSTAND);
  planeZeichnen();
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add("zieht");

  if (zeiger.size === 2) {
    letzterFingerAbstand = fingerAbstand();
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!zeiger.has(e.pointerId)) return;

  const vorher = zeiger.get(e.pointerId);
  const jetzt = { x: e.clientX, y: e.clientY };
  zeiger.set(e.pointerId, jetzt);

  if (zeiger.size === 1) {
    winkel += (jetzt.x - vorher.x) * EMPFINDLICHKEIT;
    neigung += (jetzt.y - vorher.y) * EMPFINDLICHKEIT;
    neigung = Math.min(Math.max(neigung, -Math.PI / 2), Math.PI / 2);
    planeZeichnen();
  } else if (zeiger.size === 2) {
    const neuerAbstand = fingerAbstand();
    if (letzterFingerAbstand > 0) {
      setzeAbstand(abstand * letzterFingerAbstand / neuerAbstand);
    }
    letzterFingerAbstand = neuerAbstand;
  }
});

function zeigerWeg(e) {
  zeiger.delete(e.pointerId);
  if (zeiger.size < 2) letzterFingerAbstand = 0;
  if (zeiger.size === 0) canvas.classList.remove("zieht");
}

canvas.addEventListener("pointerup", zeigerWeg);
canvas.addEventListener("pointercancel", zeigerWeg);

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  setzeAbstand(abstand * Math.exp(delta * ZOOM_EMPFINDLICHKEIT));
}, { passive: false });


// Drehen lassen

function drehe() {
  if (dreht) {
    function drehSchritt() {
      winkel += 0.002;
      planeZeichnen();
      if (dreht) {
        requestAnimationFrame(drehSchritt);
      }
    }
    drehSchritt();
  }
}


// Buttons

const modusEnstehung = document.getElementById("toggle-animiert-sofort");
const punkteFeld = document.getElementById("punkte");
const staerkeFeld = document.getElementById("staerke");
const modusDrehen = document.getElementById("toggle-drehen");

modusEnstehung.addEventListener("click", () => {
  animiert = !animiert;
  modusEnstehung.textContent = animiert ? "Sofort anzeigen" : "Enstehen lassen";
  darstellen();
});

modusDrehen.addEventListener("click", () => {
  dreht = !dreht;
  modusDrehen.textContent = dreht ? "Drehen stoppen" : "Drehen lassen";
  drehe();
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
  neuBerechnen();
});

staerkeFeld.addEventListener("change", () => {
  staerke = leseGanzzahl(staerkeFeld, 1, 255, staerke);
  planeZeichnen();
});

punkteFeld.value = punkte;
staerkeFeld.value = staerke;

document.getElementById("zuruecksetzen").addEventListener("click", () => {
  winkel = START_WINKEL;
  neigung = START_NEIGUNG;
  abstand = START_ABSTAND;
  planeZeichnen();
});


// Presets und Werte

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

  for (const [schluessel, zeichen] of typ.parameter) {
    const label = document.createElement("label");
    const feld = document.createElement("input");
    feld.type = "number";
    feld.step = "0.01";
    feld.value = werte[schluessel];

    feld.addEventListener("change", () => {
      const eingabe = feld.value.trim();
      const zahl = Number(eingabe);

      if (eingabe === "" || !Number.isFinite(zahl)) {
        feld.value = werte[schluessel];
        return;
      }

      werte[schluessel] = zahl;
      markiere(-1);
      neuBerechnen();
    });

    label.append(`${zeichen} `, feld);
    werteBox.append(label);
  }
}

function markiere(i) {
  presetBox.querySelectorAll("button").forEach((knopf, j) => {
    knopf.setAttribute("aria-pressed", j === i);
  });

  formelFeld.textContent = typ.formel;

  if (i === -1) {
    presetName.textContent = `${typ.name} - eigene Werte`;
    presetText.textContent = "Du hast die Werte selbst verändert. Manche Zahlen lassen den Attraktor zerfallen, andere lassen ihn zu einem Punkt oder einer Schleife zusammenschrumpfen.";
  } else {
    presetName.textContent = PRESETS[i].name;
    presetText.textContent = PRESETS[i].text;
  }
}

function waehlePreset(i) {
  const preset = PRESETS[i];
  typ = TYPEN[preset.typ];
  werte = { ...preset.werte };
  baueWerteFelder();
  markiere(i);
  neuBerechnen();
}


// Start 

window.addEventListener("resize", () => {
  passeGroesseAn();
  zeichne();
});

passeGroesseAn();
waehlePreset(0);

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: () => typ.name.toLowerCase().replace(/\s+/g, "-")
});