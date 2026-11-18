// Patch-Wand: ein modularer Synthesizer im Browser, wie Bitwig Grid oder ein Eurorack an der Wand. Zusammengesteckt aus
//   module.js    die ersten Module (Oszillator, Filter, Hüllkurve, Sequenzer, Euklid, Trommeln, Oszilloskop …)
//   module-klang.js, module-steuerung.js, module-effekte.js   die Module aus Runde 17 (über module-neu.js)
//   bausteine.js gemeinsame Kleinteile (Filter, Rauschen, Tonleitern, Wert eines Kabels lesen)
//   worklets.js  eigene Ton-Programme im Ton-Faden (Saite, Quantisierer, Bitcrusher, Band)
//   fenster.js   ein Modul als XP-Fenster mit Buchsen und Drehknöpfen
//   kabel.js     Verbindungen im Web-Audio-Graph, Kabel mit Durchhang
//   takt.js      die vorausplanende Uhr für Sequenzer und Euklid
//   vorlagen.js  fertige Patches
// Hier: Ton an, Module hinzufügen und löschen, Kabel stecken (ziehen oder zweimal tippen), Speichern und Laden,
// Aufnehmen, und die Bild-Schleife (Kabel, Oszilloskop, Spektrum).

import { TYPEN } from "./module.js";
import { baueFenster } from "./fenster.js";
import { erstelleKabel } from "./kabel.js";
import { erstelleUhr } from "./takt.js";
import { VORLAGEN } from "./vorlagen.js";
import { ladeHerunter, zeitstempel } from "/lib/export.js";
import { erstelleAnsicht } from "./ansicht.js";
import { erstelleGruppen } from "./gruppen.js";

const hole = (id) => document.getElementById(id);
const wand = hole("wand");
const svg = hole("kabel");
const meldung = hole("meldung");
const SPEICHER = "patch-wand";

let ctx = null, uhr = null, lautsprecher = null, aufnahmeZiel = null;
const bild = new Set(); // Funktionen, die in jedem Bild zeichnen (Oszilloskop, Spektrum)
const module = new Map(); // id → modul
let naechsteId = 1;
const ansicht = erstelleAnsicht(wand, svg);
const flaeche = ansicht.inhalt; // hier hinein kommen Fenster, Kabel, Suche; vergrößert mit dem Zoom
const lokal = ansicht.lokal;
let gruppen = null; // gruppen.js, gleich unten (braucht neuesModul und kabel)
const kabel = erstelleKabel({
  svg, wand: flaeche, lokal,
  umleiten: (m, n, r) => gruppen?.umleiten(m, n, r) ?? null,
  innen: (k) => gruppen?.innen(k) ?? false,
});

function melde(text, dauer = 4000) {
  meldung.textContent = text;
  meldung.hidden = !text;
  clearTimeout(melde.uhr);
  if (text && dauer) melde.uhr = setTimeout(() => (meldung.hidden = true), dauer);
}

// ---------- Ton an ----------
// Browser spielen erst Ton, wenn man auf der Seite etwas angeklickt hat; darum beginnt alles mit diesem Knopf.
hole("ton-an").addEventListener("click", async () => {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    uhr = erstelleUhr(ctx);
    // alles, was zu hören ist, geht hier durch: an die Lautsprecher und an die Aufnahme
    lautsprecher = ctx.createGain();
    lautsprecher.connect(ctx.destination);
    aufnahmeZiel = ctx.createMediaStreamDestination();
    lautsprecher.connect(aufnahmeZiel);
    // eigene Ton-Programme (Saite, Quantisierer, Bitcrusher, Band) laufen im Ton-Faden: einmal laden, bevor ein
    // Modul sie braucht
    try {
      await ctx.audioWorklet.addModule(new URL("./worklets.js", import.meta.url));
    } catch (f) {
      melde(`Die Ton-Programme ließen sich nicht laden: ${f.message}`);
    }
    let gespeichert = null;
    try {
      gespeichert = JSON.parse(localStorage.getItem(SPEICHER));
    } catch {}
    lade(gespeichert?.module?.length ? gespeichert : VORLAGEN.ersterTon);
    hole("start").hidden = true;
    hole("bedienung").hidden = false;
    requestAnimationFrame(schleife);
  }
  await ctx.resume();
});

