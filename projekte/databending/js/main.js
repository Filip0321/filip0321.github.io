// Databending: ein Bild als Ton bearbeiten, wie in Audacity, aber mit Wellenform und Bild nebeneinander.
// Ablauf: Bild laden → Bytes R, G, B als Samples (/lib/databending.js: bildZuTon) → jeder Bereich schickt seinen
// Teil durch seinen Effekt, in der Reihenfolge der Liste → Samples wieder als Bild (tonZuBild).
// Ein Bereich in der Welle ist ein Streifen von Zeilen im Bild: eine Zeile sind Breite · 3 Samples.
//
// Drei Arten von Dateien, immer dieselben Samples:
//   Bild    die Bytes des Bildes sind der Ton (wie bisher)
//   Video   jedes Bild des Videos geht durch dieselben Bereiche; die Bereiche stellt man an einem Bild ein
//   Lied    umgekehrt: der Ton ist das Original, das Bild zeigt ihn (drei Samples ein Pixel). Was man ins Bild
//           malt, wird zu Ton; die Samples, die man nicht anfasst, bleiben in voller Genauigkeit (Float),
//           nur die Anzeige ist auf 8 Bit gerundet.

import { bildZuTon, tonZuBild, EFFEKTE, EFFEKT_BESCHREIBUNG } from "/lib/databending.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { speichereCanvas, ladeHerunter, zeitstempel, neueAufnahme, schneideTon, warte } from "/lib/export.js";
import { oeffneVideo, ladeTon } from "/lib/video-quelle.js";
import { richteWelleEin } from "./welle.js";
import { alsWav } from "./wav.js";

const bild = hole("bild");
const bildCtx = bild.getContext("2d");
const markierung = hole("markierung");
const markCtx = markierung.getContext("2d");
const feld = hole("feld");
const meldung = hole("meldung");
const stelle = hole("stelle");
const auswahlInfo = hole("auswahlInfo");
const liste = hole("bereiche");

// quelle: was geladen ist, als Samples. ton: unbearbeitet (Gemaltes schon drin), anfang: wie beim Öffnen
let quelle = null; // { art: "bild" | "video" | "lied", ton, anfang, breite, hoehe }
let video = null; // aus oeffneVideo, nur bei Videos
let videoTon = null; // AudioBuffer oder null
let lied = null; // { samples, original, rate }: der Ton eines Liedes ohne die Füllung am Ende
let name = "bild";
let ergebnis = null; // Float32Array nach allen Bereichen
let auswahl = null; // [von, bis] in Samples
const bereiche = []; // { von, bis, art, werte, farbe }
const FARBEN = ["#ff5544", "#44aaff", "#ffcc33", "#55dd77", "#cc66ff", "#ff8844"];
let beschaeftigt = false;

function zeige(text) {
  meldung.textContent = text;
  meldung.hidden = !text;
}
function zeigeFortschritt(text) {
  hole("fortschritt").textContent = text ?? "";
  hole("fortschritt").hidden = !text;
}

const zeilenLaenge = () => quelle.breite * 3; // Samples pro Zeile
const zeileVon = (n) => Math.floor(n / zeilenLaenge());
const rate = () => (lied ? lied.rate : Number(hole("rate").value));
const nutzLaenge = () => (lied ? lied.samples.length : ergebnis.length); // ohne die Füllung am Ende eines Liedes

// auf ganze Zeilen runden (ab: nach unten, auf: nach oben), wenn eingeschaltet
function einrasten(n, richtung = "ab") {
  if (!quelle || !hole("einrasten").checked) return n;
  const z = zeilenLaenge();
  return Math.min(quelle.hoehe * z, (richtung === "auf" ? Math.ceil(n / z) : Math.floor(n / z)) * z);
}

const welle = richteWelleEin(hole("welle"), {
  beiAuswahl: (von, bis) => waehle(von, bis),
  beiZeiger: (n) => {
    if (!quelle) return;
    const zeit = lied ? ` · ${(n / lied.rate).toFixed(2)} s` : "";
    stelle.textContent = `Sample ${n.toLocaleString("de")} · Zeile ${zeileVon(n)} · ${["Rot", "Grün", "Blau"][n % 3]}${zeit}`;
  },
});
welle.setzeEinrasten(einrasten);

