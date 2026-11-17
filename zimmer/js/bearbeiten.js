// Die Leiste zum Bearbeiten (?bearbeiten an der Adresse oder Taste B), in aufklappbaren Gruppen:
//   Scan      öffnen, drehen, Boden waagerecht, Blickart der Besucher, Startblick
//   Ansicht   eigene Kamera (wie in Blender), Ansichten entlang der Achsen, Schnitt, Kugel, Röntgen, 3D-Cursor
//   Grundriss (grundriss.js)
//   Gegenstände und Flächen: setzen, Ecken setzen, was ein Klick tut, Blick dafür
// am Ende die fertige zimmer.json kopieren. Verschieben, drehen, skalieren mit dem Gizmo (gizmo.js).
//
// Wohin ein Klick ins Bild einen Punkt setzt (neuer Gegenstand, neue Ecke, 3D-Cursor), der Reihe nach:
//   1. orthografische Ansicht (Taste 1, 3, 7): auf die Ebene durch den 3D-Cursor, senkrecht zum Blick. Man setzt also
//      in der Ansicht von vorn x und y, die Tiefe kommt vom Cursor (so geht es auch in Blender)
//   2. eine Fläche, deren Ecken man gerade setzt, hat schon drei Ecken: auf ihre Ebene (so wird ein Bildschirm eben)
//   3. die nächste getroffene Oberfläche: Splats (wenn „an Splats einrasten“ an ist) oder eine andere Fläche, auch
//      eine unsichtbare Hilfsfläche
//   4. sonst die Ebene durch den 3D-Cursor senkrecht zum Blick. Ein Punkt entsteht also immer, auch wo kein Splat ist.

import { z, neu, art, aktiveKamera, runde, zeige, bildpunkt } from "./zustand.js";
import { ladeSplats, dreheSzene } from "./laden.js";
import { baueDinge, dingZurueck, formAktualisieren, normalisiere, quelleVon, istBildschirm } from "./dinge.js";
import { pickePunkt } from "./picken.js";
import { waehleEcke } from "./gizmo.js";
import { parallaxNull } from "./steuerung.js";
import { wendeGrundrissAn, baueRundKamera, richteGrundrissEin, setzeDraufsicht } from "./grundriss.js";
import { bodenNormale, schritteZuOben, groesseVon } from "./ausrichten.js";
import { mitteVon, normaleVon, strahlAufFlaeche, minus, plus, mal, punkt } from "./flaeche.js";

const hole = (id) => document.getElementById(id);
const leiste = hole("leiste");
const blickArt = hole("leiste-art");
const liste = hole("leiste-liste");
const felder = {
  name: hole("ding-name"),
  link: hole("ding-link"),
  form: hole("ding-form"),
  radius: hole("ding-radius"),
  woelbung: hole("ding-woelbung"),
  kamera: hole("ding-kamera"),
  bogen: hole("ding-bogen"),
  nah: hole("ding-nah"),
  auf: hole("ding-auf"),
  quelle: hole("ding-quelle"),
  tafel: hole("ding-tafel"),
  text: hole("ding-text"),
  danach: hole("ding-danach"),
};
const ZAHLEN = ["radius", "bogen", "nah", "woelbung"];
const LEER_WEG = ["text", "quelle"]; // leer: gar nicht erst in die zimmer.json (dann gilt der Standard)
const STANDARD = { radius: 0.3, bogen: 50, nah: 3.2, text: "", form: "kreis", woelbung: 0, kamera: "senkrecht", auf: "nichts", quelle: "", tafel: "text", danach: "link" };
let setztGerade = false; // neuer Kreis-Gegenstand: nächster Klick ins Bild
let punkteSetzen = false; // Ecken der gewählten Fläche: jeder Klick ins Bild

