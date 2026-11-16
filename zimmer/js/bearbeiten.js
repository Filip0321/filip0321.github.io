// Die Leiste zum Bearbeiten (?bearbeiten an der Adresse oder Taste B): Scan öffnen, drehen, Blickart, Startblick,
// Gegenstände setzen und benennen, Grundriss (grundriss.js), am Ende die fertige zimmer.json kopieren.

import { z, neu, art, aktiveKamera, runde, zeige, bildpunkt } from "./zustand.js";
import { ladeSplats, dreheSzene } from "./laden.js";
import { baueDinge } from "./dinge.js";
import { parallaxNull } from "./steuerung.js";
import { wendeGrundrissAn, baueRundKamera, richteGrundrissEin, setzeDraufsicht } from "./grundriss.js";
import { bodenNormale, schritteZuOben, groesseVon } from "./ausrichten.js";

const hole = (id) => document.getElementById(id);
const leiste = hole("leiste");
const blickArt = hole("leiste-art");
const liste = hole("leiste-liste");
const felder = {
  name: hole("ding-name"),
  link: hole("ding-link"),
  radius: hole("ding-radius"),
  text: hole("ding-text"),
  bogen: hole("ding-bogen"),
  nah: hole("ding-nah"),
};
const ZAHLEN = ["radius", "bogen", "nah"];
const STANDARD = { radius: 0.3, bogen: 50, nah: 3.2, text: "" };
let setztGerade = false;

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

  // Blickart: gilt sofort und kommt so in die zimmer.json
  blickArt.addEventListener("change", () => {
    z.einst.art = blickArt.value;
    parallaxNull();
    if (art() === "rundblick" && !z.einst.grundriss?.punkte?.length)
      zeige("Rundblick: ohne Grundriss steht man in der Mitte des Scans. Unter „Grundriss“ lässt sich das Zimmer einzeichnen.", 6000);
    neu();
  });

  hole("ansicht-merken").addEventListener("click", () => {
    if (art() === "rundblick") {
      const k = z.rund;
      z.einst.rundblick = { ...z.einst.rundblick, gier: runde(k.gier), nick: runde(k.nick), sichtfeld: runde(k.sichtfeld) };
      zeige("Startrichtung für den Rundblick übernommen.", 2500);
    } else {
      const k = z.kamera;
      z.einst.kamera = { ziel: k.ziel.map(runde), gier: runde(k.gier), nick: runde(k.nick), abstand: runde(k.abstand), sichtfeld: k.sichtfeld };
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

  for (const [name, feld] of Object.entries(felder)) {
    feld.addEventListener("input", () => {
      const d = z.gewaehlt;
      if (!d) return;
      const i = z.dinge.indexOf(d);
      const wert = ZAHLEN.includes(name) ? Number(feld.value) : feld.value;
      const neuerWert = { ...z.einst.dinge[i], [name]: wert };
      if (name === "text" && !wert) delete neuerWert.text; // leerer Text: kein Zeigen, gleich zum Link
      z.einst.dinge[i] = neuerWert;
      if (name === "text" && !wert) delete d.text;
      Object.assign(d, neuerWert);
      d.element.href = neuerWert.link;
      d.element.firstChild.textContent = neuerWert.name;
      zeigeListe();
      z.vorfuehrungAktualisieren?.();
      neu();
    });
  }
  hole("ding-vorfuehren").addEventListener("click", () => {
    if (!z.gewaehlt) return zeige("Erst einen Gegenstand in der Liste auswählen.", 2500);
    z.vorfuehren(z.gewaehlt);
  });

  hole("ding-setzen").addEventListener("click", (ev) => {
    setztGerade = !setztGerade;
    ev.target.classList.toggle("aktiv", setztGerade);
    z.ebene.classList.toggle("durchlaessig", setztGerade);
    zeige(setztGerade ? "Klick ins Bild: dort kommt ein neuer Gegenstand hin." : "");
  });
  hole("ding-loeschen").addEventListener("click", () => {
    if (!z.gewaehlt) return;
    z.einst.dinge.splice(z.dinge.indexOf(z.gewaehlt), 1);
    z.gewaehlt = null;
    baueDinge();
  });

  hole("json").addEventListener("click", kopiereJson);
  hole("datei").addEventListener("change", oeffneDatei);
}

function zeigeLeiste() {
  leiste.hidden = !z.bearbeiten;
  if (z.bearbeiten) blickArt.value = art();
  neu();
}

// ---------- Gegenstände ----------
function zeigeListe() {
  liste.replaceChildren(...z.dinge.map((d) => {
    const li = document.createElement("li");
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = d.name || "(ohne Namen)";
    k.classList.toggle("aktiv", d === z.gewaehlt);
    k.addEventListener("click", () => waehle(d));
    li.append(k);
    return li;
  }));
}
z.zeigeListe = zeigeListe;

function waehle(d) {
  z.gewaehlt = d;
  for (const [name, feld] of Object.entries(felder)) feld.value = d?.[name] ?? STANDARD[name] ?? "";
  zeigeListe();
  neu();
}
z.waehle = waehle;

// Klick ins Bild beim Setzen: den vordersten (genügend deckenden) Splat unter der Maus suchen
z.abfangen = (ev) => {
  if (!z.bearbeiten || !setztGerade || z.draufsicht) return false;
  const k = aktiveKamera();
  const [px, py] = bildpunkt(ev);
  const { anfang, richtung } = k.strahl(px, py, z.canvas.width, z.canvas.height);
  const { lage, farbe, anzahl } = z.szene;
  let besterT = Infinity;
  const winkel = 6 / k.fokus; // etwa 6 Pixel Spielraum
  for (let i = 0; i < anzahl; i++) {
    if (farbe[4 * i + 3] < 80) continue;
    const v = [lage[3 * i] - anfang[0], lage[3 * i + 1] - anfang[1], lage[3 * i + 2] - anfang[2]];
    const t = v[0] * richtung[0] + v[1] * richtung[1] + v[2] * richtung[2];
    if (t <= 0.05 || t >= besterT) continue;
    const quer = Math.hypot(v[0] - t * richtung[0], v[1] - t * richtung[1], v[2] - t * richtung[2]);
    if (quer < t * winkel) besterT = t;
  }
  if (!isFinite(besterT)) {
    zeige("Dort ist nichts.", 2000);
    return true;
  }
  const p = [0, 1, 2].map((i) => anfang[i] + richtung[i] * besterT);
  (z.einst.dinge ??= []).push({ name: "neu", link: "/projekte/", lage: p, radius: runde(Math.max(0.05, besterT * 0.08)) });
  baueDinge();
  waehle(z.dinge.at(-1));
  setztGerade = false;
  hole("ding-setzen").classList.remove("aktiv");
  z.ebene.classList.remove("durchlaessig");
  zeige("");
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
  if (z.einst.grundriss?.punkte?.length && !still) zeige("Achtung: der Grundriss passt nach dem Drehen nicht mehr, bitte neu zeichnen.", 5000);
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
    z.einst.splats = datei.name;
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
  const text = JSON.stringify({ ...e, dinge: (e.dinge ?? []).map(({ element, ...d }) => ({ ...d, lage: d.lage.map(runde) })) }, null, 2);
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