// ---------- Module ----------
function neuesModul({ typ, x = 80, y = 80, werte = {}, id = null, schritte = null }) {
  const def = TYPEN[typ];
  if (!def) return null;
  if (def.einmal && [...module.values()].some((m) => m.typ === typ)) {
    melde(`${def.titel} gibt es schon (nur einmal möglich).`);
    return null;
  }
  id ??= `m${naechsteId++}`;
  const modul = { id, typ, titel: def.titel, x, y, werte: { ...werte } };
  modul.eingangBelegt = (name) => kabel.amEingang(modul, name).length > 0;
  modul.teil = def.baue(ctx, { uhr, bild, lautsprecher, melde });
  modul.el = baueFenster(modul, { wand: flaeche, lokal, beiZiehen: (m, dx, dy) => { gruppen?.gezogen(m, dx, dy); merkeBald(); }, beiSchliessen: loesche, beiBuchse: buchseGedrueckt });
  if (schritte) modul.extraEl?.schritteSetzen?.(schritte);
  module.set(id, modul);
  merkeBald();
  return modul;
}

function loesche(modul) {
  gruppen?.vergiss(modul);
  for (const k of kabel.vonModul(modul)) kabel.trenne(k);
  for (const a of Object.values(modul.teil.aus)) if (a.art === "ton") a.knoten.disconnect();
  modul.teil.weg?.();
  modul.el.remove();
  module.delete(modul.id);
  merkeBald();
}

function leere() {
  gruppen?.alleWeg();
  for (const m of [...module.values()]) loesche(m);
  naechsteId = 1;
}

hole("hinzu").addEventListener("click", () => {
  const typ = hole("hinzu-typ").value;
  // dorthin, wohin man gerade schaut (Mitte des sichtbaren Teils der Wand), ein wenig versetzt
  const w = wand.getBoundingClientRect();
  const mitte = lokal(w.left + wand.clientWidth / 2, w.top + 60);
  const x = mitte.x - 180 + (Math.random() - 0.5) * 80;
  const y = mitte.y + Math.random() * 60;
  neuesModul({ typ, x: Math.max(0, x), y });
});

// Auswahl der Module, nach Gruppen
{
  const wahl = hole("hinzu-typ");
  const gruppen = {};
  for (const [typ, def] of Object.entries(TYPEN)) (gruppen[def.gruppe] ??= []).push([typ, def.titel]);
  for (const [gruppe, liste] of Object.entries(gruppen)) {
    const g = document.createElement("optgroup");
    g.label = gruppe;
    for (const [typ, titel] of liste) g.append(new Option(titel, typ));
    wahl.append(g);
  }
}

// ---------- Modulsuche (Doppelklick auf die freie Wand, wie in Bitwig) ----------
// Ein kleines Feld an der Stelle des Klicks: tippen filtert die Module (nach Name und Gruppe), Enter oder Klick
// setzt das erste bzw. gewählte genau dorthin.
const freieWand = (ziel) => ziel === wand || ziel === flaeche || (ziel.closest?.(".kabel-ebene") && !ziel.closest(".kabel-griff"));
wand.addEventListener("dblclick", (ev) => {
  if (!freieWand(ev.target)) return;
  const { x, y } = lokal(ev.clientX, ev.clientY);
  hole("modulsuche")?.remove();
  const box = document.createElement("div");
  box.id = "modulsuche";
  box.className = "modulsuche";
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.innerHTML = `<input type="search" placeholder="Modul suchen …" aria-label="Modul suchen"><ul></ul>`;
  flaeche.append(box);
  const feld = box.querySelector("input"), liste = box.querySelector("ul");
  const setze = (typ) => {
    box.remove();
    neuesModul({ typ, x: Math.max(0, x - 20), y: Math.max(0, y - 10) });
  };
  const zeige = () => {
    const q = feld.value.trim().toLowerCase();
    liste.replaceChildren(...Object.entries(TYPEN)
      .filter(([typ, d]) => !q || d.titel.toLowerCase().includes(q) || d.gruppe.toLowerCase().includes(q) || typ.includes(q))
      .slice(0, 12)
      .map(([typ, d]) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = d.titel;
        b.title = d.gruppe;
        b.addEventListener("click", () => setze(typ));
        li.append(b);
        return li;
      }));
  };
  feld.addEventListener("input", zeige);
  feld.addEventListener("keydown", (e) => {
    if (e.key === "Enter") liste.querySelector("button")?.click();
    if (e.key === "Escape") box.remove();
  });
  feld.addEventListener("blur", () => setTimeout(() => box.isConnected && !box.contains(document.activeElement) && box.remove(), 200));
  zeige();
  feld.focus();
});

