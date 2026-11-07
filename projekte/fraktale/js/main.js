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
import { richteKlangEin, rendereKlang } from "./klang.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { endbild, sichtbaresBild, crtZuschnitt, halteSchichtAn } from "/lib/effekt-schicht.js"; // VHS, CRT und die Sammlung über dem Bild
import { farbtabelle, skalaAnker, hexZuRgb } from "/lib/farben.js";
import { ladeVerlauf } from "/lib/verlauf.js";
import { VOLLBILD, ZWEI_D, DREI_D, SCHAERFE } from "./shader.js";
import { flug, vorn } from "./kamera.js";
import { richteLampenEin, stelleLampeAb, lampenFuerShader, wechsleWelt } from "./lampen.js";

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
    // Listen (uniform vec3 lampenOrt[4]) heißen hier "lampenOrt[0]": unter dem Namen ohne [0] merken
    ort[n.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, n);
  }
  return { p, ort };
}
const zweiD = programm(ZWEI_D);
const dreiD = programm(DREI_D);
const schaerfe = programm(SCHAERFE);

// Schärfentiefe braucht ein Zwischenbild mit Kommazahlen (Farbe und in Alpha der Abstand). In so eine
// Textur darf man in WebGL2 nur zeichnen, wenn der Browser EXT_color_buffer_float kann (fast alle Rechner,
// viele Handys). Sonst gibt es eben keine Schärfentiefe.
const kommaZiel = gl.getExtension("EXT_color_buffer_float");
const zwischen = { textur: null, rahmen: null, b: 0, h: 0 };
function zwischenbild(b, h) {
  if (zwischen.b === b && zwischen.h === h) return zwischen;
  zwischen.textur ??= gl.createTexture();
  zwischen.rahmen ??= gl.createFramebuffer();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, zwischen.textur);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, b, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, zwischen.rahmen);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, zwischen.textur, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  Object.assign(zwischen, { b, h });
  return zwischen;
}
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
// Musik bewegt das Fraktal (/lib/audioreaktiv.js, wie bei den Attraktoren): Bass, Mitte, Höhen und Schlag
// können je ein Ziel steuern. musik.wirkung.zoom usw. (0 bis etwa 2) wird beim Zeichnen auf die eigenen
// Werte gerechnet; die Regler bleiben, wie sie sind. Beim Video kommt jedes Bild aus der Datei an seiner Zeit.
const musik = richteAudioreaktivEin({
  ziele: {
    zoom: "Zoom",
    form: "Form (Potenz, Skala, Julia …)",
    licht: "Lampe heller",
    nebel: "Nebel",
    staub: "Staub",
    wackeln: "Kamera wackelt",
    vorwaerts: "Kamera fliegt vor",
    farbe: "Farbe wandert (2D)",
  },
  start: { bass: "form", mitte: "licht", schlag: "zoom" },
  beiStart: () => {},
});
let musikFarbe = 0; // wie weit die Musik die Farben schon geschoben hat (2D)
let stand = 0; // zählt Änderungen an den Reglern (für die Fahrt: Einstellungen nur neu merken, wenn sich etwas tat)

const { einstellung, setze } = richteReglerEin({
  beiAenderung: () => stand++,
  extra: {
    skala: () => neueSkala(),
    farbe1: () => neueSkala(),
    farbe2: () => neueSkala(),
    farbe3: () => neueSkala(),
    umgedreht: () => neueSkala(),
    welt: () => {
      kam = startKamera(einstellung.welt);
      wechsleWelt(einstellung.welt);
    },
    format: () => stelleFormat(),
    art: () => {
      const a = einstellung.art;
      // Phoenix klingt nur bei wenigen c gut; das klassische (Ushiki): c = 0,5667, p = −0,5
      if (a === "phoenix") [["juliaRe", 0.5667], ["juliaIm", 0], ["phoenixP", -0.5]].forEach(([n, w]) => setze(n, w));
      if (a === "julia") [["juliaRe", -0.8], ["juliaIm", 0.156]].forEach(([n, w]) => setze(n, w));
      Object.assign(ansicht2, { mitte: [a === "mandelbrot" ? -0.6 : a === "schiff" ? -0.4 : 0, a === "schiff" ? -0.5 : 0], massstab: a === "phoenix" ? 2.2 : 2.6 });
    },
  },
});

