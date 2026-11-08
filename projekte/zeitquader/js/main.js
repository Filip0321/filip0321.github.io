// Zeitquader: Slit-Scan, Zeitversatz und Video-Quader. Hier wird alles verbunden:
//   /lib/video-quelle.js  Videodatei Bild für Bild (Mediabunny)
//   /lib/ringpuffer.js    Ringpuffer als Textur-Array
//   gpu.js, shader.js     die drei Ansichten
//   kamera.js             Kamera, die um den Quader kreist oder frei durch ihn fliegt
//
// Quelle ist eine Videodatei oder die Kamera (live: Schlitz und Zeitversatz, wie eine Installation).

import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin, neueAufnahme, schneideTon, ladeHerunter, zeitstempel, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { oeffneVideo, ladeTon } from "/lib/video-quelle.js";
import { richteZeitEin } from "./gpu.js";
import { kamera, flug, kreisZuFlug, vorn } from "./kamera.js";

const bild = hole("bild");
const stapel = hole("stapel");
const meldung = hole("meldung");
const fortschritt = hole("fortschritt");

const VORSCHAU = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900 ? 480 : 720;
const MAX_SCHLITZE = 4096; // so breit darf ein Schlitzbild höchstens werden (Texturgrenze vieler Geräte)

const gpu = richteZeitEin(bild);
let quelle = null; // Videodatei
let quelleNr = 0; // zählt jede neue Datei: woran der Export erkennt, dass sein Quader veraltet ist
let ton = null;
let kameraVideo = null; // <video> mit der Kamera, wenn live
let lauf = null; // { stopp } solange etwas abspielt
const blickWinkel = { drehung: 0.6, neigung: 0.35, abstand: 3.2 }; // kreisen
let flugZustand = kreisZuFlug(blickWinkel); // fliegen: { pos, gier, nick }

const { einstellung, felder, setze } = richteReglerEin({
  beiAenderung: () => zeichneNeu(),
  extra: {
    ansicht: () => {
      halteAn();
      zeigeArt();
    },
    dehnung: () => schlitzGroesse && !lauf && zeigeSchlitzbild(),
    // zum Fliegen wechseln: dort anfangen, wo die Kreiskamera gerade steht
    steuerung: () => {
      if (einstellung.steuerung === "fliegen") flugZustand = kreisZuFlug(blickWinkel);
    },
  },
});

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}

function zeigeFortschritt(text) {
  fortschritt.textContent = text ?? "";
  fortschritt.hidden = !text;
}

function halteAn() {
  if (lauf) lauf.stopp = true;
  lauf = null;
}

const bereich = () => {
  const von = Math.min(einstellung.von, einstellung.bis);
  return { von, bis: Math.max(einstellung.bis, von + 0.1) };
};

// Feld im passenden Seitenverhältnis (Schlitzbild, Video oder Quader-Ansicht)
function feld(breite, hoehe) {
  stapel.style.setProperty("--verhaeltnis", `${breite} / ${hoehe}`);
}

function zeigeArt() {
  hole("kameraHinweis").hidden = !(kameraVideo && einstellung.ansicht === "quader");
}

// ---------- die drei Ansichten neu zeichnen (ohne neu zu lesen) ----------

let quaderBereit = false;
let schlitzGroesse = null; // { breite, hoehe } des Schlitzbildes, wenn eins da ist
let schlitzVerschiebung = 0;

// Schritte pro Strahl: mindestens so viele, wie Bilder im Block sind (sonst überspringt der Strahl Bilder),
// beim Ziehen und Fliegen nur halb so viele, damit es flüssig bleibt
function schritte(ziel, grob) {
  const s = Math.min(1024, Math.max(256, Math.round(ziel.gefuellt() * 1.5)));
  return grob ? Math.max(128, s >> 1) : s;
}

function quaderEinstellung(ziel = gpu, grob = false) {
  return { art: einstellung.art, deckkraft: einstellung.deckkraft, schwelle: einstellung.schwelle, laenge: einstellung.laenge, schnitt: einstellung.schnitt, schnittLage: einstellung.schnittLage, schritte: schritte(ziel, grob) };
}

// die Kamera, die gerade gilt: kreisen um die Mitte oder frei fliegen
const aktuelleKamera = (sv) => (einstellung.steuerung === "fliegen" ? flug(flugZustand, sv) : kamera(blickWinkel, sv));

