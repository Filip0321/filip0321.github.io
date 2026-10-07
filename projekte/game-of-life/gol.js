// ---------- Einstellungen ----------

const SPALTEN = 80;
const ZEILEN = 60;
const ZELLE = 8;
const INTERVALL = 100;

// ---------- Muster ----------
// O = lebende Zelle, . = tote Zelle

const MUSTER = [
  {
    name: "Gleiter",
    text: "Das kleinste Raumschiff: fünf Zellen, die alle vier Generationen um ein Feld schräg weiterwandern.",
    zellen: [
      ".O.",
      "..O",
      "OOO"
    ]
  },
  {
    name: "Raumschiff",
    text: "Ein leichtes Raumschiff, das waagerecht über das Feld fliegt.",
    zellen: [
      ".O..O",
      "O....",
      "O...O",
      "OOOO."
    ]
  },
  {
    name: "Pulsar",
    text: "Ein Oszillator, der alle drei Generationen in seine Ausgangsform zurückkehrt.",
    zellen: [
      "..OOO...OOO..",
      ".............",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      "..OOO...OOO..",
      ".............",
      "..OOO...OOO..",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      ".............",
      "..OOO...OOO.."
    ]
  },
  {
    name: "R-Pentomino",
    text: "Nur fünf Zellen, aus denen sehr lange Chaos entsteht, bevor Ruhe einkehrt.",
    zellen: [
      ".OO",
      "OO.",
      ".O."
    ]
  },
  {
    name: "Gleiterkanone",
    text: "Bill Gospers Gleiterkanone von 1970 erzeugt alle 30 Generationen einen neuen Gleiter.",
    zellen: [
      "........................O...........",
      "......................O.O...........",
      "............OO......OO............OO",
      "...........O...O....OO............OO",
      "OO........O.....O...OO..............",
      "OO........O...O.OO....O.O...........",
      "..........O.....O.......O...........",
      "...........O...O....................",
      "............OO......................"
    ]
  }
];

// ---------- Canvas ----------

const canvas = document.getElementById("feld");
const ctx = canvas.getContext("2d");

canvas.width = SPALTEN * ZELLE;
canvas.height = ZEILEN * ZELLE;

// ---------- Zustand ----------

let gitter = new Uint8Array(SPALTEN * ZEILEN);
let naechstes = new Uint8Array(SPALTEN * ZEILEN);
let laeuft = true;
let letzteZeit = 0;

// ---------- Simulation ----------

function index(x, y) {
  return y * SPALTEN + x;
}

function nachbarn(x, y) {
  let anzahl = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + SPALTEN) % SPALTEN;
      const ny = (y + dy + ZEILEN) % ZEILEN;
      anzahl += gitter[index(nx, ny)];
    }
  }
  return anzahl;
}

function schritt() {
  for (let y = 0; y < ZEILEN; y++) {
    for (let x = 0; x < SPALTEN; x++) {
      const n = nachbarn(x, y);
      const lebt = gitter[index(x, y)];
      const lebtWeiter = lebt ? (n === 2 || n === 3) : n === 3;
      naechstes[index(x, y)] = lebtWeiter ? 1 : 0;
    }
  }
  [gitter, naechstes] = [naechstes, gitter];
}

function zufall(dichte) {
  for (let i = 0; i < gitter.length; i++) {
    gitter[i] = Math.random() < dichte ? 1 : 0;
  }
}

function platziere(muster) {
  gitter.fill(0);
  const hoehe = muster.zellen.length;
  const breite = muster.zellen[0].length;
  const startX = Math.floor((SPALTEN - breite) / 2);
  const startY = Math.floor((ZEILEN - hoehe) / 2);

  muster.zellen.forEach((zeile, y) => {
    for (let x = 0; x < zeile.length; x++) {
      if (zeile[x] === "O") {
        gitter[index(startX + x, startY + y)] = 1;
      }
    }
  });
}

// ---------- Zeichnen ----------

function zeichne() {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#DDDDDD";
  for (let y = 0; y < ZEILEN; y++) {
    for (let x = 0; x < SPALTEN; x++) {
      if (gitter[index(x, y)]) {
        ctx.fillRect(x * ZELLE, y * ZELLE, ZELLE - 1, ZELLE - 1);
      }
    }
  }
}

