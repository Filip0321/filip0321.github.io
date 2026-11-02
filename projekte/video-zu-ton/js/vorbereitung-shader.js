// Vorbearbeitung: was der Strich zu sehen bekommt. Zwei Durchgänge pro Videobild:
//
//   HELL_SHADER        Video -> Helligkeit, weichgezeichnet (eine Zahl pro Pixel, im Rotkanal)
//   BEARBEIT_SHADER    Helligkeit jetzt und vom vorigen Bild -> was klingen soll:
//     hell       einfach die Helligkeit (wie im Grundgerüst)
//     kanten     nur Umrisse (Sobel): Flächen werden still, Linien klingen
//     bewegung   nur was sich seit dem letzten Bild geändert hat: ein stehendes Bild ist still
//     beides     Kanten, die sich bewegen
//   danach: invertieren, und unter der Schwelle wird es 0 (echte Stille statt leises Rauschen)
//
// Warum zwei Durchgänge? Sobel braucht für jedes Pixel die weichen Werte seiner 8 Nachbarn.
// In einem Durchgang müsste jedes Pixel 9 · 9 Mal ins Video greifen; so sind es 9 + 9.

import { KANTEN_GLSL } from "/lib/kanten.js";

export const HELL_SHADER = /* glsl */ `#version 300 es
precision highp float;
${KANTEN_GLSL}
uniform sampler2D video;
uniform vec2 aufloesung; // Arbeitsgröße in Pixeln
uniform float radius;    // Weichzeichnen: Abstand zu den Nachbarn in Pixeln (0 = aus)
uniform int drehung;     // in Vierteln, im Uhrzeigersinn

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
  vec2 uv = gl_FragCoord.xy / aufloesung;
  float h;
  if (radius > 0.0) {
    // erst ein Durchgang nur für Helligkeit wäre genauer; Farbe weichzeichnen und dann umrechnen
    // ist dasselbe (beides ist linear), spart aber einen Durchgang
    vec2 schritt = radius / aufloesung;
    vec3 summe = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        float gewicht = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
        summe += gewicht * texture(video, gedreht(uv + vec2(x, y) * schritt, drehung)).rgb;
      }
    }
    h = helligkeit(summe / 16.0);
  } else {
    h = helligkeit(texture(video, gedreht(uv, drehung)).rgb);
  }
  farbe = vec4(h, 0.0, 0.0, 1.0);
}`;

export const BEARBEIT_SHADER = /* glsl */ `#version 300 es
precision highp float;
${KANTEN_GLSL}
uniform sampler2D jetzt;  // Helligkeit dieses Bildes (HELL_SHADER)
uniform sampler2D vorher; // … und des vorigen
uniform vec2 aufloesung;
uniform int modus;        // 0 hell, 1 kanten, 2 bewegung, 3 beides
uniform float verstaerkung;
uniform float schwelle;
uniform bool invertieren;

out vec4 farbe;

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  vec2 schritt = 1.0 / aufloesung;
  float h = texture(jetzt, uv).r;
  float wert = h;
  if (modus == 1) {
    wert = sobel(jetzt, uv, schritt) * verstaerkung;
  } else if (modus == 2) {
    wert = abs(h - texture(vorher, uv).r) * verstaerkung;
  } else if (modus == 3) {
    float bewegung = abs(h - texture(vorher, uv).r) * verstaerkung;
    wert = sobel(jetzt, uv, schritt) * verstaerkung * clamp(bewegung * 4.0, 0.0, 1.0);
  }
  wert = clamp(wert, 0.0, 1.0);
  if (invertieren) wert = 1.0 - wert;
  if (wert < schwelle) wert = 0.0;
  farbe = vec4(wert, wert, wert, 1.0);
}`;