let bewegt = false; // gerade ziehen oder fliegen: grober zeichnen
function zeichneQuader(ziel = gpu, breite = bild.clientWidth * (devicePixelRatio || 1), hoehe = bild.clientHeight * (devicePixelRatio || 1), macheKamera = aktuelleKamera, aenderung = {}) {
  const b = Math.round(Math.min(breite, 1600));
  const h = Math.round((b * hoehe) / breite);
  ziel.quader({ ...quaderEinstellung(ziel, bewegt && ziel === gpu), ...aenderung }, macheKamera(b / h), b, h);
}

// Schlitzbild in der Anzeige: jedes Bild „dehnung“ Pixel breit (sonst ist ein kurzes Video ein schmaler Streifen)
function schlitzGedehnt({ breite, hoehe }) {
  const senkrecht = einstellung.richtung === "senkrecht";
  return senkrecht ? { breite: breite * einstellung.dehnung, hoehe } : { breite, hoehe: hoehe * einstellung.dehnung };
}

function zeigeSchlitzbild() {
  const { breite, hoehe } = schlitzGedehnt(schlitzGroesse);
  if (!kameraVideo) feld(breite, hoehe);
  const faktor = Math.min(1, 1600 / Math.max(breite, hoehe));
  gpu.zeigeSchlitz(Math.round(breite * faktor), Math.round(hoehe * faktor), schlitzVerschiebung, einstellung.richtung === "senkrecht");
}

function zeichneNeu() {
  if (lauf) return; // während des Abspielens zeichnet die Schleife selbst
  if (einstellung.ansicht === "quader" && quaderBereit) zeichneQuader();
  else if (einstellung.ansicht === "schlitz" && schlitzGroesse) zeigeSchlitzbild();
  else if (einstellung.ansicht === "versatz" && gpu.gefuellt()) gpu.versatz(versatzEinstellung());
  else if (einstellung.ansicht === "stepp" && gpu.gefuellt()) gpu.zeigeStepp(1);
}

const versatzEinstellung = (zeit = performance.now() / 1000) => ({ muster: einstellung.muster, tiefe: einstellung.tiefe, zeit });

// Zeitversatz und Stepprinting laufen Bild für Bild mit: so viele Bilder muss der Ring halten
const tiefeFuer = () => (einstellung.ansicht === "stepp" ? einstellung.belichtung + 2 : einstellung.tiefe + 2);

// was nach dem Einlegen von Bild i passiert (i zählt ab dem Start, zeit in Sekunden)
//   Zeitversatz    jedes Pixel aus einer anderen Zeit
//   Stepprinting   nur jedes „schritt“-te Bild ist eine neue Aufnahme, gemittelt über die letzten
//                  „belichtung“ Bilder (langer Verschluss); dazwischen steht sie still, wahlweise mit
//                  Überblendung von der vorigen Aufnahme
function naechstesBild(ziel, i, zeit) {
  if (einstellung.ansicht !== "stepp") return ziel.versatz(versatzEinstellung(zeit));
  const schritt = einstellung.schritt;
  if (i % schritt === 0) ziel.belichte(einstellung.belichtung);
  const ueber = einstellung.ueberblenden;
  ziel.zeigeStepp(ueber > 0 ? Math.min(1, ((i % schritt) + 1) / (schritt * ueber)) : 1);
}

// ---------- Quelle ----------

hole("datei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  event.target.value = "";
  if (!datei) return;
  halteAn();
  stoppeKamera();
  zeige("");
  try {
    quelle = await oeffneVideo(datei);
    quelleNr++;
    for (const name of ["von", "bis"]) felder[name].max = quelle.dauer.toFixed(1);
    setze("von", 0);
    setze("bis", Number(Math.min(quelle.dauer, 10).toFixed(1)));
    hole("info").textContent = `${quelle.breite} × ${quelle.hoehe}, ${quelle.fps.toFixed(2).replace(".", ",")} Bilder/s, ${quelle.dauer.toFixed(1).replace(".", ",")} s.`;
    ton = await ladeTon(datei);
    zeigeArt();
    await rechne();
  } catch (fehler) {
    console.error(fehler);
    zeige(fehler.message);
  }
});

function stoppeKamera() {
  kameraVideo?.srcObject?.getTracks().forEach((s) => s.stop());
  kameraVideo = null;
}

