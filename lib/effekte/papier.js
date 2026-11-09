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
import { SCHRIFT_GLSL, kodiere, LEER } from "./schrift.js";

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
// Zahlen gepackt: 7 Bit je Zeichen, 4 Zeichen je Zahl, 16 je ivec4, höchstens 1024 Zeichen. Ist er kürzer als die
// Seite, fängt er von vorn an. Alle Größen hängen an der Bildbreite (Prozent), nicht an Pixeln: so sieht die Seite
// im Video in 4K genauso aus wie in der Vorschau, und JavaScript weiß, wie viele Zeichen in eine Zeile passen.
const TEXT_PLAETZE = 64; // ivec4; halbiert den reservierten Uniform-Textspeicher
const TEXT_MAX = TEXT_PLAETZE * 16; // maximal 1024 Zeichen

// Zeilen aus Nummern: jede Zeile genau „breite“ Zeichen; blocksatz: Leerzeichen zwischen den Wörtern verteilen
// (nicht in der letzten Zeile eines Absatzes); einzug: erste Zeile eines Absatzes 2 Zeichen eingerückt
function setze(nummern, breite, { blocksatz = false, einzug = false, hoechstens = Infinity } = {}) {
  const zeilenLimit = Math.min(
    Number.isFinite(hoechstens) ? Math.max(0, Math.floor(hoechstens)) : Infinity,
    Math.floor(TEXT_MAX / Math.max(1, breite)),
  );
  if (zeilenLimit === 0) return [];
  // Eine Zeile braucht höchstens „breite“ Zeichen; der Faktor 2 lässt Wortumbrüche und Leerzeichen zu.
  // Vor allem wird damit niemals ein beliebig langer Text in Zwischenlisten zerlegt.
  const zeichenLimit = Number.isFinite(zeilenLimit) ? Math.min(TEXT_MAX, zeilenLimit * Math.max(1, breite) * 2) : TEXT_MAX;
  nummern = nummern.slice(0, zeichenLimit);
  const absaetze = [];
  let wort = [];
  let woerter = [];
  const wortEnde = () => {
    if (wort.length) woerter.push(wort);
    wort = [];
  };
  for (const z of nummern) {
    if (z === "\n") {
      wortEnde();
      if (woerter.length) absaetze.push(woerter);
      woerter = [];
    } else if (z === LEER) wortEnde();
    else wort.push(z);
  }
  wortEnde();
  if (woerter.length) absaetze.push(woerter);
  const zeilen = [];
  for (const absatz of absaetze) {
    // zu lange Wörter teilen (mit Trennstrich)
    const ws = [];
    for (const w of absatz) {
      let rest = w;
      while (rest.length > breite) {
        ws.push([...rest.slice(0, breite - 1), 71]);
        rest = rest.slice(breite - 1);
      }
      ws.push(rest);
    }
    let i = 0;
    let erste = true;
    while (i < ws.length && zeilen.length < zeilenLimit) {
      const platz = breite - (einzug && erste ? 2 : 0);
      const teil = [ws[i++]];
      let laenge = teil[0].length;
      while (i < ws.length && laenge + 1 + ws[i].length <= platz) {
        laenge += 1 + ws[i].length;
        teil.push(ws[i++]);
      }
      const letzte = i >= ws.length;
      const luecken = teil.length - 1;
      const extra = blocksatz && !letzte && luecken > 0 ? platz - laenge : 0;
      const zeile = einzug && erste ? [LEER, LEER] : [];
      teil.forEach((w, k) => {
        if (k > 0) for (let j = 0; j < 1 + Math.floor(extra / luecken) + (k <= extra % luecken ? 1 : 0); j++) zeile.push(LEER);
        zeile.push(...w);
      });
      while (zeile.length < breite) zeile.push(LEER);
      zeilen.push(zeile);
      erste = false;
    }
  }
  return zeilen;
}

