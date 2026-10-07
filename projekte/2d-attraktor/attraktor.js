// ---------- Einstellungen ----------

const MAX_PUNKTE = 1000000;
const BILDER_PRO_ANIMATION = 1500;

let punkte = 600000;
let staerke = 15;
let animiert = true;

// ---------- Attraktor-Typen ----------

const TYPEN = {
  clifford: {
    name: "Clifford",
    formel: "x' = sin(a·y) + c·cos(a·x)\ny' = sin(b·x) + d·cos(b·y)",
    schritt(w, pos) {
      const x = Math.sin(w.a * pos.y) + w.c * Math.cos(w.a * pos.x);
      const y = Math.sin(w.b * pos.x) + w.d * Math.cos(w.b * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  dejong: {
    name: "Peter de Jong",
    formel: "x' = sin(a·y) − cos(b·x)\ny' = sin(c·x) − cos(d·y)",
    schritt(w, pos) {
      const x = Math.sin(w.a * pos.y) - Math.cos(w.b * pos.x);
      const y = Math.sin(w.c * pos.x) - Math.cos(w.d * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  svensson: {
    name: "Svensson",
    formel: "x' = d·sin(a·x) − sin(b·y)\ny' = c·cos(a·x) + cos(b·y)",
    schritt(w, pos) {
      const x = w.d * Math.sin(w.a * pos.x) - Math.sin(w.b * pos.y);
      const y = w.c * Math.cos(w.a * pos.x) + Math.cos(w.b * pos.y);
      pos.x = x;
      pos.y = y;
    }
  }
};

// ---------- Presets ----------

const PRESETS = [
  {
    name: "Clifford I",
    typ: "clifford",
    werte: { a: -1.4, b: 1.6, c: 1.0, d: 0.7 },
    text: "Platzhalter: beschreib hier in eigenen Worten, was du siehst."
  },
  {
    name: "Clifford II",
    typ: "clifford",
    werte: { a: 1.7, b: 1.7, c: 0.6, d: 1.2 },
    text: "Platzhalter."
  },
  {
    name: "De Jong I",
    typ: "dejong",
    werte: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 },
    text: "Platzhalter."
  },
  {
    name: "De Jong II",
    typ: "dejong",
    werte: { a: -2.7, b: -0.09, c: -0.86, d: -2.2 },
    text: "Platzhalter."
  },
  {
    name: "Svensson",
    typ: "svensson",
    werte: { a: 1.4, b: 1.56, c: 1.4, d: -6.56 },
    text: "Platzhalter."
  }
];

// ---------- Canvas ----------

const canvas = document.getElementById("feld");
const ctx = canvas.getContext("2d");

function passeGroesseAn() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

// ---------- Zustand ----------

let typ = TYPEN.clifford;
const werte = { a: 0, b: 0, c: 0, d: 0 };
const pos = { x: 0.1, y: 0.1 };

let bild = null;
let abbildung = null;
let gezeichnet = 0;
let animationsId = null;

// ---------- Rechnen ----------

function bestimmeAbbildung() {
  const probe = { x: 0.1, y: 0.1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < 20000; i++) {
    typ.schritt(werte, probe);
    if (i < 100) continue;
    if (probe.x < minX) minX = probe.x;
    if (probe.x > maxX) maxX = probe.x;
    if (probe.y < minY) minY = probe.y;
    if (probe.y > maxY) maxY = probe.y;
  }

  const breite = Math.max(maxX - minX, 1e-9);
  const hoehe = Math.max(maxY - minY, 1e-9);

  return {
    massstab: Math.min(canvas.width / breite, canvas.height / hoehe) * 0.9,
    mitteX: (minX + maxX) / 2,
    mitteY: (minY + maxY) / 2
  };
}

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
  pos.x = 0.1;
  pos.y = 0.1;
  gezeichnet = 0;
  abbildung = bestimmeAbbildung();
}

function punkteHinzufuegen(anzahl) {
  const w = bild.width;
  const h = bild.height;
  const pixel = bild.data;
  const { massstab, mitteX, mitteY } = abbildung;
  const ende = Math.min(gezeichnet + anzahl, punkte);

  for (; gezeichnet < ende; gezeichnet++) {
    typ.schritt(werte, pos);
    if (gezeichnet < 100) continue;

    const px = Math.floor(w / 2 + (pos.x - mitteX) * massstab);
    const py = Math.floor(h / 2 + (pos.y - mitteY) * massstab);
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
  zeichne();
});

staerkeFeld.addEventListener("change", () => {
  staerke = leseGanzzahl(staerkeFeld, 1, 255, staerke);
  zeichne();
});

punkteFeld.value = punkte;
staerkeFeld.value = staerke;

// ---------- Presets und Werte ----------

const presetBox = document.querySelector(".presets");
const presetName = document.getElementById("preset-name");
const presetText = document.getElementById("preset-text");
const formelFeld = document.getElementById("formel");

const felder = {
  a: document.getElementById("wert-a"),
  b: document.getElementById("wert-b"),
  c: document.getElementById("wert-c"),
  d: document.getElementById("wert-d")
};

PRESETS.forEach((preset, i) => {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.textContent = preset.name;
  knopf.addEventListener("click", () => waehlePreset(i));
  presetBox.append(knopf);
});

function zeigeWerte() {
  for (const name in felder) {
    felder[name].value = werte[name];
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
  Object.assign(werte, preset.werte);
  zeigeWerte();
  markiere(i);
  zeichne();
}

for (const name in felder) {
  felder[name].addEventListener("change", () => {
    const eingabe = felder[name].value.trim();
    const zahl = Number(eingabe);

    if (eingabe === "" || !Number.isFinite(zahl)) {
      felder[name].value = werte[name];
      return;
    }

    werte[name] = zahl;
    markiere(-1);
    zeichne();
  });
}

// ---------- Quelltext anzeigen ----------

const codeBox = document.querySelector(".code");
const quelltext = document.getElementById("quelltext");

codeBox.addEventListener("toggle", () => {
  fetch("attraktor.js")
    .then(antwort => antwort.text())
    .then(text => {
      quelltext.textContent = text;
    })
    .catch(() => {
      quelltext.textContent = "Der Code konnte nicht geladen werden.";
    });
}, { once: true });

// ---------- Start ----------

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