hole("kamera").addEventListener("click", async () => {
  halteAn();
  try {
    const strom = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    stoppeKamera();
    kameraVideo = document.createElement("video");
    kameraVideo.muted = true;
    kameraVideo.playsInline = true;
    kameraVideo.srcObject = strom;
    await kameraVideo.play();
    quelle = null;
    zeigeArt();
    live();
  } catch (fehler) {
    zeige(fehler.name === "NotAllowedError" ? "Kamera nicht erlaubt." : `Kamera: ${fehler.message}`);
  }
});

// ---------- Rechnen (Datei) ----------

function arbeitsGroesse(maxBreite) {
  return quelle.groesse(maxBreite);
}

async function rechne() {
  if (kameraVideo) return live();
  if (!quelle) return;
  halteAn();
  const meins = { stopp: false };
  lauf = meins;
  const { von, bis } = bereich();
  try {
    if (einstellung.ansicht === "quader") {
      await baueQuader(gpu, arbeitsGroesse(Number(einstellung.quaderBreite)), von, bis, meins);
    } else if (einstellung.ansicht === "schlitz") {
      const g = arbeitsGroesse(VORSCHAU * 2);
      await baueSchlitz(gpu, g, von, bis, meins, (i) => i % 4 === 0 && zeigeSchlitzbild());
    } else {
      await spieleVersatz(meins);
    }
  } catch (fehler) {
    console.error(fehler);
    zeige(`Rechnen ging nicht: ${fehler.message}`);
  } finally {
    if (lauf === meins) lauf = null;
    zeigeFortschritt(null);
    zeichneNeu();
  }
}

// Quader: n Bilder gleichmäßig über den Bereich, Ebene 0 = ältestes
async function baueQuader(ziel, g, von, bis, meins) {
  // so viele, wie gewünscht, höchstens so viele, wie Grafikspeicher und Gerät erlauben (/lib/ringpuffer.js)
  const n = Math.max(2, Math.min(einstellung.quaderBilder, ziel.stelleGroesse(g.breite, g.hoehe, einstellung.quaderBilder)));
  if (ziel === gpu && n < einstellung.quaderBilder) {
    zeige(`In ${g.breite} × ${g.hoehe} passen auf diesem Gerät höchstens ${n} Bilder, darum ${n}.`);
  }
  ziel.stelleGroesse(g.breite, g.hoehe, n);
  const zeiten = Array.from({ length: n }, (_, i) => von + (i / (n - 1)) * (bis - von) * 0.999);
  let i = 0;
  for await (const b of quelle.bilderZu(g, zeiten)) {
    if (meins.stopp) return;
    if (b) ziel.lege(b.canvas);
    if (++i % 8 === 0) {
      zeigeFortschritt(`Quader füllen … ${Math.round((i / n) * 100)} %`);
      await warte();
    }
  }
  ziel.rechneReferenz();
  if (ziel === gpu) {
    quaderBereit = true;
    feld(16, 9);
  }
}

// Schlitz: jedes Bild des Bereichs gibt eine Spalte (oder Zeile); bei sehr vielen Bildern nur jedes k-te
async function baueSchlitz(ziel, g, von, bis, meins, beiBild) {
  const senkrecht = einstellung.richtung === "senkrecht";
  const gesamt = Math.round((bis - von) * quelle.fps);
  const jedes = Math.max(1, Math.ceil(gesamt / MAX_SCHLITZE));
  const anzahl = Math.ceil(gesamt / jedes);
  ziel.stelleGroesse(g.breite, g.hoehe, 2);
  const s = ziel.neuerSchlitz(anzahl, senkrecht);
  if (ziel === gpu) {
    schlitzGroesse = { breite: s.breite, hoehe: s.hoehe };
    schlitzVerschiebung = 0;
  }
  let n = 0;
  let i = 0;
  for await (const b of quelle.bilder(g, von, bis)) {
    if (meins.stopp || i >= anzahl) break;
    if (n++ % jedes) continue;
    ziel.lege(b.canvas);
    ziel.schreibeSchlitz(i, einstellung.lage, senkrecht);
    await beiBild?.(i, anzahl);
    if (++i % 16 === 0) {
      zeigeFortschritt(`Schlitz … ${Math.round((i / anzahl) * 100)} %`);
      await warte();
    }
  }
}