// ---------- Kabel stecken ----------
// Ziehen von einer Buchse zu einer anderen. Oder (am Handy angenehmer): eine Buchse antippen, dann die zweite.
// Ein Kabel aus einem belegten Eingang herausziehen nimmt das zuletzt gesteckte mit (wie beim echten Modular).
let zug = null; // { von: { modul, name, richtung, art }, start: { x, y }, bewegt }
let gewaehlt = null; // angetippte Buchse, die auf ihr Gegenstück wartet

const buchseInfo = (b) => ({ modul: module.get(b.dataset.modul), name: b.dataset.name, richtung: b.dataset.richtung, art: b.dataset.art, el: b });

function buchseGedrueckt(ev, b) {
  ev.preventDefault();
  ev.stopPropagation();
  let info = buchseInfo(b);
  if (gewaehlt && gewaehlt.el !== b) {
    stecke(gewaehlt, info);
    gewaehlt.el.classList.remove("gewaehlt");
    gewaehlt = null;
    return;
  }
  if (info.richtung === "ein") {
    const da = kabel.amEingang(info.modul, info.name).at(-1);
    if (da) {
      // herausziehen: weiter mit dem Ausgang am anderen Ende in der Hand
      kabel.trenne(da);
      info = { ...da.von, richtung: "aus", art: da.art, el: da.von.modul.el.querySelector(`.buchse.aus[data-name="${CSS.escape(da.von.name)}"]`) };
      merkeBald();
    }
  }
  zug = { von: info, start: { x: ev.clientX, y: ev.clientY }, bewegt: false, pointer: ev.pointerId };
}

window.addEventListener("pointermove", (ev) => {
  if (!zug || ev.pointerId !== zug.pointer) return;
  if (Math.hypot(ev.clientX - zug.start.x, ev.clientY - zug.start.y) > 6) zug.bewegt = true;
  const a = kabel.punktVon(zug.von.modul, zug.von.name, zug.von.richtung);
  kabel.zeigeZug(a, lokal(ev.clientX, ev.clientY), zug.von.art);
});

window.addEventListener("pointerup", (ev) => {
  if (!zug || ev.pointerId !== zug.pointer) return;
  kabel.zeigeZug(null);
  // elementsFromPoint (alle übereinander): über der Buchse kann ein Kabel hängen
  const ziel = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => el.classList?.contains("buchse"));
  if (zug.bewegt && ziel && ziel !== zug.von.el) stecke(zug.von, buchseInfo(ziel));
  else if (!zug.bewegt) {
    // nur angetippt: merken, das Gegenstück kommt mit dem nächsten Tippen
    gewaehlt = zug.von;
    gewaehlt.el?.classList.add("gewaehlt");
    melde("Jetzt die zweite Buchse antippen (Esc: abbrechen).", 3000);
  }
  zug = null;
});
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && gewaehlt) {
    gewaehlt.el.classList.remove("gewaehlt");
    gewaehlt = null;
    melde("");
  }
});

function stecke(a, b) {
  if (a.richtung === b.richtung) return melde(a.richtung === "aus" ? "Zwei Ausgänge lassen sich nicht verbinden." : "Zwei Eingänge lassen sich nicht verbinden.");
  const [von, nach] = a.richtung === "aus" ? [a, b] : [b, a];
  if (von.modul === nach.modul) return melde("Ein Modul mit sich selbst zu verbinden, ist hier gesperrt (Rückkopplung ohne Verzögerung).");
  try {
    kabel.verbinde({ modul: von.modul, name: von.name }, { modul: nach.modul, name: nach.name });
    merkeBald();
  } catch (f) {
    melde(f.message);
  }
}

