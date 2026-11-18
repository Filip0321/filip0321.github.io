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
import { erstelleRueckgaengig } from "./rueckgaengig.js";
import { KLAENGE, PRESET_SUCHE } from "./klaenge.js";
import { leser } from "./bausteine.js";
import { moduliere } from "./fenster.js";

const hole = (id) => document.getElementById(id);
const wand = hole("wand");
const svg = hole("kabel");
const meldung = hole("meldung");
const SPEICHER = "patch-wand";
let tempo = 120; // gemeinsames Tempo (BPM): neue Module übernehmen es, „Tempo“ oben stellt alle auf einmal

let ctx = null, uhr = null, lautsprecher = null, aufnahmeNode = null;
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
    // eigener stiller Abzweig des Master-Ausgangs für die verlustfreie WAV/MP3-Aufnahme
    // eigene Ton-Programme (Saite, Quantisierer, Bitcrusher, Band) laufen im Ton-Faden: einmal laden, bevor ein
    // Modul sie braucht
    try {
      await ctx.audioWorklet.addModule(new URL("./worklets.js", import.meta.url));
      aufnahmeNode = new AudioWorkletNode(ctx, "patch-aufnahme", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "explicit",
        outputChannelCount: [2],
      });
      aufnahmeNode.port.addEventListener("message", empfangeAufnahme);
      aufnahmeNode.port.start();
      const stille = ctx.createGain();
      stille.gain.value = 0;
      lautsprecher.connect(aufnahmeNode);
      aufnahmeNode.connect(stille).connect(ctx.destination);
    } catch (f) {
      melde(`Die Ton-Programme oder Aufnahme ließen sich nicht laden: ${f.message}`);
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
  modul.eingangBelegt = (name) => kabel.belegt(modul, name);
  // modul geht mit (Runde 22): so kann ein Modul fragen, ob an einem Eingang ein Kabel steckt (modul.eingangBelegt)
  modul.teil = def.baue(ctx, { uhr, bild, lautsprecher, melde, tempo: () => tempo, modul });
  // Module mit eigenem Tempo-Knopf (BPM) fangen im gemeinsamen Tempo an, wenn nichts anderes gespeichert ist
  if (hatTempo(modul) && modul.werte.tempo === undefined) modul.werte.tempo = tempo;
  modul.el = baueFenster(modul, { modLeser: () => leser(ctx), wand: flaeche, lokal, beiZiehen: (m, dx, dy) => { gruppen?.gezogen(m, dx, dy); merkeBald(); }, beiSchliessen: loesche, beiBuchse: buchseGedrueckt, beiStumm: stummSchalten });
  if (modul.werte.__stumm) stummSchalten(modul, true);
  if (schritte) modul.extraEl?.schritteSetzen?.(schritte);
  // Lämpchen: wenn ein Takt oder eine Note hinausgeht, leuchtet die Buchse kurz auf. Die Zeit ist eine Zeit der
  // Audio-Uhr, meist bis 100 ms in der Zukunft (vorausgeplant, takt.js): so lange warten, dann blinken
  for (const [name, a] of Object.entries(modul.teil.aus)) {
    if (a.art === "ton") continue;
    let zuletzt = 0;
    a.knoten.blink = (zeit) => {
      // höchstens 15-mal je Sekunde (ein Zufallsgeber für Regen schickt 2000 Takte je Sekunde)
      if (performance.now() - zuletzt < 66) return;
      zuletzt = performance.now();
      const b = modul.el.querySelector(`.buchse.aus[data-name="${CSS.escape(name)}"]`);
      if (!b) return;
      setTimeout(() => {
        b.classList.add("blitz");
        setTimeout(() => b.classList.remove("blitz"), 90);
      }, Math.max(0, (zeit - ctx.currentTime) * 1000));
    };
  }
  module.set(id, modul);
  merkeBald();
  return modul;
}

// ein Modul aus- oder einschalten (die Kabel bleiben, kabel.js trennt nur im Graph); gespeichert in werte.__stumm
function stummSchalten(m, an) {
  kabel.setzeStumm(m, an);
  m.werte.__stumm = an || undefined;
  m.el?.classList.toggle("stumm", an);
  m.el?.querySelector(".stumm-knopf")?.setAttribute("aria-pressed", String(an));
  merkeBald();
}

