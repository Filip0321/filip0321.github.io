// Verzerrung und Raum: Fisheye, Welle, Kaleidoskop und Spiegel, Tilt-Shift.
// Alle vier verschieben nur, WO gelesen wird (uv), nicht die Farbe: eine Verzerrung ist eine Funktion
// „für diesen Pixel lies dort“. Darum sind sie so kurz.

const GRUPPE = "Verzerrung und Raum";

// Stelle im Bild relativ zur Mitte, mit richtigem Seitenverhältnis (sonst wären Kreise Ellipsen)
const MITTE = /* glsl */ `
vec2 zurMitte(vec2 p) { return (p - 0.5) * vec2(aufloesung.x / aufloesung.y, 1.0); }
vec2 vonMitte(vec2 q) { return q / vec2(aufloesung.x / aufloesung.y, 1.0) + 0.5; }
`;

// ---------- Fisheye ----------
// Ein Fischauge bildet Winkel gleichmäßig ab statt Strecken: weit außen wird gestaucht. Hier die
// einfache Näherung r' = r · (1 + k·r²): k > 0 wölbt nach außen (Tonne), k < 0 nach innen (Kissen).
const FISHEYE = {
  id: "fisheye",
  name: "Fisheye",
  gruppe: GRUPPE,
  shader: /* glsl */ `${MITTE}
uniform float staerke, zoom, rund, randWeg;
void main() {
  vec2 q = zurMitte(uv);
  float r = length(q);
  // Ränder wegzoomen: die Ecke (am weitesten von der Mitte, r_e) wird um 1 + k·r_e² nach außen gelesen;
  // so viel Zoom braucht es mindestens, damit sie noch im Bild liest (bei Kissen, k < 0, reicht 1)
  float z = zoom;
  if (randWeg > 0.5 && rund < 0.5) {
    float re = length(zurMitte(vec2(1.0)));
    z = max(zoom, 1.0 + staerke * re * re);
  }
  vec2 p = vonMitte(q * (1.0 + staerke * r * r) / z);
  vec4 f = texture(bild, p);
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) f = vec4(0.0, 0.0, 0.0, 1.0);
  f.rgb *= mix(1.0, smoothstep(0.52, 0.5, r), rund); // rundes Bild wie beim echten Fischauge
  farbe = f;
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "staerke", text: "Stärke", min: -1, max: 3, schritt: 0.01, wert: 1.2 },
        { name: "zoom", text: "Zoom", min: 0.5, max: 2.5, schritt: 0.01, wert: 1.3 },
        { name: "rund", text: "Rund", auswahl: ["nein", "ja"], wert: 0 },
        { name: "randWeg", text: "Schwarze Ränder", auswahl: ["lassen", "wegzoomen"], wert: 0 },
      ],
    },
  ],
};

// ---------- Welle ----------
const WELLE = {
  id: "welle",
  name: "Welle",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  shader: /* glsl */ `${MITTE}
uniform float hoehe, dichte, tempo, art;
void main() {
  float t = zeit * tempo;
  vec2 p = uv;
  if (art < 0.5) p.x += sin(uv.y * dichte * 6.283 + t) * hoehe * 0.05;          // waagerecht
  else if (art < 1.5) p.y += sin(uv.x * dichte * 6.283 + t) * hoehe * 0.05;     // senkrecht
  else if (art < 2.5) p += vec2(sin(uv.y * dichte * 6.283 + t), cos(uv.x * dichte * 6.283 + t)) * hoehe * 0.03;
  else {
    // Strudel: je näher an der Mitte, desto stärker gedreht
    vec2 q = zurMitte(uv);
    float w = hoehe * 6.0 * exp(-length(q) * dichte) * sin(t * 0.5 + 1.0);
    p = vonMitte(mat2(cos(w), -sin(w), sin(w), cos(w)) * q);
  }
  farbe = texture(bild, p);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "art", text: "Art", auswahl: ["waagerecht", "senkrecht", "beides", "Strudel"], wert: 0 },
        { name: "hoehe", text: "Stärke", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "dichte", text: "Wellen", min: 0.5, max: 20, schritt: 0.1, wert: 4 },
        { name: "tempo", text: "Tempo", min: 0, max: 6, schritt: 0.1, wert: 1 },
      ],
    },
  ],
};

