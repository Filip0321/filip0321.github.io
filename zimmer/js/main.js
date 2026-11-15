// Das Zimmer: ein Gaussian-Splat-Scan, in dem Gegenstände Links sind. Zusammengesteckt aus
//   laden.js        .ply und .splat lesen, Kovarianzen rechnen, Szene drehen
//   zeichnen.js     die Splats auf der Grafikkarte
//   sortieren.js    nach Tiefe sortieren (Web Worker)
//   kamera.js       Blick, frei oder als Parallaxe
//   platzhalter.js  ein Zimmer aus Kästen, solange es keinen Scan gibt
// Was gezeigt wird, steht in zimmer.json (Datei, Drehung, Kamera, Gegenstände mit Link). Mit ?bearbeiten in der
// Adresse (oder der Taste B) kommt eine Leiste, mit der man Gegenstände setzt und die fertige zimmer.json bekommt.

import { ladeSplats, dreheSzene } from "./laden.js";
import { erstelleZeichner } from "./zeichnen.js";
import { erstelleKamera } from "./kamera.js";
import { platzhalterZimmer, PLATZHALTER } from "./platzhalter.js";

const canvas = document.getElementById("zimmer");
const ebene = document.getElementById("dinge");
const meldung = document.getElementById("meldung");
const leiste = document.getElementById("leiste");

let zeichner;
try {
  zeichner = erstelleZeichner(canvas);
} catch (fehler) {
  zeige(fehler.message);
  throw fehler;
}

let einst = null; // zimmer.json
let szene = null;
let kamera = null;
let dinge = []; // { name, link, lage, radius, element }
let hervor = null; // Gegenstand unter der Maus
const worker = new Worker(new URL("./sortieren.js", import.meta.url));
let sortiertGerade = false;
let letzteAnsicht = null;

worker.onmessage = ({ data }) => {
  zeichner.setzeReihenfolge(data.reihenfolge);
  sortiertGerade = false;
  neuZeichnen = true;
};

// ---------- Laden ----------
async function start() {
  try {
    einst = await (await fetch("zimmer.json")).json();
  } catch {
    einst = {};
  }
  if (!einst.splats) einst = { ...PLATZHALTER, ...einst, splats: null };
  zeige(einst.splats ? "lädt das Zimmer …" : "");
  const s = einst.splats ? await ladeSplats(einst.splats) : platzhalterZimmer();
  setzeSzene(s);
  if (!einst.splats) zeige("Platzhalter: ein Zimmer aus Kästen, bis es einen Scan gibt (zimmer.json → \"splats\").", 6000);
}

function setzeSzene(s) {
  szene = s;
  dreheSzene(szene, einst.drehung ?? [0, 0, 0]);
  zeichner.setzeSzene(szene);
  worker.postMessage({ lage: szene.lage });
  einst.kamera ??= rahmen(szene);
  kamera = erstelleKamera(einst.kamera);
  baueDinge();
  letzteAnsicht = null;
  neuZeichnen = true;
  if (!einst.splats) return;
  zeige("");
}

// Blick auf eine Szene ohne gespeicherte Kamera: auf die Mitte, aus einem Abstand, in dem alles zu sehen ist.
// Mitte und Größe aus den 5- und 95-%-Grenzen jeder Achse: einzelne Splats weit draußen (Floater, die das Training
// übrig lässt) würden sonst alles verschieben.
function rahmen({ lage, anzahl }) {
  const schritt = Math.max(1, Math.floor(anzahl / 20000));
  const achsen = [[], [], []];
  for (let i = 0; i < anzahl; i += schritt) for (let k = 0; k < 3; k++) achsen[k].push(lage[3 * i + k]);
  const mitte = [], groesse = [];
  for (const a of achsen) {
    a.sort((x, y) => x - y);
    const lo = a[Math.floor(a.length * 0.05)], hi = a[Math.floor(a.length * 0.95)];
    mitte.push((lo + hi) / 2);
    groesse.push(hi - lo);
  }
  return { ziel: mitte, gier: 0, nick: -0.2, abstand: Math.max(...groesse) * 1.3 || 3, sichtfeld: 60 };
}

