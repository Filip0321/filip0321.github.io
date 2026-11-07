// Zeitleiste wie in einem Schnittprogramm, mit den Zeilen von Avidemux darunter. Zwei Teile:
//
//   Schnitt   die Clips auf ihren Spuren (Zeit des Schnitts). Ziehen verschiebt einen Clip (auch auf eine
//             andere Spur, über die oberste hinaus gibt es eine neue), an den Rändern ziehen kürzt ihn.
//             Die oberste Spur gewinnt. Verdeckte Teile sind blass.
//   Ergebnis  die Bilder, wie sie in den Dekoder gehen (Zeit des Videos). Durch Halten und Wiederholen
//             wird das Ergebnis länger als der Schnitt, darum hat jeder Teil sein eigenes Lineal.
//       Bilder  kleine Vorschau des gemoshten Ergebnisses, sobald das Bild einmal abgespielt oder gerendert
//               wurde; vorher blass die Quelle (was das Paket ursprünglich zeigte)
//       I       Keyframes: rot am Schnitt oder Clipanfang, orange geheilt; ein roter Rahmen ohne Füllung
//               ist ein gelöschter I-Frame (dort moshen die P-Frames auf dem alten Bild weiter)
//       P       P-Frames in der Farbe ihres Clips; violett: wiederholt, gehalten oder eingesetzt
//
// Die Zeitleiste zeichnet nur, was gerade zu sehen ist (der Rahmen scrollt, das Canvas bleibt so breit
// wie der Rahmen). Darum kann man beliebig weit hineinzoomen und Filme von jeder Länge zeigen.
//
// Bedienung: Klicken setzt die Stelle, Ziehen wählt aus, Umschalt-Klick erweitert. Strg + Mausrad (oder
// zwei Finger auseinander) zoomt, das Mausrad allein scrollt. Tasten: ← → ein Bild (mit Umschalt zehn),
// Pos1 / Ende, A und B setzen Anfang und Ende der Auswahl an die Stelle, Esc hebt sie auf.

import { paketVon } from "./folge.js";
import { ende } from "./schnitt.js";

const LINEAL = 14;
const SPUR = 22;
const TRENN = 6;
const BILDER = 36;
const ZEILE = 14;
const FANG = 8; // so nah (Pixel) rastet ein gezogener Clip an Kanten und an der Stelle ein

