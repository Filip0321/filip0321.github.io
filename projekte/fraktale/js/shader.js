// Die Shader der Fraktale. Theorie im LIESMICH.

export const VOLLBILD = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------- 2D ----------
// Für jeden Pixel eine Zahl c in der komplexen Ebene, dann z ← z² + c immer wieder. Bleibt |z| klein,
// gehört c zur Menge (schwarz); sonst zählt, wie schnell z entkommt. Die „glatte“ Zahl
// n + 1 − log2(log|z|) verhindert Farbstufen: sie misst, wie weit z beim Entkommen schon über der Grenze war.
//   Julia:         c ist für alle Pixel gleich, der Pixel ist der Start z
//   Burning Ship:  vor dem Quadrieren |Re| und |Im| (die Spiegelung macht das „Schiff“)
//   Tricorn:       konjugiert quadrieren (z̄²): dreizackig
export const ZWEI_D = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 aufloesung;
uniform vec2 mitte;      // Mitte der Ansicht in der komplexen Ebene
uniform float massstab;  // Bildhöhe in der komplexen Ebene
uniform int art;         // 0 Mandelbrot, 1 Julia, 2 Burning Ship, 3 Tricorn
uniform vec2 julia;
uniform int schritte;
uniform float farbdichte, farbversatz;
uniform sampler2D verlauf;
out vec4 farbe;
void main() {
  vec2 p = mitte + (gl_FragCoord.xy - 0.5 * aufloesung) / aufloesung.y * massstab;
  vec2 z = art == 1 ? p : vec2(0.0);
  vec2 c = art == 1 ? julia : p;
  float n = 0.0;
  bool raus = false;
  for (int i = 0; i < 4000; i++) {
    if (i >= schritte) break;
    if (art == 2) z = abs(z);
    if (art == 3) z.y = -z.y;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) { raus = true; break; }
    n += 1.0;
  }
  if (!raus) { farbe = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float glatt = n + 1.0 - log2(log(length(z)));
  float t = fract(glatt * farbdichte * 0.02 + farbversatz);
  // Verlauf hin und zurück, damit es beim Umlauf keine harte Kante gibt
  farbe = vec4(texture(verlauf, vec2(1.0 - abs(2.0 * t - 1.0), 0.5)).rgb, 1.0);
}`;

// ---------- 3D ----------
// Raymarching mit Abstandsfunktionen: Für jeden Punkt p sagt de(p), wie weit die nächste Oberfläche
// mindestens entfernt ist. So weit darf der Strahl gefahrlos springen („Sphere Tracing“). Für Fraktale gibt
// es solche Abschätzungen:
//   Mandelbulb:  z ← z^n + c in Kugelkoordinaten (Radius hoch n, Winkel mal n), Abstand 0,5·log r·r/dr
//   Menger:      ein Würfel, aus dem immer wieder Kreuze herausgeschnitten werden; mit mod() unendlich
//                oft wiederholt: ein Gang, der nie aufhört
//   Apollonisch: Raum falten (fract) und an einer Kugel spiegeln (Inversion p/|p|²), immer wieder;
//                Kugeln in Kugeln in Kugeln, ebenfalls endlos
export const DREI_D = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 aufloesung;
uniform mat4 zurueck;
uniform vec3 auge;
uniform int welt;          // 0 Mandelbulb, 1 Menger, 2 Apollonisch
uniform float potenz;      // Mandelbulb
uniform float form;        // Apollonisch: Größe der Spiegelkugel
uniform vec3 lampeOrt, lampeRichtung;
uniform float kegel, lampeStaerke, umgebung, nebel, zeit;
uniform int lichtArt;       // 0 nur Taschenlampe, 1 überall hell (Sonne und Himmel), 2 beides
uniform int mitSchatten;
uniform float genauigkeit;  // wie nah ein Treffer sein muss (relativ zur Entfernung); klein = schärfer
uniform int maxSchritte;
uniform vec3 lampeFarbe, grundFarbe;
uniform sampler2D verlauf;
out vec4 farbe;

float spur; // wie sich die Punkte im Fraktal verhalten (für die Farbe)

float mandelbulb(vec3 p) {
  vec3 z = p;
  float dr = 1.0, r = 0.0;
  spur = 1e9;
  for (int i = 0; i < 12; i++) {
    r = length(z);
    if (r > 2.0) break;
    spur = min(spur, r);
    float theta = acos(clamp(z.z / r, -1.0, 1.0)) * potenz;
    float phi = atan(z.y, z.x) * potenz;
    dr = pow(r, potenz - 1.0) * potenz * dr + 1.0;
    z = pow(r, potenz) * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + p;
  }
  return 0.5 * log(r) * r / dr;
}

float menger(vec3 p) {
  float d = -1e9; // unendlich voll: es wird nur herausgeschnitten
  float s = 1.0;
  spur = 0.0;
  for (int m = 0; m < 5; m++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s;
    if (c > d) { d = c; spur = float(m) / 5.0; }
  }
  return d;
}

float apollonisch(vec3 p) {
  float s = 1.0;
  spur = 1e9;
  for (int i = 0; i < 8; i++) {
    p = -1.0 + 2.0 * fract(0.5 * p + 0.5); // falten: jede Zelle ist dieselbe
    float r2 = dot(p, p);
    spur = min(spur, r2);
    float k = form / r2;                    // an der Kugel spiegeln
    p *= k;
    s *= k;
  }
  return 0.25 * abs(p.y) / s;
}

float de(vec3 p) {
  if (welt == 0) return mandelbulb(p);
  if (welt == 1) return menger(p);
  return apollonisch(p);
}

vec3 normale(vec3 p, float e) {
  vec2 h = vec2(e, 0.0);
  return normalize(vec3(de(p + h.xyy) - de(p - h.xyy), de(p + h.yxy) - de(p - h.yxy), de(p + h.yyx) - de(p - h.yyx)));
}

// weicher Schatten (Inigo Quilez): vom Punkt zum Licht marschieren; kommt der Strahl einer Oberfläche
// nahe (h klein im Verhältnis zur Strecke t), liegt der Punkt im Halbschatten
float schatten(vec3 p, vec3 l, float bis) {
  float merk = spur;
  float hell = 1.0;
  float t = 0.003;
  for (int i = 0; i < 80; i++) {
    float h = de(p + l * t);
    if (h < 0.0001) { hell = 0.0; break; }
    hell = min(hell, 10.0 * h / t);
    t += clamp(h, 0.001, 0.2);
    if (t > bis) break;
  }
  spur = merk;
  return clamp(hell, 0.0, 1.0);
}

void main() {
  vec2 ndc = gl_FragCoord.xy / aufloesung * 2.0 - 1.0;
  vec4 fern = zurueck * vec4(ndc, 1.0, 1.0);
  vec3 r = normalize(fern.xyz / fern.w - auge);
  float t = 0.0;
  int schritte = 0;
  bool treffer = false;
  for (int i = 0; i < 1000; i++) {
    if (i >= maxSchritte) break;
    float d = de(auge + r * t);
    // die Genauigkeit wächst mit der Entfernung: weit weg genügt grob (sonst rauscht es)
    if (d < genauigkeit * t + 0.00002) { treffer = true; break; }
    t += d * 0.9;
    schritte = i;
    if (t > 40.0) break;
  }
  vec3 f = vec3(0.0);
  if (treffer) {
    vec3 p = auge + r * t;
    float s = spur;
    vec3 n = normale(p, max(0.00005, genauigkeit * t));
    // Umgebungsverdeckung, billig: viele Schritte = enge Spalten = dunkel
    float ao = 1.0 - float(schritte) / float(maxSchritte);
    vec3 grund = mix(grundFarbe, texture(verlauf, vec2(clamp(s, 0.0, 1.0), 0.5)).rgb, 0.7);
    // Taschenlampe: ein Kegel. Hell nur, was im Kegel liegt, mit Abfall 1/Abstand² und weichem Rand
    vec3 zurLampe = lampeOrt - p;
    float abstand = length(zurLampe);
    vec3 l = zurLampe / abstand;
    float imKegel = smoothstep(cos(kegel), cos(kegel * 0.6), dot(-l, lampeRichtung));
    float licht = imKegel * max(dot(n, l), 0.0) * lampeStaerke / (1.0 + abstand * abstand * 4.0);
    if (lichtArt == 1) { licht = 0.0; imKegel = 0.0; }
    if (mitSchatten == 1 && licht > 0.001) licht *= schatten(p + n * 0.0005, l, abstand);
    // ein Glanzlicht, wie bei feuchtem Stein
    float glanz = imKegel * pow(max(dot(reflect(-l, n), -r), 0.0), 24.0) * lampeStaerke * 0.3 / (1.0 + abstand * abstand * 4.0);
    f = grund * (licht * lampeFarbe + umgebung * ao) + glanz * lampeFarbe;
    if (lichtArt >= 1) {
      // überall hell: eine Sonne schräg von oben und ein Himmel, der von oben mehr Licht gibt als von unten
      vec3 sonne = normalize(vec3(0.5, 0.8, 0.35));
      float s1 = max(dot(n, sonne), 0.0);
      if (mitSchatten == 1 && s1 > 0.001) s1 *= schatten(p + n * 0.0005, sonne, 4.0);
      float himmelLicht = (0.5 + 0.5 * n.y) * ao;
      f += grund * (s1 * vec3(1.0, 0.93, 0.8) * 1.2 + himmelLicht * vec3(0.35, 0.42, 0.55));
    }
  }
  vec3 himmel = lichtArt >= 1 ? mix(vec3(0.03, 0.035, 0.05), vec3(0.22, 0.27, 0.36), 0.5 + 0.5 * r.y) : vec3(0.0);
  // Nebel: auch die Luft im Kegel leuchtet ein wenig (wie Staub im Licht)
  float luft = smoothstep(cos(kegel), cos(kegel * 0.5), dot(r, lampeRichtung)) * lampeStaerke * 0.02 * nebel;
  float dunst = 1.0 - exp(-t * nebel * 0.3);
  f = mix(f, himmel, treffer ? dunst : 1.0) + (lichtArt == 1 ? 0.0 : luft) * lampeFarbe;
  f = pow(f, vec3(1.0 / 2.2)); // Gamma: Licht rechnet linear, der Bildschirm nicht
  farbe = vec4(f, 1.0);
}`;
