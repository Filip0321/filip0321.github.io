// Papier und Material, Teil 3: Holz- und Linolschnitt.
//
// Hochdruck: aus einem Block wird weggeschnitten, was weiß bleiben soll; was stehen bleibt, bekommt Farbe (mit der
// Walze) und wird aufs Papier gedrückt. Es gibt nur „Farbe oder keine“: das Bild wird an einer Schwelle in zwei
// Teile geteilt. Was es lebendig macht, sind die Fehler:
//   Kanten:       mit dem Messer geschnitten, nie ganz glatt
//   Maserung:     beim Holz druckt die Struktur des Bretts mit: die weichen Jahresringe nehmen weniger Farbe an,
//                 im Druck erscheinen helle Streifen in der Farbe (Richtung der Maserung einstellbar)
//   Äste:         wo ein Ast im Stamm saß, laufen die Jahresringe um ihn herum (die Linien weichen aus und
//                 drängen sich an seinen Flanken), im Ast selbst liegen kleine Ringe um seine Mitte. Das Astholz ist
//                 hart und nimmt die Farbe voll an (druckt dunkel); beim Trocknen schrumpft es und reißt am Rand: ein
//                 heller Ring
//   Linol:        keine Maserung, dafür feine helle Pünktchen (Luftbläschen, Staub)
//   Farbauftrag:  die Walze verteilt nie ganz gleich, der Druck (von Hand mit dem Löffel) auch nicht: Flecken mit
//                 weniger Farbe, durch die das Papier schimmert, und Streifen der Walze
//   Hohleisen:    in den weggeschnittenen Flächen bleiben Grate stehen, vor allem nahe am Stehengebliebenen. Sie
//                 fangen etwas Farbe und drucken als kurze Striche mit, in der Richtung, in der geschnitten wurde
// Bei einem neuen Abzug vom selben Block wechselt nur der Farbauftrag; ein neuer Block hat andere Kanten, Maserung
// und Hohleisenspuren („dabei wechselt“).

import { MATERIAL_GLSL, SPUREN_REGLER, wechselRegler } from "./material.js";

