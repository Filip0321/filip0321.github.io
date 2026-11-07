// Datamosh-Imitat: was ein Videocodec tut, wenn ihm das Bezugsbild fehlt, hier auf der Grafikkarte
// nachgebaut statt nur nachgemalt.
//
// Ein P-Frame (das Projekt Datamosh erklärt es ausführlich) speichert kein Bild, sondern zwei Dinge:
//   1. Bewegung: für jeden Makroblock (16 × 16 Pixel) ein Vektor „dieser Block kommt von dort“
//   2. Rest (Residuum): was danach noch fehlt, grob gespeichert (in 8 × 8-Blöcken, nur die groben Anteile)
// Der Dekoder nimmt das letzte Bild, schiebt jeden Block um seinen Vektor und legt den Rest darauf.
// Fehlt der Keyframe, schiebt er das FALSCHE Bild: das alte zerfließt in die Bewegung des neuen, und die
// Reste malen die Kanten des neuen Bildes darüber. Das ist der Datamosh-Look.
//
// Genau so rechnet dieser Effekt, Bild für Bild:
//   aus = verschiebe(letztes AUSGABEbild, Bewegung) + Rest · „Rest“
//   Bewegung: blockweise aus dem Video geschätzt (das letzte und das jetzige Bild verglichen, wie ein
//             Kodierer es tut, „Block Matching“), und/oder künstlich (Strömung, Schwenk, Zoom, Wirbel),
//             damit es auch auf einem Foto zerfließt; im Rechteck kommt die eigene Bewegung dazu
//             (Runde 5: das Malen von Bereichen ist wieder weg, das Rechteck bleibt)
//   Rest:     jetziges Bild minus das verschobene LETZTE QUELLbild (das, was der Kodierer gespeichert
//             hätte), grob gemacht wie bei wenig Bitrate: in 8 × 8-Blöcken nur ein weicher Verlauf, der Rest
//             in groben Stufen
// Dazu, was echte Kodierer auch tun: einzelne Blöcke ganz neu („Intra-Blöcke“, wo die Vorhersage nicht
// passt), ab und zu ein Keyframe (alles wieder sauber), und Farbe, die anders wandert als Helligkeit
// (Farbe ist nur in halber Auflösung gespeichert, darum blutet sie).
//
// Drei Durchgänge, zwei davon nach dem Bild (nachher):
//   Bewegung schätzen  (klein: ein Pixel pro Makroblock) aus jetzigem und letztem Quellbild
//   Quellbild merken   (für die nächste Schätzung und den Rest)
//   Ausgabe merken     (das ist das „falsche“ Bezugsbild für das nächste Bild)
// Die Schätzung kommt darum ein Bild zu spät an. Das sieht niemand.

import { gl, glCanvas, baueProgramm, VERTEX_SHADER } from "../webgl.js";

const GRUPPE = "Licht, Kanten, Zeit";
const MAX_SUCHE = 64; // Vektoren werden in 8 Bit gespeichert: −64 bis 64 Pixel

// ---------- Texturen und kleine Programme ----------
function neueTextur() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return t;
}
function setzeFilter(nah) {
  const f = nah ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

const ausVorher = gl ? neueTextur() : null; // letzte Ausgabe
const quelleVorher = gl ? neueTextur() : null; // letztes Quellbild
const bewegung = gl ? neueTextur() : null; // ein Pixel pro Makroblock: Vektor in r, g
const rahmen = gl ? gl.createFramebuffer() : null;
let groesse = [0, 0]; // wie groß die gemerkten Bilder sind (0: noch keine)
let mvGroesse = [0, 0];

// Kopieren: das jetzige Quellbild (liegt nach rendere auf Platz 0) in eine eigene Textur
const KOPIE = /* glsl */ `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
uniform sampler2D bild;
void main() { farbe = texture(bild, uv); }`;

// Block Matching: für jeden Makroblock den Vektor suchen, mit dem das letzte Bild am besten passt.
// Drei-Schritt-Suche (wie frühe Kodierer): erst grob in 8 Richtungen, um den besten Punkt immer feiner.
// Verglichen wird die Summe der Helligkeitsunterschiede an 4 × 4 Stellen im Block (nicht jeder Pixel).
const SCHAETZEN = /* glsl */ `#version 300 es
precision highp float;
out vec4 farbe;
uniform sampler2D jetzt, vorher;
uniform vec2 aufloesung;
uniform float block, suche;
float hell(vec3 f) { return dot(f, vec3(0.2126, 0.7152, 0.0722)); }
float unterschied(vec2 ecke, vec2 v) {
  float s = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec2 p = ecke + (vec2(x, y) + 0.5) * block / 4.0;
    s += abs(hell(texture(jetzt, p / aufloesung).rgb) - hell(texture(vorher, (p - v) / aufloesung).rgb));
  }
  return s;
}
void main() {
  vec2 ecke = floor(gl_FragCoord.xy) * block;
  vec2 bester = vec2(0.0);
  float wenig = unterschied(ecke, bester) - 0.05; // stillstehen gewinnt bei Gleichstand (sonst zittert es)
  for (float schritt = suche * 0.5; schritt >= 1.0; schritt *= 0.5) {
    vec2 mitte = bester;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec2 v = mitte + vec2(x, y) * schritt;
      float u = unterschied(ecke, v);
      if (u < wenig) { wenig = u; bester = v; }
    }
  }
  farbe = vec4(bester / ${(2 * MAX_SUCHE).toFixed(1)} + 0.5, 0.0, 1.0);
}`;

let kopie = null;
let schaetzen = null;
function programme() {
  kopie ??= baueProgramm(VERTEX_SHADER, KOPIE);
  schaetzen ??= baueProgramm(VERTEX_SHADER, SCHAETZEN);
}

function inTextur(textur, w, h, nah) {
  gl.bindTexture(gl.TEXTURE_2D, textur);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  setzeFilter(nah);
  gl.bindFramebuffer(gl.FRAMEBUFFER, rahmen);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textur, 0);
  gl.viewport(0, 0, w, h);
}

