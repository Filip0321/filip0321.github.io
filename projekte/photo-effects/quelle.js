import { zustand } from "./zustand.js";

// Bilder müssen limitiert werden, um nicht ewig zu rechnen

const MAX_KANTE = 2400;

// zustand.format: welcher Ausschnitt der Quelle landet wo auf dem Canvas

export function berechneRahmen(qw, qh) {
  let sx = 0,
    sy = 0,
    sw = qw,
    sh = qh; // Ausschnitt aus der Quelle, erst mal alles
  let rw = qw,
    rh = qh; // Größe des Ergebnisses, noch ohne MAX_KANTE

  if (zustand.format === "4:3") {
    if (qw / qh > 4 / 3) {
      // Quelle breiter als 4:3: links und rechts abschneiden
      sw = (qh * 4) / 3;
      sx = (qw - sw) / 2; // hälfte differenz, weil einfach später
      // bei späterem x anfangen zu malen
    } else {
      // Quelle höher als 4:3: oben und unten abschneiden
      sh = (qw * 3) / 4;
      sy = (qh - sh) / 2;
    }
    rw = sw;
    rh = sh;
  } else if (zustand.format === "balken") {
    if (qw / qh > 4 / 3) {
      rh = (qw * 3) / 4; // Balken oben und unten
    } else {
      rw = (qh * 4) / 3; // Balken links und rechts
    }
  }

  const faktor = Math.min(1, MAX_KANTE / Math.max(rw, rh));
  const w = Math.round(rw * faktor);
  const h = Math.round(rh * faktor);
  const dw = Math.round(sw * faktor);
  const dh = Math.round(sh * faktor);

  return {
    w,
    h,
    sx, // wo angefangen wird mit malen
    sy,
    sw, // bezieht sich auf die Originalgröße
    sh, // bzw. veränderung bei dem Original
    dx: Math.round((w - dw) / 2),
    dy: Math.round((h - dh) / 2),
    dw, // angepasst auf die MAX_KANTE
    dh,
  };
}

export function zeichneQuelle(ziel, quelle, qw, qh) {
  const r = berechneRahmen(qw, qh);
  // console.log(r);
  ziel.clearRect(0, 0, r.w, r.h); // alles löschen, auch das vorige Bild
  if (!zustand.transparent) {
    ziel.fillStyle = zustand.hintergrund;
    ziel.fillRect(0, 0, r.w, r.h);
  }
  ziel.drawImage(quelle, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
}