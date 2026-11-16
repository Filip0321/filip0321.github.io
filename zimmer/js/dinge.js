// Die Gegenstände: jeder ist ein unsichtbarer Kreis über dem Bild, ein echter Link (Tab, Enter, Rechtsklick und
// Strg+Klick gehen wie bei jedem Link), so groß, wie seine Kugel gerade auf dem Bildschirm erscheint. Unter der Maus
// leuchtet er im Bild auf (zeichnen.js).
//
// Ein Gegenstand ohne Text: Klick → Kamerafahrt hin, abblenden, Seite öffnen.
// Ein Gegenstand mit Text: erster Klick → „Zeigen“: die Kamera fliegt zum Gegenstand und kreist um ihn (oder
//   schwenkt in einem Bogen hin und her), daneben steht der Text. Zweiter Klick auf den Gegenstand (oder „öffnen“)
//   → Seite. Klick daneben, Esc oder „zurück“ → zurück zum Blick davor.
//
// Fliegen heißt hier: die fünf Zahlen der Kamera (Ziel, Abstand, Gier, Nick, Sichtfeld) gleiten vom Anfang zum Ziel,
// mit „ease in out“ (langsam los, schnell, langsam an):  e(t) = t < ½ ? 4t³ : 1 − (−2t + 2)³ / 2
// Das geht auch vom Rundblick aus: dort ist der Abstand 0 und das Ziel das Auge. Wächst der Abstand, rückt das Auge
// vom Ziel weg, und das Ziel wandert zum Gegenstand: die Kamera tritt aus dem Mittelpunkt heraus und fliegt hin.
//
// Kreisen um die ganze Rückseite zeigt, was der Scan nie gesehen hat (dort ist der Scan leer oder verschmiert).
// Darum schwenkt die Kamera standardmäßig nur in einem Bogen (bogen, Grad; 360 oder mehr: ganz herum).
// Wer im System „weniger Bewegung“ eingestellt hat, bekommt keine Fahrt und kein Kreisen, nur Text und Link.

import { z, neu, art, aktiveKamera } from "./zustand.js";
import { erstelleKamera } from "./kamera.js";

const blende = document.getElementById("blende");
const tafel = document.getElementById("erklaerung");
const wenigBewegung = matchMedia("(prefers-reduced-motion: reduce)");
let fahrt = null; // { k, vorher, nachher, start, dauer, danach }
let gezeigt = null; // { ding, mitteGier, start, vorher (Kamera, zu der es zurückgeht) }

export function baueDinge() {
  z.ebene.replaceChildren();
  z.dinge = (z.einst.dinge ?? []).map((d) => {
    const a = document.createElement("a");
    a.className = "zimmer-ding";
    a.href = d.link;
    a.append(document.createElement("span"));
    a.firstChild.textContent = d.name;
    const ding = { ...d, element: a };
    const an = () => {
      z.hervor = ding;
      neu();
    };
    const aus = () => {
      if (z.hervor === ding && gezeigt?.ding !== ding) z.hervor = null;
      neu();
    };
    a.addEventListener("pointerenter", an);
    a.addEventListener("pointerleave", aus);
    a.addEventListener("focus", an);
    a.addEventListener("blur", aus);
    a.addEventListener("click", (ev) => {
      if (z.bearbeiten) {
        // im Bearbeiten-Modus wählt ein Klick den Gegenstand aus, statt wegzuführen
        ev.preventDefault();
        z.waehle?.(ding);
        return;
      }
      // Strg, Umschalt, Mittelklick …: wie ein normaler Link (neuer Tab, neues Fenster)
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      ev.preventDefault();
      if (fahrt) return;
      if (ding.text && gezeigt?.ding !== ding) zeigeDing(ding);
      else oeffne(ding);
    });
    z.ebene.append(a);
    return ding;
  });
  z.ebene.classList.toggle("immer", z.einst.beschriftung === "immer");
  z.zeigeListe?.();
}

