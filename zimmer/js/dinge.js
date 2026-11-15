// Die Gegenstände: jeder ist ein unsichtbarer Kreis über dem Bild, ein echter Link (Tab, Enter, Rechtsklick und
// Strg+Klick gehen wie bei jedem Link), so groß, wie seine Kugel gerade auf dem Bildschirm erscheint. Unter der Maus
// leuchtet er im Bild auf (zeichnen.js).
//
// Kamerafahrt: ein einfacher Klick führt nicht sofort weg. Erst dreht oder fährt die Kamera zum Gegenstand und das
// Bild blendet ab, dann öffnet sich die Seite. Bewegt wird mit „ease in out“ (langsam los, schnell, langsam an):
//   e(t) = t < ½ ? 4t³ : 1 − (−2t + 2)³ / 2
// Wer im System „weniger Bewegung“ eingestellt hat, bekommt keine Fahrt, nur den Link.

import { z, neu, art, aktiveKamera } from "./zustand.js";

const blende = document.getElementById("blende");
const wenigBewegung = matchMedia("(prefers-reduced-motion: reduce)");
let fahrt = null;

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
      if (z.hervor === ding) z.hervor = null;
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
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button !== 0 || wenigBewegung.matches) return;
      ev.preventDefault();
      starteFahrt(ding);
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
  }
}

// ---------- Kamerafahrt ----------
const DAUER = 900; // ms
const sanft = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function starteFahrt(ding) {
  const k = aktiveKamera();
  const vorher = { ziel: [...k.ziel], gier: k.gier, nick: k.nick, abstand: k.abstand, sichtfeld: k.sichtfeld, extraGier: k.extraGier, extraNick: k.extraNick };
  let nachher;
  if (art() === "rundblick") {
    // stehen bleiben, hindrehen und heranzoomen (das Sichtfeld enger, bis der Gegenstand gut die Hälfte füllt)
    const r = k.richtungZu(ding.lage);
    let gier = r.gier;
    while (gier - k.gier > Math.PI) gier -= 2 * Math.PI; // den kürzeren Weg herum
    while (gier - k.gier < -Math.PI) gier += 2 * Math.PI;
    const eng = (2 * Math.atan(ding.radius / 0.55 / r.abstand) * 180) / Math.PI;
    nachher = { ...vorher, gier, nick: r.nick, extraGier: 0, extraNick: 0, sichtfeld: Math.max(12, Math.min(k.sichtfeld, eng)) };
  } else {
    // hinfahren: das Ziel auf den Gegenstand, nah heran
    nachher = { ...vorher, ziel: [...ding.lage], abstand: Math.max(0.3, ding.radius * 3), extraGier: 0, extraNick: 0 };
  }
  fahrt = { k, vorher, nachher, start: performance.now(), link: ding.link, ding };
  z.hervor = ding;
  neu();
}

// in jedem Bild aus main.js: Kamera zwischen vorher und nachher, gegen Ende abblenden, dann zur Seite
export function fahrtSchritt(jetzt) {
  if (!fahrt) return;
  const t = Math.min(1, (jetzt - fahrt.start) / DAUER);
  const e = sanft(t);
  const { k, vorher: a, nachher: b } = fahrt;
  const misch = (x, y) => x + (y - x) * e;
  k.ziel = a.ziel.map((v, i) => misch(v, b.ziel[i]));
  for (const n of ["gier", "nick", "abstand", "sichtfeld", "extraGier", "extraNick"]) k[n] = misch(a[n], b[n]);
  if (t > 0.6) blende.classList.add("an");
  neu();
  if (t >= 1 && !fahrt.weg) {
    fahrt.weg = true;
    location.href = fahrt.link;
  }
}

// Zurück-Knopf: der Browser zeigt die Seite oft aus dem Speicher, genau wie sie war (abgeblendet, nah dran).
// Dann alles zurück auf vorher.
window.addEventListener("pageshow", () => {
  if (!fahrt) return;
  Object.assign(fahrt.k, { ...fahrt.vorher, ziel: [...fahrt.vorher.ziel] });
  fahrt = null;
  blende.classList.remove("an");
  neu();
});

export const fahrtLaeuft = () => !!fahrt;
