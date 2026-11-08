// Image Quilting: die Seite. Die Rechnung steht in quilting.js. Drei Arten:
//   groesser   aus einem Stück Textur (Foto) ein größeres Bild nähen
//   rechteck   in einem Foto Rechtecke aufziehen, sie werden nacheinander mit Stücken aus dem Rest des Fotos gefüllt
//   transfer   ein Zielbild aus dem Material eines anderen Fotos bauen (die Helligkeit folgt dem Ziel)

import { erstelleQuilt, helligkeit } from "./quilting.js";
import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const stapel = hole("stapel");
const ctx = canvas.getContext("2d");
const meldung = hole("meldung");
const status = hole("status");
const rahmen = hole("rechteck");

// ---------- Zufall mit Startwert (Video und Vorschau rechnen genau dasselbe noch einmal) ----------
let zs = 1;
function rnd() {
  zs = (zs + 0x6d2b79f5) | 0;
  let t = Math.imul(zs ^ (zs >>> 15), 1 | zs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let saat = 1;

let material = null; // Bitmap: die Textur (bei „rechteck“ das Foto selbst)
let ziel = null;     // Bitmap: das Zielbild beim Transfer
let rechtecke = []; // [{ x0, y0, x1, y1 }] in Anteilen des Bildes
let laeuft = true;
let exportLaeuft = false;
let lauf = null;     // was gerade genäht wird (siehe starte)

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    art: () => neuStarten(),
    naht: () => neuStarten(),
    durchgaenge: () => neuStarten(),
    naehteZeigen: () => zeichne(),
    block: () => spaeter(neuStarten),
    ueberlappung: () => spaeter(neuStarten),
    kandidaten: () => spaeter(neuStarten),
    toleranz: () => spaeter(neuStarten),
    arbeitsgroesse: () => spaeter(neuStarten),
    breite: () => spaeter(neuStarten),
    hoehe: () => spaeter(neuStarten),
    fotoGroesse: () => spaeter(neuStarten),
    zielGewicht: () => spaeter(neuStarten),
  },
});

let wartet = 0;
function spaeter(f) {
  clearTimeout(wartet);
  wartet = setTimeout(f, 350);
}
function melde(text) {
  meldung.hidden = !text;
  meldung.textContent = text ?? "";
}

// ein Bild auf höchstens „gross“ Pixel der längeren Seite bringen, als RGBA
function pixelVon(quelle, gross) {
  const f = Math.min(1, gross / Math.max(quelle.width, quelle.height));
  const b = Math.max(1, Math.round(quelle.width * f));
  const h = Math.max(1, Math.round(quelle.height * f));
  const c = new OffscreenCanvas(b, h);
  const k = c.getContext("2d");
  k.imageSmoothingQuality = "high";
  k.drawImage(quelle, 0, 0, b, h);
  return { b, h, rgba: k.getImageData(0, 0, b, h).data };
}

// ---------- Dateien ----------
hole("materialDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  material = await createImageBitmap(datei);
  rechtecke = [];
  neuStarten();
});
hole("zielDatei").addEventListener("change", async (event) => {
  const datei = event.target.files[0];
  if (!datei) return;
  ziel = await createImageBitmap(datei);
  neuStarten();
});

// ein eingebautes Material, damit die Seite nicht leer startet: Kreise und Striche, zufällig gezeichnet
// (einmal beim Laden, mit eigenem Zufall, damit es den Zufall der Läufe nicht verschiebt)
let beispiel = null;
function beispielMaterial() {
  return (beispiel ??= zeichneBeispiel());
}
function zeichneBeispiel() {
  const c = new OffscreenCanvas(220, 220);
  const k = c.getContext("2d");
  k.fillStyle = "#e9e1d0";
  k.fillRect(0, 0, 220, 220);
  const merk = zs;
  zs = 7;
  for (let i = 0; i < 70; i++) {
    const r = 4 + rnd() * 14;
    k.fillStyle = ["#1f2a44", "#c0392b", "#2e6b4f", "#d9a441"][i % 4];
    k.beginPath();
    k.arc(rnd() * 220, rnd() * 220, r, 0, Math.PI * 2);
    k.fill();
  }
  k.strokeStyle = "#1f2a44";
  k.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    k.beginPath();
    k.moveTo(rnd() * 220, rnd() * 220);
    k.lineTo(rnd() * 220, rnd() * 220);
    k.stroke();
  }
  zs = merk;
  return c;
}

