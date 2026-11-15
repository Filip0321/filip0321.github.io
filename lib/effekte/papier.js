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
import { setzeSeite } from "./zeitung-satz.js";

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
// liegen (Passer). Und weil das Papier dünn ist, scheint die Rückseite durch: hier die eigene Seite gespiegelt.
// Zeitungen gibt es auch auf weißem Papier, und Finanzblätter auf lachsrosa.
//
// Drei Arten (seite):
//   nur das Bild gerastert
//   eine Zeitungsseite: Überschrift, Spalten im Blocksatz, das Bild als gerastertes Foto mit Bildunterschrift
//   eine Zeitungsseite, das Bild darübergedruckt: als hätte man die Zeitung in den Drucker gelegt. Wo das Bild hell
//     ist, liest man den Text, wo es dunkel ist, liegt die Tinte darüber; sie zieht ins saugende Papier.
// Die Druckfarbe verläuft im Papier (die Buchstaben werden fett und weich) und wird verschmiert: wo eine Hand oder
// ein Ärmel darüber ging, zieht die Farbe Schlieren in eine Richtung.
//
// Die Seite selbst (Text, Linien, Platz für das Foto) setzt zeitung-satz.js mit Canvas 2D, einmal, und der Shader
// liest sie nur noch als Bild (Rot: Druckfarbe, Grün: Foto). Vorher (Runde 7f) wurde jeder Buchstabe in jedem Pixel
// neu gerechnet, für Verlaufen und Verschmieren noch zehnmal: das war zu viel, die Seite brach zusammen, und die
// Notlösung danach war nur noch ein Schema. Jetzt: echte Schrift, eigener Text, und wenig Arbeit pro Pixel.
const ZEITUNG = {
  id: "zeitung",
  name: "Zeitungspapier",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  einstellungen(w, zeit, g = {}) {
    const { eigenerText, eigeneUeberschrift, eigeneUnterschrift, ...zahlen } = w; // Text ist kein Uniform
    // die Ausgabe: „Blatt“, und mit „neues Blatt pro Sekunde“ (wenn dabei alles wechselt) jedes Mal eine neue Seite
    const nummer = w.proSek > 0 ? Math.floor(zeit * w.proSek + 0.001) : 0;
    const saat = w.blatt * 7.7 + (w.wechsel > 1.5 ? nummer * 3.1 : 0);
    // die Seite erst gesetzt, wenn rendere die Größe kennt; nur neu, wenn sich etwas daran geändert hat
    const satz = (bw, bh) => {
      const schluessel = JSON.stringify([bw, bh, saat, eigenerText, eigeneUeberschrift, eigeneUnterschrift, w.seite, w.spalten, w.schriftGroesse, w.kopfGroesse, w.rand, w.spaltenAbstand, w.fotoSpalten, w.fotoSpalte, w.fotoOben, w.fotoHoehe, w.unterschrift]);
      if (g.satz?.schluessel !== schluessel) {
        g.leinwand ??= typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bw, bh) : document.createElement("canvas");
        g.satz = { schluessel, ...setzeSeite(g.leinwand, bw, bh, w, saat) };
      }
      return g.satz;
    };
    return {
      ...zahlen,
      zeit,
      seitenBild: (bw, bh) => (w.seite > 0.5 ? (satz(bw, bh), g.leinwand) : leereTextur()),
      fotoRect: (bw, bh) => (w.seite > 0.5 ? satz(bw, bh).foto : [2, 2, 2, 2]),
    };
  },
  shader: /* glsl */ `
uniform float raster, farbig, passer, zunahme, rueckseite, alter, seite, verschmiert;
uniform float papierArt, struktur, relief, puenktchen, druckDeckung, druckVerlaufen, druckArt;
uniform sampler2D seitenBild; // Rot: Druckfarbe, Grün: Foto (zeitung-satz.js)
uniform vec4 fotoRect;        // das Foto in uv: x0, y0, x1, y1
${MATERIAL_GLSL}
// Deckung eines Rasterpunkts: Raster im Winkel w, Zelle „raster“ Pixel, Tonwert t (0 hell bis 1 voll)
float punkt(vec2 px, float w, float t, float saat) {
  vec2 r = mat2(cos(w), -sin(w), sin(w), cos(w)) * px / raster;
  vec2 f = fract(r) - 0.5;
  float radius = sqrt(t / 3.1416) * (1.0 + zunahme * 0.35); // Fläche des Punkts = Tonwert
  float rand = (wert(px * 0.7 + saat) - 0.5) * 0.12 * (1.0 + zunahme); // fransig: Farbe zieht ins Papier
  return 1.0 - smoothstep(radius - 0.06, radius + 0.06, length(f) + rand);
}
// ein Bild gerastert (schwarz oder vierfarbig); zurück: was vom Papier übrig bleibt (1 = nichts gedruckt)
vec3 gerastert(vec3 b, vec2 px, float saat) {
  if (farbig < 0.5) return vec3(1.0 - 0.92 * punkt(px, 0.785, 1.0 - hell(b), saat));
  // CMYK: Schwarz aus dem dunkelsten Anteil, der Rest farbig; jedes Raster ein wenig versetzt (Passer)
  float k = 1.0 - max(b.r, max(b.g, b.b));
  vec3 cmy = (1.0 - b - k) / max(1.0 - k, 1e-3);
  vec2 v = passer * vec2(1.5, -1.0);
  float c = punkt(px + v, 0.262, cmy.x, saat);
  float m = punkt(px - v, 1.309, cmy.y, saat + 1.0);
  float y = punkt(px + vec2(v.y, v.x), 0.0, cmy.z, saat + 2.0);
  float s = punkt(px, 0.785, k, saat + 3.0);
  return (1.0 - c * vec3(0.95, 0.1, 0.0)) * (1.0 - m * vec3(0.05, 0.9, 0.15)) * (1.0 - y * vec3(0.0, 0.05, 0.85)) * (1.0 - 0.92 * s);
}
float tinte(vec2 q) { return texture(seitenBild, q).r; }

void main() {
  vec2 px = uv * aufloesung;
  vec2 e = 1.0 / aufloesung;
  float saat = saatOberflaeche();
  float sF = saatFlecken();
  // Papier: grau-beige (Zeitung), weiß, vergilbt, lachsrosa (Finanzblatt); wolkig, Pünktchen aus Altpapier
  vec3 grund = papierArt < 0.5 ? vec3(0.86, 0.84, 0.78) : papierArt < 1.5 ? vec3(0.95, 0.945, 0.93) : papierArt < 2.5 ? vec3(0.88, 0.8, 0.62) : vec3(0.99, 0.9, 0.83);
  vec3 papier = grund * (1.0 + ((fbm(px / 40.0 + saat) - 0.5) * 0.12 + (wert(px / 1.5 + saat) - 0.5) * 0.06) * struktur);
  papier *= 1.0 - step(0.9985, zufall(floor(px) + saat)) * 0.5 * puenktchen;
  // Relief: die Fasern als kleines Gebirge, Licht von links oben
  if (relief > 0.0) {
    float h0 = wert(px / 2.0 + saat);
    papier *= 1.0 + (h0 - wert((px - vec2(1.0, -1.0)) / 2.0 + saat)) * relief * 0.6;
  }
  vec2 rand2 = abs(uv - 0.5) * 2.0;
  papier = mix(papier, papier * vec3(0.92, 0.8, 0.55), alter * (0.4 + 0.6 * smoothstep(0.6, 1.0, max(rand2.x, rand2.y))));

  vec3 aus;
  if (seite < 0.5) {
    aus = papier * gerastert(texture(bild, uv).rgb, px, saat);
  } else {
    // Rückseite scheint durch: dieselbe Seite gespiegelt, etwas versetzt und weich
    vec2 r = vec2(1.0 - uv.x, uv.y) + vec2(0.003, -0.002);
    float hinten = (tinte(r) + tinte(r + e * 1.5) + tinte(r - e * 1.5)) / 3.0;
    papier *= 1.0 - hinten * rueckseite * 0.12;
    // Druckfarbe; verläuft: das Mittel der Nachbarn macht die Buchstaben weich und etwas fetter
    float t = tinte(uv);
    if (zunahme > 0.0) {
      float d = 0.6 + zunahme * 0.8;
      float um = tinte(uv + vec2(d, 0.0) * e) + tinte(uv - vec2(d, 0.0) * e) + tinte(uv + vec2(0.0, d) * e) + tinte(uv - vec2(0.0, d) * e);
      t = max(t, um * 0.25 * zunahme * 1.4);
      t = clamp(t + (wert(px * 0.8 + saat) - 0.5) * 0.25 * zunahme * t, 0.0, 1.0); // fransig
    }
    // verschmiert: in manchen Flecken zieht die Farbe Schlieren in eine Richtung
    if (verschmiert > 0.0) {
      float wo = smoothstep(0.5, 0.72, fbm(px / (aufloesung.y * 0.12) + sF * 1.9)) * verschmiert;
      if (wo > 0.01) {
        float w = fbm(px / (aufloesung.y * 0.4) + sF) * 6.2832;
        vec2 rr = vec2(cos(w), sin(w)) * 0.004 * vec2(aufloesung.y / aufloesung.x, 1.0);
        float zug = 0.0;
        for (int i = 1; i <= 6; i++) zug = max(zug, tinte(uv - rr * float(i)) * exp(-float(i) * 0.35));
        t = max(t, zug * wo * 0.75);
        t *= 1.0 - wo * 0.25; // was weggewischt wurde, fehlt an seinem Platz
      }
    }
    // das Foto: in seinem Feld gerastert
    vec3 foto = vec3(1.0);
    if (uv.x >= fotoRect.x && uv.x <= fotoRect.z && uv.y >= fotoRect.y && uv.y <= fotoRect.w) {
      vec2 fu = (uv - fotoRect.xy) / (fotoRect.zw - fotoRect.xy);
      foto = gerastert(texture(bild, fu).rgb, px, saat);
    }
    aus = papier * foto * (1.0 - 0.88 * clamp(t, 0.0, 1.0));
    if (seite > 1.5) {
      // darübergedruckt: die Tinte des Druckers zieht ins Papier (wandert ein wenig mit den Fasern, weich gemittelt),
      // wird stumpfer als auf Fotopapier und deckt den Text darunter nicht ganz
      vec2 lauf = (vec2(wert(px / 3.0 + saat), wert(px / 3.0 + saat + 5.0)) - 0.5) * druckVerlaufen * 4.0 * e;
      vec2 d2 = druckVerlaufen * 1.5 * e;
      vec3 b = (texture(bild, uv + lauf).rgb * 2.0 + texture(bild, uv + lauf + vec2(d2.x, 0.0)).rgb + texture(bild, uv + lauf - vec2(d2.x, 0.0)).rgb
        + texture(bild, uv + lauf + vec2(0.0, d2.y)).rgb + texture(bild, uv + lauf - vec2(0.0, d2.y)).rgb) / 6.0;
      vec3 druck = druckArt > 0.5 ? gerastert(b, px, saat + 9.0) : mix(vec3(hell(b)), b, 0.85) * 0.95 + 0.02;
      aus *= mix(vec3(1.0), druck, druckDeckung);
    }
  }
  farbe = vec4(clamp(spuren(aus, px, false), 0.0, 1.0), 1.0);
}`,
  regler: [
    {
      gruppe: "Zeitung",
      regler: [
        { name: "seite", text: "zeigt", auswahl: ["nur das Bild, gerastert", "eine Zeitungsseite mit dem Bild als Foto", "eine Zeitungsseite, das Bild darübergedruckt (wie im Drucker)"], wert: 1 },
        { name: "raster", text: "Raster (Pixel)", min: 2, max: 16, schritt: 0.5, wert: 4 },
        { name: "farbig", text: "Druck", auswahl: ["schwarz", "vierfarbig"], wert: 0 },
        { name: "passer", text: "Passer daneben", min: 0, max: 4, schritt: 0.1, wert: 1 },
        { name: "zunahme", text: "Farbe zerläuft", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "verschmiert", text: "verschmiert", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
      ],
    },
    {
      gruppe: "Text",
      regler: [
        { name: "eigeneUeberschrift", text: "Überschrift (leer: Zufall)", eingabe: true, zeilen: 2, wert: "" },
        { name: "eigenerText", text: "Text (leer: Zufall; zu kurz: fängt von vorn an; neue Zeile = neuer Absatz)", eingabe: true, zeilen: 5, wert: "" },
        { name: "eigeneUnterschrift", text: "Bildunterschrift (leer: Zufall)", eingabe: true, zeilen: 2, wert: "" },
      ],
    },
    {
      gruppe: "Seite",
      regler: [
        { name: "spalten", text: "Spalten", min: 1, max: 8, schritt: 1, wert: 4 },
        { name: "schriftGroesse", text: "Schrift (Zeile in % der Breite)", min: 0.4, max: 5, schritt: 0.05, wert: 1.4 },
        { name: "kopfGroesse", text: "Überschrift (Zeile in %, 0 = keine)", min: 0, max: 12, schritt: 0.1, wert: 4 },
        { name: "rand", text: "Rand (%)", min: 0, max: 15, schritt: 0.1, wert: 4 },
        { name: "spaltenAbstand", text: "Abstand der Spalten (%)", min: 0.5, max: 8, schritt: 0.1, wert: 2.5 },
      ],
    },
    {
      gruppe: "Foto in der Seite",
      regler: [
        { name: "fotoSpalten", text: "breit (Spalten)", min: 1, max: 8, schritt: 1, wert: 2 },
        { name: "fotoSpalte", text: "ab Spalte", min: 1, max: 8, schritt: 1, wert: 1 },
        { name: "fotoOben", text: "Höhe auf der Seite (% von oben)", min: 0, max: 90, schritt: 1, wert: 0 },
        { name: "fotoHoehe", text: "hoch (% der Seite, 0 = wie das Bild)", min: 0, max: 95, schritt: 1, wert: 0 },
        { name: "unterschrift", text: "Bildunterschrift", auswahl: ["ohne", "mit"], wert: 1 },
      ],
    },
    {
      gruppe: "Bild darübergedruckt",
      regler: [
        { name: "druckDeckung", text: "Deckung", min: 0, max: 1, schritt: 0.01, wert: 0.9 },
        { name: "druckVerlaufen", text: "Tinte verläuft", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "druckArt", text: "Drucker", auswahl: ["Tintenstrahl (glatt)", "gerastert"], wert: 0 },
      ],
    },
    {
      gruppe: "Papier",
      regler: [
        { name: "papierArt", text: "Papier", auswahl: ["Zeitungsgrau", "weiß", "vergilbt", "lachsrosa (Finanzblatt)"], wert: 0 },
        { name: "struktur", text: "Struktur", min: 0, max: 2, schritt: 0.01, wert: 1 },
        { name: "puenktchen", text: "Pünktchen (Altpapier)", min: 0, max: 1, schritt: 0.01, wert: 1 },
        { name: "relief", text: "Relief", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "rueckseite", text: "Rückseite scheint durch", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "alter", text: "vergilbt", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
      ],
    },
    SPUREN_REGLER,
    wechselRegler("Blatt", "neues Blatt"),
  ],
};

// eine leere 1 × 1-Leinwand für „nur das Bild“ (der Shader braucht trotzdem etwas am Sampler)
let leer = null;
function leereTextur() {
  if (!leer) {
    leer = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    leer.width = leer.height = 1;
  }
  return leer;
}

export const PAPIERE = [PAPIER, ZEITUNG];


