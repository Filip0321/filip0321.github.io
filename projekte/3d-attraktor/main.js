// Verbindet die Seite mit Rechnen (attraktor.js) und Zeichnen (shader.js).
// Dazu Presets, Export, Effekt-Schicht und automatisches Drehen.

import { TYPEN, PRESETS, berechnePunkte, vermesseAttraktor } from "./attraktor.js";
import { erstelleShader } from "./shader.js";
import { richteReglerEin } from "/lib/regler.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";
import { richteExportEin, FPS } from "/lib/export.js";
import { hexZuRgb, skalaAnker, farbtabelle } from "/lib/farben.js";
import { richteKarteEin } from "/lib/parameterkarte.js";
import { richteAttraktorTonEin } from "/lib/attraktor-ton.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { drehX, drehY, drehZ, mal, anwenden, drehVonNach, EINHEIT } from "./lage.js";
import { erstelleMobile } from "./mobile.js";
import { vermesseKoerper, erstelleKoerper } from "./koerper.js";
import { richteSzenenEin } from "/lib/szenen.js";
import { richteLampenEin, weitereLampen } from "./lampen.js";

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
const LICHT_PRO_SEKUNDE = 30; // „Licht drehen lassen“: Grad pro Sekunde
const SCHATTEN_NEIGUNG = -0.45; // mit Schatten von schräg oben schauen, sonst sieht man den Boden nicht

// Strick: der Attraktor hängt an einem Faden, der oben an einem Haken festgemacht ist
const SCHWERE = 3; // Fallbeschleunigung im Maßstab des Attraktors (er ist etwa 2 groß): Schwingen in ein paar Sekunden
const TORSION = 1.2; // wie stark der verdrillte Faden zurückdreht (größer = schneller hin und her)
const LAMPEN_DAEMPFUNG = 0.05; // eine Lampe am Kabel schwingt lange nach
const GREIF_RADIUS = 24; // so nah (CSS-Pixel) muss man an der Lampe aufsetzen, um sie zu greifen
const MOBILE_ABSTAND = 6; // so weit fährt die Kamera beim Mobile mindestens zurück

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
// einstellung.hintergrund, .faerbung, .punktfarbe, .verlauf, .anfang, .ende, .staerke,
// .travel, .laenge, .kopf, .tempo, .rest, .glanz, .endlos
const { einstellung, felder, setze, setzeAlle } = richteReglerEin({
  beiAenderung: zeichne,
  extra: { // was außer zeichne() noch passieren soll
    travel: schalteWandern,
    verlauf: neuerVerlauf,
    anfang: neuerVerlauf,
    ende: neuerVerlauf,
    umgedreht: neuerVerlauf,
    schatten: () => {
      schalteSchatten();
      starteLaufen(); // mit „Licht drehen lassen“ läuft dann die Bild-Kette
    },
    lichtDreht: starteLaufen,
    aufhaengPunkt: () => {
      koerperMerker.schluessel = ""; // neuer Aufhängepunkt: neu vermessen
      starteLaufen();
    },
    lampeHaengt: starteLaufen,
    aufhaengen: () => {
      // ein Mobile ist breiter als ein Attraktor: Kamera zurück, damit es ins Bild passt
      if (einstellung.aufhaengen === "mobile" && abstand < MOBILE_ABSTAND) {
        abstand = MOBILE_ABSTAND;
        abstandFeld.value = abstand;
      }
      neuesMobile();
      starteLaufen();
    },
    mobileAnzahl: neuesMobile,
  },
});

const shader = erstelleShader(canvas);
neuerVerlauf();

// Musik bewegt den Attraktor (siehe /lib/audioreaktiv.js): musik.wirkung.zoom usw. wird in zeichne()
// und bewege() auf die eigenen Werte gerechnet, die Regler bleiben, wie sie sind
const musik = richteAudioreaktivEin({
  ziele: {
    zoom: "Zoom",
    helligkeit: "Helligkeit",
    punktgroesse: "Punktgröße",
    drehen: "Drehen",
    kippen: "Attraktor kippen",
    nebel: "Nebel",
    komet: "Komet schneller",
    farbe: "Farbe wandert",
  },
  start: { bass: "zoom", mitte: "helligkeit", schlag: "punktgroesse" },
  beiStart: () => starteLaufen(),
});

// den Verlauf (Skala oder eigene Anfangs- und Endfarbe) als Textur zum Shader
function neuerVerlauf() {
  const anker = einstellung.verlauf === "eigen"
    ? [hexZuRgb(einstellung.anfang), hexZuRgb(einstellung.ende)]
    : skalaAnker(einstellung.verlauf);
  // umgedreht: dieselben Anker rückwärts (Kopie mit [...], sonst würde die Skala in farben.js selbst umgedreht)
  shader.setzeVerlauf(farbtabelle(einstellung.umgedreht ? [...anker].reverse() : anker));
}

// Zustände

let typ = TYPEN.lorenz; // wird gleich vom ersten Preset gesetzt
let typName = "lorenz"; // sein Name in TYPEN (braucht der Worker der Parameterkarte, er kennt nur Namen)
let werte = {};

let groesse = null; // Ergebnis von vermesseAttraktor
let farbVersatz = 0; // so weit ist die Farbe im Verlauf gewandert (0 bis 2, siehe imVerlauf in shader.js)
let punkteDaten = null; // die berechneten Punkte, für Boden und Aufhängung (hoehen)
let hoehenMerker = { schluessel: "", tiefster: -1, hoechster: 1 }; // hoehen() nur neu rechnen, wenn sich etwas geändert hat

