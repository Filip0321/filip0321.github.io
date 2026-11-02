// Die Shader des Zeitquaders (Theorie im LIESMICH).
//
// Ein Video ist ein Quader aus Raum und Zeit: x und y sind das Bild, t ist die dritte Richtung.
// Jede Ansicht ist ein anderer Schnitt durch diesen Quader:
//   Schlitz      eine Spalte (oder Zeile) aus jedem Bild nebeneinander: der Schnitt x = fest
//   Zeitversatz  jedes Pixel kommt aus einer anderen Zeit: eine gekrümmte Fläche durch den Quader
//   Quader       der ganze Block im Raum, von außen angesehen (Raymarching)

const HELLIGKEIT = /* glsl */ `
float helligkeit(vec3 f) { return dot(f, vec3(0.2126, 0.7152, 0.0722)); }
`;

// ein Bild in eine Ebene des Ringpuffers kopieren (richtig herum, siehe /lib/ringpuffer.js)
export const KOPIER_SHADER = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D bild;
uniform vec2 aufloesung;
out vec4 farbe;
void main() {
  farbe = vec4(texture(bild, gl_FragCoord.xy / aufloesung).rgb, 1.0);
}`;

// Schlitz: eine Spalte (senkrecht) oder Zeile (waagerecht) des Bildes in eine Spalte bzw. Zeile des
// Schlitzbildes. gpu.js setzt den viewport auf genau diese eine Spalte/Zeile.
export const SCHLITZ_SHADER = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D bild;
uniform float lage;        // wo der Schlitz im Bild steht (0 bis 1)
uniform bool senkrecht;
uniform vec2 aufloesung;   // Größe des Schlitzbildes
out vec4 farbe;
void main() {
  vec2 p = gl_FragCoord.xy / aufloesung;
  vec2 uv = senkrecht ? vec2(lage, p.y) : vec2(p.x, lage);
  farbe = vec4(texture(bild, uv).rgb, 1.0);
}`;

// Zeitversatz: jedes Pixel holt sich sein Bild aus der Vergangenheit, wie weit, sagt ein Muster.
// Zwischen zwei Bildern wird gemischt, sonst sieht man Stufen.
export const VERSATZ_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
${HELLIGKEIT}
uniform sampler2DArray stapel;
uniform int neueste;       // Ebene des neuesten Bildes
uniform int plaetze;       // Ebenen im Puffer
uniform float tiefe;       // so viele Bilder zurück geht es höchstens
uniform int muster;        // 0 links→rechts, 1 rechts→links, 2 oben→unten, 3 unten→oben, 4 Mitte→außen, 5 außen→Mitte, 6 Helligkeit, 7 Welle
uniform float zeit;        // Sekunden (für die Welle)
uniform vec2 aufloesung;
out vec4 farbe;

vec3 ebene(float alter, vec2 uv) {
  float e = mod(float(neueste) - alter + float(plaetze) * 2.0, float(plaetze));
  return texture(stapel, vec3(uv, e)).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  float d;
  if (muster == 0) d = uv.x;
  else if (muster == 1) d = 1.0 - uv.x;
  else if (muster == 2) d = 1.0 - uv.y;
  else if (muster == 3) d = uv.y;
  else if (muster == 4) d = clamp(length(uv - 0.5) * 1.414, 0.0, 1.0);
  else if (muster == 5) d = 1.0 - clamp(length(uv - 0.5) * 1.414, 0.0, 1.0);
  else if (muster == 6) d = helligkeit(ebene(0.0, uv)); // hell = alt: Lichter ziehen Schlieren
  else d = 0.5 + 0.5 * sin(uv.y * 12.0 + zeit * 2.0);   // Welle: die Zeit schwappt durchs Bild
  float alter = d * tiefe;
  float a0 = floor(alter);
  // die beiden Bilder um "alter" herum, gemischt
  farbe = vec4(mix(ebene(a0, uv), ebene(a0 + 1.0, uv), alter - a0), 1.0);
}`;

// ein Bild aufs Canvas; verschiebung: im Kreis verschoben (live: der neueste Schlitz steht immer rechts)
export const ZEIGE_SHADER = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D bild;
uniform float verschiebung;
uniform bool senkrecht;
uniform vec2 aufloesung;
out vec4 farbe;
void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  if (senkrecht) uv.x = fract(uv.x + verschiebung);
  else uv.y = fract(uv.y - verschiebung);
  farbe = vec4(texture(bild, uv).rgb, 1.0);
}`;

// Quader: für jeden Bildpunkt ein Strahl von der Kamera durch den Block aus Bildern (Raymarching).
// Der Block reicht in x von −breite/2 bis breite/2 (Seitenverhältnis), in y von −0,5 bis 0,5,
// in z (der Zeit) von −laenge/2 (ältestes Bild) bis laenge/2 (neuestes).
// Entlang des Strahls wird in kleinen Schritten gesammelt:
//   leuchten  jedes Bild gibt Licht ab, alles addiert sich (Helles wird zu leuchtenden Röhren)
//   bewegtes  nur was sich vom ersten Bild unterscheidet, ist sichtbar, der Rest durchsichtig
//   nebel     alles ein bisschen sichtbar (wie die Ebenen in Blender mit wenig Deckkraft)
// Dazu eine Schnittfläche, die den Block an einer Stelle aufschneidet: dort sieht man einen Schlitz.
export const QUADER_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
${HELLIGKEIT}
uniform sampler2DArray stapel;
uniform sampler2D referenz; // der leere Hintergrund (Median), für „bewegtes“
uniform int anzahl;         // Bilder im Block (Ebene 0 = ältestes)
uniform mat4 zurueck;       // vom Bildschirm zurück in den Raum (inverse Projektion · Kamera)
uniform vec3 auge;          // wo die Kamera steht
uniform vec3 masse;         // (breite, 1, laenge) des Blocks
uniform int art;            // 0 leuchten, 1 bewegtes, 2 nebel
uniform float deckkraft;
uniform float schwelle;
uniform int schnitt;        // 0 aus, 1 x, 2 y, 3 Zeit
uniform float schnittLage;  // 0 bis 1
uniform vec2 aufloesung;
out vec4 farbe;

