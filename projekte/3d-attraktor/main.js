// Verbindet die Seite mit Rechnen (attraktor.js) und Zeichnen (shader.js).
// Dazu Presets, Export, Effekt-Schicht und automatisches Drehen.

import { TYPEN, PRESETS, berechnePunkte, vermesseAttraktor } from "./attraktor.js";
import { erstelleShader } from "./shader.js";
import { richteReglerEin } from "/lib/regler.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";
import { richteExportEin } from "/lib/export.js";

const MAX_PUNKTE = 10000000;
const BILDER_PRO_ANIMATION = 1500; // in so vielen Bildern entsteht der Attraktor (60 pro Sekunde = 25 s)

const START_ABSTAND = 3.5; // bei 2.5 wurden vordere Punkte großer Attraktoren oben abgeschnitten
const BRENNWEITE = 2;
const MIN_ABSTAND = 0.2;
const MAX_ABSTAND = 20;
const EMPFINDLICHKEIT = 0.01;
const START_WINKEL = 0.6;
const START_NEIGUNG = 0.35;
const DREH_PRO_SEKUNDE = 0.12; // automatisches Drehen, Bogenmaß pro Sekunde

let punkte = 1000000;
let animiert = true; // Entstehen lassen oder sofort alles zeigen
let dreht = false; // automatisch drehen lassen

let abstand = START_ABSTAND;

// hole() kommt aus /script.js (wirft einen Fehler, wenn die id im HTML fehlt)

const canvas = hole("feld");

const modusEntstehung = hole("toggle-animiert-sofort");
const drehenKnopf = hole("toggle-drehen");
const ansichtBtn = hole("zuruecksetzen");

const punkteFeld = hole("punkte");
const abstandFeld = hole("abstand");
// die Zahlenfelder (die Regler kommen über data-wert)

const hinweis = hole("hinweis");

// Regler und Schalter: alles mit data-wert im HTML (siehe /lib/regler.js)
// einstellung.staerke, .invertiert, .travel, .laenge, .kopf, .tempo, .rest, .glanz, .farbig, .red, .blue
const { einstellung, felder, setze } = richteReglerEin({
  beiAenderung: zeichne,
  extra: { travel: schalteWandern }, // was außer zeichne() noch passieren soll
});

const shader = erstelleShader(canvas);

// Zustände

let typ = TYPEN.lorenz; // wird gleich vom ersten Preset gesetzt
let werte = {};

let groesse = null; // Ergebnis von vermesseAttraktor
let anzahl = 0; // so viele Punkte wurden wirklich berechnet (weniger, wenn der Punkt davonläuft)

let winkel = START_WINKEL;
let neigung = START_NEIGUNG;
let brennweite = BRENNWEITE;
let versatz = { x: 0, y: 0 };

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

// rechnen nur wenn sich Typ, Werte oder Punktzahl ändern
function rechne() {
  // berechnen der Punkte in attraktor.js
  const daten = berechnePunkte(typ, werte, punkte);
  shader.ladePunkte(daten);
  anzahl = daten ? daten.length / 3 : 0;
  groesse = daten ? vermesseAttraktor(daten) : null;

  // der Kopf kann nur so weit wandern, wie es Punkte gibt
  felder.kopf.max = anzahl;
  if (einstellung.kopf > anzahl) setze("kopf", 0);

  if (anzahl === 0) {
    hinweis.textContent = "Mit diesen Werten läuft der Punkt sofort ins Unendliche. Probier andere Zahlen.";
  } else if (anzahl < punkte) {
    hinweis.textContent = `Mit diesen Werten läuft der Punkt nach ${anzahl.toLocaleString("de-DE")} Schritten ins Unendliche.`;
  } else {
    hinweis.textContent = "";
  }
}

// zeichnen billig, geht bei jeder Drehung
function zeichne() {
  // ohne Punkte gibt es keine Vermessung, der Shader leert dann nur das Bild
  const g = groesse ?? { mitteX: 0, mitteY: 0, mitteZ: 0, mass: 1 };
  shader.zeichne({
    mitteX: g.mitteX,
    mitteY: g.mitteY,
    mitteZ: g.mitteZ,
    mass: g.mass,
    winkel, neigung, abstand, versatz, brennweite, sichtbar,
    ...einstellung, // staerke, invertiert, travel, laenge, kopf, rest, glanz, farbig, red, blue … alle auf einmal
  });
}

