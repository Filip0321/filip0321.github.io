// Steuerung: Maus, Finger, Mausrad und die Lage des Handys bewegen die Kamera, je nach Blickart.
//
//   parallax   Maus oder Kippen schiebt den Blick ein wenig zur Seite (gleitet nach, sonst zuckt es)
//   rundblick  ziehen dreht den Blick („anfassen und wegschieben“: nach rechts ziehen dreht nach links), Mausrad
//              zoomt über das Sichtfeld; am Handy dreht man sich mit dem Handy selbst (Kompass und Neigung).
//              Rührt sich eine Weile niemand, dreht sich der Blick langsam von allein (rundblick.drehen, Grad/s).
//   frei       ziehen dreht um das Ziel, Umschalt oder rechte Maustaste verschiebt, Mausrad: näher, weiter
//   Draufsicht ziehen verschiebt, Mausrad zoomt; Klicks gehen an den Grundriss (grundriss.js)
//
// Winkel: die Kamera schaut entgegen „vorn“ = (sin g · cos n, sin n, cos g · cos n). Größere Gier dreht den Blick
// nach links, größerer Nick nach unten.

import { z, neu, art, aktiveKamera } from "./zustand.js";
import { fahrtLaeuft } from "./dinge.js";

const parallaxZiel = { gier: 0, nick: 0 }; // wohin die Parallaxe ausweichen will
let ziehen = null;
const PAUSE = 6000; // ms ohne Eingabe, bis der Rundblick sich von allein dreht

function eingabe() {
  z.letzteEingabe = performance.now();
}

const c = z.canvas;

c.addEventListener("pointermove", (ev) => {
  if (!z.kamera || fahrtLaeuft()) return;
  if (!z.draufsicht && art() === "parallax" && ev.pointerType === "mouse") {
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
  } else if (art() === "rundblick") {
    // so drehen, dass der Punkt unter dem Finger mitgeht: ein Pixel ist 1 / Brennweite Bogenmaß
    k.gier += (dx * skala) / k.fokus;
    k.nick = Math.max(-1.4, Math.min(1.4, k.nick - (dy * skala) / k.fokus));
  } else if (art() === "frei") {
    k.gier -= dx * 0.005;
    k.nick = Math.max(-1.5, Math.min(1.5, k.nick + dy * 0.005));
  }
  neu();
});

c.addEventListener("pointerdown", (ev) => {
  if (!z.kamera || fahrtLaeuft()) return;
  eingabe();
  if (z.abfangen?.(ev)) return; // Bearbeiten: Gegenstand setzen, Ecke setzen …
  if (!z.draufsicht && art() === "parallax") return;
  c.setPointerCapture(ev.pointerId);
  ziehen = { x: ev.clientX, y: ev.clientY, weg: 0, schieben: ev.shiftKey || ev.button === 2 };
});
const loslassen = (ev) => {
  // kaum bewegt: das war ein Klick (die Draufsicht setzt dann eine Ecke)
  if (ziehen && ziehen.weg < 5 && z.draufsicht) z.klickOben?.(ev);
  ziehen = null;
};
c.addEventListener("pointerup", loslassen);
c.addEventListener("pointercancel", () => (ziehen = null));
c.addEventListener("contextmenu", (ev) => (z.draufsicht || art() !== "parallax") && ev.preventDefault());

c.addEventListener("wheel", (ev) => {
  if (!z.kamera || fahrtLaeuft() || (!z.draufsicht && art() === "parallax")) return;
  ev.preventDefault();
  eingabe();
  const k = aktiveKamera();
  const f = Math.exp(ev.deltaY * 0.001);
  if (!z.draufsicht && art() === "rundblick") k.sichtfeld = Math.max(20, Math.min(110, k.sichtfeld * f));
  else k.abstand = Math.max(0.05, k.abstand * f);
  neu();
}, { passive: false });

// ---------- Handy-Lage ----------
// alpha: Drehung um die senkrechte Achse (Kompass), beta: vor und zurück kippen (90° = Handy aufrecht),
// gamma: seitlich kippen. Gerechnet wird immer relativ zur Lage beim ersten Messwert.
let lageStart = null;
let rundStart = null;
window.addEventListener("deviceorientation", (ev) => {
  if (ev.beta == null || !z.kamera || z.draufsicht || fahrtLaeuft()) return;
  const grad = Math.PI / 180;
  if (art() === "parallax") {
    lageStart ??= { beta: ev.beta, gamma: ev.gamma };
    const st = z.einst.parallax ?? 0.12;
    const k = (w) => Math.max(-1, Math.min(1, w / 25)); // ±25° kippen = ganz ausweichen
    parallaxZiel.gier = -k(ev.gamma - lageStart.gamma) * st;
    parallaxZiel.nick = k(ev.beta - lageStart.beta) * st * 0.6;
  } else if (art() === "rundblick" && z.rund && ev.alpha != null) {
    // durchs Handy ins Zimmer schauen: nach links drehen dreht den Blick nach links, nach hinten kippen nach oben
    if (!rundStart) rundStart = { alpha: ev.alpha, beta: ev.beta, gier: z.rund.gier, nick: z.rund.nick };
    let da = ev.alpha - rundStart.alpha;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    z.rund.gier = rundStart.gier + da * grad;
    z.rund.nick = Math.max(-1.4, Math.min(1.4, rundStart.nick - (ev.beta - rundStart.beta) * grad));
    eingabe();
    neu();
  }
});
// iOS fragt um Erlaubnis, und nur nach einer Berührung
window.addEventListener("pointerdown", async () => {
  if (typeof DeviceOrientationEvent?.requestPermission === "function") {
    try {
      await DeviceOrientationEvent.requestPermission();
    } catch {}
  }
}, { once: true });

// ---------- in jedem Bild ----------
export function schritt(dt, jetzt) {
  if (fahrtLaeuft()) return;
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
    rundStart = null; // die Handy-Lage beginnt danach von der neuen Richtung aus
    neu();
  }
}

// Parallaxe zurück auf null (beim Wechsel der Blickart)
export function parallaxNull() {
  parallaxZiel.gier = parallaxZiel.nick = 0;
  if (z.kamera) z.kamera.extraGier = z.kamera.extraNick = 0;
  rundStart = null;
}
