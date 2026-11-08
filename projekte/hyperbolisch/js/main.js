// Hyperbolischer Raum: die Seite. Zusammengesteckt aus
//   raum.js    Rechnen im Hyperboloid-Modell (Waben, Kamera, gehen, spiegeln)
//   shader.js  Strahlen durch die Waben schicken
// Gehen: W A S D oder Pfeiltasten, Q/E hoch und runter; Ziehen mit der Maus (oder dem Finger) schaut sich um.
// „Von selbst gehen“ läuft geradeaus und dreht sich langsam, für Videos und für das Handy.

import { VOLL, RAUM } from "./shader.js";
import { flaechen, neueKamera, schaue, gehe, richteAus, holeZurueck, mink } from "./raum.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteAudioreaktivEin } from "/lib/audioreaktiv.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
const stapel = hole("stapel");
const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
if (!gl) {
  hole("meldung").hidden = false;
  hole("meldung").textContent = "Dieser Browser kann kein WebGL2.";
  throw new Error("kein WebGL2");
}

function programm(v, f) {
  const p = gl.createProgram();
  for (const [typ, text] of [[gl.VERTEX_SHADER, v], [gl.FRAGMENT_SHADER, f]]) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, "lage");
  gl.linkProgram(p);
  const orte = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace("[0]", "");
    orte[name] = gl.getUniformLocation(p, name);
  }
  return { p, orte };
}
const raum = programm(VOLL, RAUM);
const puffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

let kamera = neueKamera();
let wabe = null; // von flaechen(): { flach, normalen, r }
let zeit = 0;
let exportLaeuft = false;

const { einstellung: e } = richteReglerEin({
  beiAenderung: () => {},
  extra: {
    wabe: () => neueWabe(),
  },
});
function neueWabe() {
  wabe = flaechen(e.wabe);
  kamera = neueKamera();
  // ein Stück aus der Mitte heraus und leicht gedreht, damit man nicht in der eigenen Kugel steht
  gehe(kamera, "rechts", wabe.flach ? 0.45 : wabe.r * 0.45, wabe.flach);
  gehe(kamera, "oben", wabe.flach ? 0.3 : wabe.r * 0.3, wabe.flach);
  schaue(kamera, 0.3, 0.1);
  richteAus(kamera, wabe.flach);
}
hole("zurMitte").addEventListener("click", () => neueWabe());

// ---------- Steuerung ----------
const gedrueckt = new Set();
addEventListener("keydown", (event) => {
  if (event.target.closest?.("input, select, textarea")) return;
  gedrueckt.add(event.key.toLowerCase());
});
addEventListener("keyup", (event) => gedrueckt.delete(event.key.toLowerCase()));
addEventListener("blur", () => gedrueckt.clear());
let ziehen = null;
stapel.addEventListener("pointerdown", (event) => {
  stapel.setPointerCapture?.(event.pointerId);
  ziehen = { x: event.clientX, y: event.clientY };
});
stapel.addEventListener("pointermove", (event) => {
  if (!ziehen) return;
  const dx = event.clientX - ziehen.x;
  const dy = event.clientY - ziehen.y;
  ziehen = { x: event.clientX, y: event.clientY };
  schaue(kamera, dx * 0.004, -dy * 0.004);
});
for (const art of ["pointerup", "pointercancel"]) stapel.addEventListener(art, () => (ziehen = null));

// ---------- Musik ----------
const musik = richteAudioreaktivEin({
  ziele: {
    tempo: "schneller gehen",
    dicke: "Balken pulsieren",
    nebel: "Nebel atmet",
    licht: "Kugeln glühen",
  },
  start: { bass: "dicke", schlag: "licht" },
  beiStart: () => {},
});