// die Werte, die JavaScript für den eigenen Text rechnet (gemerkt, solange sich Text und Maße nicht ändern)
function zeitungText(w, g) {
  const n = Math.round(w.spalten);
  const spaltePct = (100 - 2 * w.rand - (n - 1) * w.spaltenAbstand) / n;
  const breite = Math.max(4, Math.floor(spaltePct / (w.schriftGroesse * 0.5))); // ein Zeichen: halbe Zeilenhöhe breit
  const kopfBreite = w.kopfGroesse > 0 ? Math.max(4, Math.floor((100 - 2 * w.rand) / (w.kopfGroesse * 0.65))) : 1;
  const fs = Math.min(n, Math.max(1, Math.round(w.fotoSpalten)));
  const unterBreite = Math.max(4, Math.floor((fs * spaltePct + (fs - 1) * w.spaltenAbstand) / (w.schriftGroesse * 0.85 * 0.5)));
  // Auch gespeicherte Presets können alte, sehr lange Texte enthalten: vor dem Cache-Schlüssel und
  // vor kodiere() begrenzen, damit nicht erst eine riesige Nummernliste entsteht.
  const ueberschrift = String(w.eigeneUeberschrift ?? "").trim().slice(0, 180);
  const unterschrift = String(w.eigeneUnterschrift ?? "").trim().slice(0, 240);
  const eigenerText = String(w.eigenerText ?? "").trim().slice(0, TEXT_MAX);
  const schluessel = [eigenerText, ueberschrift, unterschrift, breite, kopfBreite, unterBreite].join("\u0001");
  if (g.text?.schluessel === schluessel) return g.text.werte;
  const kopf = ueberschrift ? setze(kodiere(ueberschrift).slice(0, TEXT_MAX), kopfBreite, { hoechstens: 3 }) : [];
  const unter = unterschrift ? setze(kodiere(unterschrift).slice(0, TEXT_MAX), unterBreite, { hoechstens: 2 }) : [];
  const platz = Math.max(0, TEXT_MAX - kopf.length * kopfBreite - unter.length * unterBreite);
  const text = eigenerText ? setze(kodiere(eigenerText).slice(0, platz), breite, { blocksatz: true, einzug: true, hoechstens: Math.floor(platz / breite) }) : [];
  const feld = new Int32Array(TEXT_PLAETZE * 4);
  let i = 0;
  for (const zeile of [...kopf, ...unter, ...text]) {
    for (const z of zeile) {
      if (i >= TEXT_MAX) break;
      feld[i >> 2] |= z << ((i & 3) * 7);
      i++;
    }
    if (i >= TEXT_MAX) break;
  }
  const werte = { textFeld: feld, textBreite: breite, kopfBreite, unterBreite, kopfZeilen: kopf.length, unterZeilen: unter.length, textZeilen: text.length };
  g.text = { schluessel, werte };
  return werte;
}

