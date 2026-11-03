// Fraktale: 2D (Mandelbrot, Julia, Burning Ship, Tricorn, Multibrot, Phoenix, Newton) und 3D (Mandelbulb,
// Mandelbox, Sierpinski, Quaternion-Julia; endlos: Menger, Apollonisch, Pseudo-Kleinian) mit Taschenlampe.
// Shader in shader.js, Kamera aus dem Zeitquader (kamera.js).
//
// Licht: Standard ist „überall hell“, damit man das Fraktal erst einmal sieht. Die Taschenlampe ist die
// Stimmung für später (dunkel, nur sichtbar, wohin man leuchtet; dazu der Klang in klang.js).
// Die Taschenlampe folgt der Maus, mit Trägheit und leichtem Zittern (wie in der Hand). Ein Klick (ohne
// zu ziehen) oder F macht sie an der Kamera fest: sie leuchtet dann geradeaus in die Bildmitte und
// wackelt mit dem Kopf mit. Noch ein Klick, und sie ist wieder in der Hand.
// Die Kamera wackelt beim Gehen (Schritte, und ein langsames Rauschen wie beim Atmen), beim Rennen
// (Umschalt) stärker. Nur die Ansicht wackelt, nicht der Weg: man läuft trotzdem geradeaus.
// Ursprünglich: Ich habe mich für „folgt der Maus, mit Trägheit und leichtem Zittern“ entschieden.
// Kamera mit den Tasten, das Licht mit der Hand: Man schaut sich um, während man geht, wie in einem Keller.
// Das Zittern ist kein Zufall pro Bild (das wäre Flackern), sondern langsames Rauschen aus Sinuswellen;
// beim Gehen wird es stärker. „An der Kamera fest“ ist die ruhige Fassung (und die fürs Handy).

import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin, speichereCanvas, zeitstempel } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { richteKlangEin } from "./klang.js";
import { endbild, sichtbaresBild, crtZuschnitt, halteSchichtAn } from "/lib/effekt-schicht.js"; // VHS, CRT und die Sammlung über dem Bild
import { farbtabelle, skalaAnker, hexZuRgb } from "/lib/farben.js";
import { ladeVerlauf } from "/lib/verlauf.js";
import { VOLLBILD, ZWEI_D, DREI_D } from "./shader.js";
import { flug, vorn } from "./kamera.js";

const bild = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const stapel = hole("stapel");
const gl = bild.getContext("webgl2", { preserveDrawingBuffer: true });

function programm(fragment) {
  const p = gl.createProgram();
  for (const [typ, quelle] of [[gl.VERTEX_SHADER, VOLLBILD], [gl.FRAGMENT_SHADER, fragment]]) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, quelle);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  const ort = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const n = gl.getActiveUniform(p, i).name;
    ort[n] = gl.getUniformLocation(p, n);
  }
  return { p, ort };
}
const zweiD = programm(ZWEI_D);
const dreiD = programm(DREI_D);
let verlauf = null;

// ---------- Zustand ----------
const ansicht2 = { mitte: [-0.6, 0], massstab: 2.6 };
// die Welten in der Reihenfolge des Shaders; gross: Maßstab um 1 (sonst eng, um 0,25); blick: wohin man
// am Anfang schaut (null: geradeaus in −z)
const WELTEN = {
  mandelbulb: { start: [0, 0, 2.6], gross: true, blick: [0, 0, 0] },
  menger: { start: [0, 0, 0.5], gross: false, blick: null },
  apollonisch: { start: [0.3, 0.1, 0.2], gross: false, blick: null },
  mandelbox: { start: [0.4, 1.2, 8], gross: true, blick: [0, 0, 0] },
  sierpinski: { start: [1.4, 1.1, 3.4], gross: true, blick: [0, 0, 0] },
  qjulia: { start: [0, 0.4, 2.8], gross: true, blick: [0, 0, 0] },
  kleinian: { start: [0.9, 0.9, 0.9], gross: true, blick: null },
};
function startKamera(welt) {
  const { start, blick } = WELTEN[welt];
  if (!blick) return { pos: [...start], gier: Math.PI, nick: 0 };
  const d = blick.map((x, k) => x - start[k]);
  return { pos: [...start], gier: Math.atan2(d[0], d[2]), nick: Math.asin(d[1] / Math.hypot(...d)) };
}
let kam = startKamera("mandelbulb");
let sicht = kam; // was die Kamera zeigt: kam plus Wackeln
let lampe = { gier: 0, nick: 0 }; // relativ zum Blick
let lampeAnKamera = false; // per Klick: fest an der Kamera, geradeaus
let maus = [0, 0]; // −1 bis 1 im Bild
let geht = 0; // wie stark man sich gerade bewegt (für das Zittern)
let rennt = 0; // dasselbe fürs Rennen (Umschalt)
let schrittPhase = 0;

