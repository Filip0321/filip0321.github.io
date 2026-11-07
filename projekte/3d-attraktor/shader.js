import { ladeVerlauf } from "/lib/verlauf.js";
import { hexZuRgb } from "/lib/farben.js";
import { EINHEIT } from "./lage.js";

// Flächen der Umgebung, für beide Shader gleich (wird unten in beide hineinkopiert).
// Jede Fläche ist eine Ebene: alle Punkte x mit dot(n, x) = d. n zeigt in den Raum hinein.
//   0 Boden   1 hinten   2 vorn   3 links   4 rechts   5 Decke
// "hinten" ist hinten von der Startansicht aus (die Kamera steht anfangs bei z < 0 und schaut nach +z).
const FLAECHEN = /* glsl */ `
const float LAMPE_BEZUG = 2.5; // in diesem Abstand ist das Licht der Lampe genau 1 (etwa Lampe bis Boden)

uniform int flaechen;   // welche an sind, als Bits: Boden = 1, hinten = 2, vorn = 4, links = 8, rechts = 16, Decke = 32
uniform float raum;     // halbe Breite des Raums; 0 = kein Raum, nur ein Boden ohne Ränder
uniform float boden;    // Höhe des Bodens; die Decke liegt bei boden + 2 · raum
uniform vec3 kamera;    // wo die Kamera in der Welt steht (aus zeichne(), für "welche Wand sieht man")

// Scheinwerfer: die Lampe leuchtet nur in einen Kegel um kegelRichtung.
// Ob x im Kegel liegt, sagt der Winkel zwischen kegelRichtung und dem Weg Lampe → x; verglichen wird
// sein Kosinus (dot zweier Richtungen der Länge 1): 1 = genau in der Mitte, kleiner = weiter außen.
// Zwischen kegelAussen (Rand) und kegelInnen (voll hell) weich überblenden, sonst wäre der Rand hart.
// Ohne Kegel ist kegelAussen kleiner als −1: dann liegt alles innen.
uniform vec3 kegelRichtung;
uniform float kegelInnen;   // Kosinus des Winkels, bis zu dem es voll hell ist
uniform float kegelAussen;  // Kosinus des Winkels, ab dem es dunkel ist

vec3 normale(int i) {
  if (i == 0) return vec3(0.0, 1.0, 0.0);
  if (i == 1) return vec3(0.0, 0.0, -1.0);
  if (i == 2) return vec3(0.0, 0.0, 1.0);
  if (i == 3) return vec3(1.0, 0.0, 0.0);
  if (i == 4) return vec3(-1.0, 0.0, 0.0);
  return vec3(0.0, -1.0, 0.0);
}

// d der Ebene: dot(normale, x) = d für jeden Punkt x auf der Fläche
float ebene(int i) {
  if (i == 0) return boden;
  if (i == 5) return -(boden + 2.0 * raum);
  return -raum; // die vier Wände stehen bei x oder z = ± raum
}

// liegt x innerhalb der Wände (mit etwas Spielraum für Rundungsfehler)? Ohne Raum ist alles innen.
float imKegel(vec3 x) {
  if (lampe < 0.5) return 1.0; // Sonne: kein Kegel
  return smoothstep(kegelAussen, kegelInnen, dot(normalize(x - lichtPos), kegelRichtung));
}

bool imRaum(vec3 x) {
  if (raum <= 0.0) return true;
  float e = 0.001;
  return abs(x.x) <= raum + e && abs(x.z) <= raum + e && x.y >= boden - e && x.y <= boden + 2.0 * raum + e;
}

// Die Kamera sieht eine Fläche nur von innen. Von außen (Kamera hinter der Wand) wird sie ausgeblendet,
// wie bei einem Puppenhaus, dem die vordere Wand fehlt: so verdeckt nie eine Wand den Attraktor.
bool sichtbar(int i) {
  return dot(normale(i), kamera) > ebene(i);
}

// Wo trifft der Strahl o + r · t zuerst eine Fläche (t > 0)? Ergebnis t, welche = Nummer oder −1.
// nurSichtbare: für den Blick der Kamera (ausgeblendete Wände sind durchsichtig);
// für Schatten zählen alle, auch ausgeblendete (dort fällt der Schatten dann ungesehen hin)
float ersteFlaeche(vec3 o, vec3 r, bool nurSichtbare, out int welche) {
  float beste = 1e9;
  welche = -1;
  for (int i = 0; i < 6; i++) {
    if ((flaechen & (1 << i)) == 0) continue; // Fläche aus
    if (nurSichtbare && !sichtbar(i)) continue;
    vec3 n = normale(i);
    float nr = dot(n, r);
    if (nr >= 0.0) continue; // der Strahl läuft von der Fläche weg (oder an ihr entlang)
    // o + r · t liegt auf der Ebene, wenn dot(n, o) + t · dot(n, r) = d
    float t = (ebene(i) - dot(n, o)) / nr;
    if (t <= 0.0 || t >= beste) continue;
    if (!imRaum(o + r * t)) continue; // trifft die Ebene außerhalb der Wand
    beste = t;
    welche = i;
  }
  return beste;
}
`;

const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec3 punkt; // welcher Punkt wird bearbeitet (3 dimensionen)
in vec3 naechster; // derselbe Puffer noch einmal, um einen Punkt verschoben: der Punkt danach
uniform float schrittMass; // typische Schrittlänge (siehe typischerSchritt): wird zu 1
out float tempo; // wie weit dieser Punkt zum nächsten springt, 0 langsam bis 1 schnell

uniform vec3 mitte; // mitte des Attraktors (nach vermessen)
uniform float mass; // größte Ausdehnung des Attraktors (aus vermessen)
uniform float winkel; // Drehung um senkrechte (um y-Achse -> x und z drehen)
uniform float neigung; // Drehung um waagerechte (um x-Achse -> y und z drehen)
uniform float abstand; // wie weit die Kamera weg ist (zoomen = Kamerafahrt)
uniform float brennweite;
uniform vec2 aufloesung;
uniform vec2 versatz;

uniform float kopf;
uniform float laenge;
uniform float rest; // wie hell der Attraktor außerhalb des Kometen bleibt
uniform float glanz;
out float leuchten;

uniform float punktgroesse; // Durchmesser in Canvas-Pixeln (schon mal dpr und auf das erlaubte Maß begrenzt)

// Schärfentiefe wie bei einer Kamera mit offener Blende: nur in der Fokus-Ebene ist ein Punkt ein Punkt,
// davor und dahinter wird er zu einem Scheibchen (Bokeh), das mit dem Abstand zur Ebene wächst
uniform float schaerfeAn;
uniform float fokus;          // 0 = Vorderseite des Attraktors scharf, 1 = Rückseite
uniform float bokeh;          // so viele Canvas-Pixel wächst ein Punkt pro Einheit Abstand zur Fokus-Ebene
uniform float groesstePunkte; // größer kann die Grafikkarte keine Punkte zeichnen
out float flaechenAnteil;     // dasselbe Licht auf eine größere Scheibe verteilt: pro Pixel weniger
uniform float nebel; // 0 = kein Nebel; je größer, desto schneller verblassen ferne Punkte
out float sicht; // wie viel vom Punkt durch den Nebel kommt, 1 vorn bis fast 0 hinten
out float naehe; // 1 an der Vorderseite des Attraktors, 0 an der Rückseite (für „Färben nach Tiefe“)

uniform float schattenModus; // 1 = diesen Durchgang die Punkte als Schatten auf Boden und Wände legen
uniform vec3 licht;          // Richtung, in die das Licht fällt (zeigt nach unten: y < 0)
uniform float lampe;         // 0 = Sonne (alle Strahlen parallel, licht), 1 = Lampe an der Stelle lichtPos
uniform vec3 lichtPos;       // wo die Lampe steht (in der Welt, Mitte = 0)
uniform int extraAnzahl;     // weitere Lampen (lampen.js), 0 bis 3
uniform vec3 extraPos[3];
uniform float extraStaerke[3];
out float lichtAufPunkt;     // wie hell die Lampe diesen Punkt trifft (1 bei der Sonne)
out float kegel;             // 1 = der Punkt liegt im Lichtkegel des Scheinwerfers, 0 = im Dunkeln

