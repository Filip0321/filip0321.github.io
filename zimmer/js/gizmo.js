// Gizmo im Bearbeiten-Modus, wie in Blender: am gewählten Gegenstand (oder an einer gewählten Ecke seiner Fläche)
//   drei Pfeile    ziehen verschiebt nur entlang dieser Achse (x rot, y grün, z blau)
//   drei Ringe     ziehen dreht die Fläche um diese Achse (nur bei Flächen, nicht bei einer einzelnen Ecke)
//   Quadrat        ziehen skaliert (weg von der Mitte: größer); beim Kreis ändert es den Radius
// Tasten wie in Blender: G (verschieben), R (drehen), S (skalieren) folgen der Maus; danach X, Y oder Z legt eine
// Achse fest. Klick oder Enter bestätigt, Esc oder Rechtsklick bricht ab. Esc ohne laufenden Zug: wieder den ganzen
// Gegenstand wählen statt einer Ecke. E: neue Ecke nach der gewählten (gleich an der Maus, wie Extrudieren),
// Entf oder X: gewählte Ecke löschen.
//
// Außerdem zeichnet er im Bearbeiten-Modus alle Flächen als Umriss (Hilfsflächen gestrichelt; ein Klick auf einen
// Umriss wählt sie) und den 3D-Cursor (rot-weißer Ring; Umschalt + Rechtsklick setzt ihn, bearbeiten.js).
//
// Wie aus einer Mausbewegung eine Bewegung im Raum wird:
//   Verschieben entlang Achse a: Der Pfeil ist auf dem Bildschirm die Strecke s von der Mitte zur Pfeilspitze, im
//     Raum ist er L lang. Die Maus ist um m weitergerückt; davon zählt nur der Teil in Pfeilrichtung:
//       t = (m · s) / |s|² · L
//     und der Punkt rückt um t · a. (So bleibt die Pfeilspitze unter der Maus, solange man entlang des Pfeils zieht.)
//   Verschieben frei (G ohne Achse): in der Bildebene der Kamera. Ein CSS-Pixel ist dort Tiefe / (Brennweite · Faktor)
//     lang; die Richtungen „rechts“ und „oben“ sind die ersten zwei Zeilen der Ansichtsmatrix.
//   Drehen um Achse a: der Winkel, um den die Maus um die Mitte (auf dem Bildschirm) gewandert ist. Auf dem
//     Bildschirm zeigt y nach unten, ein wachsender Winkel atan2(y, x) läuft also im Uhrzeigersinn. Eine positive
//     Drehung um eine Achse, die zur Kamera zeigt, läuft aber gegen den Uhrzeigersinn (Rechte-Hand-Regel). Darum:
//     Achse zur Kamera → Winkel mit −1, Achse von der Kamera weg → mit +1. Gedreht wird mit der Formel von Rodrigues
//     (flaeche.js).
//   Skalieren: Abstand der Maus zur Mitte jetzt / am Anfang.
// Gerechnet wird immer vom Zustand beim Anfassen aus, nicht Schritt für Schritt: so sammeln sich keine Rundungsfehler,
// und Abbrechen stellt einfach den alten Zustand wieder her.

import { z, neu, aktiveKamera, zeige } from "./zustand.js";
import { formAktualisieren, dingZurueck, istBildschirm } from "./dinge.js";
import { plus, minus, mal, punkt, dreheUm, einheit, ordneEcken, flaechenPunkt } from "./flaeche.js";

const svg = document.getElementById("gizmo");
const ACHSEN = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const NAMEN = ["x", "y", "z"];
const PFEIL = 70; // CSS-Pixel

let ecke = null; // gewählte Ecke der Fläche (Nummer) oder null: der ganze Gegenstand
let zug = null; // { art, achse, maus0, vorher, mitte0, schirm0, L, modal }
const maus = { x: 0, y: 0 }; // letzte Mausposition (für G, R, S von der Tastatur)

const faktor = () => z.canvas.clientWidth / z.canvas.width;
function aufSchirm(p) {
  const k = aktiveKamera();
  const q = k.aufBildschirm(p, z.canvas.width, z.canvas.height);
  return q ? { x: q.x * faktor(), y: q.y * faktor(), tiefe: q.tiefe } : null;
}
const istFlaeche = (d) => d.form === "flaeche" && (d.punkte?.length ?? 0) >= 3;
const mitteVon = (d) => (ecke !== null && d.punkte?.[ecke] ? d.punkte[ecke] : d.lage);
// Länge eines Pfeils im Raum, damit er auf dem Bildschirm PFEIL Pixel lang ist
const pfeilLaenge = (q) => (PFEIL / faktor()) * (q.tiefe / aktiveKamera().fokus);

