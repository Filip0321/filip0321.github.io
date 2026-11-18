// Gruppen: mehrere Module zu einem Kasten, wie ein Instrument Rack in Ableton oder ein Container in Bitwig.
//
// Eine Gruppe ändert nichts am Ton: die Module und Kabel bleiben, was sie sind. Sie ändert nur, was man sieht.
//   aufgeklappt  die Module stehen auf der Wand, ein Rahmen mit Titelleiste liegt um sie herum. Ziehen an der
//                Leiste verschiebt alle zusammen.
//   zugeklappt   die Module sind versteckt; an ihrer Stelle steht ein Fenster mit den Buchsen „nach außen“ und
//                den Makros. Kabel zu versteckten Modulen enden an diesen Buchsen (kabel.js fragt umleiten()),
//                Kabel ganz innen werden nicht gezeichnet (innen()).
// Nach außen legen: im aufgeklappten Zustand Rechtsklick (am Handy lange drücken) auf eine Buchse; sie bekommt
// einen doppelten Rand. Makro: Rechtsklick auf einen Drehknopf. Beim Bilden einer Gruppe liegen alle Buchsen,
// an denen schon ein Kabel nach draußen geht, von selbst außen.
// Ein Makro ist eine zweite Ansicht desselben Reglers: drehen am Makro stellt den Regler innen (und umgekehrt).
//
// Presets (Runde 23): eine Gruppe kann mehrere Einstellungen kennen (Vogel: Amsel, Kohlmeise, Spatz …). Ein Preset ist
// je Mitglied eine Liste von Werten (Knöpfe und Auswahlen) und ob es aus ist (⏻). Die Auswahl steht in der Titelleiste;
// gewählt wird es genau so, als hätte man selbst an allen Knöpfen gedreht. Man sieht danach, was sich verändert hat.
//
// Gespeichert wird eine Gruppe als { id, titel, mitglieder, offen, aussen, makros, presets, preset, x, y } im Patch; als eigene
// Datei („Gruppe speichern“) mit ihren Modulen und inneren Kabeln, zum Einfügen in andere Patches.

import { macheDrehknopf } from "/lib/knopfRegler.js";
import { setzeWert } from "./fenster.js";

let zaehler = 1;

