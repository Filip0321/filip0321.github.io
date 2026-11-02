// Die Shader der Chronofotografie (Theorie im LIESMICH, Teil 3 und 4).
//
//   MISCH_SHADER   legt viele Bilder aus dem Ringpuffer übereinander (die eigentliche Chronofotografie)
//   MEDIAN_SHADER  rechnet aus ein paar Bildern den leeren Hintergrund (Median pro Pixel)
//   ZEIGE_SHADER   eine Textur einfach aufs Canvas (Hintergrund, aktuelles Bild)

// Alle Bilder liegen in einem Textur-Array (sampler2DArray): ein Stapel gleich großer Bilder,
// angesprochen mit vec3(u, v, Ebene). Zeile 0 jeder Ebene ist oben im Bild, darum v = 1 − uv.y. Welche Ebenen und wie stark, steht in "liste":
// pro Eintrag (Ebene, Gewicht), vom ältesten zum neuesten.
export const MISCH_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray stapel;    // der Ringpuffer
uniform highp sampler2D liste;    // x = Eintrag: (Ebene, Gewicht), R32F-Paare (RG32F)
uniform int anzahl;               // so viele Einträge
uniform sampler2D hintergrund;    // leerer Hintergrund (Median), falls berechnet
uniform bool abzug;               // Hintergrund-Abzug: nur was sich vom Hintergrund unterscheidet, zählt
uniform float schwelle;           // ab diesem Unterschied gilt etwas als bewegt
uniform float weich;              // so weich ist der Übergang (0 = hart)
uniform int art;                  // 0 aufhellen, 1 abdunkeln, 2 mittel, 3 differenz, 4 überdecken
uniform vec2 aufloesung;

out vec4 farbe;

// wie stark sich f vom Hintergrund unterscheidet: 0 = gleich (still), 1 = bewegt
float maske(vec3 f, vec3 hg) {
  float d = length(f - hg) / sqrt(3.0); // Abstand der Farben, 0 bis 1
  return smoothstep(schwelle, schwelle + weich + 0.001, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  vec3 hg = texture(hintergrund, uv).rgb;

  // Ausgangsbild: mit Abzug der Hintergrund, sonst das Neutrale der Mischart
  // (Schwarz fürs Aufhellen: max(0, x) = x; Weiß fürs Abdunkeln: min(1, x) = x)
  vec3 start = abzug ? hg : (art == 1 ? vec3(1.0) : vec3(0.0));
  vec3 acc = art == 2 ? vec3(0.0) : start; // beim Mittel wird erst gesammelt
  float summeGewicht = 0.0;

  for (int i = 0; i < anzahl; i++) {
    vec2 eintrag = texelFetch(liste, ivec2(i, 0), 0).rg;
    vec3 f = texture(stapel, vec3(uv.x, 1.0 - uv.y, eintrag.x)).rgb; // Zeile 0 der Ebenen ist oben (gpu.js)
    float w = eintrag.y;
    float m = abzug ? maske(f, hg) : 1.0;
    // eine Schicht: zwischen Ausgang und Bild, so weit wie Gewicht und Maske sagen
    vec3 schicht = mix(start, f, w * m);
    if (art == 0) acc = max(acc, schicht);
    else if (art == 1) acc = min(acc, schicht);
    else if (art == 2) {
      // Mittel: jede Schicht ganz (nur die Maske), dafür mit ihrem Gewicht gezählt
      acc += mix(start, f, m) * w;
      summeGewicht += w;
    }
    else if (art == 3) acc = i == 0 ? schicht : abs(acc - schicht);
    else acc = mix(acc, f, w * m); // überdecken: Neueres liegt oben, wie ausgeschnitten und aufgeklebt
  }
  if (art == 2 && summeGewicht > 0.0) acc /= summeGewicht; // Mittel: wie eine Mehrfachbelichtung (Marey)
  farbe = vec4(acc, 1.0);
}`;

// Median pro Pixel und Kanal: die Werte sortieren und den mittleren nehmen.
// Warum nicht der Mittelwert? Läuft jemand durchs Bild, ist er in ein paar Bildern da. Der Mittelwert
// zieht dort alles ein bisschen zu ihm hin (ein Geist bleibt). Der Median nimmt den Wert, den die
// meisten Bilder haben: solange jemand an einer Stelle weniger als die Hälfte der Zeit steht,
// verschwindet er ganz. Sortiert wird mit Einfügen (bei 15 Werten schnell genug).
export const MEDIAN_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray proben;
uniform int anzahl; // höchstens 31, ungerade
uniform vec2 aufloesung;

out vec4 farbe;

float median(float werte[31], int n) {
  for (int i = 1; i < 31; i++) {
    if (i >= n) break;
    float x = werte[i];
    int j = i - 1;
    while (j >= 0 && werte[j] > x) {
      werte[j + 1] = werte[j];
      j--;
    }
    werte[j + 1] = x;
  }
  return werte[n / 2];
}

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  float r[31];
  float g[31];
  float b[31];
  for (int i = 0; i < 31; i++) {
    if (i >= anzahl) break;
    vec3 f = texture(proben, vec3(uv.x, 1.0 - uv.y, float(i))).rgb; // umgedreht: der Hintergrund steht dann richtig herum
    r[i] = f.r;
    g[i] = f.g;
    b[i] = f.b;
  }
  farbe = vec4(median(r, anzahl), median(g, anzahl), median(b, anzahl), 1.0);
}`;

export const ZEIGE_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2D bild;
uniform sampler2DArray stapel;
uniform int ebene;   // >= 0: diese Ebene des Stapels zeigen, sonst bild
uniform vec2 aufloesung;

out vec4 farbe;

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  farbe = vec4(ebene >= 0 ? texture(stapel, vec3(uv.x, 1.0 - uv.y, float(ebene))).rgb : texture(bild, uv).rgb, 1.0);
}`;