export function waehleEcke(i) {
  ecke = i;
  neu();
}
z.gizmoEckeLoesen = () => waehleEcke(null);

// ---------- Zeichnen (in jedem Bild aus main.js) ----------
export function zeichneGizmo() {
  const d = z.gewaehlt;
  if (!z.bearbeiten || z.draufsicht || z.zeig) {
    if (!svg.hasAttribute("hidden")) svg.setAttribute("hidden", "");
    return;
  }
  svg.removeAttribute("hidden");
  const teile = [];
  // alle Flächen als Umriss (die gewählte kräftig), Hilfsflächen ohne Link gestrichelt; gewölbte Bildschirme gebogen
  const k = aktiveKamera();
  z.dinge.forEach((ding, i) => {
    if (ding.form !== "flaeche" || (ding.punkte?.length ?? 0) < 2) return;
    let pfad;
    if (istBildschirm(ding) && ding.woelbung) {
      const { ecken, normale } = ordneEcken(ding.punkte, k.auge, k.achsen().oben);
      const kante = (v) => Array.from({ length: 17 }, (_, j) => flaechenPunkt(ecken, normale, v ? 1 - j / 16 : j / 16, v, ding.woelbung));
      pfad = [...kante(0), ...kante(1)].map(aufSchirm);
    } else pfad = ding.punkte.map(aufSchirm);
    if (pfad.some((e) => !e)) return;
    const punkte = pfad.map((e) => `${e.x},${e.y}`).join(" ");
    const art = `objekt${ding === d ? " gewaehlt" : ""}${ding.link ? "" : " hilf"}`;
    teile.push(`<polygon class="${art}" points="${punkte}"/><polygon class="objekt-griff" points="${punkte}" data-ding="${i}"><title>${ding.name || "Fläche"}</title></polygon>`);
  });
  // 3D-Cursor
  const cur = z.cursor && aufSchirm(z.cursor);
  if (cur) teile.push(`<g class="cursor"><circle cx="${cur.x}" cy="${cur.y}" r="9"/><circle class="innen" cx="${cur.x}" cy="${cur.y}" r="9"/>` +
    `<line x1="${cur.x - 15}" y1="${cur.y}" x2="${cur.x - 5}" y2="${cur.y}"/><line x1="${cur.x + 5}" y1="${cur.y}" x2="${cur.x + 15}" y2="${cur.y}"/>` +
    `<line x1="${cur.x}" y1="${cur.y - 15}" x2="${cur.x}" y2="${cur.y - 5}"/><line x1="${cur.x}" y1="${cur.y + 5}" x2="${cur.x}" y2="${cur.y + 15}"/></g>`);
  if (!d) {
    svg.innerHTML = teile.join("");
    return;
  }
  if (ecke !== null && !d.punkte?.[ecke]) ecke = null;
  const c = mitteVon(d), cs = aufSchirm(c);
  if (!cs) {
    svg.innerHTML = teile.join("");
    return;
  }
  const L = pfeilLaenge(cs);
  // Ecken zum Anklicken (und der Kreis beim Kreis-Gegenstand)
  if (d.punkte?.length) {
    const ecken = d.punkte.map(aufSchirm);
    if (ecken.every(Boolean)) {
      if (ecken.length === 2) teile.push(`<polyline class="umriss" points="${ecken.map((e) => `${e.x},${e.y}`).join(" ")}"/>`);
      ecken.forEach((e, i) => teile.push(`<circle class="ecke${i === ecke ? " gewaehlt" : ""}" cx="${e.x}" cy="${e.y}" r="6" data-ecke="${i}"><title>Ecke ${i + 1}</title></circle>`));
    }
  }
  if (!istFlaeche(d)) {
    const r = (d.radius * aktiveKamera().fokus * faktor()) / cs.tiefe;
    teile.push(`<circle class="umriss" cx="${cs.x}" cy="${cs.y}" r="${r}"/>`);
  }
  // Ringe zum Drehen (nur für die ganze Fläche)
  if (ecke === null && istFlaeche(d)) {
    ACHSEN.forEach((a, i) => {
      // zwei Richtungen senkrecht zur Achse, dann ein Kreis aus 48 Stücken
      const u = einheit(Math.abs(a[1]) < 0.9 ? [a[2], 0, -a[0]] : [1, 0, 0]);
      const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
      const pk = [];
      for (let j = 0; j <= 48; j++) {
        const w = (j / 48) * 2 * Math.PI;
        const q = aufSchirm(plus(c, plus(mal(u, Math.cos(w) * L * 0.8), mal(v, Math.sin(w) * L * 0.8))));
        if (q) pk.push(`${q.x},${q.y}`);
      }
      teile.push(`<polyline class="ring achse-${NAMEN[i]}" points="${pk.join(" ")}" data-art="drehen" data-achse="${i}"/>`);
    });
  }
  // Pfeile zum Verschieben
  ACHSEN.forEach((a, i) => {
    const q = aufSchirm(plus(c, mal(a, L)));
    if (!q) return;
    teile.push(`<g class="pfeil achse-${NAMEN[i]}" data-art="schieben" data-achse="${i}"><line x1="${cs.x}" y1="${cs.y}" x2="${q.x}" y2="${q.y}"/>` +
      `<circle cx="${q.x}" cy="${q.y}" r="9"/><text x="${q.x}" y="${q.y + 4}">${NAMEN[i]}</text></g>`);
  });
  // Quadrat zum Skalieren (nicht für eine einzelne Ecke)
  if (ecke === null) teile.push(`<rect class="skalieren" x="${cs.x - 7}" y="${cs.y - 7}" width="14" height="14" data-art="skalieren"><title>skalieren</title></rect>`);
  svg.innerHTML = teile.join("");
}

