// Verbindet die Seite mit Rechnen (attraktor.js) und Zeichnen (shader.js).
// Dazu Presets, Export und die Effekt-Schicht.

import { TYPEN, PRESETS, berechnePunkte, vermesseAttraktor } from "./attraktor.js";
import { erstelleShader } from "./shader.js";
import { richteReglerEin } from "/lib/regler.js";
import { endbild, sichtbaresBild } from "/lib/effekt-schicht.js";
import { richteExportEin } from "/export.js";

// Settings

const MAX_PUNKTE = 10000000;
const MAX_ZOOM = 100000;
const BILDER_PRO_ANIMATION = 1500; // in so vielen Bildern entsteht der Attraktor (60 pro Sekunde = 25 s)

let punkte = 1000000;
let zoom = 100;
let animiert = true; // Entstehen lassen oder sofort alles zeigen

// hole() kommt aus /script.js (wirft einen Fehler, wenn die id im HTML fehlt)

const canvas = hole("feld");

const modusEntstehung = hole("toggle-animiert-sofort");
const massstabBtn = hole("massstabBtn");

const punkteFeld = hole("punkte");
const zoomFeld = hole("zoom");

const hinweis = hole("hinweis");

// Regler und Schalter: alles mit data-wert im HTML (siehe /lib/regler.js)
// einstellung.staerke, .invertiert, .farbig, .red, .blue
const { einstellung } = richteReglerEin({ beiAenderung: zeichne });

const shader = erstelleShader(canvas);


// Zustände

let typ = TYPEN.clifford; // Starttyp, wird gleich vom ersten Preset gesetzt
let werte = {};
let start = typ.start;

let mass = null; // Ergebnis von vermesseAttraktor
let ansicht = { x: 0, y: 0 }; // welcher Punkt des Attraktors in der Bildmitte liegt

let sichtbar = punkte; // wie viele Punkte gerade gezeichnet werden
let animationsId = null; // läuft gerade eine Animation? dann steht hier ihre Nummer


