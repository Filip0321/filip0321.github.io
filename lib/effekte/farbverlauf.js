import { gl, baueProgramm, VERTEX_SHADER } from "../webgl.js";
import { ladeVerlauf } from "../verlauf.js";
import { farbtabelle } from "../farben.js";

// Farbverlauf (Gradient Map): jeder Pixel sucht sich nach seiner Helligkeit eine Farbe im Verlauf.
// Dunkel = Anfang des Verlaufs, hell = Ende. Dieselbe Farbtabelle wie bei Spektrogramm, Bild zu Ton
// und den Attraktoren (farben.js), auf der Grafikkarte als Textur 256 × 1 (verlauf.js).

const FARBVERLAUF_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 uv;
out vec4 farbe;

uniform sampler2D bild; // das Bild davor (Platz 0, setzt rendere in webgl.js)
uniform sampler2D verlauf; // der Verlauf als Textur 256 × 1 (Platz 1)
uniform float mischung; // 0 = Original, 1 = ganz im Verlauf
uniform float gamma;

void main() {
  vec4 original = texture(bild, uv);

  float hell = dot(original.rgb, vec3(0.2126, 0.7152, 0.0722));
  hell = pow(clamp(hell, 0.0, 1.0), gamma);

  vec3 neu = texture(verlauf, vec2(hell, 0.5)).rgb;
  vec3 rgb = mix(original.rgb, neu, clamp(mischung, 0.0, 1.0));

  farbe = vec4(rgb, original.a);
}`;


export const farbverlaufProgramm = gl ? baueProgramm(VERTEX_SHADER, FARBVERLAUF_SHADER) : null;

// Regler (wie VHS_REGLER und CRT_REGLER, gebaut von /lib/effekt-regler.js)
export const FARBVERLAUF_REGLER = [
  {
    gruppe: "Einstellungen",
    regler: [
      { name: "mischung", text: "Mischung", min: 0, max: 1, schritt: 0.01, wert: 1 },
      { name: "gamma", text: "Gamma", min: 0.2, max: 3, schritt: 0.05, wert: 1 },
    ],
  },
];

// Die Textur für den Verlauf: einmal anlegen, bei jeder Änderung neu füllen
export const farbverlaufTextur = gl ? gl.createTexture() : null;

// anker: Liste von Farben [[r, g, b], …], z. B. skalaAnker("glut") oder [hexZuRgb(anfang), hexZuRgb(ende)]
export function setzeFarbverlauf(anker) {
  if (gl) ladeVerlauf(gl, farbtabelle(anker), farbverlaufTextur);
}
