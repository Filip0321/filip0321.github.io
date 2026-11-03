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
//   Multibrot:     z ← z^d + c mit beliebigem d (in Polarform: Betrag hoch d, Winkel mal d); d = 3 hat
//                  zwei Knospen-Achsen, d = 4 drei, und so weiter
//   Phoenix:       z ← z² + c + p·z_vorher: der vorige Wert spielt mit, wie ein Echo (Shigehiro Ushiki, 1988)
//   Newton:        kein „Entkommen“, sondern das Newton-Verfahren für z³ = 1: von jedem Startpunkt aus
//                  läuft z zu einer der drei Lösungen. Die Farbe sagt, zu welcher, die Helligkeit, wie
//                  schnell. Die Grenzen zwischen den drei Becken sind fraktal: an jeder Grenze stoßen
//                  immer alle drei zusammen. „Schritt“ ≠ 1 („relaxiert“) macht sie wilder.
export const ZWEI_D = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 aufloesung;
uniform vec2 mitte;      // Mitte der Ansicht in der komplexen Ebene
uniform float massstab;  // Bildhöhe in der komplexen Ebene
uniform int art;         // 0 Mandelbrot, 1 Julia, 2 Burning Ship, 3 Tricorn, 4 Multibrot, 5 Phoenix, 6 Newton
uniform vec2 julia;
uniform float hoch;      // Multibrot: Exponent d
uniform float phoenixP;  // Phoenix: wie stark der vorige Wert mitspielt
uniform float newtonSchritt;
uniform int schritte;
uniform float farbdichte, farbversatz;
uniform sampler2D verlauf;
out vec4 farbe;
vec2 mal(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 durch(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }

vec3 ausVerlauf(float t) { return texture(verlauf, vec2(1.0 - abs(2.0 * fract(t) - 1.0), 0.5)).rgb; }

void newton(vec2 p) {
  vec2 z = p;
  float n = 0.0;
  for (int i = 0; i < 4000; i++) {
    if (i >= schritte) break;
    vec2 z2 = mal(z, z);
    vec2 schritt = durch(mal(z2, z) - vec2(1.0, 0.0), 3.0 * z2); // f/f' für f = z³ − 1
    z -= newtonSchritt * schritt;
    if (dot(schritt, schritt) < 1e-10) break;
    n += 1.0;
  }
  // welche der drei Lösungen (Winkel 0°, 120°, 240°)?
  float wurzel = floor(mod(atan(z.y, z.x) / 6.2831853 * 3.0 + 0.5, 3.0));
  float schnell = exp(-n * farbdichte * 0.08);
  farbe = vec4(ausVerlauf((wurzel + 0.5) / 6.0 + farbversatz) * (0.25 + 0.75 * schnell), 1.0);
}

void main() {
  vec2 p = mitte + (gl_FragCoord.xy - 0.5 * aufloesung) / aufloesung.y * massstab;
  if (art == 6) { newton(p); return; }
  if (art == 5) p = p.yx; // Phoenix liegt üblicherweise gedreht
  vec2 z = art == 1 || art == 5 ? p : vec2(0.0);
  vec2 vorher = vec2(0.0);
  vec2 c = art == 1 || art == 5 ? julia : p;
  float n = 0.0;
  bool raus = false;
  for (int i = 0; i < 4000; i++) {
    if (i >= schritte) break;
    if (art == 2) z = abs(z);
    if (art == 3) z.y = -z.y;
    if (art == 4) {
      float r = pow(dot(z, z), hoch * 0.5);
      float w = atan(z.y, z.x) * hoch;
      z = r * vec2(cos(w), sin(w)) + c;
    } else if (art == 5) {
      vec2 neu = mal(z, z) + c + phoenixP * vorher;
      vorher = z;
      z = neu;
    } else z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) { raus = true; break; }
    n += 1.0;
  }
  if (!raus) { farbe = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float glatt = n + 1.0 - log(log(length(z))) / log(art == 4 ? hoch : 2.0);
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
//   Mandelbox:   zwei Faltungen pro Schritt: an den Wänden eines Würfels (was hinausragt, klappt zurück)
//                und an einer Kugel (was innen liegt, wird nach außen gestülpt), dann skalieren und c dazu.
//                Skala −1,5: Kammern und Türme; 2: eine Stadt aus Kästen (Tom Lowe, 2010)
//   Sierpinski:  ein IFS (Iterated Function System): an drei Ebenen spiegeln, auf das Doppelte strecken, zur
//                Ecke schieben. Am Ende ist jeder Punkt in einem von vier kleineren Tetraedern. Mit
//                „Drehung“ dreht sich der Raum jeden Schritt ein wenig mit (KIFS, „kaleidoskopisch“)
//   Quaternion-Julia: die Julia-Menge in vier Dimensionen (Quaternionen statt komplexer Zahlen), ein
//                Schnitt davon in 3D. Weich, wie Wachs
//   Pseudo-Kleinian: Kasten falten und an einer Kugel spiegeln, wie die Mandelbox, aber ohne c: die
//                Grenzmenge einer Spiegelgruppe (Kleinsche Gruppen). Höhlen, Bögen, Gänge, endlos
//                (Knighty, fractalforums 2011)
export const DREI_D = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 aufloesung;
uniform mat4 zurueck;
uniform vec3 auge;
uniform int welt;          // 0 Mandelbulb, 1 Menger, 2 Apollonisch, 3 Mandelbox, 4 Sierpinski, 5 Quaternion-Julia, 6 Pseudo-Kleinian
uniform float potenz;      // Mandelbulb
uniform float form;        // Apollonisch: Größe der Spiegelkugel; Pseudo-Kleinian: Größe der Kugel
uniform float boxSkala;    // Mandelbox
uniform float drehung;     // Sierpinski: Drehung pro Schritt (Bogenmaß)
uniform vec4 qc;           // Quaternion-Julia: c
uniform float staub;       // Staub in der Luft (0 = keiner)
uniform float pixelWinkel; // wie groß ein Pixel als Winkel ist (Staubkörner werden nie kleiner)
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

float mandelbox(vec3 p) {
  const float MR2 = 0.25; // innerer Radius² der Kugelfaltung
  vec4 skala = vec4(vec3(boxSkala), abs(boxSkala)) / MR2;
  vec4 q = vec4(p, 1.0);
  vec4 q0 = q;
  spur = 1e9;
  for (int i = 0; i < 14; i++) {
    q.xyz = clamp(q.xyz, -1.0, 1.0) * 2.0 - q.xyz; // Würfelfaltung
    float r2 = dot(q.xyz, q.xyz);
    spur = min(spur, r2);
    q *= clamp(max(MR2 / r2, MR2), 0.0, 1.0);      // Kugelfaltung (schon durch MR2 geteilt)
    q = q * skala + q0;
  }
  spur = sqrt(spur) * 0.8;
  return (length(q.xyz) - abs(boxSkala - 1.0)) / q.w - pow(abs(boxSkala), -13.0);
}

float sierpinski(vec3 z) {
  float c = cos(drehung), s = sin(drehung);
  mat2 d = mat2(c, -s, s, c);
  spur = 0.0;
  for (int n = 0; n < 12; n++) {
    if (z.x + z.y < 0.0) z.xy = -z.yx; // an drei Ebenen spiegeln
    if (z.x + z.z < 0.0) z.xz = -z.zx;
    if (z.y + z.z < 0.0) z.zy = -z.yz;
    z.xy = d * z.xy;
    z = z * 2.0 - 1.0;                  // strecken, zur Ecke (1, 1, 1) schieben
    if (n < 6) spur += (z.x > z.y ? 1.0 : 0.0) / pow(2.0, float(n + 1));
  }
  return (length(z) - 1.5) * pow(2.0, -12.0);
}

vec4 qquadrat(vec4 a) { return vec4(a.x * a.x - dot(a.yzw, a.yzw), 2.0 * a.x * a.yzw); }
float qjulia(vec3 p) {
  vec4 z = vec4(p, 0.0);
  float dz2 = 1.0, z2 = dot(z, z);
  spur = 1e9;
  for (int i = 0; i < 12; i++) {
    dz2 *= 4.0 * z2;       // Ableitung mitführen: |z'|² ← 4·|z|²·|z'|²
    z = qquadrat(z) + qc;
    z2 = dot(z, z);
    spur = min(spur, z2);
    if (z2 > 16.0) break;
  }
  spur = sqrt(spur);
  return 0.25 * sqrt(z2 / dz2) * log(z2);
}

float kleinian(vec3 p) {
  const vec3 KASTEN = vec3(0.92436, 0.90756, 0.92436);
  float k_ = 1.0;
  spur = 1e9;
  for (int i = 0; i < 10; i++) {
    p = 2.0 * clamp(p, -KASTEN, KASTEN) - p;
    float r2 = dot(p, p);
    spur = min(spur, r2);
    float k = max(form / r2, 1.0);
    p *= k;
    k_ *= k;
  }
  spur = sqrt(spur);
  float rxy = length(p.xy);
  return max(rxy - 0.92784, abs(rxy * p.z) / length(p)) / k_;
}

float de(vec3 p) {
  if (welt == 0) return mandelbulb(p);
  if (welt == 1) return menger(p);
  if (welt == 2) return apollonisch(p);
  if (welt == 3) return mandelbox(p);
  if (welt == 4) return sierpinski(p);
  if (welt == 5) return qjulia(p);
  return kleinian(p);
}

// ---------- Staub ----------
// Zufall aus einer Zahl (ein Hash): dieselbe Zelle gibt immer dieselben Zahlen, darum flackert nichts
vec3 zufall3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// weiches Rauschen im Raum (Werte an den Gitterpunkten, dazwischen weich gemischt): Nebel ist nie gleich dicht
float rauschen(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = zufall3(i).x, n100 = zufall3(i + vec3(1, 0, 0)).x, n010 = zufall3(i + vec3(0, 1, 0)).x, n110 = zufall3(i + vec3(1, 1, 0)).x;
  float n001 = zufall3(i + vec3(0, 0, 1)).x, n101 = zufall3(i + vec3(1, 0, 1)).x, n011 = zufall3(i + vec3(0, 1, 1)).x, n111 = zufall3(i + vec3(1, 1, 1)).x;
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
// Staubkörner: der Raum ist in Würfel geteilt, in jedem schwebt ein Korn an einer zufälligen Stelle und
// treibt langsam. Für einige Abschnitte des Strahls: wie nah kommt er dem Korn seiner Zelle? Sehr nah: ein
// kleiner heller Punkt. Hell nur, wo Licht ist (im Kegel der Lampe, oder überall bei Sonne).
vec3 staubkoerner(vec3 o, vec3 r, float bis, float zelle) {
  vec3 summe = vec3(0.0);
  float schritt = zelle * 0.6;
  for (int i = 0; i < 40; i++) {
    float t = (float(i) + 0.5) * schritt;
    if (t > bis) break;
    vec3 p = o + r * t;
    vec3 id = floor(p / zelle);
    vec3 z = zufall3(id);
    if (z.z > 0.3) continue; // nicht in jeder Zelle ein Korn
    vec3 korn = (id + 0.2 + 0.6 * z) * zelle + 0.15 * zelle * sin(zeit * (0.3 + z.yzx) + z * 6.28); // treibt
    vec3 v = korn - o;
    float tk = dot(v, r);
    if (tk < 0.0 || tk > bis) continue;
    float quer = length(v - r * tk);
    float groesse = max(zelle * 0.02, tk * pixelWinkel * 0.9);
    // weit weg wird ein Korn nicht kleiner als ein Pixel, aber dunkler (sonst flimmert es)
    float punkt = smoothstep(groesse, 0.0, quer) * min(1.0, zelle * 0.02 / groesse);
    if (punkt <= 0.0) continue;
    // wie viel Licht das Korn bekommt
    vec3 zl = lampeOrt - korn;
    float al = length(zl);
    float kegelLicht = smoothstep(cos(kegel), cos(kegel * 0.6), dot(-zl / al, lampeRichtung)) * lampeStaerke / (1.0 + al * al * 4.0);
    vec3 licht = (lichtArt == 1 ? vec3(0.0) : kegelLicht * lampeFarbe) + (lichtArt >= 1 ? vec3(0.25, 0.24, 0.21) : vec3(0.0)) + umgebung;
    summe += punkt * licht * (0.3 + 0.7 * z.x * z.x) * exp(-tk / (zelle * 25.0));
  }
  return summe;
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
  // Nebel ist nie gleich dicht: dreimal Rauschen längs des Strahls, das treibt langsam (Schwaden)
  float bis = treffer ? t : 3.0;
  vec3 wind = vec3(0.05, 0.01, 0.03) * zeit;
  float zelle = welt == 1 || welt == 2 ? 0.015 : 0.06; // die großen Welten haben gröberen Staub
  float schwaden = 0.0;
  for (int i = 0; i < 3; i++) schwaden += rauschen((auge + r * bis * (float(i) + 0.5) / 3.0) / (zelle * 12.0) + wind);
  schwaden = mix(1.0, schwaden / 3.0 * 2.0, min(1.0, staub));
  // Nebel: auch die Luft im Kegel leuchtet ein wenig (wie Staub im Licht)
  float luft = smoothstep(cos(kegel), cos(kegel * 0.5), dot(r, lampeRichtung)) * lampeStaerke * 0.02 * nebel * schwaden;
  float dunst = 1.0 - exp(-t * nebel * 0.3 * schwaden);
  f = mix(f, himmel, treffer ? dunst : 1.0) + (lichtArt == 1 ? 0.0 : luft) * lampeFarbe;
  if (staub > 0.0) f += staubkoerner(auge, r, min(bis, zelle * 24.0), zelle) * staub;
  f = pow(f, vec3(1.0 / 2.2)); // Gamma: Licht rechnet linear, der Bildschirm nicht
  farbe = vec4(f, 1.0);
}`;

