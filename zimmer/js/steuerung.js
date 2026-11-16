// Steuerung: Maus, Finger, Mausrad und die Lage des Handys bewegen die Kamera, je nach Blickart.
//
//   parallax   Maus oder Kippen schiebt den Blick ein wenig zur Seite (gleitet nach, sonst zuckt es)
//   rundblick  ziehen dreht den Blick („anfassen und wegschieben“: nach rechts ziehen dreht nach links), Mausrad
//              zoomt über das Sichtfeld; am Handy dreht man sich mit dem Handy selbst.
//              Rührt sich eine Weile niemand, dreht sich der Blick langsam von allein (rundblick.drehen, Grad/s).
//   frei       ziehen dreht um das Ziel, Umschalt oder rechte Maustaste verschiebt, Mausrad: näher, weiter
//   Draufsicht ziehen verschiebt, Mausrad zoomt; Klicks gehen an den Grundriss (grundriss.js)
//   Zeigen     (ein Gegenstand mit Text ist offen, dinge.js) ziehen kreist um ihn, ein Klick daneben schließt
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

import { z, neu, art, aktiveKamera } from "./zustand.js";
import { fahrtLaeuft, zeigtGerade, zeigenBeenden, zeigenAngefasst } from "./dinge.js";

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
  return { k, feld: "sichtfeld", min: art() === "rundblick" ? 20 : 25, max: art() === "rundblick" ? 110 : 100 };
}
function zoome(k, feld, wert, min, max) {
  k[feld] = Math.max(min, Math.min(max, wert));
  if (z.zeig) zeigenAngefasst();
  eingabe();
  neu();
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
  if (!z.draufsicht && !z.zeig && art() === "parallax" && ev.pointerType === "mouse") {
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
  if (z.draufsicht || ziehen.schieben) {
    // verschieben: entlang der Bildschirmachsen der Kamera, so weit, dass der Punkt unter der Maus mitgeht
    const m = k.ansicht;
    const s = (k.abstand / k.fokus) * skala;
    for (let i = 0; i < 3; i++) k.ziel[i] += -dx * s * m[4 * i] + dy * s * m[4 * i + 1];
  } else if (z.zeig || art() === "frei") {
    k.gier -= dx * 0.005;
    k.nick = Math.max(-1.5, Math.min(1.5, k.nick + dy * 0.005));
    zeigenAngefasst();
  } else if (art() === "rundblick") {
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
  ziehen = { x: ev.clientX, y: ev.clientY, weg: 0, schieben: ev.shiftKey || ev.button === 2 };
});
const loslassen = (ev) => {
  // kaum bewegt: das war ein Klick (die Draufsicht setzt dann eine Ecke, beim Zeigen geht es zurück)
  if (ziehen && ziehen.weg < 5) {
    if (z.draufsicht) z.klickOben?.(ev);
    else if (zeigtGerade()) zeigenBeenden();
  }
  ziehen = null;
};
c.addEventListener("pointerup", loslassen);
c.addEventListener("pointercancel", () => (ziehen = null));
c.addEventListener("contextmenu", (ev) => (z.draufsicht || z.zeig || art() !== "parallax") && ev.preventDefault());

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
  if (z.zeig) return;
  if (art() === "parallax") {
    // Ausweichen relativ zur Lage beim Einschalten; ±25° drehen oder kippen = ganz ausweichen
    const st = z.einst.parallax ?? 0.12;
    const k = (w) => Math.max(-1, Math.min(1, w / 0.44));
    parallaxZiel.gier = k(-winkelDifferenz(letzte.h, start.h)) * st;
    parallaxZiel.nick = -k(letzte.p - start.p) * st * 0.6;
  } else if (art() === "rundblick" && z.rund) {
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
  if (fahrtLaeuft() || z.zeig) return;
  // Parallaxe gleitet nach
  if (art() === "parallax" && !z.draufsicht) {
    const k = z.kamera;
    const dg = parallaxZiel.gier - k.extraGier, dn = parallaxZiel.nick - k.extraNick;
    if (Math.abs(dg) + Math.abs(dn) > 1e-5) {
      k.extraGier += dg * Math.min(1, dt * 5);
      k.extraNick += dn * Math.min(1, dt * 5);
      neu();
    }
  }
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