const { einstellung, setze } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    skala: () => neueSkala(),
    farbe1: () => neueSkala(),
    farbe2: () => neueSkala(),
    farbe3: () => neueSkala(),
    umgedreht: () => neueSkala(),
    welt: () => {
      kam = startKamera(einstellung.welt);
    },
    art: () => {
      const a = einstellung.art;
      // Phoenix klingt nur bei wenigen c gut; das klassische (Ushiki): c = 0,5667, p = −0,5
      if (a === "phoenix") [["juliaRe", 0.5667], ["juliaIm", 0], ["phoenixP", -0.5]].forEach(([n, w]) => setze(n, w));
      if (a === "julia") [["juliaRe", -0.8], ["juliaIm", 0.156]].forEach(([n, w]) => setze(n, w));
      Object.assign(ansicht2, { mitte: [a === "mandelbrot" ? -0.6 : a === "schiff" ? -0.4 : 0, a === "schiff" ? -0.5 : 0], massstab: a === "phoenix" ? 2.2 : 2.6 });
    },
  },
});

// eine Farbskala oder eigene Farben (dunkel, Mitte, hell), wie bei den Attraktoren
function neueSkala() {
  const anker = einstellung.skala === "eigen" ? [einstellung.farbe1, einstellung.farbe2, einstellung.farbe3].map(hexZuRgb) : skalaAnker(einstellung.skala);
  verlauf = ladeVerlauf(gl, farbtabelle(einstellung.umgedreht ? [...anker].reverse() : anker), verlauf ?? undefined);
}
neueSkala();

