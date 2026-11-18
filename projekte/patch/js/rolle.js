// Notenrolle (Runde 23b): das Zeichenfeld der Pianoroll als eigener Baustein, damit Pianoroll und Clips dasselbe
// benutzen. Ein Raster aus Sechzehnteln (waagrecht) und Halbtönen (senkrecht), wie in Ableton:
//   ziehen auf freier Fläche    neue Note, so lang wie gezogen (Anfang: so lang wie die zuletzt benutzte)
//   ziehen an einer Note        verschieben (Zeit und Höhe)
//   ziehen am rechten Rand      Länge
//   Doppelklick, Rechtsklick    löschen
//   Mausrad über einer Note     Anschlag (wie fest; die Note wird heller oder dunkler)
// Noten als Liste [Schritt, Note, Länge, Anschlag]. Die Rolle besitzt die Liste nicht: stand() sagt ihr bei jedem
// Zeichnen und Klicken, welche Liste, wie viele Schritte, welcher Ausschnitt gilt. So kann der Clip-Player die Rolle
// auf einen anderen Clip zeigen lassen, ohne sie neu zu bauen. Nach jeder Änderung ruft sie geaendert().
// Runde 25: Raster (stand().raster): 1 = Sechzehntel, 0.5 = Zweiunddreißigstel, 1/3·… = Triolen, 0 = frei (ohne
// Raster, „off grid“). Schritt und Länge sind dann Kommazahlen; die Spieler setzen die Note um den Bruchteil später.

import { LEITERN } from "./bausteine.js";

const NAMEN = ["C", "Cis", "D", "Es", "E", "F", "Fis", "G", "As", "A", "B", "H"];
export const notenName = (n) => `${NAMEN[((Math.round(n) % 12) + 12) % 12]}${Math.floor(Math.round(n) / 12) - 1}`;
const SCHWARZ = new Set([1, 3, 6, 8, 10]);

