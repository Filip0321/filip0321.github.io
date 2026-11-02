// Grafikkarte: Video als Textur und vier Durchgänge pro Bild.
//   vorbereite()  Video -> Helligkeit (weich) -> bearbeitet (hell, Kanten, Bewegung, Schwelle)
//   lies()        der Lese-Shader liest jeden Strich in eine Fläche zeilen × (2 + Striche), die zurückgelesen wird.
//                 Die ersten beiden Zeilen der Fläche sind Profile über das ganze Bild (senkrecht und
//                 waagerecht): wo passiert wie viel? Daraus rechnet frequenzen.js die Zeilendichte.
//   zeichne()     Video oder Bearbeitetes aufs Canvas, mit Lupe und Fenster
//
// Warum auf der Grafikkarte lesen und nicht mit getImageData auf einem 2D-Canvas?
// getImageData müsste jedes Bild ganz auf die CPU holen (bei 1280 × 720 fast 4 MB, 30-mal pro
// Sekunde). Hier holt die CPU nur das Ergebnis zurück: ein paar hundert Zahlen.
//
// Gearbeitet wird in höchstens 640 Pixeln Breite: Für Kanten und Bewegung reicht das, und es ist auch
// am Handy schnell. Angezeigt wird das Video in voller Größe.

import { ANZEIGE_SHADER } from "./anzeige-shader.js";
import { LESE_SHADER } from "./lese-shader.js";
import { HELL_SHADER, BEARBEIT_SHADER } from "./vorbereitung-shader.js";

// ein Dreieck, das alles abdeckt (wie in /lib/webgl.js)
const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const MAX_PROBEN = 32; // pro Richtung; mehr bringt kaum etwas und kostet bei breiten Strichen
const ARBEITS_BREITE = 640;
const MODI = { hell: 0, kanten: 1, bewegung: 2, beides: 3 };
export const PROFILE = 2; // so viele Zeilen der Lese-Fläche sind Profile (vor den Strichen)