// ---------- ein Schritt ----------
function bewege(dt) {
  zeit += dt;
  const w = musik.wirkung;
  const tempo = e.tempo * (1 + 2 * (w.tempo ?? 0)) * dt;
  const taste = (a, b) => (gedrueckt.has(a) || gedrueckt.has(b) ? 1 : 0);
  const vor = taste("w", "arrowup") - taste("s", "arrowdown") + (e.vonSelbst ? 1 : 0);
  const seit = taste("d", "arrowright") - taste("a", "arrowleft");
  const hoch = taste("e", " ") - taste("q", "shift");
  // gehen, aber nicht in Wände und Balken hinein: geht ein Schritt zu nah heran, wird er zurückgenommen
  const schritt = (richtung, s) => {
    const vorher = structuredClone(kamera);
    gehe(kamera, richtung, s, wabe.flach);
    holeZurueck(kamera, wabe);
    if (abstandSzene(kamera.ort) < 0.04 * (wabe.flach ? 1 : wabe.r)) {
      kamera = vorher;
      return false;
    }
    return true;
  };
  // von selbst: steht etwas im Weg, dreht es sich weg, statt davor stehen zu bleiben
  if (vor && !schritt("vorn", vor * tempo) && e.vonSelbst) schaue(kamera, 1.5 * dt, 0.4 * dt);
  if (seit) schritt("rechts", seit * tempo);
  if (hoch) schritt("oben", hoch * tempo);
  // von selbst: langsam drehen und ein wenig auf und ab schauen (sonst läuft man ewig denselben Gang entlang)
  if (e.vonSelbst) schaue(kamera, e.drehen * dt, 0.15 * Math.sin(zeit * 0.23) * dt);
  holeZurueck(kamera, wabe);
  richteAus(kamera, wabe.flach);
}

function zeichne() {
  const w = musik.wirkung;
  const o = raum.orte;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(raum.p);
  gl.uniform4fv(o.kamera, [kamera.rechts, kamera.oben, kamera.vorn, kamera.ort].flat());
  const n = new Float32Array(48);
  wabe.normalen.forEach((v, i) => n.set(v, i * 4));
  gl.uniform4fv(o.flaeche, n);
  gl.uniform1i(o.anzahl, wabe.normalen.length);
  gl.uniform1i(o.flach, wabe.flach ? 1 : 0);
  gl.uniform1i(o.paritaet, kamera.paritaet);
  gl.uniform1f(o.seite, canvas.width / canvas.height);
  gl.uniform1f(o.blick, Math.tan((e.blickwinkel * Math.PI) / 360));
  gl.uniform1i(o.stil, { balken: 0, fenster: 1, ecken: 2, beides: 3 }[e.stil]);
  // Maße in Einheiten des Raums; flach ist die Zelle 2 breit, hyperbolisch etwa 2r: darum mit r malnehmen
  const mass = wabe.flach ? 1 : wabe.r;
  gl.uniform1f(o.dicke, e.dicke * mass * (1 + 0.6 * (w.dicke ?? 0)));
  gl.uniform1f(o.rahmen, e.rahmen * mass);
  gl.uniform1f(o.kugel, e.kugel * mass);
  gl.uniform3fv(o.farbeA, hexZuRgb(e.farbeA).map((x) => (x / 255) ** 2.2));
  gl.uniform3fv(o.farbeB, hexZuRgb(e.farbeB).map((x) => (x / 255) ** 2.2));
  gl.uniform3fv(o.nebelFarbe, hexZuRgb(e.nebelFarbe).map((x) => (x / 255) ** 2.2));
  gl.uniform1f(o.nebel, e.nebel * (1 + 0.8 * Math.sin(zeit * 2) * (w.nebel ?? 0)));
  gl.uniform1f(o.kugelLicht, e.kugelLicht * (1 + 2 * (w.licht ?? 0)));
  gl.uniform1f(o.weite, e.weite);
  gl.uniform1f(o.zeit, zeit);
  gl.uniform1i(o.lampenArt, { stirn: 0, taschenlampe: 1, aus: 2 }[e.lampenArt]);
  gl.uniform1f(o.kegel, (e.kegel * Math.PI) / 180);
  gl.uniform1f(o.lampe, e.lampe * flackern(zeit));
  gl.uniform1i(o.augen, e.augen ? 1 : 0);
  gl.uniform3fv(o.irisFarbe, hexZuRgb(e.irisFarbe).map((x) => (x / 255) ** 2.2));
  gl.uniform1f(o.lider, blinzeln(zeit));
  gl.uniform1f(o.wucher, e.wucher * mass);
  gl.uniform1f(o.wucherGroesse, e.wucherGroesse / mass);
  gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// derselbe Abstand wie im Shader (ohne Wucherungen und Kugel), für die Kamera: nicht durch Wände gehen
function abstandSzene(p) {
  const d = wabe.normalen.map((n) => (wabe.flach ? mink(p, n) - 1 : Math.asinh(mink(p, n)))).sort((a, b) => b - a);
  const mass = wabe.flach ? 1 : wabe.r;
  const dicke = e.dicke * mass;
  if (e.stil === "fenster") return Math.max(-d[0] - dicke, -d[1] - e.rahmen * mass);
  const balken = Math.hypot(d[0], d[1]) - dicke;
  const ecke = Math.hypot(d[0], d[1], d[2]) - dicke * 2.2;
  return e.stil === "balken" ? balken : e.stil === "ecken" ? ecke : Math.min(balken, ecke);
}

// Taschenlampe flackern (wie bei den Fraktalen): meist ruhig mit leichtem Schwanken, ab und zu ein Wackelkontakt.
// Alles hängt nur an der Zeit (kein Math.random), damit ein Video genau so flackert wie die Vorschau
function flackern(t) {
  if (!e.flackern) return 1;
  const ruhig = 0.93 + 0.04 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 13.1);
  // Wackelkontakt: in manchen Sekunden (je nach einer festen Zufallszahl der Sekunde) für einen Moment fast aus
  const sekunde = Math.floor(t);
  const zufall = Math.abs(Math.sin(sekunde * 91.7) * 4375.8) % 1;
  if (zufall > 0.82) {
    const teil = t - sekunde;
    if (teil > 0.3 && teil < 0.55) return Math.sin(teil * 140) > 0 ? 0.08 : 0.7;
  }
  return ruhig;
}
// Blinzeln: alle Augen zugleich, ab und zu (wieder nur von der Zeit abhängig)
function blinzeln(t) {
  const takt = 4.7;
  const phase = (t % takt) / takt;
  const welches = Math.floor(t / takt);
  if (Math.abs(Math.sin(welches * 17.3) * 9301.1) % 1 < 0.4) return 0; // nicht jedes Mal
  const zu = phase > 0.9 ? Math.sin(((phase - 0.9) / 0.1) * Math.PI) : 0;
  return zu;
}

