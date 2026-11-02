// Film und Kamera: Filmkamera, Camcorder, Wärmebild, Nachtsicht.
// Was flackert, hat einen ruhigeren Startwert („ruhig“), wenn im System „Bewegung reduzieren“ an ist.

import { gl, rendere, zurueckholen } from "../webgl.js";
import { programmVon, leinwand } from "./hilfen.js";

const GRUPPE = "Film und Kamera";

// ---------- Filmkamera ----------
// Was eine echte Filmkamera dem Bild antut, Schritt für Schritt:
//   Bildstand: der Film liegt nie ganz gleich im Bildfenster, jedes Bild sitzt ein wenig anders (24 pro Sekunde)
//   Halation:  helles Licht geht durch die Filmschicht, spiegelt am Träger und kommt rötlich zurück
//              (die rote Schicht liegt hinten): um Lichter entsteht ein roter Schein
//   Lichtleck: Licht dringt am Rand der Kamera ein, warme Flecken wandern übers Bild
//   Flackern:  jedes Bild ist ein bisschen anders belichtet
//   Korn:      Silberkörner; in den Mitten am stärksten, in Schwarz und Weiß kaum sichtbar
const FILMKAMERA = {
  id: "film",
  name: "Filmkamera",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true,
  shader: /* glsl */ `
uniform float korn, wackeln, halation, lecks, flackern, vignette;
void main() {
  float bildNr = floor(zeit * 24.0);
  vec2 versatz = (vec2(zufall(vec2(bildNr, 1.7)), zufall(vec2(bildNr, 9.1))) - 0.5) * wackeln * 0.006;
  vec2 p = uv + versatz;
  vec3 f = texture(bild, p).rgb;

  // Halation: helle Stellen der Umgebung einsammeln (Spirale mit goldenem Winkel, gleichmäßig verteilt)
  vec3 schein = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float w = float(i) * 2.39996;
    float r = sqrt((float(i) + 0.5) / 24.0) * aufloesung.y * 0.015;
    schein += max(texture(bild, p + vec2(cos(w), sin(w)) * r / aufloesung).rgb - 0.65, 0.0);
  }
  f += vec3(1.0, 0.3, 0.1) * hell(schein / 24.0) * halation * 4.0;

  // Lichtleck: ein warmer Fleck, der langsam am Rand entlang wandert
  vec2 ort = vec2(0.5 + 0.6 * sin(zeit * 0.21), 0.5 + 0.6 * cos(zeit * 0.13));
  float leck = pow(max(0.0, 1.0 - length((uv - ort) * vec2(1.0, 1.6))), 3.0);
  f += vec3(1.0, 0.45, 0.12) * leck * lecks;

  f *= 1.0 + (zufall(vec2(bildNr, 3.3)) - 0.5) * flackern * 0.2;

  float h = hell(f);
  float k = zufall(floor(uv * aufloesung) + bildNr * 17.0) - 0.5;
  f += k * korn * 0.3 * (1.0 - abs(h - 0.5) * 1.6);

  f *= mix(1.0, smoothstep(0.95, 0.35, length(uv - 0.5)), vignette);
  farbe = vec4(clamp(f, 0.0, 1.0), texture(bild, uv).a);
}`,
  regler: [
    {
      gruppe: "Film",
      regler: [
        { name: "korn", text: "Korn", min: 0, max: 1, schritt: 0.01, wert: 0.35 },
        { name: "wackeln", text: "Bildstand", min: 0, max: 1, schritt: 0.01, wert: 0.3, ruhig: 0 },
        { name: "flackern", text: "Flackern", min: 0, max: 1, schritt: 0.01, wert: 0.3, ruhig: 0 },
      ],
    },
    {
      gruppe: "Licht",
      regler: [
        { name: "halation", text: "Halation", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "lecks", text: "Lichtlecks", min: 0, max: 1, schritt: 0.01, wert: 0.2 },
        { name: "vignette", text: "Vignette", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
      ],
    },
  ],
};

// ---------- Camcorder ----------
// Ein Shader für das Bild, danach Canvas für die Schrift:
//   Zeilensprung: ein Videobild besteht aus zwei Halbbildern (gerade und ungerade Zeilen), aufgenommen
//                 1/50 Sekunde nacheinander. Bewegt sich etwas, stehen die Zeilen versetzt: Kämme.
//                 Ohne zweites Bild täuschen wir das vor: jede zweite Zeile ein Stück verschoben.
//   Pumpen:       die Automatik regelt die Belichtung nach, langsam und ein bisschen zu viel
//   Farbe:        Consumer-Kameras bluten Farbe nach rechts (Chroma hat weniger Auflösung als Helligkeit)
const CAMCORDER_SHADER = /* glsl */ `
uniform float kamm, pumpen, bluten, schaerfe;
void main() {
  vec2 px = uv * aufloesung;
  float zeile = mod(floor(px.y), 2.0);
  vec2 p = uv + vec2(zeile * kamm * 4.0 * sin(zeit * 2.0 + px.y * 0.01) / aufloesung.x, 0.0);
  vec3 f = texture(bild, p).rgb;
  // Farbe (nicht Helligkeit) weich nach rechts ziehen
  vec3 weich = vec3(0.0);
  for (int i = 0; i < 6; i++) weich += texture(bild, p - vec2(float(i) * bluten * 2.0 / aufloesung.x, 0.0)).rgb;
  weich /= 6.0;
  f = vec3(hell(f)) + (weich - vec3(hell(weich))); // Helligkeit scharf, Farbe verschmiert
  // nachschärfen, wie die Kamera es tut (Ränder mit hellen Säumen)
  vec3 umgebung = (bei(p, vec2(1.0, 0.0)) + bei(p, vec2(-1.0, 0.0)) + bei(p, vec2(0.0, 1.0)) + bei(p, vec2(0.0, -1.0))) * 0.25;
  f += (f - umgebung) * schaerfe * 2.0;
  f *= 1.0 + pumpen * 0.25 * sin(zeit * 0.9) * sin(zeit * 0.37 + 1.0);
  f *= 1.0 - zeile * 0.06; // Zeilen sichtbar
  farbe = vec4(clamp(f, 0.0, 1.0), texture(bild, uv).a);
}`;

const MONATE = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];
const zwei = (n) => String(Math.floor(n)).padStart(2, "0");