export function richteGpuEin(canvas) {
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
    return { programm, ort };
  }

  const anzeige = baueProgramm(ANZEIGE_SHADER);
  const lesen = baueProgramm(LESE_SHADER);
  const hellProgramm = baueProgramm(HELL_SHADER);
  const bearbeitProgramm = baueProgramm(BEARBEIT_SHADER);

  // Textur mit Framebuffer (damit man hineinzeichnen kann); filter LINEAR für Bilder, NEAREST für Daten
  function baueFlaeche(breite, hoehe, { format = gl.RGBA8, typ = gl.UNSIGNED_BYTE, kanaele = gl.RGBA, filter = gl.LINEAR, puffer = true } = {}) {
    const textur = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, breite, hoehe, 0, kanaele, typ, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let fb = null;
    if (puffer) {
      fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textur, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return { textur, fb, breite, hoehe };
  }

  function loesche(f) {
    if (!f) return;
    gl.deleteTexture(f.textur);
    if (f.fb) gl.deleteFramebuffer(f.fb);
  }

  const video = baueFlaeche(1, 1, { puffer: false });
  let drehung = 0; // in Vierteln im Uhrzeigersinn
  let videoGroesse = { breite: 1, hoehe: 1 };
  let hell = [null, null]; // Helligkeit jetzt und vorher, wechseln sich ab (Ping-Pong)
  let jetzt = 0;
  let bearbeitet = null;
  let arbeit = { breite: 0, hoehe: 0 };

  function passeArbeitAn(breite, hoehe) {
    const w = Math.min(ARBEITS_BREITE, breite);
    const h = Math.max(1, Math.round((hoehe * w) / breite));
    if (w === arbeit.breite && h === arbeit.hoehe) return;
    for (const f of [...hell, bearbeitet]) loesche(f);
    hell = [baueFlaeche(w, h), baueFlaeche(w, h)];
    bearbeitet = baueFlaeche(w, h);
    arbeit = { breite: w, hoehe: h };
  }

  // das aktuelle Bild des Videos auf die Grafikkarte
  function ladeBild(quelle) {
    gl.bindTexture(gl.TEXTURE_2D, video.textur);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // Video hat y = 0 oben, wir wollen unten (tief = unten)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // gedreht um 90° oder 270°: Breite und Höhe tauschen
    const quer = drehung % 2 === 1;
    videoGroesse = { breite: quer ? quelle.videoHeight : quelle.videoWidth, hoehe: quer ? quelle.videoWidth : quelle.videoHeight };
    passeArbeitAn(videoGroesse.breite, videoGroesse.hoehe);
  }

  function zeichneIn(flaeche, programm) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, flaeche.fb);
    gl.viewport(0, 0, flaeche.breite, flaeche.hoehe);
    gl.useProgram(programm.programm);
  }

  function textur(einheit, t, ort) {
    gl.activeTexture(gl.TEXTURE0 + einheit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(ort, einheit);
  }

  // neu: ein neues Videobild (sonst dasselbe noch einmal, z. B. nach Pause: dann gibt es keine Bewegung)
  function vorbereite(e, neu = true) {
    if (!bearbeitet) return;
    if (neu) jetzt = 1 - jetzt;
    const vorher = neu ? 1 - jetzt : jetzt;
    zeichneIn(hell[jetzt], hellProgramm);
    textur(0, video.textur, hellProgramm.ort.video);
    gl.uniform2f(hellProgramm.ort.aufloesung, arbeit.breite, arbeit.hoehe);
    gl.uniform1f(hellProgramm.ort.radius, e.weich);
    gl.uniform1i(hellProgramm.ort.drehung, drehung);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const o = bearbeitProgramm.ort;
    zeichneIn(bearbeitet, bearbeitProgramm);
    textur(0, hell[jetzt].textur, o.jetzt);
    textur(1, hell[vorher].textur, o.vorher);
    gl.uniform2f(o.aufloesung, arbeit.breite, arbeit.hoehe);
    gl.uniform1i(o.modus, MODI[e.modus] ?? 0);
    gl.uniform1f(o.verstaerkung, e.verstaerkung);
    gl.uniform1f(o.schwelle, e.schwelle);
    gl.uniform1i(o.invertieren, e.invertieren ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------- Lesen ----------

  let ziel = null; // zeilen × (PROFILE + Striche), 8 Bit
  let grenzen = null; // dieselbe Größe, RG32F: (unten, oben) jeder Zeile
  let rohe = new Uint8Array(0);

  function passeZielAn(zeilen, zeilenZahl) {
    if (ziel && ziel.breite === zeilen && ziel.hoehe === zeilenZahl) return;
    loesche(ziel);
    loesche(grenzen);
    ziel = baueFlaeche(zeilen, zeilenZahl, { filter: gl.NEAREST });
    // RG32F: zwei 32-Bit-Zahlen pro Stelle; nur mit texelFetch gelesen, darum ohne Erweiterung erlaubt
    grenzen = baueFlaeche(zeilen, zeilenZahl, { format: gl.RG32F, typ: gl.FLOAT, kanaele: gl.RG, filter: gl.NEAREST, puffer: false });
    rohe = new Uint8Array(zeilen * zeilenZahl * 4);
  }

  // striche: [{ mitte, breite, senkrecht, rueckwaerts, grenzen: Float32Array(2 · zeilen) }]
  // ansicht: { bereich, fenster } (uv-Rechtecke [links, unten, rechts, oben])
  // Rückgabe: { profile: [senkrecht, waagerecht], werte: [pro Strich] } (Float32Array, 0 bis 1)
  function lies(striche, zeilen, ansicht) {
    if (!bearbeitet) return null;
    const anzahl = PROFILE + striche.length;
    passeZielAn(zeilen, anzahl);

    // Profile: gleichmäßige Stücke über das ganze Bild (Strich so breit wie alles)
    const gleich = new Float32Array(2 * zeilen);
    for (let z = 0; z < zeilen; z++) {
      gleich[2 * z] = z / zeilen;
      gleich[2 * z + 1] = (z + 1) / zeilen;
    }
    const alle = [
      { mitte: 0.5, breite: 1, senkrecht: true, rueckwaerts: false, grenzen: gleich },
      { mitte: 0.5, breite: 1, senkrecht: false, rueckwaerts: false, grenzen: gleich },
      ...striche,
    ];
    const daten = new Float32Array(2 * zeilen * anzahl);
    alle.forEach((s, i) => daten.set(s.grenzen, 2 * zeilen * i));
    gl.bindTexture(gl.TEXTURE_2D, grenzen.textur);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, zeilen, anzahl, gl.RG, gl.FLOAT, daten);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ziel.fb);
    gl.useProgram(lesen.programm);
    const o = lesen.ort;
    textur(0, bearbeitet.textur, o.bild);
    textur(1, grenzen.textur, o.grenzen);
    const proben = (pixel) => Math.min(MAX_PROBEN, Math.max(1, Math.round(pixel)));
    alle.forEach((s, i) => {
      // Profile über das ganze Bild, Striche über den Bereich (Lupe)
      const bereich = i < PROFILE ? [0, 0, 1, 1] : ansicht.bereich;
      const fenster = i < PROFILE ? [0, 0, 1, 1] : ansicht.fenster;
      const quer = s.senkrecht ? arbeit.breite * (bereich[2] - bereich[0]) : arbeit.hoehe * (bereich[3] - bereich[1]);
      const laengs = s.senkrecht ? arbeit.hoehe * (bereich[3] - bereich[1]) : arbeit.breite * (bereich[2] - bereich[0]);
      gl.viewport(0, i, zeilen, 1); // eine Zeile der Fläche pro Strich
      gl.uniform1i(o.strich, i);
      gl.uniform1f(o.mitte, s.mitte);
      gl.uniform1f(o.breite, s.breite);
      gl.uniform1i(o.senkrecht, s.senkrecht ? 1 : 0);
      gl.uniform1i(o.rueckwaerts, s.rueckwaerts ? 1 : 0);
      gl.uniform4fv(o.bereich, bereich);
      gl.uniform4fv(o.fenster, fenster);
      // etwa eine Probe pro Pixel im Stück (Profile gröber: höchstens 8 quer genügen für einen Überblick)
      gl.uniform1i(o.probenQuer, i < PROFILE ? 8 : proben(s.breite * quer));
      gl.uniform1i(o.probenLaengs, proben(laengs / zeilen));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.readPixels(0, 0, zeilen, anzahl, gl.RGBA, gl.UNSIGNED_BYTE, rohe);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const zeile = (i) => {
      const w = new Float32Array(zeilen);
      for (let z = 0; z < zeilen; z++) w[z] = rohe[(i * zeilen + z) * 4] / 255; // nur Rot
      return w;
    };
    return { profile: [zeile(0), zeile(1)], werte: striche.map((_s, i) => zeile(PROFILE + i)) };
  }

  // ansicht: { zeigeBearbeitet, bereich, fenster }
  function zeichne(ansicht) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(anzeige.programm);
    const o = anzeige.ort;
    textur(0, video.textur, o.video);
    textur(1, (bearbeitet ?? video).textur, o.bearbeitet);
    gl.uniform1i(o.zeigeBearbeitet, ansicht.zeigeBearbeitet ? 1 : 0);
    gl.uniform1i(o.drehung, drehung);
    gl.uniform2f(o.aufloesung, canvas.width, canvas.height);
    gl.uniform4fv(o.bereich, ansicht.bereich);
    gl.uniform4fv(o.fenster, ansicht.fenster);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { ladeBild, vorbereite, lies, zeichne, setzeDrehung: (d) => (drehung = d) };
}
