// SSTV durch den Raum: ein Bild wird zu Tönen (wie bei der ISS und im Amateurfunk), geht durch einen Raum (echt,
// über Lautsprecher und Mikrofon, oder nachgerechnet) und wird wieder zu einem Bild. Was der Raum mit dem Ton
// macht, sieht man im Bild: Hall verschmiert, Echos geben Geister, Rauschen gibt Schnee, zwei Geräte, die nicht
// gleich schnell zählen, machen es schräg.
//
// Stufen (wie der Kreislauf in Bild zu Ton): Start ist das gesendete Bild, jede Runde durch den Raum gibt eine
// neue Stufe mit ihrem Ton und ihrem Bild. Ein Klick wählt eine Stufe: sie wird angezeigt, gespeichert, und die
// nächsten Runden gehen von ihr aus. Was über Mikrofon oder aus einer Datei ankommt, wird auch eine Stufe.
//
// Was gesendet wird (Auswahl „Was senden“):
//   sstv     ein Bild als SSTV
//   direkt   ein Klang selbst, ohne Verpackung (Lucier wörtlich); Stufen zeigen sein Spektrogramm
//   fm       ein Klang auf einem Träger (klang.js): der Raum trifft das Paket, nicht den Klang
//   hell     Text als Hellschreiber (hell.js): der Empfänger druckt, was ankommt, auf ein Papierband
//   versteckt  ein Bild unhörbar in den untersten Bits eines Klangs (versteckt.js): das Gegenstück zu SSTV
// Jede Stufe hat ihren Ton (was durch die Luft ging) und ihr Bild; dazu je nach Art den Modus (SSTV), den
// ausgepackten Klang (inhalt) oder das empfangene Band (Hellschreiber).
//
// Dateien: modi.js (die Zeiten der Modi), kodieren.js (Bild → Ton), empfang.js (Ton → Bild),
// raum.js (der nachgerechnete Raum), empfang-worklet.js (Mikrofon), klang.js (Klang direkt und FM),
// hell.js (Hellschreiber), versteckt.js (Bild in den untersten Bits)

import { MODI, freierModus, bildDauer, zeilenJeImpuls } from "./modi.js";
import { kodiere } from "./kodieren.js";
import { Empfaenger } from "./empfang.js";
import { durchDenRaum } from "./raum.js";
import { HellEmpfaenger, textZuBand, sendeBand, bandZuBild } from "./hell.js";
import { fmPacken, fmAuspacken, spektrogramm, ladeTon, testklang, normiere, filtere } from "./klang.js";
import { passendeGroesse, verstecke, finde, versteckteBits, gleicheBits } from "./versteckt.js";
import { zuWav, ladeHerunter, zeitstempel, speichereCanvas, neueAufnahme, warte } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";

const RATE = 48000;
const gesendet = hole("gesendet");
const empfangen = hole("empfangen");
const status = hole("status");
const meldung = hole("meldung");
const stufenFeld = hole("stufen");

let quelleBild = null; // Bitmap oder null (dann das Testbild)
let quelleTon = null; // Float32Array (RATE) oder null (dann der Testklang)
let name = "sstv";
let stufen = []; // { name, ton (Float32Array, RATE), bild (ImageData), modus (SSTV), inhalt (Klang), band (Hell) }
let gewaehlt = 0; // welche Stufe angezeigt wird und von wo die Runden weitergehen
let empfaenger = null; // während etwas live ankommt (Mikrofon, Datei, Anhören)
let ac = null;
let spieler = null;
let mikro = null; // { strom, knoten, stuecke, rate }
let klangAufnahme = null; // dasselbe fürs selbst Aufnehmen beim Senden
let worklet = null; // das Mikrofon-Worklet, einmal geladen
let lauf = 0; // Nummer des laufenden Vorgangs (ein neuer hält den alten an)
let geraeusch = null; // AudioBuffer fürs Geräusch im Raum
let beschaeftigt = false;

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}
const audio = async () => {
  ac ??= new AudioContext();
  await ac.resume();
  return ac;
};
const sendeArt = () => hole("sendeArt").value;
const istKlang = () => ["direkt", "fm"].includes(sendeArt());
// erst aufnehmen, dann auf einmal verstehen (nicht live wie SSTV und Hellschreiber)
const nichtLive = () => istKlang() || sendeArt() === "versteckt";
const versteckWerte = () => ({ bits: Number(hole("versteckBits").value), kanaele: hole("versteckFarbe").checked ? 3 : 1 });
const fmWerte = () => ({ traeger: Number(hole("traeger").value), hub: Number(hole("hub").value), band: Number(hole("band").value) });
const hellWerte = () => ({ traeger: Number(hole("hellTon").value), tempo: 245 });
// was Abspielen und WAV nehmen: bei FM wahlweise den ausgepackten Klang, sonst den Ton in der Luft
// versteckt: wahlweise nur die versteckten Bits, laut gemacht (so klingt das Bild)
const hoerTon = (stufe) => {
  if (sendeArt() === "versteckt" && hole("versteckHoeren").value === "bits") return versteckteBits(stufe.ton, stufe.versteck.bits);
  return sendeArt() === "fm" && hole("hoerArt").value === "inhalt" ? stufe.inhalt : stufe.ton;
};
const minuten = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")} min`;