// Pendel am Strick: x und z = wie weit der Faden um die waagerechten Achsen ausschlägt, mit Tempo
// (Winkel pro Sekunde). Das Verdrillen gehört jetzt zum Körper (koerper.js), nicht mehr zum Faden.
const pendel = { x: 0, xTempo: 0, z: 0, zTempo: 0 };
let pendelLaenge = 1; // Haken bis Schwerpunkt, aus dem letzten Bild (fürs Schwingen)
let fadenJetzt = 1; // Haken bis Aufhängepunkt, aus dem letzten Bild

// Strick: der Attraktor als starrer Körper (koerper.js), vermessen nur, wenn sich etwas geändert hat
const starrKoerper = erstelleKoerper();
let koerperMerker = { schluessel: "", daten: null };

// Lampe am Kabel: ein Fadenpendel wie oben, nur ohne Körper daran
const lampenPendel = { x: 0, xTempo: 0, z: 0, zTempo: 0 };
let lampeJetzt = null; // { pos, haken, laenge } aus dem letzten Bild (fürs Schwingen und Greifen)
let lampeGehalten = false; // während sie gezogen wird, rechnet das Pendel nicht

// Mobile (mobile.js): mehrere Attraktoren an Balken. Ihre Punktlisten sind im Shader die Nummern 1, 2, …
// (Nummer 0 bleibt der Attraktor oben: ohne Mobile ist er sofort wieder da)
let mobile = null;
let mobileTeile = {}; // Nummer → { mitte, mass, tiefster, hoechster, anzahl }

const amStrick = () => einstellung.aufhaengen === "strick";
const alsMobile = () => einstellung.aufhaengen === "mobile" && mobile !== null;
const haengt = () => amStrick() || alsMobile();
const lampeAn = () => einstellung.schatten && einstellung.licht !== "sonne";
const lampeHaengt = () => lampeAn() && einstellung.lampeHaengt;
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
  punkteDaten = daten;
  hoehenMerker.schluessel = ""; // neue Punkte: Boden und Aufhängung neu bestimmen
  koerperMerker.schluessel = "";
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
// ohneBoden: einmal ohne Boden und Schatten (für den Ton der Ansicht, attraktor-ton.js)
// teil: Zwischenschritt für die Bewegungsunschärfe beim Rendern ({ nummer, von }), sonst null
function zeichne(ohneBoden = false, teil = null) {
  // ohne Punkte gibt es keine Vermessung, der Shader leert dann nur das Bild
  const g = groesse ?? { mitteX: 0, mitteY: 0, mitteZ: 0, mass: 1 };
  const w = musik.wirkung; // alles 0, solange keine Musik läuft
  const kippung = einstellung.kippung + 30 * w.kippen; // bis 30° mehr

  // Lage in der Welt (lage.js): frei die eigene Drehung, am Strick die Ruhelage, in der er hängt
  // (darin bestimmt die Schwere die Neigung; um sie herum pendelt er dann)
  const strick = amStrick() ? amFaden() : null;
  const dreh = strick ? strick.ruhe : eigeneDrehung(kippung);
  const { tiefster } = hoehen(dreh);
  const boden = tiefster - einstellung.bodenAbstand; // unter dem tiefsten Punkt in Ruhe
  let lage = dreh;
  let lageVersatz = [0, 0, 0];
  let faden = null;
  let koerper = null; // nur beim Mobile: die Teile
  let striche = [];
  let bodenHier = boden;
  // Schwingen um den Haken (Strick und Mobile): welt = schwung · (p − haken) + haken
  const schwung = mal(drehZ(pendel.z), drehX(pendel.x));
  const umHaken = (haken) => (p) => anwenden(schwung, p.map((k, i) => k - haken[i])).map((k, i) => k + haken[i]);
  if (alsMobile()) {
    // erst in Ruhe mit dem Haken bei 0 aufbauen, um zu wissen, wie weit es nach unten reicht;
    // dann den Haken so hoch setzen, dass die Mitte des Mobiles etwa auf Höhe 0 liegt
    const ruhe = mobile.lagen([0, 0, 0], mobileTeile, drehY(einstellung.drehung * Math.PI / 180));
    const haken = [0, -ruhe.tiefster / 2, 0];
    pendelLaenge = -ruhe.tiefster / 2;
    const aufgebaut = mobile.lagen(haken, mobileTeile, drehY(einstellung.drehung * Math.PI / 180));
    bodenHier = aufgebaut.tiefster - einstellung.bodenAbstand;
    const verschiebe = umHaken(haken);
    const anteil = anzahl > 0 ? sichtbar / anzahl : 1; // Entstehen lassen: bei allen Teilen gleich weit
    koerper = aufgebaut.koerper.map((k) => ({
      ...k,
      mitte: mobileTeile[k.nummer].mitte,
      mass: mobileTeile[k.nummer].mass,
      lage: mal(schwung, k.lage),
      lageVersatz: verschiebe(k.lageVersatz),
      sichtbar: Math.round(anteil * mobileTeile[k.nummer].anzahl),
    }));
    striche = aufgebaut.striche.map((st) => ({ ...st, von: verschiebe(st.von), bis: verschiebe(st.bis) }));
    // im Raum mit Decke: ein Faden von der Decke zum Haken
    const deckeHoehe = bodenHier + 2 * einstellung.raumGroesse;
    if (einstellung.schatten && einstellung.umgebung === "raum" && einstellung.decke && deckeHoehe > haken[1]) {
      striche.push({ von: [0, deckeHoehe, 0], bis: haken, dicke: 1 });
    }
  } else if (strick) {
    // In Ruhe liegt der Attraktor wie immer um die Mitte (welt = ruhe · p), der Aufhängepunkt also
    // bei ruhe · A, und der Haken genau darüber. Im Raum mit Decke hängt er an der Decke.
    const { koerper: k, ruhe } = strick;
    const aRuhe = anwenden(ruhe, k.A);
    const laenge = imRaumMitDecke()
      ? Math.max(boden + 2 * einstellung.raumGroesse - aRuhe[1], 0.05)
      : einstellung.fadenLaenge;
    const haken = [aRuhe[0], aRuhe[1] + laenge, aRuhe[2]];
    fadenJetzt = laenge;
    pendelLaenge = laenge + k.hebel; // geschwungen wird bis zum Schwerpunkt
    // der Faden schwingt um den Haken und nimmt den Aufhängepunkt mit
    const aWelt = anwenden(schwung, [0, -laenge, 0]).map((x, i) => x + haken[i]);
    // der Körper dreht sich um den Aufhängepunkt: welt = R · (p − A) + aWelt = R · p + (aWelt − R · A)
    lage = starrKoerper.lage(ruhe);
    const gedrehtesA = anwenden(lage, k.A);
    lageVersatz = aWelt.map((x, i) => x - gedrehtesA[i]);
    faden = { haken, ende: aWelt };
  }

  // Lampe: am Kabel schwingt sie, sonst steht sie, wo die Regler sie hinstellen
  const lampe = lampeAn() ? lampenLage(bodenHier) : null;
  if (lampe?.haken && einstellung.lampeZeigen) striche.push({ von: lampe.haken, bis: lampe.pos, dicke: 1 });

  shader.zeichne({
    mitteX: g.mitteX,
    mitteY: g.mitteY,
    mitteZ: g.mitteZ,
    mass: g.mass,
    boden: bodenHier, lage, lageVersatz, faden, koerper, striche,
    winkel, neigung, versatz, brennweite, sichtbar,
    ...einstellung, // hintergrund, faerbung, punktfarbe, staerke, travel, laenge, kopf, rest, glanz … alle auf einmal
    // was die Musik verändert, kommt nach ...einstellung und ersetzt dort den Wert des Reglers
    abstand: abstand / (1 + 0.3 * w.zoom), // näher ran = größer
    staerke: einstellung.staerke * (1 + 2 * w.helligkeit),
    punktgroesse: einstellung.punktgroesse + 3 * w.punktgroesse,
    nebel: einstellung.nebel + 2 * w.nebel,
    schatten: einstellung.schatten && !ohneBoden,
    spektrum: musik.spektrum,
    spektrumStaerke: musik.spektrumStaerke(),
    verlaufVersatz: farbVersatz,
    lichtPos: lampe?.pos ?? null,
    kegelRichtung: lampe?.richtung ?? null,
    weitereLampen: weitereLampen(),
    teil,
  });
}

