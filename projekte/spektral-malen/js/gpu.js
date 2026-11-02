// Grafikkarte: Flächen zum Malen, der Pinsel als Shader-Durchgang, die Anzeige als zweiter.
//
// Gemalt wird auf Flächen: die Malschicht und die Maske jeder Ton-Ebene. Jede liegt als Float-Textur
// auf der Grafikkarte (R32F: eine 32-Bit-Zahl pro Stelle, x = Spalte, y = Fach).
// Ein Shader kann aber nicht in die Textur schreiben, aus der er gerade liest.
// Darum hat jede Fläche zwei: "a" ist die Fläche, "b" der Notizzettel.
//   1. Tupfer: lies aus a, schreib in b, aber nur im Rechteck um den Pinsel (scissor)
//   2. das Rechteck von b nach a zurückkopieren (blitFramebuffer)
// Danach ist a wieder die ganze, aktuelle Fläche. Ganz hin und her tauschen (Ping-Pong) ginge auch,
// dann müsste aber jeder Tupfer die ganze Fläche schreiben, auch dort, wo sich nichts ändert.
//
// Der Klang läuft nicht auf der Grafikkarte (klang-worklet.js), und aus mehreren Ebenen wird erst im
// Speicher ein Bild (ebenen.js, mischeAnzeige). Darum liest lies() geänderte Spalten zurück, und die
// fertige Mischung kommt als eigene Textur wieder herauf (ladeAnzeige). Die liegt quer (x = Fach,
// y = Spalte): genau so liegt sie im Speicher, Spalte für Spalte, und geht mit einem Aufruf hinauf.

import { farbtabelle, skalaAnker } from "/lib/farben.js";
import { ladeVerlauf } from "/lib/verlauf.js";
import { ANZEIGE_SHADER } from "./anzeige-shader.js";
import { PINSEL_SHADER } from "./pinsel-shader.js";
import { anteilZuFrequenz } from "./leinwand.js";

