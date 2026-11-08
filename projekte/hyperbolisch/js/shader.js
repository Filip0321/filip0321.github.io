// Der Shader: für jedes Pixel einen Strahl durch den Raum schicken (Raymarching) und ihn in der Zelle halten.
//
// Statt eine ganze unendliche Wabe zu beschreiben, beschreibt man nur eine Zelle (einen Körper) und was darin
// liegt. Verlässt der Strahl die Zelle durch eine Fläche, werden Ort und Richtung an dieser Fläche gespiegelt:
// Er ist dann in der Nachbarzelle, die genau so aussieht, nur gespiegelt. So läuft er durch unendlich viele Zellen,
// rechnet aber immer nur mit einer (so machen es Coulon, Matsumoto, Segerman und Trettel 2020, „Ray-marching
// Thurston geometries“).
//
// In der Zelle zählen nur die Abstände zu den Flächen: d_i = asinh(⟨p, n_i⟩), innen negativ. Die drei größten
// (die nächsten Flächen) reichen für alles:
//   Balken entlang der Kanten:  dort sind zwei Flächen nah,   √(d1² + d2²) − Dicke
//   Kugeln an den Ecken:        dort sind drei Flächen nah,   √(d1² + d2² + d3²) − Radius
//   Wände mit Fenstern:         nah an einer Fläche, aber nur nah an einer Kante (der Rand des Fensters)
// Licht: eine Lampe an der Kamera. Im hyperbolischen Raum wächst die Oberfläche einer Kugel mit sinh²(r) statt r²,
// also exponentiell; dasselbe Licht verteilt sich auf viel mehr Fläche, die Helligkeit fällt wie 1 / sinh²(t).

export const VOLL = `#version 300 es
in vec2 lage;
out vec2 uv;
void main() {
  uv = lage;
  gl_Position = vec4(lage, 0.0, 1.0);
}`;

export const RAUM = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;

uniform vec4 kamera[4];       // rechts, oben, vorn, Ort
uniform vec4 flaeche[12];     // Normalen der Flächen
uniform int anzahl;           // 6 (Würfel) oder 12 (Dodekaeder)
uniform int flach;            // 1: flacher Raum (zum Vergleich)
uniform int paritaet;         // Spiegelungen der Kamera (für die zwei Farben)
uniform float seite;          // Breite / Höhe
uniform float blick;          // Blickwinkel (tan des halben)
uniform int stil;             // 0 Balken, 1 Wände mit Fenstern, 2 Ecken, 3 Balken und Ecken
uniform float dicke;          // Balken, Wand
uniform float rahmen;         // Breite des Fensterrahmens
uniform float kugel;          // Kugel in der Mitte jeder Zelle (Radius, 0 = keine)
uniform vec3 farbeA;          // die zwei Zellfarben
uniform vec3 farbeB;
uniform vec3 nebelFarbe;
uniform float nebel;
uniform float lampe;
uniform float kugelLicht;     // die Kugeln leuchten
uniform float weite;          // so weit wird höchstens geschaut
uniform float zeit;
uniform int lampenArt;        // 0 Stirnlampe (gleichmäßig), 1 Taschenlampe (Kegel), 2 aus
uniform float kegel;          // halber Öffnungswinkel der Taschenlampe (Bogenmaß)
uniform int augen;            // 1: die Kugeln sind Augen, die dich ansehen
uniform vec3 irisFarbe;
uniform float lider;          // 0 offen, 1 zu (sie blinzeln ab und zu)
uniform float wucher;         // Wucherungen: Stärke (0 = glatt)
uniform float wucherGroesse;  // wie fein

float mink(vec4 a, vec4 b) { return dot(a.xyz, b.xyz) - a.w * b.w; }

