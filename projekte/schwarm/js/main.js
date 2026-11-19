// Schwarm: die Seite. Theorie in schwarm.js (Boids und k-d-Baum) und klangwolke.js (Ton).
// Hier: Feld, Zeichnen, Maus (Raubvogel, Futter, Wände), Falke, Musik und Export.

import { erstelleSchwarm } from "./schwarm.js";
import { erstelleKlangwolke } from "./klangwolke.js";
import { richteReglerEin } from "/lib/regler.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";
import { skalaAnker, farbtabelle } from "/lib/farben.js";

const hole = (id) => document.getElementById(id);
const canvas = hole("feld");
const stapel = hole("stapel");
const g = canvas.getContext("2d"); // fertiges Bild inklusive Hintergrund
const spurenLeinwand = document.createElement("canvas");
const spuren = spurenLeinwand.getContext("2d"); // transparente Partikel-Ebene mit Nachleuchten
const schwarm = erstelleSchwarm();
const ton = erstelleKlangwolke();
let laeuft = true, exportLaeuft = false;
let B = 800, H = 500, dpr = 1; // Welt in CSS-Pixeln, gezeichnet mal dpr
const waende = []; // [[x1, y1, x2, y2], …]
let maus = null; // { x, y, unten }
const falke = { x: 0, y: 0, vx: 0, vy: 0 };
let farbTabelle = null;
let hintergrund = null, hintergrundURL = null, hintergrundVideoAktiv = false;
let hintergrundDeckkraft = 1, hintergrundAnpassung = "cover";
const videoHintergrund = document.createElement("video");
videoHintergrund.muted = true;
videoHintergrund.loop = true;
videoHintergrund.playsInline = true;
videoHintergrund.preload = "auto";
let videoStatusVorExport = null;

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => aktualisiereFarben(),
  extra: { anzahl: () => neu(), modell: () => neu(), farbskala: () => aktualisiereFarben(), farbInvertiert: () => aktualisiereFarben() },
});
function aktualisiereFarben() {
  const anker = skalaAnker(e.farbskala || "viridis");
  farbTabelle = farbtabelle(e.farbInvertiert ? [...anker].reverse() : anker);
}
function farbeBei(wert) {
  const i = Math.max(0, Math.min(255, Math.round(wert * 255))) * 3;
  return `rgb(${farbTabelle[i]},${farbTabelle[i + 1]},${farbTabelle[i + 2]})`;
}
function dichteJeVogel() {
  const werte = schwarm.lokaleDichte;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < schwarm.n; i++) {
    min = Math.min(min, werte[i]);
    max = Math.max(max, werte[i]);
  }
  return { werte, min, max };
}
aktualisiereFarben();

function passeAn() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const b = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  canvas.width = Math.round(b * dpr);
  canvas.height = Math.round(h * dpr);
  spurenLeinwand.width = canvas.width;
  spurenLeinwand.height = canvas.height;
  if (schwarm.n) schwarm.groesse(b, h);
  B = b;
  H = h;
  g.fillStyle = e.dunkel;
  g.fillRect(0, 0, canvas.width, canvas.height);
  spuren.clearRect(0, 0, spurenLeinwand.width, spurenLeinwand.height);
}
function neu() {
  if (e.modell === "stare") schwarm.neuPulk(e.anzahl, B, H, Math.max(e.vmin, e.vmax * 0.82));
  else schwarm.neu(e.anzahl, B, H);
  falke.x = B / 2;
  falke.y = H / 2;
}
new ResizeObserver(passeAn).observe(canvas);
passeAn();
neu();

hole("neu").addEventListener("click", neu);
hole("pause").addEventListener("click", (ev) => {
  laeuft = !laeuft;
  ev.target.textContent = laeuft ? "Pause" : "weiter";
});
hole("waendeWeg").addEventListener("click", () => (waende.length = 0));
hole("schwarzWeiss")?.addEventListener("click", () => {
  for (const [name, wert] of [["hell", "#111111"], ["dunkel", "#ffffff"], ["farbmodus", "einfarbig"]]) {
    const feld = document.querySelector(`[data-wert="${name}"]`);
    if (feld) { feld.value = wert; feld.dispatchEvent(new Event("input", { bubbles: true })); }
  }
});