function ansichtZurueck() {
  winkel = START_WINKEL;
  neigung = START_NEIGUNG;
  abstand = START_ABSTAND;
  abstandFeld.value = abstand;
  versatz = { x: 0, y: 0 };
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
  const proBild = Math.max(1, Math.ceil(anzahl / BILDER_PRO_ANIMATION));

  function bildSchritt() {
    sichtbar = Math.min(sichtbar + proBild, anzahl);
    zeichne();
    animationsId = sichtbar < anzahl ? requestAnimationFrame(bildSchritt) : null;
  }

  animationsId = requestAnimationFrame(bildSchritt);
  // bildSchritt ist bis hier nur definiert, nicht gestartet:
  // diese Zeile verabredet den ersten Aufruf, jeden weiteren verabredet bildSchritt selbst
}

// nach dem Rechnen: je nach Modus entstehen lassen oder sofort alles zeigen
function zeigeNeu() {
  if (animiert) {
    lassEntstehen();
  } else {
    stoppeAnimation();
    sichtbar = anzahl;
    zeichne();
  }
}


// Bewegung: automatisch drehen und den Kometen wandern lassen
// eine gemeinsame Kette für beides, damit pro Bild nur einmal gezeichnet wird

let laufId = null;
let letzteZeit = null; // Zeitpunkt des letzten Bildes in ms, null = gerade erst gestartet

function laufe(zeit) {
  // zeit kommt von requestAnimationFrame: Millisekunden seit dem Laden der Seite
  if (letzteZeit === null) letzteZeit = zeit; // erstes Bild: noch keine Zeit vergangen
  const sekunden = Math.min((zeit - letzteZeit) / 1000, 0.1);
  // höchstens 0.1 s: war der Tab im Hintergrund, pausiert der Browser die Kette,
  // und beim Zurückkommen wären sonst viele Sekunden auf einmal vergangen → Sprung
  letzteZeit = zeit;

  bewege(sekunden);
  zeichne();

  if (dreht || einstellung.travel) {
    laufId = requestAnimationFrame(laufe); // immer verabreden, sonst stirbt die Kette
  } else {
    laufId = null; // nichts mehr zu bewegen: Kette endet
    letzteZeit = null; // beim nächsten Start wieder mit "keine Zeit vergangen" beginnen
  }
}

// um eine Zeitspanne weiterbewegen (auch beim Video-Rendern, dort mit festen 1/30 s)
function bewege(sekunden) {
  if (dreht) winkel += DREH_PRO_SEKUNDE * sekunden;
  if (einstellung.travel) wandere(sekunden);
}

function wandere(sekunden) {
  if (anzahl === 0) return;
  let kopf = einstellung.kopf + einstellung.tempo * sekunden; // tempo = Punkte pro Sekunde

  if (kopf >= anzahl) {
    if (!einstellung.endlos) {
      // einmal durch: Wandern aus, danach wieder alles normal zeigen
      setze("travel", false);
      setze("kopf", 0);
      return;
    }
    kopf %= anzahl; // endlos: von vorn
  }

  setze("kopf", kopf);
}

// startet die Kette, wenn es etwas zu bewegen gibt und sie nicht schon läuft
// (sonst wären es zwei Ketten, und alles liefe doppelt so schnell)
function starteLaufen() {
  if (laufId === null && (dreht || einstellung.travel)) {
    laufId = requestAnimationFrame(laufe);
  }
}

function stoppeLaufen() {
  if (laufId !== null) cancelAnimationFrame(laufId);
  laufId = null;
  letzteZeit = null;
}

// Häkchen Travel: an startet, aus setzt den Kopf zurück (die Kette endet von selbst)
function schalteWandern() {
  if (!einstellung.travel) setze("kopf", Number(felder.kopf.min));
  starteLaufen();
}


// Knöpfe und Felder

