import { ladeVerlauf } from "/lib/verlauf.js";
import { hexZuRgb } from "/lib/farben.js";

// Zeichnet eine Punktliste mit WebGL2.

const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 punkt; // ein Punkt aus der Liste, für jeden Punkt einmal
in vec2 naechster; // derselbe Puffer noch einmal, um einen Punkt verschoben: der Punkt danach
uniform float schrittMass; // typische Schrittlänge (siehe typischerSchritt in zeichne): wird zu 1
out float tempo; // wie weit dieser Punkt zum nächsten springt, 0 langsam bis 1 schnell

uniform vec2 mitte; // welcher Punkt in der Bildmitte liegt
uniform float zoom; // Pixel pro Einheit
uniform vec2 aufloesung; // Größe des Canvas

uniform float punktgroesse; // Durchmesser in Canvas-Pixeln (schon mal dpr und auf das erlaubte Maß begrenzt)

// Schatten auf einer Wand hinter dem Attraktor: dieselben Punkte noch einmal, verschoben und größer
uniform float schattenModus;   // 1 = dieser Durchgang zeichnet den Schatten
uniform vec2 schattenVersatz;  // wie weit, schon in -1 bis 1 (Clip Space) umgerechnet
uniform float schattenGroesse; // Durchmesser der Schatten-Punkte: größer = weicher (Halbschatten)
uniform float vergroesserung;  // Lampe statt Sonne: um so viel wächst der Schatten um die Mitte des Attraktors

uniform vec2 zentrum;      // Mitte des Attraktors (aus vermesseAttraktor), nicht die Bildmitte
uniform float ausdehnung;  // halbe Größe des Attraktors

// Musik: das Spektrum formt den Attraktor. Innen (nah an seiner Mitte) wirkt der Bass, außen die Höhen
uniform sampler2D spektrumBild; // 64 × 1: Lautstärke von tief (links) bis hoch (rechts), 0 bis 1
uniform float spektrumStaerke;  // 0 = aus

uniform float anzahl; // wie viele Punkte es insgesamt gibt
out float fortschritt; // 0 beim ersten Punkt, 1 beim letzten

// Punkt (in Einheiten des Attraktors) → Clip Space (−1 bis 1)
vec2 zuClip(vec2 q) {
  vec2 pixel = (q - mitte) * zoom; // Abstand zur Mitte
  vec2 clip = pixel / (aufloesung * 0.5); // auf -1 bis 1 umrechnen
  return vec2(clip.x, -clip.y); // y umdrehen: im Canvas zeigt y nach unten
}