// Format des Bildes: frei (16:9 wie bisher) oder fest, z. B. quadratisch. Das Feld bekommt das
// Seitenverhältnis als CSS-Variable; höher als 80 % des Fensters wird es nicht (9:16 am Rechner)
function stelleFormat() {
  const [x, y] = (einstellung.format ?? "16:9").split(":").map(Number);
  stapel.style.setProperty("--format", String(x / y));
}

// eine Farbskala oder eigene Farben (dunkel, Mitte, hell), wie bei den Attraktoren
function neueSkala() {
  const anker = einstellung.skala === "eigen" ? [einstellung.farbe1, einstellung.farbe2, einstellung.farbe3].map(hexZuRgb) : skalaAnker(einstellung.skala);
  verlauf = ladeVerlauf(gl, farbtabelle(einstellung.umgedreht ? [...anker].reverse() : anker), verlauf ?? undefined);
}
neueSkala();
stelleFormat();

// ---------- Abstand zur Oberfläche auf der CPU (für das Tempo der Kamera und den Boden) ----------
// dieselben Formeln wie im Shader; nah an der Oberfläche fliegt man langsamer, sonst kommt man nie hinein
// Mit Boden zählt auch der: man fliegt an ihm langsamer und kommt nicht hindurch.
function abstand(p) {
  const b = boden();
  return b ? Math.min(abstandFraktal(p), Math.max(0, p[1] - b.hoehe)) : abstandFraktal(p);
}

function abstandFraktal(p) {
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

// ---------- Boden ----------
// Nur bei Welten, die aufhören. Wo er liegt: knapp unter dem tiefsten Punkt des Fraktals. Den findet man
// mit derselben Abstandsfunktion wie die Kamera: von unten senkrecht nach oben marschieren, auf einem Gitter
// von Säulen; um die tiefste Säule herum noch einmal feiner. (Ein Strahl von unten trifft die Unterseite.)
const ENDLICH = ["mandelbulb", "mandelbox", "sierpinski", "qjulia"];
// wie groß das Fraktal etwa ist (halbe Breite). Mandelbox: für |Skala| > 1 liegt alles in einer Kugel mit
// Radius 2(|s| + 1) / (|s| − 1); nahe 1 wird die riesig, darum gedeckelt
function groesse() {
  const w = einstellung.welt;
  if (w === "mandelbox") {
    const s = Math.abs(einstellung.boxSkala);
    return s > 1.05 ? Math.min(8, (2 * (s + 1)) / (s - 1)) : 8;
  }
  return { mandelbulb: 1.25, sierpinski: 1.8, qjulia: 1.6 }[w] ?? 1;
}
let bodenMerk = { schluessel: "", wert: null };
function boden() {
  if (!einstellung.boden || einstellung.dimension !== "3d" || !ENDLICH.includes(einstellung.welt)) return null;
  // nur neu suchen, wenn sich die Form geändert hat
  const schluessel = [einstellung.welt, einstellung.potenz, einstellung.boxSkala, einstellung.drehung, einstellung.qjForm].join();
  if (bodenMerk.schluessel !== schluessel) bodenMerk = { schluessel, wert: { hoehe: sucheBoden(), groesse: groesse() } };
  // Höhe verstellbar: der Regler verschiebt den gefundenen Boden, in Größen des Fraktals (−1 bis 1)
  const { hoehe, groesse: g } = bodenMerk.wert;
  return { hoehe: hoehe + einstellung.bodenVersatz * g, groesse: g };
}
function sucheBoden() {
  const g = groesse();
  let tiefste = { y: Infinity, x: 0, z: 0 };
  const saeule = (x, z) => {
    let y = -g * 1.6;
    for (let s = 0; s < 400 && y < g * 1.6; s++) {
      const d = abstandFraktal([x, y, z]);
      if (d < g * 0.002) {
        if (y < tiefste.y) tiefste = { y, x, z };
        return;
      }
      y += Math.max(d, g * 0.002);
    }
  };
  const N = 17;
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) saeule(-g + (2 * g * i) / (N - 1), -g + (2 * g * k) / (N - 1));
  // feiner um die tiefste Säule (dort kann eine Spitze zwischen den Säulen liegen)
  const zelle = (2 * g) / (N - 1);
  const { x: mx, z: mz } = tiefste;
  for (let i = -4; i <= 4; i++) for (let k = -4; k <= 4; k++) saeule(mx + (i * zelle) / 4, mz + (k * zelle) / 4);
  return Number.isFinite(tiefste.y) ? tiefste.y - g * 0.01 : -g;
}