// ein Dreieck, das alles abdeckt (wie in /lib/webgl.js); was gezeichnet wird, entscheidet viewport und scissor
const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export function richteGpuEin(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (!gl) throw new Error("Dein Browser kann kein WebGL2.");
  // in Float-Texturen rendern: in WebGL2 nur mit dieser Erweiterung (iPhone ab iOS 15)
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Dein Browser kann nicht in Float-Texturen malen.");

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
    // alle uniforms einmal nachschlagen: ort.radius statt jedes Mal getUniformLocation
    const ort = {};
    const anzahl = gl.getProgramParameter(programm, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < anzahl; i++) {
      const name = gl.getActiveUniform(programm, i).name;
      ort[name] = gl.getUniformLocation(programm, name);
    }
    return { programm, ort };
  }

  const pinsel = baueProgramm(PINSEL_SHADER);
  const anzeige = baueProgramm(ANZEIGE_SHADER);
  const verlauf = ladeVerlauf(gl, farbtabelle(skalaAnker("glut")));
  const maxGroesse = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  let leinwand = null;
  const flaechen = new Map(); // id der Ebene -> { a, b, spalten }
  let mischung = null; // Textur der Anzeige (quer)

  function baueTextur(breite, hoehe, werte = null) {
    const textur = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // werte null: WebGL füllt die Textur mit 0
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, breite, hoehe, 0, gl.RED, gl.FLOAT, werte);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); // Float-Texturen nie mischen
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return textur;
  }

  function baueFlaeche(spalten, faecher, werte) {
    const textur = baueTextur(spalten, faecher, werte);
    const puffer = gl.createFramebuffer(); // damit man in die Textur zeichnen und aus ihr lesen kann
    gl.bindFramebuffer(gl.FRAMEBUFFER, puffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textur, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { textur, puffer };
  }

  function loesche(flaeche) {
    gl.deleteTexture(flaeche.textur);
    gl.deleteFramebuffer(flaeche.puffer);
  }

  // Spalte für Spalte (Speicher) -> Zeile für Zeile (Textur: eine Zeile ist ein Fach)
  function querGestellt(werte, spalten, faecher) {
    const quer = new Float32Array(spalten * faecher);
    for (let s = 0; s < spalten; s++) {
      for (let k = 0; k < faecher; k++) quer[k * spalten + s] = werte[s * faecher + k];
    }
    return quer;
  }

  function pruefeGroesse(spalten, faecher) {
    if (spalten > maxGroesse || faecher > maxGroesse) {
      throw new Error(`Zu groß für diese Grafikkarte: höchstens ${maxGroesse} Spalten und Fächer.`);
    }
  }

  // neue Leinwand: alle Flächen weg, Anzeige neu und still
  function neu(neueLeinwand) {
    pruefeGroesse(neueLeinwand.spalten, neueLeinwand.faecher);
    for (const id of [...flaechen.keys()]) entferneFlaeche(id);
    if (mischung) gl.deleteTexture(mischung);
    leinwand = neueLeinwand;
    mischung = baueTextur(leinwand.faecher, leinwand.spalten);
  }

  // eine Fläche zum Malen, spalten breit, mit werte (Spalte für Spalte) oder still
  function neueFlaeche(id, spalten, werte = null) {
    const { faecher } = leinwand;
    pruefeGroesse(spalten, faecher);
    if (flaechen.has(id)) entferneFlaeche(id);
    const quer = werte ? querGestellt(werte, spalten, faecher) : null;
    flaechen.set(id, { a: baueFlaeche(spalten, faecher, quer), b: baueFlaeche(spalten, faecher, null), spalten });
  }

  function entferneFlaeche(id) {
    const f = flaechen.get(id);
    if (!f) return;
    loesche(f.a);
    loesche(f.b);
    flaechen.delete(id);
  }

  // Ein Tupfer auf Fläche id. ansicht: { breite, hoehe, tief, hoch } (Bildpunkte, Hz); t: der Tupfer
  // { x, y (Bildpunkte, y = 0 unten), radius, staerke, haerte, helligkeit, radieren }.
  // versatz: in welcher Spalte der Leinwand die Fläche anfängt (Ton-Ebenen, die später beginnen)
  // Rückgabe: welche Spalten der Fläche sich geändert haben können [von, bis] oder null
  function tupfe(id, ansicht, t, versatz = 0) {
    const f = flaechen.get(id);
    if (!f) return null;
    const { faecher, fachBreite } = leinwand;
    const pxProSpalte = ansicht.breite / leinwand.spalten;
    const x = t.x - versatz * pxProSpalte; // der Pinsel aus Sicht der Fläche

    // Rechteck um den Tupfer in Spalten und Fächern (eins mehr an jeder Seite, wegen der Streifen)
    const von = Math.max(Math.floor((x - t.radius) / pxProSpalte) - 1, 0);
    const bis = Math.min(Math.ceil((x + t.radius) / pxProSpalte) + 1, f.spalten - 1);
    const fUnten = anteilZuFrequenz((t.y - t.radius) / ansicht.hoehe, ansicht.tief, ansicht.hoch);
    const fOben = anteilZuFrequenz((t.y + t.radius) / ansicht.hoehe, ansicht.tief, ansicht.hoch);
    const unten = Math.max(Math.floor(fUnten / fachBreite) - 1, 1);
    const oben = Math.min(Math.ceil(fOben / fachBreite) + 1, faecher - 2);
    if (von > bis || unten > oben) return null; // ganz außerhalb

    const breite = bis - von + 1;
    const hoehe = oben - unten + 1;

    // 1. aus a lesen, in b schreiben, nur im Rechteck
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.b.puffer);
    gl.viewport(0, 0, f.spalten, faecher); // gl_FragCoord = Spalte und Fach
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(von, unten, breite, hoehe);
    gl.useProgram(pinsel.programm);
    const o = pinsel.ort;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.a.textur);
    gl.uniform1i(o.daten, 0);
    gl.uniform2f(o.pinsel, x, t.y);
    gl.uniform1f(o.radius, t.radius);
    gl.uniform1f(o.staerke, t.staerke);
    gl.uniform1f(o.haerte, t.haerte);
    gl.uniform1f(o.helligkeit, t.helligkeit);
    gl.uniform1i(o.radieren, t.radieren ? 1 : 0);
    gl.uniform1f(o.pxProSpalte, pxProSpalte);
    gl.uniform1f(o.bildHoehe, ansicht.hoehe);
    gl.uniform1f(o.tief, ansicht.tief);
    gl.uniform1f(o.hoch, ansicht.hoch);
    gl.uniform1f(o.fachBreite, fachBreite);
    gl.uniform1f(o.faecher, faecher);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);

    // 2. das Rechteck von b zurück nach a
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, f.b.puffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, f.a.puffer);
    gl.blitFramebuffer(von, unten, bis + 1, oben + 1, von, unten, bis + 1, oben + 1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    return [von, bis];
  }

  // Spalten von bis bis (beide mit) der Fläche id zurück in den Speicher, in ziel
  // (Spalte für Spalte, wie im Klang: ziel[spalte · faecher + fach])
  let lesePuffer = new Float32Array(0);
  function lies(id, von, bis, ziel) {
    const f = flaechen.get(id);
    const { faecher } = leinwand;
    const breite = bis - von + 1;
    // RGBA + FLOAT geht bei Float-Flächen immer, auch wenn die Textur nur einen Kanal hat
    if (lesePuffer.length < breite * faecher * 4) lesePuffer = new Float32Array(breite * faecher * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.a.puffer);
    gl.readPixels(von, 0, breite, faecher, gl.RGBA, gl.FLOAT, lesePuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // readPixels liefert Zeile für Zeile (Zeile = Fach), umsortieren nach Spalte für Spalte
    for (let fach = 0; fach < faecher; fach++) {
      for (let s = 0; s < breite; s++) {
        ziel[(von + s) * faecher + fach] = lesePuffer[(fach * breite + s) * 4];
      }
    }
  }

  // Spalten von bis bis aus dem Speicher (quelle, Spalte für Spalte) auf die Fläche id
  // (Rückgängig, Auswahl verschieben)
  function schreibe(id, von, bis, quelle) {
    const f = flaechen.get(id);
    if (!f) return;
    const { faecher } = leinwand;
    gl.bindTexture(gl.TEXTURE_2D, f.a.textur);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // eine Spalte ist ein Bild 1 breit und faecher hoch: Fach für Fach, genau wie im Speicher
    for (let s = von; s <= bis; s++) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, s, 0, 1, faecher, gl.RED, gl.FLOAT, quelle.subarray(s * faecher, (s + 1) * faecher));
    }
  }

  // die fertige Mischung (Lautstärke, Spalte für Spalte) von Spalte von bis bis hinauf
  function ladeAnzeige(von, bis, werte) {
    const { faecher } = leinwand;
    gl.bindTexture(gl.TEXTURE_2D, mischung);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, von, faecher, bis - von + 1, gl.RED, gl.FLOAT, werte.subarray(von * faecher, (bis + 1) * faecher));
  }

  function waehleFarben(name) {
    ladeVerlauf(gl, farbtabelle(skalaAnker(name)), verlauf);
  }

  // die Mischung ins Bild. ansicht: { tief, hoch, dynamik }
  function zeichne(ansicht) {
    if (!mischung) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(anzeige.programm);
    const o = anzeige.ort;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mischung);
    gl.uniform1i(o.mischung, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, verlauf);
    gl.uniform1i(o.verlauf, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(o.aufloesung, canvas.width, canvas.height);
    gl.uniform1f(o.tief, ansicht.tief);
    gl.uniform1f(o.hoch, ansicht.hoch);
    gl.uniform1f(o.dynamik, ansicht.dynamik);
    gl.uniform1f(o.fachBreite, leinwand.fachBreite);
    gl.uniform1i(o.spalten, leinwand.spalten);
    gl.uniform1i(o.faecher, leinwand.faecher);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { neu, neueFlaeche, entferneFlaeche, tupfe, lies, schreibe, ladeAnzeige, waehleFarben, zeichne };
}
