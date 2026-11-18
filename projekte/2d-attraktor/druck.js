// Druck: den Attraktor in Druckgröße neu rechnen statt das Bildschirmbild hochzuziehen (Theorie in /lib/druck.js).
//
// Was sich mit der Größe ändern muss, damit der Druck aussieht wie der Bildschirm, nur feiner:
//
//   Maßstab f: so viel mal mehr Pixel hat das Papier (innen, ohne Rand) als der Canvas, in der knapperen Richtung.
//     Der Bildschirmausschnitt passt ganz aufs Papier; hat das Papier ein anderes Format, sieht man dort mehr
//     vom Attraktor drumherum (statt schwarzer Balken).
//   Zoom: mal f (Pixel pro Einheit).
//   Helligkeit: Jedes Pixel zählt, wie viel Punkt-Gewicht auf ihm landet (a), und wird 1 − exp(−a · Stärke).
//     a ≈ Anzahl · Punktfläche / Bildfläche. Die Bildfläche wächst mit f². Bleibt a gleich, bleibt die Helligkeit
//     gleich. Zwei Wege: m-mal mehr Punkte und Punkte, die √m-mal kleiner sind als „einfach mitgewachsen“:
//       Anzahl · m · (s · f / √m)² = Anzahl · s² · f²   ✓
//     Mit m = f² bleibt jeder Punkt so viele Pixel groß wie am Bildschirm, und die Struktur wird wirklich feiner
//     (mehr Punkte zeigen mehr vom Attraktor). Das ist das Ziel; begrenzt wird m nur von der Rechenzeit (Feinheit).
//   Schatten und Fläche messen in Pixeln: Weichheit und Umkreis wachsen mit f mit (Umkreis ist eine Mipmap-Stufe,
//     jede Stufe doppelt so weit, also log2(f) Stufen mehr).
//
// Die Punkte kommen in Stücken zu je 2 Millionen (eine Liste von 40 Millionen bräuchte 320 MB). Jedes Stück wird in
// jede Kachel gezählt; erst nach dem letzten wird gefärbt. Für jede Kachel wird die Punktfolge neu gerechnet,
// vom selben Startpunkt aus: gleiche Zahlen, gleiche Punkte, keine Nähte.

import { erstelleShader } from "./shader.js";
import { kacheln, maleRand } from "/lib/druck.js";

// 500 000 Punkte pro Zeichenbefehl: ein einzelner Befehl, der zu lange braucht, lässt den Grafiktreiber aufgeben
// (Windows bricht nach etwa 2 Sekunden ab, der WebGL-Kontext ist dann verloren). Kleine Stücke, dazwischen kurz
// warten, dann kommt jeder Befehl schnell zurück.
const STUECK = 500_000;
const MAX_PUNKTE = { fein: 60e6, mittel: 24e6, schnell: 6e6 };
const EINPENDELN = 100; // wie berechnePunkte in attraktor.js

let druckShader = null; // eigener WebGL-Kontext mit eigenem Canvas, die Anzeige bleibt unberührt

