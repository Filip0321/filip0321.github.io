// ---------- Einstellungen ----------

const PUNKTE = 200000;
const PRO_BILD = 1500;
const parameter = { a: -1.4, b: 1.6, c: 1.0, d: 0.7 };
const STAERKE = 40;

// ---------- Canvas ----------

const canvas = document.getElementById("feld");
const ctx = canvas.getContext("2d");

function passeGroesseAn() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

// ---------- Zustand ----------

let bild = null;
let x = 0.1;
let y = 0.1;
let gezeichnet = 0;
let animationsId = null;

// ---------- Zeichnen ----------

function neuesBild() {
  bild = ctx.createImageData(canvas.width, canvas.height);
  const pixel = bild.data;
  for (let i = 0; i < pixel.length; i += 4) {
    pixel[i] = 17;
    pixel[i + 1] = 17;
    pixel[i + 2] = 17;
    pixel[i + 3] = 255;
  }
  x = 0.1;
  y = 0.1;
  gezeichnet = 0;
}

function punkteHinzufuegen(anzahl) {
  const w = bild.width;
  const h = bild.height;
  const pixel = bild.data;
  const { a, b, c, d } = parameter;
  const ausdehnung = Math.max(1 + Math.abs(c), 1 + Math.abs(d));
  const massstab = (Math.min(w, h) / 2) * 0.9 / ausdehnung;

  const ende = Math.min(gezeichnet + anzahl, PUNKTE);

  for (; gezeichnet < ende; gezeichnet++) {
    const xNeu = Math.sin(a * y) + c * Math.cos(a * x);
    const yNeu = Math.sin(b * x) + d * Math.cos(b * y);
    x = xNeu;
    y = yNeu;

    if (gezeichnet < 100) continue;

    const px = Math.floor(w / 2 + x * massstab);
    const py = Math.floor(h / 2 + y * massstab);
    if (px < 0 || px >= w || py < 0 || py >= h) continue;

    const stelle = (py * w + px) * 4;
    pixel[stelle] += STAERKE;
    pixel[stelle + 1] += STAERKE;
    pixel[stelle + 2] += STAERKE;
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
  punkteHinzufuegen(PUNKTE);
  zeige();
}

function zeichneAnimiert() {
  stoppeAnimation();
  neuesBild();

  function bildSchritt() {
    punkteHinzufuegen(PRO_BILD);
    zeige();
    if (gezeichnet < PUNKTE) {
      animationsId = requestAnimationFrame(bildSchritt);
    } else {
      animationsId = null;
    }
  }

  animationsId = requestAnimationFrame(bildSchritt);
}

// ---------- Steuerung ----------

document.getElementById("animiert").addEventListener("click", zeichneAnimiert);
document.getElementById("sofort").addEventListener("click", zeichneSofort);

// ---------- Start ----------

window.addEventListener("resize", () => {
  passeGroesseAn();
  zeichneSofort();
});

passeGroesseAn();
zeichneSofort();