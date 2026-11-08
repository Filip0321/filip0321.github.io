// Pixel Sorting (Kim Asendorf, 2010): in jeder Zeile (oder Spalte) Abschnitte suchen, deren Pixel in einem
// Bereich liegen (z. B. „heller als 0,3 und dunkler als 0,9“), und die Pixel darin nach Helligkeit (oder
// Farbton, Sättigung) sortieren. Was außerhalb liegt, bleibt stehen und trennt die Abschnitte.
//
// Sortieren in einem Shader ist ungewohnt: Ein Pixel kann nur sagen, welche Farbe ER bekommt, nicht wohin
// er selbst geht. Darum ein Sortiernetz, das genau so arbeitet: Bitonic Sort (Ken Batcher, 1968). In jedem
// Durchgang vergleicht jeder Pixel sich mit EINEM Partner (Index i XOR j) und behält den kleineren oder
// den größeren, je nachdem, wo er steht. Nach log₂(n)·(log₂(n)+1)/2 Durchgängen ist die Zeile sortiert,
// für 2048 Pixel 66 Durchgänge. Jeder ist für die Grafikkarte trivial.
//
// Und die Abschnitte? Jeder Pixel bekommt einen Schlüssel aus zwei Teilen: (Nummer seines Abschnitts,
// Wert). Sortiert man die ganze Zeile nach diesem Schlüssel, bleiben die Abschnitte, wo sie sind (ihre
// Nummern steigen ja von links nach rechts), und innen wird nach dem Wert sortiert. Pixel außerhalb des
// Bereichs sind je ein eigener Abschnitt, sie rühren sich nicht.
// Die Nummer des Abschnitts: an jedem Anfang eine 1, dann aufsummiert (eine Präfixsumme, ebenfalls in
// log₂(n) Durchgängen: jeder addiert den Wert 1, 2, 4, 8 … Pixel weiter links; W. D. Hillis und G. Steele).
//
// Alles in 8-Bit-Texturen (läuft so überall, auch am Handy): Farbe in einer, Schlüssel in der anderen
// (Abschnitt in 16 Bit über Rot und Grün, Wert in Blau). Beide schreibt jeder Durchgang zugleich.
// Gerechnet wird nach dem Bild (nachher): der Shader selbst reicht das Bild nur durch, danach wird sortiert
// und das Ergebnis zurück ins Bild gezeichnet.
//
// Runde 5:
//   Wo sortiert wird: das ganze Bild oder bis zu drei Rechtecke. Außerhalb ist jeder Pixel sein eigener
//     Abschnitt (wie Pixel außerhalb des Helligkeitsbereichs), am Rand eines Rechtecks endet ein Streifen.
//   Längere Streifen: „Lücken überbrücken“. Ohne das bricht jeder einzelne zu dunkle oder zu helle Pixel
//     den Streifen ab, darum werden sie in fotografierten Bildern (Rauschen, feine Kanten) kurz. Mit einer
//     Lücke von g Pixeln zählt ein Pixel außerhalb des Bereichs trotzdem dazu, wenn links UND rechts von ihm
//     innerhalb von g Pixeln einer im Bereich liegt. Er wird dann mitsortiert.

import { gl, glCanvas, baueProgramm, VERTEX_SHADER } from "../webgl.js";