// ---------- Gruppen (gruppen.js) und Zoom (ansicht.js) ----------
gruppen = erstelleGruppen({ flaeche, lokal, module, kabel, neuesModul, buchseGedrueckt, merkeBald, melde, ladeHerunter, zeitstempel });
{
  const leiste = hole("bedienung");
  // Instrument (eine Vorlage) als zugeklappte Gruppe dazu, ohne den Patch zu ersetzen
  const instrument = document.createElement("label");
  instrument.append("Als Gruppe einfügen ");
  const wahl = document.createElement("select");
  wahl.append(new Option("Vorlage wählen …", ""));
  for (const [name, v] of Object.entries(VORLAGEN)) if (name !== "leer") wahl.append(new Option(v.text.split(":")[0], name));
  wahl.addEventListener("change", () => {
    if (!wahl.value) return;
    const w = wand.getBoundingClientRect();
    const p = lokal(w.left + 40, w.top + 40);
    gruppen.fuegeEin(VORLAGEN[wahl.value], p.x, p.y, { titel: wahl.selectedOptions[0].textContent });
    wahl.value = "";
  });
  instrument.append(wahl);
  const laden = document.createElement("label");
  laden.className = "datei-knopf";
  laden.append("Gruppe laden ");
  const datei = document.createElement("input");
  datei.type = "file";
  datei.accept = ".json,application/json";
  datei.addEventListener("change", async () => {
    const f = datei.files[0];
    datei.value = "";
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.module?.length) throw new Error();
      const w = wand.getBoundingClientRect();
      const p = lokal(w.left + 40, w.top + 40);
      gruppen.fuegeEin(d, p.x, p.y);
    } catch {
      melde("Das ist keine Gruppe (JSON aus „Gruppe speichern“).");
    }
  });
  laden.append(datei);
  // Zoom
  const zoom = document.createElement("span");
  zoom.className = "steuerung-gruppe zoom";
  const weniger = document.createElement("button"), mehr = document.createElement("button"), anzeige = document.createElement("output");
  weniger.type = mehr.type = "button";
  weniger.textContent = "−";
  mehr.textContent = "+";
  weniger.setAttribute("aria-label", "Wand verkleinern");
  mehr.setAttribute("aria-label", "Wand vergrößern");
  weniger.addEventListener("click", () => ansicht.setze(ansicht.massstab() / 1.25));
  mehr.addEventListener("click", () => ansicht.setze(ansicht.massstab() * 1.25));
  anzeige.addEventListener("dblclick", () => ansicht.setze(1));
  ansicht.beiAenderung((s) => (anzeige.textContent = `${Math.round(s * 100)} %`));
  anzeige.textContent = "100 %";
  anzeige.title = "Strg + Mausrad zoomt auch; Doppelklick: 100 %";
  zoom.append("Zoom ", weniger, anzeige, mehr);
  leiste.append(gruppen.gruppeKnopf, instrument, laden, zoom);
  // Hilfe ergänzen (ohne die Seite selbst zu ändern)
  const hilfe = document.querySelector(".hinweis-liste");
  for (const text of [
    "Doppelklick auf die freie Wand: Modul suchen und genau dort einsetzen.",
    "Auswählen: auf der freien Wand ein Rechteck ziehen, oder Umschalt + Klick auf Titelleisten. Dann „Gruppe bilden“.",
    "In einer Gruppe: Rechtsklick (am Handy lange drücken) auf eine Buchse legt sie nach außen, auf einen Drehknopf macht ihn zum Makro. Zugeklappt sieht man nur diese.",
    "„Als Gruppe einfügen“ holt eine Vorlage (z. B. ein Instrument) als zugeklappte Gruppe dazu; „Gruppe speichern“ (Knopf an der Gruppe) schreibt sie als Datei, „Gruppe laden“ holt sie in einen anderen Patch.",
    "Zoom: Strg + Mausrad oder − und +.",
    "Fensterknöpfe: der linke klappt ein (nur Buchsen), der mittlere blendet das Bild aus.",
  ]) {
    const li = document.createElement("li");
    li.textContent = text;
    hilfe?.append(li);
  }
}

