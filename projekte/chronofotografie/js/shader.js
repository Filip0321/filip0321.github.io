// Die Shader der Chronofotografie (Theorie im LIESMICH, Teil 3 bis 5).
//
//   EINLEGE_SHADER  ein neues Bild in eine Ebene des Ringpuffers: Farbe, und im Alphakanal, wie stark
//                   es sich vom Hintergrund unterscheidet (oder die Maske aus einer eigenen Datei)
//   MISCH_SHADER    legt die Ebenen über das Grundbild (die eigentliche Chronofotografie)
//   MEDIAN_SHADER   rechnet aus ein paar Bildern den leeren Hintergrund (Median pro Pixel)
//   ZEIGE_SHADER    eine Textur einfach aufs Canvas (Grundbild, Median, aktuelles Bild, Maske)
//
// Alle Texturen stehen richtig herum (y = 0 unten): 2D-Texturen werden umgedreht hochgeladen,
// Ebenen des Ringpuffers werden von einem Shader gezeichnet (/lib/ringpuffer.js).

const HELLIGKEIT = /* glsl */ `
float helligkeit(vec3 f) { return dot(f, vec3(0.2126, 0.7152, 0.0722)); }
`;

// Unterschied zum Median nur in der Helligkeit (Farbe rauscht in Videos stärker als Helligkeit),
// gemittelt über 3 × 3 Nachbarn im Abstand "radius": ein einzelnes rauschendes Pixel wird so zu 1/9,
// ein bewegtes Objekt bleibt ganz. Das ersetzt das „Öffnen“ aus der Bildverarbeitung in einem Durchgang.
export const EINLEGE_SHADER = /* glsl */ `#version 300 es
precision highp float;
${HELLIGKEIT}
uniform sampler2D bild;       // das neue Bild
uniform sampler2D referenz;   // der Median (leerer Hintergrund)
uniform sampler2D maske;      // Maske aus einer Datei (weiß = Objekt), wenn maskeArt > 0
uniform int maskeArt;         // 0 aus dem Median rechnen, 1 aus Datei, 2 aus Datei invertiert, 3 keine
uniform float radius;         // Pixel
uniform float verstaerkung;   // Unterschied mal so viel (kleine Unterschiede sind sonst kaum zu trennen)
uniform vec2 aufloesung;

out vec4 farbe;

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  vec3 f = texture(bild, uv).rgb;
  float a = 1.0;
  if (maskeArt == 0) {
    float summe = 0.0;
    vec2 schritt = radius / aufloesung;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 p = uv + vec2(x, y) * schritt;
        summe += abs(helligkeit(texture(bild, p).rgb) - helligkeit(texture(referenz, p).rgb));
      }
    }
    a = clamp(summe / 9.0 * verstaerkung, 0.0, 1.0);
  } else if (maskeArt == 1) {
    a = helligkeit(texture(maske, uv).rgb);
  } else if (maskeArt == 2) {
    a = 1.0 - helligkeit(texture(maske, uv).rgb);
  }
  farbe = vec4(f, a); // im Alphakanal: wie bewegt (0 bis 1); die Schwelle kommt erst beim Mischen
}`;

// Alle Bilder liegen in einem Textur-Array (sampler2DArray), angesprochen mit vec3(uv, Ebene).
// Welche Ebenen und wie stark, steht in "liste": pro Eintrag (Ebene, Gewicht), vom ältesten zum neuesten.
export const MISCH_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray stapel;    // der Ringpuffer (Alpha: wie bewegt)
uniform highp sampler2D liste;    // x = Eintrag: (Ebene, Gewicht) als RG32F
uniform int anzahl;
uniform sampler2D grund;          // ein echtes Bild aus dem Video als Hintergrund
uniform sampler2D referenz;       // der Median
uniform int hintergrund;          // 0 keiner (neutral, alle Pixel zählen), 1 Grundbild, 2 Median
uniform float schwelle;           // ab diesem Unterschied gilt etwas als bewegt
uniform float weich;              // so weich ist der Übergang
uniform int art;                  // 0 aufhellen, 1 abdunkeln, 2 mittel, 3 differenz, 4 überdecken
uniform vec2 aufloesung;

out vec4 farbe;

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;

  // Ausgang: das Grundbild (oder der Median); ohne Hintergrund das Neutrale der Mischart
  // (Schwarz fürs Aufhellen: max(0, x) = x; Weiß fürs Abdunkeln: min(1, x) = x)
  vec3 start = hintergrund == 1 ? texture(grund, uv).rgb
             : hintergrund == 2 ? texture(referenz, uv).rgb
             : (art == 1 ? vec3(1.0) : vec3(0.0));
  vec3 acc = art == 2 ? vec3(0.0) : start; // beim Mittel wird erst gesammelt
  float summeGewicht = 0.0;

  for (int i = 0; i < anzahl; i++) {
    vec2 eintrag = texelFetch(liste, ivec2(i, 0), 0).rg;
    vec4 f = texture(stapel, vec3(uv, eintrag.x));
    float w = eintrag.y;
    // nur was sich bewegt, zählt; überall sonst bleibt das Grundbild, wie es ist
    float m = hintergrund == 0 ? 1.0 : smoothstep(schwelle, schwelle + weich + 0.001, f.a);
    vec3 schicht = mix(start, f.rgb, w * m);
    if (art == 0) acc = max(acc, schicht);
    else if (art == 1) acc = min(acc, schicht);
    else if (art == 2) {
      // Mittel: jede Schicht ganz (nur die Maske), mit ihrem Gewicht gezählt
      acc += mix(start, f.rgb, m) * w;
      summeGewicht += w;
    }
    else if (art == 3) acc = i == 0 ? schicht : abs(acc - schicht);
    else acc = mix(acc, f.rgb, w * m); // überdecken: Neueres liegt oben, wie ausgeschnitten und aufgeklebt
  }
  if (art == 2) acc = summeGewicht > 0.0 ? acc / summeGewicht : start;
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

uniform sampler2DArray proben; // Ebenen richtig herum (aus dem Einlege-Durchgang)
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
    vec3 f = texture(proben, vec3(uv, float(i))).rgb;
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
uniform int ebene;    // >= 0: diese Ebene des Stapels zeigen, sonst bild
uniform bool alpha;   // den Alphakanal als Grau (die Maske)
uniform vec2 aufloesung;

out vec4 farbe;

void main() {
  vec2 uv = gl_FragCoord.xy / aufloesung;
  vec4 f = ebene >= 0 ? texture(stapel, vec3(uv, float(ebene))) : texture(bild, uv);
  farbe = vec4(alpha ? vec3(f.a) : f.rgb, 1.0);
}`;

// einfach durchreichen (Proben für den Median in ihr Array, richtig herum)
export const KOPIER_SHADER = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D bild;
uniform vec2 aufloesung;
out vec4 farbe;
void main() {
  farbe = vec4(texture(bild, gl_FragCoord.xy / aufloesung).rgb, 1.0);
}`;
