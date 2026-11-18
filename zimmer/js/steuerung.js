// Steuerung: Maus, Finger, Mausrad und die Lage des Handys bewegen die Kamera, je nach Blickart.
//
//   parallax   Maus oder Kippen schiebt den Blick ein wenig zur Seite (gleitet nach, sonst zuckt es)
//   rundblick  ziehen dreht den Blick („anfassen und wegschieben“: nach rechts ziehen dreht nach links), Mausrad
//              zoomt über das Sichtfeld; am Handy dreht man sich mit dem Handy selbst.
//              Rührt sich eine Weile niemand, dreht sich der Blick langsam von allein (rundblick.drehen, Grad/s).
//   frei       ziehen dreht um das Ziel, Umschalt oder rechte Maustaste verschiebt, Mausrad: näher, weiter
//   begehen    wie Rundblick, aber man kann herumgehen: am Rechner W A S D oder Pfeiltasten (Q und E oder Bild ↓ ↑:
//              tiefer und höher, Umschalt schneller; Standard von 5 cm bis 4 m über dem Boden, in zimmer.json
//              einstellbar: "hoehe": [unten, oben] in Metern über dem Boden), überall ein Klick auf den
//              Boden (am Handy: Tippen) geht dorthin. Nur innerhalb des Grundrisses, und nicht durch Flächen hindurch
//              (auch unsichtbare Hilfsflächen, die man im Bearbeiten-Modus als Wände oder um Möbel setzt)
//   Bearbeiten (eigene Kamera, wie in Blender): links ziehen kreist, Mitte oder Umschalt+links verschiebt, Rad zoomt,
//              rechts gedrückt halten: umsehen und mit W A S D (Q runter, E hoch, Umschalt schneller) fliegen.
//              Tasten 1, 3, 7: genau von vorn, rechts, oben (mit Strg von der Gegenseite), orthografisch;
//              5: orthografisch an und aus; F: auf die Auswahl (oder den 3D-Cursor) schauen
//   Draufsicht ziehen verschiebt, Mausrad zoomt; Klicks gehen an den Grundriss (grundriss.js)
//   Zeigen     (ein Gegenstand ist offen, dinge.js) beim Kreisen: ziehen kreist um ihn; beim Stehen: Maus und
//              Neigung schieben den Blick wie bei der Parallaxe; ein Klick daneben schließt
//
// Zoomen: Mausrad oder zwei Finger (kneifen). Je nach Blickart ändert das den Abstand (frei, Zeigen, Draufsicht)
// oder das Sichtfeld (Rundblick und Parallaxe: dort steht die Kamera fest). Beim Kneifen zählt das Verhältnis der
// Fingerabstände: Abstand am Anfang / Abstand jetzt, mal dem Wert am Anfang. Finger auseinander = näher heran.
//
// Winkel: die Kamera schaut entgegen „vorn“ = (sin g · cos n, sin n, cos g · cos n). Größere Gier dreht den Blick
// nach links, größerer Nick nach unten.
//
// ---------- Die Lage des Handys ----------
// Der Browser meldet drei Winkel (deviceorientation): alpha um die senkrechte Achse, beta vor und zurück, gamma zur
// Seite. Zusammen beschreiben sie eine Drehung R = Rz(alpha) · Rx(beta) · Ry(gamma) von den Achsen des Handys
// (x rechts, y oben am Bildschirm, z aus dem Bildschirm heraus) zu den Achsen der Erde (x Osten, y Norden, z oben).
// Einzeln sind die Winkel unbrauchbar, sobald das Handy aufrecht steht (beta nahe 90°): dort können alpha und gamma
// gleichzeitig um 180° springen, ohne dass sich das Handy bewegt hat („Gimbal Lock“: zwei Drehachsen fallen
// zusammen). Genau das war das Umklappen bei 180°.
// Die Drehung als Ganzes springt aber nie. Darum wird aus allen drei Winkeln die Richtung gerechnet, in die die
// Kamera hinten aus dem Handy schaut, f = R · (0, 0, −1):
//   f = (−cos α · sin γ − sin α · sin β · cos γ,  −sin α · sin γ + cos α · sin β · cos γ,  −cos β · cos γ)
// Daraus Himmelsrichtung h = atan2(fx, fy) und Höhe p = asin(fz). Weitergegeben wird nur, wie sich beide seit der
// letzten Meldung geändert haben; so lässt sich das Kippen mit Ziehen mischen.
// Nur fast senkrecht nach oben oder unten ist die Himmelsrichtung unbestimmt; dort wird sie nicht verändert.