// ---------- Bild-/Video-Hintergrund ----------
function hintergrundEntfernen() {
  hintergrund = null;
  hintergrundVideoAktiv = false;
  videoHintergrund.pause();
  videoHintergrund.removeAttribute("src");
  videoHintergrund.load();
  if (hintergrundURL) URL.revokeObjectURL(hintergrundURL);
  hintergrundURL = null;
  const datei = hole("hintergrundDatei");
  if (datei) datei.value = "";
  const meldung = hole("hintergrundMeldung");
  if (meldung) meldung.textContent = "Kein Hintergrund geladen.";
}
hole("hintergrundDatei")?.addEventListener("change", (ev) => {
  const datei = ev.target.files?.[0];
  if (!datei) return;
  if (hintergrundURL) URL.revokeObjectURL(hintergrundURL);
  hintergrundURL = URL.createObjectURL(datei);
  if (datei.type.startsWith("image/")) {
    videoHintergrund.pause();
    hintergrundVideoAktiv = false;
    const bild = new Image();
    bild.onload = () => { hintergrund = bild; };
    bild.onerror = () => {
      const meldung = hole("hintergrundMeldung");
      if (meldung) meldung.textContent = "Das Bild konnte nicht geladen werden.";
    };
    bild.src = hintergrundURL;
  } else if (datei.type.startsWith("video/")) {
    hintergrund = videoHintergrund;
    hintergrundVideoAktiv = true;
    videoHintergrund.src = hintergrundURL;
    videoHintergrund.load();
    videoHintergrund.play().catch(() => {
      const meldung = hole("hintergrundMeldung");
      if (meldung) meldung.textContent = "Video geladen. Zum Starten bitte einmal auf das Canvas klicken.";
    });
  } else {
    hintergrundEntfernen();
    const meldung = hole("hintergrundMeldung");
    if (meldung) meldung.textContent = "Bitte eine Bild- oder Videodatei auswählen.";
  }
  const meldung = hole("hintergrundMeldung");
  if (meldung) meldung.textContent = datei.type.startsWith("video/") ? `Video: ${datei.name}` : `Bild: ${datei.name}`;
});
hole("hintergrundEntfernen")?.addEventListener("click", hintergrundEntfernen);
hole("hintergrundDeckkraft")?.addEventListener("input", (ev) => {
  hintergrundDeckkraft = Number(ev.target.value);
  hole("hintergrundDeckkraftWert").textContent = `${Math.round(hintergrundDeckkraft * 100)} %`;
});
hole("hintergrundAnpassung")?.addEventListener("change", (ev) => { hintergrundAnpassung = ev.target.value; });

hole("feldGross")?.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === stapel) await document.exitFullscreen();
    else await stapel.requestFullscreen();
  } catch (fehler) {
    console.warn("Vollbild konnte nicht gestartet werden:", fehler);
  }
});
document.addEventListener("fullscreenchange", () => {
  const knopf = hole("feldGross");
  if (knopf) knopf.textContent = document.fullscreenElement === stapel ? "Vollbild schließen" : "Canvas vergrößern";
  requestAnimationFrame(passeAn);
});

// ---------- Maus ----------
const lage = (ev) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * B, y: ((ev.clientY - r.top) / r.height) * H };
};
let wandStart = null;
canvas.addEventListener("pointerdown", (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  const p = lage(ev);
  maus = { ...p, unten: true };
  if (e.werkzeug === "wand") wandStart = p;
  if (e.werkzeug === "radieren") radiere(p);
});
canvas.addEventListener("pointermove", (ev) => {
  const p = lage(ev);
  maus = { ...p, unten: maus?.unten ?? false };
  if (e.werkzeug === "wand" && wandStart && Math.hypot(p.x - wandStart.x, p.y - wandStart.y) > 12) {
    waende.push([wandStart.x, wandStart.y, p.x, p.y]); // gezogene Linie aus kurzen Stücken
    wandStart = p;
  }
  if (e.werkzeug === "radieren" && maus.unten) radiere(p);
});
canvas.addEventListener("pointerup", () => {
  if (maus) maus.unten = false;
  wandStart = null;
});
canvas.addEventListener("pointerleave", () => (maus = null));
function radiere(p) {
  for (let i = waende.length - 1; i >= 0; i--) {
    const [x1, y1, x2, y2] = waende[i];
    if (Math.hypot((x1 + x2) / 2 - p.x, (y1 + y2) / 2 - p.y) < 30) waende.splice(i, 1);
  }
}