function passeGroesseAn() {
  // mindestens doppelt so fein rechnen, auch bei normalen Monitoren mit dpr 1
  const dpr = Math.max(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

// immer sinnvoll beim lesen von Zahlen
// Hilfsfunktion dass die Eingabe auch eine Zahl im Rahmen ist (und ganz, wenn sollGanz)
function leseZahl(feld, min, max, bisher, sollGanz = true) {
  const zahl = Number(feld.value.trim());
  if (feld.value.trim() === "" || !Number.isFinite(zahl)) {
    feld.value = bisher;
    // wenn leer oder nicht Finite dann mach den Wert was er davor war
    return bisher;
  }
  let jetzt = Math.min(Math.max(zahl, min), max);
  // soll größer min und kleiner max sein
  if (sollGanz) jetzt = Math.round(jetzt);
  feld.value = jetzt;
  return jetzt;
}


// Rechnen und Zeichnen

// Zoom, bei dem der ganze Attraktor ins Bild passt
function passenderZoom() {
  if (!mass) return zoom;
  return Math.min(canvas.width / mass.breite, canvas.height / mass.hoehe) * 0.9;
}

// rechnen nur wenn sich Typ, Werte oder Punktzahl ändern
function rechne() {
  const daten = berechnePunkte(typ, werte, punkte, start);
  shader.ladePunkte(daten);
  mass = daten ? vermesseAttraktor(daten) : null;

  hinweis.textContent = daten
    ? ""
    : "Mit diesen Werten läuft der Punkt ins Unendliche. Probier andere Zahlen.";
}

// zeichnen billig, geht bei jedem Zoom
function zeichne() {
  shader.zeichne({
    mitteX: ansicht.x, mitteY: ansicht.y, zoom, sichtbar,
    ...einstellung, // staerke, invertiert, farbig, red, blue … alle auf einmal
  });
}

function zeigeAlles() {
  if (mass) ansicht = { x: mass.mitteX, y: mass.mitteY };
  zoom = passenderZoom();
  zoomFeld.value = Math.round(zoom);
  zeichne();
}


// Entstehen lassen: jedes Bild ein paar Punkte mehr zeichnen
// gerechnet ist schon alles, der Shader zeichnet nur die ersten "sichtbar" Punkte

function stoppeAnimation() {
  if (animationsId !== null) cancelAnimationFrame(animationsId);
  animationsId = null;
}

function lassEntstehen() {
  stoppeAnimation();
  sichtbar = 0;
  const proBild = Math.ceil(punkte / BILDER_PRO_ANIMATION);

  function bildSchritt() {
    sichtbar = Math.min(sichtbar + proBild, punkte);
    zeichne();
    animationsId = sichtbar < punkte ? requestAnimationFrame(bildSchritt) : null;
  }

  animationsId = requestAnimationFrame(bildSchritt);
  // da bildSchritt auch nur eine Funktion ist, muss diese einmal nach ihrer Definition aufgerufen werden
  // bis hier wurde sie lediglich definiert
  // läuft also nicht nach bildSchritt durch, sondern ist der erste Funktionsaufruf
  // und sagt was beim nächsten Frame gemacht werden soll
}

// nach dem Rechnen: je nach Modus entstehen lassen oder sofort alles zeigen
function zeigeNeu() {
  if (animiert) {
    lassEntstehen();
  } else {
    stoppeAnimation();
    sichtbar = punkte;
    zeichne();
  }
}


// Felder und Knöpfe

modusEntstehung.addEventListener("click", () => {
  animiert = !animiert;
  // der Knopf zeigt, was ein Klick als Nächstes macht
  modusEntstehung.textContent = animiert ? "Sofort anzeigen" : "Entstehen lassen";
  zeigeNeu();
});

punkteFeld.addEventListener("change", () => {
  punkte = leseZahl(punkteFeld, 1000, MAX_PUNKTE, punkte);
  rechne();
  zeigeNeu(); // Ansicht bleibt, nur mehr oder weniger Punkte
});

zoomFeld.addEventListener("change", () => {
  zoom = leseZahl(zoomFeld, 1, MAX_ZOOM, zoom, false);
  zeichne(); // nur zeichnen
});

massstabBtn.addEventListener("click", zeigeAlles);

// Mausrad: zoomen, die Stelle unter dem Zeiger bleibt stehen

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();

  const abstand = mausAbstand(event);
  const punkt = punktBei(abstand); // merken, bevor der Zoom sich ändert

  let delta = event.deltaY;
  if (event.deltaMode === 1) delta *= 16; // manche Mäuse melden Zeilen statt Pixel
  zoom *= Math.exp(-delta * 0.0015);
  zoom = Math.min(Math.max(zoom, 1), MAX_ZOOM);

  haltePunkt(punkt, abstand); // derselbe Punkt, dieselbe Maus, neuer Zoom

  zoomFeld.value = Math.round(zoom);
  zeichne();
}, { passive: false });

// Abstand der Maus zur Canvas-Mitte
function mausAbstand(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    // müssen hier den canvas durch rect teilen, alle Pixel im Canvas sind bei
    // passeGroesseAn mit dpr multipliziert worden und damit ist nicht jeder
    // Punkt im rect genau der Punkt im canvas
    dx: (event.clientX - rect.left) * (canvas.width / rect.width) - canvas.width / 2,
    dy: (event.clientY - rect.top) * (canvas.height / rect.height) - canvas.height / 2,
    // zurück kommt der Punkt relativ zur Canvas-Mitte
  };
}

// Welcher Punkt des Attraktors liegt bei diesem Abstand?
// durch den zoom teilen, denn beim malen des Punktes hatten wir zuvor den zoom multipliziert
function punktBei({ dx, dy }) {
  return {
    x: ansicht.x + dx / zoom,
    y: ansicht.y + dy / zoom,
  };
}

// Ansicht so setzen, dass dieser Punkt bei diesem Abstand liegt
function haltePunkt(punkt, { dx, dy }) {
  ansicht.x = punkt.x - dx / zoom;
  ansicht.y = punkt.y - dy / zoom;
}


// Finger und Maus: ein Zeiger verschiebt, zwei Zeiger zoomen und verschieben
// das Muster ist bei Fingern immer gleich (ersetzen dann auch die einfachen pointer listener)

const finger = new Map(); // pointerId → Abstand zur Canvas-Mitte

