// Anzeige: das Video (oder was der Strich sieht) aufs Canvas, der Strich kommt darüber (js/kopf.js)
//   bereich: welcher Teil des Videos das ganze Feld füllt (Lupe; sonst das ganze Bild)
//   fenster: außerhalb davon abgedunkelt (dort klingt nichts)

export const ANZEIGE_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D video;      // das Video, y = 0 unten (gpu.js dreht es beim Hochladen um)
uniform sampler2D bearbeitet; // was der Strich sieht (vorbereitung-shader.js)
uniform bool zeigeBearbeitet;
uniform vec2 aufloesung;      // Canvas in Gerätepixeln
uniform vec4 bereich;         // (links, unten, rechts, oben) in uv
uniform vec4 fenster;

out vec4 farbe;

void main() {
  vec2 uv = mix(bereich.xy, bereich.zw, gl_FragCoord.xy / aufloesung);
  vec3 f = zeigeBearbeitet ? vec3(texture(bearbeitet, uv).r) : texture(video, uv).rgb;
  bool drin = all(greaterThanEqual(uv, fenster.xy)) && all(lessThanEqual(uv, fenster.zw));
  farbe = vec4(drin ? f : f * 0.3, 1.0);
}`;