// ---------- Ton ----------
hole("tonAn").addEventListener("click", async (ev) => {
  const an = ev.target.getAttribute("aria-pressed") !== "true";
  ev.target.setAttribute("aria-pressed", String(an));
  ev.target.textContent = an ? "Ton aus" : "Ton an";
  if (an) await ton.an(e);
  else ton.aus();
});

const musik = richteAudioreaktivEin({
  ziele: { zusammenhalt: "Zusammenhalt", tempo: "Tempo", schreck: "Schreck (Falke in der Mitte)" },
  start: { bass: "zusammenhalt", schlag: "schreck" },
  beiStart: () => {},
});

// ---------- Rechnen ----------
// Falke: fliegt auf den nächsten Vogel zu, etwas schneller als der Schwarm, aber träger (kleinere Kraft):
// so kann er nicht jede Wendung mitmachen, und der Schwarm reißt vor ihm auf wie bei echten Staren
function falkeSchritt(dt) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < schwarm.n; i += 4) {
    const d = (schwarm.x[i] - falke.x) ** 2 + (schwarm.y[i] - falke.y) ** 2;
    if (d < bd) [bd, best] = [d, i];
  }
  if (best < 0) return;
  const dx = schwarm.x[best] - falke.x, dy = schwarm.y[best] - falke.y, l = Math.hypot(dx, dy) || 1;
  const v = e.vmax * 1.25;
  falke.vx += ((dx / l) * v - falke.vx) * Math.min(1, dt * 1.5);
  falke.vy += ((dy / l) * v - falke.vy) * Math.min(1, dt * 1.5);
  falke.x = (falke.x + falke.vx * dt + B) % B;
  falke.y = (falke.y + falke.vy * dt + H) % H;
}

function regeln() {
  const w = musik.wirkung;
  return {
    sicht: e.sicht, abstand: e.abstand, trennung: e.trennung, ausrichtung: e.ausrichtung,
    zusammenhalt: e.zusammenhalt * (1 + 2 * (w.zusammenhalt ?? 0)),
    vmax: e.vmax * (1 + 0.6 * (w.tempo ?? 0)), vmin: e.vmin, kraft: e.kraft, blick: e.blick,
    // Im Starenmodus immer die begrenzten k nächsten Nachbarn nutzen; Radius-Suche bleibt für Boids.
    topologisch: e.modell === "stare" ? true : e.topologisch, k: e.k, torus: e.rand === "torus", zittern: e.zittern,
    modell: e.modell || "boids", wirbel: e.wirbel || 0,
  };
}
function stoerer() {
  const s = [];
  if (maus?.unten && (e.werkzeug === "jagen" || e.werkzeug === "locken")) s.push({ x: maus.x, y: maus.y, art: e.werkzeug, radius: 120, staerke: 2 });
  if (e.falke) s.push({ x: falke.x, y: falke.y, art: "jagen", radius: 90, staerke: 2 });
  const schreck = musik.wirkung.schreck ?? 0;
  if (schreck > 0.3) {
    const m = schwarm.messe();
    s.push({ x: m.mitteX * B, y: m.mitteY * H, art: "jagen", radius: 200 * schreck, staerke: 3 * schreck });
  }
  return s;
}
function schritt(dt) {
  // Bei normalem Tempo reicht ein Schritt pro Bild (auch beim 30-fps-Export).
  // Nur bei stark beschleunigter Simulation wird unterteilt. Das spart besonders bei 20.000 Vögeln viel Arbeit.
  const gesamt = dt * e.zeit;
  const teile = Math.max(1, Math.ceil(gesamt / 0.033));
  for (let k = 0; k < teile; k++) {
    if (e.falke) falkeSchritt(gesamt / teile);
    schwarm.schritt(gesamt / teile, regeln(), stoerer(), waende);
  }
}