// ---------- Modus ----------
// frei: Breite von Hand, Höhe aus dem Seitenverhältnis des Bildes (so passt jedes Bild ohne Rand)
function sendeModus() {
  const wahl = hole("modus").value;
  if (wahl !== "frei") return MODI[wahl];
  const breite = Math.max(64, Math.min(1920, Math.round(Number(hole("freiBreite").value) / 2) * 2));
  const verhaeltnis = quelleBild ? quelleBild.height / quelleBild.width : 3 / 4;
  const hoehe = Math.max(16, Math.round((breite * verhaeltnis) / 2) * 2);
  return freierModus(breite, hoehe, Number(hole("freiPixel").value) / 1000);
}

// ---------- Sendebild ----------
function testbild(ctx, w, h) {
  const farben = ["#fff", "#ff0", "#0ff", "#0f0", "#f0f", "#f00", "#00f", "#000"];
  farben.forEach((f, i) => {
    ctx.fillStyle = f;
    ctx.fillRect((i * w) / 8, 0, w / 8 + 1, h * 0.55);
  });
  const verlauf = ctx.createLinearGradient(0, 0, w, 0);
  verlauf.addColorStop(0, "#000");
  verlauf.addColorStop(1, "#fff");
  ctx.fillStyle = verlauf;
  ctx.fillRect(0, h * 0.55, w, h * 0.12);
  ctx.fillStyle = "#123";
  ctx.fillRect(0, h * 0.67, w, h * 0.33);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${h * 0.2}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("SSTV", w * 0.5, h * 0.92);
}

function setzeGroesse(canvas, m) {
  canvas.width = m.breite;
  canvas.height = m.hoehe;
  canvas.style.aspectRatio = `${m.breite} / ${m.hoehe}`;
}

function baueSendebild() {
  const m = sendeModus();
  setzeGroesse(gesendet, m);
  const ctx = gesendet.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, m.breite, m.hoehe);
  if (quelleBild) {
    // füllen: zuschneiden wie „Cover“; einpassen: ganz zeigen, Rand schwarz
    const fuellen = hole("einpassen").value === "fuellen";
    const f = (fuellen ? Math.max : Math.min)(m.breite / quelleBild.width, m.hoehe / quelleBild.height);
    const w = quelleBild.width * f;
    const h = quelleBild.height * f;
    ctx.drawImage(quelleBild, (m.breite - w) / 2, (m.hoehe - h) / 2, w, h);
  } else testbild(ctx, m.breite, m.hoehe);
  const bild = ctx.getImageData(0, 0, m.breite, m.hoehe);
  stufen = [{ name: "Start", ton: kodiere(bild, m, RATE), bild, modus: m }];
  waehle(0);
  const s = Math.round(bildDauer(m));
  hole("dauer").textContent = `${m.name}: ${m.breite} × ${m.hoehe} Pixel, ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min Ton`;
  hole("freiTeil").hidden = hole("modus").value !== "frei";
  hole("einpassenLabel").hidden = hole("modus").value === "frei";
}

hole("bild").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  name = datei.name.replace(/\.[^.]+$/, "");
  quelleBild = await createImageBitmap(datei);
  baueStart(); // SSTV oder versteckt
});
for (const id of ["modus", "einpassen", "freiBreite", "freiPixel"]) hole(id).addEventListener("change", baueSendebild);

// die Start-Stufe für Klang und Text; ein Bild baut baueSendebild
async function baueStart() {
  const art = sendeArt();
  zeigeTeile();
  if (art === "sstv") return baueSendebild();
  const meins = ++lauf;
  halteSpieler();
  let start;
  if (art === "hell") {
    const band = textZuBand(hole("hellText").value || " ");
    start = { name: "Start", ton: sendeBand(band, RATE, hellWerte()), band, bild: bandZuBild(band.werte, band.spalten) };
    hole("dauer").textContent = `Hellschreiber: ${band.spalten} Spalten, ${minuten(start.ton.length / RATE)} Ton`;
  } else if (art === "versteckt") {
    // so groß, wie in den Klang passt (versteckt.js, passendeGroesse), im Seitenverhältnis des Bildes
    const klang = quelleTon ?? testklang(RATE);
    const w = versteckWerte();
    const { breite, hoehe } = passendeGroesse(klang.length, w.bits, w.kanaele, quelleBild ? quelleBild.width / quelleBild.height : 4 / 3);
    const c = document.createElement("canvas");
    c.width = breite;
    c.height = hoehe;
    const cx = c.getContext("2d", { willReadFrequently: true });
    if (quelleBild) cx.drawImage(quelleBild, 0, 0, breite, hoehe);
    else testbild(cx, breite, hoehe);
    const ton = verstecke(klang, cx.getImageData(0, 0, breite, hoehe), w);
    const versteck = { breite, hoehe, ...w };
    start = { name: "Start", ton, inhalt: ton, bild: finde(ton, versteck).bild, versteck }; // so, wie es drinsteckt
    hole("dauer").textContent = `${quelleTon ? "Klang" : "Testklang"}: ${minuten(klang.length / RATE)}, darin ein Bild ${breite} × ${hoehe} (${w.kanaele === 3 ? "Farbe" : "grau"}, ${w.bits} Bit pro Sample)`;
  } else {
    const klang = quelleTon ?? testklang(RATE);
    const w = fmWerte();
    // vor dem Packen auf „Klang bis“ begrenzen, sonst wird das Paket breiter als gedacht
    const ton = art === "fm" ? fmPacken(await filtere(klang, RATE, { tief: w.band }), RATE, w) : klang;
    if (meins !== lauf) return;
    start = { name: "Start", ton, inhalt: klang, bild: spektrogramm(klang, RATE) };
    const paket = art === "fm" ? `, Paket etwa ${Math.max(0, w.traeger - w.hub - w.band)} bis ${w.traeger + w.hub + w.band} Hz` : "";
    hole("dauer").textContent = `${quelleTon ? "Klang" : "Testklang"}: ${minuten(klang.length / RATE)}${paket}`;
  }
  stufen = [start];
  setzeGroesse(gesendet, { breite: start.bild.width, hoehe: start.bild.height });
  gesendet.getContext("2d").putImageData(start.bild, 0, 0);
  waehle(0);
}