const CAMCORDER = {
  id: "camcorder",
  name: "Camcorder",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  shader: CAMCORDER_SHADER, // nur damit programmVon ihn kennt; gezeichnet wird in cpu()
  cpu(bild, w, zeit) {
    const b = bild.width;
    const h = bild.height;
    let aus = bild;
    if (gl) {
      rendere(programmVon(CAMCORDER), bild, b, h, { kamm: w.kamm, pumpen: w.pumpen, bluten: w.bluten, schaerfe: w.schaerfe, zeit });
      aus = zurueckholen(b, h);
    }
    if (!w.schrift) return aus;
    // Schrift: PLAY oben links, Datum unten links, Zeitcode unten rechts, weiß mit dunklem Schatten
    const { c, ctx } = leinwand(b, h);
    ctx.putImageData(aus, 0, 0);
    const g = Math.round(h * 0.055);
    ctx.font = `bold ${g}px "Courier New", monospace`;
    ctx.textBaseline = "alphabetic";
    const schreibe = (text, x, y, ausrichtung = "left") => {
      ctx.textAlign = ausrichtung;
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillText(text, x + g * 0.08, y + g * 0.08);
      ctx.fillStyle = "#f4f4f4";
      ctx.fillText(text, x, y);
    };
    const rand = g * 1.2;
    if (Math.floor(zeit * 1.5) % 2 === 0) schreibe("▶ PLAY", rand, rand + g); // blinkt
    const heute = new Date();
    schreibe(`${MONATE[heute.getMonth()]}. ${zwei(heute.getDate())} ${Math.round(w.jahr)}`, rand, h - rand);
    const bilder = Math.floor(zeit * 25);
    schreibe(`${zwei(bilder / 90000)}:${zwei((bilder / 1500) % 60)}:${zwei((bilder / 25) % 60)}:${zwei(bilder % 25)}`, b - rand, h - rand, "right");
    return ctx.getImageData(0, 0, b, h);
  },
  regler: [
    {
      gruppe: "Bild",
      regler: [
        { name: "kamm", text: "Zeilensprung", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "bluten", text: "Farbe bluten", min: 0, max: 1, schritt: 0.01, wert: 0.5 },
        { name: "schaerfe", text: "Nachschärfen", min: 0, max: 1, schritt: 0.01, wert: 0.4 },
        { name: "pumpen", text: "Belichtung pumpt", min: 0, max: 1, schritt: 0.01, wert: 0.3, ruhig: 0 },
      ],
    },
    {
      gruppe: "Schrift",
      regler: [
        { name: "schrift", text: "Einblendung", auswahl: ["aus", "an"], wert: 1 },
        { name: "jahr", text: "Jahr", min: 1980, max: 2010, schritt: 1, wert: 1998 },
      ],
    },
  ],
};

