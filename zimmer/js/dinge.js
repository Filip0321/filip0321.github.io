// Die Gegenstände: jeder ist ein unsichtbarer Link über dem Bild (Tab, Enter, Rechtsklick und Strg+Klick gehen wie
// bei jedem Link). Ein Gegenstand ohne Link ist nur ein Hilfsobjekt (z. B. eine unsichtbare Wand zum Abgrenzen): keine
// Klickfläche, aber im Bearbeiten-Modus zu sehen, als Ebene zum Setzen von Ecken und als Grenze beim Herumgehen.
//
// Form („form“):
//   kreis    so groß, wie seine Kugel (lage, radius) gerade auf dem Bildschirm erscheint
//   flaeche  ein Vieleck aus Punkten im Raum („punkte“); mit genau vier Ecken auch ein Bildschirm, gern gewölbt
//            („woelbung“, Meter: so weit liegt die Mitte hinter den Rändern). Die Klickfläche ist ein Kind des Links
//            mit clip-path: polygon(…); clip-path schneidet auch die Fläche ab, die auf Maus und Finger reagiert.
// Unter der Maus leuchtet er im Bild auf (zeichnen.js, über die Kugel um seine Mitte).
//
// Was ein Klick tut, vier unabhängige Einstellungen:
//   kamera   keine (bleibt, wo sie ist) · kreisen (um ihn herum, im Bogen) · senkrecht (frontal davor, aus der
//            Normale der Fläche; beim Kreis aus den Splats ringsum geschätzt) · blick (der gespeicherte „blick“)
//   auf      nichts · video · bild: läuft auf der Fläche (vier Ecken), als Objekt IN der Szene, solange er gezeigt
//            wird, auch während die Kamera kreist („quelle“; ohne Angabe vorschau.webm oder vorschau.webp im Ordner
//            des Links)
//   tafel    text (Name, Text und Knöpfe) · knapp (nur Name und Knöpfe) · aus
//   danach   was der zweite Klick tut: link (die Seite öffnen) · seite (die Seite erst auf der Fläche zeigen, scrollbar;
//            der dritte Klick, „öffnen →“, geht dann ganz hinein)
// Ist bei kamera „keine“, bei auf „nichts“, keine Tafel mit Text und danach „link“, führt schon der erste Klick hin.
// Klick daneben, Esc oder „zurück“ → zurück zum Blick davor.
//
// Fliegen heißt hier: die Zahlen der Kamera (Ziel, Abstand, Gier, Nick, Sichtfeld, Versatz) gleiten vom Anfang zum
// Ziel, mit „ease in out“ (langsam los, schnell, langsam an):  e(t) = t < ½ ? 4t³ : 1 − (−2t + 2)³ / 2
// Das geht auch vom Rundblick aus: dort ist der Abstand 0 und das Ziel das Auge. Wächst der Abstand, rückt das Auge
// vom Ziel weg, und das Ziel wandert zum Gegenstand: die Kamera tritt aus dem Mittelpunkt heraus und fliegt hin.
//
// Kreisen um die ganze Rückseite zeigt, was der Scan nie gesehen hat (dort ist der Scan leer oder verschmiert).
// Darum schwenkt die Kamera standardmäßig nur in einem Bogen (bogen, Grad; 360 oder mehr: ganz herum).
// Wer im System „weniger Bewegung“ eingestellt hat, bekommt keine Fahrt und kein Kreisen, nur Text und Link.

import { z, neu, art, aktiveKamera } from "./zustand.js";
import { erstelleKamera } from "./kamera.js";
import { homographie, mitteVon, radiusVon, normaleVon, ordneEcken, gitter, ausschnitt, minus, punkt, laenge, einheit } from "./flaeche.js";
import { jacobi } from "./ausrichten.js";

const blende = document.getElementById("blende");
const tafel = document.getElementById("erklaerung");
const fensterEbene = document.getElementById("fenster"); // nimmt die Seite auf, die auf einer Fläche gezeigt wird
const wenigBewegung = matchMedia("(prefers-reduced-motion: reduce)");
let fahrt = null; // { k, vorher, nachher, start, dauer, danach }
let gezeigt = null; // { ding, schritt (1 gezeigt, 2 Seite offen), mitteGier, start, ruheBis, vorher, angekommen, inhalt, seite }

// ---------- Daten ----------
const istFlaeche = (d) => d.form === "flaeche" && (d.punkte?.length ?? 0) >= 3;
export const istBildschirm = (d) => d.form === "flaeche" && d.punkte?.length === 4; // vier Ecken: Bild, Video, Seite