// stand(): { liste, schritte, tiefste, grundton, leiter, kopf } (leiter: Name aus LEITERN oder "keine"; kopf: Schritt oder −1)
// hoere(n, anschlag): kurz vorhören
export function neueRolle({ stand, geaendert, hoere, breite = 640, hoehe = 312, zeilen = 25 }) {
  const LINKS = 34, OBEN = 12, ZEILEN = zeilen;
  const c = document.createElement("canvas");
  c.width = breite;
  c.height = hoehe;
  c.className = "rolle";
  const g = c.getContext("2d");
  let letzteLaenge = 2;
  const runde = (x) => {
    const r = stand().raster ?? 1;
    return r > 0 ? Math.round(x / r) * r : Math.round(x * 100) / 100;
  };
  const ab = (x) => {
    const r = stand().raster ?? 1;
    return r > 0 ? Math.floor(x / r) * r : Math.round(x * 100) / 100;
  };

  const zeichne = () => {
    if (c.offsetParent === null) return;
    const { liste, schritte, tiefste, grundton, leiter: lname, kopf } = stand();
    const B = c.width, H = c.height, sb = (B - LINKS) / schritte, zh = (H - OBEN) / ZEILEN;
    const farbe = getComputedStyle(c).color;
    g.clearRect(0, 0, B, H);
    g.fillStyle = g.strokeStyle = farbe;
    g.font = "10px monospace";
    const leiter = LEITERN[lname];
    for (let z = 0; z < ZEILEN; z++) {
      const n = tiefste + ZEILEN - 1 - z, y = OBEN + z * zh, stufe = (((n - Number(grundton)) % 12) + 12) % 12;
      g.globalAlpha = SCHWARZ.has(n % 12) ? 0.12 : 0;
      if (leiter) g.globalAlpha = leiter.includes(stufe) ? 0.1 : 0; // Töne der Leiter hervorheben
      g.fillRect(LINKS, y, B - LINKS, zh);
      g.globalAlpha = 0.15;
      g.fillRect(LINKS, y, B - LINKS, 1);
      g.globalAlpha = 1;
      if (n % 12 === 0) g.fillText(notenName(n), 2, y + zh - 2);
      else if (SCHWARZ.has(n % 12)) g.fillRect(4, y + 2, LINKS - 12, zh - 4); // kleine schwarze Taste links
    }
    for (let s = 0; s <= schritte; s++) {
      g.globalAlpha = s % 16 === 0 ? 0.7 : s % 4 === 0 ? 0.3 : 0.1;
      g.fillRect(LINKS + s * sb, OBEN, 1, H - OBEN);
      if (s % 16 === 0 && s < schritte) {
        g.globalAlpha = 1;
        g.fillText(String(s / 16 + 1), LINKS + s * sb + 3, 9);
      }
    }
    for (const [s, n, l, vel] of liste) {
      const z = tiefste + ZEILEN - 1 - n;
      if (z < 0 || z >= ZEILEN || s >= schritte) continue;
      const x = LINKS + s * sb, y = OBEN + z * zh, b = Math.min(l, schritte - s) * sb;
      g.globalAlpha = 0.3 + 0.7 * vel; // Anschlag als Deckkraft
      g.fillRect(x + 1, y + 1, b - 2, zh - 2);
      g.globalAlpha = 1;
      g.strokeRect(x + 1.5, y + 1.5, b - 3, zh - 3);
    }
    if (kopf >= 0) {
      g.globalAlpha = 0.9;
      g.fillRect(LINKS + kopf * sb, 0, 2, H);
      g.globalAlpha = 1;
    }
  };

  const ort = (ev) => {
    const { schritte, tiefste } = stand();
    const r = c.getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * c.width, y = ((ev.clientY - r.top) / r.height) * c.height;
    const sb = (c.width - LINKS) / schritte, zh = (c.height - OBEN) / ZEILEN;
    return { s: (x - LINKS) / sb, n: tiefste + ZEILEN - 1 - Math.floor((y - OBEN) / zh), sb };
  };
  const treffer = ({ s, n }) => stand().liste.find(([a, m, l]) => m === n && s >= a && s < a + l);
  let griff = null, letzterKlick = { zeit: 0, note: null };

  c.addEventListener("pointerdown", (ev) => {
    if (ev.button === 1) return;
    ev.preventDefault();
    const { liste, schritte, tiefste } = stand();
    const o = ort(ev);
    if (o.s < 0) {
      // Klick auf die Tasten links: nur vorhören
      hoere(o.n, 0.8);
      return;
    }
    const t = treffer(o);
    // Doppelklick selbst erkennen (zweimal dieselbe Note in 350 ms): das dblclick-Ereignis kommt nach
    // preventDefault auf pointerdown nicht in jedem Browser an
    const doppelt = t && t === letzterKlick.note && ev.timeStamp - letzterKlick.zeit < 350;
    letzterKlick = { zeit: ev.timeStamp, note: t ?? null };
    if (ev.button === 2 || ev.altKey || doppelt) {
      if (t) {
        liste.splice(liste.indexOf(t), 1);
        geaendert();
      }
      return;
    }
    try { c.setPointerCapture(ev.pointerId); } catch {}
    if (t) {
      const randNah = (t[0] + t[2] - o.s) * o.sb < Math.max(6, o.sb * 0.35);
      griff = randNah ? { art: "laenge", note: t } : { art: "ziehen", note: t, ds: o.s - t[0] };
    } else {
      const s = ab(o.s);
      if (s >= schritte || o.n < tiefste || o.n >= tiefste + ZEILEN) return;
      const neu = [s, o.n, Math.min(letzteLaenge, schritte - s), 0.8];
      liste.push(neu);
      letzterKlick.note = neu;
      hoere(o.n, 0.8);
      griff = { art: "laenge", note: neu };
    }
  });
  c.addEventListener("pointermove", (ev) => {
    if (!griff) return;
    const { schritte, tiefste } = stand();
    const o = ort(ev), note = griff.note;
    if (griff.art === "laenge") {
      const min = (stand().raster ?? 1) || 0.1;
      note[2] = Math.max(min, Math.min(schritte - note[0], runde(o.s - note[0] + min / 2)));
      letzteLaenge = note[2];
    } else {
      const s = Math.max(0, Math.min(schritte - note[2], runde(o.s - griff.ds)));
      const n = Math.max(tiefste, Math.min(tiefste + ZEILEN - 1, o.n));
      if (n !== note[1]) hoere(n, note[3]);
      note[0] = s;
      note[1] = n;
    }
  });
  const los = () => {
    if (!griff) return;
    griff = null;
    geaendert();
  };
  c.addEventListener("pointerup", los);
  c.addEventListener("pointercancel", los);
  c.addEventListener("contextmenu", (ev) => ev.preventDefault());
  c.addEventListener("wheel", (ev) => {
    const t = treffer(ort(ev));
    if (!t) return;
    ev.preventDefault();
    t[3] = Math.max(0.05, Math.min(1, t[3] - Math.sign(ev.deltaY) * 0.05));
    geaendert();
  }, { passive: false });

  return { c, zeichne, ZEILEN };
}

// Eine Zufallsmelodie in einer Leiter (sonst Moll-Pentatonik): Knopf „würfeln“ in Pianoroll und Clips
export function wuerfle({ schritte, tiefste, grundton, leiter: lname }, zeilen = 25) {
  const leiter = LEITERN[lname] ?? LEITERN["pentatonik-moll"], basis = tiefste + 12 - ((tiefste + 12) % 12) + Number(grundton);
  const liste = [];
  for (let s = 0; s < schritte; s += Math.random() < 0.6 ? 2 : 1) {
    if (Math.random() < 0.35) continue;
    const k = Math.floor(Math.random() * leiter.length * 1.5);
    const n = basis + leiter[k % leiter.length] + 12 * Math.floor(k / leiter.length);
    if (n < tiefste + zeilen) liste.push([s, n, Math.random() < 0.7 ? 1 : 2, 0.5 + Math.random() * 0.5]);
  }
  return liste;
}

// Auswahl für das Raster (Pianoroll, Clips): Wert = Länge eines Rasterschritts in Sechzehnteln
export const RASTER = [["1", "1/16"], ["0.5", "1/32"], ["0.6666666666666666", "1/16 Triole"], ["0.3333333333333333", "1/32 Triole"], ["0", "frei (off grid)"]];
