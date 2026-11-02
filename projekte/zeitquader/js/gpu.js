// Grafikkarte des Zeitquaders: ein Ringpuffer aus Bildern (/lib/ringpuffer.js) und drei Ansichten.
// Eine Instanz pro Canvas (Vorschau und Export haben je ihre).

import { KOPIER_SHADER, SCHLITZ_SHADER, VERSATZ_SHADER, ZEIGE_SHADER, QUADER_SHADER, MEDIAN_SHADER } from "./shader.js";
import { baueRingpuffer, plaetzeFuer, ladeBild2D, neueTextur2D } from "/lib/ringpuffer.js";

const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const MUSTER = { "links-rechts": 0, "rechts-links": 1, "oben-unten": 2, "unten-oben": 3, "mitte-aussen": 4, "aussen-mitte": 5, helligkeit: 6, welle: 7 };
const ARTEN = { leuchten: 0, bewegtes: 1, nebel: 2 };
const SCHNITTE = { aus: 0, x: 1, y: 2, zeit: 3 };

export function richteZeitEin(canvas) {
  // preserveDrawingBuffer: das Bild bleibt nach dem Zeichnen stehen (für Bild speichern und Live aufnehmen)
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("Dein Browser kann kein WebGL2.");

  function baueProgramm(fragment) {
    const programm = gl.createProgram();
    for (const [typ, quelle] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(typ);
      gl.shaderSource(shader, quelle);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(programm, shader);
    }
    gl.linkProgram(programm);
    if (!gl.getProgramParameter(programm, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(programm));
    const ort = {};
    const anzahl = gl.getProgramParameter(programm, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < anzahl; i++) {
      const name = gl.getActiveUniform(programm, i).name;
      ort[name] = gl.getUniformLocation(programm, name);
    }
    return { ort, benutze: () => gl.useProgram(programm) };
  }

  const kopieren = baueProgramm(KOPIER_SHADER);
  const schlitzen = baueProgramm(SCHLITZ_SHADER);
  const versetzen = baueProgramm(VERSATZ_SHADER);
  const zeigen = baueProgramm(ZEIGE_SHADER);
  const quadern = baueProgramm(QUADER_SHADER);
  const median = baueProgramm(MEDIAN_SHADER);

  function textur(einheit, ziel, t, ort) {
    gl.activeTexture(gl.TEXTURE0 + einheit);
    gl.bindTexture(ziel, t);
    gl.uniform1i(ort, einheit);
  }

  function zeichneAufs(breite, hoehe) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    canvas.width = breite;
    canvas.height = hoehe;
    gl.viewport(0, 0, breite, hoehe);
  }

  // eine 2D-Textur mit Framebuffer, fest in dieser Größe
  function baueZiel(breite, hoehe) {
    const t = neueTextur2D(gl);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, breite, hoehe);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { textur: t, fb, breite, hoehe, loesche: () => (gl.deleteTexture(t), gl.deleteFramebuffer(fb)) };
  }

  const neu = neueTextur2D(gl); // das zuletzt hochgeladene Bild
  let groesse = { breite: 1, hoehe: 1 };
  let ring = null;
  let schlitz = null; // das Schlitzbild
  let referenz = null; // Median des Quaders

  // Puffer für so viele Bilder (höchstens, was der Speicher erlaubt). Rückgabe: so viele passen
  function stelleGroesse(breite, hoehe, wunsch) {
    ring?.loesche();
    referenz?.loesche();
    referenz = null;
    groesse = { breite, hoehe };
    ring = baueRingpuffer(gl, breite, hoehe, Math.max(2, Math.min(wunsch, plaetzeFuer(gl, breite, hoehe))));
    return ring.plaetze;
  }

  // ein neues Bild: hochladen und in die nächste Ebene des Rings
  function lege(quelle) {
    ladeBild2D(gl, neu, quelle);
    ring.zielBinden();
    kopieren.benutze();
    textur(0, gl.TEXTURE_2D, neu, kopieren.ort.bild);
    gl.uniform2f(kopieren.ort.aufloesung, groesse.breite, groesse.hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    ring.weiter();
  }

  // ---------- Schlitz ----------

  // neues Schlitzbild: senkrecht = jede Spalte ein Bild (breite = Anzahl Bilder), sonst jede Zeile
  function neuerSchlitz(anzahl, senkrecht) {
    schlitz?.loesche();
    schlitz = senkrecht ? baueZiel(anzahl, groesse.hoehe) : baueZiel(groesse.breite, anzahl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, schlitz.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return schlitz;
  }

  // den Schlitz des zuletzt gelegten Bildes an Stelle i schreiben (waagerecht: Zeile i von oben)
  function schreibeSchlitz(i, lage, senkrecht) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, schlitz.fb);
    if (senkrecht) gl.viewport(i, 0, 1, schlitz.hoehe);
    else gl.viewport(0, schlitz.hoehe - 1 - i, schlitz.breite, 1);
    schlitzen.benutze();
    textur(0, gl.TEXTURE_2D, neu, schlitzen.ort.bild);
    gl.uniform1f(schlitzen.ort.lage, lage);
    gl.uniform1i(schlitzen.ort.senkrecht, senkrecht ? 1 : 0);
    gl.uniform2f(schlitzen.ort.aufloesung, schlitz.breite, schlitz.hoehe);
    // der Shader rechnet mit Anteilen des ganzen Schlitzbildes: viewport verschiebt gl_FragCoord nicht,
    // darum liegt p genau richtig (x = i + 0,5 bzw. y = Zeile)
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // verschiebung: Anteil, um den im Kreis verschoben wird (live), senkrecht wie beim Schreiben
  function zeigeSchlitz(breite, hoehe, verschiebung = 0, senkrecht = true) {
    zeichneAufs(breite, hoehe);
    zeigen.benutze();
    textur(0, gl.TEXTURE_2D, schlitz.textur, zeigen.ort.bild);
    gl.uniform1f(zeigen.ort.verschiebung, verschiebung);
    gl.uniform1i(zeigen.ort.senkrecht, senkrecht ? 1 : 0);
    gl.uniform2f(zeigen.ort.aufloesung, breite, hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------- Zeitversatz ----------

  // e: { muster, tiefe (Bilder), zeit }
  function versatz(e, breite = groesse.breite, hoehe = groesse.hoehe) {
    zeichneAufs(breite, hoehe);
    versetzen.benutze();
    const o = versetzen.ort;
    textur(0, gl.TEXTURE_2D_ARRAY, ring.textur, o.stapel);
    gl.uniform1i(o.neueste, ring.ebeneVor(0));
    gl.uniform1i(o.plaetze, ring.plaetze);
    gl.uniform1f(o.tiefe, Math.max(0, Math.min(e.tiefe, ring.gefuellt() - 2)));
    gl.uniform1i(o.muster, MUSTER[e.muster] ?? 0);
    gl.uniform1f(o.zeit, e.zeit ?? 0);
    gl.uniform2f(o.aufloesung, breite, hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------- Quader ----------

  // nach dem Füllen: der Median als Hintergrund (für „bewegtes“)
  function rechneReferenz() {
    referenz?.loesche();
    referenz = baueZiel(groesse.breite, groesse.hoehe);
    gl.bindFramebuffer(gl.FRAMEBUFFER, referenz.fb);
    gl.viewport(0, 0, groesse.breite, groesse.hoehe);
    median.benutze();
    textur(0, gl.TEXTURE_2D_ARRAY, ring.textur, median.ort.stapel);
    gl.uniform1i(median.ort.anzahl, ring.gefuellt());
    gl.uniform1i(median.ort.k, Math.min(15, ring.gefuellt() % 2 ? ring.gefuellt() : ring.gefuellt() - 1));
    gl.uniform2f(median.ort.aufloesung, groesse.breite, groesse.hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // e: { art, deckkraft, schwelle, laenge, schnitt, schnittLage }, k: kamera.js
  function quader(e, k, breite, hoehe) {
    zeichneAufs(breite, hoehe);
    quadern.benutze();
    const o = quadern.ort;
    textur(0, gl.TEXTURE_2D_ARRAY, ring.textur, o.stapel);
    textur(1, gl.TEXTURE_2D, (referenz ?? { textur: neu }).textur, o.referenz);
    gl.uniform1i(o.anzahl, ring.gefuellt());
    gl.uniformMatrix4fv(o.zurueck, false, k.zurueck);
    gl.uniform3fv(o.auge, k.auge);
    gl.uniform3f(o.masse, groesse.breite / groesse.hoehe, 1, e.laenge);
    gl.uniform1i(o.art, ARTEN[e.art] ?? 0);
    gl.uniform1f(o.deckkraft, e.deckkraft);
    gl.uniform1f(o.schwelle, e.schwelle);
    gl.uniform1i(o.schnitt, SCHNITTE[e.schnitt] ?? 0);
    gl.uniform1f(o.schnittLage, e.schnittLage);
    gl.uniform2f(o.aufloesung, breite, hoehe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    stelleGroesse,
    lege,
    leere: () => ring.leere(),
    gefuellt: () => ring.gefuellt(),
    neuerSchlitz,
    schreibeSchlitz,
    zeigeSchlitz,
    versatz,
    rechneReferenz,
    quader,
  };
}