// ---------- Zeichnen ----------
function zeichneVogelPfad(ctx, px, py, rx, ry, groesse) {
  const sx = -ry, sy = rx;
  // Kompakte Silhouette: Kopf/Schnabel nach vorn, zwei weit ausgreifende Flügel nach hinten.
  ctx.moveTo(px + rx * groesse * 1.35, py + ry * groesse * 1.35);
  ctx.lineTo(px + rx * groesse * 0.35 + sx * groesse * 0.22, py + ry * groesse * 0.35 + sy * groesse * 0.22);
  ctx.quadraticCurveTo(
    px - rx * groesse * 0.55 + sx * groesse * 1.1, py - ry * groesse * 0.55 + sy * groesse * 1.1,
    px - rx * groesse * 1.15 + sx * groesse * 0.92, py - ry * groesse * 1.15 + sy * groesse * 0.92,
  );
  ctx.quadraticCurveTo(
    px - rx * groesse * 0.52 + sx * groesse * 0.18, py - ry * groesse * 0.52 + sy * groesse * 0.18,
    px - rx * groesse * 0.18, py - ry * groesse * 0.18,
  );
  ctx.quadraticCurveTo(
    px - rx * groesse * 0.52 - sx * groesse * 0.18, py - ry * groesse * 0.52 - sy * groesse * 0.18,
    px - rx * groesse * 1.15 - sx * groesse * 0.92, py - ry * groesse * 1.15 - sy * groesse * 0.92,
  );
  ctx.quadraticCurveTo(
    px - rx * groesse * 0.55 - sx * groesse * 1.1, py - ry * groesse * 0.55 - sy * groesse * 1.1,
    px + rx * groesse * 0.35 - sx * groesse * 0.22, py + ry * groesse * 0.35 - sy * groesse * 0.22,
  );
  ctx.closePath();
}

function zeichneHintergrund() {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.fillStyle = e.dunkel;
  g.fillRect(0, 0, canvas.width, canvas.height);
  if (!hintergrund) return;
  const quelle = hintergrund;
  const sw = quelle.videoWidth || quelle.naturalWidth || quelle.width;
  const sh = quelle.videoHeight || quelle.naturalHeight || quelle.height;
  if (!sw || !sh || (quelle instanceof HTMLVideoElement && quelle.readyState < 2)) return;
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalAlpha = hintergrundDeckkraft;
  if (hintergrundAnpassung === "strecken") {
    g.drawImage(quelle, 0, 0, B, H);
  } else {
    const faktor = hintergrundAnpassung === "einpassen" ? Math.min(B / sw, H / sh) : Math.max(B / sw, H / sh);
    const dw = sw * faktor, dh = sh * faktor;
    g.drawImage(quelle, (B - dw) / 2, (H - dh) / 2, dw, dh);
  }
  g.restore();
}