// ---------- Abstand zur Oberfläche auf der CPU (nur für das Tempo der Kamera) ----------
// dieselben Formeln wie im Shader; nah an der Oberfläche fliegt man langsamer, sonst kommt man nie hinein
function abstand(p) {
  if (einstellung.welt === "mandelbulb") {
    let [x, y, z] = p;
    let dr = 1;
    let r = 0;
    const n = einstellung.potenz;
    for (let i = 0; i < 10; i++) {
      r = Math.hypot(x, y, z);
      if (r > 2) break;
      const th = Math.acos(Math.max(-1, Math.min(1, z / r))) * n;
      const ph = Math.atan2(y, x) * n;
      dr = r ** (n - 1) * n * dr + 1;
      const rn = r ** n;
      [x, y, z] = [rn * Math.sin(th) * Math.cos(ph) + p[0], rn * Math.sin(ph) * Math.sin(th) + p[1], rn * Math.cos(th) + p[2]];
    }
    return Math.max(0, (0.5 * Math.log(r) * r) / dr);
  }
  if (einstellung.welt === "mandelbox") {
    const sk = einstellung.boxSkala;
    let [x, y, z] = p;
    let w = 1;
    const fold = (a) => Math.max(-1, Math.min(1, a)) * 2 - a;
    for (let i = 0; i < 14; i++) {
      x = fold(x);
      y = fold(y);
      z = fold(z);
      const f = Math.min(1, Math.max(0.25 / (x * x + y * y + z * z), 0.25)) / 0.25;
      x = x * f * sk + p[0];
      y = y * f * sk + p[1];
      z = z * f * sk + p[2];
      w = w * f * Math.abs(sk) + 1;
    }
    return Math.max(0, (Math.hypot(x, y, z) - Math.abs(sk - 1)) / Math.abs(w));
  }
  if (einstellung.welt === "sierpinski") {
    let [x, y, z] = p;
    const c = Math.cos(einstellung.drehung * Math.PI / 180);
    const s = Math.sin(einstellung.drehung * Math.PI / 180);
    for (let n = 0; n < 12; n++) {
      if (x + y < 0) [x, y] = [-y, -x];
      if (x + z < 0) [x, z] = [-z, -x];
      if (y + z < 0) [z, y] = [-y, -z];
      [x, y] = [c * x + s * y, -s * x + c * y];
      [x, y, z] = [x * 2 - 1, y * 2 - 1, z * 2 - 1];
    }
    return Math.max(0, (Math.hypot(x, y, z) - 1.5) * 2 ** -12);
  }
  if (einstellung.welt === "qjulia") {
    const c = qjuliaC();
    let z = [p[0], p[1], p[2], 0];
    let dz2 = 1;
    let z2 = z[0] ** 2 + z[1] ** 2 + z[2] ** 2;
    for (let i = 0; i < 12; i++) {
      dz2 *= 4 * z2;
      z = [z[0] * z[0] - z[1] * z[1] - z[2] * z[2] - z[3] * z[3] + c[0], 2 * z[0] * z[1] + c[1], 2 * z[0] * z[2] + c[2], 2 * z[0] * z[3] + c[3]];
      z2 = z[0] ** 2 + z[1] ** 2 + z[2] ** 2 + z[3] ** 2;
      if (z2 > 16) break;
    }
    return Math.max(0, 0.25 * Math.sqrt(z2 / dz2) * Math.log(z2));
  }
  if (einstellung.welt === "kleinian") {
    const K = [0.92436, 0.90756, 0.92436];
    let q = [...p];
    let f = 1;
    for (let i = 0; i < 10; i++) {
      q = q.map((a, k) => 2 * Math.max(-K[k], Math.min(K[k], a)) - a);
      const k = Math.max(einstellung.form / (q[0] ** 2 + q[1] ** 2 + q[2] ** 2), 1);
      q = q.map((a) => a * k);
      f *= k;
    }
    const rxy = Math.hypot(q[0], q[1]);
    return Math.max(0, Math.max(rxy - 0.92784, Math.abs(rxy * q[2]) / Math.hypot(...q)) / f);
  }
  return 0.25; // in Menger und Apollonisch überall ungefähr gleich
}

// Quaternion-Julia: c wandert mit „Form“ auf einem Kreis durch den vierdimensionalen Raum
function qjuliaC() {
  const w = einstellung.qjForm * Math.PI * 2;
  return [-0.2 + 0.25 * Math.sin(w), 0.6 + 0.2 * Math.cos(w * 1.3), 0.2 + 0.2 * Math.sin(w * 0.7 + 1), 0.2 * Math.cos(w * 0.5)];
}

// ---------- Eingabe ----------
const TASTEN = { w: [1, 0, 0], arrowup: [1, 0, 0], s: [-1, 0, 0], arrowdown: [-1, 0, 0], a: [0, -1, 0], d: [0, 1, 0], e: [0, 0, 1], q: [0, 0, -1] };
const gedrueckt = new Set();
document.addEventListener("keydown", (event) => {
  if (einstellung.dimension !== "3d" || event.target.closest("input, select, textarea")) return;
  const t = event.key.toLowerCase();
  if (t === "f" && !event.repeat) return schalteLampe();
  if (t in TASTEN || t === "arrowleft" || t === "arrowright" || t === "shift") {
    event.preventDefault();
    gedrueckt.add(t);
  }
});
document.addEventListener("keyup", (event) => gedrueckt.delete(event.key.toLowerCase()));

stapel.addEventListener("pointermove", (event) => {
  const r = bild.getBoundingClientRect();
  maus = [((event.clientX - r.left) / r.width) * 2 - 1, 1 - ((event.clientY - r.top) / r.height) * 2];
});

// ziehen: in 2D verschieben, in 3D umschauen; zwei Finger: zoomen (2D) oder vor und zurück (3D)
let ziehen = null;
const finger = new Map(); // pointerId → [x, y]
let zange = null; // zwei Finger: Abstand und Mitte beim Aufsetzen

