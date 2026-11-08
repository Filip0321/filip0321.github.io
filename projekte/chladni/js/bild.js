// Zeichnen auf der Grafikkarte:
//   feld()    die Auslenkung |u| auf einem Gitter G × G in eine Float-Textur und zurück zur CPU (für den Sand)
//   zeige()   die Platte (wahlweise mit der Schwingung als Farbe) und darüber jedes Sandkorn als Punkt
// Die Summe der Moden rechnet der Shader für jedes Pixel selbst: höchstens 32 Moden, das ist wenig Arbeit.

import { MAX_MODEN } from "./platte.js";

const VOLL = `#version 300 es
in vec2 lage;
out vec2 uv;
void main() {
  uv = lage * 0.5 + 0.5;
  gl_Position = vec4(lage, 0.0, 1.0);
}`;

// |u| an einer Stelle: Σ (re + i im) · φ, Betrag der komplexen Summe
const SUMME = `
uniform vec4 moden[${MAX_MODEN}]; // n, m, re, im
uniform int anzahl;
uniform float frei;               // 1: cos (freier Rand), 0: sin (gestützt)
const float PI = 3.14159265;
float auslenkung(vec2 p) {
  vec2 u = vec2(0.0);
  for (int i = 0; i < ${MAX_MODEN}; i++) {
    if (i >= anzahl) break;
    vec4 m = moden[i];
    float phi = frei > 0.5 ? cos(m.x * PI * p.x) * cos(m.y * PI * p.y) : sin(m.x * PI * p.x) * sin(m.y * PI * p.y);
    u += m.zw * phi;
  }
  return length(u);
}`;

const FELD = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
${SUMME}
void main() {
  // readPixels liefert Zeile 0 zuerst, und die ist unten (uv.y klein). Der Sand rechnet mit y nach unten, also
  // gehört Zeile 0 zu y = 0: hier nicht umdrehen, dann passt die Reihenfolge von selbst
  farbe = vec4(auslenkung(uv), 0.0, 0.0, 1.0);
}`;

const PLATTE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
${SUMME}
uniform vec3 grund;       // Farbe der Platte
uniform vec3 schwingung;  // Farbe der Schwingung
uniform float zeigen;     // 0 bis 1: wie stark die Schwingung zu sehen ist
void main() {
  float a = clamp(auslenkung(vec2(uv.x, 1.0 - uv.y)), 0.0, 1.5) / 1.5;
  farbe = vec4(mix(grund, schwingung, a * zeigen), 1.0);
}`;

const PUNKT_V = `#version 300 es
in vec2 punkt;
uniform float groesse;
void main() {
  gl_Position = vec4(punkt.x * 2.0 - 1.0, 1.0 - punkt.y * 2.0, 0.0, 1.0);
  gl_PointSize = groesse;
}`;
const PUNKT_F = `#version 300 es
precision highp float;
out vec4 farbe;
uniform vec4 sand;
void main() {
  // runde Körner mit weichem Rand
  float r = length(gl_PointCoord - 0.5) * 2.0;
  farbe = vec4(sand.rgb, sand.a * (1.0 - smoothstep(0.6, 1.0, r)));
}`;

export function erstelleBild(canvas, G) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Diese Grafikkarte kann in keine Float-Textur rechnen.");

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
    gl.bindAttribLocation(p, 1, "punkt");
    gl.linkProgram(p);
    const orte = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace("[0]", "");
      orte[name] = gl.getUniformLocation(p, name);
    }
    return { p, orte };
  }
  const feldP = programm(VOLL, FELD);
  const platteP = programm(VOLL, PLATTE);
  const punktP = programm(PUNKT_V, PUNKT_F);

  const viereck = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, viereck);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const punkte = gl.createBuffer();

  // Ziel für das Feld
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, G, G, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const roh = new Float32Array(G * G * 4);
  const feldWerte = new Float32Array(G * G);

  function moden(o, k, frei) {
    gl.uniform4fv(o.moden, k.daten);
    gl.uniform1i(o.anzahl, k.anzahl);
    gl.uniform1f(o.frei, frei ? 1 : 0);
  }
  function viereckZeichnen() {
    gl.bindBuffer(gl.ARRAY_BUFFER, viereck);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(0);
  }

  // k: von koeffizienten(); gibt Float32Array G × G (Zeile 0 oben)
  function feld(k, frei) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, G, G);
    gl.useProgram(feldP.p);
    moden(feldP.orte, k, frei);
    gl.disable(gl.BLEND);
    viereckZeichnen();
    gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, roh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Zeile 0 ist y = 0 (siehe FELD)
    for (let i = 0; i < G * G; i++) feldWerte[i] = roh[i * 4];
    return feldWerte;
  }

  // a: { k, frei, grund [r,g,b] 0–1, schwingung, zeigen, sand [r,g,b,a], groesse, lage (Float32Array), anzahl }
  function zeige(a) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(platteP.p);
    moden(platteP.orte, a.k, a.frei);
    gl.uniform3fv(platteP.orte.grund, a.grund);
    gl.uniform3fv(platteP.orte.schwingung, a.schwingung);
    gl.uniform1f(platteP.orte.zeigen, a.zeigen);
    viereckZeichnen();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(punktP.p);
    gl.uniform1f(punktP.orte.groesse, a.groesse);
    gl.uniform4fv(punktP.orte.sand, a.sand);
    gl.bindBuffer(gl.ARRAY_BUFFER, punkte);
    gl.bufferData(gl.ARRAY_BUFFER, a.lage, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, a.anzahl);
    gl.disableVertexAttribArray(1);
    gl.disable(gl.BLEND);
  }

  return { feld, zeige };
}
