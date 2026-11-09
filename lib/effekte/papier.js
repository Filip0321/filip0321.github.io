// Papier und Material, Teil 1: Papier und Zeitungspapier. (Leinwand: leinwand.js, Holz- und Linolschnitt:
// holzschnitt.js, die gemeinsamen Spuren und das „neue Blatt“: material.js)
//
// Was Papier ausmacht, von groß nach klein:
//   Wolkigkeit: die Fasern verteilen sich beim Schöpfen nie ganz gleichmäßig, das Blatt ist fleckig hell und dunkel
//               (Papiermacher sagen „Durchsicht“; gegen das Licht sieht man Wolken)
//   Fasern:     kurze, leicht gebogene Striche in allen Richtungen, manche heller, manche dunkler
//   Korn/Zahn:  die Oberfläche ist ein Gebirge im Kleinen. Darauf beruht, wie Farbe hält: Tinte läuft in die
//               Täler, Kreide und Bleistift bleiben auf den Spitzen hängen (bei wenig Druck nur dort)
//   Rippung:    geschöpftes („gerippt“, laid) Papier zeigt die Drähte des Siebs: dichte feine Linien und alle paar
//               Zentimeter eine kräftigere quer dazu
//   Alter:      Papier vergilbt (Lignin oxidiert), am Rand mehr; dazu die Spuren aus material.js
// Das Relief entsteht aus der Höhe des Korns: das Gefälle (Gradient) gegen ein Licht von links oben, wie beim
// Prägen (Emboss). Alles hängt an Pixeln, nicht am Bild: das Korn ist bei jeder Bildgröße gleich fein.
//
// Wie das Bild aufs Papier kommt (modus):
//   Druck:   Bild mal Papier (multiplizieren). Weiß wird zu Papier, Schwarz bleibt schwarz, die Struktur scheint durch
//   Tinte:   dunkle Stellen sind Tinte; sie verläuft entlang der Fasern und sammelt sich in den Tälern
//   Kreide:  helle Stellen sind Kreide oder Weißstift; sie bleiben nur auf den Spitzen des Korns, bei wenig
//            Farbe nur auf den höchsten (darum wirkt Kreide auf schwarzem Papier so körnig)
//   Kreide umgekehrt: dunkle Linien werden weiße Kreide (Zeichnungen schwarz auf weiß auf schwarzes Papier)

import { MATERIAL_GLSL, SPUREN_REGLER, wechselRegler } from "./material.js";

const GRUPPE = "Papier und Material";