// schirm: { breite, hoehe, dpr } des Canvas; zeichneWerte: alles, was main.js sonst an shader.zeichne gibt
// papier: aus oeffneDruckDialog (breite, hoehe, rand in Pixeln, qualitaet)
export async function rechneDruck({ typ, werte, start, punkte, schirm, zeichneWerte, verlauf, schrittMass, papier, fortschritt }) {
  const innenB = papier.breite - 2 * papier.rand, innenH = papier.hoehe - 2 * papier.rand;
  const f = Math.min(innenB / schirm.breite, innenH / schirm.hoehe);

  if (!druckShader) {
    const leinwand = document.createElement("canvas");
    druckShader = erstelleShader(leinwand);
    druckShader.leinwand = leinwand;
    druckShader.verloren = false;
    leinwand.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
      druckShader.verloren = true;
    });
  }
  const sh = druckShader, leinwand = sh.leinwand;
  const pruefe = () => {
    if (!sh.verloren && !sh.gl.isContextLost()) return;
    druckShader = null; // beim nächsten Versuch ein frischer Kontext
    throw new Error("Die Grafikkarte hat aufgegeben (zu viel auf einmal). Weniger Feinheit oder weniger dpi versuchen, und bitte melden, bei welcher Einstellung.");
  };
  sh.setzeVerlauf(verlauf);
  const { viewport, textur } = sh.grenzen();
  const kachel = Math.min(4096, viewport[0], viewport[1], textur);
  leinwand.width = leinwand.height = kachel;

  // Punktzahl: „mittel“ und „schnell“ nehmen m = f² (jeder Punkt so viele Pixel groß wie am Bildschirm), begrenzt
  // durch die Rechenzeit. „fein“ geht weiter: noch mehr, noch kleinere Punkte, bis ein Punkt 1 Pixel klein ist,
  // (s · f)². Mehr Punkte heißt weniger Körnung: jedes Pixel mittelt über mehr Treffer (das Rauschen einer Zählung
  // fällt mit 1 / √Anzahl). Nie so viele, dass ein Punkt unter 1 Pixel schrumpfen müsste.
  const s = zeichneWerte.punktgroesse * schirm.dpr; // Durchmesser am Bildschirm in Canvas-Pixeln
  const ziel = papier.qualitaet === "fein" ? (s * f) ** 2 : f * f;
  const m = Math.max(1, Math.min(ziel, MAX_PUNKTE[papier.qualitaet] / punkte, (s * f) ** 2));
  const gesamt = Math.round(punkte * m);
  const stuecke = Math.ceil(gesamt / STUECK);

  // Überstand jeder Kachel: so weit reicht, was über die Nachbarschaft rechnet (Fläche, weicher Schatten)
  const fuell = zeichneWerte.fuellRadius + Math.log2(f);
  const weich = zeichneWerte.schatten ? zeichneWerte.schattenWeich * schirm.dpr * f : 0;
  const ueber = Math.min(kachel / 4, Math.ceil(Math.max(32, zeichneWerte.flaeche ? 2 ** (fuell + 1) : 0, 2 * weich)));

  const zoom = zeichneWerte.zoom * f;
  const daten = new Float32Array(STUECK * 2);

  const bild = await kacheln({
    breite: papier.breite, hoehe: papier.hoehe, kachel, ueber, fortschritt,
    async zeichneKachel(x0, y0, groesse, teil) {
      // Mitte dieser Kachel in Einheiten des Attraktors. Der Shader legt größeres y nach unten (wie der Canvas,
      // siehe zuClip in shader.js), also wandern x und y beide mit dem Pixel-Abstand zur Bildmitte
      const dx = x0 + groesse / 2 - papier.breite / 2, dy = y0 + groesse / 2 - papier.hoehe / 2;
      const mitteX = zeichneWerte.mitteX + dx / zoom, mitteY = zeichneWerte.mitteY + dy / zoom;
      const pos = { x: start[0], y: start[1] };
      for (let i = 0; i < EINPENDELN; i++) typ.schritt(werte, pos);
      for (let k = 0; k < stuecke; k++) {
        const n = Math.min(STUECK, gesamt - k * STUECK);
        for (let i = 0; i < n; i++) {
          typ.schritt(werte, pos);
          daten[i * 2] = pos.x;
          daten[i * 2 + 1] = pos.y;
        }
        if (!Number.isFinite(pos.x + pos.y)) throw new Error("Der Punkt ist davongelaufen.");
        sh.ladePunkte(daten.subarray(0, n * 2), schrittMass);
        sh.zeichne({
          ...zeichneWerte,
          mitteX, mitteY, zoom,
          punktgroesse: zeichneWerte.punktgroesse / Math.sqrt(m),
          pixelMass: schirm.dpr * f,
          ganz: { breite: papier.breite, hoehe: papier.hoehe },
          fuellRadius: fuell,
          sichtbar: n,
          gesamt, indexVersatz: k * STUECK,
          leeren: k === 0, faerben: k === stuecke - 1,
        });
        sh.gl.flush(); // jetzt losschicken, nicht viele Befehle sammeln
        teil((k + 1) / stuecke);
        await new Promise((r) => setTimeout(r));
        pruefe();
      }
      sh.gl.finish();
      pruefe();
      return leinwand;
    },
  });
  maleRand(bild, papier.rand, papier.randFarbe);
  return { bild, gesamt, f };
}
