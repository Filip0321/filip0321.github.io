// Hilfen für die Effekte der Sammlung (sammlung.js): der gemeinsame Shader-Kopf mit kleinen Bausteinen,
// das Übersetzen beim ersten Gebrauch, Canvas und kleine Farbtexturen.

import { gl, baueProgramm, VERTEX_SHADER } from "../webgl.js";

// was jeder Shader der Sammlung oben stehen hat
const KOPF = /* glsl */ `#version 300 es
precision highp float;
in vec2 uv;               // 0 bis 1, (0, 0) unten links
out vec4 farbe;
uniform sampler2D bild;   // das Bild davor (Platz 0, rendere in webgl.js)
uniform vec2 aufloesung;  // Breite und Höhe in Pixeln
uniform float zeit;       // Sekunden

${BAUSTEINE()}
`;

// kleine Bausteine, die viele Effekte brauchen
function BAUSTEINE() {
  return /* glsl */ `
// Helligkeit, wie das Auge sie empfindet (Rec. 709: Grün zählt am meisten)
float hell(vec3 f) { return dot(f, vec3(0.2126, 0.7152, 0.0722)); }

// Pseudozufall aus einer Stelle: dieselbe Stelle gibt immer dieselbe Zahl (0 bis 1)
float zufall(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Bayer-Matrix 8 × 8 als Schwellen (0 bis 1), rekursiv aus der 2 × 2-Matrix [0 2; 3 1] / 4
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// ein Pixel weiter (in Bildpunkten), für Nachbarn
vec3 bei(vec2 p, vec2 pixel) { return texture(bild, p + pixel / aufloesung).rgb; }

// Sobel: Helligkeitsgefälle (x, y) an der Stelle p, d = Abstand der Nachbarn in Pixeln
vec2 sobel(vec2 p, float d) {
  float a = hell(bei(p, vec2(-d,  d))), b = hell(bei(p, vec2(0.0,  d))), c = hell(bei(p, vec2(d,  d)));
  float e = hell(bei(p, vec2(-d, 0.0)));                                 float f = hell(bei(p, vec2(d, 0.0)));
  float g = hell(bei(p, vec2(-d, -d))), h = hell(bei(p, vec2(0.0, -d))), i = hell(bei(p, vec2(d, -d)));
  return vec2((c + 2.0 * f + i) - (a + 2.0 * e + g), (a + 2.0 * b + c) - (g + 2.0 * h + i));
}

// Farbton drehen (Winkel in Bogenmaß), um die Graue Achse
vec3 farbtonDrehen(vec3 f, float w) {
  const vec3 k = vec3(0.57735);
  float c = cos(w);
  return f * c + cross(k, f) * sin(w) + k * dot(k, f) * (1.0 - c);
}
`;
}

// das Programm erst beim ersten Gebrauch übersetzen (sonst kostet jeder Seitenaufruf alle Shader)
export function programmVon(effekt) {
  if (!gl || !effekt.shader) return null;
  effekt.programm ??= baueProgramm(VERTEX_SHADER, KOPF + effekt.shader);
  return effekt.programm;
}

// Hilfen für die Canvas-Effekte (linien.js, Camcorder)
export function leinwand(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d", { willReadFrequently: true }) };
}

// eine kleine Textur aus Farben [[r, g, b] 0–255, …] (Paletten, Druckfarben), n × 1 Pixel
export function farbTextur(farben) {
  if (!gl) return null;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const daten = new Uint8Array(farben.length * 4);
  farben.forEach((f, i) => daten.set([f[0], f[1], f[2], 255], i * 4));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, farben.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, daten);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