export function richteLeisteEin() {
  zeigeLeiste();
  richteGrundrissEin();
  window.addEventListener("keydown", (ev) => {
    if (ev.target.closest?.("input, textarea, select")) return;
    if (ev.key === "b" || ev.key === "B") {
      z.bearbeiten = !z.bearbeiten;
      if (!z.bearbeiten && z.draufsicht) setzeDraufsicht(false);
      zeigeLeiste();
    }
  });

  // ---------- Scan ----------
  // Blickart der Besucher: kommt so in die zimmer.json (mit eigener Kamera sieht man sie erst, wenn man die ausschaltet)
  blickArt.addEventListener("change", () => {
    z.einst.art = blickArt.value;
    parallaxNull();
    if ((blickArt.value === "rundblick" || blickArt.value === "begehen") && !z.einst.grundriss?.punkte?.length)
      zeige("Ohne Grundriss steht man in der Mitte des Scans (und kann beim Herumgehen überall hin). Unter „Grundriss“ lässt sich das Zimmer einzeichnen.", 6000);
    neu();
  });

  hole("ansicht-merken").addEventListener("click", () => {
    if (z.einst.art === "rundblick" || z.einst.art === "begehen") {
      const k = z.edAn ? z.ed : z.rund;
      z.einst.rundblick = { ...z.einst.rundblick, gier: runde(k.gier), nick: runde(k.nick), sichtfeld: runde(k.sichtfeld) };
      zeige("Startrichtung für Rundblick und Herumgehen übernommen.", 2500);
    } else {
      const k = z.edAn ? z.ed : z.kamera;
      z.einst.kamera = { ziel: k.ziel.map(runde), gier: runde(k.gier), nick: runde(k.nick), abstand: runde(k.abstand), sichtfeld: runde(k.sichtfeld) };
      Object.assign(z.kamera, { ...z.einst.kamera, ziel: [...z.einst.kamera.ziel] });
      zeige("Startblick übernommen.", 2500);
    }
  });

  hole("drehen-x").addEventListener("click", () => drehe([90, 0, 0]));
  hole("drehen-y").addEventListener("click", () => drehe([0, 90, 0]));
  hole("drehen-z").addEventListener("click", () => drehe([0, 0, 90]));
  // fein: 0,5° je Klick (ein paar Grad schief nach dem Training)
  for (const [id, w] of [["fein-x-plus", [0.5, 0, 0]], ["fein-x-minus", [-0.5, 0, 0]], ["fein-z-plus", [0, 0, 0.5]], ["fein-z-minus", [0, 0, -0.5]]])
    hole(id).addEventListener("click", () => drehe(w));
  hole("boden-waagerecht").addEventListener("click", () => {
    zeige("sucht den Boden …");
    // erst im nächsten Bild rechnen, damit die Meldung schon zu sehen ist
    setTimeout(() => {
      const b = bodenNormale(z.roh, groesseVon(z.roh));
      if (!b) return zeige("Keinen Boden gefunden (keine Ebene, die höchstens 25° schräg ist).", 4000);
      const neigung = (Math.acos(Math.min(1, b.normale[1])) * 180) / Math.PI;
      if (neigung < 0.05) return zeige("Der Boden ist schon waagerecht.", 3000);
      for (const w of schritteZuOben(b.normale)) drehe(w, true);
      const grundriss = z.einst.grundriss?.punkte?.length ? " Den Grundriss bitte prüfen (Ecken und Boden)." : "";
      zeige(`Boden lag ${neigung.toFixed(1)}° schief, jetzt waagerecht (${Math.round(b.anteil * 100)} % der untersten Splats liegen auf der Ebene).${grundriss}`, 6000);
    }, 30);
  });

  // ---------- Ansicht ----------
  const eigene = hole("ed-an");
  eigene.checked = z.edAn;
  eigene.addEventListener("change", () => {
    z.edAn = eigene.checked;
    neu();
  });
  // Ansichten auch als Knöpfe (am Tablet gibt es keine Ziffertasten): schicken dieselbe Taste wie die Tastatur
  for (const [id, code] of [["ed-vorn", "Digit1"], ["ed-rechts", "Digit3"], ["ed-oben", "Digit7"], ["ed-persp", "Digit5"], ["ed-fokus", "KeyF"]])
    hole(id).addEventListener("click", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code.slice(-1).toLowerCase() }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    });
  for (const [id, feld] of [["ed-nah", "nah"], ["ed-kugel", "kugel"], ["ed-roentgen", "roentgen"]]) {
    const r = hole(id);
    r.value = z.werkzeug[feld];
    r.addEventListener("input", () => {
      z.werkzeug[feld] = Number(r.value);
      neu();
    });
  }
  hole("cursor-zur-auswahl").addEventListener("click", () => {
    if (!z.gewaehlt) return zeige("Erst etwas auswählen.", 2000);
    z.cursor = [...z.gewaehlt.lage];
    neu();
  });
  hole("auswahl-zum-cursor").addEventListener("click", () => {
    const d = z.gewaehlt;
    if (!d || !z.cursor) return;
    const v = minus(z.cursor, d.lage);
    if (d.punkte) d.punkte = d.punkte.map((p) => plus(p, v));
    d.lage = [...z.cursor];
    formAktualisieren(d);
    dingZurueck(d);
    neu();
  });

  // ---------- Gegenstände ----------
  for (const [name, feld] of Object.entries(felder)) {
    feld.addEventListener("input", () => {
      const d = z.gewaehlt;
      if (!d) return;
      const wert = ZAHLEN.includes(name) ? Number(feld.value) : feld.value;
      if (wert === "" && LEER_WEG.includes(name)) delete d[name]; // z. B. leerer Text
      else d[name] = wert;
      const hatteLink = !!d.element;
      formAktualisieren(d);
      dingZurueck(d);
      if (name === "link" && hatteLink !== !!d.link) {
        // aus Hilfsfläche wird Link oder umgekehrt: die Elemente neu bauen
        const i = z.dinge.indexOf(d);
        baueDinge();
        return waehle(z.dinge[i]);
      }
      if (d.element) {
        d.element.href = d.link;
        d.element.firstChild.textContent = d.name;
      }
      zeigeListe();
      zeigePassendeFelder();
      z.vorfuehrungAktualisieren?.();
      neu();
    });
  }
  hole("ding-vorfuehren").addEventListener("click", () => {
    if (!z.gewaehlt) return zeige("Erst einen Gegenstand in der Liste auswählen.", 2500);
    if (!z.gewaehlt.link) return zeige("Eine Hilfsfläche ohne Link lässt sich nicht anklicken, also auch nicht vorführen.", 3000);
    z.vorfuehren(z.gewaehlt);
  });

  hole("ding-setzen").addEventListener("click", (ev) => {
    setztGerade = !setztGerade;
    punkteSetzen = false;
    hole("ding-punkte").classList.remove("aktiv");
    ev.target.classList.toggle("aktiv", setztGerade);
    durchlaessig(setztGerade);
    zeige(setztGerade ? "Klick ins Bild: dort kommt ein neuer Gegenstand hin." : "");
  });
  hole("ding-flaeche").addEventListener("click", () => {
    // neue Fläche ohne Ecken, und gleich Ecken setzen
    const name = `Fläche ${z.dinge.filter((d) => d.form === "flaeche").length + 1}`;
    (z.einst.dinge ??= []).push(normalisiere({ name, link: "", form: "flaeche", lage: [...(z.cursor ?? z.ed.ziel)], radius: 0.3, kamera: "senkrecht", tafel: "knapp" }));
    baueDinge();
    waehle(z.dinge.at(-1));
    setzeEcken(true);
  });
  hole("ding-punkte").addEventListener("click", () => setzeEcken(!punkteSetzen));
  hole("ding-punkt-weg").addEventListener("click", () => {
    const d = z.gewaehlt;
    if (!d?.punkte?.length) return;
    d.punkte.pop();
    if (!d.punkte.length) delete d.punkte;
    waehleEcke(null);
    formAktualisieren(d);
    dingZurueck(d);
    felderAktualisieren();
    neu();
  });
  hole("ding-blick").addEventListener("click", () => {
    const d = z.gewaehlt;
    if (!d) return zeige("Erst einen Gegenstand auswählen.", 2500);
    const k = aktiveKamera();
    if (k.ortho) return zeige("Bitte erst perspektivisch schauen (Taste 5): Besucher sehen das Zimmer immer mit Perspektive.", 3500);
    d.blick = { ziel: k.ziel.map(runde), gier: runde(k.gier + k.extraGier), nick: runde(k.nick + k.extraNick), abstand: runde(k.abstand), sichtfeld: runde(k.sichtfeld) };
    d.kamera = "blick";
    dingZurueck(d);
    felderAktualisieren();
    zeige(`Blick für „${d.name}“ gespeichert; „Kamera“ steht jetzt auf „gespeicherter Blick“.`, 3000);
  });
  hole("ding-loeschen").addEventListener("click", () => {
    if (!z.gewaehlt) return;
    z.einst.dinge.splice(z.dinge.indexOf(z.gewaehlt), 1);
    z.gewaehlt = null;
    baueDinge();
    felderAktualisieren();
  });

  hole("json").addEventListener("click", kopiereJson);
  hole("datei").addEventListener("change", oeffneDatei);
  felderAktualisieren();
}

