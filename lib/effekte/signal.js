// Gruppe „Signal und Störung“: Effekte, die nicht das Bild nachmalen, sondern den Weg, den es nimmt.
//   RGB-Versatz zum Bass   die Farbkanäle rücken mit der Musik auseinander
//   Circuit Bending        Fehler einer umgelöteten Kamera oder eines Videomischers, gern im Takt
//   Analoges Signal        das Bild wirklich als PAL- oder NTSC-Signal, durchs Kabel und zurück
//   Databending            die Bytes des Bildes als Ton durch Audio-Effekte (wie in Audacity)
//   Wobbulator             Schwingungen an den Ablenkspulen einer Röhre (Nam June Paik und Shuya Abe, 1970)
// Die Rechnung von Analog und Databending steht in eigenen Dateien (/lib/analog.js, /lib/databending.js),
// weil das Databending-Projekt sie auch benutzt.

import { klang, schlagNummer, KLANG_REGLER } from "/lib/klang-signale.js";
import { analogesSignal } from "/lib/analog.js";
import { biegeBytes, ALLE_SCHRITTE } from "/lib/databending.js";
import { gl, glCanvas } from "/lib/webgl.js";

const GRUPPE = "Signal und Störung";
const standard = {}; // Gedächtnis, wenn jemand ohne Instanz ruft (wie in licht.js)

function neueTextur() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return t;
}

// welches Signal der Musik wirkt: Bass, Schlag, Mitte, Höhen
const SIGNALE = ["bass", "schlag", "mitte", "hoehen"];
const signalVon = (w, zeit) => klang(w.klangQuelle ?? 2, zeit, w.bpm ?? 120)[SIGNALE[Math.round(w.signal ?? 0)]] ?? 0;

// ---------- RGB-Versatz zum Bass ----------
// Rot ein Stück in die eine Richtung, Blau in die andere, Grün bleibt: wie ein Objektiv mit Farbfehler oder
// ein schlecht justierter Röhrenprojektor. Der Abstand ist Grundversatz + Signal · Stärke, bei einem Schlag
// springt er also auf und fällt wieder zurück. „Zittern“ dreht die Richtung bei jedem Schlag zufällig.
const RGBBASS = {
  id: "rgbbass",
  name: "RGB-Versatz zum Bass",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true,
  shader: /* glsl */ `
uniform float grund, staerke, richtung, signal;
void main() {
  vec2 r = vec2(cos(richtung), sin(richtung)) * (grund + signal * staerke) / aufloesung;
  vec4 o = texture(bild, uv);
  farbe = vec4(texture(bild, uv + r).r, o.g, texture(bild, uv - r).b, o.a);
}`,
  einstellungen(w, zeit) {
    const s = signalVon(w, zeit);
    const n = schlagNummer(w.klangQuelle, zeit, w.bpm);
    const zufall = (Math.sin(n * 12.9898) * 43758.5453) % 1; // fest pro Schlag
    const richtung = ((w.winkel ?? 0) * Math.PI) / 180 + (w.zittern ?? 0) * Math.PI * zufall;
    return { grund: w.grund ?? 0, staerke: w.staerke ?? 30, richtung, signal: s, zeit };
  },
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "grund", text: "Grundversatz (px)", min: 0, max: 20, schritt: 0.5, wert: 0 },
        { name: "staerke", text: "Stärke (px)", min: 0, max: 100, schritt: 1, wert: 30 },
        { name: "winkel", text: "Richtung (°)", min: 0, max: 180, schritt: 1, wert: 0 },
        { name: "zittern", text: "Zittern pro Schlag", min: 0, max: 1, schritt: 0.05, wert: 0.2 },
      ],
    },
    { gruppe: "Klang", regler: [{ name: "signal", text: "Signal", auswahl: ["Bass", "Schlag", "Mitte", "Höhen"], wert: 0 }, ...KLANG_REGLER] },
  ],
};