function zweiFinger() {
  const [a, b] = [...finger.values()];
  return { abstand: Math.hypot(a[0] - b[0], a[1] - b[1]), mitte: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
}

// 2D: um den Faktor f zoomen, der Punkt unter (x, y) (Bildschirm) bleibt stehen
function zoome2d(f, x, y) {
  const r = bild.getBoundingClientRect();
  const px = (x - r.left - r.width / 2) / r.height;
  const py = -(y - r.top - r.height / 2) / r.height;
  const vorher = [ansicht2.mitte[0] + px * ansicht2.massstab, ansicht2.mitte[1] + py * ansicht2.massstab];
  ansicht2.massstab *= f;
  ansicht2.mitte = [vorher[0] - px * ansicht2.massstab, vorher[1] - py * ansicht2.massstab];
}

stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture(event.pointerId);
  finger.set(event.pointerId, [event.clientX, event.clientY]);
  if (finger.size === 2) {
    zange = zweiFinger();
    ziehen = null;
    return;
  }
  ziehen = { x: event.clientX, y: event.clientY, mitte: [...ansicht2.mitte], gier: kam.gier, nick: kam.nick, weit: 0 };
});
stapel.addEventListener("pointermove", (event) => {
  if (finger.has(event.pointerId)) finger.set(event.pointerId, [event.clientX, event.clientY]);
  if (zange && finger.size === 2) {
    const jetzt = zweiFinger();
    const f = zange.abstand / Math.max(jetzt.abstand, 1);
    if (einstellung.dimension === "2d") zoome2d(f, jetzt.mitte[0], jetzt.mitte[1]);
    else fliegeVor((1 / f - 1) * 0.3);
    zange = jetzt;
    return;
  }
  if (!ziehen || !stapel.hasPointerCapture(event.pointerId)) return;
  const dx = event.clientX - ziehen.x;
  const dy = event.clientY - ziehen.y;
  ziehen.weit = Math.max(ziehen.weit, Math.hypot(dx, dy));
  if (einstellung.dimension === "2d") {
    const f = ansicht2.massstab / bild.clientHeight;
    ansicht2.mitte = [ziehen.mitte[0] - dx * f, ziehen.mitte[1] + dy * f];
  } else {
    kam.gier = ziehen.gier - dx * 0.004;
    kam.nick = Math.max(-1.5, Math.min(1.5, ziehen.nick - dy * 0.004));
  }
});
for (const ende of ["pointerup", "pointercancel"]) {
  stapel.addEventListener(ende, (event) => {
    finger.delete(event.pointerId);
    if (finger.size < 2) zange = null;
    // nur angetippt (nicht gezogen): Lampe an die Kamera bzw. wieder in die Hand
    if (ziehen && ziehen.weit < 5 && event.type === "pointerup" && einstellung.dimension === "3d") schalteLampe();
    ziehen = null;
  });
}
// Rad: in 2D zum Zeiger hin zoomen (der Punkt unter dem Zeiger bleibt, wo er ist), in 3D vor und zurück
stapel.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (einstellung.dimension === "2d") zoome2d(Math.exp(event.deltaY * 0.0015), event.clientX, event.clientY);
  else fliegeVor(-event.deltaY * 0.0008);
}, { passive: false });

// ein Stück in Blickrichtung (Rad, zwei Finger), so schnell wie die Tasten erlauben
function fliegeVor(menge) {
  const v = vorn(kam.gier, kam.nick);
  const tempo = einstellung.tempo * Math.max(0.002, Math.min(1, abstand(kam.pos) * 2));
  for (let k = 0; k < 3; k++) kam.pos[k] += v[k] * menge * tempo;
}

// am Handy: vor und zurück gedrückt halten
for (const [id, t] of [["vor", "w"], ["zurueck", "s"]]) {
  const k = hole(id);
  k.addEventListener("pointerdown", () => gedrueckt.add(t));
  for (const e of ["pointerup", "pointerleave", "pointercancel"]) k.addEventListener(e, () => gedrueckt.delete(t));
}

function schalteLampe() {
  if (einstellung.licht === "ueberall") return; // keine Lampe da
  lampeAnKamera = !lampeAnKamera;
}