// Taschenlampe flackern: meist ruhig (nur ein leichtes Schwanken, wie eine schwache Batterie), ab und zu
// ein Wackelkontakt: für einen Moment springt sie zwischen fast aus und an. Kein Math.random(): alles hängt
// nur von der Zeit ab (ein Hash der Zeitfenster). So flackert eine gerenderte Fahrt genau wie beim Fliegen.
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function flacker(t) {
  const f = einstellung.flackern;
  if (!f || einstellung.licht === "ueberall") return 1;
  let w = 1 - f * 0.08 * (0.5 + 0.5 * rauschen(t * 3, 23));
  const LANG = 1.7; // Sekunden pro Fenster; in jedem kann ein Aussetzer sein
  const fenster = Math.floor(t / LANG);
  if (hash(fenster) < f * 0.45) {
    const anfang = fenster * LANG + hash(fenster + 0.5) * 1.1;
    const dauer = 0.08 + hash(fenster + 0.7) * 0.5 * f;
    if (t > anfang && t < anfang + dauer) {
      const h = hash(Math.floor(t * 24) + 0.3); // 24 Mal pro Sekunde neu: an oder fast aus
      if (h < 0.55) w *= 0.04 + h * 0.4;
    }
  }
  return w;
}

// ---------- Fokus für die Schärfentiefe ----------
// „Bildmitte“: wie ein Autofokus. Den Abstand zur Oberfläche in der Bildmitte findet man wie der Shader:
// vom Auge geradeaus marschieren (Sphere Tracing mit abstand()). Der Fokus läuft weich hinterher (wie ein
// Objektiv, das nachstellt), gerechnet mit dem Logarithmus, weil 0,1 → 0,2 genauso weit ist wie 1 → 2.
// In den endlosen Welten Menger und Apollonisch kennt JavaScript den Abstand nicht: dort nur „fest“.
let fokusJetzt = 1;
function fokusZiel() {
  if (einstellung.fokusArt === "fest" || ["menger", "apollonisch"].includes(einstellung.welt)) {
    return 10 ** (einstellung.fokusAbstand * 3.5 - 2.5) * (WELTEN[einstellung.welt].gross ? 1 : 0.25);
  }
  const v = vorn(sicht.gier, sicht.nick);
  let t = 0;
  for (let i = 0; i < 300; i++) {
    const d = abstand(sicht.pos.map((x, k) => x + v[k] * t));
    if (d < 1e-4 + t * 1e-3) break;
    t += d * 0.9;
    if (t > 60) break;
  }
  return Math.max(t, 1e-3);
}
function stelleFokus(dt) {
  const z = Math.log(fokusZiel());
  const j = Math.log(fokusJetzt);
  fokusJetzt = Math.exp(j + (z - j) * Math.min(1, dt * 5));
}

// ---------- eigene Lampen (lampen.js) ----------
// Abgestellt wird etwas vor der Kamera (dort, wohin man schaut, nicht im Auge: sonst stünde man im Licht
// und sähe keine Schatten), aber nie in einer Wand: höchstens bis kurz vor die Oberfläche.
function lampeHierAbstellen() {
  if (einstellung.dimension !== "3d") return;
  const v = vorn(sicht.gier, sicht.nick);
  const weit = Math.min(abstand(sicht.pos) * 0.8, WELTEN[einstellung.welt].gross ? 0.3 : 0.08);
  const ort = sicht.pos.map((x, k) => x + v[k] * weit);
  if (!stelleLampeAb(ort)) hole("info").textContent = "Mehr als vier eigene Lampen gehen nicht.";
}

// Quaternion-Julia: c wandert mit „Form“ auf einem Kreis durch den vierdimensionalen Raum
function qjuliaC() {
  const w = (einstellung.qjForm + 0.15 * musik.wirkung.form) * Math.PI * 2;
  return [-0.2 + 0.25 * Math.sin(w), 0.6 + 0.2 * Math.cos(w * 1.3), 0.2 + 0.2 * Math.sin(w * 0.7 + 1), 0.2 * Math.cos(w * 0.5)];
}