export function erstelleGruppen({ flaeche, lokal, module, kabel, neuesModul, buchseGedrueckt, merkeBald, melde, ladeHerunter, zeitstempel, stummSchalten = () => {} }) {
  const gruppen = new Map(); // id → gruppe
  const gruppeVon = (m) => (m?.gruppe ? gruppen.get(m.gruppe) : null);

  // ---------- Kabel ----------
  function umleiten(modul, name, richtung) {
    const g = gruppeVon(modul);
    if (!g || g.offen || !g.el) return null;
    return g.el.querySelector(`.buchse.${richtung}[data-modul="${modul.id}"][data-name="${CSS.escape(name)}"]`)
      ?? g.el.querySelector(richtung === "ein" ? ".gruppe-rand-ein" : ".gruppe-rand-aus");
  }
  function innen(k) {
    const a = gruppeVon(k.von.modul), b = gruppeVon(k.nach.modul);
    return Boolean(a && a === b && !a.offen);
  }

  // ---------- Bilden, Auflösen ----------
  function bilden(liste, { titel = "Gruppe", offen = true, aussen = null, makros = [], id = null, presets = null, preset = null } = {}) {
    liste = liste.filter((m) => m && !m.gruppe);
    if (!liste.length) return null;
    const g = { id: id ?? `g${zaehler++}`, titel, mitglieder: new Set(liste), offen, aussen: [], makros: [], x: 0, y: 0, el: null, rahmen: null, presets, preset };
    for (const m of liste) m.gruppe = g.id;
    gruppen.set(g.id, g);
    // außen: angegeben, sonst alle Buchsen mit Kabeln nach draußen
    if (aussen) g.aussen = aussen.filter((a) => g.mitglieder.has(a.modul));
    else
      for (const k of kabel.alle()) {
        const vonDrin = g.mitglieder.has(k.von.modul), nachDrin = g.mitglieder.has(k.nach.modul);
        if (vonDrin && !nachDrin) merkeAussen(g, k.von.modul, k.von.name, "aus", k.art);
        if (nachDrin && !vonDrin) merkeAussen(g, k.nach.modul, k.nach.name, "ein", k.art);
      }
    g.makros = makros.filter((x) => g.mitglieder.has(x.modul));
    const box = umriss(g);
    g.x = box.x;
    g.y = box.y;
    baue(g);
    merkeBald();
    return g;
  }
  function merkeAussen(g, modul, name, richtung, art) {
    if (g.aussen.some((a) => a.modul === modul && a.name === name && a.richtung === richtung)) return;
    g.aussen.push({ modul, name, richtung, art });
  }
  function aufloesen(g) {
    for (const m of g.mitglieder) {
      delete m.gruppe;
      m.el.hidden = false;
    }
    g.el?.remove();
    g.rahmen?.remove();
    gruppen.delete(g.id);
    markiere();
    merkeBald();
  }

  // Umriss der Mitglieder (lokale Koordinaten)
  function umriss(g) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of g.mitglieder) {
      x0 = Math.min(x0, m.x);
      y0 = Math.min(y0, m.y);
      x1 = Math.max(x1, m.x + (m.el.offsetWidth || 300));
      y1 = Math.max(y1, m.y + (m.el.offsetHeight || 200));
    }
    return { x: x0, y: y0, b: x1 - x0, h: y1 - y0 };
  }

  // ---------- Aussehen ----------
  function knopf(klasse, text, titel, aktion) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = klasse;
    b.setAttribute("aria-label", text);
    b.title = titel;
    b.addEventListener("click", aktion);
    return b;
  }

  // Titelleiste zum Ziehen: verschiebt alle Mitglieder (und das zugeklappte Fenster) um dasselbe Stück
  function ziehbar(leiste, g) {
    let griff = null;
    leiste.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button") || ev.target.isContentEditable) return;
      griff = lokal(ev.clientX, ev.clientY);
      leiste.setPointerCapture(ev.pointerId);
    });
    leiste.addEventListener("pointermove", (ev) => {
      if (!griff) return;
      const p = lokal(ev.clientX, ev.clientY);
      verschiebe(g, p.x - griff.x, p.y - griff.y);
      griff = p;
    });
    const los = () => {
      if (griff) merkeBald();
      griff = null;
    };
    leiste.addEventListener("pointerup", los);
    leiste.addEventListener("pointercancel", los);
  }
  function verschiebe(g, dx, dy) {
    for (const m of g.mitglieder) {
      m.x = Math.max(0, m.x + dx);
      m.y = Math.max(0, m.y + dy);
      m.el.style.left = `${m.x}px`;
      m.el.style.top = `${m.y}px`;
    }
    g.x = Math.max(0, g.x + dx);
    g.y = Math.max(0, g.y + dy);
    if (g.el) {
      g.el.style.left = `${g.x}px`;
      g.el.style.top = `${g.y}px`;
    }
  }

  function titelFeld(g) {
    const h = document.createElement("h2");
    h.className = "fenster-titel";
    h.textContent = g.titel;
    h.contentEditable = "plaintext-only";
    h.spellcheck = false;
    h.title = "Name: anklicken und tippen";
    h.addEventListener("input", () => {
      g.titel = h.textContent.trim() || "Gruppe";
      for (const andere of [g.el, g.rahmen]) {
        const t = andere?.querySelector(".fenster-titel");
        if (t && t !== h) t.textContent = g.titel;
      }
      merkeBald();
    });
    h.addEventListener("keydown", (ev) => ev.key === "Enter" && (ev.preventDefault(), h.blur()));
    return h;
  }
  function knoepfeFuer(g) {
    const k = document.createElement("div");
    k.className = "fenster-knoepfe";
    // ⏻ (Runde 22b): die ganze Gruppe aus und wieder ein (alle Mitglieder)
    const alleStumm = () => [...g.mitglieder].every((m) => m.stumm || !Object.keys(m.teil.aus).length);
    const aus = knopf("stumm-knopf", "Gruppe ein- und ausschalten", "ein- und ausschalten (die Kabel bleiben stecken)", () => {
      const an = !alleStumm();
      for (const m of g.mitglieder) if (Object.keys(m.teil.aus).length) stummSchalten(m, an);
      aus.setAttribute("aria-pressed", String(an));
    });
    aus.textContent = "⏻";
    aus.setAttribute("aria-pressed", String(alleStumm()));
    k.append(
      aus,
      knopf("fenster-knopf deko gruppe-klappen", g.offen ? "Gruppe zuklappen" : "Gruppe aufklappen", g.offen ? "zuklappen" : "aufklappen", () => klappe(g, !g.offen)),
      knopf("fenster-knopf deko2 gruppe-speichern", "Gruppe als Datei speichern", "Gruppe speichern (zum Einfügen in andere Patches)", () => speichere(g)),
      knopf("fenster-knopf schliessen", "Gruppe auflösen", "Gruppe auflösen (die Module bleiben)", () => aufloesen(g)),
    );
    return k;
  }

  // Rahmen (aufgeklappt) und Fenster (zugeklappt) neu bauen
  // Preset anwenden: Werte stellen (setzeWert, wie gedreht), ⏻ setzen
  function wendeAn(g, name) {
    const p = g.presets?.[name];
    if (!p) return;
    g.preset = name;
    for (const [id, e] of Object.entries(p)) {
      const m = module.get(id);
      if (!m) continue;
      for (const [k, v] of Object.entries(e.werte ?? {})) setzeWert(m, k, v);
      if ("stumm" in e) stummSchalten(m, Boolean(e.stumm));
    }
    for (const w of [g.el, g.rahmen]) {
      const s = w?.querySelector(".gruppe-preset");
      if (s) s.value = name;
    }
    merkeBald();
  }
  function presetWahl(g) {
    const s = document.createElement("select");
    s.className = "gruppe-preset";
    s.setAttribute("aria-label", `${g.titel}: Preset`);
    for (const n of Object.keys(g.presets)) s.append(new Option(n, n));
    s.value = g.preset ?? Object.keys(g.presets)[0];
    s.addEventListener("pointerdown", (ev) => ev.stopPropagation()); // nicht die Gruppe ziehen
    s.addEventListener("change", () => wendeAn(g, s.value));
    return s;
  }

  function baue(g) {
    g.el?.remove();
    g.rahmen?.remove();
    g.el = g.rahmen = null;
    for (const m of g.mitglieder) m.el.hidden = !g.offen;
    if (g.offen) {
      const r = document.createElement("div");
      r.className = "gruppen-rahmen";
      const leiste = document.createElement("header");
      leiste.className = "fenster-leiste";
      leiste.append(titelFeld(g), ...(g.presets ? [presetWahl(g)] : []), knoepfeFuer(g));
      r.append(leiste);
      flaeche.append(r);
      ziehbar(leiste, g);
      g.rahmen = r;
      setzeRahmen(g);
    } else {
      const f = document.createElement("article");
      f.className = "fenster modul gruppe-fenster";
      // unter den Modul-Fenstern (die fangen bei 10 an, fenster.js): klappt man eine Gruppe auf, liegen ihre Module
      // über den anderen zugeklappten Gruppen und nicht darunter (Runde 22b; vorher 50000, über allem)
      f.style.zIndex = 5;
      f.style.left = `${g.x}px`;
      f.style.top = `${g.y}px`;
      const leiste = document.createElement("header");
      leiste.className = "fenster-leiste";
      leiste.append(titelFeld(g), knoepfeFuer(g));
      const inhalt = document.createElement("div");
      if (g.presets) {
        const reihe = document.createElement("div");
        reihe.className = "steuerung";
        const l = document.createElement("label");
        l.append("Preset ", presetWahl(g));
        reihe.append(l);
        inhalt.append(reihe);
      }
      inhalt.className = "fenster-inhalt";
      const buchsen = document.createElement("div");
      buchsen.className = "buchsen";
      const ein = document.createElement("ul"), aus = document.createElement("ul");
      ein.className = "eingaenge";
      aus.className = "ausgaenge";
      // unsichtbare Ränder: dort enden Kabel zu Buchsen, die nicht außen liegen
      const randEin = document.createElement("span"), randAus = document.createElement("span");
      randEin.className = "gruppe-rand-ein";
      randAus.className = "gruppe-rand-aus";
      for (const a of g.aussen) {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = `buchse ${a.richtung} ${a.art}`;
        Object.assign(b.dataset, { modul: a.modul.id, name: a.name, richtung: a.richtung, art: a.art });
        b.setAttribute("aria-label", `${g.titel}: ${a.modul.titel} ${a.name}`);
        b.addEventListener("pointerdown", (ev) => buchseGedrueckt(ev, b));
        const text = document.createElement("span");
        text.textContent = `${a.name} · ${a.modul.titel}`;
        if (a.richtung === "ein") li.append(b, text), ein.append(li);
        else li.append(text, b), aus.append(li);
      }
      buchsen.append(ein, aus);
      inhalt.append(randEin, randAus, buchsen);
      // Makros: eine zweite Ansicht des Reglers innen
      if (g.makros.length) {
        const knoepfe = document.createElement("div");
        knoepfe.className = "knoepfe";
        for (const mk of g.makros) {
          const original = mk.modul.el.querySelector(`input[data-regler="${CSS.escape(mk.name)}"]`);
          if (!original) continue;
          const label = document.createElement("label");
          const titel = original.closest("label")?.firstChild?.textContent ?? mk.name;
          label.append(`${titel}`);
          const e = document.createElement("input");
          e.type = "range";
          for (const at of ["min", "max", "step"]) e[at] = original[at];
          e.value = original.value;
          const zahl = document.createElement("output");
          const zeigeZahl = () => (zahl.textContent = original.closest("label")?.querySelector("output")?.textContent ?? "");
          label.append(e, zahl);
          label.title = mk.modul.titel;
          knoepfe.append(label);
          e.addEventListener("input", () => {
            original.value = e.value;
            original.dispatchEvent(new Event("input", { bubbles: true }));
            zeigeZahl();
          });
          original.addEventListener("input", () => {
            e.value = original.value;
            e.aktualisiereKnopf?.();
            zeigeZahl();
          });
          zeigeZahl();
          requestAnimationFrame(() => macheDrehknopf(e, titel, () => zahl.textContent));
        }
        inhalt.append(knoepfe);
      }
      f.append(leiste, inhalt);
      flaeche.append(f);
      ziehbar(leiste, g);
      g.el = f;
    }
    markiere();
  }

  function setzeRahmen(g) {
    if (!g.rahmen) return;
    const u = umriss(g), rand = 14;
    Object.assign(g.rahmen.style, {
      left: `${u.x - rand}px`, top: `${u.y - rand - 30}px`, width: `${u.b + 2 * rand}px`, height: `${u.h + 2 * rand + 30}px`,
    });
  }

  function klappe(g, offen) {
    if (!offen) {
      const u = umriss(g);
      g.x = u.x;
      g.y = u.y;
    }
    g.offen = offen;
    baue(g);
    merkeBald();
  }

  // außen liegende Buchsen und Makros im aufgeklappten Zustand kennzeichnen
  function markiere() {
    for (const el of flaeche.querySelectorAll(".nach-aussen, .als-makro")) el.classList.remove("nach-aussen", "als-makro");
    for (const g of gruppen.values()) {
      for (const a of g.aussen) a.modul.el.querySelector(`.buchse.${a.richtung}[data-name="${CSS.escape(a.name)}"]`)?.classList.add("nach-aussen");
      for (const mk of g.makros) mk.modul.el.querySelector(`input[data-regler="${CSS.escape(mk.name)}"]`)?.closest("label")?.classList.add("als-makro");
    }
  }

  // Rechtsklick (lange drücken) auf Buchse oder Knopf eines Moduls in einer Gruppe: nach außen / Makro
  flaeche.addEventListener("contextmenu", (ev) => {
    const fenster = ev.target.closest(".modul:not(.gruppe-fenster)");
    const m = fenster && module.get(fenster.dataset.modul);
    const g = gruppeVon(m);
    if (!g) return;
    const b = ev.target.closest(".buchse");
    const label = ev.target.closest(".knoepfe label");
    if (!b && !label) return;
    ev.preventDefault();
    if (b) {
      const i = g.aussen.findIndex((a) => a.modul === m && a.name === b.dataset.name && a.richtung === b.dataset.richtung);
      if (i >= 0) g.aussen.splice(i, 1);
      else g.aussen.push({ modul: m, name: b.dataset.name, richtung: b.dataset.richtung, art: b.dataset.art });
      melde(i >= 0 ? `${b.dataset.name} liegt nicht mehr außen.` : `${b.dataset.name} liegt jetzt außen an „${g.titel}“.`, 2500);
    } else {
      const name = label.querySelector("input[data-regler]")?.dataset.regler;
      if (!name) return;
      const i = g.makros.findIndex((x) => x.modul === m && x.name === name);
      if (i >= 0) g.makros.splice(i, 1);
      else g.makros.push({ modul: m, name });
      melde(i >= 0 ? "Makro entfernt." : `Makro an „${g.titel}“.`, 2500);
    }
    markiere();
    merkeBald();
  });

  // ---------- Auswahl (Rechteck auf der freien Wand, Umschalt + Klick auf die Titelleiste) ----------
  const auswahl = new Set();
  const zeigeAuswahl = () => {
    for (const m of module.values()) m.el.classList.toggle("markiert", auswahl.has(m));
    gruppeKnopf.disabled = !auswahl.size;
    gruppeKnopf.textContent = auswahl.size ? `Gruppe bilden (${auswahl.size})` : "Gruppe bilden";
  };
  const gruppeKnopf = document.createElement("button");
  gruppeKnopf.type = "button";
  gruppeKnopf.textContent = "Gruppe bilden";
  gruppeKnopf.disabled = true;
  gruppeKnopf.title = "Module auswählen: auf der freien Wand ein Rechteck ziehen, oder Umschalt + Klick auf Titelleisten";
  gruppeKnopf.addEventListener("click", () => {
    const g = bilden([...auswahl]);
    auswahl.clear();
    zeigeAuswahl();
    if (g) melde("Gruppe gebildet. Rechtsklick auf Buchsen und Knöpfe legt sie nach außen.", 4000);
  });

  let rechteck = null;
  flaeche.addEventListener("pointerdown", (ev) => {
    const titel = ev.target.closest(".modul:not(.gruppe-fenster) .fenster-leiste");
    if (titel && ev.shiftKey) {
      const m = module.get(titel.closest(".modul").dataset.modul);
      if (m && !m.gruppe) auswahl.has(m) ? auswahl.delete(m) : auswahl.add(m);
      zeigeAuswahl();
      return;
    }
    const frei = ev.target === flaeche || (ev.target.closest(".kabel-ebene") && !ev.target.closest(".kabel-griff"));
    if (!frei || ev.button !== 0) return;
    const p = lokal(ev.clientX, ev.clientY);
    const el = document.createElement("div");
    el.className = "auswahl-rechteck";
    flaeche.append(el);
    rechteck = { start: p, el, pointer: ev.pointerId };
    if (!ev.shiftKey) auswahl.clear();
  });
  window.addEventListener("pointermove", (ev) => {
    if (!rechteck || ev.pointerId !== rechteck.pointer) return;
    const p = lokal(ev.clientX, ev.clientY), a = rechteck.start;
    const x = Math.min(a.x, p.x), y = Math.min(a.y, p.y), b = Math.abs(p.x - a.x), h = Math.abs(p.y - a.y);
    Object.assign(rechteck.el.style, { left: `${x}px`, top: `${y}px`, width: `${b}px`, height: `${h}px` });
    rechteck.box = { x, y, b, h };
  });
  window.addEventListener("pointerup", (ev) => {
    if (!rechteck || ev.pointerId !== rechteck.pointer) return;
    const r = rechteck.box;
    rechteck.el.remove();
    rechteck = null;
    if (!r || r.b < 8 || r.h < 8) return zeigeAuswahl(); // nur geklickt: Auswahl leer
    for (const m of module.values()) {
      if (m.gruppe || m.el.hidden) continue;
      const mb = m.el.offsetWidth, mh = m.el.offsetHeight;
      if (m.x < r.x + r.b && m.x + mb > r.x && m.y < r.y + r.h && m.y + mh > r.y) auswahl.add(m);
    }
    zeigeAuswahl();
  });

  // ---------- Speichern, Laden, Einfügen ----------
  function alsDaten() {
    return [...gruppen.values()].map((g) => ({
      id: g.id, titel: g.titel, offen: g.offen, x: Math.round(g.x), y: Math.round(g.y),
      mitglieder: [...g.mitglieder].map((m) => m.id),
      aussen: g.aussen.map((a) => [a.modul.id, a.name, a.richtung, a.art]),
      makros: g.makros.map((mk) => [mk.modul.id, mk.name]),
      ...(g.presets && { presets: g.presets, preset: g.preset }),
    }));
  }
  function lade(liste = []) {
    for (const d of liste) {
      const mitglieder = d.mitglieder.map((id) => module.get(id)).filter(Boolean);
      const g = bilden(mitglieder, {
        id: d.id, titel: d.titel, offen: true,
        aussen: d.aussen.map(([id, name, richtung, art]) => ({ modul: module.get(id), name, richtung, art })),
        makros: d.makros.map(([id, name]) => ({ modul: module.get(id), name })),
        presets: d.presets ?? null, preset: d.preset ?? null,
      });
      if (!g) continue;
      zaehler = Math.max(zaehler, Number(String(d.id).replace(/\D/g, "")) + 1 || zaehler);
      if (!d.offen) {
        // erst im nächsten Bild zuklappen: die Fenster müssen stehen, damit die Makro-Regler gefunden werden
        requestAnimationFrame(() => {
          klappe(g, false);
          verschiebe(g, d.x - g.x, d.y - g.y);
        });
      }
    }
  }

  // eine Gruppe als eigene Datei: ihre Module, die Kabel zwischen ihnen, und was außen liegt
  function gruppeAlsDaten(g) {
    const ids = new Set([...g.mitglieder].map((m) => m.id));
    return {
      gruppe: { titel: g.titel, aussen: g.aussen.map((a) => [a.modul.id, a.name, a.richtung, a.art]), makros: g.makros.map((mk) => [mk.modul.id, mk.name]), ...(g.presets && { presets: g.presets, preset: g.preset }) },
      module: [...g.mitglieder].map((m) => ({ id: m.id, typ: m.typ, x: Math.round(m.x), y: Math.round(m.y), werte: m.werte, ...(m.extraEl?.schritteLesen && { schritte: m.extraEl.schritteLesen() }) })),
      kabel: kabel.alle().filter((k) => ids.has(k.von.modul.id) && ids.has(k.nach.modul.id)).map((k) => [k.von.modul.id, k.von.name, k.nach.modul.id, k.nach.name]),
    };
  }
  function speichere(g) {
    const text = JSON.stringify(gruppeAlsDaten(g), null, 1);
    ladeHerunter(new Blob([text], { type: "application/json" }), `gruppe-${g.titel.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-")}-${zeitstempel()}.json`);
  }

  // Module einer Gruppen-Datei (oder einer Vorlage) in den jetzigen Patch: neue Ids, an die Stelle (x, y), zugeklappt
  // ohne: Typen, die nicht mitkommen (Ausgang: den gibt es nur einmal); was an ihnen hing, liegt dann außen
  function fuegeEin(daten, x, y, { titel, ohne = ["ausgang"], startPreset = null } = {}) {
    const neu = new Map();
    const x0 = Math.min(...daten.module.map((m) => m.x)), y0 = Math.min(...daten.module.map((m) => m.y));
    // Mit Start-Preset kommen dessen Werte gleich beim Bau in die Module (nicht erst danach): sonst läuft für einen
    // Augenblick das erste Preset (Regen: 1800 Takte je Sekunde) in ein Modul, das gleich auf „Tropfstein“ umschaltet,
    // und die schon bestellten Tropfen klingen alle mit den neuen, langen Zeiten (gemessen: ein lauter Knall).
    const sp = startPreset && daten.gruppe?.presets?.[startPreset];
    for (const d of daten.module) {
      if (ohne.includes(d.typ)) continue;
      const werte = { ...d.werte, ...(sp?.[d.id]?.werte ?? {}) };
      if (sp?.[d.id]) {
        if (sp[d.id].stumm) werte.__stumm = true;
        else delete werte.__stumm;
      }
      const m = neuesModul({ ...d, id: null, x: x + d.x - x0, y: y + d.y - y0, werte });
      if (m) neu.set(d.id, m);
    }
    const aussen = (daten.gruppe?.aussen ?? []).map(([id, name, richtung, art]) => ({ modul: neu.get(id), name, richtung, art })).filter((a) => a.modul);
    requestAnimationFrame(() => {
      for (const [a, an, b, bn] of daten.kabel) {
        const von = neu.get(a), nach = neu.get(b);
        if (von && nach) {
          try {
            kabel.verbinde({ modul: von, name: an }, { modul: nach, name: bn });
          } catch {}
        } else if (von && !nach) {
          // ging an etwas, das nicht mitkommt (den Ausgang): dieser Ausgang liegt außen
          const art = von.teil.aus[an]?.art ?? "ton";
          if (!aussen.some((x) => x.modul === von && x.name === an)) aussen.push({ modul: von, name: an, richtung: "aus", art });
        }
      }
      // Presets: ihre Ids sind die der Datei, hier gelten die neuen
      let presets = null;
      if (daten.gruppe?.presets) {
        presets = {};
        for (const [n, p] of Object.entries(daten.gruppe.presets)) {
          presets[n] = {};
          for (const [id, e] of Object.entries(p)) if (neu.get(id)) presets[n][neu.get(id).id] = e;
        }
      }
      const g = bilden([...neu.values()], {
        titel: titel ?? daten.gruppe?.titel ?? "Gruppe", offen: true, aussen,
        makros: (daten.gruppe?.makros ?? []).map(([id, name]) => ({ modul: neu.get(id), name })),
        presets, preset: daten.gruppe?.preset ?? null,
      });
      if (g && presets && (startPreset ?? g.preset)) requestAnimationFrame(() => wendeAn(g, startPreset ?? g.preset));
      if (g) requestAnimationFrame(() => klappe(g, false));
      merkeBald();
    });
  }

  return {
    umleiten, innen, bilden, alsDaten, lade, fuegeEin, gruppeKnopf,
    // für Kopieren und Löschen (rueckgaengig.js): die markierten Module
    auswahl: () => [...auswahl],
    waehleAus(liste) {
      auswahl.clear();
      for (const m of liste) if (m && !m.gruppe) auswahl.add(m);
      zeigeAuswahl();
    },
    // jedes Bild: Rahmen um aufgeklappte Gruppen nachführen (Fenster darin können gezogen worden sein)
    zeichne() {
      for (const g of gruppen.values()) if (g.offen) setzeRahmen(g);
    },
    gezogen() {},
    // Runde 27: die Gruppe eines Moduls aufklappen (Arrangement: Klick auf einen Spurnamen) und ihren Titel geben
    oeffneVon(m) {
      const g = gruppeVon(m);
      if (g && !g.offen) klappe(g, true);
      return g;
    },
    titelVon: (m) => gruppeVon(m)?.titel ?? null,
    vergiss(m) {
      const g = gruppeVon(m);
      if (!g) return;
      g.mitglieder.delete(m);
      g.aussen = g.aussen.filter((a) => a.modul !== m);
      g.makros = g.makros.filter((x) => x.modul !== m);
      delete m.gruppe;
      if (!g.mitglieder.size) aufloesen(g);
    },
    alleWeg() {
      for (const g of [...gruppen.values()]) {
        g.el?.remove();
        g.rahmen?.remove();
        gruppen.delete(g.id);
      }
      for (const m of module.values()) delete m.gruppe;
    },
  };
}