function setzeEcken(an) {
  if (an && !z.gewaehlt) return zeige("Erst eine Fläche auswählen oder „neue Fläche“ drücken.", 2500);
  punkteSetzen = an;
  setztGerade = false;
  hole("ding-setzen").classList.remove("aktiv");
  hole("ding-punkte").classList.toggle("aktiv", an);
  durchlaessig(an);
  zeige(an ? "Ins Bild klicken: jeder Klick setzt eine Ecke (rundherum, der Reihe nach). Für Video, Bild oder Seite genau 4. Noch einmal auf den Knopf: fertig." : "", an ? 6000 : 0);
}

// beim Setzen gehen Klicks durch die Gegenstände und den Gizmo hindurch ins Bild
function durchlaessig(an) {
  z.ebene.classList.toggle("durchlaessig", an);
  hole("gizmo").classList.toggle("durchlaessig", an);
}

function zeigeLeiste() {
  leiste.hidden = !z.bearbeiten;
  if (z.bearbeiten) blickArt.value = z.einst?.art ?? "parallax";
  neu();
}

// ---------- Gegenstände: Liste, Auswahl, Felder ----------
function zeigeListe() {
  liste.replaceChildren(...z.dinge.map((d) => {
    const li = document.createElement("li");
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = d.name || "(ohne Namen)";
    k.title = d.link ? d.link : "Hilfsfläche (ohne Link)";
    k.classList.toggle("aktiv", d === z.gewaehlt);
    k.classList.toggle("hilf", !d.link);
    k.addEventListener("click", () => waehle(d));
    li.append(k);
    return li;
  }));
}
z.zeigeListe = zeigeListe;

