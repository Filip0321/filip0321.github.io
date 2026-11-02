// Grafikkarte: Ringpuffer, Grundbild, Median, Mischen. Eine Instanz pro Canvas: die kleine Vorschau
// hat ihre, der Export in voller Größe bekommt eine eigene.
//
// Der Ringpuffer (/lib/ringpuffer.js) hat "plaetze" Ebenen; die letzte ist für das aktuelle Bild
// reserviert (im Video liegt es obenauf), die anderen sind die Geschichte.
// Beim Einlegen rechnet der Einlege-Shader gleich mit, wie sehr sich jedes Pixel vom Median
// unterscheidet, und schreibt das in den Alphakanal. Beim Mischen muss dann nur noch die Schwelle
// angewendet werden (eine Textur-Abfrage pro Schicht statt 18): darum wirken Schwelle und Weich sofort.

import { EINLEGE_SHADER, MISCH_SHADER, MEDIAN_SHADER, ZEIGE_SHADER, KOPIER_SHADER } from "./shader.js";
import { baueRingpuffer, plaetzeFuer, ladeBild2D, neueTextur2D } from "/lib/ringpuffer.js";

const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const MAX_PROBEN = 31; // für den Median höchstens so viele Bilder (der Shader sortiert sie)
const HINTERGRUND = { keiner: 0, grundbild: 1, median: 2 };
const MASKE = { median: 0, datei: 1, dateiInvertiert: 2, keine: 3 };
const ARTEN = { aufhellen: 0, abdunkeln: 1, mittel: 2, differenz: 3, ueberdecken: 4 };