// welche Felder zur Art gehören
function zeigeTeile() {
  const art = sendeArt();
  hole("bildTeil").hidden = art !== "sstv" && art !== "versteckt";
  for (const id of ["modusLabel", "einpassenLabel"]) hole(id).hidden = art !== "sstv" || (id === "einpassenLabel" && hole("modus").value === "frei");
  hole("verstecktTeil").hidden = art !== "versteckt";
  hole("freiTeil").hidden = art !== "sstv" || hole("modus").value !== "frei";
  hole("tonTeil").hidden = !nichtLive();
  hole("fmTeil").hidden = art !== "fm";
  hole("hellTeil").hidden = art !== "hell";
  hole("hoerLabel").hidden = art !== "fm";
  hole("kreislaufLabel").hidden = art === "direkt"; // direkt ist der Klang der Inhalt: nur eine Art
  hole("kreislaufInhalt").textContent = { sstv: "das Bild (neu gesendet)", fm: "der Klang (neu verpackt)", hell: "das Band, wie es ankam (neu gesendet)", versteckt: "das Bild, wie es ankam (neu versteckt)", direkt: "" }[art];
  for (const id of ["erwarteLabel", "synchronLabel"]) hole(id).hidden = art !== "sstv";
  hole("bereichTeil").hidden = art !== "sstv" || hole("synchron").value !== "frei";
  hole("sendeHinweis").textContent = {
    sstv: "Abspielen spielt die gewählte Stufe. Zwei Geräte: hier abspielen, dort „Mikrofon an“ (oder Robot36, SSTV-Apps).",
    direkt: "Der Klang selbst geht durch den Raum, Runde für Runde bleibt, was der Raum mag (Lucier). Die Bilder sind Spektrogramme.",
    fm: "Der Klang reitet auf einem Träger (wie UKW). Der Raum stört das Paket: Hall verzerrt, Rauschen knackt.",
    hell: "Text als Bild aus Tönen (Feld-Hell, 2,5 Zeichen pro Sekunde). Jede Spalte steht doppelt: schräg bleibt lesbar. Auch fldigi liest Hell.",
    versteckt: "Das Bild steckt unhörbar in den untersten Bits des Klangs. Als WAV gespeichert und wieder geladen bleibt es; jeder Raum, jedes Lauter oder Leiser zerstört es.",
  }[art];
  hole("empfangHinweis").textContent = {
    sstv: "Frei laufen: jeder Ton wird ein Bild, Tonhöhe ist Helligkeit (gemessen zwischen etwa 400 und 3400 Hz).",
    direkt: "Was ankommt, wird eine Stufe, so wie es ist.",
    fm: "Was ankommt, wird ausgepackt, mit Träger, Hub und „Klang bis“ vom Senden.",
    hell: "Der Schreiber druckt mit seiner eigenen Uhr: läuft der Sender anders schnell, wird die Schrift schräg.",
    versteckt: "Gelesen werden die untersten Bits. Fehlt die Kennung, wird mit den Maßen vom Start gelesen; 50 % gleiche Bits ist reiner Zufall.",
  }[art];
}
for (const id of ["sendeArt", "traeger", "hub", "band", "hellText", "hellTon", "versteckBits", "versteckFarbe"]) hole(id).addEventListener("change", baueStart);

hole("klangDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  try {
    name = datei.name.replace(/\.[^.]+$/, "");
    quelleTon = normiere(await ladeTon(datei, RATE));
    baueStart();
  } catch {
    zeige("Diese Datei kann der Browser nicht lesen.");
  }
});
// selbst aufnehmen: an, sprechen oder spielen, aus; das wird der Klang
hole("klangAufnehmen").addEventListener("click", async () => {
  if (klangAufnahme) {
    const ton = await beendeAufnahme(klangAufnahme);
    klangAufnahme = null;
    hole("klangAufnehmen").textContent = "selbst aufnehmen";
    if (ton.length > RATE * 0.2) {
      quelleTon = normiere(ton);
      name = "aufnahme";
      baueStart();
    }
    return;
  }
  try {
    klangAufnahme = await starteAufnahme();
    hole("klangAufnehmen").textContent = "Aufnahme beenden";
  } catch (fehler) {
    zeige(`Mikrofon ging nicht: ${fehler.message}`);
  }
});