const hatTempo = (m) => m.teil.regler?.some((r) => r.name === "tempo" && r.einheit === "BPM");

// ---------- gemeinsames Tempo ----------
function setzeTempo(v, { alle = true } = {}) {
  tempo = Math.round(Math.min(220, Math.max(40, v)));
  tempoFeld.value = tempo;
  if (!alle) return;
  for (const m of module.values()) {
    if (!hatTempo(m)) continue;
    const knopf = m.el.querySelector('input[data-regler="tempo"]');
    if (!knopf) continue;
    knopf.value = tempo; // BPM-Knöpfe sind linear: Stellung = Wert
    knopf.dispatchEvent(new Event("input", { bubbles: true }));
  }
  merkeBald();
}
const tempoFeld = document.createElement("input");

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

hole("hinzu").addEventListener("click", () => fuegeAnSichtEin(hole("hinzu-typ").value));
function fuegeAnSichtEin(typ) {
  // dorthin, wohin man gerade schaut (Mitte des sichtbaren Teils der Wand), ein wenig versetzt
  const w = wand.getBoundingClientRect();
  const mitte = lokal(w.left + wand.clientWidth / 2, w.top + 60);
  const x = mitte.x - 180 + (Math.random() - 0.5) * 80;
  const y = mitte.y + Math.random() * 60;
  if (typ.startsWith("klang:")) return klangEinfuegen(typ.slice(6), Math.max(0, x), y);
  neuesModul({ typ, x: Math.max(0, x), y });
}

// Klänge als Gruppen (klaenge.js): eingefügt wie „Als Gruppe einfügen“, zugeklappt, mit ± hineinsehen
function klangEinfuegen(name, x, y) {
  // „vogel“ oder „vogel/Amsel“ (dann gleich mit diesem Preset)
  const [n, preset] = name.split("/");
  const d = KLAENGE[n];
  if (d) gruppen.fuegeEin(d, x, y, { titel: d.titel, startPreset: preset ?? null });
}