export function platziereDinge(k) {
  const faktor = z.canvas.clientWidth / z.canvas.width; // CSS-Pixel pro Bildpixel
  const w = z.canvas.width, h = z.canvas.height;
  for (const d of z.dinge) {
    const p = k.aufBildschirm(d.lage, w, h);
    if (!p || fahrt) {
      d.element.hidden = true;
      continue;
    }
    const r = Math.max(14, ((d.radius * k.fokus) / p.tiefe) * faktor);
    d.element.hidden = p.x * faktor < -r || p.x * faktor > w * faktor + r || p.y * faktor < -r || p.y * faktor > h * faktor + r;
    d.element.style.transform = `translate(${p.x * faktor - r}px, ${p.y * faktor - r}px)`;
    d.element.style.width = d.element.style.height = `${2 * r}px`;
    d.element.classList.toggle("gewaehlt", d === z.gewaehlt);
    d.element.classList.toggle("gezeigt", d === gezeigt?.ding);
  }
  platziereTafel(k);
}

// Die Tafel steht neben dem Gegenstand, oben auf seiner Höhe, auf der Seite mit mehr Platz. Passt sie dort nicht hin
// (Handy hochkant), liegt sie unten über die ganze Breite (so steht es in zimmer.css).
const ABSTAND = 16; // CSS-Pixel zwischen Gegenstand und Tafel und zum Rand
function platziereTafel(k) {
  if (!gezeigt || tafel.hidden) return;
  const faktor = z.canvas.clientWidth / z.canvas.width;
  const p = k.aufBildschirm(gezeigt.ding.lage, z.canvas.width, z.canvas.height);
  const B = z.canvas.clientWidth, H = z.canvas.clientHeight;
  const breite = Math.min(416, B - 2 * ABSTAND); // 26rem
  const unten = () => {
    tafel.classList.remove("seitlich");
    tafel.style.left = tafel.style.top = tafel.style.width = "";
  };
  if (!p) return unten();
  const x = p.x * faktor, y = p.y * faktor;
  const r = Math.min(((gezeigt.ding.radius * k.fokus) / p.tiefe) * faktor, Math.min(B, H) / 2);
  const rechts = B - (x + r), links = x - r;
  const seite = rechts >= links ? "rechts" : "links";
  if (Math.max(rechts, links) < breite + 2 * ABSTAND) return unten();
  tafel.classList.add("seitlich");
  const hoehe = tafel.offsetHeight;
  tafel.style.left = `${seite === "rechts" ? x + r + ABSTAND : x - r - ABSTAND - breite}px`;
  tafel.style.top = `${Math.max(ABSTAND, Math.min(H - hoehe - ABSTAND, y - r))}px`; // oben bündig mit dem Gegenstand
  tafel.style.width = `${breite}px`;
}

// ---------- Kamera: Zahlen lesen, schreiben, mischen ----------
const sanft = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function zustandVon(k) {
  return { ziel: [...k.ziel], gier: k.gier + k.extraGier, nick: k.nick + k.extraNick, abstand: k.abstand, sichtfeld: k.sichtfeld, versatzX: k.versatzX, versatzY: k.versatzY };
}

function fliege(k, nachher, dauer, danach) {
  const vorher = zustandVon(k);
  k.extraGier = k.extraNick = 0;
  // Gier auf dem kürzeren Weg herum
  let g = nachher.gier;
  while (g - vorher.gier > Math.PI) g -= 2 * Math.PI;
  while (g - vorher.gier < -Math.PI) g += 2 * Math.PI;
  fahrt = { k, vorher, nachher: { ...nachher, gier: g }, start: performance.now(), dauer: wenigBewegung.matches ? 1 : dauer, danach };
  neu();
}