function waehle(d) {
  z.gewaehlt = d ?? null;
  waehleEcke(null);
  felderAktualisieren();
  zeigeListe();
  neu();
}
z.waehle = waehle;

function felderAktualisieren() {
  const d = z.gewaehlt;
  hole("ding-felder").toggleAttribute("hidden", !d);
  for (const [name, feld] of Object.entries(felder)) feld.value = d?.[name] ?? STANDARD[name] ?? "";
  if (d) felder.quelle.placeholder = quelleVon({ ...d, quelle: "" }) || "Pfad zur Datei";
  zeigePassendeFelder();
}
z.felderAktualisieren = felderAktualisieren;

// nur die Felder zeigen, die für Form und Verhalten gelten
function zeigePassendeFelder() {
  const d = z.gewaehlt;
  if (!d) return;
  const zeigeFeld = (id, an) => (hole(id).closest("label") ?? hole(id)).toggleAttribute("hidden", !an);
  const flaeche = d.form === "flaeche";
  zeigeFeld("ding-radius", !flaeche);
  zeigeFeld("ding-woelbung", istBildschirm(d));
  zeigeFeld("ding-punkte", flaeche);
  zeigeFeld("ding-punkt-weg", flaeche);
  zeigeFeld("ding-bogen", d.kamera === "kreisen");
  zeigeFeld("ding-nah", d.kamera === "kreisen" || (d.kamera === "senkrecht" && !flaeche));
  zeigeFeld("ding-quelle", d.auf !== "nichts");
  zeigeFeld("ding-text", d.tafel === "text");
  for (const id of ["ding-kamera", "ding-auf", "ding-tafel", "ding-danach", "ding-blick", "ding-vorfuehren"]) zeigeFeld(id, !!d.link);
  const brauchtVier = d.auf !== "nichts" || d.danach === "seite";
  const n = d.punkte?.length ?? 0;
  hole("ding-hinweis").textContent = !d.link ? "Hilfsfläche: ohne Link nicht anklickbar. Sie hilft beim Setzen von Ecken (sie fängt Klicks) und ist beim Herumgehen eine Wand."
    : brauchtVier && n !== 4 ? `Video, Bild und Seite brauchen eine Fläche mit genau 4 Ecken (jetzt ${flaeche ? n : "ein Kreis"}).` : "";
}