// ---------- Steuerung ----------

const startKnopf = document.getElementById("start");
const schrittKnopf = document.getElementById("schritt");
const leerenKnopf = document.getElementById("leeren");
const neuKnopf = document.getElementById("neu");

function setzeLaeuft(wert) {
  laeuft = wert;
  startKnopf.textContent = laeuft ? "Pause" : "Start";
}

startKnopf.addEventListener("click", () => {
  setzeLaeuft(!laeuft);
});

schrittKnopf.addEventListener("click", () => {
  setzeLaeuft(false);
  schritt();
  zeichne();
});

leerenKnopf.addEventListener("click", () => {
  setzeLaeuft(false);
  gitter.fill(0);
  markiere(-1);
  zeichne();
});

neuKnopf.addEventListener("click", () => {
  zufall(0.25);
  markiere(-1);
  zeichne();
});

// ---------- Muster-Tasten ----------

const presetBox = document.querySelector(".presets");
const presetName = document.getElementById("preset-name");
const presetText = document.getElementById("preset-text");

MUSTER.forEach((muster, i) => {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.textContent = muster.name;
  knopf.addEventListener("click", () => waehleMuster(i));
  presetBox.append(knopf);
});

function markiere(i) {
  presetBox.querySelectorAll("button").forEach((knopf, j) => {
    knopf.setAttribute("aria-pressed", j === i);
  });

  if (i === -1) {
    presetName.textContent = "Kein Muster gewählt";
    presetText.textContent = "Wähle ein Muster oder mal selbst Zellen ins Feld, dann drück auf Start.";
  } else {
    presetName.textContent = MUSTER[i].name;
    presetText.textContent = MUSTER[i].text;
  }
}

function waehleMuster(i) {
  setzeLaeuft(false);
  platziere(MUSTER[i]);
  markiere(i);
  zeichne();
}

// ---------- Malen ----------

let malt = false;
let malWert = 1;
let letzteZelle = null;

function zelleAusEreignis(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / rect.width * SPALTEN);
  const y = Math.floor((e.clientY - rect.top) / rect.height * ZEILEN);
  return {
    x: Math.min(Math.max(x, 0), SPALTEN - 1),
    y: Math.min(Math.max(y, 0), ZEILEN - 1)
  };
}

function setzeLinie(von, bis) {
  const dx = bis.x - von.x;
  const dy = bis.y - von.y;
  const schritte = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let s = 0; s <= schritte; s++) {
    const x = Math.round(von.x + dx * s / schritte);
    const y = Math.round(von.y + dy * s / schritte);
    gitter[index(x, y)] = malWert;
  }
}

function hoereAufZuMalen() {
  malt = false;
  letzteZelle = null;
}

canvas.addEventListener("pointerdown", (e) => {
  malt = true;
  canvas.setPointerCapture(e.pointerId);
  const zelle = zelleAusEreignis(e);
  malWert = gitter[index(zelle.x, zelle.y)] ? 0 : 1;
  setzeLinie(zelle, zelle);
  letzteZelle = zelle;
  zeichne();
});

canvas.addEventListener("pointermove", (e) => {
  if (!malt) return;
  const zelle = zelleAusEreignis(e);
  setzeLinie(letzteZelle, zelle);
  letzteZelle = zelle;
  zeichne();
});

canvas.addEventListener("pointerup", hoereAufZuMalen);
canvas.addEventListener("pointercancel", hoereAufZuMalen);

// ---------- Tastatur ----------

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;

  const ziel = e.target;
  if (ziel.matches("input, textarea, select") || ziel.isContentEditable) return;

  e.preventDefault();

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }

  setzeLaeuft(!laeuft);
});

// ---------- Schleife ----------

function schleife(zeit) {
  if (laeuft && zeit - letzteZeit >= INTERVALL) {
    schritt();
    zeichne();
    letzteZeit = zeit;
  }
  requestAnimationFrame(schleife);
}

// ---------- Start ----------

zufall(0.25);
markiere(-1);
zeichne();
requestAnimationFrame(schleife);

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "game-of-life"
});