// ---------- Eingabe ----------
const TASTEN = { w: [1, 0, 0], arrowup: [1, 0, 0], s: [-1, 0, 0], arrowdown: [-1, 0, 0], a: [0, -1, 0], d: [0, 1, 0], e: [0, 0, 1], q: [0, 0, -1] };
const gedrueckt = new Set();
document.addEventListener("keydown", (event) => {
  const t = event.key.toLowerCase();
  // in Text- und Zahlenfeldern tippt man; auf einem Schieberegler gehören die Pfeile ihm; Häkchen und
  // Knöpfe stören nicht (sonst ginge nach einem Klick auf „Klang“ keine Taste mehr)
  const feld = event.target.closest("input, select, textarea");
  if (feld && !["checkbox", "button", "range"].includes(feld.type)) return;
  if (feld?.type === "range" && t.startsWith("arrow")) return;
  if (einstellung.dimension !== "3d") return;
  if (t === "f" && !event.repeat) return schalteLampe();
  if (t === "l" && !event.repeat) return lampeHierAbstellen();
  if (t === "r" && !event.repeat) return schalteFahrt();
  if (t in TASTEN || t === "arrowleft" || t === "arrowright" || t === "shift") {
    event.preventDefault();
    gedrueckt.add(t);
  }
});
document.addEventListener("keyup", (event) => gedrueckt.delete(event.key.toLowerCase()));