// Auswahl der Module, nach Gruppen
{
  const wahl = hole("hinzu-typ");
  const gruppen = {};
  // versteckt: die alten kompakten Natur-Module (Runde 23: jetzt Gruppen); alte Patches können sie weiter benutzen
  for (const [typ, def] of Object.entries(TYPEN)) if (!def.versteckt) (gruppen[def.gruppe] ??= []).push([typ, def.titel]);
  for (const [gruppe, liste] of Object.entries(gruppen)) {
    const g = document.createElement("optgroup");
    g.label = gruppe;
    for (const [typ, titel] of liste) g.append(new Option(titel, typ));
    wahl.append(g);
  }
  const g = document.createElement("optgroup");
  g.label = "Klänge (Gruppen)";
  for (const [name, d] of Object.entries(KLAENGE).filter(([, d]) => !d.versteckt)) g.append(new Option(d.titel, `klang:${name}`));
  wahl.append(g);

  // Runde 24: statt der langen Auswahl ein Knopf „Module“ mit aufklappbaren Themen (das Auswahlfeld bleibt
  // unsichtbar im HTML, damit die Seite unverändert bleiben kann). Ein Klick auf ein Modul setzt es in die Mitte der
  // Ansicht. Klang-Familien mit Presets klappen noch einmal auf: „Vogel“ → Amsel, Kohlmeise …
  const label = wahl.closest("label");
  label.hidden = true;
  hole("hinzu").hidden = true;
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "module-knopf";
  knopf.textContent = "Module ▾";
  knopf.setAttribute("aria-expanded", "false");
  const feld = document.createElement("div");
  feld.className = "modul-browser";
  feld.hidden = true;
  const eintrag = (text, typ, titel) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (titel) b.title = titel;
    b.addEventListener("click", () => {
      zu();
      fuegeAnSichtEin(typ);
    });
    return b;
  };
  const thema = (name, inhalt) => {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = name;
    const liste = document.createElement("div");
    liste.className = "modul-liste";
    liste.append(...inhalt);
    d.append(s, liste);
    return d;
  };
  for (const [gruppe, liste] of Object.entries(gruppen)) feld.append(thema(gruppe, liste.map(([typ, titel]) => eintrag(titel, typ))));
  feld.append(thema("Klänge (Gruppen)", Object.entries(KLAENGE).filter(([, d]) => !d.versteckt).map(([name, d]) => {
    const presets = Object.keys(d.gruppe.presets ?? {});
    if (!presets.length) return eintrag(d.titel, `klang:${name}`, d.text);
    const f = thema(d.titel, presets.map((p) => eintrag(p, `klang:${name}/${p}`, `${d.titel} mit Preset ${p}`)));
    f.className = "familie";
    return f;
  })));
  const zu = () => {
    feld.hidden = true;
    knopf.setAttribute("aria-expanded", "false");
  };
  knopf.addEventListener("click", () => {
    feld.hidden = !feld.hidden;
    knopf.setAttribute("aria-expanded", String(!feld.hidden));
  });
  document.addEventListener("pointerdown", (ev) => !feld.hidden && !feld.contains(ev.target) && ev.target !== knopf && zu());
  document.addEventListener("keydown", (ev) => ev.key === "Escape" && zu());
  label.after(knopf, feld);
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
    if (typ.startsWith("klang:")) return klangEinfuegen(typ.slice(6), Math.max(0, x - 20), Math.max(0, y - 10));
    neuesModul({ typ, x: Math.max(0, x - 20), y: Math.max(0, y - 10) });
  };
  const zeige = () => {
    const q = feld.value.trim().toLowerCase();
    const alle = [...Object.entries(TYPEN).filter(([, d]) => !d.versteckt), ...Object.entries(KLAENGE).filter(([, d]) => !d.versteckt).map(([n, d]) => [`klang:${n}`, { titel: `${d.titel} (Gruppe)`, gruppe: "Klänge" }]),
      ...PRESET_SUCHE.map((p) => [`klang:${p.name}/${p.preset}`, { titel: p.titel, gruppe: "Klänge" }])];
    liste.replaceChildren(...alle
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
gruppen = erstelleGruppen({ flaeche, lokal, module, kabel, neuesModul, buchseGedrueckt, merkeBald, melde, ladeHerunter, zeitstempel, stummSchalten });
const rueckgaengig = erstelleRueckgaengig({ alsDaten, lade, module, kabel, neuesModul, loesche, gruppen, melde, merkeBald });
{
  const leiste = hole("bedienung");
  // Instrument (eine Vorlage) als zugeklappte Gruppe dazu, ohne den Patch zu ersetzen
  const instrument = document.createElement("label");
  instrument.append("Als Gruppe einfügen ");
  const wahl = document.createElement("select");
  wahl.append(new Option("Vorlage wählen …", ""));
  for (const [name, v] of Object.entries(VORLAGEN)) if (name !== "leer") wahl.append(new Option(v.text.split(":")[0], name));
  for (const [name, d] of Object.entries(KLAENGE).filter(([, d]) => !d.versteckt)) wahl.append(new Option(`Klang: ${d.titel}`, `klang:${name}`));
  wahl.addEventListener("change", () => {
    if (!wahl.value) return;
    const w = wand.getBoundingClientRect();
    const p = lokal(w.left + 40, w.top + 40);
    if (wahl.value.startsWith("klang:")) {
      klangEinfuegen(wahl.value.slice(6), p.x, p.y);
      wahl.value = "";
      return;
    }
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
  // Tempo für alle, mit Tippen (Tap): der Abstand der letzten Klicks ergibt das Tempo
  const tempoGruppe = document.createElement("span");
  tempoGruppe.className = "steuerung-gruppe tempo-gruppe";
  tempoFeld.type = "number";
  tempoFeld.min = 40;
  tempoFeld.max = 220;
  tempoFeld.value = tempo;
  tempoFeld.setAttribute("aria-label", "Tempo für alle Module in BPM");
  tempoFeld.addEventListener("change", () => setzeTempo(Number(tempoFeld.value) || 120));
  const tippen = document.createElement("button");
  tippen.type = "button";
  tippen.textContent = "tippen";
  tippen.title = "Im Takt mehrmals klicken";
  let tipps = [];
  tippen.addEventListener("click", () => {
    const t = performance.now();
    tipps = tipps.filter((x) => t - x < 2500).concat(t);
    if (tipps.length >= 3) setzeTempo(60000 / ((tipps.at(-1) - tipps[0]) / (tipps.length - 1)));
  });
  tempoGruppe.append("Tempo ", tempoFeld, " BPM ", tippen);
  // Rückgängig und Wiederholen auch als Knöpfe (Strg+Z, Strg+Umschalt+Z)
  const rueckKnopf = document.createElement("button"), wiederKnopf = document.createElement("button");
  rueckKnopf.type = wiederKnopf.type = "button";
  rueckKnopf.textContent = "↶";
  wiederKnopf.textContent = "↷";
  rueckKnopf.title = "Rückgängig (Strg+Z)";
  wiederKnopf.title = "Wiederholen (Strg+Umschalt+Z)";
  rueckKnopf.setAttribute("aria-label", "Rückgängig");
  wiederKnopf.setAttribute("aria-label", "Wiederholen");
  rueckKnopf.addEventListener("click", () => rueckgaengig.rueck());
  wiederKnopf.addEventListener("click", () => rueckgaengig.wieder());
  const rw = document.createElement("span");
  rw.className = "steuerung-gruppe";
  rw.append(rueckKnopf, wiederKnopf);
  leiste.append(tempoGruppe, rw, gruppen.gruppeKnopf, instrument, laden, zoom);
  // Hilfe ergänzen (ohne die Seite selbst zu ändern)
  const hilfe = document.querySelector(".hinweis-liste");
  for (const text of [
    "Doppelklick auf die freie Wand: Modul suchen und genau dort einsetzen.",
    "Auswählen: auf der freien Wand ein Rechteck ziehen, oder Umschalt + Klick auf Titelleisten. Dann „Gruppe bilden“.",
    "In einer Gruppe: Rechtsklick (am Handy lange drücken) auf eine Buchse legt sie nach außen, auf einen Drehknopf macht ihn zum Makro. Zugeklappt sieht man nur diese.",
    "„Als Gruppe einfügen“ holt eine Vorlage (z. B. ein Instrument) als zugeklappte Gruppe dazu; „Gruppe speichern“ (Knopf an der Gruppe) schreibt sie als Datei, „Gruppe laden“ holt sie in einen anderen Patch.",
    "Zoom: Strg + Mausrad oder − und +.",
    "Fensterknöpfe: „?“ erklärt das Modul, dann einklappen (nur Buchsen), Bild aus, schließen.",
    "Tempo oben stellt alle Module mit BPM-Knopf auf einmal; jedes kann danach trotzdem sein eigenes haben.",
    "Strg+Z rückgängig, Strg+Umschalt+Z wiederholen. Markierte Module: Strg+C, Strg+V, Strg+D (verdoppeln), Entf.",
    "Buchsen: gepunktet mit Doppelrand sind Noten (viele Töne zugleich, für Akkorde: Tastatur, Pianoroll, Akkorde → Stimmen).",
    "Die Tastatur spielt mit der Computertastatur wie in Ableton: A S D F … sind weiße Tasten, W E T Z U schwarze, Y/X Oktave, C/V Anschlag.",
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
    tempo,
  };
}

function lade(daten) {
  leere();
  // gemeinsames Tempo: gespeichert, sonst das des ersten Moduls mit BPM-Knopf (ältere Patches und Vorlagen)
  const t = daten.tempo ?? daten.module.find((m) => m.werte?.tempo > 30)?.werte.tempo;
  if (t) setzeTempo(t, { alle: false });
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
    const text = JSON.stringify(alsDaten());
    rueckgaengig.merke(text);
    try {
      localStorage.setItem(SPEICHER, text);
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

// ---------- Audio exportieren ----------
// Die Worklet-Aufnahme erfasst den kompletten Master-Ausgang unabhängig vom Browser-Container.
// WAV wird direkt geschrieben; MP3 wird bei Bedarf mit lamejs (LGPL-3.0) kodiert.
let rekorder = null;
let mp3Ladevorgang = null;
const aufnahmeKnopf = hole("aufnahme");
const formatFeld = hole("aufnahme-format");
formatFeld.addEventListener("change", () => {
  if (formatFeld.value === "mp3") ladeMp3Encoder().catch(() => {}); // Encoder vorladen, damit Stopp sofort exportiert
});

function sammleSamples(bloecke, gesamt) {
  const ergebnis = new Float32Array(gesamt);
  let position = 0;
  for (const block of bloecke) {
    ergebnis.set(block, position);
    position += block.length;
  }
  return ergebnis;
}

function alsWav(links, rechts, rate) {
  const datenBytes = links.length * 4; // Stereo, 16 Bit pro Kanal
  const puffer = new ArrayBuffer(44 + datenBytes);
  const v = new DataView(puffer);
  const text = (pos, wort) => [...wort].forEach((z, i) => v.setUint8(pos + i, z.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + datenBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, datenBytes, true);
  let pos = 44;
  for (let i = 0; i < links.length; i++) {
    v.setInt16(pos, Math.max(-32768, Math.min(32767, Math.round(links[i] * 32768))), true);
    v.setInt16(pos + 2, Math.max(-32768, Math.min(32767, Math.round(rechts[i] * 32768))), true);
    pos += 4;
  }
  return new Blob([puffer], { type: "audio/wav" });
}

async function ladeMp3Encoder() {
  if (window.lamejs?.Mp3Encoder) return window.lamejs;
  if (!mp3Ladevorgang) {
    mp3Ladevorgang = new Promise((fertig, fehler) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.onload = () => window.lamejs?.Mp3Encoder ? fertig(window.lamejs) : fehler(new Error("MP3-Encoder wurde nicht initialisiert."));
      script.onerror = () => fehler(new Error("Der MP3-Encoder konnte nicht geladen werden. Prüfe die Internetverbindung oder wähle WAV."));
      document.head.append(script);
    }).catch((fehler) => {
      mp3Ladevorgang = null;
      throw fehler;
    });
  }
  return mp3Ladevorgang;
}

async function alsMp3(links, rechts, rate) {
  const lamejs = await ladeMp3Encoder();
  // LAME arbeitet mit MPEG-Abtastraten bis 48 kHz. Ungewöhnliche Interface-Raten werden beim Kodieren
  // linear auf die nächstliegende unterstützte Rate umgerechnet; WAV bleibt in der Originalrate.
  const raten = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
  const mp3Rate = raten.includes(rate) ? rate : raten.reduce((a, b) => Math.abs(b - rate) < Math.abs(a - rate) ? b : a);
  const encoder = new lamejs.Mp3Encoder(2, mp3Rate, 192);
  const teile = [];
  const groesse = 1152;
  const ausgabeLaenge = Math.ceil(links.length * mp3Rate / rate);
  for (let start = 0; start < ausgabeLaenge; start += groesse) {
    const laenge = Math.min(groesse, ausgabeLaenge - start);
    const l = new Int16Array(laenge), r = new Int16Array(laenge);
    for (let j = 0; j < laenge; j++) {
      const quelle = (start + j) * rate / mp3Rate;
      const i = Math.min(links.length - 1, Math.floor(quelle));
      const t = quelle - i, k = Math.min(links.length - 1, i + 1);
      l[j] = Math.max(-32768, Math.min(32767, Math.round((links[i] + (links[k] - links[i]) * t) * 32767)));
      r[j] = Math.max(-32768, Math.min(32767, Math.round((rechts[i] + (rechts[k] - rechts[i]) * t) * 32767)));
    }
    const teil = encoder.encodeBuffer(l, r);
    if (teil.length) teile.push(teil);
    // Längere Aufnahmen kodieren, ohne die Bedienoberfläche minutenlang zu blockieren.
    if (start && start % (groesse * 128) === 0) await new Promise(requestAnimationFrame);
  }
  const ende = encoder.flush();
  if (ende.length) teile.push(ende);
  return new Blob(teile, { type: "audio/mpeg" });
}

function empfangeAufnahme(event) {
  const daten = event.data;
  if (!rekorder) return;
  if (daten.art === "block") {
    rekorder.links.push(daten.links);
    rekorder.rechts.push(daten.rechts);
    rekorder.laenge += daten.links.length;
  } else if (daten.art === "fertig") {
    rekorder.fertig?.();
  }
}

aufnahmeKnopf.addEventListener("click", async () => {
  if (!aufnahmeNode) return melde("Die Audioaufnahme ist in diesem Browser nicht verfügbar. Lade die Seite neu und starte den Ton erneut.");
  if (!rekorder) {
    rekorder = { format: formatFeld.value, links: [], rechts: [], laenge: 0, fertig: null };
    aufnahmeNode.port.postMessage({ art: "start" });
    aufnahmeKnopf.textContent = "Aufnahme beenden";
    aufnahmeKnopf.setAttribute("aria-pressed", "true");
    return;
  }

  const aufnahme = rekorder;
  aufnahmeKnopf.disabled = true;
  aufnahmeKnopf.textContent = aufnahme.format === "mp3" ? "MP3 wird kodiert …" : "WAV wird gespeichert …";
  try {
    if (ctx.state !== "running") await ctx.resume();
    await new Promise((fertig) => {
      aufnahme.fertig = fertig;
      aufnahmeNode.port.postMessage({ art: "stop" });
    });
    const links = sammleSamples(aufnahme.links, aufnahme.laenge);
    const rechts = sammleSamples(aufnahme.rechts, aufnahme.laenge);
    if (!links.length) throw new Error("Die Aufnahme enthält keine Samples.");

    let blob, format = aufnahme.format;
    if (format === "mp3") {
      try {
        blob = await alsMp3(links, rechts, ctx.sampleRate);
      } catch (fehler) {
        console.warn("MP3-Export nicht möglich, speichere WAV:", fehler);
        blob = alsWav(links, rechts, ctx.sampleRate);
        format = "wav";
        melde(`MP3 nicht verfügbar (${fehler.message}). Die Aufnahme wurde als WAV gespeichert.`);
      }
    } else {
      blob = alsWav(links, rechts, ctx.sampleRate);
    }
    ladeHerunter(blob, `patch-${zeitstempel()}.${format}`);
    if (format === aufnahme.format) melde(`${format.toUpperCase()} exportiert.`);
  } catch (fehler) {
    console.error(fehler);
    melde(`Audioexport fehlgeschlagen: ${fehler.message}`);
  } finally {
    rekorder = null;
    aufnahmeKnopf.disabled = false;
    aufnahmeKnopf.textContent = "Aufnehmen";
    aufnahmeKnopf.setAttribute("aria-pressed", "false");
  }
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
  for (const m of module.values()) moduliere(m); // Kabel an Drehknöpfen (fenster.js)
  for (const f of bild) f();
  requestAnimationFrame(schleife);
}

// zum Ausprobieren und für Tests
// Hinweise zu Runde 23 unter „So geht es“ (aus JS, damit die HTML-Seite bleibt, wie sie ist)
{
  const liste = document.querySelector(".hinweis-liste");
  for (const t of [
    "Jeder Drehknopf hat daneben eine kleine Buchse: ein Kabel dort (LFO, Zufall, Hüllkurve) dreht den Knopf. 1,0 am Kabel = eine halbe Umdrehung des Knopfs nach rechts, −1,0 nach links; der Zeiger zeigt den bewegten Wert.",
    "⏻ an jedem Modul und jeder Gruppe: aus- und einschalten, ohne Kabel zu ziehen.",
    "Klänge sind Gruppen: ± klappt sie auf. Gruppen mit „Preset“ (Vogel, Frosch, Bläser, Tasten …) drehen beim Wechsel an Knöpfen und schalten Teile aus; man sieht danach, was sich geändert hat.",
    "Was ein Eingang erwartet: Maus auf die Buchse halten, oder „?“ am Modul.",
  ]) {
    if (!liste) break;
    const li = document.createElement("li");
    li.textContent = t;
    liste.append(li);
  }
}

window.patch = { module, kabel, lade, alsDaten, VORLAGEN, KLAENGE, gruppen, ansicht, ctx: () => ctx, klangEinfuegen };