function imRaumMitDecke() {
  return einstellung.schatten && einstellung.umgebung === "raum" && einstellung.decke;
}

// Wo die Lampe in Ruhe steht: dieselben Kugelkoordinaten wie in shader.js (Licht von, Lichthöhe, Abstand)
function lampenRuhe() {
  const richtung = einstellung.lichtRichtung * Math.PI / 180;
  const hoehe = einstellung.lichtHoehe * Math.PI / 180;
  const a = einstellung.lampenAbstand;
  return [Math.cos(hoehe) * Math.cos(richtung) * a, Math.sin(hoehe) * a, Math.cos(hoehe) * Math.sin(richtung) * a];
}

// Lampe jetzt: { pos, haken (oder null), laenge, richtung des Scheinwerfers }.
// Am Kabel hängt sie an einem Haken genau über ihrer Ruhelage (im Raum mit Decke an der Decke)
// und schwingt wie der Strick: pos = haken + schwung · (0, −länge, 0)
function lampenLage(boden) {
  const ruhe = lampenRuhe();
  let pos = ruhe;
  let haken = null;
  let laenge = 0;
  let kabel = [0, -1, 0]; // Richtung Haken → Lampe
  if (lampeHaengt()) {
    laenge = imRaumMitDecke()
      ? Math.max(boden + 2 * einstellung.raumGroesse - ruhe[1], 0.05)
      : einstellung.lampenFaden;
    haken = [ruhe[0], ruhe[1] + laenge, ruhe[2]];
    kabel = anwenden(mal(drehZ(lampenPendel.z), drehX(lampenPendel.x)), [0, -1, 0]);
    pos = haken.map((k, i) => k + kabel[i] * laenge);
  }
  // Scheinwerfer: auf die Mitte des Attraktors oder in Richtung des Kabels (ohne Kabel: senkrecht nach unten)
  let richtung = kabel;
  if (einstellung.kegelZiel === "attraktor") {
    const l = Math.hypot(...pos) || 1;
    richtung = pos.map((k) => -k / l);
  }
  lampeJetzt = { pos, haken, laenge, richtung };
  return lampeJetzt;
}

// Die eigene Drehung des Attraktors als Matrix: erst um die Senkrechte (Regler „Attraktor drehen“,
// am Strick dazu die Verdrillung des Fadens), dann gekippt. Gleiche Reihenfolge wie früher im Shader.
function eigeneDrehung(kippung) {
  return mal(drehX(kippung * Math.PI / 180), drehY(einstellung.drehung * Math.PI / 180));
}

