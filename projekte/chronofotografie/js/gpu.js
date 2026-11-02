// Grafikkarte: der Ringpuffer aus Videobildern und das Übereinanderlegen.
// Eine Instanz pro Canvas: die kleine Vorschau hat ihre, der Export in voller Größe bekommt eine eigene.
//
// Ringpuffer: ein Textur-Array (TEXTURE_2D_ARRAY) mit "plaetze" gleich großen Ebenen. Ein neues Bild
// kommt in die nächste Ebene; ist der Puffer voll, überschreibt es das älteste. So liegen immer die
// letzten N Bilder auf der Grafikkarte, ohne dass je etwas verschoben oder neu angelegt wird.
// Die letzte Ebene ist reserviert für das aktuelle Bild (das liegt im Video immer obenauf).
//
// Hochgeladen wird ohne Umdrehen (UNPACK_FLIP_Y gilt bei 3D-Texturen nicht in jedem Browser gleich):
// Zeile 0 der Textur ist oben im Bild. Die Shader lesen darum mit (u, 1 − v).

import { MISCH_SHADER, MEDIAN_SHADER, ZEIGE_SHADER } from "./shader.js";

const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

// so viel Grafikspeicher darf der Ringpuffer nehmen (am Handy weniger)
const handy = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900;
const BUDGET = handy ? 300e6 : 1.2e9;
export const MAX_PROBEN = 31; // für den Median höchstens so viele Bilder (der Shader sortiert sie)

// wie viele Bilder dieser Größe passen? (eins davon ist das aktuelle)
export function plaetzeFuer(breite, hoehe, maxEbenen = 256) {
  return Math.max(2, Math.min(maxEbenen, Math.floor(BUDGET / (breite * hoehe * 4)), 257));
}