import { z, neu, art, aktiveKamera, editorKamera, bildpunkt, zeige } from "./zustand.js";
import { fahrtLaeuft, zeigtGerade, zeigenBeenden, zeigenAngefasst, zeigArt } from "./dinge.js";
import { innen, bodenHoehe } from "./grundriss.js";
import { schneidetFlaeche } from "./flaeche.js";
import { pickePunkt } from "./picken.js";

const parallaxZiel = { gier: 0, nick: 0 }; // wohin die Parallaxe ausweichen will
let ziehen = null;
const PAUSE = 6000; // ms ohne Eingabe, bis der Rundblick sich von allein dreht

function eingabe() {
  z.letzteEingabe = performance.now();
}

const c = z.canvas;

// ---------- Zoomen (Mausrad und zwei Finger) ----------
function zoomWert() {
  const k = aktiveKamera();
  if (z.draufsicht || z.zeig || art() === "frei") return { k, feld: "abstand", min: 0.05, max: 1000 };
  const rund = art() === "rundblick" || art() === "begehen";
  return { k, feld: "sichtfeld", min: rund ? 20 : 25, max: rund ? 110 : 100 };
}
function zoome(k, feld, wert, min, max) {
  k[feld] = Math.max(min, Math.min(max, wert));
  if (z.zeig) zeigenAngefasst();
  eingabe();
  neu();
}

// ---------- Regler am Rand (Handy): Zoom und Höhe ----------
// Der Zoom-Regler läuft von 0 (weit) bis 1 (nah). Beim Sichtfeld linear (max … min Grad), beim Abstand
// logarithmisch: von 30 m bis 5 cm wäre linear fast der ganze Weg im Fernen, und jede Verdopplung der Nähe soll
// gleich viel Regler kosten:  Abstand = fern · (nah / fern)^t
// Der Höhen-Regler (nur beim Herumgehen) setzt die Augenhöhe zwischen den Grenzen aus zimmer.json ("hoehe").
const zoomRegler = document.getElementById("zoom-regler");
const hoeheRegler = document.getElementById("hoehe-regler");
const hoeheFeld = document.getElementById("hoehe-feld");
const FERN = 30;
function zoomAusRegler(t) {
  const { k, feld, min, max } = zoomWert();
  const wert = feld === "abstand" ? Math.min(max, FERN) * (min / Math.min(max, FERN)) ** t : max + (min - max) * t;
  zoome(k, feld, wert, min, max);
}
function reglerAusZoom() {
  const { k, feld, min, max } = zoomWert();
  const fern = Math.min(max, FERN);
  return feld === "abstand" ? Math.log(fern / k[feld]) / Math.log(fern / min) : (max - k[feld]) / (max - min);
}
const hoeheGrenzen = () => {
  const boden = bodenHoehe(), [unten, oben] = z.einst.hoehe ?? [-2, 6];
  return [boden + unten, boden + oben];
};
zoomRegler?.addEventListener("input", () => zoomAusRegler(Number(zoomRegler.value)));
hoeheRegler?.addEventListener("input", () => {
  if (!z.rund) return;
  const [a, b] = hoeheGrenzen();
  z.rund.ziel[1] = a + (b - a) * Number(hoeheRegler.value);
  eingabe();
  neu();
});
// aus main.js nach jedem Bild: die Regler zeigen, was gerade gilt (nicht, während man an ihnen zieht)
export function zeigeRegler() {
  if (!zoomRegler || !matchMedia("(pointer: coarse)").matches) return;
  if (document.activeElement !== zoomRegler) zoomRegler.value = Math.max(0, Math.min(1, reglerAusZoom()));
  const gehen = art() === "begehen" && !z.zeig && !z.draufsicht && !!z.rund;
  hoeheFeld.hidden = !gehen;
  if (gehen && document.activeElement !== hoeheRegler) {
    const [a, b] = hoeheGrenzen();
    hoeheRegler.value = (z.rund.ziel[1] - a) / (b - a);
  }
}