// ---------- Stufen ----------
function zeigeStufen() {
  stufenFeld.replaceChildren();
  stufen.forEach((stufe, i) => {
    const figur = document.createElement("figure");
    figur.classList.toggle("gewaehlt", i === gewaehlt);
    const leinwand = document.createElement("canvas");
    leinwand.width = stufe.bild.width;
    leinwand.height = stufe.bild.height;
    leinwand.getContext("2d").putImageData(stufe.bild, 0, 0);
    const text = document.createElement("figcaption");
    text.textContent = stufe.name;
    figur.append(leinwand, text);
    figur.title = "Diese Stufe zeigen, speichern und von hier aus weitermachen";
    figur.addEventListener("click", () => waehle(i));
    stufenFeld.append(figur);
  });
  hole("stufenLoeschen").hidden = stufen.length < 2;
}

function waehle(i) {
  gewaehlt = i;
  empfaenger = null;
  const stufe = stufen[i];
  setzeGroesse(empfangen, { breite: stufe.bild.width, hoehe: stufe.bild.height });
  empfangen.getContext("2d").putImageData(stufe.bild, 0, 0);
  status.textContent = `${stufe.name} gewählt: Speichern und die nächsten Runden gehen von hier aus${stufe.info ? ` · ${stufe.info}` : ""}`;
  zeigeStufen();
}

// neu: was der Empfang dazu weiß ({ bild, modus } oder { bild, inhalt } oder { bild, band })
function neueStufe(name, ton, neu) {
  const { bild } = neu;
  stufen.push({ ...neu, name, ton, bild: new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height) });
  waehle(stufen.length - 1);
}

hole("stufenLoeschen").addEventListener("click", () => {
  stufen = stufen.slice(0, 1);
  waehle(0);
});

// ---------- Abspielen ----------
function halteSpieler() {
  if (!spieler) return;
  spieler.onended = null;
  spieler.stop();
  spieler = null;
  hole("senden").textContent = "Abspielen";
}
async function spiele(ton) {
  halteSpieler();
  const a = await audio();
  const puffer = new AudioBuffer({ length: ton.length, numberOfChannels: 1, sampleRate: RATE });
  puffer.copyToChannel(ton, 0);
  spieler = new AudioBufferSourceNode(a, { buffer: puffer });
  spieler.connect(a.destination);
  spieler.onended = halteSpieler;
  spieler.start();
  return a.currentTime;
}
// spielt den Ton der gewählten Stufe (am Anfang: das gesendete Bild)
hole("senden").addEventListener("click", async () => {
  if (spieler) return halteSpieler();
  await spiele(hoerTon(stufen[gewaehlt]));
  hole("senden").textContent = "Anhalten";
});

// ---------- Empfangen ----------
const SYNC_ARTEN = { einrasten: { einrasten: true }, schraeg: { einrasten: false }, frei: { frei: true } };
function neuerEmpfaenger(rate) {
  if (sendeArt() === "hell") return (empfaenger = new HellEmpfaenger(rate, hellWerte()));
  const erwarte = hole("erwarte").value;
  const sync = SYNC_ARTEN[hole("synchron").value];
  // frei laufen braucht einen festen Modus: den erwarteten, sonst den zum Senden eingestellten
  const modus = erwarte === "auto" ? sendeModus() : MODI[erwarte];
  empfaenger = new Empfaenger(rate, { modus, automatisch: erwarte === "auto", ...sync, ...farbBereich() });
  return empfaenger;
}
// welche Tonhöhen Schwarz und Weiß sind: bei SSTV fest, beim frei Laufen einstellbar (Musik liegt oft tiefer)
function farbBereich() {
  if (hole("synchron").value !== "frei") return {};
  return { schwarz: Number(hole("schwarzHz").value), weiss: Number(hole("weissHz").value) };
}
hole("synchron").addEventListener("change", () => (hole("bereichTeil").hidden = hole("synchron").value !== "frei"));

function zeigeEmpfang() {
  const e = empfaenger;
  if (!e) return;
  if (empfangen.width !== e.m.breite || empfangen.height !== e.m.hoehe) setzeGroesse(empfangen, e.m);
  const ctx = empfangen.getContext("2d");
  ctx.putImageData(e.bild, 0, 0);
  if (e.statusText) return (status.textContent = e.statusText()); // Hellschreiber
  if (e.zustand === "bild") {
    ctx.fillStyle = "rgba(255, 60, 60, 0.8)";
    ctx.fillRect(0, e.fertigeZeilen, e.m.breite, zeilenJeImpuls(e.m));
  }
  const was = { warten: "wartet auf ein Bild", bild: `Zeile ${e.fertigeZeilen} von ${e.m.hoehe}`, fertig: "fertig" }[e.zustand];
  const vis = e.visKode !== undefined ? ` (VIS ${e.visKode})` : "";
  status.textContent = `${was} · ${e.m.name}${vis} · gerade ${Math.round(e.jetzt())} Hz`;
}