// Bildgröße: so groß wie angezeigt, mal Auflösung (kleiner = schneller)
function groesse() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const b = Math.max(16, Math.round(stapel.clientWidth * dpr * e.aufloesung));
  const h = Math.max(16, Math.round(stapel.clientHeight * dpr * e.aufloesung));
  if (canvas.width !== b || canvas.height !== h) {
    canvas.width = b;
    canvas.height = h;
  }
}
function stelleFormat() {
  stapel.style.setProperty("--format", { quer: 16 / 9, hoch: 9 / 16, quadrat: 1 }[e.format] ?? 16 / 9);
}
document.querySelector('[data-wert="format"]').addEventListener("input", stelleFormat);

let vorher = performance.now();
function schleife(jetzt) {
  const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
  vorher = jetzt;
  if (!exportLaeuft) {
    musik.schritt(dt);
    bewege(dt);
    groesse();
    zeichne();
  }
  requestAnimationFrame(schleife);
}

// ---------- Export ----------
// Video: „von selbst gehen“ (oder stehen) Bild für Bild, in der Größe, die das Export-Fenster verlangt
const render = {
  start(n) {
    exportLaeuft = true;
    musik.exportStart(n, 30);
  },
  bild(i, dt) {
    musik.exportBild(i);
    bewege(dt);
    zeichne();
  },
  ende() {
    musik.exportEnde();
    exportLaeuft = false;
  },
  merke() {
    const k = structuredClone(kamera);
    const z = zeit;
    return () => {
      kamera = structuredClone(k);
      zeit = z;
    };
  },
  vorschau(i, n, dt) {
    for (let j = 0; j < Math.min(i, 600); j++) bewege(dt);
    zeichne();
  },
};
richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: () => `hyperbolisch-${e.wabe.replaceAll(",", "-")}`,
  anzeige: sichtbaresBild,
  endbild,
  render,
  zuschnitt: crtZuschnitt,
  ton: () => musik.tonFuerExport(),
});

stelleFormat();
neueWabe();
requestAnimationFrame(schleife);