// ältere zimmer.json (Runde 9: „art“, „inhalt“, „video“) in die vier Einstellungen übersetzen, Standardwerte setzen
export function normalisiere(d) {
  if (d.art !== undefined || d.inhalt !== undefined) {
    const alt = d.art ?? (d.text ? "kreisen" : "direkt");
    d.kamera ??= { direkt: "keine", kreisen: "kreisen", stehen: d.blick ? "blick" : "senkrecht", fenster: d.blick ? "blick" : "senkrecht" }[alt];
    if (alt === "fenster") {
      if (d.inhalt === "video") d.auf ??= "video";
      else d.danach ??= "seite";
    }
    if (d.video) d.quelle ??= d.video;
    delete d.art;
    delete d.inhalt;
    delete d.video;
  }
  d.form ??= "kreis";
  d.kamera ??= d.text ? "kreisen" : "keine";
  d.auf ??= "nichts";
  d.tafel ??= "text";
  d.danach ??= "link";
  return formAktualisieren(d);
}

// geänderte Daten eines Gegenstands zurück in die Einstellungen (zimmer.json), ohne die Elemente der Seite
export function dingZurueck(d) {
  const i = z.dinge.indexOf(d);
  if (i < 0) return;
  const { element, treffer, ...daten } = d;
  z.einst.dinge[i] = daten;
}

// Mitte und Größe einer Fläche aus ihren Punkten (nach jedem Ändern der Punkte, auch aus bearbeiten.js und gizmo.js)
export function formAktualisieren(d) {
  if (!istFlaeche(d)) return d;
  d.lage = mitteVon(d.punkte);
  d.radius = radiusVon(d.punkte, d.lage);
  return d;
}

export const quelleVon = (d) => d.quelle || (d.link?.endsWith("/") ? `${d.link}vorschau.${d.auf === "bild" ? "webp" : "webm"}` : "");
const fuehrtDirekt = (d) => d.kamera === "keine" && d.auf === "nichts" && !(d.text && d.tafel === "text") && d.danach !== "seite";

// ---------- Aufbauen und in jedem Bild platzieren ----------
export function baueDinge() {
  z.ebene.replaceChildren();
  z.dinge = (z.einst.dinge ?? []).map((roh) => {
    const ding = normalisiere({ ...roh, element: null, treffer: null });
    if (!ding.link) return ding; // Hilfsobjekt: nichts zum Klicken
    const a = document.createElement("a");
    a.className = "zimmer-ding";
    a.href = ding.link;
    a.append(document.createElement("span"));
    a.firstChild.textContent = ding.name;
    const treffer = document.createElement("i"); // die Fläche, die auf Maus und Finger reagiert (Kreis oder Vieleck)
    treffer.className = "treffer";
    a.append(treffer);
    Object.assign(ding, { element: a, treffer });
    const an = () => {
      z.hervor = ding;
      neu();
    };
    const aus = () => {
      if (z.hervor === ding && gezeigt?.ding !== ding) z.hervor = null;
      neu();
    };
    a.addEventListener("pointerenter", an);
    a.addEventListener("pointerleave", aus);
    a.addEventListener("focus", an);
    a.addEventListener("blur", aus);
    a.addEventListener("click", (ev) => {
      if (z.bearbeiten) {
        // im Bearbeiten-Modus wählt ein Klick den Gegenstand aus, statt wegzuführen
        ev.preventDefault();
        z.waehle?.(ding);
        return;
      }
      // Strg, Umschalt, Mittelklick …: wie ein normaler Link (neuer Tab, neues Fenster)
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      ev.preventDefault();
      if (fahrt) return;
      if (gezeigt?.ding === ding) weiter();
      else if (fuehrtDirekt(ding)) oeffne(ding);
      else zeigeDing(ding);
    });
    z.ebene.append(a);
    return ding;
  });
  // in die Einstellungen zurück, was normalisiert wurde (sonst bliebe die alte Schreibweise in der kopierten JSON)
  z.dinge.forEach(dingZurueck);
  z.ebene.classList.toggle("immer", z.einst.beschriftung === "immer");
  z.zeigeListe?.();
}

