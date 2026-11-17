// Das Zimmer: ein Gaussian-Splat-Scan, in dem Gegenstände Links sind. Zusammengesteckt aus
//   zustand.js      was sich alle teilen (Einstellungen, Szene, Kameras, Gegenstände)
//   laden.js        .ply, .splat und .spz lesen, Kovarianzen rechnen, Szene drehen
//   zeichnen.js     die Splats auf der Grafikkarte
//   sortieren.js    nach Tiefe sortieren (Web Worker)
//   kamera.js       eine Kamera (kreisen, Rundblick, Draufsicht)
//   steuerung.js    Maus, Finger, Mausrad und Handy-Lage → Kamera; Rundblick dreht sich von allein
//   dinge.js        die Links über den Gegenständen, Zeigen (Kreisen + Text), Kamerafahrt beim Klick
//   grundriss.js    Grundriss in der Draufsicht, Mittelpunkt, Zuschneiden
//   bearbeiten.js   die Leiste (?bearbeiten oder Taste B)
//   gizmo.js        verschieben, drehen, skalieren im Bearbeiten-Modus (Pfeile, Ringe; G, R, S wie in Blender)
//   picken.js       der Punkt auf der Oberfläche unter der Maus
//   flaeche.js      Rechnen mit Flächen: Mitte, Normale, Drehen, Homographie für die Fenster
//   platzhalter.js  ein Zimmer aus Kästen, solange es keinen Scan gibt
// Was gezeigt wird, steht in zimmer.json.

import { z, neu, aktiveKamera, hexZuRgb, zeige } from "./zustand.js";
import { ladeSplats, dreheSzene } from "./laden.js";
import { erstelleZeichner } from "./zeichnen.js";
import { erstelleKamera } from "./kamera.js";
import { platzhalterZimmer, PLATZHALTER } from "./platzhalter.js";
import { schritt, richteNeigungEin } from "./steuerung.js";
import { baueDinge, platziereDinge, fahrtSchritt, flaechenZumZeichnen, setzeMaske } from "./dinge.js";
import { wendeGrundrissAn, baueRundKamera, zeichneGrundriss, schnitthoehe } from "./grundriss.js";
import { richteLeisteEin } from "./bearbeiten.js";
import { zeichneGizmo } from "./gizmo.js";

let zeichner;
try {
  zeichner = erstelleZeichner(z.canvas);
} catch (fehler) {
  zeige(fehler.message);
  throw fehler;
}

const worker = new Worker(new URL("./sortieren.js", import.meta.url));
let sortiertGerade = false;
let letzteAnsicht = null;
worker.onmessage = ({ data }) => {
  zeichner.setzeReihenfolge(data.reihenfolge);
  sortiertGerade = false;
  neu();
};

// gezeigte Szene (z.szene) zur Grafikkarte und zum Sortieren
// eine Seite auf einer Fläche: Maske aus den Splats davor (dinge.js), einmal zeichnen, auslesen, wieder normal zeichnen
z.maskeRechnen = (ebene) => {
  const k = aktiveKamera();
  k.rechne(z.canvas.width, z.canvas.height);
  setzeMaske(zeichner.deckungVor(k, ebene));
  neu();
};
z.vergissTextur = (el) => zeichner.vergiss(el);

z.beiNeuerSzene = () => {
  zeichner.setzeSzene(z.szene);
  worker.postMessage({ lage: z.szene.lage });
  letzteAnsicht = null;
  neu();
};

// ---------- Laden ----------
async function start() {
  try {
    z.einst = await (await fetch("zimmer.json")).json();
  } catch {
    z.einst = {};
  }
  if (!z.einst.splats) z.einst = { ...PLATZHALTER, ...z.einst, splats: null };
  zeige(z.einst.splats ? "lädt das Zimmer …" : "");
  const s = z.einst.splats ? await ladeSplats(splatDatei(z.einst.splats)) : platzhalterZimmer();
  setzeSzene(s);
  zeige(z.einst.splats ? "" : "Platzhalter: ein Zimmer aus Kästen, bis es einen Scan gibt (zimmer.json → \"splats\").", 6000);
}

// Zwei Fassungen desselben Scans: "splats": { "pc": "zimmer_pc.spz", "handy": "zimmer_handy.spz" } (oder nur ein
// Dateiname). Handy heißt: Bedienung mit dem Finger und die kurze Bildschirmseite unter 900 Pixeln (ein iPad Pro
// bekommt also die große Fassung). Zum Ausprobieren am Rechner: ?handy oder ?pc an die Adresse.
// Beide Dateien müssen aus demselben Training (oder denselben Kamerapositionen) stammen, sonst passen Drehung,
// Grundriss und Gegenstände nur zu einer von beiden.
function splatDatei(s) {
  if (typeof s === "string") return s;
  const p = new URLSearchParams(location.search);
  const handy = p.has("handy") || (!p.has("pc") && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900);
  return (handy ? s.handy : s.pc) ?? s.pc ?? s.handy;
}