// ---------- Anfassen, Bewegen, Loslassen ----------
function beginne(art, achse, modal) {
  const d = z.gewaehlt;
  const c = mitteVon(d), cs = aufSchirm(c);
  if (!cs) return;
  if (art !== "schieben" && ecke !== null) return zeige("Eine einzelne Ecke lässt sich nur verschieben.", 2500);
  zug = { art, achse, modal, maus0: { ...maus }, mitte0: [...c], schirm0: cs, L: pfeilLaenge(cs),
    vorher: { lage: [...d.lage], radius: d.radius, punkte: d.punkte?.map((p) => [...p]) } };
  if (modal) zeige(`${{ schieben: "verschieben", drehen: "drehen", skalieren: "skalieren" }[art]}: X, Y oder Z für eine Achse; Klick oder Enter: fertig, Esc: abbrechen`);
}

function anwenden() {
  const d = z.gewaehlt, { art, achse, maus0, mitte0, schirm0, L, vorher } = zug;
  const k = aktiveKamera();
  const dx = maus.x - maus0.x, dy = maus.y - maus0.y;
  // jeder Punkt der Form wird von seinem Zustand beim Anfassen aus umgerechnet
  let wandle;
  if (art === "schieben") {
    let v;
    if (achse !== null) {
      const a = ACHSEN[achse], spitze = aufSchirm(plus(mitte0, mal(a, L)));
      if (!spitze) return;
      const sx = spitze.x - schirm0.x, sy = spitze.y - schirm0.y;
      v = mal(a, ((dx * sx + dy * sy) / (sx * sx + sy * sy || 1)) * L);
    } else {
      const m = k.ansicht, s = schirm0.tiefe / (k.fokus * faktor());
      v = plus(mal([m[0], m[4], m[8]], dx * s), mal([m[1], m[5], m[9]], -dy * s));
    }
    wandle = (p) => plus(p, v);
  } else if (art === "drehen") {
    const a = achse !== null ? ACHSEN[achse] : einheit(minus(k.auge, mitte0));
    const w0 = Math.atan2(maus0.y - schirm0.y, maus0.x - schirm0.x), w1 = Math.atan2(maus.y - schirm0.y, maus.x - schirm0.x);
    const vorzeichen = punkt(a, minus(k.auge, mitte0)) >= 0 ? -1 : 1;
    wandle = (p) => dreheUm(p, mitte0, a, (w1 - w0) * vorzeichen);
  } else {
    const f = Math.max(0.01, Math.hypot(maus.x - schirm0.x, maus.y - schirm0.y) / Math.max(10, Math.hypot(maus0.x - schirm0.x, maus0.y - schirm0.y)));
    if (!istFlaeche(d)) {
      d.radius = Math.max(0.01, vorher.radius * f);
      return fertigRechnen(d);
    }
    const a = achse !== null ? ACHSEN[achse] : null;
    wandle = (p) => {
      const v = minus(p, mitte0);
      return a ? plus(p, mal(a, punkt(v, a) * (f - 1))) : plus(mitte0, mal(v, f));
    };
  }
  if (ecke !== null) d.punkte[ecke] = wandle(vorher.punkte[ecke]);
  else if (d.punkte?.length) d.punkte = vorher.punkte.map(wandle);
  if (ecke === null && !istFlaeche(d)) d.lage = wandle(vorher.lage);
  fertigRechnen(d);
}