// ---------- Bewegen ----------
// langsames Rauschen aus Sinuswellen mit krummen Frequenzen (wiederholt sich praktisch nie), −1 bis 1
const rauschen = (t, v) => (Math.sin(t * 1.7 + v) + 0.6 * Math.sin(t * 3.1 + 1 + v * 2) + 0.3 * Math.sin(t * 7.3 + v * 3)) / 1.9;

function bewege(dt, zeit) {
  if (gedrueckt.has("arrowleft")) kam.gier += dt * 1.2;
  if (gedrueckt.has("arrowright")) kam.gier -= dt * 1.2;
  const r = [0, 0, 0];
  for (const t of gedrueckt) TASTEN[t]?.forEach((x, k) => (r[k] += x));
  const lokal = einstellung.tempo * Math.max(0.002, Math.min(1, abstand(kam.pos) * 2)); // nah an der Wand langsamer
  const sprint = gedrueckt.has("shift");
  const tempo = (sprint ? 3 : 1) * lokal * dt;
  const v = vorn(kam.gier, kam.nick);
  const rechts = [-Math.cos(kam.gier), 0, Math.sin(kam.gier)];
  for (let k = 0; k < 3; k++) kam.pos[k] += (v[k] * r[0] + rechts[k] * r[1] + (k === 1 ? r[2] : 0)) * tempo;
  const bewegt = r[0] || r[1] || r[2] ? 1 : 0;
  geht += (bewegt - geht) * Math.min(1, dt * 3);
  rennt += ((sprint ? bewegt : 0) - rennt) * Math.min(1, dt * 3);

  // Kamera wackeln: Schritte (ein Auf und Ab pro Schritt, ein Hin und Her pro zwei) und Rauschen.
  // Rennen: schnellere Schritte, viel mehr Ausschlag
  const w = einstellung.wackeln;
  schrittPhase += dt * geht * (6 + rennt * 5);
  const schritt = geht * (1 + rennt * 2.5);
  const ruhe = 0.0015 + geht * 0.004 + rennt * 0.012; // Atmen im Stehen, mehr beim Gehen und Rennen
  sicht = {
    pos: kam.pos.map((x, k) => x + (k === 1 ? w * schritt * Math.abs(Math.sin(schrittPhase)) * 0.04 * lokal : 0)),
    gier: kam.gier + w * (schritt * 0.006 * Math.sin(schrittPhase) + ruhe * rauschen(zeit, 0)),
    nick: kam.nick + w * (schritt * 0.008 * Math.sin(schrittPhase * 2) + ruhe * rauschen(zeit * 0.9, 5)),
  };

  // Lampe: in der Hand folgt sie der Maus, mit Trägheit und eigenem Zittern; an der Kamera geradeaus
  const ziel = lampeAnKamera ? [0, 0] : [-maus[0] * 0.55, maus[1] * 0.4];
  const weich = Math.min(1, dt * (lampeAnKamera ? 8 : 4));
  lampe.gier += (ziel[0] - lampe.gier) * weich;
  lampe.nick += (ziel[1] - lampe.nick) * weich;
  const z = lampeAnKamera ? 0 : einstellung.zittern * (0.006 + geht * 0.02);
  return vorn(sicht.gier + lampe.gier + z * rauschen(zeit, 11), sicht.nick + lampe.nick + z * rauschen(zeit * 0.8, 17));
}

// wo die Lampe gerade ist und wohin sie leuchtet: etwas rechts unterhalb des Auges (in der Hand) bzw.
// knapp unter dem Auge (an der Kamera, wie eine Stirnlampe). Genau im Auge wären keine Schatten zu sehen.
function lampeImRaum() {
  const rechts = [-Math.cos(sicht.gier), 0, Math.sin(sicht.gier)];
  const s = WELTEN[einstellung.welt].gross ? 0.03 : 0.01;
  const seite = lampeAnKamera ? 0.2 : 1;
  return { ort: sicht.pos.map((x, i) => x + rechts[i] * s * seite - (i === 1 ? s * 0.6 : 0)), richtung: lampeRichtung };
}

