// VHS-Shader

// VERTEX_SHADER in crt.js

// auf einer VHS kasette bekam Helligkeit viel mehr Platz als die Farben selber

const VHS_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 uv;
out vec4 farbe;

uniform sampler2D bild;
uniform vec2 aufloesung;
uniform float zeit;

// Band
uniform float wackeln;
uniform float tracking;
uniform float trackingHoehe;
uniform float trackingTempo;
uniform float trackingPosition;
uniform float band;
uniform float kopfHoehe;
uniform float kopfStaerke;
uniform float kopfRauschen;

// Signal (Helligkeit)
uniform float weich;
uniform float schaerfe;
uniform float schaerfeBreite;
uniform float geistAbstand;
uniform float geistStaerke;
uniform float schwarzwert;
uniform float hellRauschen;

// Farbe
uniform float bluten;
uniform float farbVerzoegerung;
uniform float saettigung;
uniform float regenbogen;
uniform float regenbogenFeinheit;
uniform float farbRauschen;
uniform float farbstich;
uniform float farbstichWinkel;

float zufall1(float n) {
  return fract(sin(n) * 43758.5453);
}

float zufall2(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
// wie beim CRT-SHADER

vec3 zuYiq(vec3 c) {
  return vec3(
    0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
    0.596 * c.r - 0.274 * c.g - 0.322 * c.b,
    0.211 * c.r - 0.523 * c.g + 0.312 * c.b
  );
} 
// das ist die umwandlung von rgb zu yiq (amerikanischer Fernseher Farbraum)
// Y ist für Helligkeit
// I ist Achse mit Farbe von Orange nach Blau
// Q ist Achse mit Farbe von Lila nach Grün

vec3 zuRgb(vec3 yiq) {
  return vec3(
    yiq.x + 0.956 * yiq.y + 0.621 * yiq.z,
    yiq.x - 0.272 * yiq.y - 0.647 * yiq.z,
    yiq.x - 1.106 * yiq.y + 1.703 * yiq.z
  );
}
// Die werte kann man hier finden:
// https://www.geeksforgeeks.org/computer-graphics/yiq-color-model-in-computer-graphics/

// Helligkeit an einer Stelle, waagerecht weichgezeichnet (Gewichte 1-2-1)
float helligkeit(vec2 q) {
  vec2 schritt = vec2(weich / aufloesung.x, 0.0);
  vec3 gewicht = vec3(0.299, 0.587, 0.114);
  return (dot(texture(bild, q - schritt).rgb, gewicht)
        + dot(texture(bild, q).rgb, gewicht) * 2.0
        + dot(texture(bild, q + schritt).rgb, gewicht)) * 0.25;
}

void main() {
  vec2 p = uv;
  vec2 pixel = vec2(1.0 / aufloesung.x, 0.0);  // ein Pixel nach rechts, in uv
  float zeile = floor(p.y * aufloesung.y);
  float bild30 = floor(zeit * 30.0);


  // Band: von wo wird gelesen?

  // Wackeln: langsame Welle plus Zittern pro Zeile
  float welle = sin(p.y * 40.0 + zeit * 3.0) * 0.5 + (zufall1(zeile + bild30) - 0.5);
  p.x += welle * wackeln / aufloesung.x;

  // Kopfumschaltung: unten wackelt es stärker
  float unten = 1.0 - smoothstep(0.0, max(kopfHoehe, 0.001), p.y);
  p.x += unten * (zufall1(zeile * 1.7 + bild30) - 0.5) * wackeln * kopfStaerke / aufloesung.x;

  // Tracking-Band: ein wandernder Streifen mit weit verschobenen Zeilen
  float mitte = fract(trackingPosition + zeit * trackingTempo);
  float abstandBand = abs(fract(p.y - mitte + 0.5) - 0.5);
  float imBand = 1.0 - smoothstep(0.0, max(trackingHoehe, 0.001), abstandBand);
  float riss = zufall1(floor(zeile / 3.0) * 0.71 + bild30);
  p.x += imBand * riss * tracking / aufloesung.x;


  // Signal: Helligkeit 

  float roh = helligkeit(p);
  float hell = roh;

  // Nachschärfen: Unterschied zur Umgebung verstärken
  float umgebung = (helligkeit(p - schaerfeBreite * pixel)
                  + helligkeit(p + schaerfeBreite * pixel)) * 0.5;
  hell += (roh - umgebung) * schaerfe;

  // Geisterbild: verspätete Kopie
  hell += helligkeit(p - geistAbstand * pixel) * geistStaerke;

  // Rauschen in der Helligkeit
  hell += (zufall2(gl_FragCoord.xy + zeit + 5.0) - 0.5) * hellRauschen;

  // Schwarzwert: 0 wird zu schwarzwert, 1 bleibt 1
  hell = schwarzwert + hell * (1.0 - schwarzwert);


  // Farbe

  // verschmiert und gegenüber der Helligkeit verzögert
  vec2 farbanteil = vec2(0.0);
  for (int i = -4; i <= 4; i++) {
    float versatz = float(i) * bluten / 4.0 - farbVerzoegerung;
    farbanteil += zuYiq(texture(bild, p + versatz * pixel).rgb).yz;
  }
  farbanteil /= 9.0;

  // Regenbogen: feine Helligkeitsdetails werden als Farbe missverstanden
  float fein = roh - (helligkeit(p - pixel) + helligkeit(p + pixel)) * 0.5;
  float phase = gl_FragCoord.x * regenbogenFeinheit + (zeile + bild30) * 3.14159;
  farbanteil += fein * regenbogen * vec2(cos(phase), sin(phase));

  // Farbrauschen in 4 Pixel breiten Flecken
  vec2 fleck = vec2(floor(gl_FragCoord.x / 4.0), gl_FragCoord.y);
  farbanteil += (vec2(zufall2(fleck + zeit + 3.1), zufall2(fleck + zeit + 7.3)) - 0.5) * farbRauschen;

  farbanteil *= saettigung;

  // Farbstich: alles in eine Richtung im I-Q-Farbraum schieben
  float winkel = radians(farbstichWinkel);
  farbanteil += farbstich * vec2(cos(winkel), sin(winkel));

  vec3 c = zuRgb(vec3(hell, farbanteil));

  // Störungen obendrauf

  // Störstreifen: abgeriebene Stellen auf dem Band
  if (zufall1(zeile * 0.37 + bild30) > 1.0 - band * 0.02) {
    c += vec3(zufall2(gl_FragCoord.xy + zeit) * 0.6);
  }

  // buntes Rauschen im Kopfumschalt-Bereich
  vec3 bunt = vec3(
    zufall2(gl_FragCoord.xy + zeit + 1.0),
    zufall2(gl_FragCoord.xy + zeit + 2.0),
    zufall2(gl_FragCoord.xy + zeit + 3.0)
  );
  c = mix(c, bunt, unten * kopfRauschen);

  farbe = vec4(c, 1.0);
}`;


// WebGL-Programm (rendere und zurueckholen in crt.js)

const vhsProgramm = gl ? baueProgramm(VERTEX_SHADER, VHS_SHADER) : null;
