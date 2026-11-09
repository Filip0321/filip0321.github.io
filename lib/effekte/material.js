// Gemeinsames für die Materialien (Papier, Zeitung, Leinwand, Holz- und Linolschnitt): Rauschen, die Spuren von
// Alter und Gebrauch, und wie oft ein neues Blatt (ein neuer Abzug, eine neue Leinwand) kommt.
//
// Spuren, alle mit eigenem Startwert, damit man getrennt einstellen kann, was beim neuen Blatt wechselt:
//   Kratzer     dünne, leicht gewellte Linien, die zwischendurch abreißen
//   Knicke      gerade Falten: eine Seite heller, die andere dunkler, die Kante selbst hell (aufgeriebene Fasern)
//   zerknittert viele kleine Facetten, jede etwas anders zum Licht geneigt (Voronoi-Zellen); zwischen ihnen Falten
//   Stockflecken braune Punkte aus Schimmel und Eisen, mit dunklerem Rand
//   Kaffee      Ringe mit dunklem Rand: beim Trocknen strömt die Flüssigkeit zum Rand nach und nimmt die
//               Teilchen mit, sie bleiben dort liegen (Kaffeering-Effekt, Deegan und andere 1997)
//   Schmutz     kleine dunkle Punkte und graue Wische
//   Fussel      dunkle, gebogene Haare
// Startwerte: „Blatt“ wählt eins aus; „pro Sekunde“ zählt die Blätter hoch; „wechselt“ sagt, was dabei neu wird:
//   nur die Oberfläche (Fasern, Farbauftrag), auch die Flecken, oder alles (auch Kratzer, Knicke, Knitter, Fussel).

export const MATERIAL_GLSL = /* glsl */ `
uniform float kratzer, knicke, knitter, flecken, kaffee, schmutz, fussel;
uniform float blatt, proSek, wechsel;

// weiches Rauschen (Value Noise) und mehrere Lagen davon (fbm): jede Lage halb so groß, halb so stark
float wert(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(zufall(i), zufall(i + vec2(1.0, 0.0)), f.x), mix(zufall(i + vec2(0.0, 1.0)), zufall(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * wert(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// Nummer des Blatts (zählt proSek-mal pro Sekunde hoch) und die drei Startwerte
float nummer() { return proSek > 0.0 ? floor(zeit * proSek + 0.001) : 0.0; }
float saatOberflaeche() { return blatt * 13.37 + nummer() * 7.31; }
float saatFlecken() { return blatt * 5.13 + (wechsel > 0.5 ? nummer() * 3.71 : 0.0); }
float saatSpuren() { return blatt * 3.11 + (wechsel > 1.5 ? nummer() * 2.37 : 0.0); }

// Strich von a in Richtung r, Länge lang, gewellt: Abstand von px (Pixel), t = Stelle entlang
float strich(vec2 px, vec2 a, vec2 r, float lang, float welle, float s, out float t) {
  vec2 q = px - a;
  t = clamp(dot(q, r), 0.0, lang);
  return length(q - r * t + vec2(-r.y, r.x) * sin(t * 0.02 + s) * welle);
}

// alle Spuren über das fertige Bild legen; dunkel: dunkles Material (Kratzer und Falten sind dort hell)
vec3 spuren(vec3 aus, vec2 px, bool dunkel) {
  float sF = saatFlecken(), sS = saatSpuren();
  float H = aufloesung.y;

  // zerknittert: zwei Größen von Facetten
  if (knitter > 0.0) {
    float licht = 0.0;
    for (int lage = 0; lage < 2; lage++) {
      float g = H * (lage == 0 ? 0.16 : 0.06);
      vec2 q = px / g, z = floor(q), beste = z;
      float d1 = 9.0, d2 = 9.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 c = z + vec2(float(x), float(y));
        vec2 m = c + vec2(zufall(c + sS), zufall(c + sS + 4.1));
        float d = length(q - m);
        if (d < d1) { d2 = d1; d1 = d; beste = c; } else if (d < d2) d2 = d;
      }
      vec2 n = vec2(zufall(beste + sS * 1.7), zufall(beste + sS * 2.3)) - 0.5; // Neigung der Facette
      float falte = 1.0 - smoothstep(0.0, 0.05, d2 - d1);
      licht += (dot(n, vec2(-0.7, 0.7)) + falte * 0.25) * (lage == 0 ? 1.0 : 0.6);
    }
    aus *= 1.0 + licht * knitter * 0.3;
  }

  // Stockflecken
  if (flecken > 0.0) {
    float f = fbm(px / (H * 0.012) + sF * 2.1 + 40.0);
    float innen = smoothstep(0.66, 0.70, f);
    float rand = smoothstep(0.64, 0.67, f) - smoothstep(0.67, 0.71, f);
    aus = mix(aus, aus * vec3(0.75, 0.6, 0.42), (innen * 0.6 + rand * 0.5) * flecken);
  }

  // Kaffeeringe (bis 4)
  int nr = int(kaffee * 4.0 + 0.5);
  for (int i = 0; i < 4; i++) {
    if (i >= nr) break;
    float s = float(i) * 2.9 + sF;
    vec2 m = vec2(zufall(vec2(s, 1.1)), zufall(vec2(s, 2.2))) * aufloesung;
    float r = (0.06 + 0.12 * zufall(vec2(s, 3.3))) * H;
    vec2 q = px - m;
    float w = atan(q.y, q.x);
    float rr = r * (1.0 + 0.1 * (wert(vec2(w * 2.5, s)) - 0.5) + 0.04 * sin(w * 2.0 + s));
    float d = length(q) - rr; // < 0: innen
    float innen = 1.0 - smoothstep(-1.0, 1.0, d);
    float rand = exp(-max(-d, 0.0) / (1.5 + 2.0 * zufall(vec2(s, 4.4)))) * innen;
    vec3 braun = dunkel ? vec3(1.35, 1.2, 1.0) : vec3(0.72, 0.52, 0.3);
    aus = mix(aus, aus * braun, innen * 0.25 + rand * 0.55);
  }

  // Schmutz: Punkte und Wische
  if (schmutz > 0.0) {
    float k = zufall(floor(px / 2.0) + sF * 9.1);
    float punkt = step(1.0 - schmutz * 0.006, k);
    float wisch = smoothstep(0.62, 0.8, fbm(px / (H * 0.05) + sF * 3.3)) * schmutz * 0.25;
    aus = mix(aus, dunkel ? aus + 0.15 : aus * 0.35, max(punkt, wisch));
  }

  // Knicke (bis 6)
  int nk = int(knicke * 6.0 + 0.5);
  for (int i = 0; i < 6; i++) {
    if (i >= nk) break;
    float s = float(i) * 1.3 + sS;
    vec2 m = vec2(0.2 + 0.6 * zufall(vec2(s, 1.3)), 0.2 + 0.6 * zufall(vec2(s, 2.9))) * aufloesung;
    float w = zufall(vec2(s, 5.7)) * 3.1416;
    float d = dot(px - m, vec2(-sin(w), cos(w)));
    float breite = H * 0.02;
    aus *= 1.0 + sign(d) * exp(-abs(d) / breite) * 0.08;
    aus += (dunkel ? 0.05 : 0.08) * exp(-abs(d) / 1.2);
  }

  // Fussel (bis 8): dunkel, stark gebogen
  int nf = int(fussel * 8.0 + 0.5);
  for (int i = 0; i < 8; i++) {
    if (i >= nf) break;
    float s = float(i) * 3.7 + sS;
    vec2 a = vec2(zufall(vec2(s, 0.7)), zufall(vec2(s, 8.1))) * aufloesung;
    float w = zufall(vec2(s, 2.6)) * 6.2832;
    float t;
    float d = strich(px, a, vec2(cos(w), sin(w)), (0.02 + 0.05 * zufall(vec2(s, 9.3))) * H, H * 0.012, s, t);
    aus = mix(aus, dunkel ? aus + 0.2 : aus * 0.25, (1.0 - smoothstep(0.4, 1.3, d)) * 0.8);
  }

  // Kratzer (bis 48)
  int nz = int(kratzer * 48.0);
  for (int i = 0; i < 48; i++) {
    if (i >= nz) break;
    float s = float(i) * 1.7 + sS * 1.9;
    vec2 a = vec2(zufall(vec2(s, 0.4)), zufall(vec2(s, 7.7))) * aufloesung;
    float w = zufall(vec2(s, 3.3)) * 6.2832;
    float t;
    float d = strich(px, a, vec2(cos(w), sin(w)), (0.05 + 0.3 * zufall(vec2(s, 9.9))) * H, 4.0, s, t);
    float k = (1.0 - smoothstep(0.3, 1.2, d)) * (0.4 + 0.6 * wert(vec2(t * 0.05, s))); // reißt ab und zu ab
    aus = mix(aus, dunkel ? aus + 0.25 : aus * 0.75 + 0.2, k * 0.7);
  }
  return aus;
}
`;