// ---------- Bewegung aus einem anderen Video ----------
// Wie beim echten Datamosh: Die P-Frames (Bewegung UND Rest) kommen aus einem anderen Clip, angewendet auf
// das Bild hier. Die Seite gibt ein <video> (setzeBewegungsVideo); bei jedem neuen Bild davon wird es in eine
// Textur geladen, die vorige gemerkt, und die Bewegung zwischen den beiden geschätzt (statt zwischen den
// Bildern der eigenen Quelle). Auch der Rest kommt dann aus dem anderen Video: so malen seine Kanten sich
// nach und nach in das Bild, wie bei einem Clip, dem der Keyframe fehlt. Steht das Video (Pause, am Ende),
// gibt es keine Bewegung: das Bild bleibt, wie es gerade ist.
const fremd = { video: null, jetzt: null, vorher: null, zeit: -1, bilder: 0, frisch: false };
let vonVorn = false; // beim nächsten Bild ein Keyframe (alles sauber), dann geht es neu los

export function setzeBewegungsVideo(video) {
  fremd.video = video;
  fremd.zeit = -1;
  fremd.bilder = 0;
  if (gl && video) {
    fremd.jetzt ??= neueTextur();
    fremd.vorher ??= neueTextur();
  }
}
export function moshVonVorn() {
  vonVorn = true;
  fremd.bilder = 0; // die ersten zwei Bilder des Videos sind wieder der Anfang
}

// gibt es ein neues Bild im fremden Video? Dann die zwei Texturen tauschen und das neue hochladen
function holeFremdesBild() {
  fremd.frisch = false;
  const v = fremd.video;
  if (!v || v.readyState < 2 || v.currentTime === fremd.zeit) return;
  [fremd.jetzt, fremd.vorher] = [fremd.vorher, fremd.jetzt];
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fremd.jetzt);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // wie das Bild in rendere: v = 0 unten
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
  setzeFilter(false);
  fremd.zeit = v.currentTime;
  fremd.bilder++;
  fremd.frisch = fremd.bilder >= 2;
}
const mitFremd = () => fremd.video && fremd.bilder >= 2;

let letzteWerte = null;
let zeitVorher = null;
let keyframeNummer = -1;
let schnitt = 0; // 1: dieses Bild ist ein Keyframe (alles sauber)

