// Ein Modul als Fenster an der Wand: XP-Fenster wie auf der Startseite (/css/fenster.css; „schlichte Fenster“
// gilt auch hier), mit Buchsen links (Eingänge) und rechts (Ausgänge), Drehknöpfen (/lib/knopfRegler.js),
// Auswahlfeldern und eigenem Inhalt. Ziehen an der Titelleiste verschiebt, das Kreuz löscht das Modul.
//
// Buchsen sind Quadrate (Regel 2: keine Rundungen; nur Drehknöpfe sind rund): hohl für Eingänge, gefüllt für
// Ausgänge. Takt-Buchsen (Ereignisse statt Ton) sind gestrichelt, ihre Kabel auch; Noten-Buchsen (viele Töne
// zugleich) haben einen Doppelrand, ihre Kabel sind gepunktet.

import { macheDrehknopf } from "/lib/knopfRegler.js";
import { HILFE } from "./hilfe.js";

let oben = 10; // höchster z-index bisher

// Knopf ↔ Wert: logarithmische Regler laufen intern von 0 bis 1, Wert = min · (max / min)^t. So liegt
// 100 Hz bei 20–4000 Hz ungefähr in der Mitte des Wegs (wie man Tonhöhen hört), linear wäre es ganz links.
const zuWert = (r, t) => (r.log ? r.min * (r.max / r.min) ** t : t);
const zuStellung = (r, v) => (r.log ? Math.log(v / r.min) / Math.log(r.max / r.min) : v);
const zeige = (r, v) => {
  if (r.einheit === "s" && v < 1) return `${Math.round(v * 1000)} ms`; // 0,002 s liest sich besser als 2 ms
  const z = r.schritt === 1 || Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return r.einheit ? `${z} ${r.einheit}` : `${z}`;
};

// lokal(x, y): Bildschirm → Koordinaten der Wand (ansicht.js, wegen Zoom)
// Was an einer Buchse ankommt oder hinausgeht (Runde 23): als Tooltip und im „?“. Ein Modul kann es selbst angeben
// (info an der Buchse), sonst gilt, was hier für den Namen steht, sonst das für die Art.
const BUCHSEN_INFO = {
  "Tonhöhe": "Tonhöhe: 1,0 = eine Oktave höher, 1/12 = ein Halbton, 0 = wie der Knopf",
  Grenze: "Grenze verschieben: 1,0 = so viele Oktaven höher, wie der Knopf „Mod“ sagt",
  Steuerung: "Lautstärke dazu: 0 = still (bei Grundpegel 0), 1 = voll. Hüllkurve, LFO, Zufall hier hinein",
  FM: "Frequenz-Modulation: Abweichung in Hz = Kabel × FM-Tiefe",
  Lage: "Panorama dazu: −1 links, 0 Mitte, 1 rechts",
  Dichte: "wie oft: Kabel 1,0 = doppelt so oft, 0 = wie eingestellt, −1,0 = nie",
  "Aktivität": "Lust zu rufen: 0 = still, 1 = normal, 2 = doppelt so oft",
  Temperatur: "Temperatur dazu: 1,0 = 10 °C wärmer (wärmer = schneller, Dolbear)",
  "Stärke": "Windstärke dazu: 0,5 = deutlich mehr Wind",
  Vokal: "Vokal verschieben: 0 … 1 geht u – o – a – e – i, zum Knopf dazu",
  Tempo: "Tempo dazu (in der Einheit des Knopfs)",
  dazu: "wird zum Ausgang addiert",
  A: "Zahl A (Ton oder Steuerspannung)", B: "Zahl B, dazu der Knopf „B“",
};
const ART_INFO = {
  ton: "Ton: eine Zahl je Sample, 48 000 je Sekunde (Klang oder Steuerspannung)",
  takt: "Takt: ein Ereignis zu einer Zeit (Anschlag), ohne Zahl; gehalten bis „los“",
  noten: "Noten: Tonhöhe, Anschlag und Dauer, viele zugleich (wie MIDI)",
};
export const buchsenInfo = (e, name) => e.info ?? BUCHSEN_INFO[name] ?? (name.startsWith("⤳") ? "Modulation des Knopfs: ±1,0 = ± halber Weg des Knopfs (wie ein LFO an einen Regler)" : ART_INFO[e.art]);