// ---------- Circuit Bending ----------
// Beim Circuit Bending lötet man in einer Kamera oder einem Videomischer Drähte zwischen Stellen, die nicht
// verbunden sein sollten. Typische Fehler, hier je ein Regler:
//   Bildfang     die Schaltung findet den Anfang des Bildes nicht: es läuft senkrecht durch, mit dem schwarzen
//                Balken der Austastlücke dazwischen
//   Zeilenfang   dasselbe pro Zeile: Zeilen rutschen waagerecht, das Bild reißt und kippt
//   Farbträger   die Farbe sitzt auf einer Schwingung; ist sie verstimmt, dreht sich der Farbton quer durchs Bild
//   Übersteuern  zu viel Signal: Weiß klebt und zieht nach rechts, Kanten glühen
//   Vertauschen  Helligkeit und Farbe auf den falschen Leitungen
//   Zeilen       Zeilen doppelt oder in Blöcken verschoben
// „im Takt“: die Fehler kommen mit dem Schlag und klingen ab, bei jedem Schlag mit neuem Zufall.
//
// Rückkopplung im Signalweg: beim Bending lötet man oft auch einen Ausgang zurück auf einen Eingang. Anders als
// der Effekt Feedback dahinter läuft das alte Bild hier noch einmal durch alle Fehler: es rollt noch einmal, die
// Zeilen rutschen noch einmal, der Farbton dreht sich noch einmal weiter. Darum stapeln sich die Fehler, aus
// einem verstimmten Farbträger wird ein Regenbogen aus Kopien.
//   Verzögerung   eine Schleife ist nie gleich lang: das Signal kommt ein paar Mikrosekunden später wieder an.
//                 Im Bild ist Zeit Ort: eine Verzögerung von d Pixeln ist eine Kopie d Pixel weiter rechts, von
//                 ganzen Zeilen eine Kopie tiefer
//   Art           gemischt (wie ein Videomischer), addiert (zwei Signale auf einem Draht: übersteuert schnell)
//                 oder invertiert (durch einen umkehrenden Verstärker: jede Runde ein Negativ, das Bild flackert
//                 zwischen hell und dunkel, wie eine Schwingung)
const BENDING = {
  id: "bending",
  name: "Circuit Bending",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true,
  shader: /* glsl */ `
uniform float bildfang, zeilenfang, farbtraeger, uebersteuern, vertauschen, zeilen, an, saat;
uniform sampler2D vorher; // das letzte Ergebnis dieses Effekts (Rückkopplung)
uniform float rueck, rueckX, rueckZeilen, rueckArt;
float z(float n) { return zufall(vec2(n, saat)); }
void main() {
  vec2 p = uv;
  float zeile = floor(uv.y * aufloesung.y);

  // Zeilen: in Blöcken zusammenfassen (dieselbe Zeile mehrmals) und manche Blöcke verschieben
  float block = 1.0 + floor(zeilen * an * 12.0);
  float yb = floor(p.y * aufloesung.y / block) * block / aufloesung.y;
  float verschieben = step(0.8, zufall(vec2(floor(p.y * 24.0), saat))) * zeilen * an;
  p.y = mix(p.y, yb, step(0.01, zeilen * an));
  p.x += verschieben * (z(3.0) - 0.5) * 0.3;

  // Bildfang: senkrecht durchlaufen
  float roll = bildfang * an;
  p.y = fract(p.y + zeit * roll * 0.6 + z(1.0) * roll);
  float balken = smoothstep(0.0, 0.025, p.y) * smoothstep(1.0, 0.975, p.y); // Austastlücke

  // Zeilenfang: pro Zeile waagerecht verschoben, oben wenig, unten mehr (das Bild kippt), dazu Risse
  float riss = step(0.93, zufall(vec2(floor(zeile / 6.0), floor(zeit * 15.0) + saat)));
  p.x += zeilenfang * an * (0.06 * sin(uv.y * 30.0 + zeit * 6.0) + 0.25 * (1.0 - uv.y) * z(2.0) + 0.12 * riss);
  p.x = fract(p.x);

  vec3 c = texture(bild, p).rgb;
  // Rückkopplung: das alte Ergebnis an derselben (schon verbogenen) Stelle, verzögert, kommt vor allen
  // weiteren Fehlern dazu
  if (rueck > 0.0) {
    vec3 alt = texture(vorher, fract(p - vec2(rueckX, rueckZeilen) / aufloesung)).rgb;
    // ein Abschwächer in der Schleife gleicht das Übersteuern aus: sonst wäre die Schleifenverstärkung über 1
    // und das Bild liefe in wenigen Runden weiß zu (wie ein Mikrofon, das vor dem Lautsprecher pfeift)
    alt /= 1.0 + uebersteuern * an * 2.5;
    if (rueckArt > 1.5) alt = 1.0 - alt; // invertiert
    c = rueckArt > 0.5 ? c * (1.0 - 0.5 * rueck) + alt * rueck : mix(c, alt, rueck);
  }
  c *= balken;

  // Übersteuern: lauter, helle Stellen ziehen nach rechts nach, Kanten glühen
  if (uebersteuern > 0.0) {
    float u = uebersteuern * an;
    vec3 nachzug = vec3(0.0);
    for (int i = 1; i <= 8; i++) {
      vec3 links = bei(p, vec2(-float(i) * 3.0, 0.0));
      nachzug = max(nachzug, smoothstep(0.7, 1.0, links * (1.0 + u * 2.0)) * (1.0 - float(i) / 9.0));
    }
    c = c * (1.0 + u * 2.5) + nachzug * u + length(sobel(p, 1.0)) * u * vec3(0.6, 0.9, 1.0);
  }

  // Farbträger verstimmt: der Farbton dreht sich quer durchs Bild, mit der Zeit wandernd
  if (farbtraeger > 0.0) {
    float f = farbtraeger * an;
    c = farbtonDrehen(c, f * (p.x * 25.0 + zeit * 3.0 + zeile * 0.05));
    c = mix(vec3(hell(c)), c, 1.0 + f); // satter, wie ein übersteuerter Farbkanal
  }

  // Helligkeit und Farbe vertauscht: wie viel Farbe da ist, wird hell; die Helligkeit wird zur Farbe
  if (vertauschen > 0.0) {
    float y = hell(c);
    vec3 chroma = c - y;
    float menge = length(chroma);
    vec3 neu = vec3(menge * 1.8) + (menge > 1e-3 ? chroma / menge : vec3(0.0)) * y * 0.7;
    c = mix(c, neu, vertauschen * an);
  }

  farbe = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  einstellungen(w, zeit, g = standard) {
    // im Takt: „an“ springt beim Schlag auf 1 und klingt ab; ohne Takt immer 1
    const signal = signalVon({ ...w, signal: 1 }, zeit); // Schlag
    const an = (w.imTakt ?? 0) > 0.5 ? Math.min(1, signal * 1.3) : 1;
    const saat = (schlagNummer(w.klangQuelle, zeit, w.bpm) % 997) + 1;
    g.vorher ??= gl ? neueTextur() : null;
    return { bildfang: w.bildfang ?? 0, zeilenfang: w.zeilenfang ?? 0, farbtraeger: w.farbtraeger ?? 0, uebersteuern: w.uebersteuern ?? 0, vertauschen: w.vertauschen ?? 0, zeilen: w.zeilen ?? 0, an, saat, zeit, rueck: w.rueck ?? 0, rueckX: w.rueckX ?? 4, rueckZeilen: w.rueckZeilen ?? 0, rueckArt: w.rueckArt ?? 0, vorher: g.vorher };
  },
  // wie Feedback (/lib/effekte/licht.js): jede Instanz merkt sich ihr letztes Bild in einer eigenen Textur
  neuesGedaechtnis: () => ({ vorher: null }),
  gibFrei: (g) => g.vorher && gl.deleteTexture(g.vorher),
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
      gruppe: "Fehler",
      regler: [
        { name: "bildfang", text: "Bildfang verloren", min: 0, max: 1, schritt: 0.01, wert: 0.2, ruhig: 0 },
        { name: "zeilenfang", text: "Zeilenfang verloren", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "farbtraeger", text: "Farbträger verstimmt", min: 0, max: 1, schritt: 0.01, wert: 0.1 },
        { name: "uebersteuern", text: "Übersteuern", min: 0, max: 1, schritt: 0.01, wert: 0.15 },
        { name: "vertauschen", text: "Hell und Farbe vertauscht", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "zeilen", text: "Zeilen doppelt, verschoben", min: 0, max: 1, schritt: 0.01, wert: 0.1 },
      ],
    },
    {
      gruppe: "Rückkopplung",
      regler: [
        { name: "rueck", text: "Rückkopplung", min: 0, max: 0.97, schritt: 0.01, wert: 0 },
        { name: "rueckX", text: "Verzögerung (px)", min: -40, max: 40, schritt: 0.5, wert: 4 },
        { name: "rueckZeilen", text: "Verzögerung (Zeilen)", min: -40, max: 40, schritt: 1, wert: 0 },
        { name: "rueckArt", text: "Art", auswahl: ["gemischt", "addiert (übersteuert)", "invertiert (flackert)"], wert: 0 },
      ],
    },
    { gruppe: "Takt", regler: [{ name: "imTakt", text: "Fehler", auswahl: ["immer", "im Takt (beim Schlag)"], wert: 1 }, ...KLANG_REGLER] },
  ],
};

// ---------- Analoges Signal ----------
// Das Bild wird Zeile für Zeile wirklich in ein Fernsehsignal umgerechnet (Helligkeit plus Farbe auf einem
// Hilfsträger), durch ein „Kabel“ geschickt (zu wenig Bandbreite, Rauschen, Überschwingen) und vom Fernseher
// wieder zerlegt. Farbbluten, Dot Crawl (krabbelnde Punkte an Farbkanten) und Regenbogen auf feinen Mustern
// entstehen dabei von selbst, niemand malt sie hin. Mit „Band: VHS“ liegt davor noch ein Videorekorder
// (Color-Under, Kopfumschaltung, Dropouts, Tracking). Rechnung und Theorie: /lib/analog.js
const ANALOG = {
  id: "analog",
  name: "Analoges Signal (PAL/NTSC)",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  cpu: (bild, w, zeit) => analogesSignal(bild, w, zeit),
  regler: [
    {
      gruppe: "Signal",
      regler: [
        { name: "norm", text: "Norm", auswahl: ["PAL", "NTSC"], wert: 0 },
        { name: "luma", text: "Bandbreite Helligkeit", min: 0.05, max: 1, schritt: 0.01, wert: 0.6 },
        { name: "chroma", text: "Bandbreite Farbe", min: 0.02, max: 1, schritt: 0.01, wert: 0.25 },
        { name: "kamm", text: "Trennung im Fernseher", auswahl: ["einfach (Dot Crawl)", "Kammfilter"], wert: 0 },
        { name: "phase", text: "Phasenfehler (°)", min: -90, max: 90, schritt: 1, wert: 0 },
      ],
    },
    {
      gruppe: "Kabel und Band",
      regler: [
        { name: "rauschen", text: "Rauschen", min: 0, max: 0.3, schritt: 0.005, wert: 0.02 },
        { name: "ueberschwingen", text: "Überschwingen", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "zittern", text: "Zeilen zittern (Band)", min: 0, max: 4, schritt: 0.1, wert: 0 },
        { name: "farbVersatz", text: "Farbe verzögert (px)", min: 0, max: 12, schritt: 0.5, wert: 2 },
      ],
    },
    {
      gruppe: "VHS-Band",
      regler: [
        { name: "band", text: "Band", auswahl: ["kein Band", "VHS"], wert: 0 },
        { name: "generation", text: "Generation (Kopie von Kopie)", min: 1, max: 5, schritt: 1, wert: 1 },
        { name: "schaerfe", text: "Nachschärfen", min: 0, max: 2, schritt: 0.05, wert: 0.6 },
        { name: "farbRauschen", text: "Farbrauschen", min: 0, max: 1, schritt: 0.01, wert: 0.3 },
        { name: "kopf", text: "Kopfumschaltung unten", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "dropouts", text: "Dropouts", min: 0, max: 1, schritt: 0.01, wert: 0.2 },
        { name: "tracking", text: "Tracking daneben", min: 0, max: 1, schritt: 0.01, wert: 0 },
      ],
    },
  ],
};

// ---------- Databending ----------
// Die Bytes des Bildes (R, G, B hintereinander, Zeile für Zeile) als Ton: jedes Byte ein Sample. Durch Audio-
// Effekte geschickt und wieder als Bild gelesen. Ein Echo um d Bytes ist eine Kopie, d/3 Pixel weiter rechts;
// ist d kein Vielfaches von 3, landet Rot auf Grün: die Farben rutschen. Rechnung: /lib/databending.js
// (dort auch das Projekt Databending mit Wellenform und Bereichen)
const DATABEND = {
  id: "databend",
  name: "Databending",
  gruppe: GRUPPE,
  zeitabhaengig: true, // nur wegen „LFO wandert“; steht er auf 0, ist jedes Bild gleich
  cpu: (bild, w, zeit) => biegeBytes(bild, ALLE_SCHRITTE.map((s) => ({ art: s.art, ...s.werteAus({ ...w, zeit }) })).filter((s) => s.an)),
  regler: [
    {
      gruppe: "Echo",
      regler: [
        { name: "echoMenge", text: "Echo", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "echoBytes", text: "Verzögerung (Bytes)", min: 1, max: 30000, schritt: 1, wert: 2401 },
        { name: "echoRueck", text: "Rückkopplung", min: 0, max: 0.95, schritt: 0.01, wert: 0.3 },
      ],
    },
    {
      gruppe: "Filter und Verzerrung",
      regler: [
        { name: "tiefpass", text: "Tiefpass", min: 0, max: 0.99, schritt: 0.01, wert: 0 },
        { name: "hochpass", text: "Hochpass", min: 0, max: 0.99, schritt: 0.01, wert: 0 },
        { name: "verzerrung", text: "Verzerrung", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "bits", text: "Bitcrush (Bits)", min: 1, max: 8, schritt: 1, wert: 8 },
        { name: "umkehren", text: "Rückwärts in Stücken (Bytes, 0 = aus)", min: 0, max: 20000, schritt: 3, wert: 0 },
        { name: "versatz", text: "Kanal-Versatz (Bytes)", min: 0, max: 2, schritt: 1, wert: 0 },
      ],
    },
    {
      gruppe: "Raum und Bewegung",
      regler: [
        { name: "hall", text: "Hall", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "hallRaum", text: "Raumgröße", min: 0.05, max: 20, schritt: 0.05, wert: 1 },
        { name: "phaser", text: "Phaser", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "flanger", text: "Flanger", min: 0, max: 1, schritt: 0.01, wert: 0 },
        { name: "flangerTiefe", text: "Flanger-Tiefe (Bytes)", min: 1, max: 600, schritt: 1, wert: 24 },
        { name: "lfoPeriode", text: "LFO-Periode (Bytes)", min: 30, max: 200000, schritt: 1, wert: 7680 },
        { name: "lfoLauf", text: "LFO wandert (pro Sekunde)", min: 0, max: 4, schritt: 0.05, wert: 0 },
      ],
    },
  ],
};

// ---------- Wobbulator ----------
// Nam June Paik und Shuya Abe haben 1970 an einen Fernseher zusätzliche Spulen um die Ablenkung gelegt und
// Tongeneratoren angeschlossen. Der Strahl wird dann beim Zeichnen zusätzlich hin und her gezogen.
// Entscheidend ist, WANN welcher Punkt gezeichnet wird: eine Zeile dauert 64 µs (davon 52 µs sichtbar), ein
// Halbbild 20 ms, und mit Zeilensprung kommen erst alle geraden, dann alle ungeraden Zeilen. Jeder Punkt hat also
// seine eigene Zeit t, und die Spule schiebt ihn um A · sin(2π f t). Darum sieht man nicht einfach ein Wackeln:
//   f = 50 Hz (ein Vielfaches der Halbbilder)   jedes Halbbild gleich verbogen: das Bild steht still, gebogen
//   f = 50,3 Hz                                  die Biegung wandert langsam durchs Bild
//   f = einige hundert Hz                        Wellen quer durch die Zeilen; mit Zeilensprung kämmen sich die
//                                                beiden Halbbilder auseinander
//   „Größe“                                      die Spule moduliert die Stärke der ganzen Ablenkung: das Bild atmet
// Helligkeit: läuft der Strahl langsamer über eine Stelle (Zeilen rücken zusammen), bekommt sie mehr Elektronen
// und leuchtet heller. Das ist die Fläche, auf die ein Stück Bild gequetscht wird: det der Ableitung der
// Koordinaten (dFdx, dFdy im Shader).
// Die Phase jeder Spule zum Bildanfang rechnet JavaScript genau (double); im Shader käme bei zeit · f sonst
// nach ein paar Minuten nur noch Rauschen heraus (float hat zu wenige Stellen).
const WOBBULATOR = {
  id: "wobbulator",
  name: "Wobbulator",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true,
  shader: /* glsl */ `
uniform float fv, fh, fs, pv, ph, ps, av, ah, ag, ar, zeilensprung, dichte;
const float ZEILE = 64e-6, SICHTBAR = 52e-6, HALBBILD = 0.02, ZEILEN = 576.0;
void main() {
  // wann zeichnet der Strahl diesen Punkt (Sekunden nach Beginn des Bildes)?
  float zeile = floor((1.0 - uv.y) * ZEILEN);
  float t = zeilensprung > 0.5
    ? mod(zeile, 2.0) * HALBBILD + floor(zeile / 2.0) * ZEILE + uv.x * SICHTBAR
    : zeile * ZEILE * 0.5 + uv.x * SICHTBAR * 0.5; // ohne: ein Bild in 20 ms von oben nach unten
  float sv = sin(pv + 6.2831853 * fv * t);
  float sh = sin(ph + 6.2831853 * fh * t);
  float ss = sin(ps + 6.2831853 * fs * t);
  // rückwärts: welcher Punkt des Bildes landet hier? (Größe und Drehung um die Mitte, dann verschoben)
  vec2 seiten = vec2(aufloesung.x / aufloesung.y, 1.0);
  vec2 q = (uv - 0.5) * seiten;
  float w = ar * ss;
  q = mat2(cos(w), sin(w), -sin(w), cos(w)) * q / (1.0 + ag * ss);
  q = q / seiten + 0.5 - vec2(ah * sh, av * sv);
  vec3 c = texture(bild, q).rgb;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) c = vec3(0.0); // außerhalb des Rasters: dunkel
  // Dichte: Fläche des Bildes, die auf dieses Pixel fällt (1 = unverzerrt). Nicht mit dFdx/dFdy: mit Zeilensprung
  // liegen zwei Nachbarzeilen in verschiedenen Halbbildern, die Ableitung würde dort springen. Darum von Hand,
  // innerhalb eines Halbbilds: die nächste Zeile desselben Halbbilds kommt 64 µs später.
  float dtdy = ZEILE * ZEILEN * 0.5; // Sekunden pro Bildhöhe (uv), innerhalb eines Halbbilds
  float dtdx = zeilensprung > 0.5 ? SICHTBAR : SICHTBAR * 0.5; // Sekunden pro Bildbreite
  float cv = av * cos(pv + 6.2831853 * fv * t) * 6.2831853 * fv;
  float ch = ah * cos(ph + 6.2831853 * fh * t) * 6.2831853 * fh;
  float g = 1.0 / (1.0 + ag * ss);
  // Ableitungen von q nach dem Bildschirm (y im Bild zeigt nach oben, die Zeit läuft nach unten: daher +)
  float a = g - ch * dtdx, b = ch * dtdy, cc = -cv * dtdx, d = g + cv * dtdy;
  float flaeche = abs(a * d - b * cc);
  c *= mix(1.0, clamp(flaeche, 0.2, 3.0), dichte);
  farbe = vec4(c, 1.0);
}`,
  einstellungen(w, zeit) {
    const signal = signalVon(w, zeit);
    const klangAnteil = w.klangMenge ?? 0;
    const k = 1 - klangAnteil + klangAnteil * signal; // die Musik dreht die Lautstärke der Generatoren auf und zu
    const phase = (f) => 2 * Math.PI * ((zeit * f) % 1);
    const fv = w.fv ?? 50.3;
    const fh = w.fh ?? 0;
    const fs = w.fs ?? 0;
    return {
      fv, fh, fs, pv: phase(fv), ph: phase(fh), ps: phase(fs),
      av: (w.av ?? 0.05) * k, ah: (w.ah ?? 0) * k, ag: (w.ag ?? 0) * k, ar: (((w.ar ?? 0) * Math.PI) / 180) * k,
      zeilensprung: w.zeilensprung ?? 1, dichte: w.dichte ?? 0.6, zeit,
    };
  },
  regler: [
    {
      gruppe: "Spulen",
      regler: [
        { name: "av", text: "senkrecht: Stärke", min: 0, max: 0.5, schritt: 0.005, wert: 0.05 },
        { name: "fv", text: "senkrecht: Frequenz (Hz)", min: 0, max: 2000, schritt: 0.05, wert: 50.3 },
        { name: "ah", text: "waagerecht: Stärke", min: 0, max: 0.5, schritt: 0.005, wert: 0.03 },
        { name: "fh", text: "waagerecht: Frequenz (Hz)", min: 0, max: 2000, schritt: 0.05, wert: 400 },
        { name: "ag", text: "Größe: Stärke", min: 0, max: 0.8, schritt: 0.01, wert: 0 },
        { name: "ar", text: "Drehung (°)", min: 0, max: 90, schritt: 0.5, wert: 0 },
        { name: "fs", text: "Größe und Drehung: Frequenz (Hz)", min: 0, max: 2000, schritt: 0.05, wert: 0.5 },
      ],
    },
    {
      gruppe: "Röhre",
      regler: [
        { name: "zeilensprung", text: "Zeilensprung", auswahl: ["aus", "an (zwei Halbbilder)"], wert: 1 },
        { name: "dichte", text: "dichte Zeilen leuchten heller", min: 0, max: 1, schritt: 0.01, wert: 0.6 },
      ],
    },
    { gruppe: "Klang", regler: [{ name: "klangMenge", text: "Musik steuert die Stärke", min: 0, max: 1, schritt: 0.01, wert: 0 }, { name: "signal", text: "Signal", auswahl: ["Bass", "Schlag", "Mitte", "Höhen"], wert: 0 }, ...KLANG_REGLER] },
  ],
};

export const SIGNAL = [RGBBASS, BENDING, ANALOG, DATABEND, WOBBULATOR];
