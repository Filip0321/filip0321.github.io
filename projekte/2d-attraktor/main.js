// Verbindet die Seite mit Rechnen (attraktor.js) und Zeichnen (shader.js).
// Dazu Presets, Export und die Effekt-Schicht.

import { TYPEN, PRESETS, berechnePunkte, vermesseAttraktor } from "./attraktor.js";
import { erstelleShader } from "./shader.js";
import { richteReglerEin } from "/lib/regler.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";
import { richteExportEin, FPS } from "/lib/export.js";
import { hexZuRgb, skalaAnker, farbtabelle } from "/lib/farben.js";
import { richteKarteEin } from "/lib/parameterkarte.js";
import { richteAttraktorTonEin } from "/lib/attraktor-ton.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteSzenenEin } from "/lib/szenen.js";

// Settings

const MAX_PUNKTE = 10000000;
const MAX_ZOOM = 100000;
const LICHT_PRO_SEKUNDE = 30; // „Licht drehen lassen“: Grad pro Sekunde
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
const { einstellung, felder, setze, setzeAlle } = richteReglerEin({ beiAenderung: zeichne, 
                                          extra: { 
                                            verlauf: neuerVerlauf, 
                                            anfang: neuerVerlauf, 
                                            ende: neuerVerlauf,
                                            umgedreht: neuerVerlauf,
                                            schatten: starteLaufen,   // mit „Licht drehen lassen“ läuft dann die Bild-Kette
                                            lichtDreht: starteLaufen,
                                          } });

const shader = erstelleShader(canvas);
neuerVerlauf();

// Musik bewegt den Attraktor (siehe /lib/audioreaktiv.js): musik.wirkung.zoom usw. wird in zeichne()
// auf die eigenen Werte gerechnet, die Regler bleiben, wie sie sind
const musik = richteAudioreaktivEin({
  ziele: {
    zoom: "Zoom",
    helligkeit: "Helligkeit",
    punktgroesse: "Punktgröße",
    wand: "Abstand zur Wand",
    licht: "Licht wandert",
    farbe: "Farbe wandert",
  },
  start: { bass: "zoom", mitte: "helligkeit", schlag: "punktgroesse" },
  beiStart: () => starteLaufen(),
});
let lichtDazu = 0; // so weit hat die Musik das Licht schon herumgeführt (Grad)
let farbVersatz = 0; // so weit ist die Farbe im Verlauf gewandert (0 bis 2, siehe imVerlauf in shader.js)


// Zustände

let typ = TYPEN.clifford; // Starttyp, wird gleich vom ersten Preset gesetzt
let typName = "clifford"; // sein Name in TYPEN (braucht der Worker der Parameterkarte, er kennt nur Namen)
let werte = {};
let start = typ.start;

let mass = null; // Ergebnis von vermesseAttraktor
let ansicht = { x: 0, y: 0 }; // welcher Punkt des Attraktors in der Bildmitte liegt

let sichtbar = punkte; // wie viele Punkte gerade gezeichnet werden
let animationsId = null; // läuft gerade eine Animation? dann steht hier ihre Nummer

function neuerVerlauf() {
  const anker = einstellung.verlauf === "eigen"
    ? [hexZuRgb(einstellung.anfang), hexZuRgb(einstellung.ende)]
    : skalaAnker(einstellung.verlauf);
  // umgedreht: dieselben Anker rückwärts (Kopie mit [...], sonst würde die Skala in farben.js selbst umgedreht)
  shader.setzeVerlauf(farbtabelle(einstellung.umgedreht ? [...anker].reverse() : anker));
}

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
// ohneSchatten: einmal ohne Schatten (für den Ton der Ansicht, attraktor-ton.js)
function zeichne(ohneSchatten = false) {
  const w = musik.wirkung; // alles 0, solange keine Musik läuft
  shader.zeichne({
    mitteX: ansicht.x, mitteY: ansicht.y, sichtbar,
    ...einstellung, // einstellung.hintergrund, .faerbung, .punktfarbe, .verlauf, .anfang, .ende, .staerke
    // was die Musik verändert, kommt nach ...einstellung und ersetzt dort den Wert des Reglers
    zoom: zoom * (1 + 0.3 * w.zoom),
    staerke: einstellung.staerke * (1 + 2 * w.helligkeit),
    punktgroesse: einstellung.punktgroesse + 3 * w.punktgroesse,
    wandAbstand: einstellung.wandAbstand + 0.05 * w.wand,
    lichtRichtung: einstellung.lichtRichtung + lichtDazu,
    schatten: einstellung.schatten && !ohneSchatten,
    // Mitte und halbe Größe des Attraktors: um sie wächst der Schatten der Lampe, von dort formt das Spektrum
    zentrumX: mass?.mitteX ?? 0,
    zentrumY: mass?.mitteY ?? 0,
    ausdehnung: mass ? Math.max(mass.breite, mass.hoehe) / 2 : 1,
    spektrum: musik.spektrum,
    spektrumStaerke: musik.spektrumStaerke(),
    verlaufVersatz: farbVersatz,
  });
}

