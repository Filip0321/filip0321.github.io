// Ein Modul als Fenster an der Wand: XP-Fenster wie auf der Startseite (/css/fenster.css; „schlichte Fenster“
// gilt auch hier), mit Buchsen links (Eingänge) und rechts (Ausgänge), Drehknöpfen (/lib/knopfRegler.js),
// Auswahlfeldern und eigenem Inhalt. Ziehen an der Titelleiste verschiebt, das Kreuz löscht das Modul.
//
// Buchsen sind Quadrate (Regel 2: keine Rundungen; nur Drehknöpfe sind rund): hohl für Eingänge, gefüllt für
// Ausgänge. Takt-Buchsen (Ereignisse statt Ton) sind gestrichelt, ihre Kabel auch.

import { macheDrehknopf } from "/lib/knopfRegler.js";

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
export function baueFenster(modul, { wand, lokal, beiZiehen, beiSchliessen, beiBuchse }) {
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
  const inhalt = f.querySelector(".fenster-inhalt");

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