// ---------- Gegenstände (Links) ----------
// Jeder Gegenstand ist ein unsichtbarer Kreis über dem Bild (ein echter Link: Tab, Enter und Rechtsklick gehen),
// so groß, wie seine Kugel gerade auf dem Bildschirm erscheint. Darüber leuchtet er im Bild auf.
function baueDinge() {
  ebene.replaceChildren();
  dinge = (einst.dinge ?? []).map((d) => {
    const a = document.createElement("a");
    a.className = "zimmer-ding";
    a.href = d.link;
    a.innerHTML = `<span></span>`;
    a.querySelector("span").textContent = d.name;
    const ding = { ...d, element: a };
    const an = () => {
      hervor = ding;
      neuZeichnen = true;
    };
    const aus = () => {
      if (hervor === ding) hervor = null;
      neuZeichnen = true;
    };
    a.addEventListener("pointerenter", an);
    a.addEventListener("pointerleave", aus);
    a.addEventListener("focus", an);
    a.addEventListener("blur", aus);
    // im Bearbeiten-Modus führt ein Klick nicht weg, sondern wählt den Gegenstand aus
    a.addEventListener("click", (ev) => {
      if (!bearbeiten) return;
      ev.preventDefault();
      waehle(ding);
    });
    ebene.append(a);
    return ding;
  });
  ebene.classList.toggle("immer", einst.beschriftung === "immer");
  zeigeListe?.();
}

function platziereDinge() {
  const faktor = canvas.clientWidth / canvas.width; // CSS-Pixel pro Bildpixel
  for (const d of dinge) {
    const p = kamera.aufBildschirm(d.lage, canvas.width, canvas.height);
    if (!p) {
      d.element.hidden = true;
      continue;
    }
    const r = Math.max(14, ((d.radius * kamera.fokus) / p.tiefe) * faktor);
    d.element.hidden = p.x < -r / faktor || p.x > canvas.width + r / faktor || p.y < -r / faktor || p.y > canvas.height + r / faktor;
    d.element.style.transform = `translate(${p.x * faktor - r}px, ${p.y * faktor - r}px)`;
    d.element.style.width = d.element.style.height = `${2 * r}px`;
    d.element.classList.toggle("gewaehlt", d === gewaehlt);
  }
}

// ---------- Bewegen ----------
const ziel = { gier: 0, nick: 0 }; // Parallaxe: wohin die Kamera ausweichen will (geglättet)
let ziehen = null;

canvas.addEventListener("pointermove", (ev) => {
  if (!kamera) return;
  if (art() === "parallax") {
    const r = canvas.getBoundingClientRect();
    const st = einst.parallax ?? 0.12;
    ziel.gier = -((ev.clientX - r.left) / r.width - 0.5) * 2 * st;
    ziel.nick = ((ev.clientY - r.top) / r.height - 0.5) * 2 * st * 0.6;
  }
  if (!ziehen) return;
  const dx = ev.clientX - ziehen.x, dy = ev.clientY - ziehen.y;
  ziehen.x = ev.clientX;
  ziehen.y = ev.clientY;
  if (ziehen.schieben) {
    // verschieben: entlang der Bildschirmachsen der Kamera
    const m = kamera.ansicht;
    const s = (kamera.abstand / kamera.fokus) * (canvas.width / canvas.clientWidth);
    for (let i = 0; i < 3; i++) kamera.ziel[i] += -dx * s * m[4 * i] + dy * s * m[4 * i + 1];
  } else {
    kamera.gier -= dx * 0.005;
    kamera.nick = Math.max(-1.5, Math.min(1.5, kamera.nick + dy * 0.005));
  }
  neuZeichnen = true;
});
canvas.addEventListener("pointerdown", (ev) => {
  if (!kamera) return;
  if (bearbeiten && setztGerade) return setzeDingBei(ev);
  if (art() !== "frei") return;
  canvas.setPointerCapture(ev.pointerId);
  ziehen = { x: ev.clientX, y: ev.clientY, schieben: ev.shiftKey || ev.button === 2 };
});
canvas.addEventListener("pointerup", () => (ziehen = null));
canvas.addEventListener("pointercancel", () => (ziehen = null));
canvas.addEventListener("contextmenu", (ev) => art() === "frei" && ev.preventDefault());
canvas.addEventListener("wheel", (ev) => {
  if (!kamera || art() !== "frei") return;
  ev.preventDefault();
  kamera.abstand = Math.max(0.05, kamera.abstand * Math.exp(ev.deltaY * 0.001));
  neuZeichnen = true;
}, { passive: false });

// Handy kippen: Parallaxe aus der Lage (iOS fragt beim ersten Tippen um Erlaubnis)
let neigungStart = null;
function neigung(ev) {
  if (art() !== "parallax" || ev.beta == null) return;
  neigungStart ??= { beta: ev.beta, gamma: ev.gamma };
  const st = einst.parallax ?? 0.12;
  const k = (w) => Math.max(-1, Math.min(1, w / 25)); // ±25° kippen = ganz ausweichen
  ziel.gier = -k(ev.gamma - neigungStart.gamma) * st;
  ziel.nick = k(ev.beta - neigungStart.beta) * st * 0.6;
}
window.addEventListener("deviceorientation", neigung);
window.addEventListener("pointerdown", async () => {
  if (typeof DeviceOrientationEvent?.requestPermission === "function") {
    try {
      await DeviceOrientationEvent.requestPermission();
    } catch {}
  }
}, { once: true });