// Zeitversatz und Stepprinting: Bild für Bild in Echtzeit abspielen
async function spieleVersatz(meins) {
  const g = arbeitsGroesse(VORSCHAU);
  gpu.stelleGroesse(g.breite, g.hoehe, tiefeFuer());
  feld(g.breite, g.hoehe);
  const { von, bis } = bereich();
  const start = performance.now();
  let i = 0;
  for await (const b of quelle.bilder(g, von, bis)) {
    if (meins.stopp) return;
    gpu.lege(b.canvas);
    naechstesBild(gpu, i++, performance.now() / 1000);
    const t = b.timestamp - quelle.anfang - von;
    zeigeFortschritt(`${(t + von).toFixed(1).replace(".", ",")} s`);
    await new Promise((weiter) => setTimeout(weiter, Math.max(0, start + t * 1000 - performance.now())));
  }
}

// ---------- live mit der Kamera ----------

function live() {
  halteAn();
  const meins = { stopp: false };
  lauf = meins;
  const v = kameraVideo;
  const breite = Math.min(VORSCHAU, v.videoWidth);
  const hoehe = Math.round((v.videoHeight * breite) / v.videoWidth / 2) * 2;
  // Schlitz live: so viele Spalten wie die Breite, der neueste Schlitz rechts, alles wandert nach links
  const senkrecht = einstellung.richtung === "senkrecht";
  const spalten = senkrecht ? breite : hoehe;
  gpu.stelleGroesse(breite, hoehe, tiefeFuer());
  if (einstellung.ansicht === "schlitz") {
    const s = gpu.neuerSchlitz(spalten, senkrecht);
    schlitzGroesse = { breite: s.breite, hoehe: s.hoehe };
  }
  feld(breite, hoehe);
  let i = 0;
  const schritt = () => {
    if (meins.stopp || kameraVideo !== v) return;
    if (einstellung.ansicht === "versatz" || einstellung.ansicht === "stepp") {
      gpu.lege(v);
      naechstesBild(gpu, i++, performance.now() / 1000);
    } else if (einstellung.ansicht === "schlitz") {
      gpu.lege(v);
      gpu.schreibeSchlitz(i % spalten, einstellung.lage, senkrecht);
      schlitzVerschiebung = ((i % spalten) + 1) / spalten;
      zeigeSchlitzbild();
      i++;
    }
    requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
}

hole("rechnen").addEventListener("click", rechne);
hole("anhalten").addEventListener("click", () => {
  halteAn();
  zeichneNeu();
});

// ---------- Quader: kreisen (ziehen dreht, Rad zoomt) oder fliegen (ziehen schaut, WASD bewegt) ----------

let ziehen = null;
stapel.addEventListener("pointerdown", (event) => {
  if (einstellung.ansicht !== "quader") return;
  stapel.setPointerCapture(event.pointerId);
  ziehen = { x: event.clientX, y: event.clientY, ...blickWinkel, gier: flugZustand.gier, nick: flugZustand.nick };
  bewegt = true;
});
stapel.addEventListener("pointermove", (event) => {
  if (!ziehen || !stapel.hasPointerCapture(event.pointerId)) return;
  const dx = event.clientX - ziehen.x;
  const dy = event.clientY - ziehen.y;
  if (einstellung.steuerung === "fliegen") {
    // wie in einem Spiel: nach rechts ziehen schaut nach rechts, nach oben ziehen schaut nach oben
    flugZustand.gier = ziehen.gier - dx * 0.005;
    flugZustand.nick = Math.max(-1.5, Math.min(1.5, ziehen.nick - dy * 0.005));
  } else {
    blickWinkel.drehung = ziehen.drehung - dx * 0.01;
    blickWinkel.neigung = Math.max(-1.5, Math.min(1.5, ziehen.neigung + dy * 0.01));
  }
  zeichneNeu();
});
for (const ende of ["pointerup", "pointercancel"]) {
  stapel.addEventListener(ende, () => {
    ziehen = null;
    bewegt = false;
    zeichneNeu(); // einmal in voller Qualität
  });
}
stapel.addEventListener("wheel", (event) => {
  if (einstellung.ansicht !== "quader") return;
  event.preventDefault();
  if (einstellung.steuerung === "fliegen") fliege(-event.deltaY * 0.002, 0, 0);
  else blickWinkel.abstand = Math.max(0.3, Math.min(10, blickWinkel.abstand * Math.exp(event.deltaY * 0.001)));
  zeichneNeu();
}, { passive: false });

// ein Stück fliegen: vor (in Blickrichtung), seitwärts, hoch
function fliege(vor, seit, hoch) {
  const v = vorn(flugZustand.gier, flugZustand.nick);
  const r = [-Math.cos(flugZustand.gier), 0, Math.sin(flugZustand.gier)]; // rechts auf dem Bildschirm, waagerecht
  const p = flugZustand.pos;
  for (let k = 0; k < 3; k++) p[k] += v[k] * vor + r[k] * seit + (k === 1 ? hoch : 0);
}

// Tasten: solange eine gedrückt ist, läuft eine Schleife und bewegt die Kamera (Umschalt = schneller)
const TASTEN = { w: [1, 0, 0], arrowup: [1, 0, 0], s: [-1, 0, 0], arrowdown: [-1, 0, 0], a: [0, -1, 0], arrowleft: [0, -1, 0], d: [0, 1, 0], arrowright: [0, 1, 0], e: [0, 0, 1], q: [0, 0, -1] };
const gedrueckt = new Set();
let flugSchleife = null;
function flugTakt(zeit, vorher = zeit) {
  if (!gedrueckt.size) {
    flugSchleife = null;
    bewegt = false;
    zeichneNeu();
    return;
  }
  const dt = Math.min(0.05, (zeit - vorher) / 1000);
  const tempo = (gedrueckt.has("shift") ? 2.4 : 0.8) * dt; // Blockhöhen pro Sekunde
  const r = [0, 0, 0];
  for (const t of gedrueckt) TASTEN[t]?.forEach((x, k) => (r[k] += x));
  fliege(r[0] * tempo, r[1] * tempo, r[2] * tempo);
  bewegt = true;
  zeichneNeu();
  flugSchleife = requestAnimationFrame((jetzt) => flugTakt(jetzt, zeit));
}
function drueckeTaste(taste, an) {
  if (an) gedrueckt.add(taste);
  else gedrueckt.delete(taste);
  if (an && !flugSchleife) flugSchleife = requestAnimationFrame((zeit) => flugTakt(zeit));
}
document.addEventListener("keydown", (event) => {
  if (einstellung.ansicht !== "quader" || einstellung.steuerung !== "fliegen" || event.target.closest("input, select, textarea")) return;
  const taste = event.key.toLowerCase();
  if (!(taste in TASTEN) && taste !== "shift") return;
  event.preventDefault(); // Pfeiltasten sollen nicht die Seite scrollen
  drueckeTaste(taste, true);
});
document.addEventListener("keyup", (event) => drueckeTaste(event.key.toLowerCase(), false));
// am Handy: Knöpfe gedrückt halten
for (const [id, taste] of [["flugVor", "w"], ["flugZurueck", "s"]]) {
  const k = hole(id);
  k.addEventListener("pointerdown", () => drueckeTaste(taste, true));
  for (const ende of ["pointerup", "pointerleave", "pointercancel"]) k.addEventListener(ende, () => drueckeTaste(taste, false));
}

// ---------- Export ----------

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name: () => `zeitquader-${einstellung.ansicht}`,
  anzeige: () => bild, // preserveDrawingBuffer: das letzte Bild steht noch im Canvas
  // „Bild speichern“ → „aus der Zeit wählen“: so lang wie das Video, das „Video rendern“ machen würde
  bildLaenge: () => {
    if (kameraVideo) return null; // live gibt es kein gerendertes Video
    if (einstellung.ansicht === "quader") return quaderBereit ? einstellung.fahrt : null;
    if (!quelle) return null;
    const { von, bis } = bereich();
    return bis - von;
  },
  bildBei: (zeit) => bildAusDerZeit(zeit),
});