// Lage des Attraktors in der Welt (lage.js): Drehen, Kippen und Pendeln am Strick in einer Matrix,
// dazu eine Verschiebung. Boden, Wände und Licht gehören zur Welt, die Kamera schaut auf die Welt.
uniform mat3 lage;
uniform vec3 lageVersatz;

// Musik: das Spektrum formt den Attraktor. Innen (nah an der Mitte) wirkt der Bass, außen die Höhen;
// jeder Punkt wird so weit nach außen geschoben, wie laut seine Frequenz gerade ist
uniform sampler2D spektrumBild;  // 64 × 1: Lautstärke von tief (links) bis hoch (rechts), 0 bis 1
uniform float spektrumStaerke;   // 0 = aus

uniform float anzahl;
out float fortschritt; // ist 0 für den ersten und 1 für den letzten Punkt
${FLAECHEN}
// muss nicht aber will irgendwas rausgeben
// gerade noch placeholder für coolere effekte

void main() {
  vec3 p = ((punkt - mitte) / mass * 2.0); 
  // was ist der Abstand des Punktes zur Mitte und
  // verhältnis des punktes Abstand zur mitte zur länge (größte Ausdehnung) des Attraktors
  // 0 bis 1: positiver Abstand zur Mitte
  // 0 bis -1: negativer Abstand zur Mitte

  // Spektrum: Abstand zur Mitte (0 bis etwa 1) wählt die Frequenz, ihre Lautstärke schiebt nach außen
  if (spektrumStaerke > 0.0) {
    float r = length(p);
    float laut = texture(spektrumBild, vec2(clamp(r, 0.0, 1.0), 0.5)).r;
    if (r > 0.0) p += p / r * laut * spektrumStaerke * 0.3; // p / r: Richtung nach außen, Länge 1
  }

  // Der Attraktor in die Welt: gedreht, gekippt, am Strick ausgelenkt (alles in lage), dann verschoben.
  // Das passiert vor dem Schatten: dreht er sich, ändert sich sein Schatten.
  // Die Kamera kommt erst danach: dreht sie, sieht man dieselbe Welt von einer anderen Seite.
  p = lage * p + lageVersatz;

  // Licht der Lampe nimmt mit dem Abstand ab: doppelt so weit = ein Viertel (1 / r², die Fläche
  // einer Kugel um die Lampe wächst mit r²). In LAMPE_BEZUG Abstand ist es 1, ganz nah höchstens 4.
  vec3 zurLampe = lichtPos - p;
  kegel = imKegel(p); // außerhalb des Kegels kommt kein Licht hin: kein Licht auf dem Punkt, kein Schatten
  lichtAufPunkt = (lampe > 0.5 ? min(LAMPE_BEZUG * LAMPE_BEZUG / dot(zurLampe, zurLampe), 4.0) : 1.0) * kegel;
  // weitere Lampen (lampen.js) machen die Punkte auch heller, wie die Lampe oben (nur ohne Kegel)
  for (int k = 0; k < 3; k++) {
    if (k >= extraAnzahl) break;
    vec3 z = extraPos[k] - p;
    lichtAufPunkt += extraStaerke[k] * min(LAMPE_BEZUG * LAMPE_BEZUG / dot(z, z), 4.0);
  }

  // Schatten: vom Punkt aus in Lichtrichtung weiter, bis zur ersten Fläche (Boden, Wand oder Decke).
  // Sonne: alle Strahlen parallel (licht). Lampe: der Strahl geht von der Lampe durch den Punkt,
  // jeder Punkt hat seine eigene Richtung; dadurch wird der Schatten größer, je näher die Lampe ist.
  if (schattenModus > 0.5) {
    vec3 strahl = lampe > 0.5 ? normalize(p - lichtPos) : licht;
    int welche;
    float t = ersteFlaeche(p, strahl, false, welche);
    if (welche < 0 || !sichtbar(welche)) {
      // trifft keine Fläche oder eine ausgeblendete: dieser Schatten ist nicht zu sehen
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // außerhalb des Bildes: wird nicht gezeichnet
      return;
    }
    p += strahl * t;
  }

  // Drehen
  // ------
  // x' = x * cos(w) - y * sin(w)
  // y' = x * sin(w) + y * cos(w)
  // 
  // w ist Winkel und sonst einfach die Formel des Einheitskreises

  // um die y-Achse (winkel)
  float c = cos(winkel); 
  float s = sin(winkel);
  float drehenYX = p.x * c - p.z * s;
  float drehenYZ = p.x * s + p.z * c;
  p.x = drehenYX;
  p.z = drehenYZ;

  // um die x-Achse (neigung)
  c = cos(neigung); 
  s = sin(neigung);
  float drehenXY = p.y * c - p.z * s;
  float drehenXZ = p.y * s + p.z * c;
  p.y = drehenXY;
  p.z = drehenXZ;

  // Perspektive: die Grafikkarte teilt selbst durch den 4. Wert
  float tiefe = p.z + abstand;
  gl_Position = vec4(
    // entweder x mal Verhältnis Bilddimension y zu x (wenn es sich nach der hoehe richten soll)
    // oder y mal Verhältnis Bilddimension x zu y --> damit es quadratisch wird
    p.x * brennweite * (aufloesung.y / aufloesung.x), 
    p.y * brennweite, 
    0.0, 
    tiefe
  );
  // gl_Position teilt selber durch die letzte Zahl
  // Perspektive ist wie bei einer Kamera - Kegelförmige Ausdehnung vom Sensor aus
  // --> je weiter weg oder größer die tiefe, desto näher sind die Punkte zusammen
  // wie bei der Lochkamera: Bild = Gegenstand · (Loch bis Papier) / (Loch bis Gegenstand)
  // brennweite = Loch bis Papier, tiefe = Loch bis Punkt
  gl_Position.xy += versatz * tiefe; 
  // nach dem Teilen durch tiefe bleibt genau versatz übrig
  gl_PointSize = punktgroesse;
  flaechenAnteil = 1.0;
  if (schaerfeAn > 0.5 && schattenModus < 0.5) {
    float fokusTiefe = abstand - 1.0 + 2.0 * fokus; // der Attraktor liegt zwischen abstand − 1 und abstand + 1
    float durchmesser = min(punktgroesse + abs(tiefe - fokusTiefe) * bokeh, groesstePunkte);
    // Fläche wächst mit dem Durchmesser im Quadrat; so bleibt die Helligkeit insgesamt gleich
    flaechenAnteil = (punktgroesse * punktgroesse) / (durchmesser * durchmesser);
    gl_PointSize = durchmesser;
  }

  // Tiefennebel: der Attraktor liegt zwischen tiefe = abstand − 1 (vorn) und abstand + 1 (hinten),
  // weil p nach dem Teilen durch mass zwischen −1 und 1 liegt. Gemessen ab der Vorderseite,
  // damit der Nebel beim Heranfahren nicht dünner wird: Nebel gehört zum Attraktor, nicht zur Kamera.
  // exp(): nach jeder gleich langen Strecke kommt derselbe Anteil Licht durch (wie in echtem Nebel)
  float hinterVorderseite = max(tiefe - (abstand - 1.0), 0.0); // 0 vorn bis etwa 2 hinten
  sicht = exp(-nebel * hinterVorderseite);
  naehe = clamp(1.0 - hinterVorderseite / 2.0, 0.0, 1.0);

  fortschritt = float(gl_VertexID) / anzahl;
  tempo = clamp(length(naechster - punkt) / schrittMass, 0.0, 1.0); // im Raum des Attraktors, vor dem Drehen
  float hinter = mod(kopf - float(gl_VertexID), anzahl);
  if (hinter < laenge) {
    leuchten = (1.0 - hinter / laenge) * glanz; 
  } else {
    leuchten = rest;
  }
}`

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

// 1. Durchgang: zählen. Jeder Punkt addiert sich in unsichtbare Bilder:
// Bild 0: a = wie viel er zählt (1, beim Travel sein Leuchten), rgb = seine Farbe mal so viel
// Bild 1: r = wie viel er zählt mal wie viel von ihm durch den Nebel kommt,
//         g = wie viel er zählt mal wie hell ihn die Lampe trifft
// Bild 2: r = wie viel er zählt, aber nur im Schatten-Durchgang (der Punkt liegt dann auf dem Boden)
in float leuchten;
uniform float travel;
in float sicht;
in float naehe;
in float tempo;
in float lichtAufPunkt;
in float kegel;
in float flaechenAnteil;
uniform float teilGewicht; // Bewegungsunschärfe: ein Bild aus mehreren Zwischenschritten, jeder zählt 1 / Anzahl
uniform float weich;   // 1 = weich nach außen auslaufen, 0 = harte Scheibe
uniform float alsLinie; // 1 = als durchgehende Linie gezeichnet: dann gibt es keinen runden Punkt
uniform float verlaufVersatz; // Musik: so weit ist die Farbe im Verlauf weitergewandert

in float fortschritt;
uniform vec3 punktfarbe;
uniform float faerbung; // 1 = nach Reihenfolge, 3 = nach Tiefe, 4 = nach Geschwindigkeit (nur dann braucht das Zählen Farben)
uniform sampler2D verlauf;

// zwei Ausgänge: location 0 geht ins erste Bild des Framebuffers, location 1 ins zweite (drawBuffers)
layout(location = 0) out vec4 farbe;
layout(location = 1) out vec4 nebelSumme;
layout(location = 2) out vec4 schattenSumme;

// Stelle im Verlauf, um verlaufVersatz verschoben. Am Ende geht es rückwärts weiter (hin und her
// wie ein Pendel): 0 → 1 → 0 … So gibt es keinen harten Sprung vom Ende zurück an den Anfang.
// Ohne Versatz bleibt x, wie es ist (1 − |1 − x| = x für x zwischen 0 und 1)
float imVerlauf(float x) {
  return 1.0 - abs(1.0 - mod(x + verlaufVersatz, 2.0));
}

void main() {
  float abstand2 = 0.0; // Abstand zur Mitte des Punktes im Quadrat (spart die Wurzel)
  if (alsLinie < 0.5) {
    // gl_PointCoord: Stelle im Punkt-Quadrat von (0, 0) bis (1, 1); daraus -1 bis 1 mit der Mitte bei 0
    // (bei Linien gibt es kein Punkt-Quadrat, gl_PointCoord wäre dort sinnlos)
    vec2 mitte = gl_PointCoord * 2.0 - 1.0;
    abstand2 = dot(mitte, mitte);
    if (abstand2 > 1.0) discard; // außerhalb des Kreises: dieser Pixel zählt gar nicht
  }

  vec3 grundfarbe = punktfarbe; // eine Farbe für alle
  if (faerbung > 0.5 && faerbung < 1.5) grundfarbe = texture(verlauf, vec2(imVerlauf(fortschritt), 0.5)).rgb; // nach Reihenfolge
  if (faerbung > 2.5 && faerbung < 3.5) grundfarbe = texture(verlauf, vec2(imVerlauf(naehe), 0.5)).rgb; // nach Tiefe: vorn = Ende
  if (faerbung > 3.5) grundfarbe = texture(verlauf, vec2(imVerlauf(tempo), 0.5)).rgb; // nach Geschwindigkeit: schnell = Ende

  // Gewicht = wie viel dieser Pixel zählt: Travel (der Komet zählt mehr, der Rest weniger) und weicher Rand
  float gewicht = travel > 0.5 ? leuchten : 1.0;
  if (weich > 0.5 && alsLinie < 0.5) gewicht *= exp(-abstand2 * 3.0);
  gewicht *= flaechenAnteil * teilGewicht;
  farbe = vec4(grundfarbe * gewicht, gewicht);
  // der Nebel zählt extra mit: so weiß der 2. Durchgang, wie viel von den Punkten in diesem Pixel
  // im Schnitt durch den Nebel kommt, und kann sie zum Hintergrund hin verblassen lassen
  nebelSumme = vec4(gewicht * sicht, gewicht * lichtAufPunkt, 0.0, 0.0);
  // welches der drei Bilder wirklich beschrieben wird, entscheidet drawBuffers in zeichne():
  // beim Attraktor Bild 0 und 1, beim Schatten nur Bild 2
  // ein Punkt außerhalb des Lichtkegels wirft keinen Schatten (er steht ja gar nicht im Licht)
  // in alle vier Kanäle: welcher wirklich beschrieben wird, entscheidet gl.colorMask (pro Lampe ein Kanal,
  // Rot für das Licht oben, Grün, Blau, Alpha für die weiteren Lampen)
  schattenSumme = vec4(gewicht * kegel);
}`;

