// Grafikkarte für „Tiefe aus Fotos“: Block Matching (in Streifen, damit die Grafikkarte nicht hängt),
// die Ansichten und die Punktwolke. Ein WebGL2-Kontext auf dem sichtbaren Canvas.

import { VOLLBILD, MATCH, ANSICHT, WOLKE_VERTEX, WOLKE_FRAGMENT } from "./shader.js";

export function richteGpuEin(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("Dein Browser kann kein WebGL2.");
  // in Float-Texturen zeichnen (die Disparität braucht Kommastellen): fast überall da, auch am iPhone
  const mitFloat = Boolean(gl.getExtension("EXT_color_buffer_float"));

  function programm(vertex, fragment) {
    const p = gl.createProgram();
    for (const [typ, quelle] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const s = gl.createShader(typ);
      gl.shaderSource(s, quelle);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const ort = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(p, i).name;
      ort[name] = gl.getUniformLocation(p, name);
    }
    return { p, ort };
  }

  const match = programm(VOLLBILD, MATCH);
  const ansicht = programm(VOLLBILD, ANSICHT);
  const wolke = programm(WOLKE_VERTEX, WOLKE_FRAGMENT);

  function textur(filter = gl.LINEAR) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Farbbilder (ImageData oder Canvas) und Graubilder (Float32Array)
  const farbe = { links: textur(), rechts: textur(), extra: textur() };
  const grau = { links: textur(gl.NEAREST), rechts: textur(gl.NEAREST), mitte: textur(gl.NEAREST) };
  const tiefe = textur();
  let verlauf = textur();
  let groesse = { w: 1, h: 1 };

  function ladeFarbe(name, quelle) {
    gl.bindTexture(gl.TEXTURE_2D, farbe[name]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Zeile 0 oben, siehe shader.js
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
  }

  function ladeGrau(name, { l, w, h }) {
    gl.bindTexture(gl.TEXTURE_2D, grau[name]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, l);
    groesse = { w, h };
  }

  // die fertige Tiefe (0 fern bis 1 nah, −1 ungültig) als R16F: lässt sich, anders als R32F, überall filtern
  function ladeTiefe(werte, w, h) {
    gl.bindTexture(gl.TEXTURE_2D, tiefe);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, werte);
  }

  function setzeVerlauf(t) {
    verlauf = t;
  }

  function binde(prog, einheit, name, t) {
    gl.activeTexture(gl.TEXTURE0 + einheit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(prog.ort[name], einheit);
  }

  // Block Matching. e: { referenz, anderes, drittes?, richtung, dMin, dMax, radius, abschneiden }
  // Gezeichnet wird in Streifen von "zeilen" Zeilen, nach jedem Streifen bekommt der Browser Luft
  // (sonst hält das Betriebssystem die Grafikkarte nach ~2 s für abgestürzt).
  // Rückgabe: Float32Array mit 4 Werten pro Pixel (Disparität, beste, zweitbeste Kosten, 1)
  async function rechneDisparitaet(e, beiFortschritt) {
    if (!mitFloat) throw new Error("Dein Browser kann nicht in Float-Texturen zeichnen (EXT_color_buffer_float).");
    const { w, h } = groesse;
    const ziel = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, ziel);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ziel, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(match.p);
    const o = match.ort;
    binde(match, 0, "referenz", grau[e.referenz]);
    binde(match, 1, "anderes", grau[e.anderes]);
    binde(match, 2, "drittes", grau[e.drittes ?? e.anderes]);
    gl.uniform1i(o.richtung, e.richtung);
    gl.uniform1i(o.mitDrittem, e.drittes ? 1 : 0);
    gl.uniform1i(o.dMin, e.dMin);
    gl.uniform1i(o.dMax, e.dMax);
    gl.uniform1i(o.radius, e.radius);
    gl.uniform1f(o.abschneiden, e.abschneiden);
    gl.uniform1i(o.besseresPaar, e.besseresPaar ? 1 : 0);
    // so viele Zeilen pro Streifen, dass jeder etwa gleich viel Arbeit ist
    const arbeitProZeile = w * (e.dMax - e.dMin + 1) * (2 * e.radius + 1) ** 2 * (e.drittes ? 2 : 1);
    const zeilen = Math.max(1, Math.min(h, Math.floor(3e8 / arbeitProZeile)));
    gl.enable(gl.SCISSOR_TEST);
    for (let y = 0; y < h; y += zeilen) {
      gl.scissor(0, y, w, Math.min(zeilen, h - y));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // warten, bis die Grafikkarte fertig ist, ohne den Browser zu blockieren
      const zaun = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      while (gl.clientWaitSync(zaun, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 4));
      gl.deleteSync(zaun);
      beiFortschritt?.(Math.min(1, (y + zeilen) / h));
    }
    gl.disable(gl.SCISSOR_TEST);
    const daten = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, daten);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(ziel);
    return daten;
  }

  function zeichneAufs(b, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (canvas.width !== b || canvas.height !== h) {
      canvas.width = b;
      canvas.height = h;
    }
    gl.viewport(0, 0, b, h);
  }

  // e: { modus, fokus, staerke, mischung, nebelFarbe: [r, g, b] }
  function zeigeAnsicht(e, b, h) {
    zeichneAufs(b, h);
    gl.useProgram(ansicht.p);
    const o = ansicht.ort;
    binde(ansicht, 0, "links", farbe.links);
    binde(ansicht, 1, "rechts", farbe.rechts);
    binde(ansicht, 2, "tiefe", tiefe);
    binde(ansicht, 3, "verlauf", verlauf);
    binde(ansicht, 4, "extra", farbe.extra);
    gl.uniform1i(o.modus, e.modus);
    gl.uniform1f(o.fokus, e.fokus ?? 0.5);
    gl.uniform1f(o.staerke, e.staerke ?? 1);
    gl.uniform1f(o.mischung, e.mischung ?? 1);
    gl.uniform3fv(o.nebelFarbe, e.nebelFarbe ?? [0.8, 0.82, 0.85]);
    gl.uniform2f(o.aufloesung, b, h);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // e: { vp, schritt, brennweite, relief, tiefenFaktor, groesse, hintergrund: [r, g, b] }
  function zeigeWolke(e, b, h) {
    zeichneAufs(b, h);
    gl.clearColor(...(e.hintergrund ?? [0.05, 0.05, 0.05]), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); // nahe Punkte verdecken ferne
    gl.useProgram(wolke.p);
    const o = wolke.ort;
    binde(wolke, 0, "links", farbe.links);
    binde(wolke, 1, "tiefe", tiefe);
    gl.uniformMatrix4fv(o.vp, false, e.vp);
    gl.uniform1i(o.schritt, e.schritt);
    gl.uniform1f(o.brennweite, e.brennweite);
    gl.uniform1f(o.relief, e.relief);
    gl.uniform1f(o.tiefenFaktor, e.tiefenFaktor);
    gl.uniform1f(o.groesse, e.groesse);
    gl.uniform1f(o.bildschirmHoehe, h);
    const anzahl = Math.ceil(groesse.w / e.schritt) * Math.ceil(groesse.h / e.schritt);
    gl.drawArrays(gl.POINTS, 0, anzahl);
    gl.disable(gl.DEPTH_TEST);
  }

  return { gl, mitFloat, ladeFarbe, ladeGrau, ladeTiefe, setzeVerlauf, rechneDisparitaet, zeigeAnsicht, zeigeWolke, groesse: () => groesse };
}