// um eine Zeitspanne weiterbewegen (live und beim Video-Rendern mit festen 1/30 s)
function bewege(sekunden) {
  lichtDazu = (lichtDazu + 180 * musik.wirkung.licht * sekunden) % 360; // volle Wirkung: halbe Runde pro Sekunde
  farbVersatz = (farbVersatz + 0.5 * musik.wirkung.farbe * sekunden) % 2; // volle Wirkung: in 2 s einmal durch den Verlauf
  if (einstellung.schatten && einstellung.lichtDreht) {
    setze("lichtRichtung", (einstellung.lichtRichtung + LICHT_PRO_SEKUNDE * sekunden) % 360);
  }
}

// gibt es etwas, das sich von selbst bewegt? Dann läuft die Bild-Kette
function bewegtSich() {
  return musik.laeuft() || (einstellung.schatten && einstellung.lichtDreht);
}

// Musik: eine Kette von Bildern, solange sie läuft (wie das Drehen im 3D-Attraktor)
let laufId = null;
let letzteZeit = null;

function laufe(zeit) {
  letzteZeit ??= zeit; // erstes Bild: noch keine Zeit vergangen
  const sekunden = Math.min((zeit - letzteZeit) / 1000, 0.1); // nach einer Pause im Hintergrund kein Sprung
  letzteZeit = zeit;
  musik.schritt(sekunden);
  bewege(sekunden);
  zeichne();
  if (bewegtSich()) {
    laufId = requestAnimationFrame(laufe);
  } else {
    laufId = null;
    letzteZeit = null;
  }
}