// neue Szene (beim Start oder aus „Scan öffnen“)
export function setzeSzene(s) {
  z.roh = s;
  dreheSzene(z.roh, z.einst.drehung ?? [0, 0, 0]);
  z.einst.kamera ??= rahmen(z.roh);
  z.kamera = erstelleKamera(z.einst.kamera);
  z.ed = erstelleKamera(z.einst.kamera); // Bearbeiten: eigene Kamera, fängt beim Startblick an
  z.cursor ??= [...z.ed.ziel];
  z.oben = erstelleKamera({ ...z.einst.kamera, sichtfeld: 25 });
  z.oben.oben = true;
  wendeGrundrissAn(); // setzt z.szene (zugeschnitten oder nicht) und ruft z.beiNeuerSzene
  baueRundKamera();
  baueDinge();
}
z.setzeSzene = setzeSzene;
if (z.bearbeiten) window.zimmer = z; // zum Nachsehen in der Browser-Konsole (F12): zimmer.einst, zimmer.rund …

// Blick auf eine Szene ohne gespeicherte Kamera: auf die Mitte, aus einem Abstand, in dem alles zu sehen ist.
// Mitte und Größe aus den 5- und 95-%-Grenzen jeder Achse: einzelne Splats weit draußen (Floater, die das Training
// übrig lässt) würden sonst alles verschieben.
export function rahmen({ lage, anzahl }) {
  const schritt = Math.max(1, Math.floor(anzahl / 20000));
  const achsen = [[], [], []];
  for (let i = 0; i < anzahl; i += schritt) for (let k = 0; k < 3; k++) achsen[k].push(lage[3 * i + k]);
  const mitte = [], groesse = [];
  for (const a of achsen) {
    a.sort((x, y) => x - y);
    const lo = a[Math.floor(a.length * 0.05)], hi = a[Math.floor(a.length * 0.95)];
    mitte.push((lo + hi) / 2);
    groesse.push(hi - lo);
  }
  return { ziel: mitte, gier: 0, nick: -0.2, abstand: Math.max(...groesse) * 1.3 || 3, sichtfeld: 60 };
}

// ---------- Schleife ----------
function groesse() {
  const dpr = Math.min(2, window.devicePixelRatio || 1) * (z.einst?.aufloesung ?? 1);
  const b = Math.round(z.canvas.clientWidth * dpr), h = Math.round(z.canvas.clientHeight * dpr);
  if (z.canvas.width !== b || z.canvas.height !== h) {
    z.canvas.width = b;
    z.canvas.height = h;
    neu();
  }
}

let vorher = performance.now();
function schleife(jetzt) {
  requestAnimationFrame(schleife);
  const dt = Math.min(0.1, (jetzt - vorher) / 1000);
  vorher = jetzt;
  if (!z.kamera || !z.szene) return;
  groesse();
  schritt(dt, jetzt); // Steuerung: Parallaxe gleitet, Rundblick dreht sich …
  fahrtSchritt(jetzt); // Kamerafahrt zu einem Gegenstand
  if (!z.neu) return;
  z.neu = false;
  const k = aktiveKamera();
  k.rechne(z.canvas.width, z.canvas.height);
  // neu sortieren, wenn sich der Blick geändert hat und der Worker frei ist (sonst beim nächsten Bild)
  const a = k.ansicht;
  if (!sortiertGerade && (!letzteAnsicht || a.some((v, i) => Math.abs(v - letzteAnsicht[i]) > 1e-4))) {
    letzteAnsicht = a.slice();
    sortiertGerade = true;
    worker.postMessage({ ansicht: letzteAnsicht });
  } else if (sortiertGerade) neu(); // gleich noch einmal, mit der neuen Reihenfolge
  const h = z.hervor;
  // Werkzeuge zum Bearbeiten: Schnitt vor der Kamera, nur eine Kugel um die Auswahl, Röntgen
  const w = z.bearbeiten ? z.werkzeug : {}, mitte = z.gewaehlt?.lage ?? z.cursor;
  zeichner.zeichne(k, hexZuRgb(z.einst.hintergrund ?? "#111111"), h ? [...h.lage, h.radius] : null,
    z.einst.leuchten ?? 0, // Aufleuchten unter der Maus: aus; "leuchten": 0.3 in zimmer.json schaltet es wieder ein
    z.draufsicht ? schnitthoehe() : 1e9, {
      flaechen: flaechenZumZeichnen(k),
      nah: w.nah ?? 0,
      kugel: w.kugel && mitte ? [...mitte, w.kugel] : null,
      roentgen: w.roentgen ?? 1,
    });
  platziereDinge(k);
  zeichneGrundriss();
  zeichneGizmo();
}
requestAnimationFrame(schleife);

start()
  .then(() => {
    richteNeigungEin();
    richteLeisteEin();
  })
  .catch((fehler) => zeige(fehler.message));
