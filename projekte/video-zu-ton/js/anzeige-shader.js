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
uniform int drehung;           // in Vierteln (vorbereitung-shader.js); bearbeitet ist schon gedreht

// Drehung in Vierteln (im Uhrzeigersinn): Handyvideos liegen oft quer in der Datei, und ob der Browser
// die Drehung aus den Metadaten beim Hochladen anwendet, ist nicht überall gleich. Darum von Hand.
// uv im gedrehten Bild -> uv im Video
vec2 gedreht(vec2 uv, int d) {
  if (d == 1) return vec2(1.0 - uv.y, uv.x);
  if (d == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
  if (d == 3) return vec2(uv.y, 1.0 - uv.x);
  return uv;
}

out vec4 farbe;

void main() {
  vec2 uv = mix(bereich.xy, bereich.zw, gl_FragCoord.xy / aufloesung);
  vec3 f = zeigeBearbeitet ? vec3(texture(bearbeitet, uv).r) : texture(video, gedreht(uv, drehung)).rgb;
  bool drin = all(greaterThanEqual(uv, fenster.xy)) && all(lessThanEqual(uv, fenster.zw));
  farbe = vec4(drin ? f : f * 0.3, 1.0);
}`;
