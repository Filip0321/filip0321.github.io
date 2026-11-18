// Druck für den 3D-Attraktor: das Bild in Papiergröße neu rechnen statt hochziehen (Theorie in /lib/druck.js).
//
// Die Kamera ist eine Lochkamera: ein Punkt landet bei
//   x = p.x · brennweite · (H / B) / tiefe + versatz.x      (Bildkoordinaten −1 bis 1)
//   y = p.y · brennweite / tiefe + versatz.y
// Eine Kachel ist ein Ausschnitt dieses Bildes. Statt den Shader umzubauen, rechnet sie mit einer anderen
// Brennweite und einem anderen Versatz: ein Teleobjektiv, das nur auf ihr Stück zeigt (ein „verschobenes Objektiv“
// wie bei einer Fachkamera). Für eine Kachel T × T, deren Mitte bei o (in Bildkoordinaten des Papiers) liegt:
//   brennweite' = brennweite · f · H_schirm / T
//   versatz'    = (versatz · f · Schirmgröße − o · Papiergröße) / T     (x mit Breiten, y mit Höhen)
// f ist wie im 2D-Attraktor der Maßstab Papier zu Schirm (der Schirmausschnitt passt ganz aufs Papier).
// Boden, Wände und Nebel rechnet der Shader pro Pixel aus derselben Formel rückwärts, sie passen also mit.
//
// Gezeichnet wird in den Canvas der Seite (er wird dafür kurz auf Kachelgröße gestellt): so braucht es keine zweite
// Kopie von Körpern und Lampen.
//
// Punkte: wie im 2D-Attraktor m-mal so viele, jeder √m-mal kleiner als „einfach mitgewachsen“, dann bleibt die
// Helligkeit gleich (Anzahl · m · (s · f / √m)² = Anzahl · s² · f²) und die Struktur wird feiner. Anders als im 2D
// liegen hier alle Punkte auf einmal auf der Grafikkarte (je 12 Byte), darum höchstens 12 Millionen. Beim Mobile
// (mehrere Körper) bleibt es bei den eingestellten Punkten, die dann größer gezeichnet werden.

import { kacheln, maleRand } from "/lib/druck.js";

// Der 3D-Attraktor zeichnet alle Punkte mit einem Befehl (dazu Schatten und Nebel). Zu viele auf einmal lassen den
// Grafiktreiber aufgeben (Windows bricht nach etwa 2 Sekunden ab), darum vorsichtiger als im 2D
const MAX_PUNKTE = { fein: 6e6, mittel: 4e6, schnell: 2e6 };

// ladeMehr(m): lädt m-mal so viele Punkte und gibt zurück, wie viel mal es wirklich wurden (1: ging nicht)
export async function rechneDruck3D({ canvas, shader, werte, papier, fortschritt, punkte, ladeMehr }) {
  const Bs = canvas.width, Hs = canvas.height, dpr = Bs / Math.max(canvas.clientWidth, 1);
  const Bp = papier.breite, Hp = papier.hoehe;
  const f = Math.min((Bp - 2 * papier.rand) / Bs, (Hp - 2 * papier.rand) / Hs);
  const s = werte.punktgroesse * dpr;
  const ziel = papier.qualitaet === "fein" ? (s * f) ** 2 : f * f;
  const m = ladeMehr(Math.max(1, Math.min(ziel, MAX_PUNKTE[papier.qualitaet] / punkte, (s * f) ** 2)));
  const { viewport, textur } = shader.grenzen();
  const T = Math.min(4096, viewport[0], viewport[1], textur);
  canvas.width = canvas.height = T;
  const ueber = 64;
  const v = werte.versatz ?? { x: 0, y: 0 };
  const bild = await kacheln({
    breite: Bp, hoehe: Hp, kachel: T, ueber, fortschritt,
    async zeichneKachel(x0, y0) {
      const ox = (2 * (x0 + T / 2)) / Bp - 1;
      const oy = 1 - (2 * (y0 + T / 2)) / Hp; // Bildkoordinaten zeigen nach oben, Pixel nach unten
      shader.zeichne({
        ...werte,
        brennweite: (werte.brennweite * f * Hs) / T,
        versatz: { x: (v.x * f * Bs - ox * Bp) / T, y: (v.y * f * Hs - oy * Hp) / T },
        pixelMass: dpr * f,
        punktgroesse: werte.punktgroesse / Math.sqrt(m),
        bildHoehe: Hp,
        spektrum: null,
      });
      shader.gl.finish();
      if (shader.gl.isContextLost()) throw new Error("Die Grafikkarte hat aufgegeben (zu viel auf einmal). Weniger Feinheit oder weniger dpi versuchen; danach die Seite neu laden.");
      return canvas;
    },
  });
  maleRand(bild, papier.rand, papier.randFarbe);
  return { bild, f, gesamt: Math.round(punkte * m) };
}