// Regler, die alle Materialien haben
export const SPUREN_REGLER = {
  gruppe: "Alter und Spuren",
  regler: [
    { name: "kratzer", text: "Kratzer", min: 0, max: 1, schritt: 0.01, wert: 0.15 },
    { name: "knicke", text: "Knicke", min: 0, max: 1, schritt: 0.01, wert: 0 },
    { name: "knitter", text: "zerknittert", min: 0, max: 1, schritt: 0.01, wert: 0 },
    { name: "flecken", text: "Stockflecken", min: 0, max: 1, schritt: 0.01, wert: 0.15 },
    { name: "kaffee", text: "Kaffeeringe", min: 0, max: 1, schritt: 0.01, wert: 0 },
    { name: "schmutz", text: "Schmutz", min: 0, max: 1, schritt: 0.01, wert: 0.1 },
    { name: "fussel", text: "Fussel", min: 0, max: 1, schritt: 0.01, wert: 0 },
  ],
};
// was: Wort für ein Stück Material („Blatt“, „Abzug“); neu: mit Artikel („neues Blatt“, „neuer Abzug“);
// texte: die drei Wahlen für „wechselt“
export function wechselRegler(was, neu, texte) {
  return {
    gruppe: neu,
    regler: [
      { name: "blatt", text: was, min: 0, max: 50, schritt: 1, wert: 0 },
      { name: "proSek", text: `${neu} pro Sekunde`, min: 0, max: 24, schritt: 1, wert: 0, ruhig: 0 },
      { name: "wechsel", text: "dabei wechselt", auswahl: texte ?? ["nur die Oberfläche", "auch die Flecken", "alles, auch Kratzer und Knicke"], wert: 2 },
    ],
  };
}