const VERTEX_SHADER_FARBE = /* glsl */ `#version 300 es
out vec2 uv; // 0 bis 1 über den Bildschirm
void main() {
  // aus gl_VertexID 0, 1, 2 werden die Ecken (0,0), (2,0), (0,2): ein großes Dreieck,
  // das über den Bildschirm hinausragt; der Teil im Bild deckt alles ab
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 2. Durchgang: färben, genau wie im 2D-Attraktor, dazu Boden, Wände, Licht und Faden
const FRAGMENT_SHADER_FARBE = /* glsl */ `#version 300 es
precision highp float;
precision highp int; // wie im Vertex-Shader: flaechen ist in beiden, und dort ist int von selbst highp

in vec2 uv;
uniform sampler2D dichte;     // rgb: Summe der Farben, a: Anzahl der Punkte
uniform sampler2D nebelBild;  // r: Anzahl mal Sicht durch den Nebel, g: Anzahl mal Licht der Lampe
uniform sampler2D verlauf;
uniform vec3 hintergrund;
uniform vec3 punktfarbe;
uniform float faerbung;    // 0 eine Farbe, 1 Reihenfolge, 2 Dichte, 3 Tiefe, 4 Geschwindigkeit
uniform float staerke;
uniform float verlaufVersatz; // wie im 1. Durchgang

uniform sampler2D schattenBild; // r: wie viele Schatten-Punkte in diesem Pixel auf einer Fläche liegen (g, b, a: die weiteren Lampen)
uniform float schattenAn;
uniform float schattenStaerke;  // 0 kein Schatten bis 1 ganz in Schattenfarbe
uniform vec3 bodenfarbe;
uniform vec3 wandfarbe;
uniform vec3 schattenfarbe;

// Licht auf den Flächen
uniform float umgebung;      // Licht, das von überall kommt (1 = alles gleich hell wie bisher, 0 = nur die Lampe)
uniform vec3 licht;          // Richtung der Sonne
uniform float lampe;
uniform vec3 lichtPos;
uniform float punkteBeleuchten; // wie stark die Lampe die Punkte selbst heller und dunkler macht
uniform vec3 lampeBild;      // xy: wo die Lampe im Bild ist (−1 bis 1), z: 1 = zeigen
// weitere Lampen (lampen.js): jede mit Ort, Farbe, Helligkeit, Kegel (innen, außen als Kosinus, wie oben),
// eigenem Schatten (Kanal g, b, a der Schattentextur) und wo sie im Bild ist (z: 1 = zeigen)
uniform int extraAnzahl;
uniform vec3 extraPos[3];
uniform vec3 extraFarbe[3];
uniform float extraStaerke[3];
uniform vec3 extraRichtung[3];
uniform vec2 extraKegel[3];
uniform float extraSchatten[3];
uniform vec3 extraBild[3];
// Fäden und Balken (Strick, Mobile): bis zu 16 Strecken im Bild, je (x1, y1, x2, y2) von −1 bis 1
uniform vec4 striche[16];
uniform float strichDicke[16]; // in Canvas-Pixeln: Fäden dünn, Balken dicker
uniform int strichAnzahl;
uniform vec3 fadenfarbe;
${FLAECHEN}
// dieselbe Kamera wie im 1. Durchgang, hier rückwärts gebraucht
uniform float winkel;
uniform float neigung;
uniform float abstand;
uniform float brennweite;
uniform vec2 aufloesung;
uniform vec2 versatz;
out vec4 farbe;