const PAPIER = {
  id: "papier",
  name: "Papier",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  shader: /* glsl */ `
uniform float art, alter, koernung, struktur, relief, gerippt;
uniform float modus, deckung, verlaufen;
${MATERIAL_GLSL}
// Fasern: in jeder Zelle ein kurzer Strich mit zufälliger Lage und Richtung; Abstand zum nächsten Strich
float fasern(vec2 p, float saat) {
  vec2 z = floor(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = z + vec2(float(x), float(y));
    vec2 m = c + vec2(zufall(c + saat), zufall(c + saat + 3.7));
    float w = zufall(c + saat + 9.1) * 6.2832;
    vec2 r = vec2(cos(w), sin(w));
    vec2 q = p - m;
    float t = clamp(dot(q, r), -0.9, 0.9);          // Strich der Länge 1,8 Zellen
    d = min(d, length(q - r * t + vec2(-r.y, r.x) * 0.08 * t * t)); // leicht gebogen
  }
  return d;
}
// Höhe des Papiers (etwa 0 bis 1) an der Pixelstelle px
float hoehe(vec2 px, float saat) {
  vec2 p = px / koernung;
  float h = 0.55 * fbm(p * 0.35 + saat) + 0.25 * wert(p * 1.7 + saat * 1.3);
  h += struktur * 0.35 * (1.0 - smoothstep(0.0, 0.07, fasern(p * 0.12, saat))) * (zufall(floor(p * 0.12) + saat) - 0.4);
  // Rippung: feine Linien (alle 1 mm, hier 6 Pixel mal Körnung) und kräftige alle 25 mm
  h += gerippt * (0.06 * sin(px.y / koernung * 1.05) + 0.12 * smoothstep(0.9, 1.0, cos(px.x / koernung * 0.042)));
  return h;
}

void main() {
  vec2 px = uv * aufloesung;
  float saat = saatOberflaeche();

  // ---- das Blatt ----
  vec3 grund = art < 0.5 ? vec3(0.95, 0.94, 0.91) : art < 1.5 ? vec3(0.93, 0.85, 0.66) : art < 2.5 ? vec3(0.70, 0.55, 0.38) : vec3(0.075, 0.07, 0.068);
  bool dunkel = art > 2.5;
  float h = hoehe(px, saat);
  float wolken = fbm(px / (koernung * 60.0) + saat * 0.7); // große, weiche Flecken
  vec3 papier = grund * (1.0 + (wolken - 0.5) * 0.18 * struktur + (h - 0.45) * 0.25 * struktur);
  // Relief: Gefälle der Höhe gegen ein Licht von links oben
  float hx = hoehe(px + vec2(1.0, 0.0), saat) - h;
  float hy = hoehe(px + vec2(0.0, 1.0), saat) - h;
  float licht = (-hx + hy) * relief * 6.0;
  papier *= 1.0 + licht * (dunkel ? 2.5 : 1.0);

  // ---- Alter: vergilben, am Rand mehr ----
  vec2 rand = abs(uv - 0.5) * 2.0;
  float randNah = smoothstep(0.55, 1.0, max(rand.x, rand.y) + (fbm(px / (koernung * 25.0) + saat) - 0.5) * 0.3);
  vec3 gelb = dunkel ? papier * 1.25 + vec3(0.03, 0.02, 0.0) : papier * vec3(0.93, 0.82, 0.6);
  papier = mix(papier, gelb, alter * (0.35 + 0.65 * randNah));

  // ---- das Bild aufs Papier ----
  // Tinte verläuft: die Stelle, an der das Bild gelesen wird, wandert ein wenig mit den Fasern
  vec2 lauf = (vec2(wert(px / (koernung * 3.0) + saat), wert(px / (koernung * 3.0) + saat + 5.0)) - 0.5) * verlaufen * 6.0 / aufloesung;
  vec4 b = texture(bild, uv + (modus > 0.5 && modus < 1.5 ? lauf : vec2(0.0)));
  vec3 aus;
  if (modus < 0.5) {
    aus = papier * mix(vec3(1.0), b.rgb, deckung * (0.9 + 0.2 * (h - 0.45)));
  } else if (modus < 1.5) {
    float tinte = (1.0 - hell(b.rgb)) * deckung * clamp(0.75 + (0.55 - h) * 0.9, 0.0, 1.2); // mehr in den Tälern
    aus = mix(papier, papier * b.rgb / max(1e-3, max(b.r, max(b.g, b.b))) * 0.12, clamp(tinte, 0.0, 1.0));
  } else {
    // Kreide: nur wo das Korn höher ist als „wie wenig Kreide da ist“
    float menge = modus < 2.5 ? hell(b.rgb) : 1.0 - hell(b.rgb);
    float schwelle = 0.95 - menge * deckung * 0.7;  // viel Kreide: bis tief hinab, wenig: nur die Spitzen
    float bedeckt = smoothstep(schwelle - 0.06, schwelle + 0.06, h + 0.1);
    vec3 kreide = modus < 2.5 ? b.rgb * 0.95 + 0.04 : vec3(0.93, 0.91, 0.87);
    aus = mix(papier, kreide * (1.0 + licht * 0.5), bedeckt * min(1.0, menge * 3.0));
  }
  farbe = vec4(clamp(spuren(aus, px, dunkel), 0.0, 1.0), b.a);
}`,
  regler: [
    {
      gruppe: "Papier",
      regler: [
        { name: "art", text: "Papier", auswahl: ["weiß", "vergilbt", "Packpapier", "schwarz"], wert: 0 },
        { name: "koernung", text: "Körnung (Pixel)", min: 0.5, max: 6, schritt: 0.1, wert: 1.5 },
        { name: "struktur", text: "Struktur", min: 0, max: 2, schritt: 0.01, wert: 0.7 },
        { name: "relief", text: "Relief (rau wie Aquarellpapier)", min: 0, max: 1, schritt: 0.01, wert: 0.15 },
        { name: "gerippt", text: "gerippt", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "alter", text: "vergilbt", min: 0, max: 1, schritt: 0.01, wert: 0 },
      ],
    },
    {
      gruppe: "Bild aufs Papier",
      regler: [
        { name: "modus", text: "als", auswahl: ["Druck (Bild × Papier)", "Tinte (Dunkles saugt ein)", "Kreide (Helles)", "Kreide (Dunkles wird weiß)"], wert: 1 },
        { name: "deckung", text: "Deckung", min: 0, max: 1, schritt: 0.01, wert: 0.9 },
        { name: "verlaufen", text: "Tinte verläuft", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
      ],
    },
    SPUREN_REGLER,
    wechselRegler("Blatt", "neues Blatt"),
  ],
};

// ---------- Zeitungspapier ----------
// Billiges Papier aus Holzschliff und Altpapier: grau-beige, mit dunklen Pünktchen (Druckfarbe aus dem Altpapier),
// vergilbt schnell (viel Lignin). Gedruckt im Rasterdruck (Punkte im Raster, groß = dunkel), grob, weil das saugende
// Papier feine Punkte zerlaufen ließe; die Punkte werden dabei größer und fransig („Tonwertzunahme“).
// Farbig: vier Raster (Cyan, Magenta, Gelb, Schwarz) in den klassischen Winkeln, die nie ganz genau übereinander
// liegen (Passer). Und weil das Papier dünn ist, scheint die Rückseite durch: gespiegelte Textspalten.
// Zeitungen gibt es auch auf weißem Papier, und Finanzblätter auf lachsrosa.
//
// Drei Arten (seite):
//   nur das Bild gerastert
//   eine Zeitungsseite: Kopfzeile, Spalten, Text aus der Pixelschrift (schrift.js), das Bild als gerastertes Foto
//     mit Bildunterschrift darin
//   eine Zeitungsseite, das Bild darübergedruckt: als hätte man die Zeitung in den Drucker gelegt. Wo das Bild hell
//     ist, liest man den Text, wo es dunkel ist, liegt die Tinte darüber; sie zieht ins saugende Papier.
// Die Druckfarbe verläuft im Papier (die Buchstaben werden fett und weich) und wird verschmiert: wo eine Hand oder
// ein Ärmel darüber ging, zieht die Farbe Schlieren in eine Richtung.
//
// Text: ohne eigenen Text sind die Wörter Zufall (Buchstaben so oft wie im Deutschen). Eigener Text wird hier in
// JavaScript gesetzt (Blocksatz, Absätze eingerückt) und als Nummern (schrift.js: kodiere) in ein Feld ganzer
// Die stabile Variante zeichnet die Zeitungsseite bewusst schematisch direkt im Shader.
const ZEITUNG = {
  id: "zeitung",
  name: "Zeitungspapier",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  // Zeitungspapier hat pro Pixel viele Text-, Rausch- und Druckabfragen. Die Live-Vorschau
  // bleibt deshalb absichtlich sehr klein und langsam; Export rechnet weiterhin in voller Qualität.
  vorschauMaxKante: 64,
  vorschauFps: 1,
  einstellungen(w, zeit) {
    // Der leichte Zeitungsshader verwendet bewusst keine individuell gepackten Textdaten.
    // Textfelder bleiben in der Oberfläche erhalten, werden in dieser stabilen Variante aber ignoriert.
    const { eigenerText, eigeneUeberschrift, eigeneUnterschrift, ...zahlen } = w;
    return { ...zahlen, zeit };
  },
  shader: /* glsl */ `
uniform float raster, farbig, seite, papierArt, struktur, puenktchen, rueckseite, alter;
uniform float rand, spalten, schriftGroesse, kopfGroesse, fotoSpalten, fotoSpalte, fotoOben, fotoHoehe, unterschrift;

// Absichtlich einfacher Zeitungseffekt: wenige Texturzugriffe, kein Text-Uniform-Array,
// keine mehrfache Seitenabfrage und kein FBM. Das soll auch auf schwächeren GPUs stabil laufen.
float punktdruck(vec3 b, vec2 px) {
  float h = dot(b, vec3(0.2126, 0.7152, 0.0722));
  vec2 z = px / max(raster, 2.0);
  vec2 q = fract(z) - 0.5;
  float r = sqrt(clamp(1.0 - h, 0.0, 1.0)) * 0.48;
  float d = length(q);
  return 1.0 - smoothstep(r - 0.07, r + 0.07, d);
}

vec3 rasterBild(vec3 b, vec2 px) {
  float p = punktdruck(b, px);
  if (farbig < 0.5) return vec3(1.0 - p * 0.92);
  // Vierfarbiger Eindruck ohne vier separate Raster-/Textur-Pipelines.
  vec3 grau = vec3(1.0 - p * 0.88);
  return mix(grau, b, 0.28);
}

void main() {
  vec2 px = uv * aufloesung;
  vec3 quelle = texture(bild, uv).rgb;
  float korn = (zufall(floor(px / 3.0)) - 0.5) * 0.055 * struktur;
  vec3 grund = papierArt < 0.5 ? vec3(0.84, 0.82, 0.75)
             : papierArt < 1.5 ? vec3(0.95, 0.94, 0.90)
             : papierArt < 2.5 ? vec3(0.86, 0.76, 0.56)
             : vec3(0.98, 0.86, 0.80);
  vec2 rand2 = abs(uv - 0.5) * 2.0;
  float randAlter = smoothstep(0.55, 1.0, max(rand2.x, rand2.y));
  vec3 papier = grund * (1.0 + korn - alter * randAlter * 0.12);
  float fleck = step(0.985, zufall(floor(px))) * puenktchen * 0.18;
  papier *= 1.0 - fleck;

  vec3 aus;
  if (seite < 0.5) {
    aus = papier * rasterBild(quelle, px);
  } else {
    // Einfache Zeitungsseite: Kopfzeile, Spalten und ein gerastertes Foto.
    float kopf = step(0.82, uv.y) * step(0.06, uv.x) * step(uv.x, 0.94);
    float trennlinie = step(abs(uv.y - 0.79), 0.003) * step(0.06, uv.x) * step(uv.x, 0.94);
    float foto = step(0.06, uv.x) * step(uv.x, 0.48) * step(0.28, uv.y) * step(uv.y, 0.72);
    float text = 0.0;
    float spaltenN = clamp(spalten, 1.0, 8.0);
    float textBereich = step(0.51, uv.x) * step(uv.x, 0.94) + step(0.06, uv.x) * step(uv.x, 0.48) * step(uv.y, 0.25);
    float zeilen = mod(floor(uv.y * (aufloesung.y / max(4.0, schriftGroesse * 2.0))), 2.0);
    float linie = step(0.18, fract(uv.y * (aufloesung.y / max(4.0, schriftGroesse * 2.0))))
                * step(fract(uv.x * spaltenN * 1.7), 0.78);
    text = textBereich * linie * (1.0 - zeilen * 0.35);
    float titel = kopf * step(0.16, fract(uv.x * 9.0));
    float fotoRand = foto * (1.0 - step(0.012, min(min(uv.x - 0.06, 0.48 - uv.x), min(uv.y - 0.28, 0.72 - uv.y))));
    vec3 fotoDruck = rasterBild(quelle, px);
    aus = papier * (1.0 - max(max(text, titel), trennlinie) * 0.88);
    aus = mix(aus, papier * fotoDruck, foto);
    aus *= 1.0 - fotoRand * 0.55;
    if (seite > 1.5) aus *= mix(vec3(1.0), rasterBild(quelle, px), 0.28);
    // Die Rückseite bleibt nur als sehr dezente, einfache Linienstruktur sichtbar.
    float rueck = step(0.25, fract(uv.y * 38.0)) * step(0.1, fract(uv.x * 17.0));
    aus *= 1.0 - rueck * rueckseite * 0.035;
  }
  farbe = vec4(clamp(aus, 0.0, 1.0), 1.0);
}`,
  regler: [
    {
      gruppe: "Zeitung",
      regler: [
        { name: "seite", text: "Darstellung", auswahl: ["Bild gerastert", "Zeitungsseite mit Foto", "Zeitungsseite mit überdrucktem Bild"], wert: 1 },
        { name: "raster", text: "Rastergröße", min: 2, max: 16, schritt: 0.5, wert: 4 },
        { name: "farbig", text: "Druck", auswahl: ["schwarz", "farbig"], wert: 0 },
      ],
    },
    {
      gruppe: "Zeitungsseite",
      regler: [
        { name: "spalten", text: "Spalten", min: 1, max: 8, schritt: 1, wert: 4 },
        { name: "schriftGroesse", text: "Zeilenabstand", min: 0.4, max: 5, schritt: 0.05, wert: 1.1 },
      ],
    },
    {
      gruppe: "Papier",
      regler: [
        { name: "papierArt", text: "Papier", auswahl: ["Zeitungsgrau", "weiß", "vergilbt", "lachsrosa"], wert: 0 },
        { name: "struktur", text: "Papierstruktur", min: 0, max: 2, schritt: 0.01, wert: 1 },
        { name: "puenktchen", text: "Altpapier-Pünktchen", min: 0, max: 1, schritt: 0.01, wert: 1 },
        { name: "rueckseite", text: "Rückseite scheint durch", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "alter", text: "Vergilbung", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
      ],
    },
  ],
};

export const PAPIERE = [PAPIER, ZEITUNG];