export function platziereDinge(k) {
  const faktor = z.canvas.clientWidth / z.canvas.width; // CSS-Pixel pro Bildpixel
  const w = z.canvas.width, h = z.canvas.height;
  const B = w * faktor, H = h * faktor;
  for (const d of z.dinge) {
    if (!d.element) continue;
    const p = k.aufBildschirm(d.lage, w, h);
    if (!p || fahrt) {
      d.element.hidden = true;
      continue;
    }
    // Rechteck, das den Gegenstand umschließt (CSS-Pixel), und die Form der Klickfläche darin
    let x0, y0, x1, y1;
    if (istFlaeche(d)) {
      // vier Ecken: in der Reihenfolge rundherum (egal, wie sie gesetzt wurden); sonst so, wie gesetzt
      const reihe = istBildschirm(d) ? ordneEcken(d.punkte, k.auge, k.achsen().oben).ecken : d.punkte;
      const ecken = reihe.map((q) => k.aufBildschirm(q, w, h));
      if (ecken.some((e) => !e)) {
        d.element.hidden = true; // eine Ecke hinter der Kamera: die Fläche wäre verdreht
        continue;
      }
      const xs = ecken.map((e) => e.x * faktor), ys = ecken.map((e) => e.y * faktor);
      [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      d.treffer.style.clipPath = `polygon(${xs.map((x, i) => `${x - x0}px ${ys[i] - y0}px`).join(",")})`;
      d.treffer.style.borderRadius = "0";
    } else {
      const r = Math.max(14, ((d.radius * k.fokus) / p.tiefe) * faktor);
      [x0, x1, y0, y1] = [p.x * faktor - r, p.x * faktor + r, p.y * faktor - r, p.y * faktor + r];
      d.treffer.style.clipPath = "";
      d.treffer.style.borderRadius = "";
    }
    d.element.hidden = x1 < 0 || x0 > B || y1 < 0 || y0 > H;
    d.element.style.transform = `translate(${x0}px, ${y0}px)`;
    d.element.style.width = `${x1 - x0}px`;
    d.element.style.height = `${y1 - y0}px`;
    d.element.classList.toggle("gewaehlt", d === z.gewaehlt);
    d.element.classList.toggle("gezeigt", d === gezeigt?.ding);
  }
  platziereSeite(k);
  platziereTafel(k);
}

// Die Tafel: mit Text neben dem Gegenstand, oben auf seiner Höhe, auf der Seite mit mehr Platz; knapp (oder bei einer
// offenen Seite) unter der Fläche, sonst darüber. Passt sie nirgends hin (Handy hochkant), liegt sie unten über die
// ganze Breite (so steht es in zimmer.css).
const ABSTAND = 16; // CSS-Pixel zwischen Gegenstand und Tafel und zum Rand
function platziereTafel(k) {
  if (!gezeigt || tafel.hidden) return;
  const d = gezeigt.ding;
  const faktor = z.canvas.clientWidth / z.canvas.width, w = z.canvas.width, h = z.canvas.height;
  const p = k.aufBildschirm(d.lage, w, h);
  const B = z.canvas.clientWidth, H = z.canvas.clientHeight;
  const breite = Math.min(416, B - 2 * ABSTAND); // 26rem
  const unten = () => {
    tafel.classList.remove("seitlich");
    tafel.style.left = tafel.style.top = tafel.style.width = "";
  };
  if (!p) return unten();
  const hoehe = tafel.offsetHeight;
  if (istFlaeche(d) && (tafel.classList.contains("knapp") || gezeigt.seite)) {
    const ecken = d.punkte.map((q) => k.aufBildschirm(q, w, h));
    if (ecken.some((e) => !e)) return unten();
    const xs = ecken.map((e) => e.x * faktor), ys = ecken.map((e) => e.y * faktor);
    const oben = Math.max(...ys) + ABSTAND <= H - hoehe - ABSTAND ? Math.max(...ys) + ABSTAND
      : Math.min(...ys) - ABSTAND - hoehe >= ABSTAND ? Math.min(...ys) - ABSTAND - hoehe : null;
    if (oben === null) return unten();
    tafel.classList.add("seitlich");
    const mitte = (Math.min(...xs) + Math.max(...xs)) / 2;
    tafel.style.left = `${Math.max(ABSTAND, Math.min(B - breite - ABSTAND, mitte - breite / 2))}px`;
    tafel.style.top = `${oben}px`;
    tafel.style.width = `${breite}px`;
    return;
  }
  const x = p.x * faktor, y = p.y * faktor;
  const r = Math.min(((d.radius * k.fokus) / p.tiefe) * faktor, Math.min(B, H) / 2);
  const rechts = B - (x + r), links = x - r;
  const seite = rechts >= links ? "rechts" : "links";
  if (Math.max(rechts, links) < breite + 2 * ABSTAND) return unten();
  tafel.classList.add("seitlich");
  tafel.style.left = `${seite === "rechts" ? x + r + ABSTAND : x - r - ABSTAND - breite}px`;
  tafel.style.top = `${Math.max(ABSTAND, Math.min(H - hoehe - ABSTAND, y - r))}px`; // oben bündig mit dem Gegenstand
  tafel.style.width = `${breite}px`;
}

// ---------- Kamera: Zahlen lesen, schreiben, mischen ----------
const sanft = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function zustandVon(k) {
  return { ziel: [...k.ziel], gier: k.gier + k.extraGier, nick: k.nick + k.extraNick, abstand: k.abstand, sichtfeld: k.sichtfeld, versatzX: k.versatzX, versatzY: k.versatzY };
}

function fliege(k, nachher, dauer, danach) {
  const vorher = zustandVon(k);
  k.extraGier = k.extraNick = 0;
  // Gier auf dem kürzeren Weg herum
  let g = nachher.gier;
  while (g - vorher.gier > Math.PI) g -= 2 * Math.PI;
  while (g - vorher.gier < -Math.PI) g += 2 * Math.PI;
  fahrt = { k, vorher, nachher: { ...nachher, gier: g }, start: performance.now(), dauer: wenigBewegung.matches ? 1 : dauer, danach };
  neu();
}

// in jedem Bild aus main.js: laufende Fahrt weiter, sonst beim Zeigen kreisen
export function fahrtSchritt(jetzt) {
  if (fahrt) {
    const t = Math.min(1, (jetzt - fahrt.start) / fahrt.dauer);
    const e = sanft(t);
    const { k, vorher: a, nachher: b } = fahrt;
    const misch = (x, y) => x + (y - x) * e;
    k.ziel = a.ziel.map((v, i) => misch(v, b.ziel[i]));
    for (const n of ["gier", "nick", "abstand", "sichtfeld", "versatzX", "versatzY"]) k[n] = misch(a[n], b[n]);
    neu();
    if (t >= 1) {
      const danach = fahrt.danach;
      fahrt = null;
      danach?.();
    }
    return;
  }
  if (gezeigt?.ding.kamera === "kreisen" && gezeigt.schritt === 1 && gezeigt.angekommen && !wenigBewegung.matches && jetzt > gezeigt.ruheBis) {
    // kreisen: im Bogen hin und her (Sinus: an den Enden langsam), ab 360° einfach weiter
    const bogen = ((gezeigt.ding.bogen ?? 50) * Math.PI) / 180;
    const t = (jetzt - gezeigt.start) / 1000;
    if (bogen >= 2 * Math.PI - 1e-6) z.zeig.gier = gezeigt.mitteGier + t * 0.25;
    else {
      const periode = Math.max(6, (bogen * 180) / Math.PI / 5); // Sekunden für einmal hin und zurück (50° → 10 s)
      z.zeig.gier = gezeigt.mitteGier + (bogen / 2) * Math.sin((2 * Math.PI * t) / periode);
    }
    neu();
  }
  if (gezeigt?.inhalt instanceof HTMLVideoElement) neu(); // das Video läuft: jedes Bild neu
}

// ---------- Wohin die Kamera beim Zeigen fliegt ----------
const tafelMitText = (d) => d.tafel === "text" && !!d.text;
// Versatz der Bildmitte (wie ein Shift-Objektiv): Platz für die Tafel daneben (breit) oder darunter (hochkant)
function versatzFuer(d) {
  if (!tafelMitText(d)) return { versatzX: 0, versatzY: d.tafel === "aus" ? 0 : 0.12 };
  return z.canvas.clientWidth >= 2 * 416 + 64 ? { versatzX: -0.38, versatzY: 0 } : { versatzX: 0, versatzY: 0.3 };
}

// kreisen: von der Seite, auf der man gerade steht, etwas von oben
function kreisBlick(ding, von) {
  const d = minus(von.auge, ding.lage);
  const l = laenge(d) || 1;
  const gier = Math.atan2(d[0], d[2]);
  const nick = Math.max(-0.3, Math.min(0.7, Math.asin(d[1] / l) + 0.15));
  const abstand = Math.max(0.35, ding.radius * (ding.nah ?? 3.2));
  return { ziel: [...ding.lage], gier, nick, abstand, sichtfeld: 50, ...versatzFuer(ding) };
}

// senkrecht: frontal vor die Fläche (oder die Wand, an der ein Kreis-Gegenstand hängt), so weit weg, dass sie gut
// ins Bild passt und der Rand noch zu sehen ist. Die Brennweite für das Sichtfeld (wie in kamera.js):
// f = lang / 2 / (tan(Sichtfeld / 2) · 16/9). Eine Strecke der Länge s im Abstand a erscheint f · s / a Pixel groß;
// gewünscht sind höchstens 80 % der Breite und 60 % der Höhe, also a = f · s / (Anteil · Bildgröße).
function senkrechtBlick(ding, von) {
  let n = istFlaeche(ding) ? normaleVon(ding.punkte) : schaetzeNormale(ding.lage, ding.radius);
  if (punkt(n, minus(von.auge, ding.lage)) < 0) n = n.map((v) => -v);
  const W = z.canvas.width, H = z.canvas.height, sichtfeld = 50;
  const f = Math.max(W, H) / 2 / (Math.tan((sichtfeld * Math.PI) / 360) * (16 / 9));
  let abstand;
  if (istBildschirm(ding)) {
    const { ecken } = ordneEcken(ding.punkte, von.auge, von.achsen().oben);
    const sb = laenge(minus(ecken[1], ecken[0])), sh = laenge(minus(ecken[3], ecken[0]));
    abstand = Math.max((f * sb) / (0.8 * W), (f * sh) / (0.6 * H), 0.2);
  } else abstand = Math.max(0.35, ding.radius * (ding.nah ?? 3.2));
  return { ziel: [...ding.lage], gier: Math.atan2(n[0], n[2]), nick: Math.max(-1.4, Math.min(1.4, Math.asin(n[1]))), abstand, sichtfeld, ...versatzFuer(ding) };
}

// Normale der Oberfläche unter einem Kreis-Gegenstand (z. B. das Bild an der Wand): die Splats im Umkreis streuen
// entlang der Wand weit und senkrecht zu ihr kaum. Die Richtung, in die sie am wenigsten streuen, ist der Eigenvektor
// zum kleinsten Eigenwert ihrer Kovarianzmatrix (Hauptkomponenten, wie beim Boden in ausrichten.js).
function schaetzeNormale(mitte, radius) {
  const { lage, farbe, anzahl } = z.szene;
  const r2 = radius * radius, C = [0, 0, 0, 0, 0, 0, 0, 0, 0], summe = [0, 0, 0], nahe = [];
  for (let i = 0; i < anzahl; i++) {
    if (farbe[4 * i + 3] < 60) continue;
    const dx = lage[3 * i] - mitte[0], dy = lage[3 * i + 1] - mitte[1], dz = lage[3 * i + 2] - mitte[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    nahe.push(dx, dy, dz);
    summe[0] += dx;
    summe[1] += dy;
    summe[2] += dz;
  }
  const n = nahe.length / 3;
  if (n < 10) return [0, 0, 1];
  const m = summe.map((s) => s / n);
  for (let i = 0; i < n; i++) {
    const v = [nahe[3 * i] - m[0], nahe[3 * i + 1] - m[1], nahe[3 * i + 2] - m[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[3 * a + b] += v[a] * v[b];
  }
  const { werte, vektoren } = jacobi(C);
  const k = werte.indexOf(Math.min(...werte));
  return einheit([vektoren[k], vektoren[3 + k], vektoren[6 + k]]);
}

// ---------- Zeigen ----------
function zeigeDing(ding) {
  const von = aktiveKamera();
  const vorher = gezeigt ? gezeigt.vorher : { kamera: von, zustand: zustandVon(von) };
  beendeInhalt();
  schliesseSeite();
  von.rechne(z.canvas.width, z.canvas.height);
  // die Zeig-Kamera fängt genau da an, wo die bisherige Kamera steht, und fliegt dann zum Ziel
  const s = zustandVon(von);
  z.zeig = erstelleKamera({ ziel: s.ziel, gier: s.gier, nick: s.nick, abstand: s.abstand, sichtfeld: s.sichtfeld });
  Object.assign(z.zeig, { versatzX: s.versatzX, versatzY: s.versatzY });
  const ziel = ding.kamera === "kreisen" ? kreisBlick(ding, von)
    : ding.kamera === "senkrecht" ? senkrechtBlick(ding, von)
    : ding.kamera === "blick" && ding.blick ? { versatzX: 0, versatzY: 0, ...ding.blick }
    : null; // keine: die Kamera bleibt
  gezeigt = { ding, schritt: 1, mitteGier: ziel?.gier ?? s.gier, start: Infinity, ruheBis: 0, vorher, angekommen: false, inhalt: null, seite: null };
  z.hervor = ding;
  starteInhalt(ding);
  const angekommen = () => {
    gezeigt.angekommen = true;
    gezeigt.start = performance.now();
  };
  if (ziel) fliege(z.zeig, ziel, 1200, angekommen);
  else angekommen();
  zeigeTafel(ding);
}

// der zweite Klick (auf den Gegenstand oder „öffnen“): Seite auf der Fläche oder gleich zum Link
function weiter() {
  if (!gezeigt || fahrt) return;
  const d = gezeigt.ding;
  if (d.danach === "seite" && gezeigt.schritt === 1 && istBildschirm(d)) {
    gezeigt.schritt = 2;
    // eine Seite zum Bedienen braucht eine ruhige Kamera, frontal davor (beim Kreisen erst dorthin)
    const k = z.zeig, ziel = d.kamera === "blick" && d.blick ? { versatzX: 0, versatzY: 0.1, ...d.blick } : { ...senkrechtBlick(d, k), versatzX: 0, versatzY: 0.1 };
    k.extraGier = k.extraNick = 0;
    tafel.classList.add("knapp");
    fliege(k, ziel, 700, () => oeffneSeite(d));
    return;
  }
  oeffne(d);
}

// ---------- Video oder Bild auf der Fläche (gezeichnet in zeichnen.js, als Objekt mit Tiefe) ----------
function starteInhalt(d) {
  if (d.auf === "nichts" || !istBildschirm(d) || !quelleVon(d)) return;
  let el;
  if (d.auf === "video") {
    el = document.createElement("video");
    Object.assign(el, { src: quelleVon(d), muted: true, loop: true, playsInline: true, crossOrigin: "anonymous" });
    // stumm darf ein Video ohne Tippen anfangen, auch auf dem iPhone; autoplay allein reicht bei einem Element, das
    // erst später entsteht, nicht überall: selbst anstoßen
    el.play().catch(() => {});
  } else {
    el = new Image();
    el.crossOrigin = "anonymous";
    el.src = quelleVon(d);
    el.onload = neu;
  }
  gezeigt.inhalt = el;
}

function beendeInhalt() {
  const el = gezeigt?.inhalt;
  if (!el) return;
  if (el instanceof HTMLVideoElement) {
    el.pause();
    el.removeAttribute("src");
    el.load(); // Netz und Dekoder freigeben
  }
  z.vergissTextur?.(el);
  gezeigt.inhalt = null;
}

// für zeichnen.js: die Fläche des gezeigten Gegenstands als Dreiecke mit Bild (nur, solange er gezeigt wird)
export function flaechenZumZeichnen(k) {
  const el = gezeigt?.inhalt;
  if (!el) return [];
  const d = gezeigt.ding;
  const { ecken, normale } = ordneEcken(d.punkte, k.auge, k.achsen().oben);
  const b = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
  return [{
    dreiecke: gitter(ecken, normale, d.woelbung ?? 0, 0.006), // 6 mm vor die Fläche (gegen Flimmern mit den Splats darunter)
    quelle: el,
    ausschnitt: ausschnitt(laenge(minus(ecken[1], ecken[0])), laenge(minus(ecken[3], ecken[0])), b, h),
  }];
}

// ---------- Seite auf der Fläche (iframe, per Homographie auf die vier Ecken) ----------
// Die Seite bekommt so viele CSS-Pixel, wie die Fläche auf dem Bildschirm groß ist (mindestens 320 breit): dann sieht
// sie aus wie auf einem Gerät dieser Größe, und am Handy greift ihre Handy-Ansicht. Eine gewölbte Fläche kann eine
// bedienbare Seite nicht annehmen (der Browser biegt keine Elemente); die Seite liegt dann flach auf den vier Ecken.
// Was im Zimmer VOR der Fläche steht, soll die Seite verdecken: eine Maske aus den Splats vor der Fläche (main.js
// rechnet sie mit zeichnen.js), neu, sobald die Kamera eine Weile stillsteht.
function oeffneSeite(d) {
  const k = z.zeig, w = z.canvas.width, h = z.canvas.height, faktor = z.canvas.clientWidth / w;
  k.rechne(w, h);
  const { ecken } = ordneEcken(d.punkte, k.auge, k.achsen().oben);
  const schirm = ecken.map((q) => k.aufBildschirm(q, w, h));
  if (schirm.some((e) => !e)) return;
  const lang = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * faktor;
  let breite = lang(schirm[0], schirm[1]), hoehe = lang(schirm[0], schirm[3]);
  if (breite < 320) [breite, hoehe] = [320, (hoehe * 320) / breite];
  const el = document.createElement("iframe");
  el.src = d.link;
  el.title = d.name;
  el.style.width = `${breite}px`;
  el.style.height = `${hoehe}px`;
  fensterEbene.replaceChildren(el);
  fensterEbene.hidden = false;
  gezeigt.seite = { breite, hoehe, ansicht: null, uhr: 0 };
  tafel.querySelector("a").textContent = "öffnen →";
  requestAnimationFrame(() => fensterEbene.classList.add("an"));
  neu();
}

function schliesseSeite() {
  fensterEbene.classList.remove("an");
  fensterEbene.hidden = true;
  fensterEbene.replaceChildren(); // iframe weg: die Seite darin hört auf zu laufen
  fensterEbene.style.maskImage = fensterEbene.style.webkitMaskImage = "";
  if (gezeigt?.seite) clearTimeout(gezeigt.seite.uhr);
  if (gezeigt) gezeigt.seite = null;
}

// in jedem Bild: die Seite auf die vier Ecken legen; hat sich der Blick geändert, die Maske bald neu rechnen
function platziereSeite(k) {
  const s = gezeigt?.seite;
  if (!s || fahrt || !fensterEbene.firstChild) return;
  const w = z.canvas.width, h = z.canvas.height, faktor = z.canvas.clientWidth / w;
  const { ecken, normale, mitte } = ordneEcken(gezeigt.ding.punkte, k.auge, k.achsen().oben);
  const schirm = ecken.map((q) => k.aufBildschirm(q, w, h));
  if (schirm.some((e) => !e)) return;
  fensterEbene.firstChild.style.transform = homographie(s.breite, s.hoehe, schirm.map((e) => [e.x * faktor, e.y * faktor]));
  const a = k.ansicht.join(",");
  if (a !== s.ansicht) {
    s.ansicht = a;
    clearTimeout(s.uhr);
    // Ebene 2 cm vor der Fläche: n · p − (n · m + 0,02) > 0 heißt „davor“
    s.uhr = setTimeout(() => z.maskeRechnen?.([...normale, -(punkt(normale, mitte) + 0.02)]), 150);
  }
}

// main.js liefert die Deckung der Splats vor der Fläche (Alpha je Pixel); daraus eine Maske: sichtbar ist die Seite
// dort, wo davor nichts deckt (Maskenalpha = 1 − Deckung). WebGL liest die Zeilen von unten nach oben, darum gespiegelt.
export function setzeMaske({ pixel, breite, hoehe }) {
  if (!gezeigt?.seite) return;
  const c = document.createElement("canvas");
  c.width = breite;
  c.height = hoehe;
  const g = c.getContext("2d");
  const bild = g.createImageData(breite, hoehe);
  let deckt = false;
  for (let y = 0; y < hoehe; y++) {
    const von = (hoehe - 1 - y) * breite * 4, nach = y * breite * 4;
    for (let x = 0; x < breite; x++) {
      const a = pixel[von + 4 * x + 3];
      bild.data[nach + 4 * x + 3] = 255 - a;
      if (a > 8) deckt = true;
    }
  }
  if (!deckt) {
    fensterEbene.style.maskImage = fensterEbene.style.webkitMaskImage = "";
    return;
  }
  g.putImageData(bild, 0, 0);
  const url = `url(${c.toDataURL()})`;
  fensterEbene.style.maskImage = fensterEbene.style.webkitMaskImage = url;
}

function zeigeTafel(ding) {
  document.body.classList.add("zeigt"); // blendet z. B. den Knopf „Neigung“ aus
  tafel.querySelector("h2").textContent = ding.name;
  tafel.querySelector("p").textContent = tafelMitText(ding) ? ding.text : "";
  tafel.classList.toggle("knapp", !tafelMitText(ding)); // ohne Text nur Name und Knöpfe
  const link = tafel.querySelector("a");
  link.href = ding.link || "#";
  link.textContent = ding.danach === "seite" ? "ansehen →" : "öffnen →";
  if (ding.tafel === "aus") {
    tafel.hidden = true;
    tafel.classList.remove("an");
    return;
  }
  tafel.hidden = false;
  // erst nach dem Neuzeichnen einblenden, sonst springt die Übergangs-Animation nicht an
  requestAnimationFrame(() => tafel.classList.add("an"));
}

export function zeigenBeenden() {
  if (!gezeigt || fahrt) return;
  const { kamera, zustand } = gezeigt.vorher;
  tafel.classList.remove("an");
  document.body.classList.remove("zeigt");
  setTimeout(() => {
    if (!tafel.classList.contains("an")) tafel.hidden = true; // erst nach dem Ausblenden ganz weg
  }, 300);
  beendeInhalt();
  schliesseSeite();
  const ding = gezeigt.ding;
  gezeigt = null;
  if (z.hervor === ding) z.hervor = null;
  fliege(z.zeig, zustand, ding.kamera === "keine" ? 1 : 1000, () => {
    z.zeig = null;
    // in „gier“ steckt das Ausweichen der Parallaxe schon drin: darum das Ausweichen auf 0
    Object.assign(kamera, { ...zustand, ziel: [...zustand.ziel], extraGier: 0, extraNick: 0 });
    neu();
  });
}
export const zeigtGerade = () => !!gezeigt;
// für steuerung.js: kreisen (ziehen dreht), stehen (Parallaxe), fest (Seite offen: nichts bewegt sich), oder null
export const zeigArt = () => (!gezeigt?.angekommen ? null : gezeigt.seite || gezeigt.schritt === 2 ? "fest" : gezeigt.ding.kamera === "kreisen" ? "kreisen" : "stehen");

// Bearbeiten: „Zeigen vorführen“, und Änderungen gleich sehen
z.vorfuehren = (ding) => {
  if (!ding || fahrt) return;
  zeigeDing(ding);
};
z.vorfuehrungAktualisieren = () => {
  if (!gezeigt || fahrt) return;
  const d = gezeigt.ding;
  zeigeTafel(d);
  if (d.kamera === "kreisen" && gezeigt.schritt === 1) z.zeig.abstand = Math.max(0.35, d.radius * (d.nah ?? 3.2));
  neu();
};

// beim Zeigen: der Nutzer dreht selbst; das Kreisen setzt ein paar Sekunden aus und macht dann von dort weiter
export function zeigenAngefasst() {
  if (!gezeigt) return;
  gezeigt.ruheBis = performance.now() + 4000;
  gezeigt.mitteGier = z.zeig.gier;
  gezeigt.start = performance.now() + 4000;
}

// ---------- Öffnen: hinfahren (oder vom Zeigen aus näher heran), abblenden, Seite ----------
function oeffne(ding) {
  const k = aktiveKamera();
  const s = zustandVon(k);
  let nachher;
  schliesseSeite();
  if (gezeigt) {
    nachher = { ...s, abstand: Math.max(0.15, s.abstand * 0.45) };
  } else if (art() === "rundblick" || art() === "begehen") {
    // stehen bleiben, hindrehen und heranzoomen (das Sichtfeld enger, bis der Gegenstand gut die Hälfte füllt)
    const r = k.richtungZu(ding.lage);
    const eng = (2 * Math.atan(ding.radius / 0.55 / r.abstand) * 180) / Math.PI;
    nachher = { ...s, gier: r.gier, nick: r.nick, sichtfeld: Math.max(12, Math.min(k.sichtfeld, eng)) };
  } else {
    nachher = { ...s, ziel: [...ding.lage], abstand: Math.max(0.3, ding.radius * 3) };
  }
  z.hervor = ding;
  setTimeout(() => blende.classList.add("an"), wenigBewegung.matches ? 0 : 500);
  fliege(k, nachher, 900, () => (location.href = ding.link));
  rueckweg = { k, zustand: s };
}

// Zurück-Knopf: der Browser zeigt die Seite oft aus dem Speicher, genau wie sie war (abgeblendet, nah dran).
// Dann alles zurück auf vorher.
let rueckweg = null;
window.addEventListener("pageshow", (ev) => {
  if (!ev.persisted || !rueckweg) return;
  fahrt = null;
  Object.assign(rueckweg.k, { ...rueckweg.zustand, ziel: [...rueckweg.zustand.ziel] });
  rueckweg = null;
  blende.classList.remove("an");
  neu();
});

export const fahrtLaeuft = () => !!fahrt;

// Tafel: „zurück“ und Esc
tafel.querySelector("button").addEventListener("click", zeigenBeenden);
tafel.querySelector("a").addEventListener("click", (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0 || !gezeigt) return;
  ev.preventDefault();
  if (z.bearbeiten && (gezeigt.schritt === 2 || gezeigt.ding.danach !== "seite")) {
    // beim Vorführen nicht wegspringen
    z.zeigeMeldung?.("Im Bearbeiten-Modus öffnet sich der Link nicht. Ohne ?bearbeiten führt das hier zur Seite.", 3000);
    return;
  }
  if (gezeigt.schritt === 2) oeffne(gezeigt.ding);
  else weiter();
});
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !ev.defaultPrevented) zeigenBeenden();
});
