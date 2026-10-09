// Konstanten - Spielfeld
const SPALTEN = 80;
const ZEILEN = 60;
const ZELLE = 8;
const INTERVALL = 100;  // ms zwischen den Generationen


// Bekannte Muster
// O = lebende Zelle, . = tote Zelle

const MUSTER = [
  {
    name: "Glider",
    text: "Das bekannteste Muster in Conway's Game of Life. Fliegt diagonal ewig über das Feld.",
    zellen: [
      ".O.",
      "..O",
      "OOO"
    ]
  },
  {
    name: "Spaceship",
    text: "Wie der Glider, aber schneller und horizontal.",
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
    text: "Klein, aber sehr langlebig. Über 1100 Generationen, bevor es sich auflöst.",
    zellen: [
      ".OO",
      "OO.",
      ".O."
    ]
  },
  {
    name: "Glider Gun",
    text: "Bill Gospers Glider Gun von 1970 erzeugt alle 30 Generationen einen neuen Gleiter.",
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


// Spielfeld-Canvas initialisieren

const canvas = document.getElementById("feld");
const ctx = canvas.getContext("2d");

canvas.width = SPALTEN * ZELLE;
canvas.height = ZEILEN * ZELLE;


// Zustände der Zellen (erstmal zwei leere Arrays) 

let gitter = new Uint8Array(SPALTEN * ZEILEN);
let naechstes = new Uint8Array(SPALTEN * ZEILEN);
let laeuft = true;
let letzteZeit = 0;


// Simulation
 
function index(x, y) {
  return y * SPALTEN + x; // der Index in einem eindimensionalen Array für die Zelle (x, y)
                          // ich könnte genauso gut (y + ZEILEN * x), aber müsste es dann überall ändern
                          // weil dies sagt wie die Zellen im Array gespeichert sind
                          
} 

function nachbarn(x, y) {
  let anzahl = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + SPALTEN) % SPALTEN; // Wrap around horizontally
      const ny = (y + dy + ZEILEN) % ZEILEN;   // Wrap around vertically
      anzahl += gitter[index(nx, ny)];
    }
  }
  return anzahl;
}

function schritt() {
  for (let y = 0; y < ZEILEN; y++) {
    for (let x = 0; x < SPALTEN; x++) {
      const n = nachbarn(x, y);
      const lebt = gitter[index(x, y)]; // Array enthält 1 für lebende Zellen und 0 für tote Zellen
      const lebtWeiter = lebt ? (n === 2 || n === 3) : n === 3; // Regeln: 
                                                                // Lebende Zelle mit 2 oder 3 Nachbarn lebt weiter, 
                                                                // tote Zelle mit genau 3 Nachbarn wird lebendig
      naechstes[index(x, y)] = lebtWeiter ? 1 : 0;
    }
  }
  [gitter, naechstes] = [naechstes, gitter]; // die neue array wird zur aktuellen generation
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


// Die Simulation darstellen 

function zeichne() {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#DDDDDD";
  for (let y = 0; y < ZEILEN; y++) {
    for (let x = 0; x < SPALTEN; x++) {
      if (gitter[index(x, y)]) {
        ctx.fillRect(x * ZELLE, y * ZELLE, ZELLE - 1, ZELLE - 1); // -1 für einen kleinen Abstand zwischen den Zellen
      }
    }
  }
}


// Buttons zum kontrollieren der Simulation

const startKnopf = document.getElementById("start");
const schrittKnopf = document.getElementById("schritt");
const leerenKnopf = document.getElementById("leeren");
const neuKnopf = document.getElementById("neu");

function setzeLaeuft(wert) {
  laeuft = wert;
  startKnopf.textContent = laeuft ? "Pause" : "Start";
}

startKnopf.addEventListener("click", () => {
  setzeLaeuft(!laeuft); // Toggle the running state
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


// Presets

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


// selber malen 

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


// Start/Pause mit Leertaste

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


// Animation

function schleife(zeit) {
  if (laeuft && zeit - letzteZeit >= INTERVALL) {
    schritt();
    zeichne();
    letzteZeit = zeit;
  }
  requestAnimationFrame(schleife);
}

// Startwerte setzen und Animation starten

zufall(0.25);
markiere(-1);
zeichne();
requestAnimationFrame(schleife);


// Exportfunktion (sieht export.js)

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "game-of-life"
});