// in jedem Bild aus main.js: laufende Fahrt weiter, sonst beim Zeigen kreisen
export function fahrtSchritt(jetzt) {
  if (fahrt) {
    const t = Math.min(1, (jetzt - fahrt.start) / fahrt.dauer);
    const e = sanft(t);
    const { k, vorher: a, nachher: b } = fahrt;
    const misch = (x, y) => x + (y - x) * e;
    k.ziel = a.ziel.map((v, i) => misch(v, b.ziel[i]));
    for (const n of ["gier", "nick", "abstand", "sichtfeld", "versatzX", "versatzY"]) k[n] = misch(a[n], b[n]);
    neu();
    if (t >= 1) {
      const danach = fahrt.danach;
      fahrt = null;
      danach?.();
    }
    return;
  }
  if (gezeigt && !wenigBewegung.matches && jetzt > gezeigt.ruheBis) {
    // kreisen: im Bogen hin und her (Sinus: an den Enden langsam), ab 360° einfach weiter
    const bogen = ((gezeigt.ding.bogen ?? 50) * Math.PI) / 180;
    const t = (jetzt - gezeigt.start) / 1000;
    if (bogen >= 2 * Math.PI - 1e-6) z.zeig.gier = gezeigt.mitteGier + t * 0.25;
    else {
      const periode = Math.max(6, (bogen * 180) / Math.PI / 5); // Sekunden für einmal hin und zurück (50° → 10 s)
      z.zeig.gier = gezeigt.mitteGier + (bogen / 2) * Math.sin((2 * Math.PI * t) / periode);
    }
    neu();
  }
}

// ---------- Zeigen ----------
function zeigeDing(ding) {
  const von = aktiveKamera();
  const vorher = gezeigt ? gezeigt.vorher : { kamera: von, zustand: zustandVon(von) };
  // von der Seite, auf der man gerade steht: Richtung vom Gegenstand zum Auge
  von.rechne(z.canvas.width, z.canvas.height);
  const d = [0, 1, 2].map((i) => von.auge[i] - ding.lage[i]);
  const l = Math.hypot(...d) || 1;
  const gier = Math.atan2(d[0], d[2]);
  const nick = Math.max(-0.3, Math.min(0.7, Math.asin(d[1] / l) + 0.15)); // etwas von oben
  // die Zeig-Kamera fängt genau da an, wo die bisherige Kamera steht, und fliegt dann zum Gegenstand
  const s = zustandVon(von);
  z.zeig = erstelleKamera({ ziel: s.ziel, gier: s.gier, nick: s.nick, abstand: s.abstand, sichtfeld: s.sichtfeld });
  Object.assign(z.zeig, { versatzX: s.versatzX, versatzY: s.versatzY });
  const abstand = Math.max(0.35, ding.radius * (ding.nah ?? 3.2));
  gezeigt = { ding, mitteGier: gier, start: Infinity, ruheBis: 0, vorher };
  z.hervor = ding;
  // Platz für die Tafel: breit genug (zwei Spalten) → Gegenstand nach links, Tafel rechts daneben;
  // sonst (hochkant) → Gegenstand nach oben, Tafel unten
  const breit = z.canvas.clientWidth >= 2 * 416 + 64;
  const versatz = breit ? { versatzX: -0.38, versatzY: 0 } : { versatzX: 0, versatzY: 0.3 };
  fliege(z.zeig, { ziel: [...ding.lage], gier, nick, abstand, sichtfeld: 50, ...versatz }, 1200, () => {
    gezeigt.start = performance.now();
  });
  zeigeTafel(ding);
}

function zeigeTafel(ding) {
  document.body.classList.add("zeigt"); // blendet z. B. den Knopf „Neigung“ aus
  tafel.querySelector("h2").textContent = ding.name;
  tafel.querySelector("p").textContent = ding.text || "(Noch kein Text: so lange führt ein Klick gleich zum Link.)";
  const link = tafel.querySelector("a");
  link.href = ding.link;
  tafel.hidden = false;
  // erst nach dem Neuzeichnen einblenden, sonst springt die Übergangs-Animation nicht an
  requestAnimationFrame(() => tafel.classList.add("an"));
}

