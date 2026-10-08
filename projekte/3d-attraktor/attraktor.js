// ---------- Einstellungen ----------

const MAX_PUNKTE = 1000000;
const BILDER_PRO_ANIMATION = 1500;
const START_ABSTAND = 3;
const BRENNWEITE = 2;
const MIN_ABSTAND = 0.2;
const MAX_ABSTAND = 20;
const ZOOM_EMPFINDLICHKEIT = 0.001;
const EMPFINDLICHKEIT = 0.01;
const START_WINKEL = 0.6;
const START_NEIGUNG = 0.35;
const GRENZE = 1e6;

let punkte = 150000;
let staerke = 15;
let animiert = true;

// ---------- Attraktor-Typen ----------

const TYPEN = {
  lorenz: {
    name: "Lorenz",
    formel: "x' = σ·(y − x)\ny' = x·(ρ − z) − y\nz' = x·y − β·z",
    parameter: [["sigma", "σ"], ["rho", "ρ"], ["beta", "β"]],
    dt: 0.005,
    start: [0.1, 0, 0],
    schritt(w, p, dt) {
      const dx = w.sigma * (p.y - p.x);
      const dy = p.x * (w.rho - p.z) - p.y;
      const dz = p.x * p.y - w.beta * p.z;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  aizawa: {
    name: "Aizawa",
    formel: "x' = (z − b)·x − d·y\ny' = d·x + (z − b)·y\nz' = c + a·z − z³/3 − (x² + y²)·(1 + e·z) + f·z·x³",
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
    formel: "x' = sin(y) − b·x\ny' = sin(z) − b·y\nz' = sin(x) − b·z",
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
    formel: "x' = −a·x − 4y − 4z − y²\ny' = −a·y − 4z − 4x − z²\nz' = −a·z − 4x − 4y − x²",
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
  }
};

// ---------- Presets ----------

const PRESETS = [
  {
    name: "Lorenz",
    typ: "lorenz",
    werte: { sigma: 10, rho: 28, beta: 2.6667 },
    text: "Platzhalter: beschreib hier in eigenen Worten, was du siehst."
  },
  {
    name: "Aizawa",
    typ: "aizawa",
    werte: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 },
    text: "Platzhalter."
  },
  {
    name: "Thomas",
    typ: "thomas",
    werte: { b: 0.208186 },
    text: "Platzhalter."
  },
  {
    name: "Halvorsen",
    typ: "halvorsen",
    werte: { a: 1.89 },
    text: "Platzhalter."
  }
];

// ---------- Canvas ----------

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
}

// ---------- Zustand ----------

let typ = TYPEN.lorenz;
let werte = {};

const daten = new Float32Array(MAX_PUNKTE * 3);
let anzahl = 0;
let sichtbar = 0;

let winkel = START_WINKEL;
let neigung = START_NEIGUNG;
let abstand = START_ABSTAND;
let animationsId = null;
let geplant = false;

// ---------- Punkte berechnen ----------

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

// ---------- Zeichnen ----------

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

// ---------- Ziehen und Zoomen ----------

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

// ---------- Steuerung ----------

const modusAnimiert = document.getElementById("modus-animiert");
const modusSofort = document.getElementById("modus-sofort");
const punkteFeld = document.getElementById("punkte");
const staerkeFeld = document.getElementById("staerke");

function setzeModus(wert) {
  animiert = wert;
  modusAnimiert.setAttribute("aria-pressed", wert);
  modusSofort.setAttribute("aria-pressed", !wert);
}

modusAnimiert.addEventListener("click", () => setzeModus(true));
modusSofort.addEventListener("click", () => setzeModus(false));

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

// ---------- Presets und Werte ----------

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
    feld.step = "any";
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
    presetName.textContent = `${typ.name} – eigene Werte`;
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

// ---------- Start ----------

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