modusEntstehung.addEventListener("click", () => {
  animiert = !animiert;
  // der Knopf zeigt, was ein Klick als Nächstes macht
  modusEntstehung.textContent = animiert ? "Sofort anzeigen" : "Entstehen lassen";
  zeigeNeu();
});

drehenKnopf.addEventListener("click", () => {
  dreht = !dreht;
  drehenKnopf.textContent = dreht ? "Drehen stoppen" : "Drehen lassen";
  drehenKnopf.setAttribute("aria-pressed", dreht);
  starteLaufen();
});

ansichtBtn.addEventListener("click", ansichtZurueck);

punkteFeld.addEventListener("change", () => {
  punkte = leseZahl(punkteFeld, 1000, MAX_PUNKTE, punkte);
  rechne();
  zeigeNeu();
});

abstandFeld.addEventListener("change", () => {
  abstand = leseZahl(abstandFeld, MIN_ABSTAND, MAX_ABSTAND, abstand, false);
  zeichne(); // nur zeichnen
});


// Mausrad: Kamera fährt näher ran oder weiter weg

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();

  let delta = event.deltaY;
  if (event.deltaMode === 1) delta *= 16; // manche Mäuse melden Zeilen statt Pixel
  abstand *= Math.exp(+delta * 0.0015); // +delta weil Mausrad nach vorn die Kamera näher bringt
  abstand = Math.min(Math.max(abstand, MIN_ABSTAND), MAX_ABSTAND);

  abstandFeld.value = abstand.toFixed(2);
  zeichne();
}, { passive: false });


// Maus und Finger
// ein Zeiger dreht (mit Shift: schieben, mit Alt oder Strg: zoomen)
// zwei Finger: auseinander zoomt, gemeinsam bewegen schiebt

const finger = new Map(); // pointerId → { x, y } in CSS-Pixeln
let griff = null; // Startwerte beim Aufsetzen

function alleFinger() {
  return [...finger.values()];
}

// art: "drehen", "schieben" oder "zoomen", nur wichtig bei einem Zeiger
function greifeNeu(art = "drehen") {
  const liste = alleFinger();
  if (liste.length === 1) {
    const [a] = liste;
    griff = {
      art,
      x: a.x,
      y: a.y,
      winkel,
      neigung,
      abstand,
      versatz: { ...versatz },
    };
  } else if (liste.length === 2) {
    const [a, b] = liste;
    griff = {
      mitte: mitteFinger(a, b),
      fingerAbstand: Math.max(abstandZwischen(a, b), 1), // nie 0, sonst teilen wir durch 0
      abstand, // Kamera beim Aufsetzen
      versatz: { ...versatz }, // Kopie, nicht dasselbe Objekt!
    };
  } else {
    griff = null;
  }
}

function mitteFinger(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function abstandZwischen(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("zieht"); // Mauszeiger "greifen" (css/canvas.css)
  finger.set(event.pointerId, { x: event.clientX, y: event.clientY });

  // Tasten werden nur beim Aufsetzen gelesen: loslassen mitten im Ziehen ändert nichts
  let art = "drehen";
  if (event.shiftKey) art = "schieben";
  else if (event.altKey || event.ctrlKey) art = "zoomen";

  greifeNeu(art);
  // erstellt griff Objekt
});