// einen Ton lesen: schnell (ein Stück pro Bild des Bildschirms) oder mit Anhören (so schnell, wie er spielt)
async function lies(ton, meins) {
  const e = neuerEmpfaenger(RATE);
  const mitHoeren = hole("ablauf").value === "hoeren";
  let pos = 0;
  const start = mitHoeren ? await spiele(ton) : 0;
  while (pos < ton.length && meins === lauf) {
    const bis = mitHoeren ? Math.min(ton.length, Math.round((ac.currentTime - start) * RATE)) : Math.min(ton.length, pos + RATE);
    if (bis > pos) e.fuettere(ton.subarray(pos, bis));
    pos = bis;
    zeigeEmpfang();
    await new Promise((r) => requestAnimationFrame(r));
  }
  return e;
}

// einen angekommenen Ton verstehen, je nach Art: was zur neuen Stufe gehört
async function empfange(ton, meins) {
  const art = sendeArt();
  if (art === "sstv") {
    const e = await lies(ton, meins);
    return { bild: e.bild, modus: e.m };
  }
  if (art === "hell") {
    const e = await lies(ton, meins);
    return { bild: e.bild, band: e.band };
  }
  if (art === "versteckt") {
    const versteck = stufen[0].versteck;
    const g = finde(ton, versteck);
    const anteil = gleicheBits(g.bild, stufen[0].bild, versteck.kanaele);
    const info = `Kennung ${g.kennung ? "gefunden" : "kaputt"}${anteil === null ? "" : `, ${(anteil * 100).toFixed(1)} % der Bits wie beim Start`}`;
    if (hole("ablauf").value === "hoeren" && meins === lauf) await hoereMit(hoerTon({ ton, versteck }), spektrogramm(ton, RATE), meins);
    return { bild: g.bild, inhalt: ton, versteck, info };
  }
  const inhalt = art === "fm" ? await fmAuspacken(ton, RATE, fmWerte()) : ton;
  const bild = spektrogramm(inhalt, RATE);
  if (hole("ablauf").value === "hoeren" && meins === lauf) await hoereMit(inhalt, bild, meins);
  return { bild, inhalt };
}

// einen Klang abspielen, im Spektrogramm läuft ein Strich mit
async function hoereMit(ton, bild, meins) {
  const start = await spiele(ton);
  setzeGroesse(empfangen, { breite: bild.width, hoehe: bild.height });
  const ctx = empfangen.getContext("2d");
  while (meins === lauf && spieler) {
    const anteil = (ac.currentTime - start) / (ton.length / RATE);
    if (anteil >= 1) break;
    ctx.putImageData(bild, 0, 0);
    ctx.fillStyle = "rgba(255, 60, 60, 0.9)";
    ctx.fillRect(Math.round(anteil * (bild.width - 1)), 0, 1, bild.height);
    status.textContent = `hören: ${minuten(anteil * (ton.length / RATE))}`;
    await new Promise((r) => requestAnimationFrame(r));
  }
  ctx.putImageData(bild, 0, 0);
}

// ---------- Runden durch den Raum ----------
const raumWerte = () => ({
  ...Object.fromEntries(["hall", "nachhall", "echo", "echoZeit", "rauschen", "unten", "oben", "ppm", "leiern", "geraeuschLaut"].map((id) => [id, Number(hole(id).value)])),
  geraeusch,
  impuls: null, // dieselbe Impulsantwort für alle Runden: es bleibt derselbe Raum (raum.js füllt sie)
});