// Die Finger werden auf der ganzen Bühne gezählt, nicht nur auf dem Canvas: am Handy liegen die Kreise der
// Gegenstände oft groß über dem Bild, und ein Finger darauf gehört sonst dem Link
const buehne = c.parentElement;
const finger = new Map(); // Finger auf dem Bild: id → { x, y }
let kneifen = null;
const fingerAbstand = () => {
  const [a, b] = [...finger.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
};
buehne.addEventListener("pointerdown", (ev) => {
  if (ev.pointerType === "mouse" || ev.target.closest("aside, section, button")) return; // nicht in Leiste und Tafel
  finger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (finger.size === 2 && z.kamera && !fahrtLaeuft()) {
    const zw = zoomWert();
    kneifen = { ...zw, start: zw.k[zw.feld], d0: fingerAbstand() };
    ziehen = null; // der erste Finger dreht nicht mehr
  }
}, { capture: true });
buehne.addEventListener("pointermove", (ev) => {
  if (!finger.has(ev.pointerId)) return;
  finger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (kneifen && finger.size >= 2) zoome(kneifen.k, kneifen.feld, (kneifen.start * kneifen.d0) / fingerAbstand(), kneifen.min, kneifen.max);
}, { capture: true });
for (const art_ of ["pointerup", "pointercancel"]) {
  buehne.addEventListener(art_, (ev) => {
    finger.delete(ev.pointerId);
    if (finger.size < 2) kneifen = null;
  }, { capture: true });
}

c.addEventListener("pointermove", (ev) => {
  if (!z.kamera || fahrtLaeuft() || kneifen) return;
  if (!z.draufsicht && ((!z.zeig && art() === "parallax") || zeigArt() === "stehen") && ev.pointerType === "mouse") {
    const r = c.getBoundingClientRect();
    const st = z.einst.parallax ?? 0.12;
    parallaxZiel.gier = -((ev.clientX - r.left) / r.width - 0.5) * 2 * st;
    parallaxZiel.nick = ((ev.clientY - r.top) / r.height - 0.5) * 2 * st * 0.6;
  }
  if (!ziehen) return;
  const dx = ev.clientX - ziehen.x, dy = ev.clientY - ziehen.y;
  ziehen.x = ev.clientX;
  ziehen.y = ev.clientY;
  ziehen.weg += Math.abs(dx) + Math.abs(dy);
  eingabe();
  const k = aktiveKamera();
  const skala = c.width / c.clientWidth; // Bildpixel pro CSS-Pixel
  if (ziehen.fliegen) {
    // umsehen: das Auge bleibt, die Blickrichtung dreht sich (das Ziel wandert um das Auge herum)
    k.rechne(c.width, c.height);
    const auge = [...k.auge];
    k.ortho = false;
    k.gier -= dx * 0.004;
    k.nick = Math.max(-1.5, Math.min(1.5, k.nick + dy * 0.004));
    const vorn = [Math.cos(k.nick) * Math.sin(k.gier), Math.sin(k.nick), Math.cos(k.nick) * Math.cos(k.gier)];
    k.ziel = auge.map((a, i) => a - vorn[i] * k.abstand);
  } else if (z.draufsicht || ziehen.schieben) {
    // verschieben: entlang der Bildschirmachsen der Kamera, so weit, dass der Punkt unter der Maus mitgeht
    const m = k.ansicht;
    const s = (k.ortho ? 1 / k.massstab : k.abstand / k.fokus) * skala;
    for (let i = 0; i < 3; i++) k.ziel[i] += -dx * s * m[4 * i] + dy * s * m[4 * i + 1];
  } else if (z.zeig ? zeigArt() === "kreisen" : art() === "frei") {
    k.gier -= dx * 0.005;
    k.nick = Math.max(-1.5, Math.min(1.5, k.nick + dy * 0.005));
    zeigenAngefasst();
  } else if (!z.zeig && (art() === "rundblick" || art() === "begehen")) {
    // so drehen, dass der Punkt unter dem Finger mitgeht: ein Pixel ist 1 / Brennweite Bogenmaß
    k.gier += (dx * skala) / k.fokus;
    k.nick = Math.max(-1.4, Math.min(1.4, k.nick - (dy * skala) / k.fokus));
  }
  neu();
});

c.addEventListener("pointerdown", (ev) => {
  if (!z.kamera || fahrtLaeuft() || kneifen) return;
  eingabe();
  if (z.abfangen?.(ev)) return; // Bearbeiten: Gegenstand setzen, Ecke setzen …
  if (!z.draufsicht && !z.zeig && art() === "parallax") return;
  c.setPointerCapture(ev.pointerId);
  // Bearbeiten: rechts = umsehen und fliegen, Mitte = verschieben; sonst (frei, Draufsicht) rechts = verschieben
  const ed = editorKamera() && !z.zeig && !z.draufsicht;
  ziehen = { x: ev.clientX, y: ev.clientY, weg: 0, fliegen: ed && ev.button === 2, schieben: ev.shiftKey || ev.button === 1 || (!ed && ev.button === 2) };
  z.fliegt = ziehen.fliegen; // dann gehören W A S D Q E dem Fliegen, nicht dem Gizmo
});
const loslassen = (ev) => {
  // kaum bewegt: das war ein Klick (die Draufsicht setzt dann eine Ecke, beim Zeigen geht es zurück)
  if (ziehen && ziehen.weg < 5) {
    if (z.draufsicht) z.klickOben?.(ev);
    else if (zeigtGerade()) zeigenBeenden();
    else if (art() === "begehen") gehZu(ev);
  }
  ziehen = null;
  z.fliegt = false;
};
c.addEventListener("pointerup", loslassen);
c.addEventListener("pointercancel", () => (ziehen = z.fliegt = null));
c.addEventListener("contextmenu", (ev) => (z.draufsicht || z.zeig || art() !== "parallax") && ev.preventDefault());

// ---------- Tasten: fliegen (Bearbeiten), gehen (begehen), Ansichten wie in Blender ----------
const gedrueckt = new Set();
const tippt = (ev) => ev.target.closest?.("input, textarea, select, [contenteditable]");
window.addEventListener("keydown", (ev) => {
  if (tippt(ev)) return;
  gedrueckt.add(ev.code);
  if (!editorKamera() || z.zeig || z.draufsicht || ev.defaultPrevented) return;
  const k = z.ed;
  // Ansichten: genau entlang einer Achse, orthografisch (Ziffern oben oder auf dem Ziffernblock)
  const ansicht = { Digit1: [0, 0], Numpad1: [0, 0], Digit3: [Math.PI / 2, 0], Numpad3: [Math.PI / 2, 0], Digit7: [0, Math.PI / 2], Numpad7: [0, Math.PI / 2] }[ev.code];
  if (ansicht) {
    const gegen = ev.ctrlKey || ev.metaKey;
    k.gier = ansicht[1] ? (gegen ? Math.PI : 0) : ansicht[0] + (gegen ? Math.PI : 0);
    k.nick = ansicht[1] ? (gegen ? -1 : 1) * ansicht[1] : 0;
    k.extraGier = k.extraNick = 0;
    k.ortho = true;
    const name = { 1: "vorn", 3: "rechts", 7: "oben" }[ev.code.slice(-1)];
    zeige(`Ansicht von ${gegen ? { vorn: "hinten", rechts: "links", oben: "unten" }[name] : name}, orthografisch. 5 schaltet zurück.`, 2500);
  } else if (ev.code === "Digit5" || ev.code === "Numpad5") {
    k.ortho = !k.ortho;
    if (!k.ortho) k.nick = Math.max(-1.5, Math.min(1.5, k.nick));
  } else if (ev.code === "KeyF" || ev.code === "NumpadDecimal") {
    const ziel = z.gewaehlt?.lage ?? z.cursor;
    if (!ziel) return;
    k.ziel = [...ziel];
    if (z.gewaehlt) k.abstand = Math.max(0.5, z.gewaehlt.radius * 4);
  } else return;
  ev.preventDefault();
  neu();
});
window.addEventListener("keyup", (ev) => gedrueckt.delete(ev.code));
window.addEventListener("blur", () => gedrueckt.clear());

// Richtung aus den gedrückten Tasten: (rechts, hoch, vorwärts), jeweils −1, 0 oder 1
function tastenRichtung() {
  const t = (...codes) => codes.some((c) => gedrueckt.has(c));
  return [
    (t("KeyD", "ArrowRight") ? 1 : 0) - (t("KeyA", "ArrowLeft") ? 1 : 0),
    (t("KeyE", "PageUp") ? 1 : 0) - (t("KeyQ", "PageDown") ? 1 : 0),
    (t("KeyW", "ArrowUp") ? 1 : 0) - (t("KeyS", "ArrowDown") ? 1 : 0),
  ];
}

// ---------- Herumgehen ----------
// Ein Schritt von a nach b ist erlaubt, wenn b im Grundriss liegt (falls es einen gibt) und die Strecke, etwas
// verlängert (ein halber Schritt Abstand zur Wand), keine Fläche durchstößt.
function darfGehen(a, b) {
  const gr = z.einst.grundriss;
  if ((gr?.punkte?.length ?? 0) >= 3 && !innen(b[0], b[2], gr.punkte)) return false;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1;
  const weiter = [0, 1, 2].map((i) => b[i] + (d[i] / l) * 0.25);
  return !z.dinge.some((ding) => ding.form === "flaeche" && (ding.punkte?.length ?? 0) >= 3 && schneidetFlaeche(a, weiter, ding.punkte));
}

let gang = null; // { von, nach, start, dauer }: Gehen zu einem angeklickten Punkt
// Klick ins Bild beim Herumgehen: wohin man geklickt hat, zeigt die Oberfläche unter der Maus (picken.js). Ist das der
// Boden, geht man genau dorthin; ist es eine Wand oder ein Möbel, bis einen halben Meter davor. Trifft man nichts,
// zählt die Bodenebene (dann aber höchstens 8 m weit).
function gehZu(ev) {
  const k = z.rund;
  if (!k || z.bearbeiten) return;
  const [px, py] = bildpunkt(ev);
  k.rechne(c.width, c.height);
  const { anfang, richtung } = k.strahl(px, py, c.width, c.height);
  const boden = bodenHoehe(), auge = k.ziel[1] - boden;
  let hin = pickePunkt(k, px, py, z.szene, c.width, c.height)?.punkt;
  if (!hin && richtung[1] < -0.05) {
    const t = (boden - anfang[1]) / richtung[1];
    hin = [anfang[0] + richtung[0] * t, boden, anfang[2] + richtung[2] * t];
  }
  if (!hin) return;
  // waagerechter Weg vom Auge zum Ziel; liegt das Ziel nicht am Boden, einen halben Meter davor anhalten
  let dx = hin[0] - k.ziel[0], dz = hin[2] - k.ziel[2];
  const weit = Math.hypot(dx, dz) || 1;
  const kuerzer = hin[1] - boden > 0.3 ? Math.max(0, weit - 0.5) / weit : 1;
  [dx, dz] = [dx * kuerzer, dz * kuerzer];
  const nach = [k.ziel[0] + dx, boden + auge, k.ziel[2] + dz];
  const strecke = Math.hypot(dx, dz);
  if (strecke < 0.05) return;
  if (strecke > 8 || !darfGehen(k.ziel, nach)) return zeige("Dorthin geht es nicht.", 1500);
  gang = { von: [...k.ziel], nach, start: performance.now(), dauer: Math.min(2500, 400 + strecke * 600) };
}

c.addEventListener("wheel", (ev) => {
  if (!z.kamera || fahrtLaeuft()) return;
  ev.preventDefault();
  const { k, feld, min, max } = zoomWert();
  zoome(k, feld, k[feld] * Math.exp(ev.deltaY * 0.001), min, max);
}, { passive: false });

// ---------- Handy-Lage (Theorie oben) ----------
const knopf = document.getElementById("neigung");
let neigungAn = false;
let letzte = null; // { h, p } der letzten Meldung
let start = null; // { h, p } beim Einschalten (für die Parallaxe)
let stehStart = null; // { h, p } beim Ankommen vor einem Gegenstand zum Betrachten (Parallaxe von dort aus)

function blickAusLage(alpha, beta, gamma) {
  const r = Math.PI / 180;
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(alpha * r), Math.sin(alpha * r), Math.cos(beta * r), Math.sin(beta * r), Math.cos(gamma * r), Math.sin(gamma * r)];
  const f = [-ca * sg - sa * sb * cg, -sa * sg + ca * sb * cg, -cb * cg];
  return { h: Math.atan2(f[0], f[1]), p: Math.asin(Math.max(-1, Math.min(1, f[2]))), steil: Math.abs(f[2]) > 0.95 };
}
const winkelDifferenz = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