// Am Strick: der vermessene Körper (koerper.js) und die Ruhelage, in der er hängt.
// Ruhe heißt: der Schwerpunkt liegt genau unter dem Aufhängepunkt. Dafür wird der gekippte Attraktor
// mit der kleinsten Drehung so gedreht, dass der Weg A → S senkrecht nach unten zeigt.
// „Attraktor drehen“ kommt zuletzt, um die Senkrechte: wie den Haken drehen, die Schwere ändert sich nicht.
// Die Musik kippt ihn hier nicht über die Kippung (die Ruhelage würde springen), sondern stößt ihn an (schwinge).
function amFaden() {
  if (!punkteDaten || !groesse) return null;
  const art = einstellung.aufhaengPunkt;
  const kipp = drehX(einstellung.kippung * Math.PI / 180);
  // nur „oben“ hängt von der Kippung ab (was oben ist); die anderen nicht
  const schluessel = art === "oben" ? `${art} ${einstellung.kippung}` : art;
  if (koerperMerker.schluessel !== schluessel) {
    koerperMerker = { schluessel, daten: vermesseKoerper(punkteDaten, groesse, art, kipp) };
  }
  const k = koerperMerker.daten;
  let richten = EINHEIT;
  if (k.hebel > 1e-4) {
    // Schwerpunkt genau im Aufhängepunkt (art "schwerpunkt"): die Schwere kann ihn nicht drehen,
    // jede Lage ist Ruhe. Dann bleibt er so gekippt, wie er ist.
    const hebel = anwenden(kipp, k.S.map((x, i) => x - k.A[i]));
    richten = drehVonNach(hebel.map((x) => x / k.hebel), [0, -1, 0]);
  }
  return { koerper: k, ruhe: mal(drehY(einstellung.drehung * Math.PI / 180), mal(richten, kipp)) };
}

// Tiefster und höchster Punkt des Attraktors in dieser Drehung, im Raum des Shaders (−1 bis 1).
// Ohne Drehung wäre es einfach das kleinste und größte y; gedreht kann jeder andere Punkt unten liegen.
// Gebraucht wird nur y nach der Drehung: die zweite Zeile der Matrix mal dem Punkt.
// Für die Suche reicht jeder n-te Punkt (höchstens 200 000), das geht schnell genug für jedes Bild.
function hoehen(dreh) {
  if (!punkteDaten || !groesse) return { tiefster: -1, hoechster: 1 };
  const schluessel = dreh.map((k) => k.toFixed(5)).join(" ");
  if (hoehenMerker.schluessel === schluessel) return hoehenMerker;

  const { mitteX, mitteY, mitteZ, mass } = groesse;
  const n = punkteDaten.length / 3;
  const sprung = Math.max(1, Math.floor(n / 200000));
  let tiefster = Infinity;
  let hoechster = -Infinity;
  for (let i = 0; i < n; i += sprung) {
    const x = (punkteDaten[i * 3] - mitteX) / mass * 2;
    const y = (punkteDaten[i * 3 + 1] - mitteY) / mass * 2;
    const z = (punkteDaten[i * 3 + 2] - mitteZ) / mass * 2;
    const yGedreht = dreh[1] * x + dreh[4] * y + dreh[7] * z; // y nach der Drehung
    if (yGedreht < tiefster) tiefster = yGedreht;
    if (yGedreht > hoechster) hoechster = yGedreht;
  }
  hoehenMerker = { schluessel, tiefster, hoechster };
  return hoehenMerker;
}

// Pendel am Strick um eine Zeitspanne weiter. Zwei Bewegungen, beide gedämpft:
// - Verdrillen (Torsionspendel): der Faden dreht mit einer Kraft zurück, die mit der Verdrillung wächst,
//   schießt über die Ruhelage hinaus und dreht wieder zurück
// - Schwingen (Fadenpendel): die Schwere zieht zurück, Beschleunigung = −Schwere / Länge · sin(Ausschlag)
// Gerechnet in kleinen Schritten (höchstens 4 ms), erst das Tempo, dann mit dem neuen Tempo der Winkel
// (semi-implizites Euler-Verfahren: bleibt stabil, wo das einfache Euler-Verfahren immer mehr aufschaukelt)
// Ein Schritt Fadenpendel (x und z unabhängig, wie zwei Pendel übereinander). Gibt die Winkel-
// beschleunigungen zurück: aus ihnen folgt, wie stark das Ende des Fadens beschleunigt wird.
function pendelSchritt(p, schwere, daempfung, h) {
  const xBeschl = -schwere * Math.sin(p.x) - daempfung * p.xTempo;
  const zBeschl = -schwere * Math.sin(p.z) - daempfung * p.zTempo;
  p.xTempo += xBeschl * h;
  p.x += p.xTempo * h;
  p.zTempo += zBeschl * h;
  p.z += p.zTempo * h;
  return [xBeschl, zBeschl];
}