// ---------- Wärmebild ----------
// Eine Wärmekamera misst Infrarot, keine Farbe. Wir nehmen die Helligkeit als „Wärme“ (das ist geraten:
// ein heller Himmel ist nicht warm) und färben sie mit der „Eisen“-Skala der echten Geräte:
// schwarz, blau, violett, rot, orange, gelb, weiß. Weichgezeichnet, weil Wärmesensoren grob auflösen.
const WAERMEBILD = {
  id: "waerme",
  name: "Wärmebild",
  gruppe: GRUPPE,
  shader: /* glsl */ `
uniform float kontrast, weich, umkehren;
vec3 eisen(float t) {
  vec3 a = mix(vec3(0.0), vec3(0.1, 0.0, 0.45), smoothstep(0.0, 0.2, t));
  a = mix(a, vec3(0.6, 0.0, 0.6), smoothstep(0.2, 0.4, t));
  a = mix(a, vec3(0.95, 0.15, 0.05), smoothstep(0.4, 0.6, t));
  a = mix(a, vec3(1.0, 0.65, 0.0), smoothstep(0.6, 0.8, t));
  return mix(a, vec3(1.0, 1.0, 0.85), smoothstep(0.8, 1.0, t));
}
void main() {
  float summe = 0.0;
  float r = weich * aufloesung.y * 0.01;
  for (int i = 0; i < 16; i++) {
    float w = float(i) * 2.39996;
    summe += hell(texture(bild, uv + vec2(cos(w), sin(w)) * sqrt((float(i) + 0.5) / 16.0) * r / aufloesung).rgb);
  }
  float t = summe / 16.0;
  if (umkehren > 0.5) t = 1.0 - t;
  t = clamp((t - 0.5) * kontrast + 0.5, 0.0, 1.0);
  farbe = vec4(eisen(t), texture(bild, uv).a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "kontrast", text: "Kontrast", min: 0.5, max: 3, schritt: 0.05, wert: 1.4 },
        { name: "weich", text: "Weich", min: 0, max: 3, schritt: 0.05, wert: 1 },
        { name: "umkehren", text: "Dunkel ist warm", auswahl: ["nein", "ja"], wert: 0 },
      ],
    },
  ],
};

// ---------- Nachtsicht ----------
// Ein Restlichtverstärker macht aus wenigen Photonen viele Elektronen, die auf einen grünen Leuchtschirm
// prallen (Grün, weil das Auge dort am empfindlichsten ist). Deshalb: grün, stark verstärkt, verrauscht
// (wenige Photonen = Schrotrauschen), Lichter blühen auf, und rund herum das schwarze Rohr.
const NACHTSICHT = {
  id: "nachtsicht",
  name: "Nachtsicht",
  gruppe: GRUPPE,
  zeitabhaengig: true,
  lebendig: true,
  shader: /* glsl */ `
uniform float verstaerkung, rauschen, rohr;
void main() {
  vec3 f = texture(bild, uv).rgb;
  float h = hell(f) * verstaerkung;
  // Lichter blühen auf
  float glanz = 0.0;
  for (int i = 0; i < 12; i++) {
    float w = float(i) * 2.39996;
    glanz += max(hell(texture(bild, uv + vec2(cos(w), sin(w)) * sqrt((float(i) + 0.5) / 12.0) * aufloesung.y * 0.02 / aufloesung).rgb) * verstaerkung - 0.9, 0.0);
  }
  h += glanz / 12.0 * 2.0;
  float bildNr = floor(zeit * 30.0);
  h += (zufall(floor(uv * aufloesung * 0.5) + bildNr * 13.0) - 0.5) * rauschen * 0.5;
  vec3 g = vec3(0.1, 1.0, 0.25) * h;
  g += vec3(0.6, 1.0, 0.6) * max(h - 1.0, 0.0); // ganz hell wird weißlich
  vec2 m = (uv - 0.5) * vec2(aufloesung.x / aufloesung.y, 1.0);
  g *= mix(1.0, smoothstep(0.5, 0.42, length(m)), rohr);
  farbe = vec4(clamp(g, 0.0, 1.0), texture(bild, uv).a);
}`,
  regler: [
    {
      gruppe: "Einstellungen",
      regler: [
        { name: "verstaerkung", text: "Verstärkung", min: 0.5, max: 6, schritt: 0.1, wert: 2.5 },
        { name: "rauschen", text: "Rauschen", min: 0, max: 1, schritt: 0.01, wert: 0.4, ruhig: 0.1 },
        { name: "rohr", text: "Rohr", min: 0, max: 1, schritt: 0.01, wert: 1 },
      ],
    },
  ],
};

export const FILM = [FILMKAMERA, CAMCORDER, WAERMEBILD, NACHTSICHT];