// Stelle im Block -> (u, v, Ebene)
vec4 lies(vec3 p) {
  vec3 w = p / masse + 0.5; // 0 bis 1 in jede Richtung
  float e = w.z * float(anzahl - 1);
  float e0 = floor(e);
  vec3 a = texture(stapel, vec3(w.xy, e0)).rgb;
  vec3 b = texture(stapel, vec3(w.xy, min(e0 + 1.0, float(anzahl - 1)))).rgb;
  vec3 f = mix(a, b, e - e0);
  // im Alphakanal: wie anders als der Hintergrund (für „bewegtes“)
  float anders = clamp(abs(helligkeit(f) - helligkeit(texture(referenz, w.xy).rgb)) * 4.0, 0.0, 1.0);
  return vec4(f, anders);
}

void main() {
  // Strahl durch diesen Bildpunkt
  vec2 ndc = gl_FragCoord.xy / aufloesung * 2.0 - 1.0;
  vec4 fern = zurueck * vec4(ndc, 1.0, 1.0);
  vec3 richtung = normalize(fern.xyz / fern.w - auge);

  // wo tritt er in den Block ein und wo aus? (Schnitt mit drei Paaren paralleler Ebenen, „slab“)
  vec3 halb = masse * 0.5;
  vec3 t1 = (-halb - auge) / richtung;
  vec3 t2 = (halb - auge) / richtung;
  vec3 tmin = min(t1, t2);
  vec3 tmax = max(t1, t2);
  float rein = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float raus = min(min(tmax.x, tmax.y), tmax.z);
  vec3 hintergrund = vec3(0.07);
  if (raus <= rein) {
    farbe = vec4(hintergrund, 1.0);
    return;
  }

  // Schnittfläche: wo der Strahl sie trifft (oder nie)
  float tSchnitt = 1e9;
  if (schnitt > 0) {
    int achse = schnitt - 1;
    float lage = (schnittLage - 0.5) * masse[achse];
    float t = (lage - auge[achse]) / richtung[achse];
    if (t > rein && t < raus) tSchnitt = t;
  }

  vec3 erstesBild = vec3(0.0);
  vec3 farbeSumme = vec3(0.0);
  float deckung = 0.0;
  const int SCHRITTE = 256;
  float schritt = (raus - rein) / float(SCHRITTE);
  float dichte = schritt * 60.0; // gleich dicht, egal wie lang der Weg durch den Block ist
  for (int i = 0; i < SCHRITTE; i++) {
    float t = rein + (float(i) + 0.5) * schritt;
    if (t > tSchnitt) {
      // die Schnittfläche ist undurchsichtig: dort das Bild, dann Schluss
      vec3 f = lies(auge + richtung * tSchnitt).rgb;
      farbeSumme += (1.0 - deckung) * f;
      deckung = 1.0;
      break;
    }
    vec3 p = auge + richtung * t;
    vec4 f = lies(p);
    float a;
    if (art == 0) {
      farbeSumme += f.rgb * deckkraft * dichte * 0.05; // leuchten: nur addieren
      continue;
    } else if (art == 1) {
      // bewegt = anders als der Hintergrund (im Alphakanal, siehe lies)
      a = smoothstep(schwelle, schwelle + 0.1, f.a) * deckkraft * dichte;
    } else {
      a = deckkraft * dichte * 0.1;
    }
    a = clamp(a, 0.0, 1.0);
    farbeSumme += (1.0 - deckung) * a * f.rgb; // von vorn nach hinten: was vorn ist, verdeckt
    deckung += (1.0 - deckung) * a;
    if (deckung > 0.99) break;
  }
  vec3 ergebnis = art == 0 ? 1.0 - exp(-farbeSumme) : farbeSumme + (1.0 - deckung) * hintergrund;
  farbe = vec4(ergebnis, 1.0);
}`;

// Median pro Pixel aus k Ebenen des Blocks (gleichmäßig verteilt): der leere Hintergrund für „bewegtes“
// (wie in der Chronofotografie: der Wert, den die meisten Bilder haben; wer durchläuft, verschwindet)
export const MEDIAN_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray stapel;
uniform int anzahl; // Bilder im Block
uniform int k;      // so viele davon (ungerade, höchstens 15)
uniform vec2 aufloesung;
out vec4 farbe;
float median(float w[15], int n) {
  for (int i = 1; i < 15; i++) {
    if (i >= n) break;
    float x = w[i];
    int j = i - 1;
    while (j >= 0 && w[j] > x) { w[j + 1] = w[j]; j--; }
    w[j + 1] = x;
  }
  return w[n / 2];
}
void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  float r[15]; float g[15]; float b[15];
  for (int i = 0; i < 15; i++) {
    if (i >= k) break;
    float e = floor(float(i) * float(anzahl - 1) / float(max(k - 1, 1)) + 0.5);
    vec3 f = texture(stapel, vec3(uv, e)).rgb;
    r[i] = f.r; g[i] = f.g; b[i] = f.b;
  }
  farbe = vec4(median(r, k), median(g, k), median(b, k), 1.0);
}`;