function schwinge(sekunden) {
  const haengtLampe = lampeHaengt() && !lampeGehalten && lampeJetzt?.haken;
  if (!haengt() && !haengtLampe) return;
  const daempfung = einstellung.daempfung;
  if (alsMobile()) mobile.schwinge(sekunden, daempfung); // die Fäden im Mobile, jeder für sich (mobile.js)
  const strick = amStrick() ? amFaden() : null;
  // Musik „Attraktor kippen“: am Strick ein Drehmoment um die Waagerechte quer zur Kamera
  const musikMoment = [Math.cos(winkel), 0, -Math.sin(winkel)].map((k) => k * 1.5 * musik.wirkung.kippen);
  const schritte = Math.max(1, Math.ceil(sekunden / 0.004));
  const h = sekunden / schritte;
  const schwere = SCHWERE / Math.max(pendelLaenge, 0.2);
  for (let i = 0; i < schritte; i++) {
    if (haengt()) {
      const [xBeschl, zBeschl] = pendelSchritt(pendel, schwere, daempfung, h);
      if (strick) {
        // Der Aufhängepunkt schwingt mit dem Faden. Von ihm aus gesehen fühlt sich das an wie eine
        // zusätzliche Schwere zur Gegenseite (wie im Bus, der bremst: man wird nach vorn gedrückt).
        // Für kleine Ausschläge: Beschleunigung des Fadenendes = Länge · Winkelbeschleunigung
        // (Kippen um z schiebt nach x, Kippen um x nach −z, siehe drehZ und drehX)
        const ende = [fadenJetzt * zBeschl, 0, -fadenJetzt * xBeschl];
        starrKoerper.schritt(h, {
          koerper: strick.koerper,
          ruhe: strick.ruhe,
          schwere: [-ende[0], -SCHWERE, -ende[2]],
          torsion: TORSION,
          daempfung,
          zusatz: musikMoment,
        });
      }
    }
    if (haengtLampe) pendelSchritt(lampenPendel, SCHWERE / Math.max(lampeJetzt.laenge, 0.2), LAMPEN_DAEMPFUNG, h);
  }
}

const schwingt = (p) => Object.values(p).some((wert) => Math.abs(wert) > 0.0005);

function pendeltNoch() {
  const lampe = lampeHaengt() && schwingt(lampenPendel);
  if (!haengt()) return lampe;
  return lampe || schwingt(pendel) || (amStrick() && starrKoerper.bewegtSich()) || (alsMobile() && mobile.bewegtSich());
}

function haltePendel() {
  for (const p of [pendel, lampenPendel]) for (const name of Object.keys(p)) p[name] = 0;
  starrKoerper.halte();
  mobile?.halte();
  zeichne();
}

// Anstoßen: dx von −1 (links im Bild) bis 1 (rechts). Seitlich angestoßen verdrillt er sich
// und schwingt zur Seite, dazu immer etwas von der Kamera weg (wie ein Finger von vorn)
function stupse(dx) {
  if (!haengt()) return;
  // Richtungen der Kamera in der Welt, nur waagerecht: rechts im Bild und von der Kamera weg
  const rechts = [Math.cos(winkel), -Math.sin(winkel)];
  const weg = [Math.sin(winkel), Math.cos(winkel)];
  const schubX = rechts[0] * dx * 0.6 + weg[0] * 0.3;
  const schubZ = rechts[1] * dx * 0.6 + weg[1] * 0.3;
  if (alsMobile()) {
    mobile.stupse(dx); // jeder Balken und jedes Teil bekommt seinen Ruck
  } else {
    const strick = amFaden();
    // Ein Stoß unterhalb des Aufhängepunkts in Richtung (schubX, 0, schubZ) dreht ihn um die Achse
    // nach unten × Schub = (−schubZ, 0, schubX): er kippt vom Finger weg. Dazu verdrillt er sich.
    if (strick) starrKoerper.stoss([-schubZ * 2, dx * 2, schubX * 2], strick.koerper, strick.ruhe);
  }
  // Kippen um z schiebt den Attraktor in x, Kippen um x schiebt ihn in −z (siehe drehZ und drehX)
  pendel.zTempo += schubX / pendelLaenge;
  pendel.xTempo -= schubZ / pendelLaenge;
  starteLaufen();
}

// Startneigung: normal leicht von unten, mit Schatten von schräg oben
function startNeigung() {
  return einstellung.schatten ? SCHATTEN_NEIGUNG : START_NEIGUNG;
}

function ansichtZurueck() {
  winkel = START_WINKEL;
  neigung = startNeigung();
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

  musik.schritt(sekunden); // Musik hören, bevor bewegt und gezeichnet wird
  bewege(sekunden);
  zeichne();

  if (bewegtSich()) {
    laufId = requestAnimationFrame(laufe); // immer verabreden, sonst stirbt die Kette
  } else {
    laufId = null; // nichts mehr zu bewegen: Kette endet
    letzteZeit = null; // beim nächsten Start wieder mit "keine Zeit vergangen" beginnen
  }
}

// um eine Zeitspanne weiterbewegen (auch beim Video-Rendern, dort mit festen 1/30 s)
function bewege(sekunden) {
  // „Drehen lassen“ und die Musik drehen den Attraktor selbst, nie die Kamera: Boden, Wände und Licht
  // bleiben stehen, und der Schatten wandert mit. Die Kamera bewegt nur die Maus.
  // Die Musik dreht dazu, auch wenn „Drehen lassen“ aus ist (bei voller Wirkung zehnmal so schnell)
  const drehTempo = (dreht ? 1 : 0) + 10 * musik.wirkung.drehen;
  if (drehTempo > 0) {
    setze("drehung", (einstellung.drehung + drehTempo * DREH_PRO_SEKUNDE * sekunden * 180 / Math.PI) % 360);
  }
  schwinge(sekunden);
  farbVersatz = (farbVersatz + 0.5 * musik.wirkung.farbe * sekunden) % 2; // volle Wirkung: in 2 s einmal durch den Verlauf
  // nur das Licht dreht sich um den Attraktor, er selbst und die Kamera bleiben stehen
  if (einstellung.schatten && einstellung.lichtDreht) {
    setze("lichtRichtung", (einstellung.lichtRichtung + LICHT_PRO_SEKUNDE * sekunden) % 360);
  }
  if (einstellung.travel) wandere(sekunden);
}

// gibt es etwas, das sich von selbst bewegt? Dann läuft die Bild-Kette
function bewegtSich() {
  return dreht || einstellung.travel || musik.laeuft() || (einstellung.schatten && einstellung.lichtDreht) || pendeltNoch();
}

