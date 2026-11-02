// Licht, Kanten, Zeit: Bloom, Kanten (Sobel), Dünne Kanten, Feedback, Datamosh-Imitat, Farbe als Maske.

import { gl, glCanvas } from "../webgl.js";

const GRUPPE = "Licht, Kanten, Zeit";

// ---------- Bloom ----------
// Sehr helles Licht überstrahlt im Auge und in jeder Linse ein wenig die Umgebung. Also: nur was über
// der Schwelle liegt, weichzeichnen und dazuaddieren. Echte Programme machen das in mehreren
// verkleinerten Stufen; hier in einem Durchgang mit 48 Stichproben in einer Spirale.
const BLOOM = {
  id: "bloom",
  name: "Bloom und Glow",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float schwelle, staerke, radius, warm;
void main() {
  vec4 o = texture(bild, uv);
  vec3 glanz = vec3(0.0);
  float r = radius * aufloesung.y * 0.02;
  for (int i = 0; i < 48; i++) {
    float w = float(i) * 2.39996;
    float a = sqrt((float(i) + 0.5) / 48.0);
    vec3 c = texture(bild, uv + vec2(cos(w), sin(w)) * a * r / aufloesung).rgb;
    glanz += max(c - schwelle, 0.0) * (1.0 - a * 0.7); // innen stärker als außen
  }
  glanz /= 48.0;
  glanz *= mix(vec3(1.0), vec3(1.2, 0.95, 0.7), warm);
  farbe = vec4(o.rgb + glanz * staerke * 4.0, o.a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "schwelle", text: "Schwelle", min: 0, max: 1, schritt: 0.01, wert: 0.6 },
        { name: "staerke", text: "Stärke", min: 0, max: 2, schritt: 0.01, wert: 0.8 },
        { name: "radius", text: "Radius", min: 0.2, max: 5, schritt: 0.05, wert: 1.5 },
        { name: "warm", text: "Wärme", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
      ],
    },
  ],
};

// ---------- Kanten (Sobel) ----------
// Der Sobel-Operator misst, wie stark sich die Helligkeit nach rechts (gx) und nach oben (gy) ändert.
// Länge = Kantenstärke, Richtung = wohin es heller wird. „Richtung als Farbe“ zeigt den Winkel als Farbton.
const SOBEL = {
  id: "sobel",
  name: "Kanten (Sobel)",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float staerke, abstand, modus;
void main() {
  vec4 o = texture(bild, uv);
  vec2 g = sobel(uv, abstand);
  float k = clamp(length(g) * staerke, 0.0, 1.0);
  vec3 f;
  if (modus < 0.5) f = vec3(k);
  else if (modus < 1.5) f = vec3(1.0 - k);
  else if (modus < 2.5) f = o.rgb * k * 1.5;
  else {
    float w = atan(g.y, g.x);
    f = (0.5 + 0.5 * cos(w + vec3(0.0, 2.094, 4.189))) * k;
  }
  farbe = vec4(f, o.a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "modus", text: "Darstellung", auswahl: ["weiß auf schwarz", "schwarz auf weiß", "Farbe des Bildes", "Richtung als Farbe"], wert: 0 },
        { name: "staerke", text: "Stärke", min: 0.5, max: 10, schritt: 0.1, wert: 3 },
        { name: "abstand", text: "Abstand (px)", min: 1, max: 6, schritt: 0.5, wert: 1 },
      ],
    },
  ],
};

// ---------- Dünne Kanten ----------
// Sobel gibt breite, weiche Kanten. Canny macht sie dünn: ein Pixel bleibt nur, wenn seine Kantenstärke
// größer ist als die der beiden Nachbarn quer zur Kante (in Richtung des Gefälles). Das heißt
// „Nicht-Maximum-Unterdrückung“: übrig bleibt nur der Grat.
const DUENN = {
  id: "duenn",
  name: "Dünne Kanten",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float schwelle, umkehren;
void main() {
  vec2 g = sobel(uv, 1.0);
  float k = length(g);
  vec2 r = k > 0.0 ? normalize(g) : vec2(0.0);
  // auf die nächste der vier Richtungen runden (waagerecht, senkrecht, zwei Diagonalen)
  r = vec2(round(r.x), round(r.y));
  float vor = length(sobel(uv + r / aufloesung, 1.0));
  float zurueck = length(sobel(uv - r / aufloesung, 1.0));
  float grat = (k >= vor && k >= zurueck) ? smoothstep(schwelle, schwelle * 1.5, k) : 0.0;
  if (umkehren > 0.5) grat = 1.0 - grat;
  farbe = vec4(vec3(grat), texture(bild, uv).a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "schwelle", text: "Schwelle", min: 0.02, max: 1, schritt: 0.01, wert: 0.2 },
        { name: "umkehren", text: "Farbe", auswahl: ["weiß auf schwarz", "schwarz auf weiß"], wert: 0 },
      ],
    },
  ],
};