function fertigRechnen(d) {
  formAktualisieren(d);
  dingZurueck(d);
  neu();
}

function beende(abbrechen) {
  if (!zug) return;
  const d = z.gewaehlt;
  if (abbrechen) {
    d.lage = zug.vorher.lage;
    d.radius = zug.vorher.radius;
    if (zug.vorher.punkte) d.punkte = zug.vorher.punkte;
    fertigRechnen(d);
  }
  zug = null;
  zeige("");
  z.felderAktualisieren?.();
}

svg.addEventListener("pointerdown", (ev) => {
  const griff = ev.target.closest("[data-art], [data-ecke], [data-ding]");
  if (!griff || zug || ev.button === 2) return;
  if (griff.dataset.ding !== undefined) {
    // Klick auf einen Umriss: diese Fläche wählen
    ev.stopPropagation();
    z.waehle?.(z.dinge[Number(griff.dataset.ding)]);
    return;
  }
  ev.stopPropagation();
  ev.preventDefault();
  maus.x = ev.clientX - svg.getBoundingClientRect().left;
  maus.y = ev.clientY - svg.getBoundingClientRect().top;
  if (griff.dataset.ecke !== undefined) {
    waehleEcke(Number(griff.dataset.ecke));
    beginne("schieben", null, false); // eine Ecke gleich frei ziehen können
  } else beginne(griff.dataset.art, griff.dataset.achse !== undefined ? Number(griff.dataset.achse) : null, false);
  if (zug) svg.setPointerCapture(ev.pointerId);
});
svg.addEventListener("pointerup", () => !zug?.modal && beende(false));
svg.addEventListener("pointercancel", () => !zug?.modal && beende(true));

// Mausposition immer mitschreiben (relativ zur Bühne), für Ziehen und für G, R, S
window.addEventListener("pointermove", (ev) => {
  const r = svg.getBoundingClientRect();
  maus.x = ev.clientX - r.left;
  maus.y = ev.clientY - r.top;
  if (zug) anwenden();
}, true);
// beim Zug von der Tastatur: der nächste Klick bestätigt (rechts: bricht ab) und geht nicht weiter ans Bild
window.addEventListener("pointerdown", (ev) => {
  if (!zug?.modal) return;
  ev.stopPropagation();
  ev.preventDefault();
  beende(ev.button === 2);
}, true);
window.addEventListener("contextmenu", (ev) => z.bearbeiten && z.gewaehlt && !svg.hasAttribute("hidden") && zug && ev.preventDefault(), true);

// capture: vor den anderen Tasten-Lauschern (Esc schließt sonst auch das Zeigen, X … gehen sonst weiter)
window.addEventListener("keydown", (ev) => {
  if (!z.bearbeiten || !z.gewaehlt || z.draufsicht || z.fliegt || ev.target.closest?.("input, textarea, select")) return;
  const taste = ev.key.toLowerCase();
  if (zug) {
    if (taste === "x" || taste === "y" || taste === "z") {
      const i = NAMEN.indexOf(taste);
      zug.achse = zug.achse === i ? null : i; // noch einmal: Achse wieder frei
      anwenden();
    } else if (taste === "enter") beende(false);
    else if (taste === "escape") beende(true);
    ev.preventDefault();
    ev.stopImmediatePropagation();
    return;
  }
  if ((taste === "delete" || taste === "backspace" || taste === "x") && ecke !== null) {
    // gewählte Ecke löschen
    const d = z.gewaehlt;
    d.punkte.splice(ecke, 1);
    if (!d.punkte.length) delete d.punkte;
    ecke = d.punkte?.length ? Math.max(0, ecke - 1) : null;
    fertigRechnen(d);
    z.felderAktualisieren?.();
  } else if (taste === "e") {
    // neue Ecke nach der gewählten (oder hinten an), an derselben Stelle, und gleich verschieben
    const d = z.gewaehlt;
    d.form = "flaeche";
    d.punkte ??= [];
    const von = ecke !== null ? d.punkte[ecke] : z.cursor ?? d.lage;
    const i = ecke !== null ? ecke + 1 : d.punkte.length;
    d.punkte.splice(i, 0, [...von]);
    ecke = i;
    fertigRechnen(d);
    z.felderAktualisieren?.();
    beginne("schieben", null, true);
  } else if (taste === "g") beginne("schieben", null, true);
  else if (taste === "r") beginne("drehen", null, true);
  else if (taste === "s") beginne("skalieren", null, true);
  else if (taste === "escape" && ecke !== null) waehleEcke(null);
  else return;
  ev.preventDefault();
}, true);

export const zugLaeuft = () => !!zug;