function wandere(sekunden) {
  if (anzahl === 0) return;
  // tempo = Punkte pro Sekunde; die Musik macht den Kometen bis zu viermal so schnell
  let kopf = einstellung.kopf + einstellung.tempo * (1 + 3 * musik.wirkung.komet) * sekunden;

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
  if (laufId === null && bewegtSich()) {
    laufId = requestAnimationFrame(laufe);
  }
}

function stoppeLaufen() {
  if (laufId !== null) cancelAnimationFrame(laufId);
  laufId = null;
  letzteZeit = null;
}

// Häkchen Schatten: schaut die Kamera gerade von unten, kippt sie nach oben.
// Von unten wäre der Boden nicht zu sehen (shader.js zeichnet ihn dann absichtlich nicht),
// und ein Häkchen, nach dem sich nichts ändert, sieht kaputt aus.
function schalteSchatten() {
  if (einstellung.schatten && neigung > SCHATTEN_NEIGUNG / 2) neigung = SCHATTEN_NEIGUNG;
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
hole("stupsen").addEventListener("click", () => stupse(Math.random() * 2 - 1)); // ohne Maus (Handy, Tastatur)
hole("pendel-halt").addEventListener("click", haltePendel);

punkteFeld.addEventListener("change", () => {
  punkte = leseZahl(punkteFeld, 1000, MAX_PUNKTE, punkte);
  rechne();
  neuesMobile(); // die Teile teilen sich die Punkte
  zeigeNeu();
});


// Mobile: welche Attraktoren hängen (je eine Auswahl aus den Presets)

const mobileWahlBox = hole("mobile-teile");
const MOBILE_START = [1, 2, 5, 8]; // Aizawa, Thomas I, Halvorsen, Chen-Lee: verschiedene Formen

function baueMobileWahl(teile) {
  const bisher = [...mobileWahlBox.querySelectorAll("select")].map((wahl) => wahl.value);
  mobileWahlBox.replaceChildren();
  for (let i = 0; i < teile; i++) {
    const wahl = document.createElement("select");
    PRESETS.forEach((preset, nummer) => wahl.append(new Option(preset.name, nummer)));
    wahl.value = bisher[i] ?? MOBILE_START[i];
    wahl.addEventListener("change", neuesMobile);
    const label = document.createElement("label");
    label.append(`Teil ${i + 1} `, wahl);
    mobileWahlBox.append(label);
  }
}

// alle Teile neu rechnen und zur Grafikkarte; jedes bekommt seinen Anteil der Punkte
function neuesMobile() {
  if (einstellung.aufhaengen !== "mobile") {
    mobile = null;
    zeichne();
    return;
  }
  const teile = Number(einstellung.mobileAnzahl);
  if (mobileWahlBox.querySelectorAll("select").length !== teile) baueMobileWahl(teile);
  mobileTeile = {};
  [...mobileWahlBox.querySelectorAll("select")].forEach((wahl, i) => {
    const preset = PRESETS[Number(wahl.value)];
    const daten = berechnePunkte(TYPEN[preset.typ], preset.werte, Math.round(punkte / teile));
    const nummer = i + 1;
    shader.ladePunkte(daten, nummer);
    if (!daten) return;
    const g = vermesseAttraktor(daten);
    // höchster und tiefster Punkt ohne Drehung, im Raum −1 bis 1 (wie in hoehen())
    let tiefster = Infinity;
    let hoechster = -Infinity;
    for (let k = 1; k < daten.length; k += 3) {
      const y = (daten[k] - g.mitteY) / g.mass * 2;
      if (y < tiefster) tiefster = y;
      if (y > hoechster) hoechster = y;
    }
    mobileTeile[nummer] = { mitte: [g.mitteX, g.mitteY, g.mitteZ], mass: g.mass, tiefster, hoechster, anzahl: daten.length / 3 };
  });
  mobile = erstelleMobile(teile);
  zeichne();
}

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
  lampeGehalten = griff?.art === "lampe"; // ein zweiter Finger oder Loslassen beendet das Ziehen der Lampe
}