// ---------- Anfangen ----------
function neuStarten() {
  melde("");
  if (e.art === "transfer" && !ziel) {
    lauf = null;
    status.textContent = "";
    melde("Für den Transfer: ein Material (Foto 1) und ein Ziel (Foto 2) öffnen.");
    return zeichne();
  }
  if (e.art === "rechteck" && !material) {
    lauf = null;
    status.textContent = "";
    melde("Erst ein Foto öffnen, dann darauf ein Rechteck ziehen.");
    return zeichne();
  }
  starte();
  groesse();
  zeichne();
}

// alles für einen Lauf vorbereiten; die Blöcke setzt erst die Schleife (oder das Video)
function starte() {
  zs = saat;
  const quelleBild = material ?? beispielMaterial();
  const B = e.block;
  const O = Math.max(1, Math.round((B * e.ueberlappung) / 100));
  const gemeinsam = { kandidaten: e.kandidaten, toleranz: e.toleranz, naht: e.naht, rnd };
  if (e.art === "groesser") {
    const quelle = pixelVon(quelleBild, e.arbeitsgroesse);
    if (quelle.b < B || quelle.h < B) return fehlt(quelle);
    const aus = { b: e.breite, h: e.hoehe, rgba: new Uint8ClampedArray(e.breite * e.hoehe * 4) };
    const bekannt = new Uint8Array(aus.b * aus.h);
    lauf = { aus, bekannt, gesetzt: 0, durchgang: 0, durchgaenge: 1, wort: "Durchgang" };
    lauf.quilt = erstelleQuilt(quelle, aus, bekannt, { x0: 0, y0: 0, x1: aus.b, y1: aus.h }, null, { B, O, ...gemeinsam });
  } else if (e.art === "rechteck") {
    const foto = pixelVon(quelleBild, e.fotoGroesse);
    const aus = { b: foto.b, h: foto.h, rgba: new Uint8ClampedArray(foto.rgba) };
    lauf = { aus, gesetzt: 0, durchgang: 0, durchgaenge: rechtecke.length, foto, wort: "Rechteck" };
    if (!rechtecke.length) {
      status.textContent = "Auf dem Foto ein oder mehrere Rechtecke ziehen.";
      return;
    }
    // alle Rechtecke sind unbekannt und dürfen in keinem Stück vorkommen (sonst näht sich eins ins andere).
    // Gefüllt wird eins nach dem anderen; was schon gefüllt ist, gilt für die nächsten als bekannt (am Rand)
    const bekannt = new Uint8Array(foto.b * foto.h).fill(1);
    const verboten = new Uint8Array(foto.b * foto.h);
    const bereiche = rechtecke.map((q) => {
      const x0 = Math.floor(q.x0 * foto.b), y0 = Math.floor(q.y0 * foto.h);
      const x1 = Math.ceil(q.x1 * foto.b), y1 = Math.ceil(q.y1 * foto.h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          bekannt[x + y * foto.b] = 0;
          verboten[x + y * foto.b] = 1;
          const i = (x + y * foto.b) * 4;
          aus.rgba[i] = aus.rgba[i + 1] = aus.rgba[i + 2] = 0;
        }
      }
      return { x0, y0, x1, y1 };
    });
    lauf.bekannt = bekannt;
    lauf.naechster = () => {
      lauf.quilt = erstelleQuilt(foto, aus, bekannt, bereiche[lauf.durchgang], verboten, { B, O, ...gemeinsam });
    };
    lauf.naechster();
  } else {
    const quelle = pixelVon(quelleBild, e.arbeitsgroesse);
    const zielPixel = pixelVon(ziel, e.fotoGroesse);
    if (quelle.b < B || quelle.h < B) return fehlt(quelle);
    const aus = { b: zielPixel.b, h: zielPixel.h, rgba: new Uint8ClampedArray(zielPixel.b * zielPixel.h * 4) };
    lauf = {
      aus, gesetzt: 0, durchgang: 0, durchgaenge: Number(e.durchgaenge), quelle, B, O, gemeinsam, wort: "Durchgang",
      naechster: () => naechsterDurchgang(),
      helle: { quelle: helligkeit(quelle.rgba, quelle.b * quelle.h), aus: helligkeit(zielPixel.rgba, zielPixel.b * zielPixel.h) },
    };
    naechsterDurchgang();
  }
}

