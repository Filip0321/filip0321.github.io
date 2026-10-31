import { gl, baueProgramm, VERTEX_SHADER } from "../webgl.js";

const CRT_SHADER = /* glsl */ `#version 300 es
precision highp float;
// für Genauigkeit bei Kommazahlen (gibt es bei shadern nicht standard)

in vec2 uv;
// vec2 kommt aus dem VERTEX_SHADER, vec4 geht aus dem FRAGMENT_SHADER
out vec4 farbe;

uniform sampler2D bild;
uniform vec2 aufloesung;
uniform float versatzX;
uniform float versatzY;
uniform float woelbung;
uniform float scanlines;
uniform float vignette;
uniform float rauschen;
uniform float zufall;
// zufall hat die Videozeit, damit es sich immer ändert
// uniform bedeutet dass es für jeden Pixel gleich ist (uv für jeden Pixel unterschiedlich)

const float LINIEN = 300.0;

vec2 woelbe(vec2 p) {
  vec2 c = p * 2.0 - 1.0;
  // aus 0..1 wird -1..1
  vec2 gewoelbt = c;
  gewoelbt.x *= 1.0 + woelbung * c.y * c.y;
  gewoelbt.y *= 1.0 + woelbung * c.x * c.x;
  return gewoelbt * 0.5 + 0.5;
  // wieder auf 0..1
}

float zufallswert(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + zufall) * 43758.5453);
  // fract() gibt die nachkommezahl wieder
}

void main() {
  vec2 p = woelbe(uv);

  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
    farbe = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 schritt = vec2(versatzX / aufloesung.x, versatzY / aufloesung.y);
  // Pixel in uv umrechnen: x durch die Breite, y durch die Höhe
  vec3 f;
  f.r = texture(bild, p + schritt).r;
  f.g = texture(bild, p).g;
  f.b = texture(bild, p - schritt).b;
  // die Farben aus den Nachbarpixeln (um einen schritt entfernt)

  float zeile = 0.5 - 0.5 * cos(p.y * LINIEN * 6.2831853);
  f *= 1.0 - scanlines * zeile;

  vec2 c = p * 2.0 - 1.0;
  f *= clamp(1.0 - vignette * dot(c, c) * 0.5, 0.0, 1.0);

  f += (zufallswert(gl_FragCoord.xy) - 0.5) * rauschen;

  farbe = vec4(f, 1.0);
}`;
// für jeden Pixel bestimmt es die Farbe

export const crtProgramm = gl ? baueProgramm(VERTEX_SHADER, CRT_SHADER) : null;

// Regler für dieses Effekt-Programm (wie VHS_REGLER in vhs.js, gebaut von /lib/effekt-regler.js)
export const CRT_REGLER = [
  {
    gruppe: "Einstellungen",
    regler: [
      { name: "versatzX", text: "Farbversatz X", min: -20, max: 20, schritt: 1, wert: 4 },
      { name: "versatzY", text: "Farbversatz Y", min: -20, max: 20, schritt: 1, wert: 0 },
      { name: "woelbung", text: "Wölbung", min: -0.8, max: 0.3, schritt: 0.01, wert: 0.08 },
      { name: "scanlines", text: "Scanlines", min: 0, max: 1, schritt: 0.05, wert: 0.3 },
      { name: "vignette", text: "Vignette", min: 0, max: 1, schritt: 0.05, wert: 0.4 },
      { name: "rauschen", text: "Rauschen", min: 0, max: 0.3, schritt: 0.01, wert: 0.05 },
    ],
  },
];

// CRT gerade abschneiden (für den Export): welcher Anteil der Breite und Höhe bleibt, mittig,
// damit nichts von den schwarzen, gewölbten Rändern übrig ist? null, wenn es nichts abzuschneiden gibt.
// Die Wölbung in woelbe() (Mitte 0, Rand ±1): x' = x · (1 + w · y²), y' = y · (1 + w · x²).
// Schwarz wird es, wo x' oder y' über 1 kommt; am knappsten ist es an den Ecken (s, s):
// die Ecke liegt gerade noch im Bild, wenn s · (1 + w · s²) = 1. Das lösen wir mit Newton
// (s so lange verbessern, bis es passt). w ≤ 0 wölbt nach innen, dort gibt es keine schwarzen Ränder.
export function crtAnteil(w) {
  if (!(w > 0)) return null;
  let s = 1;
  for (let i = 0; i < 20; i++) s -= (w * s ** 3 + s - 1) / (3 * w * s * s + 1); // f / f'
  return s;
}