const dialog = erstelleExportDialog({ zeichneVorschau: (einst) => mitRahmen(bild, einst) });

// Rendern und „Bild aus der Zeit“ rechnen auf derselben Export-Fläche: ein Canvas mit eigener Grafikkarten-
// Instanz (gpu.js), einmal angelegt. Browser erlauben nur wenige WebGL-Kontexte gleichzeitig, darum nicht
// bei jedem Klick einen neuen. Wer die Fläche will, bricht die Rechnung ab, die gerade darauf läuft, und
// wartet, bis sie wirklich aufgehört hat; sonst würden zwei Rechnungen in denselben Ringpuffer schreiben.
let exportFlaeche = null; // { leinwand, ziel }
let exportLauf = null; // { stopp, fertig, gibFrei } der Rechnung, die die Fläche gerade hat
let quaderImExport = null; // mit welchen Einstellungen der Quader in der Export-Fläche gefüllt ist (oder null)

async function nimmExportFlaeche() {
  const vorher = exportLauf;
  let fertig;
  const meins = { stopp: false, fertig: new Promise((f) => (fertig = f)) };
  meins.gibFrei = () => {
    fertig();
    if (exportLauf === meins) exportLauf = null;
  };
  exportLauf = meins; // ab jetzt ist das hier die neueste Anfrage
  if (vorher) {
    vorher.stopp = true;
    await vorher.fertig;
  }
  if (!exportFlaeche) {
    const leinwand = document.createElement("canvas");
    exportFlaeche = { leinwand, ziel: richteZeitEin(leinwand) };
  }
  return meins;
}