// ---------- Laden ----------
// eine Datei, drei Wege: nach ihrem Typ (Bild, Video, Ton)
hole("datei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei || beschaeftigt) return;
  name = datei.name.replace(/\.[^.]+$/, "");
  zeige("");
  beschaeftigt = true;
  zeigeFortschritt("Öffnen …");
  try {
    if (datei.type.startsWith("video/")) await ladeVideo(datei);
    else if (datei.type.startsWith("audio/")) await ladeLied(datei);
    else await ladeBild(datei);
  } catch (fehler) {
    console.error(fehler);
    zeige(`Öffnen ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
    zeigeFortschritt(null);
  }
});

// Samples ins Projekt setzen; behalte: Bereiche bleiben (beim Wechsel der Zeilenlänge eines Liedes)
function setzeQuelle(art, ton, breite, hoehe, behalte = false) {
  quelle = { art, ton, anfang: ton.slice(), breite, hoehe };
  bild.width = markierung.width = breite;
  bild.height = markierung.height = hoehe;
  // angezeigt höchstens 3:1 und mindestens 1:2: ein Lied mit langen Zeilen (ein Takt sind Tausende Pixel) wäre
  // sonst nur ein Strich. Die Pixel werden dann gestreckt gezeigt, gerechnet und gespeichert wird unverzerrt.
  feld.style.setProperty("--verhaeltnis", String(Math.min(3, Math.max(0.5, breite / hoehe))));
  if (!behalte) {
    auswahl = null;
    bereiche.length = 0;
  } else if (auswahl) waehle(...auswahl);
  hole("videoTeil").hidden = art !== "video";
  hole("videoSpeichern").hidden = art !== "video";
  hole("liedTeil").hidden = art !== "lied";
  hole("rate").disabled = art === "lied"; // ein Lied hat seine eigene Rate
  zeigeBereiche();
  rechne();
  welle.ganz();
}

async function ladeBild(datei) {
  video = videoTon = lied = null;
  const bitmap = await createImageBitmap(datei);
  const breite = Math.min(bitmap.width, Number(hole("groesse").value));
  const hoehe = Math.round((bitmap.height * breite) / bitmap.width);
  const daten = alsBildDaten(bitmap, breite, hoehe);
  bitmap.close();
  setzeQuelle("bild", bildZuTon(daten), breite, hoehe);
}

// ein Bild (Bitmap, Canvas) in der Rechengröße als ImageData
const hilfe = document.createElement("canvas");
const hilfeCtx = hilfe.getContext("2d", { willReadFrequently: true });
function alsBildDaten(quelleBild, breite, hoehe) {
  hilfe.width = breite;
  hilfe.height = hoehe;
  hilfeCtx.drawImage(quelleBild, 0, 0, breite, hoehe);
  return hilfeCtx.getImageData(0, 0, breite, hoehe);
}

// ---------- Video ----------
// Die Bereiche stellt man an einem Bild ein (Schieber „Bild bei“); beim Speichern geht jedes Bild des Videos
// durch dieselben Bereiche. Weil alle Bilder gleich groß sind, liegt ein Bereich immer auf denselben Zeilen.
async function ladeVideo(datei) {
  lied = null;
  video = await oeffneVideo(datei);
  videoTon = await ladeTon(datei);
  const g = video.groesse(Number(hole("groesse").value));
  const zeit = hole("videoZeit");
  zeit.max = Math.max(0, video.dauer - 1 / video.fps);
  zeit.value = 0;
  const daten = await videoBild(g, 0);
  setzeQuelle("video", bildZuTon(daten), g.breite, g.hoehe);
  zeigeVideoZeit();
}
// genau ein Bild des Videos (Sekunden ab Anfang) als ImageData
async function videoBild(g, t) {
  for await (const w of video.bilderZu(g, [t])) if (w) return alsBildDaten(w.canvas, g.breite, g.hoehe);
  throw new Error("Dieses Bild des Videos ließ sich nicht dekodieren.");
}

function zeigeVideoZeit() {
  hole("videoZeitAnzeige").textContent = `${Number(hole("videoZeit").value).toFixed(2)} s`;
}
let videoHolen = null; // das gerade dekodierte Bild; ein neues wartet, bis es fertig ist
hole("videoZeit").addEventListener("input", () => {
  zeigeVideoZeit();
  if (videoHolen) return;
  videoHolen = (async () => {
    let t;
    do {
      t = Number(hole("videoZeit").value);
      const daten = await videoBild({ breite: quelle.breite, hoehe: quelle.hoehe }, t);
      quelle.ton = quelle.anfang = bildZuTon(daten);
      rechne();
    } while (t !== Number(hole("videoZeit").value)); // inzwischen weitergeschoben: noch einmal
    videoHolen = null;
  })().catch((fehler) => {
    videoHolen = null;
    zeige(`Bild holen ging nicht: ${fehler.message}`);
  });
});
hole("lfoLauf").addEventListener("input", () => {
  hole("lfoLaufAnzeige").textContent = hole("lfoLauf").value;
  plane();
});

// ---------- Lied ----------
// Ton laden, auf eine Rate (44,1 kHz) und einen Kanal (Mitte aus links und rechts) bringen, in Zeilen legen.
// Die Zeilenlänge entscheidet, was man sieht: ist eine Zeile genau ein Schlag (oder ein Teil davon) lang, liegen
// alle Bassdrums übereinander, als senkrechte Spalten. Ist das Tempo nicht genau getroffen, kippen die Spalten
// schräg: das Bild zeigt, wie weit das Lied vom eingestellten Tempo abweicht.
async function ladeLied(datei) {
  video = videoTon = null;
  const LIED_RATE = 44100;
  const puffer = await new OfflineAudioContext(1, 1, LIED_RATE).decodeAudioData(await datei.arrayBuffer());
  const mono = new Float32Array(puffer.length);
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    const kanal = puffer.getChannelData(k);
    for (let i = 0; i < mono.length; i++) mono[i] += kanal[i] / puffer.numberOfChannels;
  }
  lied = { samples: mono, original: mono.slice(), rate: LIED_RATE };
  legeLiedAus(false);
}

const TEILE = { sechzehntel: 0.25, achtel: 0.5, schlag: 1, takt: 4 };
function legeLiedAus(behalte = true) {
  const n = lied.samples.length;
  const art = hole("liedZeile").value;
  const bpm = Math.max(20, Number(hole("liedBpm").value) || 120);
  const breite = art === "bild"
    ? Math.ceil(Math.sqrt(((n / 3) * 16) / 9)) // so viele Pixel wie nötig, ungefähr 16:9
    : Math.max(1, Math.round(((60 / bpm) * lied.rate * TEILE[art]) / 3)); // gerundet: daher das Kippen
  const hoehe = Math.ceil(n / (breite * 3));
  if (breite * hoehe > 16e6) throw new Error("So groß wird das Bild zu groß für den Browser (über 16 Millionen Pixel). Kürzeres Stück oder andere Zeilenlänge.");
  const ton = new Float32Array(breite * hoehe * 3); // der Rest der letzten Zeile ist Stille (Grau)
  ton.set(lied.samples);
  const anfang = new Float32Array(ton.length);
  anfang.set(lied.original);
  setzeQuelle("lied", ton, breite, hoehe, behalte);
  quelle.anfang = anfang; // „zurücksetzen“ führt zum geladenen Lied, nicht zum letzten Stand
  const sekunden = (breite * 3) / lied.rate;
  hole("liedInfo").textContent = `${breite} × ${hoehe} Pixel · eine Zeile = ${sekunden.toFixed(3)} s` + (art === "bild" ? "" : ` (genau wären ${((((60 / bpm) * lied.rate * TEILE[art]) / 3)).toFixed(2)} Pixel)`);
}
for (const id of ["liedZeile", "liedBpm"]) hole(id).addEventListener("change", () => lied && legeLiedAus());

// ---------- Rechnen ----------
let geplant = false;
function plane() {
  if (geplant) return;
  geplant = true;
  requestAnimationFrame(() => {
    geplant = false;
    rechne();
  });
}

// alle Bereiche auf eine Kopie; zeit: Sekunde im Video (für den wandernden LFO von Phaser und Flanger)
function biege(ton, zeit = 0) {
  const phase = 2 * Math.PI * Number(hole("lfoLauf").value) * zeit;
  for (const b of bereiche) EFFEKTE[b.art](ton, b.von, Math.min(b.bis, ton.length), { ...b.werte, phase });
  return ton;
}

function rechne() {
  if (!quelle) return;
  const zeit = quelle.art === "video" ? Number(hole("videoZeit").value) : 0;
  ergebnis = biege(quelle.ton.slice(), zeit);
  bildCtx.putImageData(tonZuBild(ergebnis, quelle.breite, quelle.hoehe), 0, 0);
  welle.setzeTon(ergebnis);
  welle.setzeBereiche(bereiche.map((b) => ({ von: b.von, bis: b.bis, farbe: b.farbe })));
  zeichneMarkierung();
}

// ---------- Auswahl ----------
function waehle(von, bis) {
  if (!quelle) return;
  auswahl = [Math.max(0, von), Math.min(quelle.hoehe * zeilenLaenge(), bis)];
  welle.setzeAuswahl(auswahl);
  const z0 = zeileVon(auswahl[0]);
  const z1 = Math.ceil(auswahl[1] / zeilenLaenge());
  const zeit = lied ? `, ${(auswahl[0] / lied.rate).toFixed(2)} bis ${(auswahl[1] / lied.rate).toFixed(2)} s` : "";
  auswahlInfo.textContent = `Auswahl: Zeile ${z0} bis ${z1} (${(auswahl[1] - auswahl[0]).toLocaleString("de")} Bytes${zeit})`;
  zeichneMarkierung();
}

function zeichneMarkierung() {
  markCtx.clearRect(0, 0, markierung.width, markierung.height);
  if (!quelle) return;
  const z = zeilenLaenge();
  // Bereich: von Sample a bis b, als Streifen; angefangene Zeilen nur ab der Stelle (wie es im Bild wirkt)
  const streifen = (a, b, fuellung, rand) => {
    const y0 = a / z;
    const y1 = b / z;
    markCtx.fillStyle = fuellung;
    markCtx.fillRect(0, y0, markierung.width, Math.max(1, y1 - y0));
    if (rand) {
      markCtx.strokeStyle = rand;
      markCtx.lineWidth = Math.max(1, markierung.width / 400);
      markCtx.strokeRect(0, y0, markierung.width, Math.max(1, y1 - y0));
    }
  };
  for (const b of bereiche) streifen(b.von, b.bis, "transparent", b.farbe);
  if (auswahl) streifen(auswahl[0], auswahl[1], "rgba(255,255,255,0.15)", "#ffffff");
  if (kopf !== null) {
    markCtx.fillStyle = "#ff5544";
    markCtx.fillRect(((kopf % z) / 3) * 1, Math.floor(kopf / z), Math.max(2, markierung.width / 200), Math.max(2, markierung.height / 100));
  }
}

// im Bild ziehen: senkrecht Zeilen wählen (Markieren geht in beide Richtungen: Welle ↔ Bild), oder malen
const malen = hole("malen");
let bildAnker = null;
let pinselZuletzt = null;
const punktBei = (event) => {
  const r = markierung.getBoundingClientRect();
  return [((event.clientX - r.left) / r.width) * quelle.breite, ((event.clientY - r.top) / r.height) * quelle.hoehe];
};
const zeileBei = (event) => Math.max(0, Math.min(quelle.hoehe, Math.round(punktBei(event)[1])));
markierung.addEventListener("pointerdown", (event) => {
  if (!quelle) return;
  markierung.setPointerCapture(event.pointerId);
  if (malen.checked) {
    if (quelle.art === "video") return zeige("Malen geht bei Bildern und Liedern, nicht im Video (es wäre nur auf diesem einen Bild).");
    pinselZuletzt = punktBei(event);
    male(pinselZuletzt, pinselZuletzt);
    return;
  }
  bildAnker = zeileBei(event);
});
markierung.addEventListener("pointermove", (event) => {
  if (pinselZuletzt) {
    const p = punktBei(event);
    male(pinselZuletzt, p);
    pinselZuletzt = p;
    return;
  }
  if (bildAnker === null) return;
  const z = zeileBei(event);
  waehle(Math.min(bildAnker, z) * zeilenLaenge(), Math.max(bildAnker, z + 1) * zeilenLaenge());
});
const bildFertig = () => {
  bildAnker = null;
  pinselZuletzt = null;
};
markierung.addEventListener("pointerup", bildFertig);
markierung.addEventListener("pointercancel", bildFertig);
malen.addEventListener("change", () => feld.classList.toggle("malt", malen.checked));

// ---------- Malen ----------
// Der Pinsel schreibt direkt Samples, nicht Pixel in ein Canvas: so bleiben alle Stellen, die er nicht berührt,
// so genau, wie sie waren. Ein Pixel sind drei Samples hintereinander; welche Werte, sagt die Pinselart:
//   Farbe    die drei Bytes der Farbe: gleichmäßige Farbe ist ein kurzer, sich wiederholender Ton (Periode 3
//            Samples, also 14,7 kHz bei 44,1 kHz, ein hohes Pfeifen, plus Gleichanteil)
//   Rauschen zufällige Bytes: Rauschen
//   Stille   alles 128 (Grau): Stille. Damit radiert man Stellen aus einem Lied
function male([x0, y0], [x1, y1]) {
  const r = Number(hole("pinselGroesse").value) / 2;
  const art = hole("pinselArt").value;
  const hex = hole("pinselFarbe").value;
  const farbe = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) - 128) / 128);
  const { breite, hoehe, ton } = quelle;
  // die Strecke in Schritten von einem halben Pinsel abfahren, damit schnelle Striche keine Lücken haben
  const schritte = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, r / 2)));
  for (let s = 0; s <= schritte; s++) {
    const cx = x0 + ((x1 - x0) * s) / schritte;
    const cy = y0 + ((y1 - y0) * s) / schritte;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(hoehe - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(breite - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > Math.max(0.5, r * r)) continue;
        const i = (y * breite + x) * 3;
        for (let k = 0; k < 3; k++) ton[i + k] = art === "farbe" ? farbe[k] : art === "rauschen" ? Math.random() * 2 - 1 : 0;
      }
    }
  }
  if (lied) lied.samples.set(ton.subarray(0, lied.samples.length)); // bleibt beim Wechsel der Zeilenlänge
  plane();
}
hole("malenVerwerfen").addEventListener("click", () => {
  if (!quelle) return;
  quelle.ton = quelle.anfang.slice();
  if (lied) lied.samples = lied.original.slice();
  rechne();
});

hole("ganzWaehlen").addEventListener("click", () => quelle && waehle(0, quelle.hoehe * zeilenLaenge()));
hole("zoomAuswahl").addEventListener("click", () => auswahl && welle.zoome(...auswahl));
hole("zoomGanz").addEventListener("click", () => welle.ganz());
hole("einrasten").addEventListener("change", () => auswahl && waehle(einrasten(auswahl[0]), einrasten(auswahl[1], "auf")));

// ---------- Bereiche ----------
const neueArt = hole("neueArt");
for (const [art, b] of Object.entries(EFFEKT_BESCHREIBUNG)) neueArt.append(new Option(b.name, art));

hole("bereichDazu").addEventListener("click", () => {
  if (!quelle) return zeige("Erst eine Datei öffnen.");
  const [von, bis] = auswahl ?? [0, quelle.hoehe * zeilenLaenge()];
  const art = neueArt.value;
  const werte = Object.fromEntries(EFFEKT_BESCHREIBUNG[art].regler.map((r) => [r.name, r.wert]));
  bereiche.push({ von, bis, art, werte, farbe: FARBEN[bereiche.length % FARBEN.length] });
  zeigeBereiche();
  rechne();
});

function knopf(text, label, beiKlick, aus = false) {
  const k = document.createElement("button");
  k.type = "button";
  k.textContent = text;
  k.setAttribute("aria-label", label);
  k.disabled = aus;
  k.addEventListener("click", beiKlick);
  return k;
}

function zeigeBereiche() {
  liste.replaceChildren();
  bereiche.forEach((b, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--farbe", b.farbe);
    const beschreibung = EFFEKT_BESCHREIBUNG[b.art];
    const kopfZeile = document.createElement("div");
    kopfZeile.className = "kopf";
    const wahl = document.createElement("select");
    wahl.setAttribute("aria-label", "Effekt");
    for (const [art, e] of Object.entries(EFFEKT_BESCHREIBUNG)) wahl.append(new Option(e.name, art, false, art === b.art));
    wahl.addEventListener("change", () => {
      b.art = wahl.value;
      b.werte = Object.fromEntries(EFFEKT_BESCHREIBUNG[b.art].regler.map((r) => [r.name, r.wert]));
      zeigeBereiche();
      rechne();
    });
    const tausche = (j) => {
      [bereiche[i], bereiche[j]] = [bereiche[j], bereiche[i]];
      zeigeBereiche();
      rechne();
    };
    const zeilen = `Zeile ${zeileVon(b.von)}–${Math.ceil(b.bis / zeilenLaenge())}`;
    kopfZeile.append(
      wahl,
      zeilen,
      knopf("↑", "nach oben", () => tausche(i - 1), i === 0),
      knopf("↓", "nach unten", () => tausche(i + 1), i === bereiche.length - 1),
      knopf("◎", "Bereich auswählen", () => waehle(b.von, b.bis)),
      knopf("×", "Bereich entfernen", () => {
        bereiche.splice(i, 1);
        zeigeBereiche();
        rechne();
      }),
    );
    const regler = document.createElement("div");
    regler.className = "steuerung";
    for (const r of beschreibung.regler) {
      const feldR = document.createElement("input");
      feldR.type = "range";
      feldR.min = r.min;
      feldR.max = r.max;
      feldR.step = r.schritt;
      feldR.value = b.werte[r.name];
      const ausgabe = document.createElement("output");
      ausgabe.textContent = feldR.value;
      feldR.addEventListener("input", () => {
        b.werte[r.name] = Number(feldR.value);
        ausgabe.textContent = feldR.value;
        plane();
      });
      const label = document.createElement("label");
      label.append(r.text, feldR, ausgabe);
      regler.append(label);
    }
    li.append(kopfZeile, regler);
    liste.append(li);
  });
}

// ---------- Anhören ----------
let ac = null;
let spieler = null;
let kopf = null; // Abspielkopf in Samples
const abspielen = hole("abspielen");
abspielen.addEventListener("click", () => {
  if (spieler) return halte();
  if (!ergebnis) return zeige("Erst eine Datei öffnen.");
  const r = rate();
  ac ??= new AudioContext();
  ac.resume();
  // nur die Auswahl, wenn es eine gibt (beim Lied ohne die stille Füllung am Ende)
  const [von, bis] = auswahl ? [auswahl[0], Math.min(auswahl[1], nutzLaenge())] : [0, nutzLaenge()];
  if (bis <= von) return;
  const puffer = new AudioBuffer({ length: bis - von, numberOfChannels: 1, sampleRate: r });
  // abschneiden wie beim Speichern als Bild: was über 1 geht, ist im Bild auch nur Weiß
  const stueck = ergebnis.slice(von, bis).map((s) => Math.max(-1, Math.min(1, s)));
  puffer.copyToChannel(stueck, 0);
  spieler = new AudioBufferSourceNode(ac, { buffer: puffer });
  spieler.connect(ac.destination);
  const start = ac.currentTime;
  spieler.start();
  spieler.onended = halte;
  abspielen.textContent = "Anhalten";
  const schritt = () => {
    if (!spieler) return;
    kopf = von + Math.round((ac.currentTime - start) * r);
    welle.setzeKopf(kopf);
    zeichneMarkierung();
    requestAnimationFrame(schritt);
  };
  schritt();
});
function halte() {
  spieler?.stop();
  spieler = null;
  kopf = null;
  welle.setzeKopf(null);
  zeichneMarkierung();
  abspielen.textContent = "Abspielen";
}

hole("tonSpeichern").addEventListener("click", () => {
  if (!ergebnis) return zeige("Erst eine Datei öffnen.");
  ladeHerunter(alsWav(ergebnis.subarray(0, nutzLaenge()), rate()), `${name}-databending-${zeitstempel()}.wav`);
});

// ---------- Export ----------
// Vorschau im Fenster: beim Video das gewählte Bild aus der Zeit, gebogen (das dauert einen Moment)
const vorschauLeinwand = document.createElement("canvas");
const dialog = erstelleExportDialog({
  zeichneVorschau: async (einst, zeit) => {
    if (zeit === null || !video) return mitRahmen(bild, einst);
    const daten = await videoBild({ breite: quelle.breite, hoehe: quelle.hoehe }, zeit * video.dauer);
    vorschauLeinwand.width = quelle.breite;
    vorschauLeinwand.height = quelle.hoehe;
    vorschauLeinwand.getContext("2d").putImageData(tonZuBild(biege(bildZuTon(daten), zeit * video.dauer), quelle.breite, quelle.hoehe), 0, 0);
    return mitRahmen(vorschauLeinwand, einst);
  },
});
hole("bildSpeichern").addEventListener("click", async () => {
  if (!quelle) return zeige("Erst eine Datei öffnen.");
  const einst = await dialog.oeffne({ art: "bild", ueberschrift: "Bild speichern" });
  if (einst) await speichereCanvas(mitRahmen(bild, einst), einst.bildTyp, `${name}-databending-${zeitstempel()}`);
});

// Video: jedes Bild dekodieren, als Samples durch die Bereiche, zurück ins Bild, kodieren. Der Ton des Videos
// bleibt, wie er ist (gebogen wird nur das Bild).
hole("videoSpeichern").addEventListener("click", async () => {
  if (!video || beschaeftigt) return;
  const einst = await dialog.oeffne({ art: "video", ueberschrift: "Video rendern", laenge: video.dauer });
  if (!einst) return;
  beschaeftigt = true;
  let aufnahme = null;
  try {
    const g = { breite: quelle.breite, hoehe: quelle.hoehe };
    const fps = Math.round(video.fps) || 30;
    const von = einst.von * video.dauer;
    const bis = einst.bis * video.dauer;
    const arbeit = document.createElement("canvas");
    arbeit.width = g.breite;
    arbeit.height = g.hoehe;
    const arbeitCtx = arbeit.getContext("2d");
    const rahmen = document.createElement("canvas");
    aufnahme = await neueAufnahme(mitRahmen(arbeit, einst, rahmen), fps, undefined, videoTon && { kanaele: videoTon.numberOfChannels, rate: videoTon.sampleRate }, einst.videoTyp, einst.videoQualitaet);
    const gesamt = Math.max(1, Math.round((bis - von) * fps));
    let i = 0;
    for await (const w of video.bilder(g, von, bis)) {
      const t = i / fps; // Zeit im neuen Video
      const daten = alsBildDaten(w.canvas, g.breite, g.hoehe);
      arbeitCtx.putImageData(tonZuBild(biege(bildZuTon(daten), von + t), g.breite, g.hoehe), 0, 0);
      const stueck = videoTon && schneideTon(videoTon, Math.round((von + t) * videoTon.sampleRate), Math.round((von + t + 1 / fps) * videoTon.sampleRate));
      await Promise.all([aufnahme.bild(mitRahmen(arbeit, einst, rahmen), t, 1 / fps), stueck && aufnahme.ton(stueck)]);
      if (++i % 3 === 0) {
        zeigeFortschritt(`Video … ${Math.min(100, Math.round((i / gesamt) * 100))} %`);
        await warte();
      }
    }
    zeigeFortschritt("Speichern …");
    ladeHerunter(await aufnahme.fertig(), `${name}-databending-${zeitstempel()}.${aufnahme.endung}`);
  } catch (fehler) {
    console.error(fehler);
    await aufnahme?.abbrechen();
    zeige(`Video ging nicht: ${fehler.message}`);
  } finally {
    beschaeftigt = false;
    zeigeFortschritt(null);
  }
});