// Einen Regler oder eine Auswahl von außen stellen (Gruppen-Presets, Tempo): so, als hätte man gedreht
export function setzeWert(modul, name, wert) {
  const r = modul.teil.regler?.find((x) => x.name === name);
  const knopf = modul.el.querySelector(`input[data-regler="${CSS.escape(name)}"]`);
  if (r && knopf) {
    knopf.value = zuStellung(r, Number(wert));
    knopf.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const wahl = modul.el.querySelector(`select[data-wahl="${CSS.escape(name)}"]`);
  if (wahl) {
    wahl.value = String(wert);
    wahl.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

// Kabel an Drehknöpfen (Runde 23): jedes Bild (main.js) den Knopf um das Kabel verschieben. In der Stellung des Knopfs
// gerechnet (0 … 1 seines Wegs): ±1,0 am Kabel = ± halber Weg. Bei log-Knöpfen (Frequenzen) heißt das: gleich viele
// Oktaven nach oben wie nach unten. Ohne Kabel wieder der eingestellte Wert.
export function moduliere(modul) {
  for (const mo of modul.modulationen ?? []) {
    const an = modul.eingangBelegt(mo.name);
    if (!an && !mo.aktiv) continue;
    const { r, eingabe, anzeige } = mo;
    const lo = Number(eingabe.min), hi = Number(eingabe.max), stellung = (Number(eingabe.value) - lo) / (hi - lo);
    const t = an ? Math.max(0, Math.min(1, stellung + mo.l.wert() * 0.5)) : stellung;
    const v = zuWert(r, lo + t * (hi - lo));
    r.setze(v);
    anzeige.textContent = zeige(r, v);
    eingabe.parentElement.style.setProperty("--mod", t - stellung);
    eingabe.parentElement.classList.toggle("moduliert", an);
    mo.aktiv = an;
  }
}

export function baueFenster(modul, { wand, lokal, beiZiehen, beiSchliessen, beiBuchse, beiStumm, modLeser }) {
  const { teil, titel } = modul;
  const f = document.createElement("article");
  f.className = "fenster modul";
  f.dataset.modul = modul.id;
  f.style.left = `${modul.x}px`;
  f.style.top = `${modul.y}px`;
  f.innerHTML = `<header class="fenster-leiste"><h2 class="fenster-titel"></h2><div class="fenster-knoepfe">
    <button type="button" class="fenster-knopf deko einklappen" aria-label="Modul einklappen" title="einklappen (nur Buchsen)"></button>
    <button type="button" class="fenster-knopf deko2 bild-schalter" aria-label="Bild an oder aus" title="Bild an / aus"></button>
    <button type="button" class="fenster-knopf schliessen" aria-label="Modul löschen"></button></div></header>
    <div class="fenster-inhalt"><div class="buchsen"><ul class="eingaenge"></ul><ul class="ausgaenge"></ul></div></div>`;
  f.querySelector(".fenster-titel").textContent = titel;
  if (teil.klasse) f.classList.add(...teil.klasse.split(" ")); // z. B. „breit“ (Pianoroll, Lenia)
  const inhalt = f.querySelector(".fenster-inhalt");

  // „?“: was das Modul macht, aufklappbar über den Buchsen (Texte in hilfe.js)
  if (HILFE[modul.typ]) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "hilfe-knopf";
    knopf.textContent = "?";
    knopf.setAttribute("aria-label", `Was macht ${titel}?`);
    knopf.setAttribute("aria-expanded", "false");
    const text = document.createElement("p");
    text.className = "modul-hilfe hinweis";
    text.textContent = HILFE[modul.typ];
    // dazu: was jede Buchse erwartet (Runde 23)
    const liste = document.createElement("ul");
    liste.className = "buchsen-info";
    for (const [richtung, buchsen] of [["ein", teil.ein], ["aus", teil.aus]]) {
      for (const [name, e] of Object.entries(buchsen)) {
        const li = document.createElement("li");
        li.textContent = `${richtung === "ein" ? "→" : "←"} ${name}: ${buchsenInfo(e, name)}`;
        liste.append(li);
      }
    }
    text.append(liste);
    text.hidden = true;
    inhalt.prepend(text);
    knopf.addEventListener("click", () => {
      text.hidden = !text.hidden;
      knopf.setAttribute("aria-expanded", String(!text.hidden));
    });
    f.querySelector(".fenster-knoepfe").prepend(knopf);
  }

  // Ausschalten (Runde 22b): ⏻ in der Titelleiste. Das Modul bleibt, seine Kabel auch, nur hört man es nicht mehr
  // (main.js → kabel.js trennt die Verbindungen im Graph). Hat das Modul keine Ausgänge, gibt es nichts zu tun.
  if (beiStumm && Object.keys(teil.aus).length) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "stumm-knopf";
    knopf.textContent = "⏻";
    knopf.title = "ein- und ausschalten (die Kabel bleiben stecken)";
    knopf.setAttribute("aria-label", `${titel} ausschalten`);
    knopf.setAttribute("aria-pressed", "false");
    knopf.addEventListener("click", () => beiStumm(modul, !modul.stumm));
    f.querySelector(".fenster-knoepfe").prepend(knopf);
  }

  // Buchsen
  const buchse = (name, art, richtung) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = `buchse ${richtung} ${art}`;
    b.dataset.modul = modul.id;
    b.dataset.name = name;
    b.dataset.richtung = richtung;
    b.dataset.art = art;
    b.setAttribute("aria-label", `${titel}: ${richtung === "ein" ? "Eingang" : "Ausgang"} ${name}`);
    b.title = buchsenInfo((richtung === "ein" ? teil.ein : teil.aus)[name], name);
    const text = document.createElement("span");
    text.textContent = name;
    if (richtung === "ein") li.append(b, text);
    else li.append(text, b);
    b.addEventListener("pointerdown", (ev) => beiBuchse(ev, b));
    return li;
  };
  const [ein, aus] = f.querySelectorAll(".buchsen ul");
  for (const [name, e] of Object.entries(teil.ein)) ein.append(buchse(name, e.art, "ein"));
  for (const [name, a] of Object.entries(teil.aus)) aus.append(buchse(name, a.art, "aus"));

  // Auswahlfelder
  if (teil.wahl?.length) {
    const reihe = document.createElement("div");
    reihe.className = "steuerung";
    for (const w of teil.wahl) {
      const label = document.createElement("label");
      label.append(`${w.text} `);
      const s = document.createElement("select");
      for (const [wert, text] of w.optionen) s.append(new Option(text, wert));
      s.dataset.wahl = w.name; // damit ein Modul eine eigene Auswahl von sich aus umstellen kann (Akkorde: Vorlagen)
      s.value = modul.werte[w.name] ?? w.wert;
      const setze = () => {
        modul.werte[w.name] = s.value;
        w.setze(s.value);
      };
      s.addEventListener("change", setze);
      setze();
      label.append(s);
      reihe.append(label);
    }
    inhalt.append(reihe);
  }

  // Drehknöpfe
  if (teil.regler?.length) {
    const knoepfe = document.createElement("div");
    knoepfe.className = "knoepfe";
    for (const r of teil.regler) {
      const label = document.createElement("label");
      label.append(r.text);
      const eingabe = document.createElement("input");
      eingabe.type = "range";
      eingabe.min = r.log ? 0 : r.min;
      eingabe.max = r.log ? 1 : r.max;
      eingabe.step = r.log ? 0.001 : r.schritt ?? (r.max - r.min) / 200;
      eingabe.value = zuStellung(r, modul.werte[r.name] ?? r.wert);
      eingabe.dataset.regler = r.name; // für Makros einer Gruppe (gruppen.js)
      const anzeige = document.createElement("output");
      label.append(eingabe, anzeige);
      knoepfe.append(label);
      // jeder Knopf bekommt eine kleine Buchse oben rechts: ein Kabel daran bewegt ihn (LFO, Zufall, Hüllkurve …)
      if (modLeser && !r.keinMod) {
        const name = `⤳${r.name}`, l = modLeser();
        teil.ein[name] = { art: "ton", ziel: l.knoten };
        const b = document.createElement("button");
        b.type = "button";
        b.className = "buchse ein ton mod-buchse";
        Object.assign(b.dataset, { modul: modul.id, name, richtung: "ein", art: "ton" });
        b.setAttribute("aria-label", `${titel}: ${r.text} mit einem Kabel bewegen`);
        b.title = `${r.text}: ${buchsenInfo({ art: "ton" }, name)}`;
        b.addEventListener("pointerdown", (ev) => beiBuchse(ev, b));
        label.append(b);
        (modul.modulationen ??= []).push({ name, r, eingabe, anzeige, l, aktiv: false });
      }
      const setze = () => {
        const v = zuWert(r, Number(eingabe.value));
        modul.werte[r.name] = v;
        anzeige.textContent = zeige(r, v);
        r.setze(v);
      };
      eingabe.addEventListener("input", setze);
      setze();
      requestAnimationFrame(() => macheDrehknopf(eingabe, r.text, (t) => zeige(r, zuWert(r, t))));
    }
    inhalt.append(knoepfe);
  }

  if (teil.extra) {
    const platz = document.createElement("div");
    platz.className = "modul-extra";
    inhalt.append(platz);
    teil.extra(platz, modul);
    modul.extraEl = platz;
  }

  // Einklappen: nur Titel und Buchsen bleiben (der Platz auf der Wand wird frei, die Kabel hängen weiter).
  // Bild an/aus: den eigenen Inhalt (Oszilloskop, Spektrum, Lenia, Raster …) verstecken, damit die Wand ruhiger
  // und übersichtlicher wird. Die Module laufen weiter (Lenia rechnet weiter, sonst bliebe die Melodie stehen).
  // Beides wird mit dem Patch gespeichert (in werte, mit zwei Unterstrichen, damit es kein Regler-Name ist).
  const klapp = (an) => {
    f.classList.toggle("eingeklappt", an);
    modul.werte.__klein = an || undefined;
  };
  const bildSchalter = f.querySelector(".bild-schalter");
  const bildAus = (aus) => {
    f.classList.toggle("ohne-bild", aus);
    modul.werte.__ohneBild = aus || undefined;
  };
  if (!teil.extra) bildSchalter.disabled = true;
  f.querySelector(".einklappen").addEventListener("click", () => klapp(!f.classList.contains("eingeklappt")));
  bildSchalter.addEventListener("click", () => bildAus(!f.classList.contains("ohne-bild")));
  if (modul.werte.__klein) klapp(true);
  if (modul.werte.__ohneBild) bildAus(true);

  // nach vorn, ziehen, löschen
  f.addEventListener("pointerdown", () => (f.style.zIndex = ++oben));
  const leiste = f.querySelector(".fenster-leiste");
  let griff = null;
  leiste.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button")) return;
    const p = lokal(ev.clientX, ev.clientY);
    griff = { x: p.x - modul.x, y: p.y - modul.y };
    leiste.setPointerCapture(ev.pointerId);
    f.classList.add("zieht");
  });
  leiste.addEventListener("pointermove", (ev) => {
    if (!griff) return;
    const p = lokal(ev.clientX, ev.clientY);
    const alt = { x: modul.x, y: modul.y };
    modul.x = Math.max(0, p.x - griff.x);
    modul.y = Math.max(0, p.y - griff.y);
    f.style.left = `${modul.x}px`;
    f.style.top = `${modul.y}px`;
    beiZiehen(modul, modul.x - alt.x, modul.y - alt.y);
  });
  const los = () => {
    griff = null;
    f.classList.remove("zieht");
  };
  leiste.addEventListener("pointerup", los);
  leiste.addEventListener("pointercancel", los);
  f.querySelector(".schliessen").addEventListener("click", () => beiSchliessen(modul));

  wand.append(f);
  f.style.zIndex = ++oben;
  return f;
}