// Drehungen aus dem Vertex-Shader rückgängig machen: in umgekehrter Reihenfolge
// (erst die Neigung, sie kam zuletzt) und jeweils mit dem negativen Winkel:
// cos(−w) = cos(w), sin(−w) = −sin(w), darum stehen die Vorzeichen bei s umgekehrt
vec3 zurueckDrehen(vec3 p) {
  float c = cos(neigung);
  float s = sin(neigung);
  float y = p.y * c + p.z * s;
  float z = -p.y * s + p.z * c;
  p.y = y;
  p.z = z;

  c = cos(winkel);
  s = sin(winkel);
  float x = p.x * c + p.z * s;
  z = -p.x * s + p.z * c;
  p.x = x;
  p.z = z;
  return p;
}

// Welche Fläche sieht man durch diesen Pixel, und wo?
// Der Vertex-Shader rechnet Punkt → Pixel; hier geht es andersherum: Pixel → Strahl → Fläche.
// Vor dem Rückdrehen sitzt die Kamera bei (0, 0, −abstand) und schaut entlang z.
// Ein Punkt in der Tiefe t landet bei x · brennweite / t (Lochkamera), also liegt der Strahl
// für den Pixel n bei x = (n − versatz) / brennweite · t: pro Schritt t eine feste Richtung.
// Ausgeblendete Flächen (von hinten gesehen) zählen nicht: sie würden den Attraktor verdecken.
int trifftFlaeche(vec2 n, out vec3 treffer) {
  vec3 richtung = vec3(
    (n.x - versatz.x) / (brennweite * aufloesung.y / aufloesung.x),
    (n.y - versatz.y) / brennweite,
    1.0
  );
  richtung = zurueckDrehen(richtung);
  int welche;
  float t = ersteFlaeche(kamera, richtung, true, welche);
  treffer = kamera + richtung * t;
  return welche;
}

// Wie hell trifft das Licht diese Stelle? Schräg auftreffendes Licht verteilt sich auf mehr Fläche:
// darum der Kosinus des Winkels zwischen Licht und Normale (dot zweier Richtungen der Länge 1).
// Bei der Lampe dazu 1 / r² wie bei den Punkten.
float beleuchtung(vec3 x, vec3 n) {
  float direkt;
  if (lampe > 0.5) {
    vec3 zurLampe = lichtPos - x;
    direkt = max(dot(n, normalize(zurLampe)), 0.0) * min(LAMPE_BEZUG * LAMPE_BEZUG / dot(zurLampe, zurLampe), 4.0)
           * imKegel(x); // Scheinwerfer: nur im Kegel
  } else {
    direkt = max(dot(n, -licht), 0.0);
  }
  return umgebung + (1.0 - umgebung) * direkt;
}

// Abstand des Pixels p zur Strecke a–b (alles in Pixeln): für den Faden
float abstandZurStrecke(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); // nächste Stelle auf der Strecke, 0 bis 1
  return length(p - (a + ab * t));
}