function fehlt(quelle) {
  lauf = null;
  melde(`Die Blöcke (${e.block} Pixel) sind größer als das Material (${quelle.b} × ${quelle.h}). Kleinere Blöcke oder größere Arbeitsgröße.`);
}

// Transfer: jeder Durchgang mit kleineren Blöcken (· 2/3) und mehr Gewicht auf die Nähte. α ist, wie viel die
// Nähte zählen, 1 − α das Ziel. Erster Durchgang: α = 1 − Ziel-Gewicht, dann steigt es bis 1 − Ziel-Gewicht / 3
// (bei Efros und Freeman von 0,1 bis 0,9). Ab dem zweiten Durchgang zählt auch das Ergebnis davor.
function naechsterDurchgang() {
  const i = lauf.durchgang;
  const n = lauf.durchgaenge;
  const B = Math.max(6, Math.round(lauf.B * (2 / 3) ** i));
  const O = Math.max(1, Math.round((B * e.ueberlappung) / 100));
  const w = e.zielGewicht;
  const alpha = n > 1 ? 1 - w + ((w * 2) / 3) * (i / (n - 1)) : 1 - w;
  const vorher = i > 0 ? new Uint8ClampedArray(lauf.aus.rgba) : null;
  lauf.bekannt = new Uint8Array(lauf.aus.b * lauf.aus.h);
  lauf.quilt = erstelleQuilt(lauf.quelle, lauf.aus, lauf.bekannt, { x0: 0, y0: 0, x1: lauf.aus.b, y1: lauf.aus.h }, null, {
    B, O, ...lauf.gemeinsam, ziel: lauf.helle, alpha, vorher,
  });
}

// ---------- Rechnen ----------
// bis zu „anzahl“ Blöcke setzen (höchstens „ms“ Millisekunden)
function rechne(anzahl, ms = Infinity) {
  if (!lauf?.quilt) return;
  const ende = performance.now() + ms;
  for (let i = 0; i < anzahl; i++) {
    if (lauf.quilt.fertig) {
      if (lauf.durchgang + 1 < lauf.durchgaenge) {
        lauf.durchgang++;
        lauf.naechster(); // Transfer: nächster Durchgang, Rechtecke: nächstes Rechteck
      } else return;
    }
    lauf.quilt.weiter();
    lauf.gesetzt++;
    if (performance.now() > ende) return;
  }
}
const fertig = () => !lauf?.quilt || (lauf.quilt.fertig && lauf.durchgang + 1 >= lauf.durchgaenge);

// ---------- Größe und Zeichnen ----------
function groesse() {
  if (!lauf) return;
  if (canvas.width !== lauf.aus.b || canvas.height !== lauf.aus.h) {
    canvas.width = lauf.aus.b;
    canvas.height = lauf.aus.h;
  }
  stapel.style.setProperty("--format", lauf.aus.b / lauf.aus.h);
  zeigeRahmen();
}

function zeichne() {
  if (!lauf) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const bild = new ImageData(new Uint8ClampedArray(lauf.aus.rgba), lauf.aus.b, lauf.aus.h);
  // noch leere Pixel schwarz (beim Vergrößern und Transfer ist Alpha dort 0)
  const d = bild.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  if (e.naehteZeigen && lauf.quilt) {
    for (const i of lauf.quilt.naehte) {
      d[i * 4] = 255;
      d[i * 4 + 1] = 40;
      d[i * 4 + 2] = 40;
    }
  }
  ctx.putImageData(bild, 0, 0);
}