// ---------- Klick ins Bild: Punkt setzen (Regeln oben) ----------
function punktUnterMaus(ev, bearbeitet = null) {
  const k = aktiveKamera(), W = z.canvas.width, H = z.canvas.height;
  k.rechne(W, H);
  const [px, py] = bildpunkt(ev);
  const { anfang, richtung } = k.strahl(px, py, W, H);
  // Schnitt des Strahls mit der Ebene durch p mit Normale n
  const aufEbene = (p, n) => {
    const nenner = punkt(n, richtung);
    if (Math.abs(nenner) < 1e-9) return null;
    const t = punkt(n, minus(p, anfang)) / nenner;
    return t > 0 ? { punkt: plus(anfang, mal(richtung, t)), tiefe: t, wie: "Ebene" } : null;
  };
  const cursorEbene = () => aufEbene(z.cursor ?? k.ziel, k.achsen().vorwaerts);
  if (k.ortho) return cursorEbene();
  if ((bearbeitet?.punkte?.length ?? 0) >= 3) {
    const r = aufEbene(mitteVon(bearbeitet.punkte), normaleVon(bearbeitet.punkte));
    if (r) return { ...r, wie: "Ebene der Fläche" };
  }
  let beste = hole("ed-einrasten").checked ? pickePunkt(k, px, py, z.szene, W, H) : null;
  if (beste) beste.wie = "Splats";
  for (const ding of z.dinge) {
    if (ding === bearbeitet || ding.form !== "flaeche" || (ding.punkte?.length ?? 0) < 3) continue;
    const r = strahlAufFlaeche(anfang, richtung, ding.punkte);
    if (r && (!beste || r.tiefe < beste.tiefe)) beste = { ...r, wie: ding.name || "Fläche" };
  }
  return beste ?? { ...cursorEbene(), wie: "Ebene durch den Cursor" };
}

z.abfangen = (ev) => {
  if (!z.bearbeiten || z.draufsicht) return false;
  // Umschalt + Rechtsklick: 3D-Cursor setzen (wie in Blender)
  if (ev.shiftKey && ev.button === 2) {
    const r = punktUnterMaus(ev);
    if (r?.punkt) {
      z.cursor = r.punkt.map(runde);
      zeige(`3D-Cursor gesetzt (${r.wie}).`, 1500);
      neu();
    }
    return true;
  }
  if (ev.button !== 0 || !(setztGerade || punkteSetzen)) return false;
  const d = punkteSetzen ? z.gewaehlt : null;
  const r = punktUnterMaus(ev, d);
  if (!r?.punkt) return true;
  const p = r.punkt.map(runde);
  if (punkteSetzen) {
    d.form = "flaeche";
    (d.punkte ??= []).push(p);
    formAktualisieren(d);
    dingZurueck(d);
    felderAktualisieren();
    zeige(`Ecke ${d.punkte.length} gesetzt (${r.wie}).`, 1500);
    neu();
    return true;
  }
  (z.einst.dinge ??= []).push(normalisiere({ name: "neu", link: "/projekte/", lage: p, radius: runde(Math.max(0.05, r.tiefe * 0.08)), kamera: "senkrecht" }));
  baueDinge();
  waehle(z.dinge.at(-1));
  setztGerade = false;
  hole("ding-setzen").classList.remove("aktiv");
  durchlaessig(false);
  zeige(`Gesetzt (${r.wie}).`, 1500);
  return true;
};

