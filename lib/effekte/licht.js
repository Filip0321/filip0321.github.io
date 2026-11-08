// Licht, Kanten, Zeit: Bloom, Kanten (Sobel), Dünne Kanten, Feedback, Farbe als Maske.
// (Das Datamosh-Imitat ist weg: das Projekt Datamosh kann dasselbe echt, mit Bild-Clip und gelöschtem I-Frame.)

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
// Runde 5, wie bei echtem Video-Feedback:
//   Drehpunkt  um welchen Punkt gezoomt und gedreht wird. Bei der echten Kamera ist das die Stelle, auf
//              die die Mitte des Objektivs zeigt. Liegt er nicht in der Mitte, wandert der Tunnel zur Seite
//              und die Spirale wird schief.
//   Versatz    die Kamera steht etwas neben dem Bildschirm: jede Runde rutscht das Bild ein Stück weiter.
//              Mit Zoom und Drehung zusammen entstehen Bögen und Schnecken statt eines Tunnels.
//   Rand       was hereinkommt, wo das alte Bild aufhört: schwarz (der Rand des Bildschirms) oder gespiegelt
// Die Rechnung für einen Punkt p (Bildhöhe = 1, damit Drehen nicht verzerrt):
//   alt = vorher( D · (p − Drehpunkt) / Zoom + Drehpunkt − Versatz )      D: Drehmatrix
// Rückwärts gedacht: für jeden Punkt des neuen Bildes fragt man, wo er im alten herkam. Darum durch Zoom
// teilen und den Versatz abziehen.
// Das letzte Ergebnis merkt sich der Effekt selbst: nach dem Zeichnen (nachher) kopiert er das Bild der
// Grafikkarte in seine Textur "vorher" (copyTexImage2D, ohne Umweg über die CPU). Jede Instanz hat ihre eigene
// Textur (instanzen.js: neuesGedaechtnis), sonst würden sich zwei Feedbacks ein Bild teilen.
function neueVorherTextur() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return t;
}
const standard = {}; // Gedächtnis, wenn jemand ohne Instanz ruft

const FEEDBACK = {
  id: "feedback",
  name: "Feedback",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true,
  shader: /* glsl */ `
uniform sampler2D vorher;
uniform float zoom, drehung, mischung, farbton, nurHell, drehX, drehY, versatzX, versatzY, rand;
uniform float phosphor, phosphorFarbe, zeilen, zeilenZahl;
void main() {
  vec4 o = texture(bild, uv);
  vec2 seiten = vec2(aufloesung.x / aufloesung.y, 1.0);
  vec2 dreh = vec2(drehX, 1.0 - drehY); // Regler: 0 oben, uv: 0 unten
  vec2 q = (uv - dreh) * seiten;
  float w = radians(drehung);
  q = mat2(cos(w), -sin(w), sin(w), cos(w)) * q / zoom;
  vec2 p = q / seiten + dreh - vec2(versatzX, -versatzY) * 0.01; // Versatz in Prozent der Bildbreite und -höhe
  vec3 alt;
  if (rand > 0.5) {
    vec2 m = abs(mod(p - 1.0, 2.0) - 1.0); // gespiegelt: 0 → 1 → 0 → 1 … wie Spiegel an jedem Rand
    alt = texture(vorher, m).rgb;
  } else {
    alt = texture(vorher, p).rgb;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) alt = vec3(0.0);
  }
  alt = farbtonDrehen(alt, farbton);
  // Phosphor: auf einem echten Bildschirm leuchten die drei Farben verschieden lang nach (bei vielen
  // Röhren Grün am längsten, Blau am kürzesten). Jede Runde durch die Schleife verliert darum jede Farbe
  // einen anderen Anteil: die Spuren werden mit jeder Runde grüner (oder bernsteinfarben).
  vec3 nach = phosphorFarbe < 0.5 ? vec3(0.93, 1.0, 0.8) : phosphorFarbe < 1.5 ? vec3(1.0, 0.9, 0.6) : vec3(0.85, 0.9, 1.0);
  alt *= mix(vec3(1.0), nach, phosphor);
  // Zeilen: die Kamera filmt einen Bildschirm mit Zeilen; jede Runde kommen sie wieder dazu, so werden sie
  // im Feedback immer deutlicher (und verbiegen sich mit Zoom und Drehung zu Moiré)
  float zeile = 0.5 + 0.5 * cos(uv.y * zeilenZahl * 6.2831853);
  alt *= 1.0 - zeilen * zeile;
  // nur Helles mitnehmen oder alles überblenden
  vec3 f = nurHell > 0.5 ? max(o.rgb, alt * mischung) : mix(o.rgb, alt, mischung);
  farbe = vec4(f, o.a);
}`,
  // Standardwerte zuerst: ein gemerkter Zustand von früher kennt die neuen Regler nicht; ohne Wert wäre
  // die Zahl im Shader NaN, und dann kommt aus „vorher“ nur Schwarz (das Feedback schmiert nicht mehr)
  neuesGedaechtnis: () => ({ vorher: null }), // die Textur erst beim ersten Bild (dann gibt es gl sicher)
  gibFrei: (g) => g.vorher && gl.deleteTexture(g.vorher),
  einstellungen(w, zeit, g = standard) {
    g.vorher ??= gl ? neueVorherTextur() : null;
    return { drehX: 0.5, drehY: 0.5, versatzX: 0, versatzY: 0, rand: 0, phosphor: 0, phosphorFarbe: 0, zeilen: 0, zeilenZahl: 240, ...w, vorher: g.vorher, zeit };
  },
  nachher(g = standard) {
    if (!gl || !g.vorher) return;
    gl.bindTexture(gl.TEXTURE_2D, g.vorher);
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
        { name: "drehX", text: "Drehpunkt links–rechts", min: 0, max: 1, schritt: 0.005, wert: 0.5 },
        { name: "drehY", text: "Drehpunkt oben–unten", min: 0, max: 1, schritt: 0.005, wert: 0.5 },
        { name: "versatzX", text: "Versatz nach rechts (% pro Bild)", min: -3, max: 3, schritt: 0.01, wert: 0 },
        { name: "versatzY", text: "Versatz nach unten (% pro Bild)", min: -3, max: 3, schritt: 0.01, wert: 0 },
        { name: "rand", text: "Rand", auswahl: ["schwarz", "gespiegelt"], wert: 0 },
        { name: "phosphor", text: "Phosphor-Nachleuchten", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "phosphorFarbe", text: "Phosphor", auswahl: ["grün (P1)", "bernstein (P3)", "blau-weiß (P4)"], wert: 0 },
        { name: "zeilen", text: "Zeilen", min: 0, max: 0.6, schritt: 0.01, wert: 0 },
        { name: "zeilenZahl", text: "Zahl der Zeilen", min: 60, max: 600, schritt: 10, wert: 240 },
        { name: "farbton", text: "Farbton wandert", min: -0.5, max: 0.5, schritt: 0.01, wert: 0.05 },
        { name: "nurHell", text: "Art", auswahl: ["überblenden", "nur Helles (Spuren)"], wert: 1 },
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

export const LICHT = [BLOOM, SOBEL, DUENN, FEEDBACK, MASKE, RGBVERSATZ];