// Bild i von n der Kamerafahrt (hängt nur von i ab, nicht von den Bildern davor)
function fahrtBild(ziel, breite, i, n) {
  const t = i / Math.max(1, n - 1);
  const h = Math.round((breite * 9) / 16 / 2) * 2;
  const L = einstellung.laenge;
  if (einstellung.fahrtArt === "schnitt") {
    // die Kamera steht, wie sie gerade steht; der Schnitt fährt einmal durch den Block
    zeichneQuader(ziel, breite, h, aktuelleKamera, { schnitt: einstellung.schnitt === "aus" ? "x" : einstellung.schnitt, schnittLage: t });
  } else if (einstellung.fahrtArt === "durchflug") {
    // vom ältesten Bild zum neuesten mitten durch den Block, den Blick nach vorn in die Zeit
    const pos = [0, 0, -L / 2 - 0.8 + t * (L + 1.6)];
    zeichneQuader(ziel, breite, h, (sv) => flug({ pos, gier: 0, nick: 0 }, sv));
  } else {
    // Kamerafahrt: einmal rundherum
    zeichneQuader(ziel, breite, h, (sv) => kamera({ ...blickWinkel, drehung: blickWinkel.drehung + (2 * Math.PI * i) / n }, sv));
  }
}

// Was ins Video kommt, Bild für Bild auf die Export-Fläche gezeichnet. nachBild(i, n) läuft nach jedem fertigen
// Bild (i zählt ab 0, n = wie viele es werden). ab: erstes Bild, das gebraucht wird. Überspringen kann nur der
// Quader, weil jedes Bild der Fahrt bloß von der Kamera abhängt; Schlitz und Zeitversatz bauen auf allen
// Bildern davor auf und fangen immer vorn an.
async function rechneExport(meins, nachBild, ab = 0) {
  const { ziel } = exportFlaeche;
  const { von, bis } = bereich();
  const breiteExport = Number(einstellung.exportBreite);

  if (einstellung.ansicht === "quader") {
    // den Quader nur neu füllen, wenn sich etwas geändert hat, was in ihm steckt
    const schluessel = JSON.stringify([quelleNr, von, bis, einstellung.quaderBreite, einstellung.quaderBilder]);
    if (quaderImExport !== schluessel) {
      quaderImExport = null;
      await baueQuader(ziel, arbeitsGroesse(Number(einstellung.quaderBreite)), von, bis, meins);
      if (meins.stopp) return;
      quaderImExport = schluessel;
    }
    const n = Math.round(einstellung.fahrt * 30);
    for (let i = ab; i < n && !meins.stopp; i++) {
      fahrtBild(ziel, breiteExport, i, n);
      await nachBild(i, n);
    }
    return;
  }

  quaderImExport = null; // Schlitz und Zeitversatz belegen den Ringpuffer neu, der Quader ist dann weg
  const g = arbeitsGroesse(breiteExport);
  if (einstellung.ansicht === "schlitz") {
    // das Schlitzbild wächst Bild für Bild
    await baueSchlitz(ziel, g, von, bis, meins, async (i, anzahl) => {
      ziel.zeigeSchlitz(...schlitzMasse());
      await nachBild(i, anzahl);
    });
  } else {
    const fps = Math.round(quelle.fps);
    const n = Math.round((bis - von) * quelle.fps);
    ziel.stelleGroesse(g.breite, g.hoehe, tiefeFuer());
    let i = 0;
    for await (const b of quelle.bilder(g, von, bis)) {
      if (meins.stopp) break;
      ziel.lege(b.canvas);
      naechstesBild(ziel, i, i / fps);
      await nachBild(i++, n);
    }
  }
}