void main() {
  vec2 q = punkt;
  // Spektrum: Abstand zur Mitte des Attraktors (0 bis etwa 1) wählt die Frequenz, ihre Lautstärke schiebt nach außen
  if (spektrumStaerke > 0.0) {
    vec2 d = (punkt - zentrum) / ausdehnung;
    float r = length(d);
    float laut = texture(spektrumBild, vec2(clamp(r, 0.0, 1.0), 0.5)).r;
    if (r > 0.0) q += d / r * laut * spektrumStaerke * 0.15 * ausdehnung;
  }

  vec2 pixel = (q - mitte) * zoom; // Abstand zur Mitte
  vec2 clip = pixel / (aufloesung * 0.5); // auf -1 bis 1 umrechnen
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); // y umdrehen: im Canvas zeigt y nach unten
  gl_PointSize = punktgroesse;
  if (schattenModus > 0.5) {
    // Lampe: Strahlensatz, der Schatten wächst um die Mitte des Attraktors (bei der Sonne ist vergroesserung 0)
    gl_Position.xy += (gl_Position.xy - zuClip(zentrum)) * vergroesserung + schattenVersatz;
    gl_PointSize = schattenGroesse;
  }

  fortschritt = float(gl_VertexID) / anzahl;
  tempo = clamp(length(naechster - punkt) / schrittMass, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in float fortschritt;
in float tempo;

uniform vec3 punktfarbe;
uniform float faerbung; // 1 = nach Reihenfolge, 4 = nach Geschwindigkeit (nur dann braucht das Zählen Farben)
uniform sampler2D verlauf;
uniform float weich;   // 1 = weich nach außen auslaufen, 0 = harte Scheibe
uniform float schattenModus;
uniform float verlaufVersatz; // Musik: so weit ist die Farbe im Verlauf weitergewandert
uniform float schattenFlaeche; // Anteil des Gewichts pro Pixel: ein größerer Schatten-Punkt verteilt dasselbe
                               // Gewicht auf mehr Pixel, sonst würde der Schatten mit der Weichheit dunkler

out vec4 farbe;

// Stelle im Verlauf, um verlaufVersatz verschoben; am Ende rückwärts weiter (0 → 1 → 0 …),
// damit es keinen harten Sprung gibt. Ohne Versatz bleibt x, wie es ist
float imVerlauf(float x) {
  return 1.0 - abs(1.0 - mod(x + verlaufVersatz, 2.0));
}

void main() {
  // gl_PointCoord: Stelle im Punkt-Quadrat von (0, 0) bis (1, 1); daraus -1 bis 1 mit der Mitte bei 0
  vec2 mitte = gl_PointCoord * 2.0 - 1.0;
  float abstand2 = dot(mitte, mitte); // Abstand zur Mitte im Quadrat (spart die Wurzel)

  if (abstand2 > 1.0) discard; // außerhalb des Kreises: dieser Pixel zählt gar nicht

  float gewicht = weich > 0.5
    ? exp(-abstand2 * 3.0)
    : 1.0;

  vec3 grundfarbe = punktfarbe;
  if (faerbung > 0.5 && faerbung < 1.5) grundfarbe = texture(verlauf, vec2(imVerlauf(fortschritt), 0.5)).rgb; // nach Reihenfolge
  if (faerbung > 3.5) grundfarbe = texture(verlauf, vec2(imVerlauf(tempo), 0.5)).rgb; // nach Geschwindigkeit: schnell = Ende

  // Mit additivem Blending werden RGB und Anzahl gewichtete Summen
  farbe = vec4(grundfarbe * gewicht, gewicht);

  // Schatten: in ein eigenes Bild mit nur einem Kanal (r), weich auslaufend, verteilt auf seine Fläche
  if (schattenModus > 0.5) farbe = vec4(exp(-abstand2 * 3.0) * schattenFlaeche, 0.0, 0.0, 0.0);
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

const FRAGMENT_SHADER_FARBE = /* glsl */ `#version 300 es
precision highp float;

in vec2 uv;
uniform sampler2D dichte;  // rgb: Summe der Farben, a: Anzahl der Punkte
uniform sampler2D verlauf;
uniform vec3 hintergrund;
uniform vec3 punktfarbe;
uniform float faerbung;    // 0 eine Farbe, 1 Reihenfolge, 2 Dichte, 4 Geschwindigkeit
uniform float staerke;
uniform float verlaufVersatz; // wie im 1. Durchgang
uniform sampler2D schattenBild; // r: wie viele Schatten-Punkte hier auf der Wand liegen
uniform float schattenAn;
uniform float schattenStaerke;  // 0 kein Schatten bis 1 ganz in Schattenfarbe
uniform vec3 schattenfarbe;

// Fläche: wo der Attraktor dicht ist, wird er ausgefüllt, wie ein Scherenschnitt.
// Gemessen wird die Dichte nicht im Pixel selbst, sondern im Durchschnitt über seine Umgebung:
// textureLod liest eine kleinere Fassung des Bildes (Mipmap), Stufe r = Mittel über 2^r × 2^r Pixel.
uniform float flaecheAn;
uniform float fuellRadius;   // Mipmap-Stufe im Dichte-Bild
uniform float schattenStufe; // dieselbe Umgebung im (kleineren) Schatten-Bild
uniform float schwelle;      // so dicht muss es im Durchschnitt sein, um Fläche zu werden (0 bis 1)
uniform float deckung;       // 1 = Fläche ganz deckend, kleiner = durchscheinend
out vec4 farbe;

// Mittel über die Umgebung. Eine Mipmap-Stufe allein wäre treppig (jede Stufe mittelt feste Kästchen,
// man sähe die Kästchen am Rand). Darum eine Stufe feiner an 3 × 3 Stellen lesen und gewichten,
// in der Mitte am stärksten (1 2 1 / 2 4 2 / 1 2 1, zusammen 16): eine kleine Glockenkurve, runde Ränder
vec4 umgebung(sampler2D bild, float stufe) {
  float s = max(stufe - 1.0, 0.0);
  vec2 schritt = exp2(s) / vec2(textureSize(bild, 0)); // so breit ist ein Pixel dieser Stufe, in uv
  vec4 summe = vec4(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float gewicht = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      summe += textureLod(bild, uv + vec2(x, y) * schritt, s) * gewicht;
    }
  }
  return summe / 16.0;
}

// 0 unter der Schwelle, 1 darüber, mit einem schmalen weichen Übergang (keine Treppen am Rand)
float voll(float dichteGrob) {
  return smoothstep(schwelle * 0.7, schwelle * 1.3, dichteGrob);
}

void main() {
  vec4 d = texture(dichte, uv);
  float h = 1.0 - exp(-d.a * staerke);

  // die Wand ist der Hintergrund; der Schatten färbt sie, die Punkte liegen davor
  vec3 grund = hintergrund;
  if (schattenAn > 0.5) {
    float schatten = 1.0 - exp(-texture(schattenBild, uv).r * staerke);
    // mit Fläche wirft auch die ausgefüllte Form einen vollen Schatten
    if (flaecheAn > 0.5) schatten = max(schatten, voll(1.0 - exp(-umgebung(schattenBild, schattenStufe).r * staerke)));
    grund = mix(hintergrund, schattenfarbe, schatten * schattenStaerke);
  }

  vec4 grob = vec4(0.0); // die Umgebung (nur mit Fläche gebraucht)
  float hGrob = 0.0;
  if (flaecheAn > 0.5) {
    grob = umgebung(dichte, fuellRadius);
    hGrob = 1.0 - exp(-grob.a * staerke);
  }

  vec3 punkt = punktfarbe;

  if ((faerbung > 0.5 && faerbung < 1.5) || faerbung > 3.5) {
    // d.rgb enthält die aufsummierten Punktfarben
    punkt = d.a > 0.0 ? d.rgb / d.a : punktfarbe;
  } else if (faerbung > 1.5) {
    // Verlauf entlang der horizontalen Texturachse abtasten
    float x = 1.0 - abs(1.0 - mod(clamp(h, 0.0, 1.0) + verlaufVersatz, 2.0)); // wie imVerlauf()
    punkt = texture(verlauf, vec2(x, 0.5)).rgb;
  }

  // Fläche unter den Punkten: in der Farbe der Punkte ringsum (Durchschnitt), bei „Dichte“ aus dem Verlauf
  if (flaecheAn > 0.5) {
    vec3 flaechenfarbe = punktfarbe;
    if ((faerbung > 0.5 && faerbung < 1.5) || faerbung > 3.5) {
      flaechenfarbe = grob.a > 0.0 ? grob.rgb / grob.a : punktfarbe;
    } else if (faerbung > 1.5) {
      float x = 1.0 - abs(1.0 - mod(hGrob + verlaufVersatz, 2.0));
      flaechenfarbe = texture(verlauf, vec2(x, 0.5)).rgb;
    }
    grund = mix(grund, flaechenfarbe, voll(hGrob) * deckung);
  }

  farbe = vec4(mix(grund, punkt, h), 1.0);
}
`

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

// leere Textur mit Kommazahlen (format: RGBA16F mit 4 Kanälen oder R16F mit einem), wie im 3D-Attraktor
// filter: NEAREST = ein Pixel bleibt ein Pixel, LINEAR = beim Strecken weich zwischen den Pixeln mischen
function kommazahlTextur(gl, breite, hoehe, format, kanaele, filter = gl.NEAREST) {
  const textur = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textur);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, breite, hoehe, 0, kanaele, gl.HALF_FLOAT, null); // null: leer
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return textur;
}