// ---------- Drehen ----------
function drehe(w, still = false) {
  // die Szene ist schon gedreht; nur die neue Drehung anwenden und als weiteren Schritt merken (Drehungen lassen
  // sich nicht einfach Achse für Achse addieren: 90° um x, dann 90° um y ist etwas anderes als umgekehrt).
  // Nur zwei Drehungen um DIESELBE Achse direkt nacheinander dürfen zusammen: die Winkel addieren sich.
  dreheSzene(z.roh, w);
  const alt = z.einst.drehung ?? [0, 0, 0];
  const schritte = Array.isArray(alt[0]) ? alt.map((s) => [...s]) : [alt];
  const achse = (s) => (s.filter((v) => v !== 0).length === 1 ? s.findIndex((v) => v !== 0) : -1);
  const letzter = schritte.at(-1);
  if (achse(w) >= 0 && achse(letzter) === achse(w)) letzter[achse(w)] = Math.round((letzter[achse(w)] + w[achse(w)]) * 1000) / 1000;
  else schritte.push(w.map((v) => Math.round(v * 1000) / 1000));
  z.einst.drehung = schritte.filter((s) => s.some((v) => v !== 0));
  if (!z.einst.drehung.length) z.einst.drehung = [0, 0, 0];
  const nachricht = [];
  if (z.einst.grundriss?.punkte?.length && !still) nachricht.push("der Grundriss");
  if (z.dinge.length && !still) nachricht.push("Gegenstände und Flächen");
  if (nachricht.length) zeige(`Achtung: ${nachricht.join(" und ")} passen nach dem Drehen nicht mehr (sie drehen nicht mit).`, 5000);
  wendeGrundrissAn();
  baueRundKamera();
}

// ---------- Datei öffnen, JSON kopieren ----------
async function oeffneDatei(ev) {
  const datei = ev.target.files[0];
  if (!datei) return;
  zeige(`lädt ${datei.name} …`);
  try {
    const s = await ladeSplats(await datei.arrayBuffer());
    if (!z.einst.splats) z.einst.dinge = []; // die Gegenstände des Platzhalters passen nicht in einen echten Scan
    // zwei Fassungen (pc, handy) bleiben eingetragen; sonst gilt die geöffnete Datei
    if (typeof z.einst.splats !== "object" || !z.einst.splats) z.einst.splats = datei.name;
    z.einst.drehung = [0, 0, 0];
    z.einst.kamera = null; // neu ausrichten (setzeSzene schaut sich die Ausdehnung an)
    z.einst.grundriss = null;
    z.setzeSzene(s);
    zeige(`${s.anzahl.toLocaleString("de")} Splats.`, 3000);
  } catch (fehler) {
    zeige(fehler.message);
  }
}

async function kopiereJson() {
  const e = z.einst;
  const dinge = (e.dinge ?? []).map(({ element, treffer, ...d }) => ({
    ...d,
    ...(d.lage && { lage: d.lage.map(runde) }),
    ...(d.radius !== undefined && { radius: runde(d.radius) }),
    ...(d.punkte && { punkte: d.punkte.map((p) => p.map(runde)) }),
  }));
  const text = JSON.stringify({ ...e, dinge }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    zeige("zimmer.json ist in der Zwischenablage.", 3000);
  } catch {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = "zimmer.json";
    a.click();
  }
}