// Rauschen (Werte an den Gitterpunkten zufällig, dazwischen weich gemischt), zwei Lagen übereinander
float hash(vec3 q) { return fract(sin(dot(q, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float rauschen(vec3 q) {
  vec3 i = floor(q), f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float wuchern(vec4 p) {
  // gerechnet an der Stelle in der Zelle (alle Zellen wuchern gleich, nur gespiegelt); langsam atmend
  vec3 q = p.xyz * wucherGroesse + vec3(0.0, zeit * 0.15, 0.0);
  return rauschen(q) * 0.65 + rauschen(q * 2.3 + 7.0) * 0.35;
}

// Abstand zu Fläche i (innen negativ) und wie er sich ändert (Gradient, eine Richtung im Tangentialraum bei p)
float flaechenAbstand(vec4 p, int i, out vec4 grad) {
  vec4 n = flaeche[i];
  if (flach == 1) {
    grad = vec4(n.xyz, 0.0);
    return dot(p.xyz, n.xyz) - 1.0;
  }
  float x = mink(p, n);
  grad = (n + x * p) / sqrt(1.0 + x * x); // Ableitung von asinh, projiziert auf die Tangente
  return asinh(x);
}

// die drei nächsten Flächen (größte d) mit ihren Gradienten
void naechste(vec4 p, out vec3 d, out vec4 g1, out vec4 g2, out vec4 g3) {
  d = vec3(-1e9);
  for (int i = 0; i < 12; i++) {
    if (i >= anzahl) break;
    vec4 g;
    float a = flaechenAbstand(p, i, g);
    if (a > d.x) { d = vec3(a, d.x, d.y); g3 = g2; g2 = g1; g1 = g; }
    else if (a > d.y) { d = vec3(d.x, a, d.y); g3 = g2; g2 = g; }
    else if (a > d.z) { d.z = a; g3 = g; }
  }
}

// Abstand zur Mitte der Zelle (für die Kugel) und Gradient
float mitteAbstand(vec4 p, out vec4 grad) {
  if (flach == 1) {
    float l = length(p.xyz);
    grad = vec4(p.xyz / max(l, 1e-5), 0.0);
    return l;
  }
  // Abstand zum Ursprung o = (0,0,0,1): acosh(−⟨p, o⟩) = acosh(p.w); Gradient: weg vom Ursprung
  float w = max(p.w, 1.0);
  vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 g = -(o + mink(p, o) * p);
  float l = sqrt(max(mink(g, g), 1e-10));
  grad = g / l;
  return acosh(w);
}

// Abstand zum Nächsten in der Zelle; was getroffen wurde (0 Wabe, 1 Kugel) und die Normale
float szene(vec4 p, out vec4 normale, out float was) {
  vec3 d;
  vec4 g1, g2, g3;
  naechste(p, d, g1, g2, g3);
  float s;
  if (stil == 1) {
    // Wand: nah an der nächsten Fläche (−d1 < Dicke), aber nur am Rand (−d2 < Rahmen): Fenster in der Mitte
    float wand = -d.x - dicke;
    float rand = -d.y - rahmen;
    if (wand > rand) { s = wand; normale = -g1; } else { s = rand; normale = -g2; }
  } else {
    float balken = length(d.xy) - dicke;
    vec4 nb = (d.x * g1 + d.y * g2) / max(length(d.xy), 1e-6);
    float ecke = length(d) - dicke * 2.2;
    vec4 ne = (d.x * g1 + d.y * g2 + d.z * g3) / max(length(d), 1e-6);
    if (stil == 0) { s = balken; normale = nb; }
    else if (stil == 2) { s = ecke; normale = ne; }
    else if (balken < ecke) { s = balken; normale = nb; }
    else { s = ecke; normale = ne; }
  }
  // Wucherungen: die Oberfläche quillt nach außen (die Abstandsfunktion wird kleiner, je mehr Rauschen)
  if (wucher > 0.0) s -= wucher * wuchern(p);
  was = 0.0;
  if (kugel > 0.0) {
    vec4 gk;
    float k = mitteAbstand(p, gk) - kugel;
    if (k < s) { s = k; normale = gk; was = 1.0; }
  }
  return s;
}

void main() {
  // Strahl: vom Ort der Kamera in Richtung des Pixels (im Tangentialraum am Ort: rechts, oben, vorn)
  vec4 p = kamera[3];
  vec4 r = normalize(uv.x * seite * blick * kamera[0] + uv.y * blick * kamera[1] + kamera[2]);
  if (flach == 0) r = r / sqrt(mink(r, r));
  int par = paritaet;
  float t = 0.0;
  bool treffer = false;
  vec4 normale = vec4(0.0);
  float was = 0.0;
  for (int i = 0; i < 160; i++) {
    float s = szene(p, normale, was);
    if (s < 0.0015 * (1.0 + t)) { treffer = true; break; }
    // nie zu weit auf einmal (sonst springt der Strahl über die Nachbarzelle hinweg); mit Wucherungen vorsichtiger,
    // weil das Rauschen die Abstandsfunktion ungenauer macht
    s = min(s * (wucher > 0.0 ? 0.6 : 0.9), 0.4);
    if (flach == 1) {
      p.xyz += s * r.xyz;
    } else {
      // die Geodäte entlang: cosh und sinh statt 1 und s
      vec4 q = cosh(s) * p + sinh(s) * r;
      r = sinh(s) * p + cosh(s) * r;
      p = q;
      // Rechenfehler wegräumen: p zurück auf die Schale, r senkrecht dazu
      p /= sqrt(-mink(p, p));
      r += mink(r, p) * p;
      r /= sqrt(mink(r, r));
    }
    t += s;
    if (t > weite) break;
    // aus der Zelle gelaufen? an der Fläche spiegeln (flach: um eine Zelle verschieben)
    for (int k = 0; k < 3; k++) {
      int raus = -1;
      float wert = 0.0;
      for (int j = 0; j < 12; j++) {
        if (j >= anzahl) break;
        float a = flach == 1 ? dot(p.xyz, flaeche[j].xyz) - 1.0 : mink(p, flaeche[j]);
        if (a > wert) { wert = a; raus = j; }
      }
      if (raus < 0) break;
      vec4 n = flaeche[raus];
      if (flach == 1) {
        p.xyz -= 2.0 * n.xyz;
      } else {
        p -= 2.0 * mink(p, n) * n;
        r -= 2.0 * mink(r, n) * n;
      }
      par = 1 - par;
    }
  }
  vec3 f = nebelFarbe;
  if (treffer) {
    // Lampe an der Kamera: das Licht kommt von dort, wo der Strahl herkam (−r)
    float diffus = max(flach == 1 ? dot(normale.xyz, -r.xyz) : mink(normale, -r), 0.0);
    float abfall = flach == 1 ? 1.0 / (1.0 + t * t) : 1.0 / (1.0 + sinh(t) * sinh(t));
    // Taschenlampe: nur in einem Kegel um die Blickrichtung. Weil sie an der Kamera hängt, läuft ihr Licht genau den
    // Strahl entlang zurück; ob ein Punkt im Kegel liegt, sagt also schon der Winkel des Pixels zur Bildmitte
    float imKegel = 1.0;
    if (lampenArt == 1) {
      float winkel = atan(length(uv * vec2(seite * blick, blick)));
      imKegel = 1.0 - smoothstep(kegel * 0.75, kegel, winkel);
    }
    float licht = lampenArt == 2 ? 0.0 : lampe * diffus * abfall * imKegel;
    vec3 grund = par == 0 ? farbeA : farbeB;
    if (was > 0.5) {
      vec3 haut = mix(grund, vec3(1.0), 0.4);
      if (augen == 1) {
        // ein Auge: der Teil der Kugel, der zur Kamera zeigt, ist Iris und Pupille. Jedes Auge sieht dich an
        float sieht = flach == 1 ? dot(normale.xyz, -r.xyz) : mink(normale, -r);
        vec3 weiss = vec3(0.85, 0.82, 0.75) * (0.85 + 0.15 * rauschen(normale.xyz * 25.0));
        vec3 aug = weiss;
        aug = mix(aug, irisFarbe * (0.6 + 0.4 * rauschen(normale.xyz * 60.0)), smoothstep(0.86, 0.88, sieht));
        aug = mix(aug, vec3(0.0), smoothstep(0.965, 0.97, sieht));
        // Lid: beim Blinzeln wächst Haut von oben und unten über das Auge
        float offen = 1.0 - lider;
        aug = abs(normale.y) > offen ? haut * 0.5 : aug;
        haut = aug;
      }
      // die Kugeln leuchten von selbst (pulsierend)
      f = haut * (kugelLicht * (0.7 + 0.3 * sin(zeit * 1.3)) + 0.3 * licht);
    } else {
      f = grund * (0.04 + licht);
    }
    f = mix(nebelFarbe, f, exp(-t * nebel));
  } else if (lampenArt == 1) {
    // ins Leere: der Kegel erhellt ein wenig den Nebel
    float winkel = atan(length(uv * vec2(seite * blick, blick)));
    f = nebelFarbe * (1.0 + 0.6 * lampe * (1.0 - smoothstep(kegel * 0.75, kegel, winkel)) * 0.1);
  }
  farbe = vec4(pow(f, vec3(1.0 / 2.2)), 1.0);
}`;