window.addEventListener("deviceorientation", (ev) => {
  if (!neigungAn || ev.alpha == null || ev.beta == null || !z.kamera || z.draufsicht || fahrtLaeuft()) return;
  const jetzt = blickAusLage(ev.alpha, ev.beta, ev.gamma ?? 0);
  if (!letzte) {
    letzte = start = jetzt;
    return;
  }
  const dh = jetzt.steil || letzte.steil ? 0 : winkelDifferenz(jetzt.h, letzte.h);
  const dp = jetzt.p - letzte.p;
  if (!jetzt.steil) letzte = jetzt;
  else letzte = { ...letzte, p: jetzt.p };
  const stehen = zeigArt() === "stehen";
  if (!stehen) stehStart = null;
  if (z.zeig && !stehen) return;
  if (stehen || art() === "parallax") {
    // Ausweichen relativ zur Lage beim Einschalten (beim Stehen: beim Ankommen); ±25° drehen oder kippen = ganz
    const st = z.einst.parallax ?? 0.12;
    const k = (w) => Math.max(-1, Math.min(1, w / 0.44));
    const von = stehen ? (stehStart ??= letzte) : start;
    parallaxZiel.gier = k(-winkelDifferenz(letzte.h, von.h)) * st;
    parallaxZiel.nick = -k(letzte.p - von.p) * st * 0.6;
  } else if ((art() === "rundblick" || art() === "begehen") && z.rund) {
    // durchs Handy ins Zimmer schauen: nach links drehen (h wird kleiner) dreht den Blick nach links (Gier größer),
    // nach hinten kippen (p größer) schaut nach oben (Nick kleiner)
    z.rund.gier -= dh;
    z.rund.nick = Math.max(-1.4, Math.min(1.4, z.rund.nick - dp));
    eingabe();
    neu();
  }
});