function zeigeStatus() {
  if (!lauf?.quilt) return;
  const teile = [`${Math.round(lauf.quilt.fortschritt * 100)} % von ${lauf.quilt.anzahl} Blöcken`];
  if (lauf.durchgaenge > 1) teile.unshift(`${lauf.wort} ${lauf.durchgang + 1} von ${lauf.durchgaenge}`);
  if (fertig()) teile.push("fertig");
  status.textContent = teile.join(" · ");
}

// ---------- Rechteck ziehen ----------
let zieht = null;
const stelle = (event) => {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)),
  };
};
// die gemerkten Rechtecke als gestrichelte Rahmen über dem Bild (eigene Elemente, nicht im Export), dazu das, was
// gerade gezogen wird
const rahmenBox = rahmen.parentElement;
function zeigeRahmen(gezogen = null) {
  rahmenBox.querySelectorAll(".quilt-rechteck.gemerkt").forEach((el) => el.remove());
  const setze = (el, q) => {
    el.style.left = `${q.x0 * 100}%`;
    el.style.top = `${q.y0 * 100}%`;
    el.style.width = `${(q.x1 - q.x0) * 100}%`;
    el.style.height = `${(q.y1 - q.y0) * 100}%`;
  };
  if (e.art === "rechteck") {
    for (const q of rechtecke) {
      const el = document.createElement("div");
      el.className = "quilt-rechteck gemerkt";
      setze(el, q);
      rahmenBox.append(el);
    }
  }
  rahmen.hidden = !gezogen;
  if (gezogen) setze(rahmen, gezogen);
}
const ordne = (a, b) => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
stapel.addEventListener("pointerdown", (event) => {
  if (e.art !== "rechteck" || !material) return;
  stapel.setPointerCapture?.(event.pointerId);
  zieht = stelle(event);
  zeigeRahmen(ordne(zieht, zieht));
});
stapel.addEventListener("pointermove", (event) => {
  if (zieht) zeigeRahmen(ordne(zieht, stelle(event)));
});
stapel.addEventListener("pointerup", (event) => {
  if (!zieht) return;
  const q = ordne(zieht, stelle(event));
  zieht = null;
  if (q.x1 - q.x0 < 0.01 || q.y1 - q.y0 < 0.01) return zeigeRahmen();
  rechtecke.push(q);
  zeigeRahmen();
  neuStarten();
});
stapel.addEventListener("pointercancel", () => {
  zieht = null;
  zeigeRahmen();
});
hole("rechteckZurueck").addEventListener("click", () => {
  rechtecke.pop();
  neuStarten();
});
hole("rechteckeLeeren").addEventListener("click", () => {
  rechtecke = [];
  neuStarten();
});

// ---------- Knöpfe ----------
hole("neuWuerfeln").addEventListener("click", () => {
  saat++;
  neuStarten();
});
const pauseKnopf = hole("pause");
pauseKnopf.addEventListener("click", () => {
  laeuft = !laeuft;
  pauseKnopf.textContent = laeuft ? "Pause" : "Weiter";
});
hole("sofort").addEventListener("click", () => {
  const weiter = () => {
    rechne(Infinity, 150);
    zeichne();
    zeigeStatus();
    if (!fertig()) setTimeout(weiter, 0);
  };
  weiter();
});

// ---------- Schleife ----------
function schleife() {
  if (!exportLaeuft && laeuft && lauf?.quilt && !fertig()) {
    rechne(e.tempo, 30);
    zeichne();
    zeigeStatus();
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
// Video: von vorn, jedes Bild setzt „tempo“ Blöcke (derselbe Zufall, also dasselbe Ergebnis wie vorher)
const render = {
  start() {
    exportLaeuft = true;
    if (lauf) starte();
  },
  bild() {
    rechne(e.tempo);
    zeichne();
  },
  ende() {
    exportLaeuft = false;
    zeigeStatus();
  },
  merke() {
    const gesetzt = lauf?.gesetzt ?? 0;
    return () => {
      if (!lauf) return;
      starte();
      rechne(gesetzt);
      zeichne();
    };
  },
  vorschau(i) {
    rechne(e.tempo * i);
    zeichne();
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: () => `quilting-${e.art}`,
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
});

neuStarten();
requestAnimationFrame(schleife);