function zeichne() {
  // Die Spuren liegen auf einer transparenten Ebene. Der Hintergrund (auch ein Video) wird
  // darunter jedes Bild frisch gezeichnet und kann deshalb nicht durch Spuren verblassen.
  spuren.save();
  spuren.setTransform(1, 0, 0, 1, 0, 0);
  spuren.globalCompositeOperation = "destination-out";
  spuren.globalAlpha = 1 - e.spuren;
  spuren.fillStyle = "#000";
  spuren.fillRect(0, 0, spurenLeinwand.width, spurenLeinwand.height);
  spuren.restore();
  spuren.globalCompositeOperation = "source-over";
  spuren.globalAlpha = 1;
  spuren.setTransform(dpr, 0, 0, dpr, 0, 0);
  spuren.fillStyle = spuren.strokeStyle = e.hell;
  spuren.lineWidth = Math.max(0.45, e.groesse * 0.24);
  spuren.lineCap = "round";
  spuren.lineJoin = "round";

  const s = e.groesse, n = schwarm.n, { x, y, vx, vy } = schwarm;
  let dichte = null;
  if (e.farbmodus === "dichte") dichte = dichteJeVogel();

  if (e.farbmodus && e.farbmodus !== "einfarbig") {
    for (let i = 0; i < n; i++) {
      let wert = 0;
      if (e.farbmodus === "tempo") wert = Math.min(1, Math.hypot(vx[i], vy[i]) / Math.max(1, e.vmax));
      else if (e.farbmodus === "hoehe") wert = 1 - y[i] / Math.max(1, H);
      else if (dichte) wert = dichte.max > dichte.min ? (dichte.werte[i] - dichte.min) / (dichte.max - dichte.min) : 0.5;
      spuren.fillStyle = spuren.strokeStyle = farbeBei(wert);
      const v = Math.hypot(vx[i], vy[i]) || 1, rx = vx[i] / v, ry = vy[i] / v;
      spuren.beginPath();
      if (e.form === "vogel") zeichneVogelPfad(spuren, x[i], y[i], rx, ry, s);
      else if (e.form === "dreieck") {
        spuren.moveTo(x[i] + rx * s * 1.6, y[i] + ry * s * 1.6);
        spuren.lineTo(x[i] - rx * s + ry * s * 0.6, y[i] - ry * s - rx * s * 0.6);
        spuren.lineTo(x[i] - rx * s - ry * s * 0.6, y[i] - ry * s + rx * s * 0.6);
        spuren.closePath();
      } else if (e.form === "strich") {
        spuren.moveTo(x[i] - rx * s * 1.5, y[i] - ry * s * 1.5);
        spuren.lineTo(x[i] + rx * s * 1.5, y[i] + ry * s * 1.5);
      } else spuren.rect(x[i] - s / 2, y[i] - s / 2, s, s);
      if (e.form === "strich") spuren.stroke(); else spuren.fill();
    }
  } else {
    spuren.beginPath();
    for (let i = 0; i < n; i++) {
      const v = Math.hypot(vx[i], vy[i]) || 1, rx = vx[i] / v, ry = vy[i] / v;
      if (e.form === "vogel") zeichneVogelPfad(spuren, x[i], y[i], rx, ry, s);
      else if (e.form === "dreieck") {
        spuren.moveTo(x[i] + rx * s * 1.6, y[i] + ry * s * 1.6);
        spuren.lineTo(x[i] - rx * s + ry * s * 0.6, y[i] - ry * s - rx * s * 0.6);
        spuren.lineTo(x[i] - rx * s - ry * s * 0.6, y[i] - ry * s + rx * s * 0.6);
        spuren.closePath();
      } else if (e.form === "strich") {
        spuren.moveTo(x[i] - rx * s * 1.5, y[i] - ry * s * 1.5);
        spuren.lineTo(x[i] + rx * s * 1.5, y[i] + ry * s * 1.5);
      } else spuren.rect(x[i] - s / 2, y[i] - s / 2, s, s);
    }
    if (e.form === "strich") spuren.stroke(); else spuren.fill();
  }

  // Wände und Falke werden ebenfalls auf der Partikel-Ebene gezeichnet.
  spuren.lineWidth = 2;
  spuren.beginPath();
  for (const [x1, y1, x2, y2] of waende) { spuren.moveTo(x1, y1); spuren.lineTo(x2, y2); }
  spuren.stroke();
  if (e.falke) {
    const v = Math.hypot(falke.vx, falke.vy) || 1, rx = falke.vx / v, ry = falke.vy / v, f = s * 4;
    spuren.beginPath();
    spuren.moveTo(falke.x + rx * f * 1.6, falke.y + ry * f * 1.6);
    spuren.lineTo(falke.x - rx * f + ry * f, falke.y - ry * f - rx * f);
    spuren.lineTo(falke.x - rx * f * 0.3, falke.y - ry * f * 0.3);
    spuren.lineTo(falke.x - rx * f - ry * f, falke.y - ry * f + rx * f);
    spuren.closePath(); spuren.stroke();
  }
  spuren.setTransform(1, 0, 0, 1, 0, 0);
  zeichneHintergrund();
  g.drawImage(spurenLeinwand, 0, 0);
}
let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    if (laeuft) schritt(dt);
    zeichne();
    ton.nachfuehren(schwarm, B, H, e);
    const m = schwarm.messe();
    hole("status").textContent = `${schwarm.n} Vögel · Ordnung ${m.ordnung.toFixed(2)} · Tempo ${Math.round(m.tempo)}`;
  }
  requestAnimationFrame(schleife);
}