// ---------- Speichern, Laden, Vorlagen ----------
function alsDaten() {
  return {
    module: [...module.values()].map((m) => ({ id: m.id, typ: m.typ, x: Math.round(m.x), y: Math.round(m.y), werte: m.werte, ...(m.extraEl?.schritteLesen && { schritte: m.extraEl.schritteLesen() }) })),
    kabel: kabel.alle().map((k) => [k.von.modul.id, k.von.name, k.nach.modul.id, k.nach.name]),
    gruppen: gruppen.alsDaten(),
  };
}

function lade(daten) {
  leere();
  for (const m of daten.module) neuesModul(m);
  naechsteId = Math.max(1, ...[...module.keys()].map((id) => Number(id.replace(/\D/g, "")) + 1 || 1));
  // Kabel erst, wenn alle Fenster stehen (die Knöpfe werden im nächsten Bild gebaut)
  requestAnimationFrame(() => {
    for (const [a, an, b, bn] of daten.kabel) {
      const von = module.get(a), nach = module.get(b);
      if (!von || !nach) continue;
      try {
        kabel.verbinde({ modul: von, name: an }, { modul: nach, name: bn });
      } catch {}
    }
    gruppen.lade(daten.gruppen);
    merkeBald();
  });
}

let merkUhr = 0;
function merkeBald() {
  clearTimeout(merkUhr);
  merkUhr = setTimeout(() => {
    try {
      localStorage.setItem(SPEICHER, JSON.stringify(alsDaten()));
    } catch {}
  }, 500);
}
wand.addEventListener("input", merkeBald);
wand.addEventListener("change", merkeBald);
wand.addEventListener("click", (ev) => ev.target.closest(".schritt button") && merkeBald());

{
  const wahl = hole("vorlage");
  for (const [name, v] of Object.entries(VORLAGEN)) wahl.append(new Option(v.text, name));
  wahl.addEventListener("change", () => {
    if (!wahl.value) return;
    lade(VORLAGEN[wahl.value]);
    wand.scrollTo(0, 0);
    wahl.value = "";
  });
}
hole("speichern").addEventListener("click", () => ladeHerunter(new Blob([JSON.stringify(alsDaten(), null, 1)], { type: "application/json" }), `patch-${zeitstempel()}.json`));
hole("laden").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    lade(JSON.parse(await f.text()));
  } catch {
    melde("Das ist kein Patch (JSON aus „Patch speichern“).");
  }
  ev.target.value = "";
});

// ---------- Aufnehmen ----------
// MediaRecorder nimmt den Strom am Ausgang auf (Opus in WebM, in Safari AAC in MP4)
let rekorder = null;
hole("aufnahme").addEventListener("click", (ev) => {
  if (rekorder) return rekorder.stop();
  const teile = [];
  rekorder = new MediaRecorder(aufnahmeZiel.stream);
  rekorder.ondataavailable = (e) => teile.push(e.data);
  rekorder.onstop = () => {
    const typ = rekorder.mimeType || "audio/webm";
    ladeHerunter(new Blob(teile, { type: typ }), `patch-${zeitstempel()}.${typ.includes("mp4") ? "m4a" : "webm"}`);
    rekorder = null;
    ev.target.textContent = "Aufnehmen";
    ev.target.setAttribute("aria-pressed", "false");
  };
  rekorder.start();
  ev.target.textContent = "Aufnahme beenden";
  ev.target.setAttribute("aria-pressed", "true");
});

hole("stumm").addEventListener("click", async (ev) => {
  if (ctx.state === "running") await ctx.suspend();
  else await ctx.resume();
  ev.target.setAttribute("aria-pressed", ctx.state !== "running");
  ev.target.textContent = ctx.state === "running" ? "Pause" : "weiter";
});

// ---------- Bild-Schleife ----------
let zuletzt = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.05, (jetzt - zuletzt) / 1000);
  zuletzt = jetzt;
  gruppen.zeichne();
  kabel.zeichne(dt);
  for (const f of bild) f();
  requestAnimationFrame(schleife);
}

// zum Ausprobieren und für Tests
window.patch = { module, kabel, lade, alsDaten, VORLAGEN, gruppen, ansicht, ctx: () => ctx };