const HOLZSCHNITT = {
  id: "holzschnitt",
  name: "Holz- und Linolschnitt",
  gruppe: "Papier und Material",
  zeitabhaengig: true,
  shader: /* glsl */ `
uniform float material, schwelle, umkehren, kante, maserung, richtung, aeste, eisen, farbauftrag, druckfarbe, papierTon;
${MATERIAL_GLSL}
// Farbe auf dem Block an der Stelle p (vor allen Fehlern des Drucks): 1 = steht, 0 = weggeschnitten
float block(vec2 p, float sB) {
  float l = hell(texture(bild, p / aufloesung).rgb);
  if (umkehren > 0.5) l = 1.0 - l;
  l += (wert(p / 3.0 + sB) - 0.5) * kante * 0.25 + (wert(p / 11.0 + sB * 1.3) - 0.5) * kante * 0.15;
  return 1.0 - smoothstep(schwelle - 0.015, schwelle + 0.015, l);
}
void main() {
  vec2 px = uv * aufloesung;
  float H = aufloesung.y;
  float sB = saatSpuren();        // der Block: Kanten, Maserung, Hohleisen
  float sA = saatOberflaeche();   // der Abzug: Farbauftrag, Papier
  float tinte = block(px, sB);

  // Hohleisenspuren: in den weggeschnittenen Flächen nahe am Stehengebliebenen
  if (eisen > 0.0 && tinte < 0.5) {
    float nah = 0.0;
    for (int i = 0; i < 8; i++) {
      float w = float(i) * 0.785;
      nah += block(px + vec2(cos(w), sin(w)) * H * 0.012, sB) + block(px + vec2(cos(w + 0.4), sin(w + 0.4)) * H * 0.028, sB) * 0.6;
    }
    nah = clamp(nah / 8.0 * 2.5, 0.0, 1.0);
    float a = fbm(px / (H * 0.12) + sB) * 6.2832;      // Schnittrichtung, wechselt langsam über die Fläche
    float streifen = sin(dot(px, vec2(-sin(a), cos(a))) * 0.9 + fbm(px / 15.0 + sB) * 4.0);
    float grat = smoothstep(0.8, 1.0, streifen) * step(0.45, wert(px / (H * 0.02) + sB * 2.0));
    tinte = max(tinte, grat * nah * eisen);
  }
  // Maserung (Holz) oder Pünktchen (Linol)
  if (material < 0.5) {
    float w = richtung * 0.0174533;
    vec2 m = mat2(cos(w), -sin(w), sin(w), cos(w)) * px;    // m.x längs, m.y quer zur Maserung
    float phase = m.y + fbm(vec2(m.x * 0.003, m.y * 0.02) + sB) * 40.0 + fbm(m * 0.0015 + sB * 0.7) * 140.0;
    float ast = 0.0, riss = 0.0;
    int na = int(aeste * 4.0 + 0.5);
    for (int i = 0; i < 4; i++) {
      if (i >= na) break;
      float s = float(i) * 4.1 + sB;
      vec2 c = mat2(cos(w), -sin(w), sin(w), cos(w)) * (vec2(0.1 + 0.8 * zufall(vec2(s, 1.0)), 0.1 + 0.8 * zufall(vec2(s, 2.0))) * aufloesung);
      float R = H * (0.025 + 0.035 * zufall(vec2(s, 3.0)));
      vec2 d = m - c;
      d.x /= 2.2;                                              // oval, in Faserrichtung gestreckt
      float r = length(d) * (1.0 + 0.08 * (wert(vec2(atan(d.y, d.x) * 3.0, s)) - 0.5));
      phase += sign(d.y) * R * 2.0 * exp(-r / (R * 2.5));     // die Ringe weichen aus
      float innen = smoothstep(R * 1.15, R * 0.85, r);
      phase = mix(phase, r * 1.7, innen);                       // im Ast: Ringe um die Mitte
      ast = max(ast, smoothstep(R * 0.95, R * 0.7, r));
      riss = max(riss, exp(-abs(r - R) / 1.2) * (0.5 + 0.5 * wert(vec2(atan(d.y, d.x) * 4.0, s + 9.0))));
    }
    float ring = sin(phase * 0.55);
    float weich = smoothstep(0.3, 1.0, ring) * (0.6 + 0.4 * wert(vec2(m.x * 0.01, m.y * 0.3) + sB));
    tinte *= 1.0 - maserung * weich * 0.85 * (1.0 - ast * 0.8);
    tinte *= 1.0 - riss * 0.85;
  } else {
    tinte *= 1.0 - step(0.996, zufall(floor(px / 1.5) + sB)) * 0.9;
  }
  // Farbauftrag: Flecken mit weniger Farbe, Streifen der Walze, Korn des Papiers
  float fleck = smoothstep(0.12, 0.5, fbm(px / (H * 0.07) + sA));
  float walze = wert(vec2(px.x * 0.004, px.y * 0.25) + sA);
  tinte *= mix(1.0, fleck * (0.85 + 0.15 * walze), farbauftrag);
  tinte *= 0.9 + 0.1 * wert(px / 1.2 + sA);

  vec3 papier = (papierTon < 0.5 ? vec3(0.95, 0.93, 0.88) : papierTon < 1.5 ? vec3(0.92, 0.86, 0.72) : vec3(0.82, 0.8, 0.76));
  papier *= 1.0 + (fbm(px / 30.0 + sA) - 0.5) * 0.06 + (wert(px / 1.4 + sA * 1.7) - 0.5) * 0.05;
  vec3 farbeDruck = druckfarbe < 0.5 ? vec3(0.07, 0.065, 0.06) : druckfarbe < 1.5 ? vec3(0.32, 0.19, 0.1) : druckfarbe < 2.5 ? vec3(0.72, 0.12, 0.1) : vec3(0.1, 0.17, 0.42);
  vec3 aus = mix(papier, papier * farbeDruck * 1.05, clamp(tinte, 0.0, 1.0));
  farbe = vec4(clamp(spuren(aus, px, false), 0.0, 1.0), 1.0);
}`,
  regler: [
    {
      gruppe: "Block",
      regler: [
        { name: "material", text: "Material", auswahl: ["Holz", "Linol"], wert: 0 },
        { name: "schwelle", text: "Schwelle", min: 0.05, max: 0.95, schritt: 0.01, wert: 0.5 },
        { name: "umkehren", text: "druckt", auswahl: ["das Dunkle", "das Helle"], wert: 0 },
        { name: "kante", text: "Kanten rau", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "maserung", text: "Maserung", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "richtung", text: "Richtung der Maserung (°)", min: 0, max: 180, schritt: 1, wert: 0 },
        { name: "aeste", text: "Äste", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "eisen", text: "Hohleisenspuren", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
      ],
    },
    {
      gruppe: "Druck",
      regler: [
        { name: "farbauftrag", text: "Farbe ungleich", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "druckfarbe", text: "Druckfarbe", auswahl: ["schwarz", "sepia", "rot", "blau"], wert: 0 },
        { name: "papierTon", text: "Papier", auswahl: ["weiß", "Japanpapier (warm)", "grau"], wert: 1 },
      ],
    },
    { ...SPUREN_REGLER, regler: SPUREN_REGLER.regler.map((r) => (["flecken", "kratzer", "schmutz"].includes(r.name) ? { ...r, wert: 0 } : r)) },
    wechselRegler("Abzug", "neuer Abzug", ["nur der Farbauftrag (derselbe Block)", "auch die Flecken", "alles, auch ein neuer Block"]),
  ],
};

export const HOLZSCHNITTE = [HOLZSCHNITT];