const art = () => (bearbeiten ? leisteArt.value : einst?.art ?? "parallax");

// ---------- Schleife ----------
let neuZeichnen = true;
function groesse() {
  const dpr = Math.min(2, window.devicePixelRatio || 1) * (einst?.aufloesung ?? 1);
  const b = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== b || canvas.height !== h) {
    canvas.width = b;
    canvas.height = h;
    neuZeichnen = true;
  }
}
function schleife() {
  requestAnimationFrame(schleife);
  if (!kamera) return;
  groesse();
  // Parallaxe gleitet (sonst zuckt das Bild mit jeder Mausbewegung)
  const dg = ziel.gier - kamera.extraGier, dn = ziel.nick - kamera.extraNick;
  if (Math.abs(dg) + Math.abs(dn) > 1e-5) {
    kamera.extraGier += dg * 0.08;
    kamera.extraNick += dn * 0.08;
    neuZeichnen = true;
  }
  if (!neuZeichnen) return;
  neuZeichnen = false;
  kamera.rechne(canvas.width, canvas.height);
  // neu sortieren, wenn sich der Blick geändert hat und der Worker frei ist (sonst beim nächsten Bild)
  const a = kamera.ansicht;
  if (!sortiertGerade && (!letzteAnsicht || a.some((v, i) => Math.abs(v - letzteAnsicht[i]) > 1e-4))) {
    letzteAnsicht = a.slice();
    sortiertGerade = true;
    worker.postMessage({ ansicht: letzteAnsicht });
  } else if (sortiertGerade) neuZeichnen = true; // gleich noch einmal, mit der neuen Reihenfolge
  zeichner.zeichne(kamera, hexZuRgb(einst.hintergrund ?? "#111111"), hervor ? [...hervor.lage, hervor.radius] : null, einst.leuchten ?? 0.3);
  platziereDinge();
}
requestAnimationFrame(schleife);

// ---------- Bearbeiten ----------
let bearbeiten = new URLSearchParams(location.search).has("bearbeiten");
let setztGerade = false;
let gewaehlt = null;
const leisteArt = document.getElementById("leiste-art");
const liste = document.getElementById("leiste-liste");
const felder = {
  name: document.getElementById("ding-name"),
  link: document.getElementById("ding-link"),
  radius: document.getElementById("ding-radius"),
};

function zeigeLeiste() {
  leiste.hidden = !bearbeiten;
  if (bearbeiten && einst) leisteArt.value = einst.art ?? "parallax";
  neuZeichnen = true;
}
window.addEventListener("keydown", (ev) => {
  if (ev.target.closest?.("input, textarea, select")) return;
  if (ev.key === "b" || ev.key === "B") {
    bearbeiten = !bearbeiten;
    zeigeLeiste();
  }
});
leisteArt.addEventListener("change", () => {
  kamera.extraGier = kamera.extraNick = ziel.gier = ziel.nick = 0;
  neuZeichnen = true;
});

function zeigeListe() {
  if (!liste) return;
  liste.replaceChildren(...dinge.map((d) => {
    const li = document.createElement("li");
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = d.name || "(ohne Namen)";
    k.classList.toggle("aktiv", d === gewaehlt);
    k.addEventListener("click", () => waehle(d));
    li.append(k);
    return li;
  }));
}
function waehle(d) {
  gewaehlt = d;
  felder.name.value = d?.name ?? "";
  felder.link.value = d?.link ?? "";
  felder.radius.value = d?.radius ?? 0.3;
  zeigeListe();
  neuZeichnen = true;
}
for (const [name, feld] of Object.entries(felder)) {
  feld.addEventListener("input", () => {
    if (!gewaehlt) return;
    const i = dinge.indexOf(gewaehlt);
    const neu = { ...einst.dinge[i], [name]: name === "radius" ? Number(feld.value) : feld.value };
    einst.dinge[i] = neu;
    Object.assign(gewaehlt, neu);
    gewaehlt.element.href = neu.link;
    gewaehlt.element.querySelector("span").textContent = neu.name;
    zeigeListe();
    neuZeichnen = true;
  });
}