canvas.addEventListener("pointermove", (event) => {
  if (!griff) return; // zum Beispiel bei drei Fingern ist griff absichtlich null
  if (!finger.has(event.pointerId)) return; // Maus nur drüber, nicht gedrückt
  finger.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const liste = alleFinger();
  // liste hat für jeden Finger { x, y }:
  // seine Position beim letzten pointermove (aus event.clientX/Y)

  if (liste.length === 1) {
    const dx = liste[0].x - griff.x; // Strecke seit dem Aufsetzen in Pixeln
    const dy = liste[0].y - griff.y;

    if (griff.art === "schieben") {
      versatz = {
        x: griff.versatz.x + dx * 2 / canvas.clientWidth,
        y: griff.versatz.y - dy * 2 / canvas.clientHeight,
      };
    } else if (griff.art === "zoomen") {
      // nach oben ziehen = näher ran; exp wie beim Mausrad, damit es sich gleich anfühlt
      abstand = griff.abstand * Math.exp(dy * 0.005);
      abstand = Math.min(Math.max(abstand, MIN_ABSTAND), MAX_ABSTAND);
      abstandFeld.value = abstand.toFixed(2);
    } else {
      winkel = griff.winkel + dx * EMPFINDLICHKEIT;
      neigung = Math.min(Math.max(griff.neigung + dy * EMPFINDLICHKEIT, -Math.PI / 2), Math.PI / 2);
    }
  } else if (liste.length === 2) {
    // griff Objekt ist jetzt schon erstellt
    // durch die Funktion greifeNeu()
    const verhaeltnis = abstandZwischen(liste[0], liste[1]) / griff.fingerAbstand;
    abstand = griff.abstand / verhaeltnis;
    abstand = Math.min(Math.max(abstand, MIN_ABSTAND), MAX_ABSTAND);
    abstandFeld.value = abstand.toFixed(2);

    const mitte = mitteFinger(liste[0], liste[1]);
    // wo ist die mitte der beiden Finger
    const dx = mitte.x - griff.mitte.x;
    const dy = mitte.y - griff.mitte.y;

    versatz = {
      x: griff.versatz.x + dx * 2 / canvas.clientWidth,
      y: griff.versatz.y - dy * 2 / canvas.clientHeight,
      // Ein Pixel ist 2 / canvas.clientWidth Einheiten
      // Bei y ist das Vorzeichen umgedreht, weil der Finger nach unten positive Pixel gibt,
      // im Clip Space aber oben positiv ist
    };
  }
  zeichne();
});

function lassLos(event) {
  finger.delete(event.pointerId);
  if (finger.size === 0) canvas.classList.remove("zieht");
  greifeNeu(); // mit den übrigen Fingern weitermachen
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

  // parameter: Paare aus [Schlüssel in werte, angezeigtes Zeichen]
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
      rechne();
      zeigeNeu();
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
  rechne();
  zeigeNeu();
}


// Start

punkteFeld.value = punkte;

let ersteGroesse = true;

const beobachter = new ResizeObserver(() => {
  passeGroesseAn();
  if (ersteGroesse) {
    ersteGroesse = false;
    ansichtZurueck();
    waehlePreset(0);
    starteLaufen(); // falls der Browser das Travel-Häkchen beim Neuladen wiederhergestellt hat
  } else {
    zeichne();
  }
});

beobachter.observe(canvas);


// Export (siehe /export.js)
// beim Rendern: Entstehen, Drehen und Komet Bild für Bild mit fester Zeit (1/30 s)

let renderProBild = 0;

const render = {
  start(n) {
    stoppeAnimation();
    stoppeLaufen(); // die Live-Kette hält still, das Rendern bewegt selbst
    if (animiert) {
      sichtbar = 0;
      renderProBild = Math.max(1, Math.ceil(anzahl / n)); // Entstehen genau über die Videolänge verteilt
    } else {
      sichtbar = anzahl;
      renderProBild = 0;
    }
  },
  bild(i, dt) {
    sichtbar = Math.min(sichtbar + renderProBild, anzahl);
    bewege(dt);
    zeichne();
  },
  ende() {
    sichtbar = anzahl; // Bild vollständig hinterlassen
    zeichne();
    starteLaufen();
  },
  // Vorschau im Export-Fenster: Drehwinkel und Komet merken, die Vorschau springt hin und her
  merke() {
    const alt = { winkel, kopf: einstellung.kopf, travel: einstellung.travel };
    return () => {
      winkel = alt.winkel;
      setze("kopf", alt.kopf);
      setze("travel", alt.travel);
    };
  },
  // Bild i direkt: Punkte wie nach i + 1 Schritten, Bewegung für (i + 1) · dt Sekunden auf einmal
  vorschau(i, n, dt) {
    sichtbar = Math.min(sichtbar + renderProBild * (i + 1), anzahl);
    bewege((i + 1) * dt);
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
  zuschnitt: crtZuschnitt,
});