// ---------- Kaleidoskop und Spiegel ----------
// Kaleidoskop: in Polarkoordinaten (Winkel, Abstand) rechnen. Den Winkel auf ein Segment falten
// (mod), jedes zweite Segment gespiegelt, damit die Kanten nahtlos sind.
const KALEIDOSKOP = {
  id: "kaleido",
  name: "Kaleidoskop und Spiegel",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  shader: /* glsl */ `${MITTE}
uniform float art, segmente, drehung, zoom, kreisen;
void main() {
  vec2 p = uv;
  if (art < 0.5) {
    vec2 q = zurMitte(uv);
    float w = atan(q.y, q.x) + radians(drehung) + zeit * kreisen;
    float segment = 6.283185 / segmente;
    w = mod(w, segment);
    w = min(w, segment - w); // spiegeln: halbes Segment hin, halbes zurück
    p = vonMitte(vec2(cos(w), sin(w)) * length(q) / zoom);
  } else if (art < 1.5) p.x = 0.5 - abs(uv.x - 0.5);     // links gespiegelt nach rechts
  else if (art < 2.5) p.y = 0.5 + abs(uv.y - 0.5);       // oben gespiegelt nach unten
  else p = 0.5 - abs(uv - 0.5);                          // vier Viertel
  farbe = texture(bild, p);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "art", text: "Art", auswahl: ["Kaleidoskop", "Spiegel links", "Spiegel oben", "Spiegel vierfach"], wert: 0 },
        { name: "segmente", text: "Segmente", min: 2, max: 24, schritt: 1, wert: 6 },
        { name: "drehung", text: "Drehung", min: 0, max: 360, schritt: 1, wert: 0 },
        { name: "zoom", text: "Zoom", min: 0.3, max: 3, schritt: 0.01, wert: 1 },
        { name: "kreisen", text: "Kreisen", min: 0, max: 1, schritt: 0.01, wert: 0 },
      ],
    },
  ],
};

// ---------- Tilt-Shift ----------
// Ein Tilt-Shift-Objektiv kippt die Schärfeebene: nur ein schmaler Streifen ist scharf, darüber und
// darunter wird es schnell unscharf. Das Gehirn kennt so wenig Schärfentiefe nur von Nahaufnahmen,
// darum wirkt eine Stadt plötzlich wie ein Modell. Mehr Sättigung verstärkt den Spielzeug-Eindruck.
// Unschärfe: Spirale mit goldenem Winkel (gleichmäßig verteilte Stichproben in einem Kreis), der Radius
// wächst mit dem Abstand zum scharfen Streifen.
const TILTSHIFT = {
  id: "tiltshift",
  name: "Tilt-Shift",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float lage, breite, unschaerfe, saettigung;
void main() {
  float abstand = abs(uv.y - lage);
  float r = unschaerfe * smoothstep(breite * 0.5, breite * 0.5 + 0.25, abstand) * aufloesung.y * 0.015;
  vec3 summe = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float w = float(i) * 2.39996;
    summe += texture(bild, uv + vec2(cos(w), sin(w)) * sqrt((float(i) + 0.5) / 40.0) * r / aufloesung).rgb;
  }
  vec3 f = summe / 40.0;
  f = mix(vec3(hell(f)), f, saettigung);
  farbe = vec4(clamp(f, 0.0, 1.0), texture(bild, uv).a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "lage", text: "Scharf bei (Höhe)", min: 0, max: 1, schritt: 0.01, wert: 0.45 },
        { name: "breite", text: "Breite des Streifens", min: 0, max: 0.8, schritt: 0.01, wert: 0.15 },
        { name: "unschaerfe", text: "Unschärfe", min: 0, max: 3, schritt: 0.05, wert: 1.2 },
        { name: "saettigung", text: "Sättigung", min: 0, max: 2, schritt: 0.05, wert: 1.4 },
      ],
    },
  ],
};

export const RAUM = [FISHEYE, WELLE, KALEIDOSKOP, TILTSHIFT];