hole("videoRendern").addEventListener("click", async () => {
  if (!quelle && einstellung.ansicht !== "quader") return zeige("Video rendern geht mit einer Videodatei. Mit der Kamera nimm „Live aufnehmen“.");
  if (einstellung.ansicht === "quader" && !quaderBereit) return zeige("Erst einen Quader rechnen.");
  halteAn();
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
  if (!einst) return;
  const meins = await nimmExportFlaeche();
  lauf = meins; // der Stopp-Weg der Seite (halteAn) hält auch das Rendern an
  let aufnahme = null;
  try {
    const rahmen = document.createElement("canvas");
    const mitR = () => mitRahmen(exportFlaeche.leinwand, einst, rahmen);
    const { von } = bereich();
    const fps = einstellung.ansicht === "quader" ? 30 : Math.round(quelle.fps);
    const mitTon = einstellung.ansicht !== "quader" && einstellung.mitTon && ton;
    await rechneExport(meins, async (i, n) => {
      aufnahme ??= await neueAufnahme(mitR(), fps, undefined, mitTon ? { kanaele: ton.numberOfChannels, rate: ton.sampleRate } : null, einst.videoTyp, einst.videoQualitaet);
      const t = i / fps;
      const stueck = mitTon && schneideTon(ton, Math.round((von + t) * ton.sampleRate), Math.round((von + t + 1 / fps) * ton.sampleRate));
      await Promise.all([aufnahme.bild(mitR(), t, 1 / fps), stueck && aufnahme.ton(stueck)]);
      if (i % 10 === 0) zeigeFortschritt(einstellung.ansicht === "quader" ? `Kamerafahrt … ${Math.round((i / n) * 100)} %` : `Video … ${t.toFixed(1)} s`);
    });
    zeigeFortschritt("Speichern …");
    if (aufnahme) ladeHerunter(await aufnahme.fertig(), `zeitquader-${einstellung.ansicht}-${zeitstempel()}.${aufnahme.endung}`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    meins.gibFrei();
    if (lauf === meins) lauf = null;
    zeigeFortschritt(null);
  }
});

// Bild aus der Zeit (zeit 0 bis 1): rechnet wie beim Rendern bis zu dem Bild, das dort im Video stünde, und
// gibt die Export-Fläche zurück (das Fenster kopiert sie gleich mit mitRahmen). Beim Schieben im Fenster
// kommen viele Anfragen schnell hintereinander; jede neue bricht die vorige ab, nur die letzte rechnet zu Ende.
async function bildAusDerZeit(zeit) {
  const meins = await nimmExportFlaeche();
  try {
    if (meins.stopp) return exportFlaeche.leinwand; // schon wieder überholt, das Fenster wirft es weg
    const wunsch = (n) => Math.max(0, Math.min(n - 1, Math.round(zeit * (n - 1))));
    const ab = einstellung.ansicht === "quader" ? wunsch(Math.round(einstellung.fahrt * 30)) : 0;
    // am Wunschbild angekommen: dieselbe Bremse wie beim Abbrechen, die Schleifen in rechneExport halten
    // vor dem nächsten Bild an, und auf der Fläche steht genau das gewünschte
    await rechneExport(
      meins,
      (i, n) => {
        if (i >= wunsch(n)) meins.stopp = true;
        else if (i % 15 === 0) zeigeFortschritt(`Bild suchen … ${Math.round((i / wunsch(n)) * 100)} %`);
      },
      ab,
    );
    return exportFlaeche.leinwand;
  } finally {
    zeigeFortschritt(null);
    meins.gibFrei();
  }
}

// Größe, in der das (wachsende) Schlitzbild ins Video kommt: das ganze Schlitzbild, höchstens 3840 breit
function schlitzMasse() {
  const senkrecht = einstellung.richtung === "senkrecht";
  const { von, bis } = bereich();
  const anzahl = Math.min(MAX_SCHLITZE, Math.round((bis - von) * quelle.fps));
  const g = arbeitsGroesse(Number(einstellung.exportBreite));
  const [b, h] = senkrecht ? [anzahl * einstellung.dehnung, g.hoehe] : [g.breite, anzahl * einstellung.dehnung];
  const f = Math.min(1, 3840 / Math.max(b, h));
  return [Math.round((b * f) / 2) * 2, Math.round((h * f) / 2) * 2];
}

zeigeArt();