export function richteChronoEin(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("Dein Browser kann kein WebGL2.");
  const maxEbenen = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);

  function baueShader(typ, quelle) {
    const shader = gl.createShader(typ);
    gl.shaderSource(shader, quelle);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  function baueProgramm(fragment) {
    const programm = gl.createProgram();
    gl.attachShader(programm, baueShader(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(programm, baueShader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(programm);
    if (!gl.getProgramParameter(programm, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(programm));
    const ort = {};
    const anzahl = gl.getProgramParameter(programm, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < anzahl; i++) {
      const name = gl.getActiveUniform(programm, i).name;
      ort[name] = gl.getUniformLocation(programm, name);
    }
    return { programm, ort };
  }

  const mischen = baueProgramm(MISCH_SHADER);
  const median = baueProgramm(MEDIAN_SHADER);
  const zeigen = baueProgramm(ZEIGE_SHADER);

  function parameter(ziel, filter) {
    gl.texParameteri(ziel, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(ziel, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(ziel, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(ziel, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function stapelTextur(breite, hoehe, ebenen) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, breite, hoehe, ebenen); // Speicher einmal, fest
    parameter(gl.TEXTURE_2D_ARRAY, gl.LINEAR);
    return t;
  }

  let groesse = { breite: 0, hoehe: 0 };
  let ring = null; // Textur-Array
  let plaetze = 0; // Ebenen darin (die letzte ist das aktuelle Bild)
  let naechste = 0; // dorthin kommt das nächste Bild
  let gefuellt = 0; // so viele Bilder liegen schon drin (höchstens plaetze − 1)
  let proben = null; // Textur-Array für den Median
  let hintergrund = null; // { textur, fb }
  let hatHintergrund = false;
  const liste = gl.createTexture(); // (Ebene, Gewicht) pro Schicht
  gl.bindTexture(gl.TEXTURE_2D, liste);
  parameter(gl.TEXTURE_2D, gl.NEAREST);

  // neue Größe: alles neu anlegen. wunsch: so viele Plätze wären schön (nie mehr als Speicher und Gerät erlauben)
  function stelleGroesse(breite, hoehe, wunsch) {
    canvas.width = breite;
    canvas.height = hoehe;
    for (const t of [ring, proben, hintergrund?.textur]) if (t) gl.deleteTexture(t);
    if (hintergrund) gl.deleteFramebuffer(hintergrund.fb);
    plaetze = Math.min(wunsch + 1, plaetzeFuer(breite, hoehe, maxEbenen));
    ring = stapelTextur(breite, hoehe, plaetze);
    proben = null;
    const textur = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, breite, hoehe);
    parameter(gl.TEXTURE_2D, gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textur, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    hintergrund = { textur, fb };
    hatHintergrund = false;
    groesse = { breite, hoehe };
    leere();
    return plaetze - 1; // so viele Bilder passen in die Geschichte
  }

  function leere() {
    naechste = 0;
    gefuellt = 0;
  }

  function lade(ziel, ebene, quelle) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, ziel === "ring" ? ring : proben);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, ebene, groesse.breite, groesse.hoehe, 1, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
  }

  // ein Bild in den Ringpuffer (quelle: Canvas in genau dieser Größe)
  function lege(quelle) {
    lade("ring", naechste, quelle);
    naechste = (naechste + 1) % (plaetze - 1);
    gefuellt = Math.min(gefuellt + 1, plaetze - 1);
  }

  function setzeAktuell(quelle) {
    lade("ring", plaetze - 1, quelle);
  }

  // Median aus Bildern (Canvas, höchstens MAX_PROBEN) -> Hintergrund
  function rechneHintergrund(bilder) {
    const n = Math.min(bilder.length, MAX_PROBEN);
    if (!n) return;
    if (proben) gl.deleteTexture(proben);
    proben = stapelTextur(groesse.breite, groesse.hoehe, n);
    bilder.slice(0, n).forEach((b, i) => lade("proben", i, b));
    gl.bindFramebuffer(gl.FRAMEBUFFER, hintergrund.fb);
    gl.viewport(0, 0, groesse.breite, groesse.hoehe);
    gl.useProgram(median.programm);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, proben);
    gl.uniform1i(median.ort.proben, 0);
    gl.uniform1i(median.ort.anzahl, n % 2 ? n : n - 1 || 1); // ungerade: dann gibt es genau eine Mitte
    gl.uniform2f(median.ort.aufloesung, groesse.breite, groesse.hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(proben); // nur fürs Rechnen gebraucht
    proben = null;
    hatHintergrund = true;
  }

  // Übereinanderlegen aufs Canvas
  // e: { art, abzug, schwelle, weich, deckkraft, verblassen, fenster (so viele Bilder aus der Geschichte),
  //      mitAktuell (das aktuelle Bild obenauf) }
  const ARTEN = { aufhellen: 0, abdunkeln: 1, mittel: 2, differenz: 3, ueberdecken: 4 };
  function mische(e) {
    // Einträge vom ältesten zum neuesten: Ebene und Gewicht (Deckkraft · Verblassen^Alter)
    const anzahl = Math.min(e.fenster, gefuellt);
    const eintraege = [];
    for (let i = anzahl - 1; i >= 0; i--) {
      const ebene = (naechste - 1 - i + (plaetze - 1) * 2) % (plaetze - 1); // i = 0: das neueste
      const alter = i + (e.mitAktuell ? 1 : 0);
      eintraege.push(ebene, e.deckkraft * e.verblassen ** alter);
    }
    if (e.mitAktuell) eintraege.push(plaetze - 1, e.deckkraft);
    const daten = new Float32Array(Math.max(eintraege.length, 2));
    daten.set(eintraege);
    gl.bindTexture(gl.TEXTURE_2D, liste);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, daten.length / 2, 1, 0, gl.RG, gl.FLOAT, daten);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(mischen.programm);
    const o = mischen.ort;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring);
    gl.uniform1i(o.stapel, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, liste);
    gl.uniform1i(o.liste, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, hintergrund.textur);
    gl.uniform1i(o.hintergrund, 2);
    gl.uniform1i(o.anzahl, eintraege.length / 2);
    gl.uniform1i(o.abzug, e.abzug && hatHintergrund ? 1 : 0);
    gl.uniform1f(o.schwelle, e.schwelle);
    gl.uniform1f(o.weich, e.weich);
    gl.uniform1i(o.art, ARTEN[e.art] ?? 0);
    gl.uniform2f(o.aufloesung, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // was: "hintergrund" oder "aktuell"
  function zeige(was) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(zeigen.programm);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hintergrund.textur);
    gl.uniform1i(zeigen.ort.bild, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring);
    gl.uniform1i(zeigen.ort.stapel, 1);
    gl.uniform1i(zeigen.ort.ebene, was === "aktuell" ? plaetze - 1 : -1);
    gl.uniform2f(zeigen.ort.aufloesung, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    stelleGroesse,
    leere,
    lege,
    setzeAktuell,
    rechneHintergrund,
    mische,
    zeige,
    hatHintergrund: () => hatHintergrund,
    gefuellt: () => gefuellt,
  };
}
