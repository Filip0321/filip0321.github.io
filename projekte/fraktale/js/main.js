// Fraktale: 2D (Mandelbrot, Julia, Burning Ship, Tricorn) und 3D (Mandelbulb, Menger endlos, Apollonisch
// endlos) mit Taschenlampe. Shader in shader.js, Kamera aus dem Zeitquader (kamera.js).
//
// Die Taschenlampe: Ich habe mich für „folgt der Maus, mit Trägheit und leichtem Zittern“ entschieden.
// Kamera mit den Tasten, das Licht mit der Hand: Man schaut sich um, während man geht, wie in einem Keller.
// Das Zittern ist kein Zufall pro Bild (das wäre Flackern), sondern langsames Rauschen aus Sinuswellen;
// beim Gehen wird es stärker. „An der Kamera fest“ ist die ruhige Fassung (und die fürs Handy).

import { richteReglerEin } from "/lib/regler.js";
import { richteExportEin, ladeHerunter, zeitstempel } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js"; // VHS, CRT und die Sammlung über dem Bild
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
const START = { mandelbulb: [0, 0, 2.6], menger: [0, 0, 0.5], apollonisch: [0.3, 0.1, 0.2] };
let kam = { pos: [...START.mandelbulb], gier: Math.PI, nick: 0 };
let lampe = { gier: 0, nick: 0 }; // relativ zum Blick
let maus = [0, 0]; // −1 bis 1 im Bild
let geht = 0; // wie stark man sich gerade bewegt (für das Zittern)

const { einstellung } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    skala: () => neueSkala(),
    farbe1: () => neueSkala(),
    farbe2: () => neueSkala(),
    farbe3: () => neueSkala(),
    umgedreht: () => neueSkala(),
    welt: () => (kam = { pos: [...START[einstellung.welt]], gier: Math.PI, nick: 0 }),
    art: () => Object.assign(ansicht2, { mitte: [einstellung.art === "julia" ? 0 : -0.6, 0], massstab: 2.6 }),
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
  return 0.25; // in den endlosen Welten überall ungefähr gleich
}

// ---------- Eingabe ----------
const TASTEN = { w: [1, 0, 0], arrowup: [1, 0, 0], s: [-1, 0, 0], arrowdown: [-1, 0, 0], a: [0, -1, 0], d: [0, 1, 0], e: [0, 0, 1], q: [0, 0, -1] };
const gedrueckt = new Set();
document.addEventListener("keydown", (event) => {
  if (einstellung.dimension !== "3d" || event.target.closest("input, select, textarea")) return;
  const t = event.key.toLowerCase();
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

// ziehen: in 2D verschieben, in 3D umschauen
let ziehen = null;
stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture(event.pointerId);
  ziehen = { x: event.clientX, y: event.clientY, mitte: [...ansicht2.mitte], gier: kam.gier, nick: kam.nick };
});
stapel.addEventListener("pointermove", (event) => {
  if (!ziehen || !stapel.hasPointerCapture(event.pointerId)) return;
  const dx = event.clientX - ziehen.x;
  const dy = event.clientY - ziehen.y;
  if (einstellung.dimension === "2d") {
    const f = ansicht2.massstab / bild.clientHeight;
    ansicht2.mitte = [ziehen.mitte[0] - dx * f, ziehen.mitte[1] + dy * f];
  } else {
    kam.gier = ziehen.gier - dx * 0.004;
    kam.nick = Math.max(-1.5, Math.min(1.5, ziehen.nick - dy * 0.004));
  }
});
stapel.addEventListener("pointerup", () => (ziehen = null));
// Rad: in 2D zum Zeiger hin zoomen (der Punkt unter dem Zeiger bleibt, wo er ist)
stapel.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (einstellung.dimension !== "2d") return;
  const r = bild.getBoundingClientRect();
  const px = ((event.clientX - r.left) - r.width / 2) / r.height;
  const py = -((event.clientY - r.top) - r.height / 2) / r.height;
  const vorher = [ansicht2.mitte[0] + px * ansicht2.massstab, ansicht2.mitte[1] + py * ansicht2.massstab];
  ansicht2.massstab *= Math.exp(event.deltaY * 0.0015);
  ansicht2.mitte = [vorher[0] - px * ansicht2.massstab, vorher[1] - py * ansicht2.massstab];
}, { passive: false });