document.getElementById("ding-setzen").addEventListener("click", (ev) => {
  setztGerade = !setztGerade;
  ev.target.classList.toggle("aktiv", setztGerade);
  ebene.classList.toggle("durchlaessig", setztGerade);
  zeige(setztGerade ? "Klick ins Bild: dort kommt ein neuer Gegenstand hin." : "");
});
document.getElementById("ding-loeschen").addEventListener("click", () => {
  if (!gewaehlt) return;
  einst.dinge.splice(dinge.indexOf(gewaehlt), 1);
  gewaehlt = null;
  baueDinge();
});
document.getElementById("ansicht-merken").addEventListener("click", () => {
  einst.kamera = { ziel: kamera.ziel.map(runde), gier: runde(kamera.gier), nick: runde(kamera.nick), abstand: runde(kamera.abstand), sichtfeld: kamera.sichtfeld };
  zeige("Startansicht übernommen.", 2500);
});
document.getElementById("drehen-x").addEventListener("click", () => drehe([90, 0, 0]));
document.getElementById("drehen-y").addEventListener("click", () => drehe([0, 90, 0]));
document.getElementById("drehen-z").addEventListener("click", () => drehe([0, 0, 90]));
function drehe(w) {
  // die Szene ist schon gedreht; nur die neue Drehung anwenden und als weiteren Schritt merken (Drehungen lassen
  // sich nicht einfach Achse für Achse addieren: 90° um x, dann 90° um y ist etwas anderes als umgekehrt)
  dreheSzene(szene, w);
  const alt = einst.drehung ?? [0, 0, 0];
  einst.drehung = [...(Array.isArray(alt[0]) ? alt : [alt]), w];
  zeichner.setzeSzene(szene);
  worker.postMessage({ lage: szene.lage });
  letzteAnsicht = null;
  neuZeichnen = true;
}
document.getElementById("json").addEventListener("click", async () => {
  const text = JSON.stringify({ ...einst, dinge: einst.dinge.map(({ element, ...d }) => ({ ...d, lage: d.lage.map(runde) })) }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    zeige("zimmer.json ist in der Zwischenablage.", 3000);
  } catch {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = "zimmer.json";
    a.click();
  }
});
document.getElementById("datei").addEventListener("change", async (ev) => {
  const datei = ev.target.files[0];
  if (!datei) return;
  zeige(`lädt ${datei.name} …`);
  try {
    const s = await ladeSplats(await datei.arrayBuffer());
    if (!einst.splats) einst.dinge = []; // die Gegenstände des Platzhalters passen nicht in einen echten Scan
    einst.splats = datei.name;
    einst.drehung = [0, 0, 0];
    einst.kamera = null; // neu ausrichten (setzeSzene schaut sich die Ausdehnung an)
    setzeSzene(s);
    zeige(`${s.anzahl.toLocaleString("de")} Splats.`, 3000);
  } catch (fehler) {
    zeige(fehler.message);
  }
});

// Klick ins Bild: den vordersten (genügend deckenden) Splat unter der Maus suchen
function setzeDingBei(ev) {
  const r = canvas.getBoundingClientRect();
  const px = ((ev.clientX - r.left) / r.width) * canvas.width;
  const py = ((ev.clientY - r.top) / r.height) * canvas.height;
  const { anfang, richtung } = kamera.strahl(px, py, canvas.width, canvas.height);
  const { lage, farbe, anzahl } = szene;
  let besterT = Infinity;
  const winkel = 6 / kamera.fokus; // etwa 6 Pixel Spielraum
  for (let i = 0; i < anzahl; i++) {
    if (farbe[4 * i + 3] < 80) continue;
    const v = [lage[3 * i] - anfang[0], lage[3 * i + 1] - anfang[1], lage[3 * i + 2] - anfang[2]];
    const t = v[0] * richtung[0] + v[1] * richtung[1] + v[2] * richtung[2];
    if (t <= 0.05 || t >= besterT) continue;
    const quer = Math.hypot(v[0] - t * richtung[0], v[1] - t * richtung[1], v[2] - t * richtung[2]);
    if (quer < t * winkel) besterT = t;
  }
  if (!isFinite(besterT)) return zeige("Dort ist nichts.", 2000);
  const p = [0, 1, 2].map((k) => anfang[k] + richtung[k] * besterT);
  einst.dinge ??= [];
  einst.dinge.push({ name: "neu", link: "/projekte/", lage: p, radius: Math.max(0.05, besterT * 0.08) });
  baueDinge();
  waehle(dinge.at(-1));
  setztGerade = false;
  document.getElementById("ding-setzen").classList.remove("aktiv");
  ebene.classList.remove("durchlaessig");
  zeige("");
}

// ---------- Helfer ----------
const runde = (v) => Math.round(v * 1000) / 1000;
function hexZuRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
let uhr = 0;
function zeige(text, dauer = 0) {
  meldung.textContent = text;
  meldung.hidden = !text;
  clearTimeout(uhr);
  if (dauer) uhr = setTimeout(() => (meldung.hidden = true), dauer);
}

start().then(zeigeLeiste).catch((fehler) => zeige(fehler.message));