function starteLaufen() {
  if (laufId === null && bewegtSich()) laufId = requestAnimationFrame(laufe); // nie zwei Ketten gleichzeitig
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

// Schatten ziehen (Häkchen „Ziehen bewegt den Schatten“ oder mit Shift): der Schatten folgt dem Zeiger,
// daraus ergeben sich Lichtrichtung und Abstand zur Wand. Gemerkt wird der Schatten-Versatz beim Aufsetzen.
let schattenGriff = null; // { x, y, versatz: [x, y] } in CSS-Pixeln, y nach unten

// Versatz des Schattens in CSS-Pixeln (y nach unten), wie in shader.js:
// −(cos, sin) der Lichtrichtung mal wandAbstand mal der kürzeren Seite
function schattenVersatz() {
  const r = einstellung.lichtRichtung * Math.PI / 180;
  const laenge = einstellung.wandAbstand * Math.min(canvas.clientWidth, canvas.clientHeight);
  return [-Math.cos(r) * laenge, Math.sin(r) * laenge]; // y umgedreht: im Shader zeigt y nach oben
}

canvas.addEventListener("pointerdown", (event) => {
  if (finger.size === 0 && einstellung.schatten && (einstellung.ziehenLicht || event.shiftKey)) {
    canvas.setPointerCapture(event.pointerId);
    schattenGriff = { id: event.pointerId, x: event.clientX, y: event.clientY, versatz: schattenVersatz() };
    return;
  }
  finger.set(event.pointerId, mausAbstand(event));
  canvas.setPointerCapture(event.pointerId);
  greifeNeu();
});

canvas.addEventListener("pointermove", (event) => {
  if (schattenGriff?.id === event.pointerId) {
    // neuer Versatz = alter + Weg des Zeigers; zurück in Richtung und Abstand (Umkehrung von schattenVersatz)
    const vx = schattenGriff.versatz[0] + event.clientX - schattenGriff.x;
    const vy = schattenGriff.versatz[1] + event.clientY - schattenGriff.y;
    const kuerzere = Math.min(canvas.clientWidth, canvas.clientHeight);
    const wand = Math.min(Math.hypot(vx, vy) / kuerzere, Number(felder.wandAbstand.max));
    setze("wandAbstand", wand);
    // der Schatten liegt gegenüber dem Licht: Licht kommt aus −Versatz (y wieder nach oben gedreht)
    setze("lichtRichtung", ((Math.atan2(vy, -vx) * 180 / Math.PI) + 360) % 360);
    zeichne();
    return;
  }
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
  if (schattenGriff?.id === event.pointerId) schattenGriff = null;
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
      karte.zeichne(); // der Kreis auf der Karte wandert mit
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
  typName = preset.typ;
  werte = { ...preset.werte };
  start = preset.start || typ.start;
  baueWerteFelder();
  markiere(i);
  rechne();
  zeigeAlles();
  zeigeNeu();
  karte.neuerTyp(typName, typ.parameter);
}


// Parameterkarte (siehe /lib/parameterkarte.js): ein Klick setzt zwei Werte wie das Eintippen in die Felder

const karte = richteKarteEin({
  canvas: hole("karte"),
  xWahl: hole("karte-x"),
  yWahl: hole("karte-y"),
  bereichFeld: hole("karte-bereich"),
  knopf: hole("karte-rechnen"),
  anzeige: hole("karte-wert"),
  abschnitt: hole("parameterkarte"),
  // der Worker lädt diese attraktor.js selbst; new URL macht aus "./attraktor.js" die volle Adresse
  modul: new URL("./attraktor.js", import.meta.url).href,
  groesse: 160,
  kleinsteSkala: 0.1,
  aktuell: () => ({ typName, werte, start }),
  beiKlick: (neu) => {
    Object.assign(werte, neu); // nur die zwei Werte der Achsen ändern sich
    baueWerteFelder();
    markiere(-1);
    rechne();
    zeigeAlles();
    zeigeNeu();
  },
});


// Szenen (siehe /lib/szenen.js): alle Regler und dazu, was nur hier steht

function presetNummer() {
  // passen Typ und Zahlen genau zu einem Preset? Dann wird es markiert, sonst "eigene Werte"
  return PRESETS.findIndex((p) => p.typ === typName && JSON.stringify(p.werte) === JSON.stringify(werte));
}

const szenen = richteSzenenEin({
  ziel: hole("szenen"),
  seitenName: "2d-attraktor",
  einstellung,
  setzeAlle,
  sammle: () => ({
    typName,
    werte: { ...werte },
    start: [...start],
    punkte,
    ansicht: { ...ansicht },
    zoom,
    musik: musik.zuordnungLesen(),
  }),
  stelleHer: (seite) => {
    if (seite.typName && TYPEN[seite.typName]) {
      typ = TYPEN[seite.typName];
      typName = seite.typName;
      werte = { ...seite.werte };
      start = seite.start ?? typ.start;
      baueWerteFelder();
      markiere(presetNummer());
    }
    if (seite.punkte) {
      punkte = seite.punkte;
      punkteFeld.value = punkte;
    }
    rechne();
    karte.neuerTyp(typName, typ.parameter);
    if (seite.ansicht) ansicht = { ...seite.ansicht };
    if (seite.zoom) {
      zoom = seite.zoom;
      zoomFeld.value = Math.round(zoom);
    }
    if (seite.musik) musik.zuordnungSetzen(seite.musik);
    zeigeNeu();
  },
});


// Start

punkteFeld.value = punkte;

let ersteGroesse = true;

const beobachter = new ResizeObserver(() => {
  const alteBreite = canvas.width;
  passeGroesseAn();
  if (ersteGroesse) {
    ersteGroesse = false;
    waehlePreset(0); // passender Zoom braucht die echte Größe
    starteLaufen(); // falls der Browser „Licht drehen lassen“ beim Neuladen wiederhergestellt hat
    szenen.ladeAusLink(); // steckt eine Szene im Link (#szene=…), ersetzt sie das erste Preset
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
    musik.exportStart(n, FPS); // die Musik einmal für alle Bilder vorausrechnen
    if (animiert) {
      sichtbar = 0;
      renderProBild = Math.ceil(punkte / n);
    } else {
      sichtbar = punkte;
      renderProBild = 0;
    }
  },
  bild(i, dt) {
    sichtbar = Math.min(sichtbar + renderProBild, punkte);
    musik.exportBild(i); // was die Musik bei diesem Bild macht
    bewege(dt);
    zeichne();
  },
  ende() {
    musik.exportEnde();
    sichtbar = punkte; // Bild vollständig hinterlassen
    zeichne();
  },
  // Vorschau im Export-Fenster: nur das Licht merken, start() setzt alles andere neu
  merke() {
    const alt = { lichtDazu, farbVersatz, lichtRichtung: einstellung.lichtRichtung };
    return () => {
      lichtDazu = alt.lichtDazu;
      farbVersatz = alt.farbVersatz;
      setze("lichtRichtung", alt.lichtRichtung);
    };
  },
  // Bild i direkt: so viele Punkte, wie nach i + 1 Schritten von bild() da wären
  vorschau(i, n, dt) {
    sichtbar = Math.min(sichtbar + renderProBild * (i + 1), punkte);
    musik.exportBild(i);
    bewege((i + 1) * dt); // Licht und Farbe so weit wie nach i + 1 Bildern (die Musik-Wirkung von Bild i angenommen)
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
  ton: () => musik.tonFuerExport(), // mit geladener Musik: Video mit Ton
  liveTon: () => musik.liveTon(), // „Live aufnehmen“ nimmt mit, was gerade klingt
});


// Den Attraktor hören (siehe /lib/attraktor-ton.js): die Ansicht ohne Schatten als Spektrogramm

richteAttraktorTonEin({
  canvas,
  kopf: hole("ton-kopf"),
  ansichtOhneBoden: () => zeichne(true),
  zeichneNormal: () => zeichne(),
  hintergrund: () => einstellung.hintergrund,
  name: () => typ.name.toLowerCase().replace(/\s+/g, "-"),
  anzeige: sichtbaresBild, // mit VHS und CRT, wenn sie an sind
  zuschnitt: crtZuschnitt,
});