// unsichtbares Bild mit Kommazahlen, in das die Punkte gezählt werden
// (format/kanaele: RGBA16F/RGBA für Farben und Anzahl, R16F/RED für den Schatten)
function erstelleDichtePuffer(gl, breite, hoehe, format, kanaele, filter) {
  const textur = kommazahlTextur(gl, breite, hoehe, format, kanaele, filter);
  const fb = gl.createFramebuffer(); // "Zeichne hierhin statt auf den Bildschirm"
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textur, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // wieder der Bildschirm
  return { textur, fb, breite, hoehe };
}

// passenden Puffer holen: hat er schon die Größe, den alten nehmen, sonst freigeben und neu anlegen
function passenderPuffer(gl, puffer, breite, hoehe, format, kanaele, filter) {
  if (puffer && puffer.breite === breite && puffer.hoehe === hoehe) return puffer;
  if (puffer) {
    gl.deleteTexture(puffer.textur);
    gl.deleteFramebuffer(puffer.fb);
  }
  return erstelleDichtePuffer(gl, breite, hoehe, format, kanaele, filter);
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
  const puffer = gl.createBuffer();
  const ort = gl.getAttribLocation(punktProgramm, "punkt");
  const ortNaechster = gl.getAttribLocation(punktProgramm, "naechster");
  let schrittMass = 1;
  let anzahl = 0;

  function orte(programm, namen) {
    // Orte der Uniforms einmal nachschlagen, nicht bei jedem Bild
    const uniform = {};
    for (const name of namen) {
      uniform[name] = gl.getUniformLocation(programm, name);
    }
    return uniform;
  }
  const punktOrte = orte(punktProgramm, ["mitte", "zoom", "aufloesung", "anzahl", "punktfarbe", "faerbung", "verlauf", "schrittMass",
                                         "punktgroesse", "weich",
                                         "schattenModus", "schattenVersatz", "schattenGroesse", "schattenFlaeche",
                                         "vergroesserung", "zentrum", "ausdehnung", "spektrumBild", "spektrumStaerke",
                                         "verlaufVersatz"]);

  // wie groß ein Punkt auf diesem Gerät höchstens sein darf (oft 1 bis 1024, auf manchen Handys viel weniger)
  // einmal nachfragen, nicht bei jedem Bild
  const [kleinstePunkte, groesstePunkte] = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  const farbOrte = orte(farbProgramm, ["dichte", "verlauf", "hintergrund", "punktfarbe", "faerbung", "staerke",
                                       "schattenBild", "schattenAn", "schattenStaerke", "schattenfarbe", "verlaufVersatz",
                                       "flaecheAn", "fuellRadius", "schattenStufe", "schwelle", "deckung"]);

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

  // Punkte einmal zur Grafikkarte schicken
  function ladePunkte(daten) {
    // durch 2 teilen, damit man weiß wieviele einzelne Punkte (alle x und y)
    anzahl = daten ? daten.length / 2 : 0;
    if (!daten) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.bufferData(gl.ARRAY_BUFFER, daten, gl.STATIC_DRAW);
    schrittMass = typischerSchritt(daten, anzahl);
  }

  // Wie weit springt ein Punkt typischerweise zum nächsten? Für „Färben nach Geschwindigkeit“:
  // die Schrittlänge wird durch diesen Wert geteilt, damit 0 bis 1 herauskommt.
  // Genommen wird nicht der größte Schritt (ein einzelner Ausreißer würde alles andere dunkel machen),
  // sondern der, den 95 % der Schritte nicht überschreiten. Dafür reichen 20 000 zufällige Stichproben.
  function typischerSchritt(daten, n) {
    const proben = [];
    for (let k = 0; k < Math.min(20000, n - 1); k++) {
      const i = Math.floor(Math.random() * (n - 1)) * 2;
      let summe = 0;
      for (let a = 0; a < 2; a++) summe += (daten[i + 2 + a] - daten[i + a]) ** 2;
      proben.push(Math.sqrt(summe));
    }
    proben.sort((a, b) => a - b);
    return proben[Math.floor(proben.length * 0.95)] || 1; // || 1: nie durch 0 teilen
  }


  // Ein Bild zeichnen, so oft man will, ohne neu zu rechnen
  // sichtbar: wie viele Punkte gezeichnet werden (zum Entstehen lassen), ohne Angabe alle
  let dichte = null; // der Dichte-Puffer, angelegt beim ersten Zeichnen
  let schattenPuffer = null; // kleiner als der Canvas (siehe verkleinerung)

  function zeichne({ mitteX, mitteY, zoom, staerke, sichtbar = anzahl, punktfarbe, 
                     faerbung, hintergrund, punktgroesse, weich,
                     schatten, lichtRichtung, wandAbstand, schattenWeich, schattenStaerke, schattenfarbe,
                     licht = "sonne", lampenAbstand = 0.3, zentrumX = mitteX, zentrumY = mitteY, ausdehnung = 1,
                     spektrum = null, spektrumStaerke = 0, verlaufVersatz = 0,
                     flaeche = false, fuellRadius = 4, schwelle = 0.15, deckung = 1 }) {
    // Puffer passend zur Canvas-Größe
    dichte = passenderPuffer(gl, dichte, canvas.width, canvas.height, gl.RGBA16F, gl.RGBA);
    const art = { einfarbig: 0, reihenfolge: 1, dichte: 2, tempo: 4 }[faerbung];
    const [hr, hg, hb] = hexZuRgb(hintergrund);
    const [pr, pg, pb] = hexZuRgb(punktfarbe);
    // Punktgröße in Bildschirm-Pixeln: der Canvas rechnet mindestens doppelt so fein (dpr in main.js),
    // ohne das wäre Größe 8 nur 4 sichtbare Pixel groß
    const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
    const groesse = Math.min(Math.max(punktgroesse * dpr, kleinstePunkte), groesstePunkte);

    // Schatten: das Licht kommt aus lichtRichtung (Grad, 0 = von rechts, 90 = von oben),
    // also fällt der Schatten zur Gegenseite. Je weiter der Attraktor vor der Wand schwebt, desto weiter.
    // wandAbstand ist ein Anteil der kürzeren Canvas-Seite, damit der Schatten beim Zoomen gleich bleibt.
    const richtung = lichtRichtung * Math.PI / 180;
    const versatzPixel = wandAbstand * Math.min(canvas.width, canvas.height);
    const versatzX = -Math.cos(richtung) * versatzPixel / (canvas.width * 0.5); // Pixel → Clip Space
    const versatzY = -Math.sin(richtung) * versatzPixel / (canvas.height * 0.5);

    // Weicher Schatten: große Punkte wären teuer (bei Weichheit 8 und dpr 2 sind es 18 · 18 Pixel
    // pro Punkt, mal eine Million). Darum zählt der Schatten in ein Bild, das bis zu 4-mal kleiner ist;
    // beim Auslesen streckt die Grafikkarte es weich (LINEAR) auf die volle Größe: Unschärfe fast umsonst.
    const weichPixel = groesse + schattenWeich * dpr; // gewünschter Durchmesser im Canvas
    const verkleinerung = Math.min(Math.max(Math.floor(weichPixel / 3), 1), 4); // ohne Weichheit: 1 = scharf
    const schattenGroesse = Math.min(Math.max(weichPixel / verkleinerung, 1), groesstePunkte); // im kleinen Bild
    if (schatten) {
      schattenPuffer = passenderPuffer(gl, schattenPuffer,
        Math.ceil(canvas.width / verkleinerung), Math.ceil(canvas.height / verkleinerung), gl.R16F, gl.RED, gl.LINEAR);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);

    // Verlauf liegt in beiden Durchgängen auf Platz 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, verlaufTextur);

    // 1. Durchgang: Punkte zählen, in den Dichte-Puffer statt auf den Bildschirm
    gl.bindFramebuffer(gl.FRAMEBUFFER, dichte.fb);
    gl.clearColor(0, 0, 0, 0); // leer: noch kein Punkt gezählt
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (anzahl > 0) {
      gl.useProgram(punktProgramm);
      gl.uniform2f(punktOrte.mitte, mitteX, mitteY);
      gl.uniform1f(punktOrte.zoom, zoom);
      gl.uniform2f(punktOrte.aufloesung, canvas.width, canvas.height);
      gl.uniform1f(punktOrte.anzahl, anzahl);
      gl.uniform3f(punktOrte.punktfarbe, pr / 255, pg / 255, pb / 255);
      gl.uniform1f(punktOrte.faerbung, art === 1 || art === 4 ? art : 0); // nur Reihenfolge und Geschwindigkeit brauchen beim Zählen Farben
      gl.uniform1f(punktOrte.schrittMass, schrittMass);
      gl.uniform1i(punktOrte.verlauf, 1);

      gl.uniform1f(punktOrte.punktgroesse, groesse);
      gl.uniform1f(punktOrte.weich, weich ? 1 : 0);
      gl.uniform2f(punktOrte.schattenVersatz, versatzX, versatzY);
      gl.uniform1f(punktOrte.schattenGroesse, schattenGroesse);
      // ein Punkt bedeckt im Canvas groesse² Pixel; als Schatten verteilt sich das auf
      // (schattenGroesse · verkleinerung)² Canvas-Pixel, ein Pixel im kleinen Bild steht für verkleinerung² davon
      // Lampe: Strahlensatz. Die Lampe steht lampenAbstand vor dem Attraktor, die Wand wandAbstand dahinter;
      // der Schatten ist (lampenAbstand + wandAbstand) / lampenAbstand mal so groß, also um
      // wandAbstand / lampenAbstand größer. Wand weiter weg oder Lampe näher: größerer Schatten
      gl.uniform1f(punktOrte.vergroesserung, licht === "lampe" ? wandAbstand / lampenAbstand : 0);
      gl.uniform2f(punktOrte.zentrum, zentrumX, zentrumY);
      gl.uniform1f(punktOrte.ausdehnung, ausdehnung);
      gl.uniform1f(punktOrte.verlaufVersatz, verlaufVersatz);
      // Spektrum auf Platz 3 (0 bis 2 sind Dichte, Verlauf, Schatten); neue Werte nur, wenn es welche gibt
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, spektrumTextur);
      if (spektrum) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPEKTRUM_BAENDER, 1, gl.RED, gl.UNSIGNED_BYTE, spektrum);
      gl.uniform1i(punktOrte.spektrumBild, 3);
      gl.uniform1f(punktOrte.spektrumStaerke, spektrum ? spektrumStaerke : 0);
      gl.uniform1f(punktOrte.schattenFlaeche, (groesse / (schattenGroesse * verkleinerung)) ** 2 * verkleinerung ** 2);

      gl.enable(gl.BLEND); // addieren: jeder Punkt zählt eins dazu
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.blendEquation(gl.FUNC_ADD);

      gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
      gl.enableVertexAttribArray(ort);
      gl.vertexAttribPointer(ort, 2, gl.FLOAT, false, 0, 0);
      // derselbe Puffer ein zweites Mal, aber 8 Bytes (2 Kommazahlen) weiter vorn angefangen:
      // für Punkt i liefert "naechster" so Punkt i + 1, ohne eine zweite Liste im Speicher
      gl.enableVertexAttribArray(ortNaechster);
      gl.vertexAttribPointer(ortNaechster, 2, gl.FLOAT, false, 0, 2 * 4);
      // der letzte Punkt hat keinen nächsten (dort wäre der Puffer zu Ende): einen weniger zeichnen
      const n = Math.min(sichtbar, anzahl - 1);

      gl.uniform1f(punktOrte.schattenModus, 0);
      gl.drawArrays(gl.POINTS, 0, n);

      // Schatten: dieselben Punkte verschoben, in das kleine Bild (eigene Größe: eigener viewport)
      if (schatten) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, schattenPuffer.fb);
        gl.viewport(0, 0, schattenPuffer.breite, schattenPuffer.hoehe);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(punktOrte.schattenModus, 1);
        gl.drawArrays(gl.POINTS, 0, n);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.disableVertexAttribArray(ort); // das Dreieck braucht keine Punktliste
      gl.disableVertexAttribArray(ortNaechster);
    }

    // Fläche: kleinere Fassungen der Bilder (Mipmaps), jede halb so breit, jeder Pixel = Mittel aus vier.
    // Ohne Fläche wieder ohne: eine Textur, die Mipmaps lesen will, aber keine hat, liefert nur Schwarz
    const filter = flaeche ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dichte.textur);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    if (flaeche) gl.generateMipmap(gl.TEXTURE_2D);
    if (schatten) {
      gl.bindTexture(gl.TEXTURE_2D, schattenPuffer.textur);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, flaeche ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (flaeche) gl.generateMipmap(gl.TEXTURE_2D);
    }

    // 2. Durchgang: färben, auf den Bildschirm
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND); // hier wird jeder Pixel einmal ganz geschrieben, nichts addiert
    gl.useProgram(farbProgramm);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dichte.textur);
    gl.uniform1i(farbOrte.dichte, 0);
    gl.uniform1i(farbOrte.verlauf, 1);
    gl.uniform3f(farbOrte.hintergrund, hr / 255, hg / 255, hb / 255);
    gl.uniform3f(farbOrte.punktfarbe, pr / 255, pg / 255, pb / 255);
    gl.uniform1f(farbOrte.faerbung, art);
    gl.uniform1f(farbOrte.staerke, staerke / 255);
    gl.uniform1f(farbOrte.verlaufVersatz, verlaufVersatz);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, schatten ? schattenPuffer.textur : null);
    gl.uniform1i(farbOrte.schattenBild, 2);
    gl.uniform1f(farbOrte.schattenAn, schatten ? 1 : 0);
    gl.uniform1f(farbOrte.schattenStaerke, schattenStaerke);
    gl.uniform3f(farbOrte.schattenfarbe, ...hexZuRgb(schattenfarbe).map((k) => k / 255));
    gl.uniform1f(farbOrte.flaecheAn, flaeche ? 1 : 0);
    gl.uniform1f(farbOrte.fuellRadius, fuellRadius);
    // das Schatten-Bild ist verkleinerung-mal kleiner: dieselbe Umgebung ist dort log2(verkleinerung) Stufen tiefer
    gl.uniform1f(farbOrte.schattenStufe, Math.max(fuellRadius - Math.log2(verkleinerung), 0));
    gl.uniform1f(farbOrte.schwelle, schwelle);
    gl.uniform1f(farbOrte.deckung, deckung);
    gl.drawArrays(gl.TRIANGLES, 0, 3); // das große Dreieck aus VERTEX_SHADER_FARBE
  }

  return { setzeVerlauf, ladePunkte, zeichne };
}