export function zeigenBeenden() {
  if (!gezeigt || fahrt) return;
  const { kamera, zustand } = gezeigt.vorher;
  tafel.classList.remove("an");
  document.body.classList.remove("zeigt");
  setTimeout(() => {
    if (!tafel.classList.contains("an")) tafel.hidden = true; // erst nach dem Ausblenden ganz weg
  }, 300);
  const ding = gezeigt.ding;
  gezeigt = null;
  if (z.hervor === ding) z.hervor = null;
  fliege(z.zeig, zustand, 1000, () => {
    z.zeig = null;
    // in „gier“ steckt das Ausweichen der Parallaxe schon drin: darum das Ausweichen auf 0
    Object.assign(kamera, { ...zustand, ziel: [...zustand.ziel], extraGier: 0, extraNick: 0 });
    neu();
  });
}
export const zeigtGerade = () => !!gezeigt;

// Bearbeiten: „Zeigen vorführen“ (auch ohne Text), und Änderungen an Text, Bogen, Abstand gleich sehen
z.vorfuehren = (ding) => {
  if (!ding || fahrt) return;
  zeigeDing(ding);
};
z.vorfuehrungAktualisieren = () => {
  if (!gezeigt || fahrt) return;
  const d = gezeigt.ding;
  zeigeTafel(d);
  z.zeig.abstand = Math.max(0.35, d.radius * (d.nah ?? 3.2));
  neu();
};

// beim Zeigen: der Nutzer dreht selbst; das Kreisen setzt ein paar Sekunden aus und macht dann von dort weiter
export function zeigenAngefasst() {
  if (!gezeigt) return;
  gezeigt.ruheBis = performance.now() + 4000;
  gezeigt.mitteGier = z.zeig.gier;
  gezeigt.start = performance.now() + 4000;
}

// ---------- Öffnen: hinfahren (oder vom Zeigen aus näher heran), abblenden, Seite ----------
function oeffne(ding) {
  const k = aktiveKamera();
  const s = zustandVon(k);
  let nachher;
  if (gezeigt) {
    nachher = { ...s, abstand: Math.max(0.15, s.abstand * 0.45) };
  } else if (art() === "rundblick") {
    // stehen bleiben, hindrehen und heranzoomen (das Sichtfeld enger, bis der Gegenstand gut die Hälfte füllt)
    const r = k.richtungZu(ding.lage);
    const eng = (2 * Math.atan(ding.radius / 0.55 / r.abstand) * 180) / Math.PI;
    nachher = { ...s, gier: r.gier, nick: r.nick, sichtfeld: Math.max(12, Math.min(k.sichtfeld, eng)) };
  } else {
    nachher = { ...s, ziel: [...ding.lage], abstand: Math.max(0.3, ding.radius * 3) };
  }
  z.hervor = ding;
  setTimeout(() => blende.classList.add("an"), wenigBewegung.matches ? 0 : 500);
  fliege(k, nachher, 900, () => (location.href = ding.link));
  rueckweg = { k, zustand: s };
}

// Zurück-Knopf: der Browser zeigt die Seite oft aus dem Speicher, genau wie sie war (abgeblendet, nah dran).
// Dann alles zurück auf vorher.
let rueckweg = null;
window.addEventListener("pageshow", (ev) => {
  if (!ev.persisted || !rueckweg) return;
  fahrt = null;
  Object.assign(rueckweg.k, { ...rueckweg.zustand, ziel: [...rueckweg.zustand.ziel] });
  rueckweg = null;
  blende.classList.remove("an");
  neu();
});

export const fahrtLaeuft = () => !!fahrt;

// Tafel: „zurück“ und Esc
tafel.querySelector("button").addEventListener("click", zeigenBeenden);
tafel.querySelector("a").addEventListener("click", (ev) => {
  if (z.bearbeiten) {
    // beim Vorführen nicht wegspringen
    ev.preventDefault();
    z.zeigeMeldung?.("Im Bearbeiten-Modus öffnet sich der Link nicht. Ohne ?bearbeiten führt das hier zur Seite.", 3000);
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0 || !gezeigt) return;
  ev.preventDefault();
  oeffne(gezeigt.ding);
});
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") zeigenBeenden();
});
