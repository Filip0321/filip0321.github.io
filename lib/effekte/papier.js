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
        { name: "art", text: "Papier", auswahl: ["weiß", "vergilbt", "Packpapier", "schwarz"], wert: 1 },
        { name: "koernung", text: "Körnung (Pixel)", min: 0.5, max: 6, schritt: 0.1, wert: 1.5 },
        { name: "struktur", text: "Struktur", min: 0, max: 2, schritt: 0.01, wert: 0.7 },
        { name: "relief", text: "Relief (rau wie Aquarellpapier)", min: 0, max: 1, schritt: 0.01, wert: 0.15 },
        { name: "gerippt", text: "gerippt", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "alter", text: "vergilbt", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
      ],
    },
    {
      gruppe: "Bild aufs Papier",
      regler: [
        { name: "modus", text: "als", auswahl: ["Druck (Bild × Papier)", "Tinte (Dunkles saugt ein)", "Kreide (Helles)", "Kreide (Dunkles wird weiß)"], wert: 0 },
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
const ZEITUNG = {
  id: "zeitung",
  name: "Zeitungspapier",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  shader: /* glsl */ `
uniform float raster, farbig, passer, zunahme, rueckseite, alter;
${MATERIAL_GLSL}
// Deckung eines Rasterpunkts: Raster im Winkel w, Zelle „raster“ Pixel, Tonwert t (0 hell bis 1 voll)
float punkt(vec2 px, float w, float t, float saat) {
  vec2 r = mat2(cos(w), -sin(w), sin(w), cos(w)) * px / raster;
  vec2 f = fract(r) - 0.5;
  float radius = sqrt(t / 3.1416) * (1.0 + zunahme * 0.35); // Fläche des Punkts = Tonwert
  float rand = (wert(px * 0.7 + saat) - 0.5) * 0.12 * (1.0 + zunahme); // fransig: Farbe zieht ins Papier
  return 1.0 - smoothstep(radius - 0.06, radius + 0.06, length(f) + rand);
}
void main() {
  vec2 px = uv * aufloesung;
  float saat = saatOberflaeche();
  // Papier: grau-beige, wolkig, Pünktchen aus Altpapier
  vec3 papier = vec3(0.86, 0.84, 0.78) * (1.0 + (fbm(px / 40.0 + saat) - 0.5) * 0.12 + (wert(px / 1.5 + saat) - 0.5) * 0.06);
  papier *= 1.0 - step(0.9985, zufall(floor(px) + saat)) * 0.5;
  vec2 rand = abs(uv - 0.5) * 2.0;
  papier = mix(papier, papier * vec3(0.92, 0.8, 0.55), alter * (0.4 + 0.6 * smoothstep(0.6, 1.0, max(rand.x, rand.y))));
  // Rückseite scheint durch: Zeilen aus „Wörtern“, gespiegelt, in Spalten
  vec2 q = vec2(aufloesung.x - px.x, px.y);
  float spalte = mod(q.x, aufloesung.x / 3.0);
  float zeile = mod(q.y, 11.0);
  float wort = step(0.35, wert(vec2(floor(q.x / 5.0) * 0.6, floor(q.y / 11.0)) + saat * 0.3));
  float text = step(3.0, zeile) * step(zeile, 8.0) * wort * step(10.0, spalte) * step(spalte, aufloesung.x / 3.0 - 10.0);
  papier *= 1.0 - text * rueckseite * 0.12;

  vec3 b = texture(bild, uv).rgb;
  vec3 aus;
  if (farbig < 0.5) {
    aus = papier * (1.0 - 0.92 * punkt(px, 0.785, 1.0 - hell(b), saat));
  } else {
    // CMYK: Schwarz aus dem dunkelsten Anteil, der Rest farbig; jedes Raster ein wenig versetzt (Passer)
    float k = 1.0 - max(b.r, max(b.g, b.b));
    vec3 cmy = (1.0 - b - k) / max(1.0 - k, 1e-3);
    vec2 v = passer * vec2(1.5, -1.0);
    float c = punkt(px + v, 0.262, cmy.x, saat);
    float m = punkt(px - v, 1.309, cmy.y, saat + 1.0);
    float y = punkt(px + vec2(v.y, v.x), 0.0, cmy.z, saat + 2.0);
    float s = punkt(px, 0.785, k, saat + 3.0);
    aus = papier * (1.0 - c * vec3(0.95, 0.1, 0.0)) * (1.0 - m * vec3(0.05, 0.9, 0.15)) * (1.0 - y * vec3(0.0, 0.05, 0.85)) * (1.0 - 0.92 * s);
  }
  farbe = vec4(clamp(spuren(aus, px, false), 0.0, 1.0), 1.0);
}`,
  regler: [
    {
      gruppe: "Zeitung",
      regler: [
        { name: "raster", text: "Raster (Pixel)", min: 2, max: 16, schritt: 0.5, wert: 5 },
        { name: "farbig", text: "Druck", auswahl: ["schwarz", "vierfarbig"], wert: 0 },
        { name: "passer", text: "Passer daneben", min: 0, max: 4, schritt: 0.1, wert: 1 },
        { name: "zunahme", text: "Farbe zerläuft", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "rueckseite", text: "Rückseite scheint durch", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "alter", text: "vergilbt", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
      ],
    },
    SPUREN_REGLER,
    wechselRegler("Blatt", "neues Blatt"),
  ],
};

export const PAPIERE = [PAPIER, ZEITUNG];