export function richteZeitleisteEin(rahmen, { beiStelle, beiAuswahl, beiClip, beiClipWahl }) {
  const canvas = rahmen.querySelector("canvas");
  const breiteEl = rahmen.querySelector(".zl-breite");
  const ctx = canvas.getContext("2d");
  let s = { folge: [], herkunft: [], daten: null, clips: [], grund: [], gemosht: new Map() };
  let px = 6; // Pixel pro Bild
  let auswahl = null; // [von, bis], Bilder des Ergebnisses, beide enthalten
  let position = -1;
  let anker = null;
  let gewaehlt = null; // gewählter Clip (Id)
  let zug = null; // laufendes Ziehen

  const spuren = () => Math.max(1, ...s.clips.map((c) => c.spur + 1));
  const oben = () => LINEAL; // Anfang der Spuren
  const ergebnisOben = () => LINEAL + (spuren() + 1) * SPUR + TRENN; // eine leere Spur unten zum Hinziehen
  const gesamtHoehe = () => ergebnisOben() + LINEAL + BILDER + 2 * ZEILE + 2;
  const schnittLaenge = () => Math.max(0, ...s.clips.map(ende));
  const xVon = (f) => f * px - rahmen.scrollLeft;
  const fVon = (x) => (x + rahmen.scrollLeft) / px;

  function masse() {
    const dpr = window.devicePixelRatio || 1;
    const b = rahmen.clientWidth;
    const h = gesamtHoehe();
    if (canvas.width !== Math.round(b * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(b * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${b}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    breiteEl.style.width = `${Math.max(schnittLaenge(), s.folge.length) * px + 40}px`;
  }

  // Farbe eines Clips: feste Farbtöne ohne Violett (das bedeutet „wiederholt“), dann im Kreis
  const TOENE = [200, 140, 45, 340, 170, 100, 225, 15, 60, 185];
  const farbe = (clip, hell = 34) => `hsl(${TOENE[clip % TOENE.length]}, 45%, ${hell}%)`;

  function lineal(y, laenge, fps) {
    const b = rahmen.clientWidth;
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(0, y, b, LINEAL);
    if (!fps) return;
    // Abstand der Beschriftung: so viele Sekunden, dass sie mindestens 60 Pixel auseinander liegen
    const schritte = [1 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
    const sek = schritte.find((x) => x * fps * px >= 60) ?? 600;
    ctx.fillStyle = "#aaa";
    ctx.font = "10px sans-serif";
    const erstes = Math.floor(fVon(0) / fps / sek) * sek;
    for (let t = Math.max(0, erstes); t * fps <= laenge; t += sek) {
      const x = xVon(t * fps);
      if (x > b) break;
      ctx.fillRect(Math.round(x), y + LINEAL - 5, 1, 5);
      const text = sek < 1 ? `${Math.round(t * fps)}` : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
      ctx.fillText(text, x + 2, y + 10);
    }
  }

  function zeichne() {
    masse();
    const b = rahmen.clientWidth;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, b, gesamtHoehe());
    const { folge, herkunft, daten, clips, grund } = s;
    if (!daten) return;
    const fps = daten.fps;

    // ---- Schnitt ----
    lineal(0, schnittLaenge(), fps);
    for (let r = 0; r <= spuren(); r++) {
      ctx.fillStyle = r % 2 ? "#151515" : "#181818";
      ctx.fillRect(0, oben() + r * SPUR, b, SPUR);
    }
    // alle Clips blass, dann die sichtbaren Teile kräftig (aus der Grundfolge: wer liegt oben)
    clips.forEach((c, i) => {
      const x = xVon(c.start);
      const w = c.laenge * px;
      if (x + w < 0 || x > b) return;
      const y = oben() + c.spur * SPUR;
      ctx.fillStyle = farbe(i, 18);
      ctx.fillRect(x, y + 1, w, SPUR - 2);
    });
    const ersterT = Math.max(0, Math.floor(fVon(0)));
    for (let g = sucheT(grund, ersterT); g < grund.length; g++) {
      const gr = grund[g];
      const x = xVon(gr.t);
      if (x > b) break;
      const c = clips[gr.clip];
      ctx.fillStyle = farbe(gr.clip, 38);
      ctx.fillRect(x, oben() + c.spur * SPUR + 1, Math.max(px, 1), SPUR - 2);
    }
    ctx.font = "11px sans-serif";
    clips.forEach((c, i) => {
      const x = xVon(c.start);
      const w = c.laenge * px;
      if (x + w < 0 || x > b) return;
      const y = oben() + c.spur * SPUR;
      if (c.id === gewaehlt) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 1.75, w - 1.5, SPUR - 3.5);
      }
      if (w > 30) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, SPUR);
        ctx.clip();
        ctx.fillStyle = "#eee";
        ctx.fillText(`${i + 1} ${c.name}`, Math.max(x, 0) + 4, y + 15);
        ctx.restore();
      }
    });

    // ---- Ergebnis ----
    const y0 = ergebnisOben();
    lineal(y0, folge.length, fps);
    const yB = y0 + LINEAL;
    const yI = yB + BILDER + 1;
    const yP = yI + ZEILE + 1;
    const N = daten.pakete.length;
    const von = Math.max(0, Math.floor(fVon(0)));
    const bis = Math.min(folge.length, Math.ceil(fVon(b)) + 1);
    // Vorschau: so viele Bildchen, wie nebeneinander passen
    const vb = daten.vorschau[0];
    const bildBreite = vb ? (BILDER * vb.width) / vb.height : BILDER;
    const schritt = Math.max(1, Math.ceil(bildBreite / px));
    for (let i = von - (von % schritt); i < bis; i += schritt) {
      const e = folge[i];
      const gm = s.gemosht?.get(i);
      const bild = gm ?? (e !== undefined && daten.vorschau[e >= N ? e - N : e]);
      if (!bild) continue;
      ctx.globalAlpha = gm ? 1 : 0.35; // noch nicht dekodiert: blass, das ist nur die Quelle
      ctx.drawImage(bild, xVon(i), yB, Math.min(bildBreite, schritt * px), BILDER);
      ctx.globalAlpha = 1;
    }
    // bei sehr kleinem Zoom: ein Bild pro Pixel genügt
    const jedes = Math.max(1, Math.floor(1 / px));
    for (let i = von; i < bis; i += jedes) {
      const e = folge[i];
      const p = paketVon(daten, e);
      const h = herkunft[i];
      const x = xVon(i);
      const w = Math.max(1, px - (px > 3 ? 1 : 0));
      if (!(e >= N || p.typ === "key")) {
        const wieder = h.art === "einschub" || (i > 0 && folge[i - 1] === e);
        ctx.fillStyle = wieder ? "#b26bff" : farbe(p.clip, 45);
        ctx.fillRect(x, yP, w, ZEILE);
      }
    }
    // I-Zeile und Schnitte in einem eigenen Durchgang über jedes Bild: auch weit herausgezoomt darf
    // kein Keyframe fehlen (sie sind selten, und genau um die geht es), mindestens 3 Pixel breit
    for (let i = von; i < bis; i++) {
      const e = folge[i];
      const h = herkunft[i];
      const istI = e >= N || daten.pakete[e].typ === "key";
      if (!istI && !h.iWeg && !h.schnitt) continue;
      const x = xVon(i);
      const w = Math.max(3, px - (px > 3 ? 1 : 0));
      if (h.schnitt && i > 0) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(x, yB, 1, BILDER + 2 * ZEILE + 2);
      }
      if (istI) {
        ctx.fillStyle = e >= N && !h.schnitt ? "#ff9a2e" : "#ff3b3b";
        ctx.fillRect(x, yI, w, ZEILE);
      }
      if (h.iWeg) {
        // gelöschter I-Frame: roter Rahmen
        ctx.strokeStyle = "#ff3b3b";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, yI + 0.5, Math.max(6, w) - 1, ZEILE - 1);
      }
    }
    if (auswahl) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.fillRect(xVon(auswahl[0]), y0, (auswahl[1] - auswahl[0] + 1) * px, LINEAL + BILDER + 2 * ZEILE + 2);
    }
    if (position >= 0) {
      ctx.fillStyle = "#4df";
      ctx.fillRect(xVon(position), y0, Math.max(2, px / 3), LINEAL + BILDER + 2 * ZEILE + 2);
      const t = herkunft[position]?.t;
      if (t !== undefined) ctx.fillRect(xVon(t), 0, Math.max(2, px / 3), ergebnisOben() - TRENN);
    }
    // Beschriftung rechts (links läge sie auf dem ersten I-Frame), mit dunklem Feld darunter
    ctx.font = "10px sans-serif";
    for (const [text, y] of [["Schnitt", LINEAL + spuren() * SPUR + 4], ["I", yI + 1], ["P", yP + 1]]) {
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(b - w, y, w, 12);
      ctx.fillStyle = "#bbb";
      ctx.fillText(text, b - w + 3, y + 10);
    }
  }

  // erstes Element der Grundfolge mit Zeit >= t (die Grundfolge ist nach t sortiert)
  function sucheT(grund, t) {
    let a = 0;
    let z = grund.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (grund[m].t < t) a = m + 1;
      else z = m;
    }
    return a;
  }
  // erstes Bild des Ergebnisses, das zur Zeit t des Schnitts gehört
  const bildZuZeit = (t) => Math.max(0, s.herkunft.findIndex((h) => h.t >= t));

  // ---------- Maus ----------

  function punkt(event) {
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  const bildBei = (x) => Math.max(0, Math.min(s.folge.length - 1, Math.floor(fVon(x))));

  // Clip unter dem Zeiger (im Schnitt-Teil), mit Rand: "links", "rechts" oder "mitte"
  function clipBei({ x, y }) {
    const spur = Math.floor((y - oben()) / SPUR);
    const f = fVon(x);
    const c = s.clips.find((c) => c.spur === spur && f >= c.start && f < ende(c));
    if (!c) return null;
    const rand = x - xVon(c.start) < 6 ? "links" : xVon(ende(c)) - x < 6 ? "rechts" : "mitte";
    return { c, rand };
  }

  // Einrasten: an Anfang und Ende anderer Clips, an der Stelle und an 0
  function raste(f, ohne) {
    const kanten = [0];
    for (const c of s.clips) if (c !== ohne) kanten.push(c.start, ende(c));
    const t = s.herkunft[position]?.t;
    if (t !== undefined) kanten.push(t);
    let best = f;
    let abstand = FANG / px;
    for (const k of kanten) {
      if (Math.abs(k - f) < abstand) {
        abstand = Math.abs(k - f);
        best = k;
      }
    }
    return Math.round(best);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!s.daten) return;
    canvas.setPointerCapture(event.pointerId);
    const pt = punkt(event);
    if (pt.y < ergebnisOben() - TRENN) {
      const treffer = pt.y >= oben() && clipBei(pt);
      if (treffer) {
        const { c, rand } = treffer;
        gewaehlt = c.id;
        beiClipWahl?.(c);
        zug = { art: rand, c, f0: fVon(pt.x), y0: pt.y, alt: { start: c.start, von: c.von, laenge: c.laenge, spur: c.spur } };
      } else {
        zug = null;
        const t = Math.floor(fVon(pt.x));
        if (s.herkunft.length) beiStelle(bildZuZeit(t));
      }
      zeichne();
      return;
    }
    const i = bildBei(pt.x);
    if (event.shiftKey && anker !== null) auswahl = [Math.min(anker, i), Math.max(anker, i)];
    else {
      anker = i;
      auswahl = [i, i]; // ein Klick wählt ein Bild (z. B. den Keyframe am Schnitt)
    }
    zug = { art: "auswahl" };
    zeichne();
  });

  canvas.addEventListener("pointermove", (event) => {
    const pt = punkt(event);
    if (!zug) {
      // Zeiger zeigt, was Ziehen tun würde
      const t = s.daten && pt.y >= oben() && pt.y < ergebnisOben() - TRENN && clipBei(pt);
      canvas.style.cursor = t ? (t.rand === "mitte" ? "grab" : "ew-resize") : "pointer";
      return;
    }
    if (zug.art === "auswahl") {
      const i = bildBei(pt.x);
      auswahl = [Math.min(anker, i), Math.max(anker, i)];
      zeichne();
      return;
    }
    const { c, alt } = zug;
    const d = fVon(pt.x) - zug.f0;
    const gesamt = c.bilderGesamt;
    if (zug.art === "mitte") {
      c.start = Math.max(0, raste(alt.start + d, c));
      // auch das Ende darf einrasten
      const e = raste(alt.start + d + alt.laenge, c);
      if (e !== Math.round(alt.start + d + alt.laenge)) c.start = Math.max(0, e - alt.laenge);
      c.spur = Math.floor((pt.y - oben()) / SPUR); // -1 = über der obersten: neue Spur
      c.spur = Math.max(-1, Math.min(spuren(), c.spur));
    } else if (zug.art === "links") {
      // linken Rand ziehen: Anfang abschneiden (oder wieder dazunehmen), das Ende bleibt stehen
      const neu = Math.min(raste(alt.start + d, c), alt.start + alt.laenge - 1);
      const um = Math.max(neu - alt.start, -alt.von);
      c.start = alt.start + um;
      c.von = alt.von + um;
      c.laenge = alt.laenge - um;
    } else {
      const neuesEnde = raste(alt.start + alt.laenge + d, c);
      c.laenge = Math.max(1, Math.min(neuesEnde - c.start, gesamt - c.von));
    }
    beiClip("ziehen");
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!zug) return;
    const war = zug;
    zug = null;
    if (war.art === "auswahl") {
      beiAuswahl(auswahl);
      beiStelle(bildBei(punkt(event).x));
    } else beiClip("fertig");
  });

  // am Handy übernimmt der Browser das waagerechte Wischen (scrollen) und bricht das Ziehen ab:
  // dann bleibt alles, wie es war (Clips verschiebt man dort mit „Clip an die Stelle“)
  canvas.addEventListener("pointercancel", () => {
    if (zug?.c) Object.assign(zug.c, zug.alt);
    if (zug) beiClip("fertig");
    zug = null;
  });

  // Mausrad: Strg zoomt um den Zeiger, sonst waagerecht scrollen
  rahmen.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const x = punkt(event).x;
        zoome(Math.exp(-event.deltaY * 0.01), x);
      } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        rahmen.scrollLeft += event.deltaY;
      }
    },
    { passive: false },
  );
  rahmen.addEventListener("scroll", zeichne);
  new ResizeObserver(zeichne).observe(rahmen);

  // zoomen, so dass das Bild unter x an seinem Platz bleibt
  function zoome(faktor, x = rahmen.clientWidth / 2) {
    const f = fVon(x);
    px = Math.max(0.02, Math.min(40, px * faktor));
    masse();
    rahmen.scrollLeft = f * px - x;
    zeichne();
  }

  function sichtbar(i) {
    const x = i * px;
    if (x < rahmen.scrollLeft || x > rahmen.scrollLeft + rahmen.clientWidth - 20) rahmen.scrollLeft = x - rahmen.clientWidth / 3;
  }

  return {
    zeige(neu) {
      s = neu;
      if (auswahl && auswahl[1] >= s.folge.length) auswahl = null;
      zeichne();
    },
    markiere(i) {
      position = i;
      sichtbar(i);
      zeichne();
    },
    stelle: () => position,
    auswahl: () => auswahl,
    setzeAuswahl(a) {
      auswahl = a;
      beiAuswahl(a);
      zeichne();
    },
    hebeAuf() {
      auswahl = null;
      beiAuswahl(null);
      zeichne();
    },
    zoome,
    ganz() {
      px = Math.max(0.02, Math.min(40, (rahmen.clientWidth - 40) / Math.max(1, schnittLaenge(), s.folge.length)));
      rahmen.scrollLeft = 0;
      zeichne();
    },
    gewaehlt: () => s.clips.find((c) => c.id === gewaehlt) ?? null,
    // Tasten (main.js leitet sie weiter, wenn kein Eingabefeld den Fokus hat): true = verarbeitet
    taste(event) {
      if (!s.daten) return false;
      const letzte = s.folge.length - 1;
      const gehe = (i) => beiStelle(Math.max(0, Math.min(letzte, i)));
      const p = Math.max(0, position);
      const taste = event.key;
      if (taste === "ArrowRight") gehe(p + (event.shiftKey ? 10 : 1));
      else if (taste === "ArrowLeft") gehe(p - (event.shiftKey ? 10 : 1));
      else if (taste === "Home") gehe(0);
      else if (taste === "End") gehe(letzte);
      else if (taste === "a" || taste === "A") this.setzeAuswahl([p, Math.max(p, auswahl?.[1] ?? p)]);
      else if (taste === "b" || taste === "B") this.setzeAuswahl([Math.min(p, auswahl?.[0] ?? p), p]);
      else if (taste === "Escape") this.hebeAuf();
      else return false;
      return true;
    },
  };
}