// nach dem Bild: Bewegung schätzen, Quellbild und Ausgabe merken
function merke() {
  if (!gl) return;
  programme();
  const w = glCanvas.width;
  const h = glCanvas.height;
  gl.activeTexture(gl.TEXTURE0);
  const jetzt = gl.getParameter(gl.TEXTURE_BINDING_2D); // das Quellbild, von rendere (webgl.js) hochgeladen
  const block = letzteWerte?.block ?? 16;
  const neu = groesse[0] !== w || groesse[1] !== h;

  // 1. Bewegung (nur wenn es ein letztes Quellbild gleicher Größe gibt)
  const mw = Math.ceil(w / block);
  const mh = Math.ceil(h / block);
  if (!neu) {
    gl.bindTexture(gl.TEXTURE_2D, bewegung);
    if (mvGroesse[0] !== mw || mvGroesse[1] !== mh) {
      inTextur(bewegung, mw, mh, true);
      mvGroesse = [mw, mh];
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, rahmen);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bewegung, 0);
      gl.viewport(0, 0, mw, mh);
    }
    gl.useProgram(schaetzen);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fremd.video ? fremd.vorher : quelleVorher);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fremd.video ? fremd.jetzt : jetzt);
    gl.uniform1i(gl.getUniformLocation(schaetzen, "jetzt"), 0);
    gl.uniform1i(gl.getUniformLocation(schaetzen, "vorher"), 1);
    gl.uniform2f(gl.getUniformLocation(schaetzen, "aufloesung"), w, h);
    gl.uniform1f(gl.getUniformLocation(schaetzen, "block"), block);
    gl.uniform1f(gl.getUniformLocation(schaetzen, "suche"), Math.min(MAX_SUCHE, letzteWerte?.suche ?? 16));
    if (fremd.video && !fremd.frisch) {
      // fremdes Video ohne neues Bild: keine Bewegung (0,5 heißt Vektor 0)
      gl.clearColor(0.5, 0.5, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // 2. Quellbild merken
  if (neu) inTextur(quelleVorher, w, h, false);
  else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, rahmen);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, quelleVorher, 0);
    gl.viewport(0, 0, w, h);
  }
  gl.useProgram(kopie);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, jetzt);
  gl.uniform1i(gl.getUniformLocation(kopie, "bild"), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3. Ausgabe merken (aus dem sichtbaren Bild von glCanvas)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, ausVorher);
  gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, w, h, 0);
  setzeFilter(false);

  // aufräumen: wie rendere es erwartet
  gl.bindTexture(gl.TEXTURE_2D, jetzt);
  gl.viewport(0, 0, w, h);
  groesse = [w, h];
}