void main() {
  vec4 d = texture(dichte, uv);
  float h = 1.0 - exp(-d.a * staerke); // wie stark der Pixel bedeckt ist, 0 bis 1
  // im Schnitt durchgelassen: 1 ohne Nebel, nahe 0 ganz hinten im dichten Nebel
  float sicht = d.a > 0.0 ? texture(nebelBild, uv).r / d.a : 1.0;
  // im Schnitt das Licht der Lampe auf den Punkten dieses Pixels (1 bei der Sonne)
  float lampenLicht = d.a > 0.0 ? texture(nebelBild, uv).g / d.a : 1.0;

  vec3 punkt = punktfarbe;
  vec2 nebel = texture(nebelBild, uv).rg;
  if ((faerbung > 0.5 && faerbung < 1.5) || faerbung > 2.5) {
    // d.rgb enthält die aufsummierten Punktfarben: geteilt durch die Anzahl = Durchschnittsfarbe
    punkt = d.a > 0.0 ? d.rgb / d.a : punktfarbe;
  } else if (faerbung > 1.5) {
    // Verlauf nach Dichte: dünn = Anfang des Verlaufs, dicht = Ende
    float x = 1.0 - abs(1.0 - mod(clamp(h, 0.0, 1.0) + verlaufVersatz, 2.0)); // wie imVerlauf()
    punkt = texture(verlauf, vec2(x, 0.5)).rgb;
  }
  // die Lampe macht nahe Punkte heller, ferne dunkler (punkteBeleuchten 0 = wie bisher)
  punkt = min(punkt * mix(1.0, lampenLicht, punkteBeleuchten), vec3(1.0));

  // Boden, Wände und Schatten: liegen hinter allen Punkten, die Punkte kommen danach darüber
  vec3 grund = hintergrund;
  vec3 treffer;
  int welche = schattenAn > 0.5 ? trifftFlaeche(uv * 2.0 - 1.0, treffer) : -1;
  if (welche >= 0) {
    // ohne Raum: runder Boden um die Mitte, nach außen weich in den Hintergrund auslaufend
    // (keine harte Kante am Horizont); im Raum enden Boden und Wände an den Ecken
    float anteil = raum > 0.0 ? 1.0 : 1.0 - smoothstep(1.2, 2.8, length(treffer.xz));
    vec3 flaeche = (welche == 0 ? bodenfarbe : wandfarbe) * beleuchtung(treffer, normale(welche));
    // Schatten wie die Punkte: je mehr Schatten-Punkte, desto dunkler, nie mehr als ganz
    vec4 schattenZahl = texture(schattenBild, uv);
    float schatten = (1.0 - exp(-schattenZahl.r * staerke)) * schattenStaerke;
    vec3 hell = mix(flaeche, schattenfarbe, schatten);
    // weitere Lampen: ihr Licht kommt dazu (Farbe der Fläche mal Farbe der Lampe), jede mit 1 / r², Kegel
    // und ihrem eigenen Schatten. Nicht mit dem Umgebungslicht verrechnet, sonst sähe man bei 1 nichts.
    vec3 n = normale(welche);
    vec3 basis = welche == 0 ? bodenfarbe : wandfarbe;
    for (int k = 0; k < 3; k++) {
      if (k >= extraAnzahl) break;
      vec3 z = extraPos[k] - treffer;
      float im = smoothstep(extraKegel[k].y, extraKegel[k].x, dot(normalize(-z), extraRichtung[k]));
      float direkt = max(dot(n, normalize(z)), 0.0) * min(LAMPE_BEZUG * LAMPE_BEZUG / dot(z, z), 4.0) * im;
      float s = extraSchatten[k] > 0.5 ? (1.0 - exp(-schattenZahl[k + 1] * staerke)) * schattenStaerke : 0.0;
      hell += basis * extraFarbe[k] * extraStaerke[k] * direkt * (1.0 - s) * 2.0;
    }
    grund = mix(hintergrund, hell, anteil);
  }

  // Fäden und Balken: jede Strecke als Linie ihrer Dicke, an den Rändern weich
  vec2 pixel = uv * aufloesung;
  for (int i = 0; i < 16; i++) {
    if (i >= strichAnzahl) break;
    vec2 a = (striche[i].xy * 0.5 + 0.5) * aufloesung; // −1 bis 1 → Pixel
    vec2 b = (striche[i].zw * 0.5 + 0.5) * aufloesung;
    float d = abstandZurStrecke(pixel, a, b);
    float halb = strichDicke[i] * 0.5;
    grund = mix(grund, fadenfarbe, 1.0 - smoothstep(halb, halb + 1.5, d));
  }

  // Lampe sichtbar: ein weicher Lichtpunkt (verdeckt nichts, liegt einfach darüber)
  if (lampeBild.z > 0.5) {
    float r = length(pixel - (lampeBild.xy * 0.5 + 0.5) * aufloesung) / (0.012 * aufloesung.y);
    grund += vec3(1.0, 0.92, 0.75) * exp(-r * r);
  }

  for (int k = 0; k < 3; k++) {
    if (k >= extraAnzahl || extraBild[k].z < 0.5) continue;
    float r = length(pixel - (extraBild[k].xy * 0.5 + 0.5) * aufloesung) / (0.012 * aufloesung.y);
    grund += mix(vec3(1.0), extraFarbe[k], 0.6) * exp(-r * r);
  }

  // Nebel: was hinten liegt, geht im Grund (Hintergrund oder Boden) auf, egal wie dicht es ist
  farbe = vec4(mix(grund, punkt, h * sicht), 1.0);
}`;

/*
  Punktliste
      │
      ▼
Vertex-Shader      einmal pro Punkt: Wo liegt er auf dem Bildschirm?
      │
      ▼
Rasterisierung     die Grafikkarte macht aus jedem Punkt Pixel
      │
      ▼
Fragment-Shader    einmal pro Pixel: Welche Farbe hat er?
      │
      ▼
    Bild
*/

function baueShader(gl, typ, quelltext) {
  const shader = gl.createShader(typ);
  // erstellt erstmal einen shader, also VERTEX_SHADER oder FRAGMENT_SHADER
  // an die wird dann der Text von meinen übergeben (quelltext)
  gl.shaderSource(shader, quelltext);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function baueProgramm(gl, vertex, fragment) {
  const programm = gl.createProgram();
  // gl.VERTEX_SHADER ist nur die Art (eine Nummer von WebGL),
  // vertex (ohne gl.) ist mein Quelltext von oben
  gl.attachShader(programm, baueShader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(programm, baueShader(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(programm);
  if (!gl.getProgramParameter(programm, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(programm));
  }
  return programm;
}

// leere Textur mit Kommazahlen (format: RGBA16F mit 4 Kanälen, RG16F mit zwei oder R16F mit einem)
function kommazahlTextur(gl, breite, hoehe, format, kanaele) {
  const textur = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textur);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, breite, hoehe, 0, kanaele, gl.HALF_FLOAT, null); // null: leer
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); // ein Pixel = ein Pixel, nichts mischen
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return textur;
}

// unsichtbare Bilder mit Kommazahlen, in die die Punkte gezählt werden:
// textur (Farben und Anzahl) und nebel (Anzahl mal Sicht, Anzahl mal Lampenlicht), beide in einem Durchgang,
// dazu schatten (Anzahl der Schatten-Punkte auf den Flächen), in einem eigenen Durchgang
function erstelleDichtePuffer(gl, breite, hoehe) {
  const textur = kommazahlTextur(gl, breite, hoehe, gl.RGBA16F, gl.RGBA);
  const nebel = kommazahlTextur(gl, breite, hoehe, gl.RG16F, gl.RG);
  const schatten = kommazahlTextur(gl, breite, hoehe, gl.RGBA16F, gl.RGBA); // ein Kanal pro Lampe (lampen.js)
  const fb = gl.createFramebuffer(); // "Zeichne hierhin statt auf den Bildschirm"
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textur, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nebel, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, schatten, 0);
  // welche Ausgänge des Shaders wohin gehen (location 0 → Bild 0 …), stellt zeichne() je Durchgang ein
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // wieder der Bildschirm
  return { textur, nebel, schatten, fb, breite, hoehe };
}

export function erstelleShader(canvas) {
  // preserveDrawingBuffer: das Bild bleibt nach dem Zeichnen stehen,
  // sonst können "Bild speichern", Video-Export und die Effekt-Schicht
  // es später nicht mehr auslesen (sie sehen dann nur Schwarz)
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, alpha: false });
  if (!gl) throw new Error("Dein Browser unterstützt kein WebGL2.");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Dein Browser kann nicht in Kommazahl-Texturen zeichnen.");

  const punktProgramm = baueProgramm(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  const farbProgramm = baueProgramm(gl, VERTEX_SHADER_FARBE, FRAGMENT_SHADER_FARBE);
  // Punktlisten: Nummer 0 ist der Attraktor, beim Mobile kommen weitere dazu (je eigener Puffer)
  const koerperListe = []; // [{ puffer, anzahl, schrittMass }, …]
  const ort = gl.getAttribLocation(punktProgramm, "punkt");
  const ortNaechster = gl.getAttribLocation(punktProgramm, "naechster");
  let anzahl = 0; // Punkte des Attraktors (Nummer 0)

  function orte(programm, namen) {
    // Orte der Uniforms einmal nachschlagen, nicht bei jedem Bild
    const uniform = {};
    for (const name of namen) {
      uniform[name] = gl.getUniformLocation(programm, name);
    }
    return uniform;
  }
  const punktOrte = orte(punktProgramm, ["mitte", "mass", "winkel", "neigung",
                                         "abstand", "brennweite", "aufloesung", "versatz",
                                         "anzahl", "travel", "kopf", "laenge", "rest", "glanz",
                                         "punktfarbe", "faerbung", "verlauf", "schrittMass",
                                         "punktgroesse", "weich", "nebel",
                                         "schattenModus", "licht", "lampe", "lichtPos", "lage", "lageVersatz",
                                         "spektrumBild", "spektrumStaerke", "alsLinie", "verlaufVersatz",
                                         "flaechen", "raum", "boden", "kamera", "kegelRichtung", "kegelInnen", "kegelAussen",
                                         "schaerfeAn", "fokus", "bokeh", "groesstePunkte", "teilGewicht",
                                         "extraAnzahl", "extraPos", "extraStaerke"]);

  // wie groß ein Punkt auf diesem Gerät höchstens sein darf (oft 1 bis 1024, auf manchen Handys viel weniger)
  const [kleinstePunkte, groesstePunkte] = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);

  const farbOrte = orte(farbProgramm, ["dichte", "nebelBild", "verlauf", "hintergrund", "punktfarbe", "faerbung", "staerke",
                                       "schattenBild", "schattenAn", "schattenStaerke", "bodenfarbe", "wandfarbe", "schattenfarbe",
                                       "winkel", "neigung", "abstand", "brennweite", "aufloesung", "versatz", "verlaufVersatz",
                                       "umgebung", "licht", "lampe", "lichtPos", "punkteBeleuchten",
                                       "lampeBild", "striche", "strichDicke", "strichAnzahl", "fadenfarbe",
                                       "flaechen", "raum", "boden", "kamera", "kegelRichtung", "kegelInnen", "kegelAussen",
                                       "extraAnzahl", "extraPos", "extraFarbe", "extraStaerke", "extraRichtung", "extraKegel",
                                       "extraSchatten", "extraBild"]);

  // dieselbe Kamera wie im Vertex-Shader, in JavaScript: für die Kamera in der Welt,
  // die Lampe und den Faden im Bild
  function zurueckDrehen([x, y, z], winkel, neigung) {
    let c = Math.cos(neigung);
    let s = Math.sin(neigung);
    [y, z] = [y * c + z * s, -y * s + z * c];
    c = Math.cos(winkel);
    s = Math.sin(winkel);
    [x, z] = [x * c + z * s, -x * s + z * c];
    return [x, y, z];
  }

  // Punkt in der Welt → Stelle im Bild (−1 bis 1), oder null, wenn er hinter der Kamera liegt
  function insBild([x, y, z], { winkel, neigung, abstand, brennweite, versatz }) {
    let c = Math.cos(winkel);
    let s = Math.sin(winkel);
    [x, z] = [x * c - z * s, x * s + z * c];
    c = Math.cos(neigung);
    s = Math.sin(neigung);
    [y, z] = [y * c - z * s, y * s + z * c];
    const tiefe = z + abstand;
    if (tiefe <= 0.01) return null;
    return [
      (x * brennweite * (canvas.height / canvas.width)) / tiefe + versatz.x,
      (y * brennweite) / tiefe + versatz.y,
    ];
  }

  const verlaufTextur = gl.createTexture();

  // Spektrum der Musik als Bild 64 × 1 mit einem Kanal (R8: 0 bis 255 wird im Shader 0 bis 1),
  // LINEAR: zwischen zwei Frequenzbändern weich mischen
  const SPEKTRUM_BAENDER = 64;
  const spektrumTextur = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, spektrumTextur);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SPEKTRUM_BAENDER, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(SPEKTRUM_BAENDER));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  function setzeVerlauf(tabelle) {
    ladeVerlauf(gl, tabelle, verlaufTextur);
  }

  // Punkte einmal zur Grafikkarte schicken; nummer 0 = der Attraktor, 1, 2, … = weitere (Mobile)
  function ladePunkte(daten, nummer = 0) {
    koerperListe[nummer] ??= { puffer: gl.createBuffer(), anzahl: 0, schrittMass: 1 };
    const koerper = koerperListe[nummer];
    // durch 3 teilen, damit man weiß wieviele einzelne Punkte (alle x, y und z)
    koerper.anzahl = daten ? daten.length / 3 : 0;
    if (nummer === 0) anzahl = koerper.anzahl;
    if (!daten) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, koerper.puffer);
    gl.bufferData(gl.ARRAY_BUFFER, daten, gl.STATIC_DRAW);
    koerper.schrittMass = typischerSchritt(daten, koerper.anzahl);
  }

  // Wie weit springt ein Punkt typischerweise zum nächsten? Für „Färben nach Geschwindigkeit“:
  // die Schrittlänge wird durch diesen Wert geteilt, damit 0 bis 1 herauskommt.
  // Genommen wird nicht der größte Schritt (ein einzelner Ausreißer würde alles andere dunkel machen),
  // sondern der, den 95 % der Schritte nicht überschreiten. Dafür reichen 20 000 zufällige Stichproben.
  function typischerSchritt(daten, n) {
    const proben = [];
    for (let k = 0; k < Math.min(20000, n - 1); k++) {
      const i = Math.floor(Math.random() * (n - 1)) * 3;
      let summe = 0;
      for (let a = 0; a < 3; a++) summe += (daten[i + 3 + a] - daten[i + a]) ** 2;
      proben.push(Math.sqrt(summe));
    }
    proben.sort((a, b) => a - b);
    return proben[Math.floor(proben.length * 0.95)] || 1; // || 1: nie durch 0 teilen
  }


  let dichte = null; // der Dichte-Puffer, angelegt beim ersten Zeichnen

  // Ein Bild zeichnen, so oft man will, ohne neu zu rechnen
  // sichtbar: wie viele Punkte gezeichnet werden (zum Entstehen lassen), ohne Angabe alle
  function zeichne({ mitteX, mitteY, mitteZ, mass,
                     winkel, neigung, abstand, brennweite, staerke,
                     travel, laenge, kopf, rest, glanz, versatz,
                     punktfarbe, faerbung, hintergrund, punktgroesse, weich, nebel,
                     boden, lage = EINHEIT, lageVersatz = [0, 0, 0],
                     schatten, lichtRichtung, lichtHoehe, schattenStaerke, bodenfarbe, schattenfarbe,
                     licht: lichtArt = "sonne", lampenAbstand = 3, darstellung = "punkte",
                     umgebung: raumArt = "boden", raumGroesse = 2, wandfarbe = "#202020",
                     wandHinten, wandVorn, wandLinks, wandRechts, decke,
                     umgebungslicht = 1, lampeZeigen = false, punkteBeleuchten = 0,
                     // Lampe: wo sie steht, wenn main.js das selbst rechnet (am Faden, gezogen); sonst aus den Reglern
                     lichtPos: lichtPosVorgabe = null,
                     // Scheinwerfer: Öffnung des Kegels in Grad (ganz, von Rand zu Rand), wie weich sein Rand ist (0 bis 1)
                     // und wohin er zeigt (Richtung der Länge 1)
                     kegel = 40, kegelWeich = 0.3, kegelRichtung = null,
                     faden = null, // Strick: { haken: [x, y, z], ende: [x, y, z] } in der Welt
                     striche = [], // Mobile: Fäden und Balken [{ von: [x, y, z], bis: [x, y, z], dicke }] in der Welt
                     // Mobile: welche Punktlisten wo hängen [{ nummer, mitte: [x, y, z], mass, lage, lageVersatz, sichtbar }];
                     // ohne Angabe nur der Attraktor (Nummer 0) mit mitteX … und lage von oben
                     koerper = null,
                     spektrum = null, spektrumStaerke = 0, verlaufVersatz = 0,
                     schaerfe = false, fokus = 0.5, unschaerfe = 8,
                     teil = null, // Bewegungsunschärfe: { nummer, von } = Zwischenschritt nummer von von
                     weitereLampen = [], // lampen.js: [{ pos, richtung, farbe, staerke, kegelInnen, kegelAussen, schatten, zeigen }]
                     sichtbar = anzahl }) {
    // Puffer passend zur Canvas-Größe; ändert sie sich, alten freigeben und neu anlegen
    if (!dichte || dichte.breite !== canvas.width || dichte.hoehe !== canvas.height) {
      if (dichte) {
        gl.deleteTexture(dichte.textur);
        gl.deleteTexture(dichte.nebel);
        gl.deleteTexture(dichte.schatten);
        gl.deleteFramebuffer(dichte.fb);
      }
      dichte = erstelleDichtePuffer(gl, canvas.width, canvas.height);
    }
    const art = { einfarbig: 0, reihenfolge: 1, dichte: 2, tiefe: 3, tempo: 4 }[faerbung];
    const [hr, hg, hb] = hexZuRgb(hintergrund);
    const [pr, pg, pb] = hexZuRgb(punktfarbe);
    // Licht aus Richtung (Grad um die Senkrechte) und Höhe (Grad über dem Boden);
    // der Vektor zeigt vom Licht weg, nach unten. Kugelkoordinaten wie bei einer Weltkugel:
    // cos(Höhe) ist der waagerechte Anteil, der sich nach der Richtung auf x und z verteilt
    const richtung = lichtRichtung * Math.PI / 180; // Grad → Bogenmaß
    const hoehe = lichtHoehe * Math.PI / 180;
    const licht = [-Math.cos(hoehe) * Math.cos(richtung), -Math.sin(hoehe), -Math.cos(hoehe) * Math.sin(richtung)];
    // die Lampe steht in derselben Richtung, aber nicht unendlich weit weg: lampenAbstand von der Mitte
    const lichtPos = lichtPosVorgabe ?? licht.map((k) => -k * lampenAbstand);
    const lampeAn = lichtArt === "sonne" ? 0 : 1; // Lampe und Scheinwerfer sind beide ein Punktlicht
    // Kegel als Kosinus seiner halben Öffnung (Mitte bis Rand); ohne Scheinwerfer kleiner als −1 = alles innen
    const halb = (kegel / 2) * Math.PI / 180;
    const kegelAussen = lichtArt === "scheinwerfer" ? Math.cos(halb) : -2;
    const kegelInnen = lichtArt === "scheinwerfer" ? Math.cos(halb * (1 - kegelWeich)) : -1.5;
    // ohne Angabe zeigt er auf die Mitte (0, 0, 0)
    const kegelZiel = kegelRichtung ?? (() => {
      const l = Math.hypot(...lichtPos) || 1;
      return lichtPos.map((k) => -k / l);
    })();

    // Umgebung: welche Flächen an sind, als Bits (Boden 1, hinten 2, vorn 4, links 8, rechts 16, Decke 32).
    // Im Raum enden Boden und Wände an seinen Ecken, ohne Raum ist der Boden eine weite Fläche.
    const imRaum = raumArt === "raum";
    let flaechen = 1;
    if (imRaum) {
      [wandHinten, wandVorn, wandLinks, wandRechts, decke].forEach((an, i) => {
        if (an) flaechen |= 1 << (i + 1);
      });
    }
    const raum = imRaum ? raumGroesse : 0;
    const kamera = zurueckDrehen([0, 0, -abstand], winkel, neigung); // wo die Kamera in der Welt steht
    const blick = { winkel, neigung, abstand, brennweite, versatz };
    const lampeImBild = lampeAn && lampeZeigen && schatten ? insBild(lichtPos, blick) : null;
    // alle Strecken ins Bild; eine, deren Ende hinter der Kamera liegt, fällt weg
    const alleStriche = faden ? [{ von: faden.haken, bis: faden.ende, dicke: 1 }, ...striche] : striche;
    const strichDaten = new Float32Array(16 * 4);
    const dickeDaten = new Float32Array(16);
    let strichAnzahl = 0;
    for (const strich of alleStriche) {
      const a = insBild(strich.von, blick);
      const b = insBild(strich.bis, blick);
      if (!a || !b || strichAnzahl === 16) continue;
      strichDaten.set([...a, ...b], strichAnzahl * 4);
      dickeDaten[strichAnzahl] = (strich.dicke ?? 1) * (canvas.width / Math.max(canvas.clientWidth, 1)); // CSS-Pixel → Canvas-Pixel
      strichAnzahl++;
    }
    // Punktgröße in Bildschirm-Pixeln: der Canvas rechnet mindestens doppelt so fein (dpr in main.js)
    const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
    const groesse = Math.min(Math.max(punktgroesse * dpr, kleinstePunkte), groesstePunkte);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Verlauf liegt in beiden Durchgängen auf Platz 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, verlaufTextur);

    // 1. Durchgang: Punkte zählen, in den Dichte-Puffer statt auf den Bildschirm
    gl.bindFramebuffer(gl.FRAMEBUFFER, dichte.fb);
    // Bewegungsunschärfe: nur beim ersten Zwischenschritt leeren, die anderen zählen dazu
    const ersterTeil = !teil || teil.nummer === 0;
    const letzterTeil = !teil || teil.nummer === teil.von - 1;
    if (ersterTeil) {
      // clear leert nur die Bilder, die drawBuffers gerade nennt: hier alle drei
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.clearColor(0, 0, 0, 0); // leer: noch kein Punkt gezählt
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    // was gezeichnet wird: der Attraktor allein oder die Teile des Mobiles
    const zuZeichnen = koerper ?? [{ nummer: 0, mitte: [mitteX, mitteY, mitteZ], mass, lage, lageVersatz, sichtbar }];
    if (zuZeichnen.some((k) => koerperListe[k.nummer]?.anzahl > 0)) {
      gl.useProgram(punktProgramm);
      // einfach wieviele uniform floats 1f, 2f oder 3f und ihren Namen die Werte geben
      // dadurch können die daten aus der javascript datei weitergegeben werden
      gl.uniform1f(punktOrte.winkel, winkel);
      gl.uniform1f(punktOrte.neigung, neigung);
      gl.uniform1f(punktOrte.abstand, abstand);
      gl.uniform1f(punktOrte.brennweite, brennweite);
      gl.uniform2f(punktOrte.aufloesung, canvas.width, canvas.height);
      gl.uniform2f(punktOrte.versatz, versatz.x, versatz.y);
      gl.uniform1f(punktOrte.travel, travel ? 1 : 0);
      gl.uniform1f(punktOrte.laenge, laenge);
      gl.uniform1f(punktOrte.kopf, kopf);
      gl.uniform1f(punktOrte.rest, rest);
      gl.uniform1f(punktOrte.glanz, glanz);
      gl.uniform3f(punktOrte.punktfarbe, pr / 255, pg / 255, pb / 255);
      gl.uniform1f(punktOrte.faerbung, art === 2 ? 0 : art); // nur „Dichte“ und „eine Farbe“ brauchen beim Zählen keine Farben
      gl.uniform1i(punktOrte.verlauf, 1);
      gl.uniform1f(punktOrte.punktgroesse, groesse);
      gl.uniform1f(punktOrte.weich, weich ? 1 : 0);
      gl.uniform1f(punktOrte.nebel, nebel);
      gl.uniform3f(punktOrte.licht, ...licht);
      gl.uniform1f(punktOrte.boden, boden);
      gl.uniform1f(punktOrte.lampe, lampeAn);
      gl.uniform3f(punktOrte.lichtPos, ...lichtPos);
      gl.uniform1i(punktOrte.flaechen, flaechen);
      gl.uniform1f(punktOrte.raum, raum);
      gl.uniform3f(punktOrte.kamera, ...kamera);
      gl.uniform3f(punktOrte.kegelRichtung, ...kegelZiel);
      gl.uniform1f(punktOrte.kegelInnen, kegelInnen);
      gl.uniform1f(punktOrte.kegelAussen, kegelAussen);
      gl.uniform1f(punktOrte.schaerfeAn, schaerfe && darstellung !== "linie" ? 1 : 0);
      gl.uniform1f(punktOrte.fokus, fokus);
      gl.uniform1f(punktOrte.bokeh, unschaerfe * dpr);
      gl.uniform1f(punktOrte.groesstePunkte, groesstePunkte);
      gl.uniform1f(punktOrte.teilGewicht, teil ? 1 / teil.von : 1);
      const extra = schatten ? weitereLampen : []; // ohne Boden gibt es nichts, worauf sie leuchten
      gl.uniform1i(punktOrte.extraAnzahl, extra.length);
      if (extra.length) {
        gl.uniform3fv(punktOrte.extraPos, extra.flatMap((l) => l.pos).concat(Array(9).fill(0)).slice(0, 9));
        gl.uniform1fv(punktOrte.extraStaerke, extra.map((l) => l.staerke).concat([0, 0, 0]).slice(0, 3));
      }
      gl.uniform1f(punktOrte.alsLinie, darstellung === "linie" ? 1 : 0);
      gl.uniform1f(punktOrte.verlaufVersatz, verlaufVersatz);
      // Spektrum auf Platz 4 (0 bis 3 sind Dichte, Verlauf, Nebel, Schatten); neue Werte nur, wenn es welche gibt
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, spektrumTextur);
      if (spektrum) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPEKTRUM_BAENDER, 1, gl.RED, gl.UNSIGNED_BYTE, spektrum);
      gl.uniform1i(punktOrte.spektrumBild, 4);
      gl.uniform1f(punktOrte.spektrumStaerke, spektrum ? spektrumStaerke : 0);

      // addieren: jeder Punkt zählt dazu
      // (SRC_ALPHA/ONE_MINUS_SRC_ALPHA würde übermalen statt sammeln, dann gäbe es keine dichten Stellen mehr)
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.blendEquation(gl.FUNC_ADD);

      // als Punkte oder als Linie: LINE_STRIP verbindet jeden Punkt mit dem nächsten zu einem Faden.
      // Linien sind in WebGL immer 1 Pixel breit (dicker können die meisten Browser nicht)
      const zeichenArt = darstellung === "linie" ? gl.LINE_STRIP : gl.POINTS;
      gl.enableVertexAttribArray(ort);
      gl.enableVertexAttribArray(ortNaechster);

      // jede Punktliste mit ihrer eigenen Mitte, Größe und Lage; alles andere gilt für alle
      for (const teilKoerper of zuZeichnen) {
        const daten = koerperListe[teilKoerper.nummer];
        if (!daten || daten.anzahl < 2) continue;
        gl.uniform3f(punktOrte.mitte, ...teilKoerper.mitte);
        gl.uniform1f(punktOrte.mass, teilKoerper.mass);
        gl.uniform1f(punktOrte.anzahl, daten.anzahl); // alle Punkte, damit die Farben beim Entstehen nicht wandern
        gl.uniform1f(punktOrte.schrittMass, daten.schrittMass);
        gl.uniformMatrix3fv(punktOrte.lage, false, teilKoerper.lage); // false: schon spaltenweise (siehe lage.js)
        gl.uniform3f(punktOrte.lageVersatz, ...teilKoerper.lageVersatz);

        // Wie die Liste zu lesen ist: je 3 Kommazahlen pro Punkt
        gl.bindBuffer(gl.ARRAY_BUFFER, daten.puffer);
        gl.vertexAttribPointer(ort, 3, gl.FLOAT, false, 0, 0);
        // derselbe Puffer ein zweites Mal, aber 12 Bytes (3 Kommazahlen) weiter vorn angefangen:
        // für Punkt i liefert "naechster" so Punkt i + 1, ohne eine zweite Liste im Speicher
        gl.vertexAttribPointer(ortNaechster, 3, gl.FLOAT, false, 0, 3 * 4);
        // der letzte Punkt hat keinen nächsten (dort wäre der Puffer zu Ende): einen weniger zeichnen
        const n = Math.min(teilKoerper.sichtbar ?? daten.anzahl, daten.anzahl - 1);

        // Attraktor: Farben in Bild 0, Nebel in Bild 1, Bild 2 bleibt unberührt (NONE)
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.NONE]);
        gl.uniform1f(punktOrte.schattenModus, 0);
        gl.drawArrays(zeichenArt, 0, n);

        // Schatten: dieselben Punkte noch einmal, auf Boden und Wände gelegt, nur in Bild 2
        // (an Stelle i muss in drawBuffers COLOR_ATTACHMENTi oder NONE stehen, darum die zwei NONE davor)
        if (schatten) {
          gl.drawBuffers([gl.NONE, gl.NONE, gl.COLOR_ATTACHMENT2]);
          gl.uniform1f(punktOrte.schattenModus, 1);
          gl.colorMask(true, false, false, false); // das Licht oben: Kanal Rot
          gl.drawArrays(zeichenArt, 0, n);
          // weitere Lampen: dieselben Punkte von ihr aus auf die Flächen gelegt, in ihren eigenen Kanal.
          // Dafür stellt man kurz die Lampe oben auf sie um und danach zurück.
          weitereLampen.forEach((l, k) => {
            if (!l.schatten) return;
            gl.colorMask(false, k === 0, k === 1, k === 2);
            gl.uniform1f(punktOrte.lampe, 1);
            gl.uniform3f(punktOrte.lichtPos, ...l.pos);
            gl.uniform3f(punktOrte.kegelRichtung, ...l.richtung);
            gl.uniform1f(punktOrte.kegelInnen, l.kegelInnen);
            gl.uniform1f(punktOrte.kegelAussen, l.kegelAussen);
            gl.drawArrays(zeichenArt, 0, n);
          });
          gl.colorMask(true, true, true, true); // sonst leert clear() beim nächsten Bild nur Rot
          gl.uniform1f(punktOrte.lampe, lampeAn);
          gl.uniform3f(punktOrte.lichtPos, ...lichtPos);
          gl.uniform3f(punktOrte.kegelRichtung, ...kegelZiel);
          gl.uniform1f(punktOrte.kegelInnen, kegelInnen);
          gl.uniform1f(punktOrte.kegelAussen, kegelAussen);
        }
      }
      gl.disableVertexAttribArray(ort); // das Dreieck braucht keine Punktliste
      gl.disableVertexAttribArray(ortNaechster);
    }

    // 2. Durchgang: färben, auf den Bildschirm (bei Bewegungsunschärfe erst nach dem letzten Zwischenschritt)
    if (!letzterTeil) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND); // hier wird jeder Pixel einmal ganz geschrieben, nichts addiert
    gl.useProgram(farbProgramm);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dichte.textur);
    gl.uniform1i(farbOrte.dichte, 0);
    gl.uniform1i(farbOrte.verlauf, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dichte.nebel);
    gl.uniform1i(farbOrte.nebelBild, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, dichte.schatten);
    gl.uniform1i(farbOrte.schattenBild, 3);
    gl.uniform1f(farbOrte.schattenAn, schatten ? 1 : 0);
    gl.uniform1f(farbOrte.schattenStaerke, schattenStaerke);
    gl.uniform3f(farbOrte.bodenfarbe, ...hexZuRgb(bodenfarbe).map((k) => k / 255));
    gl.uniform3f(farbOrte.wandfarbe, ...hexZuRgb(wandfarbe).map((k) => k / 255));
    gl.uniform1i(farbOrte.flaechen, flaechen);
    gl.uniform1f(farbOrte.raum, raum);
    gl.uniform3f(farbOrte.kamera, ...kamera);
    gl.uniform3f(farbOrte.kegelRichtung, ...kegelZiel);
    gl.uniform1f(farbOrte.kegelInnen, kegelInnen);
    gl.uniform1f(farbOrte.kegelAussen, kegelAussen);
    gl.uniform1f(farbOrte.umgebung, umgebungslicht);
    gl.uniform3f(farbOrte.licht, ...licht);
    gl.uniform1f(farbOrte.lampe, lampeAn);
    gl.uniform3f(farbOrte.lichtPos, ...lichtPos);
    gl.uniform1f(farbOrte.punkteBeleuchten, lampeAn ? punkteBeleuchten : 0);
    gl.uniform3f(farbOrte.lampeBild, ...(lampeImBild ?? [0, 0]), lampeImBild ? 1 : 0);
    const extra = schatten ? weitereLampen.slice(0, 3) : [];
    const drei = (liste, je, leer = 0) => liste.concat(Array(3 * je).fill(leer)).slice(0, 3 * je);
    gl.uniform1i(farbOrte.extraAnzahl, extra.length);
    if (extra.length) {
      gl.uniform3fv(farbOrte.extraPos, drei(extra.flatMap((l) => l.pos), 3));
      gl.uniform3fv(farbOrte.extraFarbe, drei(extra.flatMap((l) => l.farbe), 3));
      gl.uniform1fv(farbOrte.extraStaerke, drei(extra.map((l) => l.staerke), 1));
      gl.uniform3fv(farbOrte.extraRichtung, drei(extra.flatMap((l) => l.richtung), 3));
      gl.uniform2fv(farbOrte.extraKegel, drei(extra.flatMap((l) => [l.kegelInnen, l.kegelAussen]), 2));
      gl.uniform1fv(farbOrte.extraSchatten, drei(extra.map((l) => (l.schatten ? 1 : 0)), 1));
      gl.uniform3fv(farbOrte.extraBild, drei(extra.flatMap((l) => {
        const b = l.zeigen ? insBild(l.pos, blick) : null;
        return b ? [...b, 1] : [0, 0, 0];
      }), 3));
    }
    gl.uniform4fv(farbOrte.striche, strichDaten);
    gl.uniform1fv(farbOrte.strichDicke, dickeDaten);
    gl.uniform1i(farbOrte.strichAnzahl, strichAnzahl);
    // Faden: bei einer Farbe in der Punktfarbe, sonst ein helles Grau
    gl.uniform3f(farbOrte.fadenfarbe, ...(art === 0 ? [pr / 255, pg / 255, pb / 255] : [0.7, 0.7, 0.7]));
    gl.uniform3f(farbOrte.schattenfarbe, ...hexZuRgb(schattenfarbe).map((k) => k / 255));
    gl.uniform1f(farbOrte.boden, boden);
    gl.uniform1f(farbOrte.winkel, winkel);
    gl.uniform1f(farbOrte.neigung, neigung);
    gl.uniform1f(farbOrte.abstand, abstand);
    gl.uniform1f(farbOrte.brennweite, brennweite);
    gl.uniform2f(farbOrte.aufloesung, canvas.width, canvas.height);
    gl.uniform2f(farbOrte.versatz, versatz.x, versatz.y);
    gl.uniform3f(farbOrte.hintergrund, hr / 255, hg / 255, hb / 255);
    gl.uniform3f(farbOrte.punktfarbe, pr / 255, pg / 255, pb / 255);
    gl.uniform1f(farbOrte.faerbung, art);
    gl.uniform1f(farbOrte.staerke, staerke / 255);
    gl.uniform1f(farbOrte.verlaufVersatz, verlaufVersatz);
    gl.drawArrays(gl.TRIANGLES, 0, 3); // das große Dreieck aus VERTEX_SHADER_FARBE
  }

  return { setzeVerlauf, ladePunkte, zeichne, insBild };
}