// ---------- Feedback ----------
// Wie eine Kamera, die auf ihren eigenen Bildschirm zeigt: das letzte Ergebnis kommt verkleinert,
// gedreht und farblich verschoben wieder ins nächste Bild. Daraus werden Tunnel und Spiralen.
// Das letzte Ergebnis merkt sich der Effekt selbst: nach dem Zeichnen (nachher) kopiert er das Bild der
// Grafikkarte in seine Textur "vorher" (copyTexImage2D, ohne Umweg über die CPU).
const vorher = gl ? gl.createTexture() : null;
if (gl) {
  gl.bindTexture(gl.TEXTURE_2D, vorher);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

const FEEDBACK = {
  id: "feedback",
  name: "Feedback",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true,
  shader: /* glsl */ `
uniform sampler2D vorher;
uniform float zoom, drehung, mischung, farbton, nurHell;
void main() {
  vec4 o = texture(bild, uv);
  vec2 q = (uv - 0.5) * vec2(aufloesung.x / aufloesung.y, 1.0);
  float w = radians(drehung);
  q = mat2(cos(w), -sin(w), sin(w), cos(w)) * q / zoom;
  vec2 p = q / vec2(aufloesung.x / aufloesung.y, 1.0) + 0.5;
  vec3 alt = texture(vorher, p).rgb;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) alt = vec3(0.0);
  alt = farbtonDrehen(alt, farbton);
  // nur Helles mitnehmen oder alles überblenden
  vec3 f = nurHell > 0.5 ? max(o.rgb, alt * mischung) : mix(o.rgb, alt, mischung);
  farbe = vec4(f, o.a);
}`,
  einstellungen: (w, zeit) => ({ ...w, vorher, zeit }),
  nachher() {
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, vorher);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, glCanvas.width, glCanvas.height, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "mischung", text: "Mischung", min: 0, max: 0.98, schritt: 0.01, wert: 0.85 },
        { name: "zoom", text: "Zoom", min: 0.8, max: 1.2, schritt: 0.001, wert: 1.02 },
        { name: "drehung", text: "Drehung", min: -10, max: 10, schritt: 0.1, wert: 1 },
        { name: "farbton", text: "Farbton wandert", min: -0.5, max: 0.5, schritt: 0.01, wert: 0.05 },
        { name: "nurHell", text: "Art", auswahl: ["überblenden", "nur Helles (Spuren)"], wert: 1 },
      ],
    },
  ],
};

