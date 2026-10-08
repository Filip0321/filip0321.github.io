// ---------- VHS-Shader ----------

const VHS_SHADER = `#version 300 es
precision highp float;

in vec2 uv;
out vec4 farbe;

uniform sampler2D bild;
uniform vec2 aufloesung;
uniform float zeit;
uniform float wackeln;
uniform float bluten;
uniform float band;
uniform float saettigung;

float zufall1(float n) {
  return fract(sin(n) * 43758.5453);
}

float zufall2(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 zuYiq(vec3 c) {
  return vec3(
    0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
    0.596 * c.r - 0.274 * c.g - 0.322 * c.b,
    0.211 * c.r - 0.523 * c.g + 0.312 * c.b
  );
}

vec3 zuRgb(vec3 yiq) {
  return vec3(
    yiq.x + 0.956 * yiq.y + 0.621 * yiq.z,
    yiq.x - 0.272 * yiq.y - 0.647 * yiq.z,
    yiq.x - 1.106 * yiq.y + 1.703 * yiq.z
  );
}

void main() {
  vec2 p = uv;
  float zeile = floor(p.y * aufloesung.y);
  float bild30 = floor(zeit * 30.0);

  float welle = sin(p.y * 40.0 + zeit * 3.0) * 0.5 + (zufall1(zeile + bild30) - 0.5);
  p.x += welle * wackeln / aufloesung.x;

  float unten = 1.0 - smoothstep(0.0, 0.04, p.y);
  p.x += unten * (zufall1(zeile * 1.7 + bild30) - 0.5) * wackeln * 6.0 / aufloesung.x;

  float hell = zuYiq(texture(bild, p).rgb).x;

  vec2 farbanteil = vec2(0.0);
  for (int i = -4; i <= 4; i++) {
    vec2 q = p + vec2(float(i) * bluten / 4.0 / aufloesung.x, 0.0);
    farbanteil += zuYiq(texture(bild, q).rgb).yz;
  }
  farbanteil /= 9.0;

  vec3 c = zuRgb(vec3(hell, farbanteil * saettigung));

  if (zufall1(zeile * 0.37 + floor(zeit * 24.0)) > 1.0 - band * 0.02) {
    c += vec3(zufall2(gl_FragCoord.xy + zeit) * 0.6);
  }

  farbe = vec4(c, 1.0);
}`;

const vhsProgramm = gl ? baueProgramm(VERTEX_SHADER, VHS_SHADER) : null;

function vhs(eingabe, einstellungen) {
  rendere(vhsProgramm, eingabe, eingabe.width, eingabe.height, einstellungen);
  return zurueckholen(eingabe.width, eingabe.height);
}