// am Handy: vor und zurück gedrückt halten
for (const [id, t] of [["vor", "w"], ["zurueck", "s"]]) {
  const k = hole(id);
  k.addEventListener("pointerdown", () => gedrueckt.add(t));
  for (const e of ["pointerup", "pointerleave", "pointercancel"]) k.addEventListener(e, () => gedrueckt.delete(t));
}

// ---------- Bewegen ----------
function bewege(dt, zeit) {
  if (gedrueckt.has("arrowleft")) kam.gier += dt * 1.2;
  if (gedrueckt.has("arrowright")) kam.gier -= dt * 1.2;
  const r = [0, 0, 0];
  for (const t of gedrueckt) TASTEN[t]?.forEach((x, k) => (r[k] += x));
  const tempo = (gedrueckt.has("shift") ? 3 : 1) * einstellung.tempo * Math.max(0.002, Math.min(1, abstand(kam.pos) * 2)) * dt;
  const v = vorn(kam.gier, kam.nick);
  const rechts = [-Math.cos(kam.gier), 0, Math.sin(kam.gier)];
  for (let k = 0; k < 3; k++) kam.pos[k] += (v[k] * r[0] + rechts[k] * r[1] + (k === 1 ? r[2] : 0)) * tempo;
  geht += ((r[0] || r[1] || r[2] ? 1 : 0) - geht) * Math.min(1, dt * 3);

  // Lampe: Ziel ist die Maus (oder die Bildmitte), sie folgt mit Trägheit
  const ziel = einstellung.lampe === "maus" ? [-maus[0] * 0.55, maus[1] * 0.4] : [0, 0];
  const weich = Math.min(1, dt * 4);
  lampe.gier += (ziel[0] - lampe.gier) * weich;
  lampe.nick += (ziel[1] - lampe.nick) * weich;
  // Zittern: zwei langsame Sinus-Mischungen, beim Gehen stärker
  const z = einstellung.zittern * (0.006 + geht * 0.02);
  const zg = z * (Math.sin(zeit * 1.7) + 0.6 * Math.sin(zeit * 3.1 + 1) + 0.3 * Math.sin(zeit * 7.3));
  const zn = z * (Math.sin(zeit * 1.3 + 2) + 0.6 * Math.sin(zeit * 2.9) + 0.3 * Math.sin(zeit * 6.1 + 4));
  return vorn(kam.gier + lampe.gier + zg, kam.nick + lampe.nick + zn);
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
    gl.uniform1i(ort.art, ["mandelbrot", "julia", "schiff", "tricorn"].indexOf(einstellung.art));
    gl.uniform2f(ort.julia, einstellung.juliaRe, einstellung.juliaIm);
    gl.uniform1i(ort.schritte, einstellung.schritte);
    gl.uniform1f(ort.farbdichte, einstellung.farbdichte);
    gl.uniform1f(ort.farbversatz, (einstellung.farbversatz + jetzt * 0.00005 * einstellung.farbfluss) % 1);
    gl.uniform1i(ort.verlauf, 0);
    hole("info").textContent = `Zoom ${(2.6 / ansicht2.massstab).toExponential(1).replace(".", ",")}${ansicht2.massstab < 2e-5 ? " · hier ist float am Ende: es wird pixelig" : ""}`;
  } else {
    const k = flug(kam, b / h);
    const { p, ort } = dreiD;
    gl.useProgram(p);
    gl.uniform2f(ort.aufloesung, b, h);
    gl.uniformMatrix4fv(ort.zurueck, false, k.zurueck);
    gl.uniform3fv(ort.auge, k.auge);
    gl.uniform1i(ort.welt, ["mandelbulb", "menger", "apollonisch"].indexOf(einstellung.welt));
    gl.uniform1f(ort.potenz, einstellung.potenz);
    gl.uniform1f(ort.form, einstellung.form);
    // die Lampe in der rechten Hand: etwas rechts unterhalb des Auges
    const rechts = [-Math.cos(kam.gier), 0, Math.sin(kam.gier)];
    const s = einstellung.welt === "mandelbulb" ? 0.03 : 0.01;
    gl.uniform3f(ort.lampeOrt, ...kam.pos.map((x, i) => x + rechts[i] * s - (i === 1 ? s : 0)));
    gl.uniform3f(ort.lampeRichtung, ...lampeRichtung);
    gl.uniform1f(ort.kegel, (einstellung.kegel * Math.PI) / 180);
    gl.uniform1f(ort.lampeStaerke, einstellung.lampeStaerke * (einstellung.welt === "mandelbulb" ? 1 : 0.15));
    gl.uniform3f(ort.lampeFarbe, ...hexZuRgb(einstellung.lampeFarbe).map((x) => x / 255));
    gl.uniform3f(ort.grundFarbe, ...hexZuRgb(einstellung.grundFarbe).map((x) => x / 255));
    gl.uniform1f(ort.umgebung, einstellung.umgebung);
    gl.uniform1f(ort.nebel, einstellung.nebel * (einstellung.welt === "mandelbulb" ? 1 : 4));
    gl.uniform1f(ort.zeit, jetzt / 1000);
    gl.uniform1i(ort.verlauf, 0);
    gl.uniform1i(ort.lichtArt, ["lampe", "ueberall", "beides"].indexOf(einstellung.licht));
    gl.uniform1i(ort.mitSchatten, einstellung.schatten ? 1 : 0);
    // Genauigkeit an die Pixelgröße binden: doppelt so viele Pixel, halb so großer Fehler erlaubt
    gl.uniform1f(ort.genauigkeit, (fein ? 0.4 : 1) * 0.0005 * (900 / Math.max(h, 300)));
    gl.uniform1i(ort.maxSchritte, fein ? 900 : 220);
    hole("info").textContent = `Abstand zur Oberfläche ${abstand(kam.pos).toFixed(3).replace(".", ",")}`;
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
requestAnimationFrame(takt);

const name = () => `fraktal-${einstellung.dimension === "2d" ? einstellung.art : einstellung.welt}`;
richteExportEin({ canvas: bild, ziel: hole("exportKnoepfe"), name, anzeige: () => sichtbaresBild(), zuschnitt: crtZuschnitt });

// Groß rechnen: das Bild noch einmal in Exportgröße, mit feinerer Genauigkeit und doppelt so vielen
// Pixeln in jede Richtung (Supersampling: vier Strahlen pro Pixel, danach verkleinert = glatte Kanten).
// Die Effekte (VHS, CRT, Sammlung) laufen danach über das große Bild.
hole("gross").addEventListener("click", async () => {
  rechnetGross = true;
  hole("info").textContent = "Rechne groß …";
  await new Promise((r) => setTimeout(r, 30));
  try {
    const b = Number(einstellung.exportBreite);
    const h = Math.round((b * bild.clientHeight) / bild.clientWidth);
    const max = gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0];
    const ss = b * 2 <= max ? 2 : 1;
    zeichne(b * ss, h * ss, performance.now(), true);
    gl.finish();
    const mitEffekten = endbild(performance.now() / 1000);
    const c = document.createElement("canvas");
    c.width = b;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mitEffekten, 0, 0, b, h);
    c.toBlob((blob) => ladeHerunter(blob, `${name()}-${zeitstempel()}.png`), "image/png");
  } finally {
    rechnetGross = false;
  }
});