// an und aus: der Knopf ist auch die Erlaubnis-Abfrage für iOS (die geht nur in einem echten Tippen, nur über HTTPS)
async function setzeNeigung(an) {
  if (an && typeof DeviceOrientationEvent?.requestPermission === "function") {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) !== "granted") an = false;
    } catch {
      an = false;
    }
  }
  neigungAn = an;
  letzte = start = null;
  if (!an) parallaxZiel.gier = parallaxZiel.nick = 0;
  knopf.textContent = "Neigung"; // an oder aus zeigt der Punkt davor (zimmer.css) und aria-pressed
  knopf.setAttribute("aria-pressed", String(an));
  try {
    localStorage.setItem("zimmer-neigung", an ? "an" : "aus");
  } catch {}
  neu();
}

// nur auf Geräten mit Lagesensor und Fingerbedienung zeigen
export function richteNeigungEin() {
  const handy = "DeviceOrientationEvent" in window && matchMedia("(pointer: coarse)").matches;
  knopf.hidden = !handy || z.einst.neigung === false;
  if (knopf.hidden) return;
  knopf.addEventListener("click", () => setzeNeigung(!neigungAn));
  let gespeichert = null;
  try {
    gespeichert = localStorage.getItem("zimmer-neigung");
  } catch {}
  // iOS: ohne Tippen keine Erlaubnis, darum startet es dort immer aus
  const brauchtErlaubnis = typeof DeviceOrientationEvent?.requestPermission === "function";
  setzeNeigung(!brauchtErlaubnis && (gespeichert ? gespeichert === "an" : true));
}