// ---------- Zeichnen ----------
let vorher = performance.now();
let lampeRichtung = [0, 0, -1];
let rechnetGross = false; // während „Groß rechnen“ steht die Anzeige

function takt(jetzt) {
  requestAnimationFrame(takt);
  if (rechnetGross) return;
  const dt = Math.min(0.05, (jetzt - vorher) / 1000);
  vorher = jetzt;
  if (einstellung.dimension === "3d") lampeRichtung = bewege(dt, jetzt / 1000);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  zeichne(Math.round(bild.clientWidth * dpr * einstellung.aufloesung), Math.round(bild.clientHeight * dpr * einstellung.aufloesung), jetzt, false);
}

// fein: für „Groß rechnen“ genauer treffen und mehr Schritte erlauben (die Vorschau spart da)
function zeichne(b, h, jetzt, fein) {
  if (bild.width !== b || bild.height !== h) {
    bild.width = b;
    bild.height = h;
  }
  gl.viewport(0, 0, b, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, verlauf);
  if (einstellung.dimension === "2d") {
    const { p, ort } = zweiD;
    gl.useProgram(p);
    gl.uniform2f(ort.aufloesung, b, h);
    gl.uniform2f(ort.mitte, ...ansicht2.mitte);
    gl.uniform1f(ort.massstab, ansicht2.massstab);
    gl.uniform1i(ort.art, ["mandelbrot", "julia", "schiff", "tricorn", "multibrot", "phoenix", "newton"].indexOf(einstellung.art));
    gl.uniform1f(ort.hoch, einstellung.hoch);
    gl.uniform1f(ort.phoenixP, einstellung.phoenixP);
    gl.uniform1f(ort.newtonSchritt, einstellung.newtonSchritt);
    gl.uniform2f(ort.julia, einstellung.juliaRe, einstellung.juliaIm);
    gl.uniform1i(ort.schritte, einstellung.schritte);
    gl.uniform1f(ort.farbdichte, einstellung.farbdichte);
    gl.uniform1f(ort.farbversatz, (einstellung.farbversatz + jetzt * 0.00005 * einstellung.farbfluss) % 1);
    gl.uniform1i(ort.verlauf, 0);
    hole("info").textContent = `Zoom ${(2.6 / ansicht2.massstab).toExponential(1).replace(".", ",")}${ansicht2.massstab < 2e-5 ? " · hier ist float am Ende: es wird pixelig" : ""}`;
  } else {
    const k = flug(sicht, b / h);
    const { p, ort } = dreiD;
    gl.useProgram(p);
    gl.uniform2f(ort.aufloesung, b, h);
    gl.uniformMatrix4fv(ort.zurueck, false, k.zurueck);
    gl.uniform3fv(ort.auge, k.auge);
    const welt = WELTEN[einstellung.welt];
    gl.uniform1i(ort.welt, Object.keys(WELTEN).indexOf(einstellung.welt));
    gl.uniform1f(ort.boxSkala, einstellung.boxSkala);
    gl.uniform1f(ort.drehung, (einstellung.drehung * Math.PI) / 180);
    gl.uniform4f(ort.qc, ...qjuliaC());
    gl.uniform1f(ort.staub, einstellung.staub);
    gl.uniform1f(ort.pixelWinkel, 1.0 / h); // Blickwinkel 1 (Bogenmaß) auf h Pixel
    gl.uniform1f(ort.potenz, einstellung.potenz);
    gl.uniform1f(ort.form, einstellung.form);
    const l = lampeImRaum();
    gl.uniform3f(ort.lampeOrt, ...l.ort);
    gl.uniform3f(ort.lampeRichtung, ...l.richtung);
    gl.uniform1f(ort.kegel, (einstellung.kegel * Math.PI) / 180);
    gl.uniform1f(ort.lampeStaerke, einstellung.lampeStaerke * (welt.gross ? 1 : 0.15));
    gl.uniform3f(ort.lampeFarbe, ...hexZuRgb(einstellung.lampeFarbe).map((x) => x / 255));
    gl.uniform3f(ort.grundFarbe, ...hexZuRgb(einstellung.grundFarbe).map((x) => x / 255));
    gl.uniform1f(ort.umgebung, einstellung.umgebung);
    gl.uniform1f(ort.nebel, einstellung.nebel * (welt.gross ? 1 : 4));
    gl.uniform1f(ort.zeit, jetzt / 1000);
    gl.uniform1i(ort.verlauf, 0);
    gl.uniform1i(ort.lichtArt, ["lampe", "ueberall", "beides"].indexOf(einstellung.licht));
    gl.uniform1i(ort.mitSchatten, einstellung.schatten ? 1 : 0);
    // Genauigkeit an die Pixelgröße binden: doppelt so viele Pixel, halb so großer Fehler erlaubt
    gl.uniform1f(ort.genauigkeit, (fein ? 0.4 : 1) * 0.0005 * (900 / Math.max(h, 300)));
    gl.uniform1i(ort.maxSchritte, fein ? 900 : 220);
    const lampeText = einstellung.licht === "ueberall" ? "" : lampeAnKamera ? " · Lampe an der Kamera (Klick oder F: in die Hand)" : " · Lampe in der Hand (Klick oder F: an die Kamera)";
    hole("info").textContent = `Abstand zur Oberfläche ${abstand(kam.pos).toFixed(3).replace(".", ",")}${lampeText}`;
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
requestAnimationFrame(takt);

const name = () => `fraktal-${einstellung.dimension === "2d" ? einstellung.art : einstellung.welt}`;
richteExportEin({ canvas: bild, ziel: hole("exportKnoepfe"), name, anzeige: () => sichtbaresBild(), zuschnitt: crtZuschnitt });

// Groß rechnen: das Bild noch einmal in Exportgröße, mit feinerer Genauigkeit und doppelt so vielen
// Pixeln in jede Richtung (Supersampling: vier Strahlen pro Pixel, danach verkleinert = glatte Kanten).
// Danach öffnet sich das Export-Fenster wie bei „Bild speichern“: Rahmen, Format, Effekte. Solange es offen
// ist, bleibt das große Bild im Canvas stehen, und die Effekte laufen über das große Bild.
const grossFenster = erstelleExportDialog({
  zuschnitt: crtZuschnitt,
  zeichneVorschau: (einst) => {
    const fertig = verkleinert(endbild(performance.now() / 1000));
    return mitRahmen(fertig, einst);
  },
});
let grossBreite = 1920;
const klein = document.createElement("canvas");
function verkleinert(quelle) {
  // vom Supersampling auf die Exportbreite (das Verkleinern mittelt die vier Strahlen pro Pixel)
  const h = Math.round((grossBreite * quelle.height) / quelle.width);
  if (klein.width !== grossBreite || klein.height !== h) {
    klein.width = grossBreite;
    klein.height = h;
  }
  const ctx = klein.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(quelle, 0, 0, grossBreite, h);
  return klein;
}

hole("gross").addEventListener("click", async () => {
  rechnetGross = true;
  halteSchichtAn(true);
  hole("info").textContent = "Rechne groß …";
  await new Promise((r) => setTimeout(r, 30));
  try {
    grossBreite = Number(einstellung.exportBreite);
    const h = Math.round((grossBreite * bild.clientHeight) / bild.clientWidth);
    const max = gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0];
    const ss = grossBreite * 2 <= max ? 2 : 1;
    zeichne(grossBreite * ss, h * ss, performance.now(), true);
    gl.finish();
    hole("info").textContent = "";
    const einst = await grossFenster.oeffne({ art: "bild", ueberschrift: "Groß gerechnet: speichern" });
    if (einst) await speichereCanvas(mitRahmen(verkleinert(endbild(performance.now() / 1000)), einst), einst.bildTyp, `${name()}-gross-${zeitstempel()}`);
  } finally {
    rechnetGross = false;
    halteSchichtAn(false);
  }
});

// Klang: ein Drohnen-Ton aus der Höhle (klang.js), gesteuert vom Abstand zur Oberfläche und vom Gehen
const klang = richteKlangEin();
hole("klang").addEventListener("change", (e) => klang.an(e.target.checked));
setInterval(() => {
  if (einstellung.dimension === "3d") klang.stelle({ abstand: abstand(kam.pos), geht, licht: einstellung.licht });
}, 50);