// Kreislauf, zwei Arten:
//   Ton   der empfangene Ton geht wieder durch den Raum (Alvin Lucier, „I Am Sitting in a Room“, 1969): wieder
//         auf dieselbe Lautstärke gebracht, Runde für Runde, bis nur noch der Raum übrig ist
//   Bild  das empfangene Bild wird neu gesendet: jede Runde ist wieder sauberes SSTV, nur der Inhalt zerfällt
//         (wie eine Kopie der Kopie, die jedes Mal neu abgetippt wird). Bei FM wird der ausgepackte Klang neu
//         verpackt, beim Hellschreiber das empfangene Band neu gesendet, mit allem Grau und Dreck darin
function rundenEingang(von, kreis) {
  const art = sendeArt();
  if (kreis === "ton" || von === stufen[0] || art === "direkt") return von.ton;
  if (art === "sstv") return kodiere(von.bild, von.modus, RATE);
  if (art === "hell") return sendeBand(von.band, RATE, hellWerte());
  if (art === "versteckt") return verstecke(von.ton, von.bild, von.versteck); // in den Klang, wie er ankam
  return fmPacken(von.inhalt, RATE, fmWerte());
}
hole("runden").addEventListener("click", async () => {
  if (beschaeftigt) return;
  beschaeftigt = true;
  const meins = ++lauf;
  const w = raumWerte();
  const anzahl = Math.max(1, Math.round(Number(hole("rundenZahl").value)));
  const art = hole("kreislauf").value;
  try {
    let von = stufen[gewaehlt];
    const ab = von.name;
    const vonDerLetzten = gewaehlt === stufen.length - 1; // sonst steht dran, wovon die Runde ausging
    for (let runde = 1; runde <= anzahl && meins === lauf; runde++) {
      zeige(`Runde ${runde} von ${anzahl}: der Raum rechnet …`);
      // wieder auf die alte Lautstärke (Spitze 0,5 wie beim Senden)
      const ton = normiere(await durchDenRaum(rundenEingang(von, art), RATE, w));
      zeige(`Runde ${runde} von ${anzahl}: lesen …`);
      const neu = await empfange(ton, meins);
      if (meins !== lauf) break;
      const nummer = stufen.filter((s) => s.name.startsWith("Runde")).length + 1;
      neueStufe(`Runde ${nummer}${runde === 1 && !vonDerLetzten ? ` (ab ${ab})` : ""}`, ton, neu);
      von = stufen.at(-1);
    }
    zeige("");
  } catch (fehler) {
    console.error(fehler);
    zeige(`Ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
  }
});

hole("geraeuschDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  try {
    geraeusch = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await datei.arrayBuffer());
    hole("geraeuschName").textContent = datei.name;
  } catch {
    zeige("Diese Datei kann der Browser nicht lesen.");
  }
});

for (const out of document.querySelectorAll("output[data-fuer]")) {
  const feld = hole(out.dataset.fuer);
  const zeigeWert = () => (out.textContent = feld.value);
  feld.addEventListener("input", zeigeWert);
  zeigeWert();
}

// ---------- Ton hineinspielen ----------
// eine Tondatei lesen: SSTV-Aufnahmen (z. B. von der ISS) oder jeder andere Ton; mit „frei laufen“ wird auch
// Musik ein Bild
hole("tondatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei || beschaeftigt) return;
  beschaeftigt = true;
  const meins = ++lauf;
  try {
    const ton = await ladeTon(datei, RATE); // bei Stereo: beide Seiten gemischt
    const neu = await empfange(ton, meins);
    if (meins === lauf) neueStufe(datei.name.replace(/\.[^.]+$/, ""), ton, neu);
  } catch {
    zeige("Diese Datei kann der Browser nicht lesen.");
  } finally {
    beschaeftigt = false;
  }
});

// Mikrofon: live, Stück für Stück aus dem Worklet. Ohne Echo-Unterdrückung und automatische Lautstärke: die
// würden das Signal verbiegen (und Töne, die aus dem eigenen Lautsprecher kommen, absichtlich löschen).
async function starteAufnahme(beiStueck) {
  const a = await audio();
  const strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  worklet ??= a.audioWorklet.addModule(new URL("./empfang-worklet.js", import.meta.url)); // nur einmal laden
  await worklet;
  const knoten = new AudioWorkletNode(a, "sstv-mithoeren");
  a.createMediaStreamSource(strom).connect(knoten);
  const aufnahme = { strom, knoten, stuecke: [], rate: a.sampleRate };
  knoten.port.onmessage = (event) => {
    aufnahme.stuecke.push(event.data);
    beiStueck?.(event.data);
  };
  return aufnahme;
}
// aus, und das Gehörte als ein Ton mit RATE (die Stufen rechnen damit, das Mikrofon zählt vielleicht anders)
async function beendeAufnahme(aufnahme) {
  aufnahme.strom.getTracks().forEach((t) => t.stop());
  aufnahme.knoten.disconnect();
  const ton = new Float32Array(aufnahme.stuecke.reduce((s, t) => s + t.length, 0));
  let pos = 0;
  for (const t of aufnahme.stuecke) {
    ton.set(t, pos);
    pos += t.length;
  }
  return aufnahme.rate === RATE ? ton : umrechnen(ton, aufnahme.rate);
}

// Beim Ausschalten wird das Gehörte eine Stufe (Ton und Bild). Bild und Text werden live gelesen, ein Klang
// wird erst aufgenommen und beim Ausschalten verstanden (bei FM ausgepackt)
hole("mikrofon").addEventListener("click", async () => {
  if (mikro) {
    const { e } = mikro;
    const ton = await beendeAufnahme(mikro);
    mikro = null;
    hole("mikrofon").textContent = "Mikrofon an";
    if (nichtLive()) neueStufe("Mikrofon", ton, await empfange(ton, lauf));
    else if (e && empfaenger === e) neueStufe("Mikrofon", ton, e.statusText ? { bild: e.bild, band: e.band } : { bild: e.bild, modus: e.m });
    return;
  }
  try {
    lauf++; // ein laufendes Lesen hört auf
    const a = await audio();
    const e = nichtLive() ? null : neuerEmpfaenger(a.sampleRate);
    const neu = await starteAufnahme((stueck) => {
      if (e && empfaenger === e) e.fuettere(stueck);
    });
    neu.e = e;
    mikro = neu;
    hole("mikrofon").textContent = "Mikrofon aus (wird eine Stufe)";
    const zeichne = () => {
      if (mikro !== neu) return;
      if (e) zeigeEmpfang();
      else status.textContent = `nimmt auf: ${minuten((neu.stuecke.length * 2048) / neu.rate)}`;
      requestAnimationFrame(zeichne);
    };
    zeichne();
  } catch (fehler) {
    zeige(`Mikrofon ging nicht: ${fehler.message}`);
  }
});
async function umrechnen(ton, rate) {
  const puffer = new AudioBuffer({ length: ton.length, numberOfChannels: 1, sampleRate: rate });
  puffer.copyToChannel(ton, 0);
  const ctx = new OfflineAudioContext(1, Math.ceil((ton.length * RATE) / rate), RATE);
  const q = new AudioBufferSourceNode(ctx, { buffer: puffer });
  q.connect(ctx.destination);
  q.start();
  return (await ctx.startRendering()).getChannelData(0);
}

hole("anhalten").addEventListener("click", () => {
  lauf++;
  halteSpieler();
  zeige("");
});

// ---------- Export ----------
const alsWav = (ton) => {
  const puffer = new AudioBuffer({ length: ton.length, numberOfChannels: 1, sampleRate: RATE });
  puffer.copyToChannel(ton, 0);
  return zuWav(puffer);
};
const dateiName = (stufe) => `${name}-sstv-${stufe.name.replace(/[^\wäöüÄÖÜß-]+/g, "-")}`;

const exportFelder = () => ({
  inhalt: hole("exportInhalt").value,
  bis: Number(hole("exportBis").value),
  spalten: Math.max(0, Math.round(Number(hole("exportSpalten").value))),
  beschriftung: hole("exportBeschriftung").checked,
  hintergrund: hole("exportHintergrund").value,
});
let exportArt = "bild";

// alle Stufen bis „bis“ als Gitter in ein Canvas; beschriftet mit ihren Namen
function gitter(felder) {
  const auswahl = stufen.slice(0, felder.bis + 1);
  const n = auswahl.length;
  const spalten = felder.spalten || Math.ceil(Math.sqrt(n));
  const zeilen = Math.ceil(n / spalten);
  const w = Math.max(...auswahl.map((s) => s.bild.width));
  const h = Math.max(...auswahl.map((s) => s.bild.height));
  const rand = Math.round(w * 0.04);
  const schrift = felder.beschriftung ? Math.round(h * 0.09) : 0;
  const c = document.createElement("canvas");
  c.width = spalten * w + (spalten + 1) * rand;
  c.height = zeilen * (h + schrift) + (zeilen + 1) * rand;
  const ctx = c.getContext("2d");
  ctx.fillStyle = felder.hintergrund;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = felder.hintergrund === "#000000" ? "#fff" : "#000";
  ctx.font = `${schrift * 0.8}px sans-serif`;
  ctx.textBaseline = "top";
  const zwischen = document.createElement("canvas");
  auswahl.forEach((s, i) => {
    const x = rand + (i % spalten) * (w + rand);
    const y = rand + Math.floor(i / spalten) * (h + schrift + rand);
    if (felder.beschriftung) ctx.fillText(s.name, x, y);
    zwischen.width = s.bild.width;
    zwischen.height = s.bild.height;
    zwischen.getContext("2d").putImageData(s.bild, 0, 0);
    const f = Math.min(w / s.bild.width, h / s.bild.height); // ganz zeigen, nicht strecken
    ctx.drawImage(zwischen, x + (w - s.bild.width * f) / 2, y + schrift, s.bild.width * f, s.bild.height * f);
  });
  return c;
}
function einzelbild(stufe) {
  const c = document.createElement("canvas");
  c.width = stufe.bild.width;
  c.height = stufe.bild.height;
  c.getContext("2d").putImageData(stufe.bild, 0, 0);
  return c;
}

function passeFelderAn() {
  const alle = hole("exportInhalt").value === "stufen";
  for (const id of ["exportBisLabel", "exportBeschriftungLabel", "exportHintergrundLabel"]) hole(id).hidden = !alle;
  hole("exportSpaltenLabel").hidden = !alle || exportArt === "video";
  const bis = hole("exportBis");
  const alt = bis.value;
  bis.replaceChildren(...stufen.map((s, i) => new Option(s.name, i)));
  bis.value = alt && Number(alt) < stufen.length ? alt : String(stufen.length - 1);
}
hole("exportInhalt").addEventListener("change", passeFelderAn);

const dialog = erstelleExportDialog({
  felder: hole("exportFelder"),
  zeichneVorschau: (einst) => {
    const f = exportFelder();
    if (exportArt === "video") return mitRahmen(einzelbild(stufen[f.inhalt === "stufen" ? 0 : gewaehlt]), einst);
    return mitRahmen(f.inhalt === "stufen" ? gitter(f) : einzelbild(stufen[gewaehlt]), einst);
  },
});

hole("bildSpeichern").addEventListener("click", async () => {
  exportArt = "bild";
  passeFelderAn();
  const einst = await dialog.oeffne({ art: "bild", ueberschrift: "Bild speichern" });
  if (!einst) return;
  const f = exportFelder();
  const c = f.inhalt === "stufen" ? gitter(f) : einzelbild(stufen[gewaehlt]);
  await speichereCanvas(mitRahmen(c, einst), einst.bildTyp, f.inhalt === "stufen" ? `${name}-sstv-stufen-${zeitstempel()}` : `${dateiName(stufen[gewaehlt])}-${zeitstempel()}`);
});

hole("wavSpeichern").addEventListener("click", () => ladeHerunter(alsWav(hoerTon(stufen[gewaehlt])), `${dateiName(stufen[gewaehlt])}-${zeitstempel()}.wav`));

// Video: der Empfang, wie er Zeile für Zeile entsteht, mit dem Ton dazu. Eine Stufe oder alle nacheinander.
// Ein Klang: sein Spektrogramm, ein Strich läuft mit. Hellschreiber: das Band, wie es gedruckt wird
function neuerLeser(stufe) {
  const art = sendeArt();
  if (art === "sstv") {
    const e = new Empfaenger(RATE, { modus: stufe.modus, automatisch: true, ...SYNC_ARTEN[hole("synchron").value], ...farbBereich() });
    return { ton: stufe.ton, fuettere: (t) => e.fuettere(t), bild: () => e.bild, zeile: () => (e.zustand === "bild" ? e.fertigeZeilen / e.m.hoehe : -1) };
  }
  if (art === "hell") {
    const e = new HellEmpfaenger(RATE, hellWerte());
    return { ton: stufe.ton, fuettere: (t) => e.fuettere(t), bild: () => e.bild, zeile: () => -1 };
  }
  const ton = hoerTon(stufe);
  let pos = 0;
  return { ton, fuettere: (t) => (pos += t.length), bild: () => stufe.bild, zeile: () => -1, spalte: () => pos / ton.length };
}

hole("videoRendern").addEventListener("click", async () => {
  if (beschaeftigt) return;
  exportArt = "video";
  passeFelderAn();
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", zeit: false });
  if (!einst) return;
  const f = exportFelder();
  const auswahl = f.inhalt === "stufen" ? stufen.slice(0, f.bis + 1) : [stufen[gewaehlt]];
  beschaeftigt = true;
  const meins = ++lauf;
  let aufnahme = null;
  try {
    const fps = 30;
    // ganzzahlig vergrößert, damit Pixel Pixel bleiben (Hellschreiber und M1 sind sonst winzig)
    const b0 = Math.max(...auswahl.map((s) => s.bild.width));
    const h0 = Math.max(...auswahl.map((s) => s.bild.height));
    const faktor = Math.max(1, Math.min(Math.floor(1920 / b0), Math.floor(1920 / h0), Math.ceil(960 / b0)));
    const w = Math.ceil((b0 * faktor) / 2) * 2;
    const h = Math.ceil((h0 * faktor) / 2) * 2;
    const bild = document.createElement("canvas");
    bild.width = w;
    bild.height = h;
    const ctx = bild.getContext("2d");
    const zwischen = document.createElement("canvas");
    const rahmen = document.createElement("canvas");
    aufnahme = await neueAufnahme(mitRahmen(bild, einst, rahmen), fps, undefined, { kanaele: 1, rate: RATE }, einst.videoTyp, einst.videoQualitaet);
    let t = 0;
    for (const stufe of auswahl) {
      const leser = neuerLeser(stufe);
      // Maßstab nach dem fertigen Bild der Stufe: was noch wächst (Hellschreiber), wächst darin nach unten
      const m = Math.min(w / stufe.bild.width, h / stufe.bild.height);
      const x0 = (w - stufe.bild.width * m) / 2;
      const y0 = (h - stufe.bild.height * m) / 2;
      const proBild = RATE / fps;
      for (let pos = 0; pos < leser.ton.length && meins === lauf; pos += proBild) {
        const stueck = leser.ton.subarray(Math.round(pos), Math.round(pos + proBild));
        leser.fuettere(stueck);
        const jetzt = leser.bild();
        zwischen.width = jetzt.width;
        zwischen.height = jetzt.height;
        zwischen.getContext("2d").putImageData(jetzt, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(zwischen, x0, y0, jetzt.width * m, jetzt.height * m);
        ctx.fillStyle = "rgba(255, 60, 60, 0.8)";
        const zeile = leser.zeile();
        if (zeile >= 0) ctx.fillRect(x0, y0 + zeile * stufe.bild.height * m, stufe.bild.width * m, Math.max(1, m));
        if (leser.spalte) ctx.fillRect(x0 + leser.spalte() * stufe.bild.width * m, y0, Math.max(1, m / 2), stufe.bild.height * m);
        if (f.beschriftung && auswahl.length > 1) {
          ctx.fillStyle = "#fff";
          ctx.font = `${Math.round(h * 0.06)}px sans-serif`;
          ctx.textBaseline = "top";
          ctx.fillText(stufe.name, h * 0.03, h * 0.03);
        }
        const puffer = new AudioBuffer({ length: stueck.length, numberOfChannels: 1, sampleRate: RATE });
        puffer.copyToChannel(stueck, 0);
        await Promise.all([aufnahme.bild(mitRahmen(bild, einst, rahmen), t, 1 / fps), aufnahme.ton(puffer)]);
        t += 1 / fps;
        if (Math.round(t * fps) % 30 === 0) {
          zeige(`Video: ${stufe.name}, ${Math.round((pos / leser.ton.length) * 100)} %`);
          await warte();
        }
      }
    }
    if (meins !== lauf) throw new Error("angehalten");
    zeige("Speichern …");
    ladeHerunter(await aufnahme.fertig(), `${name}-sstv-${zeitstempel()}.${aufnahme.endung}`);
    zeige("");
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(fehler.message === "angehalten" ? "" : `Video ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
  }
});

baueStart();