function mitteFinger(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function abstandZwischen(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// kurzer Klick ohne Ziehen: am Strick anstupsen (Ziehen dreht weiter die Kamera)
const tipps = new Map(); // pointerId → { x, y, zeit } beim Aufsetzen

canvas.addEventListener("pointerdown", (event) => {
  tipps.set(event.pointerId, { x: event.clientX, y: event.clientY, zeit: performance.now() });
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("zieht"); // Mauszeiger "greifen" (css/canvas.css)
  finger.set(event.pointerId, { x: event.clientX, y: event.clientY });

  // Tasten werden nur beim Aufsetzen gelesen: loslassen mitten im Ziehen ändert nichts
  let art = "drehen";
  if (event.shiftKey) art = "schieben";
  else if (event.altKey || event.ctrlKey) art = "zoomen";
  if (finger.size === 1 && lampeUnterZeiger(event)) art = "lampe"; // auf der Lampe aufgesetzt: sie wird gezogen

  greifeNeu(art);
  // erstellt griff Objekt
  if (art === "lampe") {
    lampeGehalten = true;
    griff.tiefe = inKamera(lampeJetzt.pos)[2]; // in dieser Tiefe bleibt sie beim Ziehen
    griff.zeit = event.timeStamp;
  }
});

// Lampe ziehen: dieselbe Rechnung wie in shader.js (insBild), hier in beide Richtungen.
// inKamera: Welt → Kamera (x, y im Bild, dritte Zahl = Tiefe), ausKamera: zurück
function inKamera([x, y, z]) {
  let c = Math.cos(winkel);
  let s = Math.sin(winkel);
  [x, z] = [x * c - z * s, x * s + z * c];
  c = Math.cos(neigung);
  s = Math.sin(neigung);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z + abstand];
}

function ausKamera([x, y, tiefe]) {
  let z = tiefe - abstand;
  // rückwärts: erst die Neigung, dann der Winkel, jeweils mit dem negativen Winkel
  let c = Math.cos(neigung);
  let s = Math.sin(neigung);
  [y, z] = [y * c + z * s, -y * s + z * c];
  c = Math.cos(winkel);
  s = Math.sin(winkel);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
}

// Zeiger → Stelle im Bild von −1 bis 1 (y nach oben, wie im Shader)
function imBild(event) {
  const rect = canvas.getBoundingClientRect();
  return [((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2];
}

// Liegt der Zeiger auf der sichtbaren Lampe? (nur, wenn „Lampe zeigen“ an ist: was man nicht sieht, greift man nicht)
function lampeUnterZeiger(event) {
  if (!lampeAn() || !einstellung.lampeZeigen || !lampeJetzt) return false;
  const lampe = shader.insBild(lampeJetzt.pos, { winkel, neigung, abstand, brennweite, versatz });
  if (!lampe) return false;
  const zeiger = imBild(event);
  const rect = canvas.getBoundingClientRect();
  // Unterschied in −1 bis 1 → CSS-Pixel: mal halbe Breite bzw. Höhe
  return Math.hypot((lampe[0] - zeiger[0]) * rect.width / 2, (lampe[1] - zeiger[1]) * rect.height / 2) < GREIF_RADIUS;
}

// Die Lampe unter den Zeiger setzen, in der Tiefe, in der sie gegriffen wurde (parallel zum Bildschirm).
// Lochkamera rückwärts: im Bild bei n liegt in der Tiefe t der Punkt x = (n − versatz) · t / brennweite
function zieheLampe(event) {
  const [nx, ny] = imBild(event);
  const t = griff.tiefe;
  const ziel = ausKamera([
    (nx - versatz.x) * t / (brennweite * (canvas.height / canvas.width)),
    (ny - versatz.y) * t / brennweite,
    t,
  ]);

  if (lampeHaengt() && lampeJetzt?.haken) {
    // am Kabel: das Kabel zeigt vom Haken zum Zeiger, die Länge bleibt. Aus der Richtung d die Winkel:
    // das Kabel ist schwung · (0, −1, 0) = (sin z · cos x, −cos z · cos x, −sin x)  (siehe lampenLage)
    const d = ziel.map((k, i) => k - lampeJetzt.haken[i]);
    const l = Math.hypot(...d) || 1;
    const x = Math.asin(Math.min(Math.max(-d[2] / l, -1), 1));
    const z = Math.atan2(d[0] / l, -d[1] / l);
    // Tempo aus der Bewegung seit dem letzten Mal, damit sie beim Loslassen weiterfliegt (Werfen)
    const dt = Math.max((event.timeStamp - griff.zeit) / 1000, 0.001);
    griff.zeit = event.timeStamp;
    lampenPendel.xTempo = Math.min(Math.max((x - lampenPendel.x) / dt, -8), 8);
    lampenPendel.zTempo = Math.min(Math.max((z - lampenPendel.z) / dt, -8), 8);
    lampenPendel.x = x;
    lampenPendel.z = z;
    return;
  }

  // frei: aus der Stelle wieder Kugelkoordinaten machen und in die Regler schreiben
  // (Umkehrung von lampenRuhe: Abstand = Länge, Höhe = asin(y / Länge), Richtung = atan2(z, x))
  const a = Math.hypot(...ziel) || 1;
  const grenzen = (name, wert) => Math.min(Math.max(wert, Number(felder[name].min)), Number(felder[name].max));
  setze("lampenAbstand", grenzen("lampenAbstand", a));
  setze("lichtHoehe", grenzen("lichtHoehe", Math.asin(ziel[1] / a) * 180 / Math.PI));
  setze("lichtRichtung", ((Math.atan2(ziel[2], ziel[0]) * 180 / Math.PI) + 360) % 360);
}

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

    if (griff.art === "lampe") {
      zieheLampe(event);
    } else if (griff.art === "schieben") {
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
  const tipp = tipps.get(event.pointerId);
  tipps.delete(event.pointerId);
  const warLampe = griff?.art === "lampe";
  if (warLampe) {
    lampeGehalten = false;
    // nicht mehr bewegt vor dem Loslassen: ohne Schwung loslassen
    if (event.timeStamp - griff.zeit > 80) lampenPendel.xTempo = lampenPendel.zTempo = 0;
    starteLaufen(); // am Kabel schwingt sie jetzt
  }
  // kaum bewegt (unter 6 Pixel) und kurz (unter 0,3 s): ein Tipp, kein Ziehen
  if (event.type === "pointerup" && tipp && finger.size === 1 && !warLampe &&
      Math.hypot(event.clientX - tipp.x, event.clientY - tipp.y) < 6 && performance.now() - tipp.zeit < 300) {
    const rect = canvas.getBoundingClientRect();
    stupse(((event.clientX - rect.left) / rect.width) * 2 - 1);
  }
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
      karte.zeichne(); // der Kreis auf der Karte wandert mit
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
  typName = preset.typ;
  werte = { ...preset.werte };
  baueWerteFelder();
  markiere(i);
  rechne();
  zeigeNeu();
  karte.neuerTyp(typName, typ.parameter.map(([schluessel]) => schluessel));
}


// Parameterkarte (siehe /lib/parameterkarte.js): ein Klick setzt zwei Werte wie das Eintippen in die Felder
// kleiner als im 2D (100 statt 160 Pixel): jeder Pixel ist ein ganzer Fluss mit Tausenden kleinen Schritten

const karte = richteKarteEin({
  canvas: hole("karte"),
  xWahl: hole("karte-x"),
  yWahl: hole("karte-y"),
  bereichFeld: hole("karte-bereich"),
  knopf: hole("karte-rechnen"),
  anzeige: hole("karte-wert"),
  abschnitt: hole("parameterkarte"),
  modul: new URL("./attraktor.js", import.meta.url).href,
  groesse: 100,
  kleinsteSkala: 0.05,
  aktuell: () => ({ typName, werte, start: typ.start }),
  beiKlick: (neu) => {
    Object.assign(werte, neu); // nur die zwei Werte der Achsen ändern sich
    baueWerteFelder();
    markiere(-1);
    rechne();
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
  seitenName: "3d-attraktor",
  einstellung,
  setzeAlle,
  sammle: () => ({
    typName,
    werte: { ...werte },
    punkte,
    kamera: { winkel, neigung, abstand, versatz: { ...versatz } },
    musik: musik.zuordnungLesen(),
    mobile: [...mobileWahlBox.querySelectorAll("select")].map((wahl) => wahl.value),
  }),
  stelleHer: (seite) => {
    if (seite.typName && TYPEN[seite.typName]) {
      typ = TYPEN[seite.typName];
      typName = seite.typName;
      werte = { ...seite.werte };
      baueWerteFelder();
      markiere(presetNummer());
    }
    if (seite.punkte) {
      punkte = seite.punkte;
      punkteFeld.value = punkte;
    }
    rechne();
    karte.neuerTyp(typName, typ.parameter.map(([schluessel]) => schluessel));
    if (seite.kamera) {
      ({ winkel, neigung, abstand } = seite.kamera);
      versatz = { ...seite.kamera.versatz };
      abstandFeld.value = abstand.toFixed(2);
    }
    if (seite.musik) musik.zuordnungSetzen(seite.musik);
    if (seite.mobile?.length) {
      // die Auswahl der Teile vorher setzen; setzeAlle (danach) rechnet das Mobile dann mit ihr
      baueMobileWahl(seite.mobile.length);
      mobileWahlBox.querySelectorAll("select").forEach((wahl, i) => (wahl.value = seite.mobile[i]));
    }
    zeigeNeu();
  },
});


// Start

punkteFeld.value = punkte;

let ersteGroesse = true;

const beobachter = new ResizeObserver(() => {
  passeGroesseAn();
  if (ersteGroesse) {
    ersteGroesse = false;
    ansichtZurueck();
    waehlePreset(0);
    neuesMobile(); // falls der Browser „als Mobile“ beim Neuladen wiederhergestellt hat
    szenen.ladeAusLink(); // steckt eine Szene im Link (#szene=…), ersetzt sie das erste Preset
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
    musik.exportStart(n, FPS); // die Musik einmal für alle Bilder vorausrechnen
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
    musik.exportBild(i); // was die Musik bei diesem Bild macht
    // Bewegungsunschärfe: die Zeit eines Bildes in k Zwischenschritte teilen und alle in dasselbe Bild zählen,
    // jeder mit 1 / k Gewicht (wie eine Kamera, deren Verschluss eine Weile offen ist)
    const k = Math.max(1, Math.round(einstellung.zwischenschritte));
    for (let t = 0; t < k; t++) {
      bewege(dt / k);
      zeichne(false, k > 1 ? { nummer: t, von: k } : null);
    }
  },
  ende() {
    musik.exportEnde();
    sichtbar = anzahl; // Bild vollständig hinterlassen
    zeichne();
    starteLaufen();
  },
  // Vorschau im Export-Fenster: Drehwinkel und Komet merken, die Vorschau springt hin und her
  merke() {
    const alt = { winkel, kopf: einstellung.kopf, travel: einstellung.travel, drehung: einstellung.drehung,
                  lichtRichtung: einstellung.lichtRichtung, farbVersatz, pendel: { ...pendel },
                  lampenPendel: { ...lampenPendel }, koerper: starrKoerper.merke(), mobile: mobile?.merke() };
    return () => {
      winkel = alt.winkel;
      farbVersatz = alt.farbVersatz;
      Object.assign(pendel, alt.pendel);
      Object.assign(lampenPendel, alt.lampenPendel);
      alt.koerper();
      alt.mobile?.();
      setze("drehung", alt.drehung);
      setze("lichtRichtung", alt.lichtRichtung);
      setze("kopf", alt.kopf);
      setze("travel", alt.travel);
    };
  },
  // Bild i direkt: Punkte wie nach i + 1 Schritten, Bewegung für (i + 1) · dt Sekunden auf einmal
  vorschau(i, n, dt) {
    sichtbar = Math.min(sichtbar + renderProBild * (i + 1), anzahl);
    musik.exportBild(i);
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
  ton: () => musik.tonFuerExport(), // mit geladener Musik: Video mit Ton
  liveTon: () => musik.liveTon(), // „Live aufnehmen“ nimmt mit, was gerade klingt
});


// Den Attraktor hören (siehe /lib/attraktor-ton.js): die Ansicht ohne Boden und Schatten als Spektrogramm

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

// weitere Lampen (lampen.js): jede Änderung zeichnet neu
// (ohne Boden gibt es nichts, worauf sie leuchten: dann „Boden und Schatten“ gleich mit an)
richteLampenEin(hole("lampenListe"), hole("lampeDazu"), () => {
  if (weitereLampen().length && !einstellung.schatten) setze("schatten", true);
  zeichne();
});