// ---------- in jedem Bild ----------
export function schritt(dt, jetzt) {
  // Fliegen im Bearbeiten-Modus (rechte Maustaste gedrückt)
  if (editorKamera() && ziehen?.fliegen && !z.zeig) {
    const [r, h, v] = tastenRichtung();
    if (r || h || v) {
      const k = z.ed, { rechts, vorwaerts } = k.achsen();
      const tempo = 1.5 * (gedrueckt.has("ShiftLeft") || gedrueckt.has("ShiftRight") ? 3 : 1) * dt;
      for (let i = 0; i < 3; i++) k.ziel[i] += (rechts[i] * r + vorwaerts[i] * v + (i === 1 ? h : 0)) * tempo;
      neu();
    }
  }
  // Herumgehen: angeklickten Punkt ansteuern, sonst Tasten
  if (art() === "begehen" && z.rund && !z.zeig && !z.draufsicht) {
    const k = z.rund;
    if (gang) {
      const t = Math.min(1, (jetzt - gang.start) / gang.dauer), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      k.ziel = gang.von.map((a, i) => a + (gang.nach[i] - a) * e);
      if (t >= 1) gang = null;
      eingabe();
      neu();
    } else {
      const [r, hoch, v] = tastenRichtung();
      if (hoch) {
        // hoch und runter: nur die Augenhöhe, in den Grenzen aus zimmer.json (Standard 5 cm bis 4 m über dem Boden)
        const boden = bodenHoehe(), [unten, oben] = z.einst.hoehe ?? [-2, 6];
        const tempo = 0.8 * (gedrueckt.has("ShiftLeft") || gedrueckt.has("ShiftRight") ? 3 : 1);
        k.ziel[1] = Math.max(boden + unten, Math.min(boden + oben, k.ziel[1] + hoch * tempo * dt));
        eingabe();
        neu();
      }
      if (r || v) {
        // vorwärts ist, wohin man schaut, aber waagerecht (die Kamera schaut entgegen „vorn“, siehe oben)
        const vor = [-Math.sin(k.gier), 0, -Math.cos(k.gier)], rechts = [Math.cos(k.gier), 0, -Math.sin(k.gier)];
        const schritt = 1.3 * dt, nach = k.ziel.map((a, i) => a + (vor[i] * v + rechts[i] * r) * schritt);
        if (darfGehen(k.ziel, nach)) k.ziel = nach;
        eingabe();
        neu();
      }
    }
  }
  if (fahrtLaeuft() || (z.zeig && zeigArt() !== "stehen")) return;
  // Parallaxe gleitet nach (auch beim Stehen vor einem Gegenstand, dann mit der Zeig-Kamera)
  if ((art() === "parallax" || z.zeig) && !z.draufsicht) {
    const k = z.zeig ?? z.kamera;
    const dg = parallaxZiel.gier - k.extraGier, dn = parallaxZiel.nick - k.extraNick;
    if (Math.abs(dg) + Math.abs(dn) > 1e-5) {
      k.extraGier += dg * Math.min(1, dt * 5);
      k.extraNick += dn * Math.min(1, dt * 5);
      neu();
    }
  }
  if (z.zeig) return;
  // Rundblick dreht sich von allein, wenn eine Weile nichts passiert (nicht beim Bearbeiten)
  const drehen = z.einst.rundblick?.drehen ?? 2;
  if (art() === "rundblick" && z.rund && !z.draufsicht && !z.bearbeiten && drehen && jetzt - z.letzteEingabe > PAUSE) {
    // sanft anlaufen statt ruckartig: in den ersten 3 Sekunden langsam schneller
    const anlauf = Math.min(1, (jetzt - z.letzteEingabe - PAUSE) / 3000);
    z.rund.gier += ((drehen * Math.PI) / 180) * dt * anlauf;
    neu();
  }
}

// Parallaxe zurück auf null (beim Wechsel der Blickart)
export function parallaxNull() {
  parallaxZiel.gier = parallaxZiel.nick = 0;
  if (z.kamera) z.kamera.extraGier = z.kamera.extraNick = 0;
  letzte = start = null;
}