export function richteChronoEin(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (!gl) throw new Error("Dein Browser kann kein WebGL2.");

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
    return { programm, ort, benutze: () => gl.useProgram(programm) };
  }

  const einlegen = baueProgramm(EINLEGE_SHADER);
  const mischen = baueProgramm(MISCH_SHADER);
  const median = baueProgramm(MEDIAN_SHADER);
  const zeigen = baueProgramm(ZEIGE_SHADER);
  const kopieren = baueProgramm(KOPIER_SHADER);

  function textur(einheit, ziel, t, ort) {
    gl.activeTexture(gl.TEXTURE0 + einheit);
    gl.bindTexture(ziel, t);
    gl.uniform1i(ort, einheit);
  }

  // eine 2D-Textur mit Framebuffer (Median), fest in dieser Größe
  function baueZiel(breite, hoehe) {
    const t = neueTextur2D(gl);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, breite, hoehe);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { textur: t, fb };
  }

  let groesse = { breite: 0, hoehe: 0 };
  let ring = null;
  let referenz = null; // Median { textur, fb }
  let hatReferenz = false;
  const grund = neueTextur2D(gl); // ein echtes Bild als Hintergrund
  let hatGrund = false;
  const neuesBild = neueTextur2D(gl); // das Bild, das gerade eingelegt wird
  const maskenBild = neueTextur2D(gl); // seine Maske aus einer Datei
  const liste = neueTextur2D(gl);
  gl.bindTexture(gl.TEXTURE_2D, liste);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  // neue Größe: alles neu. wunsch: so viele Bilder in der Geschichte wären schön
  function stelleGroesse(breite, hoehe, wunsch) {
    canvas.width = breite;
    canvas.height = hoehe;
    ring?.loesche();
    if (referenz) {
      gl.deleteTexture(referenz.textur);
      gl.deleteFramebuffer(referenz.fb);
    }
    const plaetze = Math.min(wunsch + 1, plaetzeFuer(gl, breite, hoehe));
    ring = baueRingpuffer(gl, breite, hoehe, plaetze);
    referenz = baueZiel(breite, hoehe);
    hatReferenz = false;
    hatGrund = false;
    groesse = { breite, hoehe };
    return plaetze - 1; // so viele Bilder passen in die Geschichte
  }

  // Geschichte: Ebenen 0 bis plaetze − 2 (im Kreis), die letzte ist das aktuelle Bild
  let naechste = 0;
  let gefuellt = 0;
  const geschichte = () => ring.plaetze - 1;
  function leere() {
    naechste = 0;
    gefuellt = 0;
    hatAktuell = false;
  }

  // ein Bild (und wahlweise seine Maske) in eine Ebene zeichnen, mit dem Unterschied im Alphakanal
  // e: { maske ("median", "datei", "dateiInvertiert", "keine"), radius, verstaerkung }
  function zeichneEbene(ebene, quelle, maskenQuelle, e) {
    ladeBild2D(gl, neuesBild, quelle);
    let art = MASKE[e.maske] ?? 3;
    if (art === 0 && !hatReferenz) art = 3;
    if ((art === 1 || art === 2) && maskenQuelle) ladeBild2D(gl, maskenBild, maskenQuelle);
    else if (art === 1 || art === 2) art = 3; // keine Maske für dieses Bild: alles zählt
    ring.zielBinden(ebene);
    einlegen.benutze();
    const o = einlegen.ort;
    textur(0, gl.TEXTURE_2D, neuesBild, o.bild);
    textur(1, gl.TEXTURE_2D, referenz.textur, o.referenz);
    textur(2, gl.TEXTURE_2D, maskenBild, o.maske);
    gl.uniform1i(o.maskeArt, art);
    gl.uniform1f(o.radius, e.radius);
    gl.uniform1f(o.verstaerkung, e.verstaerkung);
    gl.uniform2f(o.aufloesung, groesse.breite, groesse.hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function lege(quelle, maskenQuelle, e) {
    zeichneEbene(naechste, quelle, maskenQuelle, e);
    naechste = (naechste + 1) % geschichte();
    gefuellt = Math.min(gefuellt + 1, geschichte());
  }

  let hatAktuell = false;
  function setzeAktuell(quelle, maskenQuelle, e) {
    zeichneEbene(ring.plaetze - 1, quelle, maskenQuelle, e);
    hatAktuell = true;
  }

  function setzeGrund(quelle) {
    ladeBild2D(gl, grund, quelle);
    hatGrund = true;
  }

  // Median aus Bildern (Canvas, höchstens MAX_PROBEN) -> Referenz.
  // Die Proben gehen erst in einen eigenen kleinen Ringpuffer (richtig herum gezeichnet), dann sortiert
  // der Median-Shader pro Pixel.
  function rechneReferenz(bilder) {
    const n = Math.min(bilder.length, MAX_PROBEN);
    if (!n) return;
    const proben = baueRingpuffer(gl, groesse.breite, groesse.hoehe, n);
    bilder.slice(0, n).forEach((b, i) => {
      ladeBild2D(gl, neuesBild, b);
      proben.zielBinden(i);
      kopieren.benutze();
      textur(0, gl.TEXTURE_2D, neuesBild, kopieren.ort.bild);
      gl.uniform2f(kopieren.ort.aufloesung, groesse.breite, groesse.hoehe);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, referenz.fb);
    gl.viewport(0, 0, groesse.breite, groesse.hoehe);
    median.benutze();
    textur(0, gl.TEXTURE_2D_ARRAY, proben.textur, median.ort.proben);
    gl.uniform1i(median.ort.anzahl, n % 2 ? n : Math.max(1, n - 1)); // ungerade: genau eine Mitte
    gl.uniform2f(median.ort.aufloesung, groesse.breite, groesse.hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    proben.loesche();
    hatReferenz = true;
  }

  // Übereinanderlegen aufs Canvas
  // e: { art, hintergrund, schwelle, weich, deckkraft, verblassen, fenster (so viele aus der Geschichte),
  //      mitAktuell (das aktuelle Bild obenauf) }
  function mische(e) {
    const anzahl = Math.min(e.fenster, gefuellt);
    const eintraege = [];
    for (let i = anzahl - 1; i >= 0; i--) {
      const ebene = (naechste - 1 - i + geschichte() * 2) % geschichte(); // i = 0: das neueste
      const alter = i + (e.mitAktuell ? 1 : 0);
      eintraege.push(ebene, e.deckkraft * e.verblassen ** alter);
    }
    if (e.mitAktuell) eintraege.push(ring.plaetze - 1, e.deckkraft);
    const daten = new Float32Array(Math.max(eintraege.length, 2));
    daten.set(eintraege);
    gl.bindTexture(gl.TEXTURE_2D, liste);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, daten.length / 2, 1, 0, gl.RG, gl.FLOAT, daten);

    let hg = HINTERGRUND[e.hintergrund] ?? 0;
    if (hg === 1 && !hatGrund) hg = hatReferenz ? 2 : 0;
    if (hg === 2 && !hatReferenz) hg = 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    mischen.benutze();
    const o = mischen.ort;
    textur(0, gl.TEXTURE_2D_ARRAY, ring.textur, o.stapel);
    textur(1, gl.TEXTURE_2D, liste, o.liste);
    textur(2, gl.TEXTURE_2D, grund, o.grund);
    textur(3, gl.TEXTURE_2D, referenz.textur, o.referenz);
    gl.uniform1i(o.anzahl, eintraege.length / 2);
    gl.uniform1i(o.hintergrund, hg);
    gl.uniform1f(o.schwelle, e.schwelle);
    gl.uniform1f(o.weich, e.weich);
    gl.uniform1i(o.art, ARTEN[e.art] ?? 0);
    gl.uniform2f(o.aufloesung, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // was: "grundbild", "median", "aktuell", "maske" (des aktuellen Bildes)
  function zeige(was) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    zeigen.benutze();
    const o = zeigen.ort;
    textur(0, gl.TEXTURE_2D, was === "median" ? referenz.textur : grund, o.bild);
    textur(1, gl.TEXTURE_2D_ARRAY, ring.textur, o.stapel);
    // aktuelles Bild: im Video die reservierte Ebene, beim Standbild das zuletzt eingelegte
    const aktuell = hatAktuell ? ring.plaetze - 1 : gefuellt ? (naechste - 1 + geschichte()) % geschichte() : -1;
    gl.uniform1i(o.ebene, was === "aktuell" || was === "maske" ? aktuell : -1);
    gl.uniform1i(o.alpha, was === "maske" ? 1 : 0);
    gl.uniform2f(o.aufloesung, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    stelleGroesse,
    leere,
    lege,
    setzeAktuell,
    setzeGrund,
    rechneReferenz,
    mische,
    zeige,
    hatReferenz: () => hatReferenz,
    hatGrund: () => hatGrund,
  };
}
