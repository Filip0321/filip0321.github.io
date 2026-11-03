// Zeitleiste wie in Avidemux: jedes Bild der Folge ist ein schmales Kästchen. So sieht man, wo Keyframes
// liegen, wo geheilt, gehalten oder wiederholt wird, und kann Bereiche auswählen, um sie zu löschen
// (zum Beispiel einen Keyframe am Schnitt) oder zu wiederholen (P-Frames verdoppeln).
//
//   Farbe des Kästchens   welcher Clip (jeder Clip ein eigener Farbton)
//   roter Streifen oben   Keyframe (I-Frame): hier wird das Bild sauber
//   oranger Streifen      geheilt (Keyframe aus dem zweiten Kodierer)
//   violetter Streifen    dasselbe Paket wie davor (gehalten oder wiederholt): das Bild fließt
//   weißer Strich         hier wechselt die Quelle (Schnitt oder Sprung)
//
// Klicken setzt die Stelle (die Vorschau zeigt dieses Bild), Ziehen oder Umschalt-Klick wählt einen Bereich.

import { paketVon } from "./folge.js";

export function richteZeitleisteEin(canvas, { beiStelle, beiAuswahl }) {
  const ctx = canvas.getContext("2d");
  let stand = { folge: [], daten: null, breite: 6 };
  let auswahl = null; // [von, bis] (Bilder der Folge, beide enthalten)
  let position = -1;
  let anker = null;

  function zeichne() {
    const { folge, daten, breite } = stand;
    const h = canvas.height;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, h);
    if (!daten) return;
    let vorher = null;
    for (let i = 0; i < folge.length; i++) {
      const e = folge[i];
      const p = paketVon(daten, e);
      const x = i * breite;
      ctx.fillStyle = `hsl(${(p.clip * 137) % 360}, 40%, ${p.bild % 2 ? 30 : 34}%)`;
      ctx.fillRect(x, h * 0.3, Math.max(1, breite - (breite > 3 ? 1 : 0)), h * 0.7);
      const streifen = e >= daten.pakete.length ? "#ff9a2e" : p.typ === "key" ? "#ff3b3b" : e === vorher ? "#b26bff" : null;
      if (streifen) {
        ctx.fillStyle = streifen;
        ctx.fillRect(x, 0, Math.max(1, breite - 1), h * 0.28);
      }
      // Quelle springt (anderer Clip oder nicht das nächste Paket): weißer Strich davor
      if (vorher !== null && e !== vorher) {
        const q = paketVon(daten, vorher);
        if (q.clip !== p.clip || Math.abs(p.bild - q.bild) > 1) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(x, 0, 1, h);
        }
      }
      vorher = e;
    }
    if (auswahl) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      ctx.fillRect(auswahl[0] * breite, 0, (auswahl[1] - auswahl[0] + 1) * breite, h);
    }
    if (position >= 0) {
      ctx.fillStyle = "#4df";
      ctx.fillRect(position * breite, 0, Math.max(2, breite / 3), h);
    }
  }

  function bildBei(event) {
    const r = canvas.getBoundingClientRect();
    const x = ((event.clientX - r.left) / r.width) * canvas.width;
    return Math.max(0, Math.min(stand.folge.length - 1, Math.floor(x / stand.breite)));
  }

  let zieht = false;
  canvas.addEventListener("pointerdown", (event) => {
    if (!stand.daten) return;
    canvas.setPointerCapture(event.pointerId);
    const i = bildBei(event);
    if (event.shiftKey && anker !== null) auswahl = [Math.min(anker, i), Math.max(anker, i)];
    else {
      anker = i;
      auswahl = [i, i]; // ein Klick wählt ein Bild (z. B. den Keyframe am Schnitt)
    }
    zieht = true;
    zeichne();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!zieht) return;
    const i = bildBei(event);
    auswahl = [Math.min(anker, i), Math.max(anker, i)];
    zeichne();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!zieht) return;
    zieht = false;
    beiAuswahl(auswahl);
    beiStelle(bildBei(event));
  });

  return {
    // neue Folge (nach jedem Eingriff); breite = Pixel pro Bild
    zeige(folge, daten, breite) {
      // ein Canvas darf nicht beliebig breit werden (Browser: etwa 16 000 Pixel), sonst wird es leer
      stand = { folge, daten, breite: Math.max(1, Math.min(breite, Math.floor(16000 / Math.max(1, folge.length)))) };
      canvas.width = Math.max(1, folge.length * stand.breite);
      canvas.style.width = `${canvas.width}px`; // ein Canvas-Pixel = ein Bildschirm-Pixel, der Rahmen scrollt
      if (auswahl && auswahl[1] >= folge.length) auswahl = null;
      zeichne();
    },
    markiere(i) {
      position = i;
      zeichne();
      // mitscrollen, damit die Stelle sichtbar bleibt
      const rahmen = canvas.parentElement;
      const x = (i * stand.breite * canvas.clientWidth) / canvas.width;
      if (x < rahmen.scrollLeft || x > rahmen.scrollLeft + rahmen.clientWidth - 20) rahmen.scrollLeft = x - rahmen.clientWidth / 3;
    },
    auswahl: () => auswahl,
    hebeAuf() {
      auswahl = null;
      zeichne();
    },
  };
}