const KOPF = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
`;

// 1. Schlüssel: Wert und „hier fängt ein Abschnitt an“; bei „senkrecht“ wird das Bild dabei gedreht
//    (Zeilen der Arbeitstextur = Spalten des Bildes)
const SCHLUESSEL = `${KOPF}
layout(location = 0) out vec4 farbe;
layout(location = 1) out vec4 schluessel;
uniform sampler2D bild;
uniform vec2 groesse;     // Bild
uniform float senkrecht, nach, unten, oben, umgekehrt, brechen, zeit, umkehrBereich;
float hell(vec3 f) { return dot(f, vec3(0.2126, 0.7152, 0.0722)); }
float zufall(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
float wert(vec3 f) {
  if (nach < 0.5) return hell(f);
  if (nach < 1.5) return hsv(f).x;
  if (nach < 2.5) return hsv(f).y;
  return f.r;
}
// Stelle im Bild zu Stelle i der Arbeitstextur (x: Stelle in der Zeile, y: Zeile); senkrecht: von oben nach unten
ivec2 imBild(ivec2 i) {
  return senkrecht > 0.5 ? ivec2(i.y, int(groesse.y) - 1 - i.x) : i;
}
// liegt der Bildpunkt a in einem der Rechtecke? (Regler: 0 bis 1, von oben links)
uniform float anzahl;        // 0: ganzes Bild, sonst so viele Rechtecke
uniform vec4 rechteck[3];    // x, y, Breite, Höhe
uniform float luecke;        // Lücken bis zu so vielen Pixeln überbrücken
bool imBereich(ivec2 a) {
  if (anzahl < 0.5) return true;
  vec2 q = vec2((float(a.x) + 0.5) / groesse.x, 1.0 - (float(a.y) + 0.5) / groesse.y);
  for (int k = 0; k < 3; k++) {
    if (float(k) >= anzahl) break;
    vec4 r = rechteck[k];
    if (q.x >= r.x && q.x <= r.x + r.z && q.y >= r.y && q.y <= r.y + r.w) return true;
  }
  return false;
}
// im Helligkeitsbereich und im Rechteck (i: Arbeitstextur; außerhalb der Zeile: nein)
int laengeZeile() { return senkrecht > 0.5 ? int(groesse.y) : int(groesse.x); }
bool roh(ivec2 i) {
  if (i.x < 0 || i.x >= laengeZeile()) return false;
  ivec2 a = imBild(i);
  if (!imBereich(a)) return false;
  float h = hell(texelFetch(bild, a, 0).rgb);
  bool d = h >= unten && h <= oben;
  return umkehrBereich > 0.5 ? !d : d;
}
// dasselbe, aber kleine Lücken zählen mit: links und rechts innerhalb von „luecke“ Pixeln ist einer drin
bool drin(ivec2 i) {
  if (roh(i)) return true;
  if (luecke < 0.5 || !imBereich(imBild(i))) return false;
  bool l = false, r = false;
  for (int k = 1; k <= 64; k++) {
    if (float(k) > luecke || (l && r)) break;
    if (!l && roh(i - ivec2(k, 0))) l = true;
    if (!r && roh(i + ivec2(k, 0))) r = true;
  }
  return l && r;
}
void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);           // x: Stelle in der Zeile, y: Zeile
  ivec2 n = senkrecht > 0.5 ? ivec2(groesse.y, groesse.x) : ivec2(groesse);
  if (i.x >= n.x) { farbe = vec4(0.0); schluessel = vec4(1.0); return; } // Polster: größer als alles
  ivec2 a = imBild(i);
  vec4 f = texelFetch(bild, a, 0);
  bool d = drin(i);
  // Anfang eines Abschnitts: am Zeilenanfang, außerhalb des Bereichs (jeder Pixel für sich), beim Eintritt
  // in den Bereich, und zufällig (bricht lange Abschnitte, wirkt glitchiger)
  bool anfang = i.x == 0 || !d || !drin(i - ivec2(1, 0)) || zufall(vec2(i) + floor(zeit * 2.0) * 13.0) < brechen;
  float w = clamp(wert(f.rgb), 0.0, 1.0);
  if (umgekehrt > 0.5) w = 1.0 - w;
  farbe = f;
  schluessel = vec4(anfang ? 1.0 / 255.0 : 0.0, 0.0, floor(w * 254.0) / 255.0, 0.0);
}`;

// 16-Bit-Zahl aus Rot und Grün
const ZAHL = `
int zahl(vec4 s) { return int(s.r * 255.0 + 0.5) + 256 * int(s.g * 255.0 + 0.5); }
vec2 alsFarbe(int z) { return vec2(float(z % 256), float(z / 256)) / 255.0; }
`;

// 2. Präfixsumme der Anfänge: Nummer des Abschnitts
const SUMME = `${KOPF}
layout(location = 0) out vec4 farbe;
layout(location = 1) out vec4 schluessel;
uniform sampler2D f0, s0;
uniform int weit;
${ZAHL}
void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(s0, i, 0);
  farbe = texelFetch(f0, i, 0);
  if (s.a > 0.5 || i.x < weit) { schluessel = s; return; }
  int z = zahl(s) + zahl(texelFetch(s0, i - ivec2(weit, 0), 0));
  schluessel = vec4(alsFarbe(min(z, 65534)), s.b, 0.0);
}`;

// 3. ein Durchgang des Sortiernetzes
const SORTIEREN = `${KOPF}
layout(location = 0) out vec4 farbe;
layout(location = 1) out vec4 schluessel;
uniform sampler2D f0, s0;
uniform int k, j;
${ZAHL}
int wertVon(vec4 s) { return s.a > 0.5 ? 0x7fffffff : zahl(s) * 256 + int(s.b * 255.0 + 0.5); }
void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);
  int p = i.x ^ j;                 // der Partner
  vec4 sa = texelFetch(s0, i, 0), sb = texelFetch(s0, ivec2(p, i.y), 0);
  int a = wertVon(sa), b = wertVon(sb);
  bool aufsteigend = (i.x & k) == 0;
  bool links = i.x < p;
  // links behält das Kleinere (aufsteigend) bzw. Größere, rechts umgekehrt
  bool tauschen = (links == aufsteigend) ? (a > b) : (a < b);
  farbe = texelFetch(f0, tauschen ? ivec2(p, i.y) : i, 0);
  schluessel = tauschen ? sb : sa;
}`;

// 4. zurück ins Bild (bei „senkrecht“ zurückgedreht)
const ZURUECK = `${KOPF}
out vec4 farbe;
uniform sampler2D f0, bild;
uniform vec2 groesse;
uniform float senkrecht, mischung;
void main() {
  ivec2 a = ivec2(gl_FragCoord.xy);
  ivec2 i = senkrecht > 0.5 ? ivec2(int(groesse.y) - 1 - a.y, a.x) : a;
  farbe = mix(texelFetch(bild, a, 0), texelFetch(f0, i, 0), mischung);
}`;

let p = null;
function programme() {
  p ??= {
    schluessel: baueProgramm(VERTEX_SHADER, SCHLUESSEL),
    summe: baueProgramm(VERTEX_SHADER, SUMME),
    sortieren: baueProgramm(VERTEX_SHADER, SORTIEREN),
    zurueck: baueProgramm(VERTEX_SHADER, ZURUECK),
  };
  return p;
}

// zwei Paare (Farbe, Schlüssel) zum Hin- und Herschreiben, und eine Kopie des Bildes
const paare = [];
let quelle = null;
let arbeit = [0, 0];
function textur(w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const [n, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, n, v);
  return t;
}
function richteEin(w, h) {
  if (arbeit[0] === w && arbeit[1] === h) return;
  for (const paar of paare) {
    gl.deleteTexture(paar.f);
    gl.deleteTexture(paar.s);
    gl.deleteFramebuffer(paar.rahmen);
  }
  paare.length = 0;
  for (let k = 0; k < 2; k++) {
    const f = textur(w, h);
    const s = textur(w, h);
    const rahmen = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, rahmen);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, s, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    paare.push({ f, s, rahmen });
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  arbeit = [w, h];
}

// Werte und Zeit kommen über das Gedächtnis der Instanz von einstellungen() zu sortiere() (nachher):
// zwischen den beiden zeichnet rendere() das Bild, und mehrere Pixel Sortings dürfen verschiedene Werte haben
const standard = {};

function sortiere(g = standard) {
  const werte = g.werte;
  const zeitJetzt = g.zeit ?? 0;
  if (!gl || !werte) return;
  const prog = programme();
  const w = glCanvas.width;
  const h = glCanvas.height;
  const senkrecht = werte.richtung < 0.5;
  const laenge = senkrecht ? h : w; // so lang ist eine Zeile der Arbeitstextur
  const zeilen = senkrecht ? w : h;
  const n = 2 ** Math.ceil(Math.log2(laenge)); // fürs Sortiernetz: Zweierpotenz, der Rest ist Polster
  if (n > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return;
  richteEin(n, zeilen);
  gl.activeTexture(gl.TEXTURE0);
  const merk = gl.getParameter(gl.TEXTURE_BINDING_2D);

  // das fertige Bild davor (steht im Canvas) als Textur
  quelle ??= gl.createTexture();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, quelle);
  gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, w, h, 0);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_2D, k, v);

  const u = (prog_, name) => gl.getUniformLocation(prog_, name);
  const zeichne = (prog_, ziel, quelleNr) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, paare[ziel].rahmen);
    gl.viewport(0, 0, n, zeilen);
    gl.useProgram(prog_);
    if (quelleNr !== null) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, paare[quelleNr].f);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, paare[quelleNr].s);
      gl.uniform1i(u(prog_, "f0"), 0);
      gl.uniform1i(u(prog_, "s0"), 1);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // 1. Schlüssel
  gl.useProgram(prog.schluessel);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, quelle);
  gl.uniform1i(u(prog.schluessel, "bild"), 0);
  gl.uniform2f(u(prog.schluessel, "groesse"), w, h);
  // ?? 0: ein gemerkter Zustand von früher kennt die neuen Regler nicht (sonst NaN im Shader)
  for (const name of ["nach", "unten", "oben", "umgekehrt", "brechen", "umkehrBereich", "anzahl", "luecke"]) gl.uniform1f(u(prog.schluessel, name), werte[name] ?? 0);
  const r = [1, 2, 3].flatMap((k) => [werte[`r${k}x`] ?? 0, werte[`r${k}y`] ?? 0, werte[`r${k}b`] ?? 1, werte[`r${k}h`] ?? 1]);
  gl.uniform4fv(u(prog.schluessel, "rechteck"), r);
  gl.uniform1f(u(prog.schluessel, "senkrecht"), senkrecht ? 1 : 0);
  gl.uniform1f(u(prog.schluessel, "zeit"), zeitJetzt);
  zeichne(prog.schluessel, 0, null);
  let jetzt = 0;

  // 2. Präfixsumme
  gl.useProgram(prog.summe);
  for (let weit = 1; weit < n; weit *= 2) {
    gl.useProgram(prog.summe);
    gl.uniform1i(u(prog.summe, "weit"), weit);
    zeichne(prog.summe, 1 - jetzt, jetzt);
    jetzt = 1 - jetzt;
  }

  // 3. Sortiernetz
  for (let k = 2; k <= n; k *= 2) {
    for (let j = k / 2; j >= 1; j /= 2) {
      gl.useProgram(prog.sortieren);
      gl.uniform1i(u(prog.sortieren, "k"), k);
      gl.uniform1i(u(prog.sortieren, "j"), j);
      zeichne(prog.sortieren, 1 - jetzt, jetzt);
      jetzt = 1 - jetzt;
    }
  }

  // 4. zurück ins Bild
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(prog.zurueck);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, paare[jetzt].f);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, quelle);
  gl.uniform1i(u(prog.zurueck, "f0"), 0);
  gl.uniform1i(u(prog.zurueck, "bild"), 1);
  gl.uniform2f(u(prog.zurueck, "groesse"), w, h);
  gl.uniform1f(u(prog.zurueck, "senkrecht"), senkrecht ? 1 : 0);
  gl.uniform1f(u(prog.zurueck, "mischung"), werte.mischung);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // aufräumen, wie rendere (webgl.js) es erwartet
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, merk);
}

export const PIXELSORT = {
  id: "pixelsort",
  name: "Pixel Sorting",
  gruppe: "Pixel und Druck",
  zeitabhaengig: true, // „brechen“ wechselt mit der Zeit
  shader: /* glsl */ `