const ZEITUNG = {
  id: "zeitung",
  name: "Zeitungspapier",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  einstellungen(w, zeit, g = {}) {
    const { eigenerText, eigeneUeberschrift, eigeneUnterschrift, ...zahlen } = w; // Text ist kein Uniform
    return { ...zahlen, zeit, ...zeitungText(w, g) };
  },
  shader: /* glsl */ `
uniform float raster, farbig, passer, zunahme, rueckseite, alter, seite, spalten, schriftGroesse, verschmiert;
uniform float rand, spaltenAbstand, kopfGroesse, fotoSpalten, fotoSpalte, fotoOben, fotoHoehe, unterschrift;
uniform float papierArt, struktur, relief, puenktchen, druckDeckung, druckVerlaufen, druckArt;
uniform float textBreite, kopfBreite, unterBreite, kopfZeilen, unterZeilen, textZeilen;
uniform ivec4 textFeld[${TEXT_PLAETZE}];
${MATERIAL_GLSL}
${SCHRIFT_GLSL}
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

// ---- Text ----
// ein Zeichen z, gesehen an (x, y) Pixel innerhalb seiner Zelle, Schriftpunkt „pix“ groß; fett: auch halb daneben
float zeichen(int z, float x, float y, float pix, bool fett) {
  int c = int(floor(x / pix));
  int r = int(floor(y / pix));
  bool an = zeichenPunkt(z, c, r) || (fett && zeichenPunkt(z, int(floor((x - pix * 0.5) / pix)), r));
  return an ? 1.0 : 0.0;
}
// Zeichen Nummer i des eigenen Texts (gepackt wie in zeitungText)
int textZeichen(int i) {
  ivec4 v = textFeld[i >> 4];
  int k = (i >> 2) & 3;
  int w = k == 0 ? v.x : k == 1 ? v.y : k == 2 ? v.z : v.w;
  return (w >> ((i & 3) * 7)) & 127;
}
// Zeilen des eigenen Texts: q in Pixeln (oben links im Block), Zeilenhöhe L, Zeichen je Zeile P (die Zelle ist
// genau b / P breit: Blocksatz bis an den Rand), Zeile zeile0 des Blocks, nZeilen Zeilen ab Zeichen „anfang“;
// wiederholen: nach der letzten Zeile von vorn. pixL: Schriftpunkt als Anteil der Zeile (Text 1/12, Kopf 1/10)
float eigeneZeilen(vec2 q, float L, float b, float P, float zeile0, float nZeilen, int anfang, bool wiederholen, bool fett, bool schraeg, float pixL) {
  if (q.x < 0.0 || q.y < 0.0 || nZeilen < 0.5) return 0.0;
  float pix = L * pixL;
  float zelle = b / P;
  float zeile = floor(q.y / L);
  float y = q.y - zeile * L - L * 0.1;
  if (schraeg) q.x += (L - y) * 0.2;
  float sp = floor(q.x / zelle);
  if (sp >= P) return 0.0;
  float x = q.x - sp * zelle - max(0.0, zelle - 6.0 * pix) * 0.5; // Buchstabe mitten in die Zelle
  float gz = zeile0 + zeile;
  if (wiederholen) gz = mod(gz, nZeilen);
  else if (gz >= nZeilen) return 0.0;
  int z = textZeichen(anfang + int(gz * P + sp));
  if (z == ${LEER}) return 0.0;
  return zeichen(z, x, y, pix, fett);
}
// Fließtext aus Zufall: q in Pixeln (Ursprung oben links im Block, y nach unten), Zeilenabstand L, Blockbreite b,
// Startwert s. Wörter sind Zufall: etwa jedes sechste Zeichen ein Leerzeichen (nie zwei), Wortanfänge zu 22 % groß
// (Substantive), ab und zu ein Punkt oder Komma, Absätze mit kurzer letzter Zeile und eingerückter erster.
float fliesstext(vec2 q, float L, float b, float s, bool schraeg) {
  if (q.x < 0.0 || q.y < 0.0) return 0.0;
  float pix = L / 12.0;
  float zelle = 6.0 * pix;
  float zeile = floor(q.y / L);
  float y = q.y - zeile * L - L * 0.1;
  if (schraeg) q.x += (L - y) * 0.2;                    // kursiv
  float sp = floor(q.x / zelle);
  float x = q.x - sp * zelle;
  float proZeile = floor(b / zelle);
  if (sp >= proZeile) return 0.0;
  bool letzte = zufall(vec2(zeile, s + 1.0)) < 0.12;
  bool erste = zufall(vec2(zeile - 1.0, s + 1.0)) < 0.12;
  if (letzte && sp > floor(proZeile * (0.2 + 0.6 * zufall(vec2(zeile, s + 2.0))))) return 0.0;
  if (erste && sp < 2.0) return 0.0;
  bool leerHier = zufall(vec2(sp, zeile) + s) < 0.17;
  bool leerDavor = sp < 0.5 || zufall(vec2(sp - 1.0, zeile) + s) < 0.17;
  bool leerDanach = zufall(vec2(sp + 1.0, zeile) + s) < 0.17;
  if (leerHier && !leerDavor) return 0.0;
  float u = zufall(vec2(sp, zeile) + s * 1.7 + 3.1);
  int z = buchstabe(u);
  if (leerDanach && sp + 1.0 < proZeile && zufall(vec2(sp, zeile) + s + 5.5) < 0.12) z = zufall(vec2(sp, zeile) + s + 6.6) < 0.6 ? 26 : 27;
  else if (leerDavor && zufall(vec2(sp, zeile) + s + 7.7) < 0.22) z = 28 + z;
  return zeichen(z, x, y, pix, false);
}
// Überschrift aus Zufall: Großbuchstaben, fett, zwei Zeilen, jede Zeile anders lang
float ueberschrift(vec2 q, float L, float b, float s) {
  if (q.x < 0.0 || q.y < 0.0 || q.y > 2.0 * L) return 0.0;
  float pix = L / 10.0;
  float zelle = 6.5 * pix;
  float zeile = floor(q.y / L);
  float y = q.y - zeile * L;
  float sp = floor(q.x / zelle);
  float x = q.x - sp * zelle;
  if (sp >= floor(b / zelle) * (0.55 + 0.4 * zufall(vec2(zeile, s + 4.0)))) return 0.0;
  if (zufall(vec2(sp, zeile) + s + 9.0) < 0.15 && sp > 0.0) return 0.0;
  return zeichen(28 + buchstabe(zufall(vec2(sp, zeile) + s + 3.3)), x, y, pix, true);
}

// Maße der Seite in Pixeln (alles aus Prozent der Breite)
struct Seite { float W, H, R, A, L, Lk, kopf, oben, unten, sb; int n; bool foto; float fx, fb, fy, fh, fs, f0, unterOben, block; };
Seite masse() {
  Seite m;
  m.W = aufloesung.x;
  m.H = aufloesung.y;
  m.R = rand * 0.01 * m.W;
  m.A = spaltenAbstand * 0.01 * m.W;
  m.L = schriftGroesse * 0.01 * m.W;
  m.Lk = kopfGroesse * 0.01 * m.W;
  float kz = kopfZeilen > 0.5 ? kopfZeilen : 2.0;
  m.kopf = kopfGroesse > 0.0 ? m.R + m.Lk * (0.3 + kz) + m.Lk * 0.1 : m.R;
  m.oben = kopfGroesse > 0.0 ? m.kopf + m.L * 0.8 : m.R;
  m.unten = m.H - m.R;
  m.n = int(spalten + 0.5);
  m.sb = (m.W - 2.0 * m.R - float(m.n - 1) * m.A) / float(m.n);
  m.foto = seite > 0.5 && seite < 1.5;
  m.fs = clamp(floor(fotoSpalten + 0.5), 1.0, float(m.n));
  m.f0 = clamp(floor(fotoSpalte + 0.5) - 1.0, 0.0, float(m.n) - m.fs);
  m.fx = m.R + m.f0 * (m.sb + m.A);
  m.fb = m.fs * m.sb + (m.fs - 1.0) * m.A;
  m.fy = m.oben + fotoOben * 0.01 * (m.unten - m.oben);
  m.fh = min(fotoHoehe > 0.0 ? fotoHoehe * 0.01 * m.H : m.fb * m.H / m.W, m.unten - m.fy);
  m.unterOben = m.fy + m.fh + m.L * 0.4;
  float uz = unterschrift > 0.5 ? (unterZeilen > 0.5 ? unterZeilen : 1.0) : 0.0;
  m.block = m.unterOben + uz * m.L * 0.85 + m.L * (uz > 0.0 ? 0.8 : 0.2); // hier geht der Text unter dem Foto weiter
  return m;
}
// Zeilen in Spalte j: unter dem Foto zwei Stücke (darüber, darunter)
float ueber(Seite m) { return max(0.0, floor((m.fy - m.L * 0.5 - m.oben) / m.L)); }
float zeilenIn(Seite m, int j) {
  float jf = float(j);
  if (m.foto && jf >= m.f0 && jf < m.f0 + m.fs) return ueber(m) + max(0.0, floor((m.unten - m.block) / m.L));
  return max(0.0, floor((m.unten - m.oben) / m.L));
}
// Text an Stelle q im Block, Zeile zeile0 des ganzen Fließtexts (Spalte um Spalte)
float text(Seite m, vec2 q, float zeile0, float s) {
  if (textZeilen > 0.5) {
    int anfang = int(kopfZeilen * kopfBreite + unterZeilen * unterBreite);
    return eigeneZeilen(q, m.L, m.sb, textBreite, zeile0, textZeilen, anfang, true, false, false, 1.0 / 12.0);
  }
  return fliesstext(q, m.L, m.sb, s, false);
}

// die ganze Seite (ohne das Foto): Text, Linien. p: Pixel mit y nach unten
float seitenTinte(vec2 p, float s, out float imFoto, out vec2 fotoUv) {
  Seite m = masse();
  imFoto = 0.0;
  fotoUv = vec2(0.0);
  if (p.x < m.R * 0.6 || p.x > m.W - m.R * 0.6 || p.y < m.R * 0.5 || p.y > m.H - m.R * 0.5) return 0.0;
  float t = 0.0;
  if (kopfGroesse > 0.0) {
    vec2 q = p - vec2(m.R, m.R + m.Lk * 0.3);
    if (kopfZeilen > 0.5) t = eigeneZeilen(q, m.Lk, m.W - 2.0 * m.R, kopfBreite, 0.0, kopfZeilen, 0, false, true, false, 0.1);
    else t = ueberschrift(q, m.Lk, m.W - 2.0 * m.R, s);
    // Linien: doppelt oben, einfach unter der Überschrift
    t = max(t, (step(abs(p.y - m.R * 0.7), 0.7) + step(abs(p.y - m.R * 0.7 - 3.0), 0.4)) * step(m.R * 0.6, p.x) * step(p.x, m.W - m.R * 0.6));
    t = max(t, step(abs(p.y - m.kopf), 0.7) * step(m.R, p.x) * step(p.x, m.W - m.R));
  }
  float k = floor((p.x - m.R) / (m.sb + m.A));
  if (k < 0.0 || k >= float(m.n) || p.y > m.unten) return t;
  float xin = p.x - m.R - k * (m.sb + m.A);
  bool unterFoto = m.foto && k >= m.f0 && k < m.f0 + m.fs;
  // das Foto, mit Rahmen
  vec2 f = vec2(p.x - m.fx, p.y - m.fy);
  if (m.foto && f.x >= 0.0 && f.x <= m.fb && f.y >= 0.0 && f.y < m.fh) {
    imFoto = 1.0;
    fotoUv = vec2(f.x / m.fb, 1.0 - f.y / m.fh);
    float rahmen = step(f.x, 0.8) + step(m.fb - 0.8, f.x) + step(f.y, 0.8) + step(m.fh - 0.8, f.y);
    return max(t, min(rahmen, 1.0));
  }
  if (xin > m.sb) {
    // Spaltenlinie in der Mitte des Abstands (nicht durch das Foto und seine Bildunterschrift)
    bool zwischenFoto = m.foto && k >= m.f0 && k < m.f0 + m.fs - 1.0 && p.y > m.fy - m.L * 0.5 && p.y < m.block;
    return max(t, step(abs(xin - m.sb - m.A * 0.5), 0.4) * step(m.oben, p.y) * (zwischenFoto ? 0.0 : 1.0));
  }
  if (p.y < m.oben) return t;
  // wie viele Zeilen in den Spalten davor stehen: dort geht der Text weiter
  float davor = 0.0;
  for (int j = 0; j < 8; j++) if (j < int(k)) davor += zeilenIn(m, j);
  float sk = s + k * 31.7;
  if (unterFoto) {
    float zu = ueber(m);
    if (p.y < m.oben + zu * m.L) return max(t, text(m, vec2(xin, p.y - m.oben), davor, sk));
    if (p.y < m.fy) return t;
    // Bildunterschrift (unter der ersten Spalte des Fotos beginnend, über die ganze Breite des Fotos)
    if (p.y < m.block) {
      if (unterschrift < 0.5) return t;
      vec2 q = vec2(p.x - m.fx, p.y - m.unterOben);
      if (unterZeilen > 0.5) return max(t, eigeneZeilen(q, m.L * 0.85, m.fb, unterBreite, 0.0, unterZeilen, int(kopfZeilen * kopfBreite), false, false, true, 1.0 / 12.0));
      return max(t, k == m.f0 ? fliesstext(q, m.L * 0.85, m.fb, s + 50.0, true) * step(q.y, m.L * 0.85) : 0.0);
    }
    return max(t, text(m, vec2(xin, p.y - m.block), davor + zu, sk + 17.0));
  }
  return max(t, text(m, vec2(xin, p.y - m.oben), davor, sk));
}

void main() {
  vec2 px = uv * aufloesung;
  float saat = saatOberflaeche();
  float sF = saatFlecken();
  // Papier: grau-beige (Zeitung), weiß, vergilbt, lachsrosa (Finanzblatt); wolkig, Pünktchen aus Altpapier
  vec3 grund = papierArt < 0.5 ? vec3(0.86, 0.84, 0.78) : papierArt < 1.5 ? vec3(0.95, 0.945, 0.93) : papierArt < 2.5 ? vec3(0.88, 0.8, 0.62) : vec3(0.99, 0.9, 0.83);
  vec3 papier = grund * (1.0 + ((fbm(px / 40.0 + saat) - 0.5) * 0.12 + (wert(px / 1.5 + saat) - 0.5) * 0.06) * struktur);
  papier *= 1.0 - step(0.9985, zufall(floor(px) + saat)) * 0.5 * puenktchen;
  // Relief: die Fasern als kleines Gebirge, Licht von links oben (wie beim Papier)
  if (relief > 0.0) {
    float h0 = fbm(px / 2.5 + saat);
    float lichtR = (-(fbm((px + vec2(1.0, 0.0)) / 2.5 + saat) - h0) + (fbm((px + vec2(0.0, 1.0)) / 2.5 + saat) - h0)) * relief * 4.0;
    papier *= 1.0 + lichtR;
  }
  vec2 rand2 = abs(uv - 0.5) * 2.0;
  papier = mix(papier, papier * vec3(0.92, 0.8, 0.55), alter * (0.4 + 0.6 * smoothstep(0.6, 1.0, max(rand2.x, rand2.y))));
  // Rückseite scheint durch: Zeilen aus „Wörtern“, gespiegelt, in Spalten
  vec2 q = vec2(aufloesung.x - px.x, px.y);
  float spalte = mod(q.x, aufloesung.x / 3.0);
  float zeile = mod(q.y, 11.0);
  float wort = step(0.35, wert(vec2(floor(q.x / 5.0) * 0.6, floor(q.y / 11.0)) + saat * 0.3));
  float rtext = step(3.0, zeile) * step(zeile, 8.0) * wort * step(10.0, spalte) * step(spalte, aufloesung.x / 3.0 - 10.0);
  papier *= 1.0 - rtext * rueckseite * 0.12;

  vec3 aus;
  if (seite < 0.5) {
    aus = papier * gerastert(texture(bild, uv).rgb, px, saat);
  } else {
    vec2 p = vec2(px.x, aufloesung.y - px.y);
    float s = blatt * 7.7; // der Text gehört zur Ausgabe: er wechselt mit „Blatt“, nicht mit jedem neuen Bild
    float imFoto;
    vec2 fotoUv;
    float t = seitenTinte(p, s, imFoto, fotoUv);
    // Farbe verläuft: die Buchstaben werden weich und etwas fetter (Mittel mit den Nachbarn)
    if (zunahme > 0.0) {
      float f1, f2, f3, f4;
      vec2 u1;
      float d = 0.6 + zunahme * 0.6;
      // Zwei Nachbarn in Zeilenrichtung reichen für den weichen Druck; vier volle Seiten-Abfragen
      // pro Pixel waren gerade bei großen Exporten unverhältnismäßig teuer.
      float um = seitenTinte(p + vec2(d, 0.0), s, f1, u1) + seitenTinte(p - vec2(d, 0.0), s, f2, u1);
      t = max(t, um * 0.5 * zunahme * 1.2);
    }
    // verschmiert: in manchen Flecken zieht die Farbe Schlieren in eine Richtung
    if (verschmiert > 0.0) {
      float wo = smoothstep(0.5, 0.72, fbm(px / (aufloesung.y * 0.12) + sF * 1.9)) * verschmiert;
      if (wo > 0.01) {
        float w = fbm(px / (aufloesung.y * 0.4) + sF) * 6.2832;
        vec2 r = vec2(cos(w), sin(w)) * aufloesung.y * 0.004;
        float zug = 0.0;
        for (int i = 1; i <= 3; i++) {
          float g1;
          vec2 g2;
          zug = max(zug, seitenTinte(p - r * float(i), s, g1, g2) * exp(-float(i) * 0.35));
        }
        t = max(t, zug * wo * 0.75);
        t *= 1.0 - wo * 0.25; // was weggewischt wurde, fehlt an seinem Platz
      }
    }
    vec3 foto = imFoto > 0.5 ? gerastert(texture(bild, fotoUv).rgb, px, saat) : vec3(1.0);
    aus = papier * foto * (1.0 - 0.88 * clamp(t, 0.0, 1.0));
    if (seite > 1.5) {
      // darübergedruckt: die Tinte des Druckers zieht ins Papier (die Stelle wandert ein wenig mit den Fasern,
      // dazu ein weiches Mittel), wird stumpfer als auf Fotopapier und deckt den Text darunter nicht ganz
      vec2 lauf = (vec2(wert(px / 3.0 + saat), wert(px / 3.0 + saat + 5.0)) - 0.5) * druckVerlaufen * 4.0 / aufloesung;
      vec2 e = druckVerlaufen * 1.5 / aufloesung;
      vec3 b = (texture(bild, uv + lauf).rgb * 2.0 + texture(bild, uv + lauf + vec2(e.x, 0.0)).rgb + texture(bild, uv + lauf - vec2(e.x, 0.0)).rgb
        + texture(bild, uv + lauf + vec2(0.0, e.y)).rgb + texture(bild, uv + lauf - vec2(0.0, e.y)).rgb) / 6.0;
      // gerastert: Weiß bleibt ohne Punkte; glatt: Tintenstrahl, etwas stumpfer und nie ganz weiß
      vec3 tinte = druckArt > 0.5 ? gerastert(b, px, saat + 9.0) : mix(vec3(hell(b)), b, 0.85) * 0.95 + 0.02;
      aus *= mix(vec3(1.0), tinte, druckDeckung);
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
        { name: "eigeneUeberschrift", text: "Überschrift (leer: Zufall)", eingabe: true, zeilen: 2, maxLaenge: 180, wert: "" },
        { name: "eigenerText", text: "Text (max. 1024 Zeichen; leer: Zufall)", eingabe: true, zeilen: 5, maxLaenge: TEXT_MAX, wert: "" },
        { name: "eigeneUnterschrift", text: "Bildunterschrift (leer: Zufall)", eingabe: true, zeilen: 2, maxLaenge: 240, wert: "" },
      ],
    },
    {
      gruppe: "Seite",
      regler: [
        { name: "spalten", text: "Spalten", min: 1, max: 8, schritt: 1, wert: 4 },
        { name: "schriftGroesse", text: "Schrift (Zeile in % der Breite)", min: 0.4, max: 5, schritt: 0.05, wert: 1.1 },
        { name: "kopfGroesse", text: "Überschrift (Zeile in %, 0 = keine)", min: 0, max: 12, schritt: 0.1, wert: 3 },
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

export const PAPIERE = [PAPIER, ZEITUNG];