let gegriffen = null; // der Punkt des Attraktors, der festgehalten wird
let startAbstand = 1; // Abstand der zwei Finger beim Aufsetzen
let startZoom = 1; // Zoom beim Aufsetzen des zweiten Fingers

// Die Finger als Liste
function alleFinger() {
  return [...finger.values()];
}

// Punkt genau zwischen zwei Fingern
function mitteZwischen(a, b) {
  return { dx: (a.dx + b.dx) / 2, dy: (a.dy + b.dy) / 2 };
}

// Abstand der beiden Finger zueinander
function abstandZwischen(a, b) {
  return Math.hypot(a.dx - b.dx, a.dy - b.dy);
}

// Neu anfassen, je nachdem, wie viele Finger gerade drauf sind
function greifeNeu() {
  if (finger.size === 1) {
    const [a] = alleFinger();
    gegriffen = punktBei(a);
  } else if (finger.size === 2) {
    const [a, b] = alleFinger();
    gegriffen = punktBei(mitteZwischen(a, b));
    startAbstand = Math.max(abstandZwischen(a, b), 1); // nie 0, sonst teilen wir unten durch 0
    startZoom = zoom;
  } else {
    gegriffen = null;
  }
}

canvas.addEventListener("pointerdown", (event) => {
  finger.set(event.pointerId, mausAbstand(event));
  canvas.setPointerCapture(event.pointerId);
  greifeNeu();
});

canvas.addEventListener("pointermove", (event) => {
  if (!finger.has(event.pointerId)) return; // Maus nur drüber, nicht gedrückt
  finger.set(event.pointerId, mausAbstand(event));

  if (finger.size === 1) {
    const [a] = alleFinger();
    haltePunkt(gegriffen, a);
  } else if (finger.size === 2) {
    const [a, b] = alleFinger();
    zoom = startZoom * (abstandZwischen(a, b) / startAbstand);
    zoom = Math.min(Math.max(zoom, 1), MAX_ZOOM);
    haltePunkt(gegriffen, mitteZwischen(a, b));
    zoomFeld.value = Math.round(zoom);
  }

  zeichne();
});

function lassLos(event) {
  finger.delete(event.pointerId);
  greifeNeu(); // mit den übrigen Fingern neu anfassen
}

canvas.addEventListener("pointerup", lassLos);
canvas.addEventListener("pointercancel", lassLos);


// Presets in HTML

const presetBox = document.querySelector(".presets");
const werteBox = document.querySelector(".werte");
const presetName = hole("preset-name");
const presetText = hole("preset-text");
const formelFeld = hole("formel");

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
    feld.step = "any";
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
      rechne();
      zeigeAlles(); // neue Form, neue Größe
      zeigeNeu();
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
    presetName.textContent = `${typ.name} - eigene Werte`;
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
  rechne();
  zeigeAlles();
  zeigeNeu();
}


// Start

punkteFeld.value = punkte;

let ersteGroesse = true;

const beobachter = new ResizeObserver(() => {
  const alteBreite = canvas.width;
  passeGroesseAn();
  if (ersteGroesse) {
    ersteGroesse = false;
    waehlePreset(0); // passender Zoom braucht die echte Größe
  } else {
    // zoom ist "Canvas-Pixel pro Einheit": wird der Canvas breiter,
    // muss der zoom mitwachsen, sonst sieht man plötzlich mehr vom Attraktor
    zoom *= canvas.width / alteBreite;
    zoomFeld.value = Math.round(zoom);
    zeichne();
  }
});

beobachter.observe(canvas);


// Export (siehe /export.js)
// beim Rendern entsteht der Attraktor genau über die Videolänge verteilt

let renderProBild = 0;

const render = {
  start(n) {
    stoppeAnimation();
    if (animiert) {
      sichtbar = 0;
      renderProBild = Math.ceil(punkte / n);
    } else {
      sichtbar = punkte;
      renderProBild = 0;
    }
  },
  bild() {
    sichtbar = Math.min(sichtbar + renderProBild, punkte);
    zeichne();
  },
  ende() {
    sichtbar = punkte; // Bild vollständig hinterlassen
    zeichne();
  },
};

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: () => typ.name.toLowerCase().replace(/\s+/g, "-"),
  anzeige: sichtbaresBild,
  endbild,
  render,
});