void main() { farbe = texture(bild, uv); } // nur durchreichen, sortiert wird danach (nachher)
`,
  neuesGedaechtnis: () => ({ werte: null, zeit: 0 }),
  einstellungen(w, zeit, g = standard) {
    g.werte = w;
    g.zeit = zeit;
    return { zeit };
  },
  nachher: sortiere,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "richtung", text: "Richtung", auswahl: ["senkrecht", "waagerecht"], wert: 0 },
        { name: "nach", text: "sortieren nach", auswahl: ["Helligkeit", "Farbton", "Sättigung", "Rot"], wert: 0 },
        { name: "umgekehrt", text: "Reihenfolge", auswahl: ["dunkel zuerst", "hell zuerst"], wert: 0 },
        { name: "unten", text: "Bereich ab (Helligkeit)", min: 0, max: 1, schritt: 0.01, wert: 0.25 },
        { name: "oben", text: "Bereich bis", min: 0, max: 1, schritt: 0.01, wert: 0.85 },
        { name: "umkehrBereich", text: "sortiert wird", auswahl: ["im Bereich", "außerhalb"], wert: 0 },
        { name: "luecke", text: "Lücken überbrücken (px): längere Streifen", min: 0, max: 64, schritt: 1, wert: 0 },
        { name: "brechen", text: "Abschnitte brechen", min: 0, max: 0.05, schritt: 0.0005, wert: 0 },
        { name: "mischung", text: "Mischung", min: 0, max: 1, schritt: 0.01, wert: 1 },
      ],
    },
    {
      gruppe: "Wo sortiert wird",
      regler: [
        { name: "anzahl", text: "Bereich", auswahl: ["ganzes Bild", "1 Rechteck", "2 Rechtecke", "3 Rechtecke"], wert: 0 },
        ...[1, 2, 3].flatMap((k) => [
          { name: `r${k}x`, text: `${k}: links`, min: 0, max: 1, schritt: 0.005, wert: [0.1, 0.55, 0.3][k - 1] },
          { name: `r${k}y`, text: `${k}: oben`, min: 0, max: 1, schritt: 0.005, wert: [0.1, 0.4, 0.7][k - 1] },
          { name: `r${k}b`, text: `${k}: Breite`, min: 0, max: 1, schritt: 0.005, wert: [0.3, 0.35, 0.4][k - 1] },
          { name: `r${k}h`, text: `${k}: Höhe`, min: 0, max: 1, schritt: 0.005, wert: [0.5, 0.4, 0.2][k - 1] },
        ]),
      ],
    },
  ],
};