// Ein fester Zufallsstrom sorgt dafür, dass die Simulation beim Ton-Vordurchlauf und beim Bildexport
// dieselben Bewegungen macht. Math.random wird nach jedem Durchlauf wiederhergestellt.
function nutzeExportZufall() {
  const vorher = Math.random;
  let zustand = 0x4f1bbcdc;
  Math.random = () => {
    zustand = (Math.imul(zustand, 1664525) + 1013904223) >>> 0;
    return zustand / 4294967296;
  };
  return () => { Math.random = vorher; };
}

let exportZufallZurueck = null;

async function stelleHintergrundVideoZeit(frameZeit) {
  if (!hintergrundVideoAktiv) return;
  if (videoHintergrund.readyState < 2) {
    await new Promise((fertig, fehler) => {
      const geladen = () => { videoHintergrund.removeEventListener("error", fehlgeschlagen); fertig(); };
      const fehlgeschlagen = () => { videoHintergrund.removeEventListener("loadeddata", geladen); fehler(new Error("Das Hintergrundvideo konnte nicht geladen werden.")); };
      videoHintergrund.addEventListener("loadeddata", geladen, { once: true });
      videoHintergrund.addEventListener("error", fehlgeschlagen, { once: true });
    });
  }
  if (!Number.isFinite(videoHintergrund.duration) || videoHintergrund.duration <= 0) return;
  const ziel = frameZeit % videoHintergrund.duration;
  if (Math.abs(videoHintergrund.currentTime - ziel) < 0.012) return;
  await new Promise((fertig) => {
    const aufraeumen = () => { videoHintergrund.removeEventListener("seeked", aufraeumen); fertig(); };
    videoHintergrund.addEventListener("seeked", aufraeumen, { once: true });
    videoHintergrund.currentTime = ziel;
  });
}

// Die Tonsteuerdaten werden während desselben Durchlaufs wie die Videobilder gesammelt.
// Damit muss ein großer Schwarm nicht ein zweites Mal komplett simuliert werden.
const tonZeitplan = [];


richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "schwarm",
  anzeige: sichtbaresBild,
  endbild,
  zuschnitt: crtZuschnitt,
  render: {
    start(n) {
      exportZufallZurueck?.();
      exportZufallZurueck = nutzeExportZufall();
      exportLaeuft = true;
      if (hintergrundVideoAktiv && !videoStatusVorExport) {
        videoStatusVorExport = { zeit: videoHintergrund.currentTime, spielte: !videoHintergrund.paused };
        videoHintergrund.pause();
      }
      musik.exportStart(n, 30);
      tonZeitplan.length = 0;
    },
    async bild(i, dt) {
      await stelleHintergrundVideoZeit(i / 30);
      musik.exportBild(i);
      schritt(dt);
      zeichne();
      if (ton.aktiv()) tonZeitplan.push(ton.werteFuerExport(schwarm, B, H, e));
    },
    tonInfo(musikPuffer) {
      const live = ton.aktiv() ? ton.liveTon() : null;
      if (!live) return null;
      // Bei zusätzlicher Musik mischt lib/export.js beide Quellen auf Stereo/48 kHz.
      return musikPuffer ? { kanaele: 2, rate: 48000 } : { kanaele: live.kanaele, rate: live.rate };
    },
    async tonFertig() {
      if (!tonZeitplan.length) return null;
      const puffer = await ton.rendereExport(tonZeitplan, e, 30);
      tonZeitplan.length = 0;
      return puffer;
    },
    ende() {
      musik.exportEnde();
      exportLaeuft = false;
      exportZufallZurueck?.();
      exportZufallZurueck = null;
      if (videoStatusVorExport && hintergrundVideoAktiv) {
        videoHintergrund.currentTime = videoStatusVorExport.zeit;
        if (videoStatusVorExport.spielte) videoHintergrund.play().catch(() => {});
      }
      videoStatusVorExport = null;
      tonZeitplan.length = 0;
    },
    merke() {
      const z = schwarm.sichere();
      const f = { ...falke };
      return () => { z(); Object.assign(falke, f); };
    },
  },
  ton: () => musik.tonFuerExport(),
  liveTon: () => [ton.liveTon(), musik.liveTon()],
});

requestAnimationFrame(schleife);
window.schwarm = { schwarm, einstellung: e }; // zum Ausprobieren in der Konsole


