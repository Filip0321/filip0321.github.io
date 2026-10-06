const canvas = document.getElementById("feld");
const ctx = canvas.getContext("2d");

const SPALTEN = 80;
const ZEILEN = 60;
const ZELLE = 8;

canvas.width = SPALTEN * ZELLE;
canvas.height = ZEILEN * ZELLE;

let gitter = new Uint8Array(SPALTEN * ZEILEN);
let naechstes = new Uint8Array(SPALTEN * ZEILEN);

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
      const lebtWeiter = lebt ? (n === 2 || n === 3) : (n === 3);
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

function zeichne() {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#DDDDDD";
  for (let y = 0; y < ZEILEN; y++) {
    for (let x = 0; x < SPALTEN; x++) {
      if (gitter[index(x, y)]) {
        ctx.fillRect(x * ZELLE, y * ZELLE, ZELLE -1, ZELLE -1);
      }
    }
  }
}

const INTERVALL = 100;
let letzteZeit = 0;

function schleife(zeit) {
  if (zeit - letzteZeit >= INTERVALL) {
    schritt();
    zeichne();
    letzteZeit = zeit;
  }
  requestAnimationFrame(schleife);
}

zufall(0.25);
zeichne();
requestAnimationFrame(schleife);