// ---------- Datamosh-Imitat ----------
// Echter Datamosh braucht ein Video und einen Kodierer (eigenes Projekt). Für ein Bild: was ein
// zerbrochener P-Frame tut, nachmachen. Das Bild in Blöcke teilen (wie der Kodierer), manche Blöcke mit
// einem falschen Bewegungsvektor verschieben und entlang des Vektors verschmieren. Die Zufallszahlen
// hängen am Block und an der Zeit: Blöcke springen, wie bei echtem Mosh.
const MOSHBILD = {
  id: "moshbild",
  name: "Datamosh-Imitat",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  shader: /* glsl */ `
uniform float block, anteil, staerke, schlieren, tempo;
void main() {
  vec2 px = uv * aufloesung;
  vec2 b = floor(px / block);
  float takt = floor(zeit * tempo);
  vec4 o = texture(bild, uv);
  if (zufall(b + takt * 7.0) > anteil) { farbe = o; return; }
  // Bewegungsvektor des Blocks, meist waagerecht wie bei Kameraschwenks
  vec2 v = (vec2(zufall(b + 1.3 + takt), zufall(b + 5.7 + takt) * 0.3) - vec2(0.5, 0.15)) * staerke * block * 6.0;
  vec3 summe = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0 * schlieren;
    summe += texture(bild, (px - v * (1.0 + t)) / aufloesung).rgb;
  }
  vec3 f = summe / 12.0;
  // ein Rest des Fehlers: Farbe im Block leicht verschoben
  f.r = texture(bild, (px - v * 1.1 + vec2(block * 0.2, 0.0)) / aufloesung).r;
  farbe = vec4(f, o.a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "block", text: "Blockgröße (px)", min: 4, max: 64, schritt: 1, wert: 16 },
        { name: "anteil", text: "Anteil der Blöcke", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "staerke", text: "Verschiebung", min: 0, max: 3, schritt: 0.01, wert: 1 },
        { name: "schlieren", text: "Schlieren", min: 0, max: 6, schritt: 0.1, wert: 2 },
        { name: "tempo", text: "Wechsel pro Sekunde", min: 0, max: 12, schritt: 0.5, wert: 3, ruhig: 0.5 },
      ],
    },
  ],
};

// ---------- Farbe als Maske ----------
// Macht einen Bereich durchsichtig: Schwarz (z. B. DaVinci-Exporte vor schwarzem Grund), Weiß,
// Grün- oder Blauschirm. Für Grün und Blau zählt, wie viel mehr dieser Kanal hat als die beiden anderen
// (so funktioniert ein einfacher Keyer). Mit „transparent lassen“ unter Datei bleibt es im Export durchsichtig.
const MASKE = {
  id: "maske",
  name: "Farbe als Maske",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float art, schwelle, weich, umkehren;
void main() {
  vec4 o = texture(bild, uv);
  float wert;
  if (art < 0.5) wert = hell(o.rgb);                  // Schwarz weg: dunkel = durchsichtig
  else if (art < 1.5) wert = 1.0 - hell(o.rgb);       // Weiß weg
  else if (art < 2.5) wert = 1.0 - (o.g - max(o.r, o.b)) * 2.0; // Grün weg
  else wert = 1.0 - (o.b - max(o.r, o.g)) * 2.0;      // Blau weg
  float a = smoothstep(schwelle, schwelle + weich + 0.001, wert);
  if (umkehren > 0.5) a = 1.0 - a;
  vec3 f = o.rgb;
  // farbigen Saum an den Rändern entfernen: der Kanal darf nicht mehr haben als der stärkste andere
  if (art > 1.5 && art < 2.5) f.g = min(f.g, max(f.r, f.b));
  if (art > 2.5) f.b = min(f.b, max(f.r, f.g));
  farbe = vec4(f, o.a * a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "art", text: "Weg damit", auswahl: ["Schwarz", "Weiß", "Grün", "Blau"], wert: 0 },
        { name: "schwelle", text: "Schwelle", min: 0, max: 1, schritt: 0.01, wert: 0.1 },
        { name: "weich", text: "Weich", min: 0, max: 0.5, schritt: 0.01, wert: 0.1 },
        { name: "umkehren", text: "Umkehren", auswahl: ["nein", "ja"], wert: 0 },
      ],
    },
  ],
};

// ---------- RGB-Versatz (Harris-Verschluss) ----------
// Robert Harris (Kodak) belichtete Rot, Grün und Blau nacheinander durch drei Farbfilter. Was stillsteht,
// ist in allen drei gleich und bleibt farbtreu; was sich bewegt, zerfällt in drei farbige Abbilder.
// Hier: Rot von jetzt, Grün von „Abstand“ Bildern früher, Blau von doppelt so weit. Die früheren Bilder
// merkt sich der Effekt selbst (eine Liste von ImageData). Auf einem Foto passiert darum nichts, nur im Video.
const verlauf = [];
const RGBVERSATZ = {
  id: "rgbversatz",
  name: "RGB-Versatz (Harris)",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  cpu(bild, w) {
    const n = Math.round(w.abstand);
    if (verlauf.length && (verlauf[0].width !== bild.width || verlauf[0].height !== bild.height)) verlauf.length = 0;
    verlauf.unshift(new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height));
    if (verlauf.length > 2 * n + 1) verlauf.length = 2 * n + 1;
    const g = verlauf[Math.min(n, verlauf.length - 1)].data;
    const b = verlauf[Math.min(2 * n, verlauf.length - 1)].data;
    const aus = new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height);
    const d = aus.data;
    const k = w.kanaele; // 0: R jetzt, 1: B jetzt (umgekehrt)
    for (let i = 0; i < d.length; i += 4) {
      if (k < 0.5) {
        d[i + 1] = g[i + 1];
        d[i + 2] = b[i + 2];
      } else {
        d[i + 1] = g[i + 1];
        d[i] = b[i];
      }
    }
    return aus;
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "abstand", text: "Abstand (Bilder)", min: 1, max: 15, schritt: 1, wert: 4 },
        { name: "kanaele", text: "Reihenfolge", auswahl: ["Rot jetzt, Blau zuletzt", "Blau jetzt, Rot zuletzt"], wert: 0 },
      ],
    },
  ],
};

export const LICHT = [BLOOM, SOBEL, DUENN, FEEDBACK, MOSHBILD, MASKE, RGBVERSATZ];