// Lampe und Blick getrennt:
//   Maus ohne Taste bewegen  → nur die Lampe        linke Taste ziehen → nur der Blick (die Lampe bleibt,
//   rechte Taste ziehen      → nur die Lampe          wohin sie relativ zum Blick zeigte)
//   am Handy: ein Finger schaut, oder mit „Finger: Lampe“ richtet er die Lampe
let fingerLampe = false;
function setzeMaus(event) {
  const r = bild.getBoundingClientRect();
  maus = [((event.clientX - r.left) / r.width) * 2 - 1, 1 - ((event.clientY - r.top) / r.height) * 2];
}
stapel.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse" && event.buttons === 0) setzeMaus(event);
});
stapel.addEventListener("contextmenu", (event) => event.preventDefault()); // rechte Taste gehört der Lampe
hole("fingerLampe").addEventListener("click", (event) => {
  fingerLampe = !fingerLampe;
  event.target.setAttribute("aria-pressed", String(fingerLampe));
  event.target.textContent = fingerLampe ? "Finger: Lampe" : "Finger: Blick";
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
  // nur die Lampe: rechte Taste, oder am Handy mit „Finger: Lampe“
  const nurLampe = event.button === 2 || (event.pointerType !== "mouse" && fingerLampe);
  ziehen = { x: event.clientX, y: event.clientY, mitte: [...ansicht2.mitte], gier: kam.gier, nick: kam.nick, weit: 0, nurLampe, taste: event.button };
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
  } else if (ziehen.nurLampe) {
    setzeMaus(event);
    lampeAnKamera = false; // wer die Lampe richtet, nimmt sie in die Hand
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
    if (ziehen && ziehen.weit < 5 && ziehen.taste === 0 && event.type === "pointerup" && einstellung.dimension === "3d") schalteLampe();
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
  if (["ueberall", "dunkel"].includes(einstellung.licht)) return; // keine Taschenlampe da
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
  // Musik: „vorwärts“ schiebt die Kamera mit dem Signal nach vorn (wie ein Herzschlag beim Fliegen)
  if (musik.wirkung.vorwaerts) for (let k = 0; k < 3; k++) kam.pos[k] += v[k] * musik.wirkung.vorwaerts * lokal * dt * 2;
  const b = boden();
  if (b) kam.pos[1] = Math.max(kam.pos[1], b.hoehe + b.groesse * 0.01); // nicht durch den Boden
  const bewegt = r[0] || r[1] || r[2] ? 1 : 0;
  geht += (bewegt - geht) * Math.min(1, dt * 3);
  rennt += ((sprint ? bewegt : 0) - rennt) * Math.min(1, dt * 3);

  // Kamera wackeln: Schritte (ein Auf und Ab pro Schritt, ein Hin und Her pro zwei) und Rauschen.
  // Rennen: schnellere Schritte, viel mehr Ausschlag
  const w = einstellung.wackeln + 3 * musik.wirkung.wackeln;
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
let lampeFest = null; // beim Abspielen einer Fahrt: { ort, richtung } aus der Aufnahme
function lampeImRaum() {
  if (lampeFest) return lampeFest;
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
  musik.schritt(dt); // Musik hören, bevor bewegt und gezeichnet wird
  musikFarbe = (musikFarbe + 0.5 * musik.wirkung.farbe * dt) % 1;
  if (einstellung.dimension === "3d") lampeRichtung = bewege(dt, jetzt / 1000);
  if (einstellung.schaerfe) stelleFokus(dt);
  if (aufnahme) merkeProbe(jetzt);
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
    gl.uniform1f(ort.massstab, ansicht2.massstab / (1 + 0.5 * musik.wirkung.zoom));
    gl.uniform1i(ort.art, ["mandelbrot", "julia", "schiff", "tricorn", "multibrot", "phoenix", "newton"].indexOf(einstellung.art));
    gl.uniform1f(ort.hoch, einstellung.hoch + 0.5 * musik.wirkung.form);
    gl.uniform1f(ort.phoenixP, einstellung.phoenixP);
    gl.uniform1f(ort.newtonSchritt, einstellung.newtonSchritt);
    gl.uniform2f(ort.julia, einstellung.juliaRe + 0.04 * musik.wirkung.form, einstellung.juliaIm);
    gl.uniform1i(ort.schritte, einstellung.schritte);
    gl.uniform1f(ort.farbdichte, einstellung.farbdichte);
    gl.uniform1f(ort.farbversatz, (einstellung.farbversatz + jetzt * 0.00005 * einstellung.farbfluss + musikFarbe) % 1);
    gl.uniform1i(ort.verlauf, 0);
    hole("info").textContent = `Zoom ${(2.6 / ansicht2.massstab).toExponential(1).replace(".", ",")}${ansicht2.massstab < 2e-5 ? " · hier ist float am Ende: es wird pixelig" : ""}`;
  } else {
    const k = flug(sicht, b / h, 1.0 / (1 + 0.5 * musik.wirkung.zoom)); // Musik zoomt: engerer Blickwinkel
    const { p, ort } = dreiD;
    gl.useProgram(p);
    gl.uniform2f(ort.aufloesung, b, h);
    gl.uniformMatrix4fv(ort.zurueck, false, k.zurueck);
    gl.uniform3fv(ort.auge, k.auge);
    const welt = WELTEN[einstellung.welt];
    gl.uniform1i(ort.welt, Object.keys(WELTEN).indexOf(einstellung.welt));
    // Musik „Form“: je Welt der Regler, der die Form bestimmt (Bass pumpt die Mandelbox …)
    const mf = musik.wirkung.form;
    gl.uniform1f(ort.boxSkala, einstellung.boxSkala + 0.4 * mf * Math.sign(einstellung.boxSkala || 1));
    gl.uniform1f(ort.drehung, ((einstellung.drehung + 8 * mf) * Math.PI) / 180);
    gl.uniform4f(ort.qc, ...qjuliaC());
    gl.uniform1f(ort.staub, einstellung.staub + 2 * musik.wirkung.staub);
    gl.uniform1f(ort.pixelWinkel, 1.0 / h); // Blickwinkel 1 (Bogenmaß) auf h Pixel
    gl.uniform1f(ort.potenz, einstellung.potenz + 2 * mf);
    gl.uniform1f(ort.form, einstellung.form + 0.08 * mf);
    const l = lampeImRaum();
    gl.uniform3f(ort.lampeOrt, ...l.ort);
    gl.uniform3f(ort.lampeRichtung, ...l.richtung);
    gl.uniform1f(ort.kegel, (einstellung.kegel * Math.PI) / 180);
    gl.uniform1f(ort.lampeStaerke, einstellung.lampeStaerke * (welt.gross ? 1 : 0.15) * flacker(jetzt / 1000) * (1 + 2 * musik.wirkung.licht));
    const bo = boden();
    gl.uniform1i(ort.mitBoden, bo ? 1 : 0);
    gl.uniform1f(ort.bodenHoehe, bo?.hoehe ?? 0);
    gl.uniform1f(ort.bodenGroesse, bo?.groesse ?? 1);
    // Schärfentiefe: erst ins Zwischenbild (mit Abstand in Alpha), danach der zweite Durchgang (unten)
    tiefenschaerfe = einstellung.schaerfe && kommaZiel ? zwischenbild(b, h) : null;
    gl.uniform1i(ort.tiefeInAlpha, tiefenschaerfe ? 1 : 0);
    if (tiefenschaerfe) gl.bindFramebuffer(gl.FRAMEBUFFER, tiefenschaerfe.rahmen);
    gl.uniform3f(ort.lampeFarbe, ...hexZuRgb(einstellung.lampeFarbe).map((x) => x / 255));
    gl.uniform3f(ort.grundFarbe, ...hexZuRgb(einstellung.grundFarbe).map((x) => x / 255));
    gl.uniform1f(ort.umgebung, einstellung.umgebung);
    gl.uniform1f(ort.nebel, (einstellung.nebel + musik.wirkung.nebel) * (welt.gross ? 1 : 4));
    gl.uniform1f(ort.zeit, jetzt / 1000);
    gl.uniform1i(ort.verlauf, 0);
    gl.uniform1i(ort.lichtArt, ["lampe", "ueberall", "beides", "dunkel"].indexOf(einstellung.licht));
    // eigene Lampen (lampen.js): je Ort, Farbe, Helligkeit, Schatten; reichen so weit wie die Welt groß ist
    const eigene = lampenFuerShader().slice(0, 4);
    const vier = (werte, je) => werte.concat(Array(4 * je).fill(0)).slice(0, 4 * je);
    gl.uniform1i(ort.lampenAnzahl, eigene.length);
    if (eigene.length) {
      gl.uniform3fv(ort.lampenOrt, vier(eigene.flatMap((l) => l.ort), 3));
      gl.uniform3fv(ort.lampenFarbe, vier(eigene.flatMap((l) => l.farbe), 3));
      gl.uniform1fv(ort.lampenStaerke, vier(eigene.map((l) => l.staerke * (1 + 2 * musik.wirkung.licht)), 1));
      gl.uniform1fv(ort.lampenSchatten, vier(eigene.map((l) => (l.schatten ? 1 : 0)), 1));
    }
    gl.uniform1f(ort.lampenMass, welt.gross ? 1 : 0.25);
    gl.uniform1i(ort.mitSchatten, einstellung.schatten ? 1 : 0);
    // Genauigkeit an die Pixelgröße binden: doppelt so viele Pixel, halb so großer Fehler erlaubt
    // Tiefe, Genauigkeit, Schrittweite („Qualität“): gelten für die Anzeige UND fürs Rendern, damit man sieht,
    // was man bekommt. fein (Video, Groß rechnen) rechnet nur noch die Oberfläche genauer nach (Normale).
    gl.uniform1f(ort.genauigkeit, einstellung.renderGenau * 0.0005 * (900 / Math.max(h, 300)));
    gl.uniform1i(ort.maxSchritte, einstellung.renderSchritte);
    gl.uniform1f(ort.schrittweite, einstellung.schrittweite);
    gl.uniform1f(ort.massstab, bo?.groesse ?? (welt.gross ? 1 : 0.25));
    gl.uniform1i(ort.bodenArt, einstellung.bodenArt === "einfarbig" ? 1 : 0);
    gl.uniform3f(ort.bodenFarbe, ...hexZuRgb(einstellung.bodenFarbe).map((x) => x / 255));
    const lampeText = ["ueberall", "dunkel"].includes(einstellung.licht) ? "" : lampeAnKamera ? " · Lampe an der Kamera (Klick oder F: in die Hand)" : " · Lampe in der Hand (Klick oder F: an die Kamera)";
    hole("info").textContent = `Abstand zur Oberfläche ${abstand(kam.pos).toFixed(3).replace(".", ",")}${lampeText}`;
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (einstellung.dimension === "3d" && tiefenschaerfe) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(schaerfe.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tiefenschaerfe.textur);
    gl.uniform1i(schaerfe.ort.bild, 1);
    gl.uniform2f(schaerfe.ort.aufloesung, b, h);
    gl.uniform1f(schaerfe.ort.fokus, fokusJetzt);
    gl.uniform1f(schaerfe.ort.blende, einstellung.unschaerfe);
    gl.uniform1f(schaerfe.ort.maxRadius, h * 0.03); // größer wird kein Scheibchen (3 % der Bildhöhe)
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
let tiefenschaerfe = null;
requestAnimationFrame(takt);

const name = () => `fraktal-${einstellung.dimension === "2d" ? einstellung.art : einstellung.welt}`;
// ---------- Fahrt aufnehmen ----------
// „Live aufnehmen“ kodiert, während man fliegt: jedes Bild, das der Kodierer nicht schafft, fehlt, darum
// ruckelt es. Besser: erst nur die Fahrt aufnehmen (wo die Kamera war, wohin sie und die Lampe schauten,
// die Regler, Abstand und Gehen für den Klang), das kostet fast nichts. „Video rendern“ spielt sie danach
// Bild für Bild nach, 30 Bilder pro Sekunde, so langsam wie nötig und so groß wie eingestellt. Zwischen
// zwei gemerkten Proben wird gemischt (linear; die Größe in 2D logarithmisch, weil Zoomen ein Faktor ist).
// Der Klang wird aus denselben Proben neu gerechnet (rendereKlang in klang.js).
let fahrt = null; // { proben, dauer } der letzten Aufnahme
let aufnahme = null; // { start, proben, e, stand } solange aufgenommen wird
const fahrtKnopf = hole("fahrt");

function merkeProbe(jetzt) {
  aufnahme.start ??= jetzt;
  if (aufnahme.stand !== stand || !aufnahme.e) {
    aufnahme.e = { ...einstellung }; // nur neu kopieren, wenn sich ein Regler bewegt hat
    aufnahme.stand = stand;
  }
  const l = lampeImRaum();
  const t = (jetzt - aufnahme.start) / 1000;
  aufnahme.proben.push({
    t,
    zeit: jetzt / 1000,
    pos: [...sicht.pos],
    gier: sicht.gier,
    nick: sicht.nick,
    ort: [...l.ort],
    richtung: [...l.richtung],
    mitte: [...ansicht2.mitte],
    massstab: ansicht2.massstab,
    abstand: einstellung.dimension === "3d" ? abstand(kam.pos) : 0.3,
    geht,
    e: aufnahme.e,
  });
  fahrtKnopf.textContent = `Stopp (${Math.floor(t)} s)`;
}

function schalteFahrt() {
  if (!aufnahme) {
    aufnahme = { start: null, proben: [], e: null, stand: -1 };
    fahrtKnopf.setAttribute("aria-pressed", "true");
    return;
  }
  const proben = aufnahme.proben;
  aufnahme = null;
  fahrtKnopf.setAttribute("aria-pressed", "false");
  fahrtKnopf.textContent = "Fahrt aufnehmen";
  if (proben.length < 2) return;
  fahrt = { proben, dauer: proben.at(-1).t };
  hole("fahrtInfo").textContent = `Fahrt: ${fahrt.dauer.toFixed(1).replace(".", ",")} s gemerkt. Jetzt „Video rendern“.`;
}
fahrtKnopf.addEventListener("click", schalteFahrt);

const mische = (a, b, f) => a + (b - a) * f;
const FARB_REGLER = ["skala", "farbe1", "farbe2", "farbe3", "umgedreht"];

// den Zustand zur Zeit t (Sekunden in der Fahrt) herstellen
function zeigeProbe(t) {
  const p = fahrt.proben;
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (p[m].t <= t) lo = m;
    else hi = m;
  }
  const a = p[lo];
  const b = p[hi];
  const f = Math.max(0, Math.min(1, (t - a.t) / Math.max(b.t - a.t, 1e-6)));
  const farbeNeu = FARB_REGLER.some((n) => einstellung[n] !== a.e[n]);
  Object.assign(einstellung, a.e);
  if (farbeNeu) neueSkala();
  sicht = { pos: a.pos.map((x, k) => mische(x, b.pos[k], f)), gier: mische(a.gier, b.gier, f), nick: mische(a.nick, b.nick, f) };
  const r = a.richtung.map((x, k) => mische(x, b.richtung[k], f));
  const lr = Math.hypot(...r);
  lampeFest = { ort: a.ort.map((x, k) => mische(x, b.ort[k], f)), richtung: r.map((x) => x / lr) };
  ansicht2.mitte = a.mitte.map((x, k) => mische(x, b.mitte[k], f));
  ansicht2.massstab = Math.exp(mische(Math.log(a.massstab), Math.log(b.massstab), f));
  return mische(a.zeit, b.zeit, f);
}

// alles merken, was das Abspielen verändert, und eine Funktion, die es zurückstellt
function schnappe() {
  const alt = { kam: structuredClone(kam), sicht, mitte: [...ansicht2.mitte], massstab: ansicht2.massstab, e: { ...einstellung } };
  return () => {
    kam = alt.kam;
    sicht = alt.sicht;
    ansicht2.mitte = alt.mitte;
    ansicht2.massstab = alt.massstab;
    const farbeNeu = FARB_REGLER.some((n) => einstellung[n] !== alt.e[n]);
    Object.assign(einstellung, alt.e);
    if (farbeNeu) neueSkala();
    lampeFest = null;
  };
}

let vorDemRendern = null;
let startZeit = 0;
// Wie groß gerechnet wird. Vorher: immer 1920 breit, und das Export-Fenster zog es dann auf seine „Größe“
// hoch (Standard 4K): doppelt so groß aufgeblasen, darum war das Video unscharf. Jetzt: genau die Breite, die
// das Video bekommt (so rechnet export-dialog.js sie aus: mitRahmen), mal Supersampling. Danach verkleinert
// (mehrere Strahlen pro Pixel gemittelt = glatte Kanten, kein Flimmern). Vorschau im Fenster: kleiner.
let renderZiel = null; // { breite, ss } während des Renderns, sonst null
function zeigeVideoBild(t, vorschau = false) {
  const zeit = fahrt ? zeigeProbe(Math.min(t, fahrt.dauer)) : startZeit + t; // ohne Fahrt: stehen, die Zeit läuft
  const b = renderZiel && !vorschau ? renderZiel.breite * renderZiel.ss : Math.min(1280, bild.width * 2);
  const h = Math.round((b * bild.clientHeight) / bild.clientWidth / 2) * 2;
  if (einstellung.schaerfe) stelleFokus(1 / 30); // der Fokus zieht Bild für Bild nach, wie beim Fliegen
  zeichne(b, h, zeit * 1000, true);
}
// das gerechnete (große) Bild auf die Breite des Videos verkleinern
const videoKlein = document.createElement("canvas");
function aufVideobreite(quelle) {
  if (!renderZiel || renderZiel.ss === 1) return quelle;
  const b = renderZiel.breite;
  const h = Math.round((b * quelle.height) / quelle.width);
  if (videoKlein.width !== b || videoKlein.height !== h) {
    videoKlein.width = b;
    videoKlein.height = h;
  }
  const c = videoKlein.getContext("2d");
  c.imageSmoothingQuality = "high";
  c.drawImage(quelle, 0, 0, b, h);
  return videoKlein;
}

richteExportEin({
  canvas: bild,
  ziel: hole("exportKnoepfe"),
  name,
  anzeige: () => sichtbaresBild(),
  zuschnitt: crtZuschnitt,
  endbild: (t) => aufVideobreite(endbild(t)),
  liveTon: () => (hole("klang").checked ? klang.liveTon() : null),
  // Ton im Video: die Musik, wenn eine Datei geladen ist; sonst der Klang der Höhle (mit Fahrt)
  ton: () => musik.tonFuerExport() ?? (fahrt && hole("klang").checked ? rendereKlang(fahrt.proben, fahrt.dauer) : null),
  dauer: () => fahrt?.dauer ?? null,
  render: {
    merke: () => schnappe(),
    start(n, einst) {
      musik.exportStart(n, 30); // die Musik einmal für alle Bilder vorausrechnen (30 Bilder pro Sekunde)
      // mit einst: das Rendern beginnt gleich (sonst nur die Vorschau im Fenster)
      if (einst) renderZiel = { breite: mitRahmen(sichtbaresBild(), einst).width, ss: Number(einstellung.renderSS) };
      vorDemRendern ??= schnappe();
      startZeit = performance.now() / 1000;
      rechnetGross = true; // die Anzeige steht, solange gerendert wird
      halteSchichtAn(true);
    },
    bild: (i, dt) => {
      musik.exportBild(i); // was die Musik bei diesem Bild macht
      musikFarbe = (musikFarbe + 0.5 * musik.wirkung.farbe * dt) % 1;
      zeigeVideoBild(i * dt);
    },
    vorschau: (i, n, dt) => {
      musik.exportBild(i);
      zeigeVideoBild(i * dt, true);
    },
    ende() {
      musik.exportEnde();
      renderZiel = null;
      vorDemRendern?.();
      vorDemRendern = null;
      rechnetGross = false;
      halteSchichtAn(false);
    },
  },
});

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

// eigene Lampen: Bedienung (lampen.js), Knopf zum Abstellen
richteLampenEin(hole("lampenListe"), () => {});
wechsleWelt(einstellung.welt);
hole("lampeAbstellen").addEventListener("click", lampeHierAbstellen);