const MOSHBILD = {
  id: "moshbild",
  name: "Datamosh-Imitat",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true, // auf einem Foto zerfließt es trotzdem weiter (künstliche Bewegung)
  shader: /* glsl */ `
uniform sampler2D ausVorher, quelleVorher, bewegung, fremdJetzt, fremdVorher;
uniform float mitFremd; // 1: Bewegung und Rest kommen aus dem anderen Video
uniform float stehen;   // 1: das andere Video hat kein neues Bild: alles bleibt, wie es ist
uniform float gemerktB, gemerktH, schnitt;
uniform float art, block, echt, kuenstlich, muster, wirbel, tempo, flaeche, rest, stufen, intra, farbe_, heilen;
uniform float bx, by, bb, bh, bewX, bewY;

// Vektor des Makroblocks, in Pixeln: aus der Schätzung, künstlich, und im Bereich die eigene Bewegung
// vEcht: nur der geschätzte Teil (damit rechnet der Rest; die künstliche Bewegung kennt der „Kodierer“ nicht,
// auf einem Foto gibt es darum keinen Rest, und es zerfließt ungestört)
vec2 vektor(vec2 px, out float drin, out vec2 vEcht) {
  vec2 b = floor(px / block);
  vec2 mitte = (b + 0.5) * block;
  vec2 v = vec2(0.0);
  if (echt > 0.0) {
    vec2 m = texture(bewegung, (b + 0.5) / ceil(aufloesung / block)).rg;
    v += (m - 0.5) * ${(2 * MAX_SUCHE).toFixed(1)} * echt;
  }
  vEcht = floor(v + 0.5);
  if (kuenstlich > 0.0) {
    vec2 q = mitte / aufloesung.y;          // Bildhöhe = 1
    vec2 z = (mitte - 0.5 * aufloesung) / aufloesung.y;
    float t = zeit * tempo;
    vec2 k;
    if (muster < 0.5) {
      // Strömung: zwei Lagen weicher Wellen, langsam wandernd: zusammenhängende Ströme wie bei echter Bewegung
      vec2 s = q * wirbel;
      k = vec2(sin(s.y * 3.1 + t) + 0.5 * sin(s.x * 5.3 - t * 1.3 + s.y * 2.0), cos(s.x * 2.7 - t * 0.8) + 0.5 * cos(s.y * 4.9 + t * 1.1 + s.x));
    } else if (muster < 1.5) k = vec2(1.0, 0.15 * sin(t));                // Schwenk
    else if (muster < 2.5) k = z * 2.0 * (1.0 + 0.3 * sin(t));             // Zoom: von der Mitte weg
    else k = vec2(-z.y, z.x) * 3.0;                                        // Wirbel: um die Mitte
    // nur ein Teil der Fläche bewegt sich (zusammenhängende Flecken, die langsam wandern), der Rest steht:
    // so bleibt das Bild erkennbar, und es zerfließt in Bahnen statt überall
    vec2 f = q * 2.5 + vec2(0.13, 0.07) * t;
    float fleck = 0.5 + 0.25 * (sin(f.x * 2.3 + sin(f.y * 1.7)) + sin(f.y * 2.9 - f.x * 0.7 + 1.0));
    float bewegt = smoothstep(1.0 - flaeche, 1.0 - flaeche + 0.08, fleck);
    v += k * kuenstlich * 2.0 * bewegt;
  }
  drin = 0.0;
  if (art > 0.5) {
    vec2 mb = vec2(mitte.x / aufloesung.x, 1.0 - mitte.y / aufloesung.y);
    drin = (mb.x > bx && mb.x < bx + bb && mb.y > by && mb.y < by + bh) ? 1.0 : 0.0;
    v += vec2(bewX, -bewY) * aufloesung.y * 0.01 * drin;
  }
  return floor(v + 0.5); // ganze Pixel: harte Blockkanten wie im echten Codec
}

vec3 zuYuv(vec3 f) { return vec3(dot(f, vec3(0.299, 0.587, 0.114)), dot(f, vec3(-0.169, -0.331, 0.5)), dot(f, vec3(0.5, -0.419, -0.081))); }
vec3 zuRgb(vec3 y) { return vec3(y.x + 1.402 * y.z, y.x - 0.344 * y.y - 0.714 * y.z, y.x + 1.772 * y.y); }

// Rest an der Stelle p, wenn der Block um v geschoben wurde
vec3 restBei(vec2 p, vec2 v) {
  if (mitFremd > 0.5) return texture(fremdJetzt, p / aufloesung).rgb - texture(fremdVorher, (p - v) / aufloesung).rgb;
  return texture(bild, p / aufloesung).rgb - texture(quelleVorher, (p - v) / aufloesung).rgb;
}

void main() {
  vec2 px = uv * aufloesung;
  vec4 o = texture(bild, uv);
  // noch nichts gemerkt (erstes Bild, andere Größe) oder Keyframe: sauber
  if (schnitt > 0.5 || gemerktB != aufloesung.x || gemerktH != aufloesung.y) { farbe = o; return; }
  // Zwischen zwei Bildern des anderen Videos wird oft mehrmals gezeichnet (die Seite läuft mit 60 Bildern pro
  // Sekunde, das Video mit 30 oder 25). Ohne das würde der Rest jedes Mal noch einmal dazukommen.
  if (stehen > 0.5) { farbe = texelFetch(ausVorher, ivec2(px), 0); return; }

  float drin;
  vec2 vEcht;
  vec2 v = vektor(px, drin, vEcht);
  vec2 b = floor(px / block);
  // „nur der Bereich“: außerhalb das Bild, wie es ist
  if (art > 0.5 && art < 1.5 && drin < 0.5) { farbe = o; return; }
  // Intra-Blöcke: hier hat der Kodierer aufgegeben und den Block neu gespeichert, mit Takt wechselnd
  float takt = floor(zeit * 6.0);
  if (zufall(b * 1.37 + takt * 11.0) < intra) { farbe = o; return; }

  // Vorhersage: das letzte AUSGABEbild, blockweise verschoben. Die Farbe getrennt, an Blockmitte
  // gerundet und etwas weiter verschoben (halbe Farbauflösung: sie blutet und hinkt)
  // texelFetch: genau ein Pixel, nichts gemischt (sonst würde es mit jedem Bild weicher, wie Wasserfarbe)
  ivec2 groesse = ivec2(aufloesung) - 1;
  vec3 vor = zuYuv(texelFetch(ausVorher, clamp(ivec2(px - v), ivec2(0), groesse), 0).rgb);
  ivec2 farbStelle = ivec2(floor((px - v * (1.0 + farbe_)) / 2.0) * 2.0);
  vor.yz = mix(vor.yz, zuYuv(texelFetch(ausVorher, clamp(farbStelle, ivec2(0), groesse), 0).rgb).yz, min(1.0, farbe_));

  // Rest, wie bei wenig Bitrate: pro 8 × 8 nur ein Verlauf zwischen den Ecken (der Block hat keine Details,
  // nur Kanten an seinem Rand), dazu die Einzelheiten in groben Stufen
  vec2 k = floor(px / 8.0) * 8.0;
  vec2 f = (px - k) / 8.0;
  vec3 grob = mix(mix(restBei(k + 0.5, vEcht), restBei(k + vec2(7.5, 0.5), vEcht), f.x),
                  mix(restBei(k + vec2(0.5, 7.5), vEcht), restBei(k + 7.5, vEcht), f.x), f.y);
  vec3 fein = restBei(px, vEcht) - grob;
  float q = 1.0 / max(stufen, 1.0);
  fein = floor(fein / q + 0.5) * q;
  vec3 r = zuYuv(grob + fein);
  r.yz *= 0.6; // auch im Rest wird Farbe sparsamer gespeichert

  vec3 aus = zuRgb(vor + r * rest);
  aus = mix(aus, o.rgb, heilen);
  farbe = vec4(clamp(aus, 0.0, 1.0), o.a);
}`,
  einstellungen(w, zeit) {
    letzteWerte = w;
    // Keyframe: alle „keyframe“ Sekunden (0: nie); und wenn die Zeit zurückspringt (Video von vorn)
    schnitt = 0;
    const nummer = w.keyframe > 0 ? Math.floor(zeit / w.keyframe) : 0;
    if (nummer !== keyframeNummer || (zeitVorher !== null && zeit < zeitVorher - 0.5)) schnitt = keyframeNummer === -1 ? 0 : 1;
    if (vonVorn) {
      schnitt = 1;
      vonVorn = false;
    }
    holeFremdesBild();
    keyframeNummer = nummer;
    zeitVorher = zeit;
    const fremdAn = mitFremd();
    return {
      ...w,
      // mit dem anderen Video gilt nur seine Bewegung: keine künstliche, überall, kein Rechteck
      ...(fremdAn ? { kuenstlich: 0, art: 0 } : {}),
      mitFremd: fremdAn ? 1 : 0,
      stehen: fremdAn && !fremd.frisch ? 1 : 0,
      fremdJetzt: fremd.jetzt ?? bewegung, // ohne fremdes Video: irgendeine Textur, der Shader liest sie nicht
      fremdVorher: fremd.vorher ?? bewegung,
      zeit,
      farbe_: w.farbbluten,
      ausVorher,
      quelleVorher,
      bewegung,
      gemerktB: groesse[0],
      gemerktH: groesse[1],
      schnitt,
    };
  },
  nachher: merke,
  regler: [
    {
      gruppe: "Bewegung",
      regler: [
        { name: "art", text: "Wo", auswahl: ["ganzes Bild", "nur der Bereich", "ganzes Bild, im Bereich mehr"], wert: 0 },
        { name: "block", text: "Makroblock (px)", min: 4, max: 64, schritt: 4, wert: 16 },
        { name: "echt", text: "aus dem Video (Schätzung)", min: 0, max: 3, schritt: 0.05, wert: 1 },
        { name: "suche", text: "Suchweite (px)", min: 4, max: 64, schritt: 4, wert: 16 },
        { name: "kuenstlich", text: "künstlich", min: 0, max: 3, schritt: 0.01, wert: 0.3 },
        { name: "flaeche", text: "davon bewegt (Fläche)", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "muster", text: "Muster", auswahl: ["Strömung", "Schwenk", "Zoom", "Wirbel"], wert: 0 },
        { name: "wirbel", text: "Größe der Ströme", min: 0.5, max: 10, schritt: 0.1, wert: 2 },
        { name: "tempo", text: "Tempo", min: 0, max: 4, schritt: 0.05, wert: 0.6 },
      ],
    },
    {
      gruppe: "Codec",
      regler: [
        { name: "rest", text: "Rest (neue Kanten malen)", min: 0, max: 1.5, schritt: 0.01, wert: 0.6 },
        { name: "stufen", text: "Bitrate (Stufen im Rest)", min: 1, max: 64, schritt: 1, wert: 6 },
        { name: "intra", text: "Intra-Blöcke (neu)", min: 0, max: 0.3, schritt: 0.001, wert: 0.003 },
        { name: "farbbluten", text: "Farbe blutet", min: 0, max: 2, schritt: 0.01, wert: 0.5 },
        { name: "heilen", text: "Heilen", min: 0, max: 0.3, schritt: 0.002, wert: 0 },
        { name: "keyframe", text: "Keyframe alle (s), 0: nie", min: 0, max: 30, schritt: 0.5, wert: 0 },
      ],
    },
    {
      gruppe: "Bereich mit eigener Bewegung",
      regler: [
        { name: "bx", text: "Rechteck links", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "by", text: "Rechteck oben", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "bb", text: "Rechteck Breite", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "bh", text: "Rechteck Höhe", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "bewX", text: "Bewegung nach rechts (%)", min: -5, max: 5, schritt: 0.05, wert: 0.5 },
        { name: "bewY", text: "Bewegung nach unten (%)", min: -5, max: 5, schritt: 0.05, wert: 0 },
      ],
    },
  ],
};

export { MOSHBILD };
