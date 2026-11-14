// Volumen auf der Grafikkarte: die Werte als 3D-Textur (sampler3D), ein Strahl je Pixel läuft hindurch.
//
// Darstellungen (Uniform art):
//   0 Volumen (direct volume rendering): Schritt für Schritt Farbe und Deckkraft aus der Transferfunktion holen
//     und von vorn nach hinten übereinanderlegen:  C += (1 − A) · α · c,  A += (1 − A) · α
//     Sobald A fast 1 ist, sieht man nichts mehr dahinter: aufhören („early ray termination“)
//   1 Oberfläche: der erste Punkt, an dem der Wert die Schwelle überschreitet (Isofläche), beleuchtet
//   2 MIP (maximum intensity projection): der größte Wert entlang des Strahls; Gefäße mit Kontrastmittel und
//     Knochen leuchten heraus
//   3 Röntgen: wie ein echtes Röntgenbild die Schwächung aufsummieren, I = e^(−Σ μ · Δs) (Beer-Lambert)
// Beleuchtung: die Normale ist das Gefälle (Gradient) der Werte, aus den sechs Nachbarn (zentrale Differenzen).
// Werte: so, wie sie in der Datei stehen (bei CT in Hounsfield-Einheiten), als halbe Gleitkommazahlen (R16F):
// ganze Zahlen bis 2048 genau, bis 4096 in Zweierschritten, das reicht für CT. Die Transferfunktion ist eine
// 1D-Textur (256 Farben) über einem Fenster [von, bis] dieser Werte.
// Dazu eine zweite 3D-Textur, die Maske (maske.js): wo sie unter 0,5 ist, gilt der Wert „leer“ (Luft).
// Und zwei für die Segmente (segmente.js):
//   segTex    die Nummern, ganze Zahlen (R8UI, ohne Mischen gelesen: zwischen Segment 2 und 4 liegt nicht Segment 3):
//             sie bestimmen nur die Farbe (segFarbe: Farbe und Deckkraft je Nummer)
//   segWeich  die weiche Maske aller sichtbaren Segmente (0 bis 1, geglättet, linear gelesen): sie bestimmt die Form.
//             Ihre Grenze bei 0,5 ist eine glatte Fläche; nur mit den Nummern wäre es eine Treppe aus Würfeln.
// segAnzeige: 0 nur die Kurve; 1 die Kurve, in Segmenten eingefärbt; 2 die Kurve nur in den Segmenten (eingefärbt;
// das Volumen bleibt durchscheinend wie mit der Kurve allein, nur ohne alles außerhalb); 3 Segmente als feste Körper.
// segTint: wie stark eingefärbt wird (0: gar nicht, nur ausgeschnitten).
// Ausrichtung (lage): eine Drehung (oder Spiegelung) des Volumens in der Welt; statt das Volumen zu drehen, wird
// der Strahl mit der umgekehrten Drehung (bei Drehungen: transponiert) ins Volumen gebracht.

const VOLL = `#version 300 es
in vec2 lage;
out vec2 uv;
void main() {
  uv = lage;
  gl_Position = vec4(lage, 0.0, 1.0);
}`;

const STRAHL = `#version 300 es
precision highp float;
precision highp sampler3D;
precision highp usampler3D;
in vec2 uv;
out vec4 farbe;
uniform sampler3D vol;
uniform sampler2D tf;        // TF_GROESSE × 1, RGBA: Farbe und Deckkraft je Wert im Fenster
uniform vec2 fenster;        // von, bis (Werte der Datei)
uniform vec3 groesse;        // Ausdehnung des Würfels (größte Seite 1), aus Voxelzahl mal Voxelgröße
uniform vec3 voxel;          // Voxel je Achse (für die Schrittweite und den Gradienten)
uniform vec3 boxVon;         // Ausschnitt (0 bis 1 je Achse)
uniform vec3 boxBis;
uniform mat3 dreh;           // Drehung der Kamera um das Volumen
uniform float abstand;       // Entfernung der Kamera
uniform vec2 versatz;        // Verschieben in der Bildebene (Einheiten der größten Volumenseite)
uniform float seite;
uniform int art;
uniform float schwelle;      // Oberfläche: Wert, MIP/Röntgen: nichts
uniform float dichte;        // wie stark die Deckkraft wirkt
uniform float schritt;       // Schrittweite in Voxeln (klein = genauer, langsamer)
uniform float licht;         // 0 flach, 1 beleuchtet
uniform vec3 grund;          // Hintergrund
uniform vec3 oberFarbe;      // Farbe der Oberfläche
uniform int ct;              // 1: Werte sind Hounsfield-Einheiten (für Röntgen: Schwächung aus HU)
uniform mediump sampler3D maske; // 1 sichtbar, 0 ausgeblendet
uniform float leer;          // was an ausgeblendeten Stellen gilt (Luft)
uniform mat3 lage;           // Ausrichtung des Volumens in der Welt
uniform float schlierenArt;  // 0 Messerschneide, 1 farbig, 2 Dunkelfeld
uniform float schlierenStaerke;
uniform float messerWinkel;  // Richtung der Messerschneide (Bogenmaß)
uniform usampler3D segTex;   // Nummer des Segments je Zelle
uniform ivec3 segGroesse;
uniform vec4 segFarbe[16];   // je Nummer: Farbe, Deckkraft (0 = unsichtbar); [0] ungenutzt
uniform int segAnzeige;
uniform sampler3D segWeich;  // weiche Maske der sichtbaren Segmente
uniform float segTint;

float wert(vec3 p) { return texture(maske, p).r < 0.5 ? leer : texture(vol, p).r; }
vec4 nachschlagen(float v) {
  float t = clamp((v - fenster.x) / (fenster.y - fenster.x), 0.0, 1.0);
  return texture(tf, vec2(t, 0.5));
}
// Gradient in Texturkoordinaten, durch die Größe geteilt (damit er im Raum stimmt)
vec3 gefaelle(vec3 p) {
  vec3 e = 1.0 / voxel;
  return vec3(wert(p + vec3(e.x, 0, 0)) - wert(p - vec3(e.x, 0, 0)),
              wert(p + vec3(0, e.y, 0)) - wert(p - vec3(0, e.y, 0)),
              wert(p + vec3(0, 0, e.z)) - wert(p - vec3(0, 0, e.z))) / groesse;
}
uint segNummer(vec3 p) { return texelFetch(segTex, ivec3(clamp(p, 0.0, 0.9999) * vec3(segGroesse)), 0).r; }
// Gefälle der weichen Maske (nach innen); die Normale einer Segment-Fläche ist −Gefälle
vec3 weichGefaelle(vec3 p) {
  vec3 e = 1.0 / vec3(segGroesse);
  return vec3(texture(segWeich, p + vec3(e.x, 0, 0)).r - texture(segWeich, p - vec3(e.x, 0, 0)).r,
              texture(segWeich, p + vec3(0, e.y, 0)).r - texture(segWeich, p - vec3(0, e.y, 0)).r,
              texture(segWeich, p + vec3(0, 0, e.z)).r - texture(segWeich, p - vec3(0, 0, e.z)).r) / groesse;
}
float helligkeit(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float zufall(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  // Kamera: steht in Richtung +z (gedreht mit dreh) im Abstand „abstand“ und schaut zur Mitte
  // … und alles in die Lage des Volumens gebracht (transpose = umgekehrte Drehung)
  vec3 auge = transpose(lage) * (dreh * vec3(-versatz.x, versatz.y, abstand));
  vec3 r = normalize(transpose(lage) * (dreh * vec3(uv.x * seite * 0.5, uv.y * 0.5, -1.0)));
  // Schnitt mit der (ausgeschnittenen) Box: Würfel von −groesse/2 bis +groesse/2, Ausschnitt darin
  vec3 lo = (boxVon - 0.5) * groesse, hi = (boxBis - 0.5) * groesse;
  vec3 t1 = (lo - auge) / r, t2 = (hi - auge) / r;
  vec3 tmin = min(t1, t2), tmax = max(t1, t2);
  float rein = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float raus = min(min(tmax.x, tmax.y), tmax.z);
  if (rein >= raus) { farbe = vec4(grund, 1.0); return; }
  float ds = schritt / max(max(voxel.x, voxel.y), voxel.z);
  // Startpunkt um einen Zufallsbruchteil eines Schritts verschoben: sonst sieht man Ringe (Holzmaserung)
  float t = rein + ds * zufall(gl_FragCoord.xy);
  vec3 c = vec3(0.0);
  float a = 0.0;
  float maxi = -1e9;
  float summe = 0.0;
  vec3 ablenkung = vec3(0.0);  // Schlieren: Gefälle der Dichte, entlang des Strahls aufsummiert
  bool getroffen = false;
  vec3 treffer;
  vec3 trefferFarbe = oberFarbe;
  uint trefferSeg = 0u;
  vec4 letzteSeg = vec4(oberFarbe, 0.9);
  for (int i = 0; i < 2048; i++) {
    if (t > raus) break;
    vec3 p = auge + r * t;
    vec3 q = p / groesse + 0.5;       // Texturkoordinate 0 bis 1
    float v = wert(q);
    if (art == 0) {
      vec4 s = nachschlagen(v);
      bool fest = false; // Segment als fester Körper: dann Licht aus der Form der Maske
      if (segAnzeige > 0) {
        float m = smoothstep(0.35, 0.65, texture(segWeich, q).r); // wie sehr hier „im Segment“ (weich)
        uint l = segNummer(q);
        vec4 sf = l > 0u ? segFarbe[min(l, 15u)] : vec4(0.0);
        if (sf.a > 0.0) letzteSeg = sf; // am weichen Rand ist die Nummer schon 0: die Farbe von eben nehmen
        else sf = letzteSeg;
        if (segAnzeige == 3) {
          s = vec4(sf.rgb, sf.a * m);
          fest = true;
        } else {
          if (segAnzeige == 2) s.a *= m;
          // einfärben, aber die Helligkeit der Kurve behalten (sonst wäre es ein einfarbiger Klumpen)
          s.rgb = mix(s.rgb, sf.rgb * (0.35 + 0.9 * helligkeit(s.rgb)), segTint * m);
          s.a *= mix(1.0, sf.a, m);
        }
      }
      // Deckkraft je Schritt: auf die Schrittlänge umgerechnet, damit es nicht von der Schrittweite abhängt
      float alpha = 1.0 - pow(1.0 - clamp(s.a, 0.0, 0.999), dichte * ds * 100.0);
      if (alpha > 0.002) {
        vec3 f = s.rgb;
        if (licht > 0.0) {
          vec3 g = fest ? -weichGefaelle(q) : gefaelle(q);
          float lg = length(g);
          if (lg > 1e-4) {
            vec3 n = -g / lg;
            float diffus = abs(dot(n, -r)); // von beiden Seiten beleuchtet (Lampe an der Kamera)
            f *= mix(1.0, 0.25 + 0.85 * diffus, licht);
          }
        }
        c += (1.0 - a) * alpha * f;
        a += (1.0 - a) * alpha;
        if (a > 0.98) break;
      }
    } else if (art == 1) {
      if (segAnzeige > 0) {
        uint l = segNummer(q);
        vec4 sf = l > 0u ? segFarbe[min(l, 15u)] : vec4(0.0);
        if (sf.a > 0.0) letzteSeg = sf;
        if (texture(segWeich, q).r > 0.5) { getroffen = true; treffer = q; trefferFarbe = letzteSeg.rgb; trefferSeg = 1u; break; }
      }
      if (segAnzeige < 2 && v >= schwelle) { getroffen = true; treffer = q; break; }
    } else if (art == 2) {
      maxi = max(maxi, v);
    } else if (art == 4) {
      ablenkung += gefaelle(q) * ds;
    } else {
      // Schwächung μ: bei CT direkt aus den Hounsfield-Einheiten (sie sind so definiert: HU = 1000 · (μ − μ_Wasser)
      // / μ_Wasser, also μ / μ_Wasser = 1 + HU / 1000; Luft 0, Wasser 1, Knochen 2 bis 3); sonst aus der Kurve
      float mu = ct == 1 ? (v < -900.0 ? 0.0 : 1.0 + v / 1000.0) : max(nachschlagen(v).a, 0.0); // unter −900: Luft (mit Rauschen)
      summe += mu * ds;
    }
    t += ds;
  }
  vec3 f;
  // der Grund bleibt genau die gewählte Farbe (die Helligkeitskurve am Ende gilt nur fürs Volumen; vorher wurde sie
  // auch auf den Grund in der Box angewendet, dann war die Box auf dunkelgrauem Grund als heller Kasten zu sehen)
  if (art == 0) {
    farbe = vec4(pow(c, vec3(1.0 / 1.8)) + (1.0 - a) * grund, 1.0);
    return;
  } else if (art == 1) {
    if (!getroffen) { farbe = vec4(grund, 1.0); return; }
    else {
      vec3 n = -normalize((trefferSeg > 0u ? weichGefaelle(treffer) : gefaelle(treffer)) + 1e-6);
      float diffus = max(dot(n, -r), 0.0);
      float glanz = pow(max(dot(reflect(r, n), -r), 0.0), 30.0);
      f = trefferFarbe * (0.15 + 0.85 * diffus) + vec3(0.25 * glanz);
    }
  } else if (art == 4) {
    // Schlieren (Toepler 1864): Licht wird dort abgelenkt, wo sich die Dichte (und damit die Brechzahl) quer zum
    // Strahl ändert, um so mehr, je mehr Gefälle es unterwegs trifft. Nur der Teil der Ablenkung quer zum Bild zählt:
    // auf die Achsen der Kamera projiziert (im Volumen: mit der umgekehrten Lage gedreht).
    vec3 rechts = transpose(lage) * dreh[0], hoch = transpose(lage) * dreh[1];
    vec2 d = vec2(dot(ablenkung, rechts), dot(ablenkung, hoch)) * schlierenStaerke;
    if (schlierenArt < 0.5) {
      // Messerschneide: Licht, das zur einen Seite abgelenkt wird, fällt auf die Schneide (dunkel), zur anderen
      // daran vorbei (hell); unabgelenkt: halb (grau)
      f = vec3(clamp(0.5 + dot(d, vec2(cos(messerWinkel), sin(messerWinkel))), 0.0, 1.0));
    } else if (schlierenArt < 1.5) {
      // farbig (Settles): statt der Schneide ein Farbkreis; die Richtung der Ablenkung wählt die Farbe
      float h = atan(d.y, d.x) / 6.2831853 + 0.5;
      vec3 bunt = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      f = mix(vec3(0.5), bunt, clamp(length(d) * 2.0, 0.0, 1.0));
    } else {
      // Dunkelfeld: unabgelenktes Licht wird ganz abgeblendet, nur abgelenktes kommt durch
      f = vec3(clamp(length(d), 0.0, 1.0));
    }
    farbe = vec4(f, 1.0);
    return;
  } else if (art == 2) {
    // Graustufen im Fenster, wie an der Befundkonsole
    f = vec3(clamp((maxi - fenster.x) / (fenster.y - fenster.x), 0.0, 1.0));
  } else {
    float hell = exp(-summe * dichte * 3.0);
    f = vec3(1.0 - hell); // wie ein Röntgenfilm: Knochen hell, Luft dunkel
  }
  farbe = vec4(pow(f, vec3(1.0 / 1.8)), 1.0);
}`;

// Float32 → halbe Gleitkommazahl (16 Bit), für R16F
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function halb(x) {
  f32[0] = x;
  const b = u32[0];
  const vorz = (b >>> 16) & 0x8000;
  let e = ((b >>> 23) & 0xff) - 127 + 15;
  let m = b & 0x7fffff;
  if (e <= 0) return vorz; // zu klein: 0
  if (e >= 31) return vorz | 0x7bff; // zu groß: größte Zahl
  // runden auf 10 Bit Mantisse
  m += 0x1000;
  if (m & 0x800000) {
    m = 0;
    e++;
    if (e >= 31) return vorz | 0x7bff;
  }
  return vorz | (e << 10) | (m >>> 13);
}

export function erstelleVolumen(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  const p = gl.createProgram();
  for (const [typ, text] of [[gl.VERTEX_SHADER, VOLL], [gl.FRAGMENT_SHADER, STRAHL]]) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, "lage");
  gl.linkProgram(p);
  const ort = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    ort[name] = gl.getUniformLocation(p, name);
  }
  const puffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  let volT = gl.createTexture();
  const tfT = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tfT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  let v = null;
  // Maske: am Anfang eine einzige sichtbare Zelle (bis setzeMaske eine echte bringt)
  let maskeT = null;
  let maskeForm = "";
  function setzeMaske(m) {
    const form = `${m.b}x${m.h}x${m.t}`;
    if (form !== maskeForm) {
      gl.deleteTexture(maskeT);
      maskeT = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, maskeT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, m.b, m.h, m.t);
      maskeForm = form;
    }
    gl.bindTexture(gl.TEXTURE_3D, maskeT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, m.b, m.h, m.t, gl.RED, gl.UNSIGNED_BYTE, m.daten);
    m.geaendert = false;
  }

  // Segmente: eine Zelle Nummer 0 am Anfang (bis setzeSegmente echte bringt)
  let segT = null;
  let segForm = "";
  const segFarben = new Float32Array(16 * 4);
  let segGroesse = [1, 1, 1];
  let weichT = null;
  // sg: Segmente, weich: die weiche Maske (segmente.js: weicheMaske), gleiche Größe
  function setzeSegmente(sg, weich = null) {
    const form = `${sg.b}x${sg.h}x${sg.t}`;
    if (form !== segForm) {
      gl.deleteTexture(segT);
      segT = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, segT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8UI, sg.b, sg.h, sg.t);
      gl.deleteTexture(weichT);
      weichT = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, weichT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, sg.b, sg.h, sg.t);
      segForm = form;
      segGroesse = [sg.b, sg.h, sg.t];
    }
    gl.bindTexture(gl.TEXTURE_3D, weichT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, sg.b, sg.h, sg.t, gl.RED, gl.UNSIGNED_BYTE, weich ?? new Uint8Array(sg.b * sg.h * sg.t));
    gl.bindTexture(gl.TEXTURE_3D, segT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, sg.b, sg.h, sg.t, gl.RED_INTEGER, gl.UNSIGNED_BYTE, sg.daten);
    sg.geaendert = false;
    setzeSegmentFarben(sg);
  }
  // nur Farben und Sichtbarkeit (ohne die Zellen neu hochzuladen)
  function setzeSegmentFarben(sg) {
    segFarben.fill(0);
    sg.liste.forEach((s, i) => {
      if (i + 1 > 15) return;
      segFarben.set([...s.farbe.map((x) => x / 255), s.sichtbar ? s.deckkraft : 0], (i + 1) * 4);
    });
  }
  setzeSegmente({ b: 1, h: 1, t: 1, daten: new Uint8Array(1), liste: [] });

  // v: von laden.js; die Werte in Stücken umwandeln, damit nicht noch einmal das ganze Volumen als Kopie entsteht
  let fremd = false; // volT gehört der Simulation (sim3d.js): nicht löschen
  function setze(vol) {
    v = vol;
    // texStorage3D legt die Größe fest und lässt sich nicht noch einmal aufrufen: für jedes Volumen eine neue Textur
    if (!fremd) gl.deleteTexture(volT);
    fremd = false;
    volT = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, volT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F, vol.b, vol.h, vol.t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const schicht = vol.b * vol.h;
    const halbe = new Uint16Array(schicht);
    for (let z = 0; z < vol.t; z++) {
      for (let i = 0; i < schicht; i++) halbe[i] = halb(vol.werte[z * schicht + i]);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z, vol.b, vol.h, 1, gl.RED, gl.HALF_FLOAT, halbe);
    }
  }

  // farben: Uint8Array n · 4 (RGBA), n Einträge (tf.js: TF_GROESSE)
  function setzeTf(farben) {
    gl.bindTexture(gl.TEXTURE_2D, tfT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, farben.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, farben);
  }

  // a: { fenster, art, schwelle, dichte, schritt, licht, grund, oberFarbe, dreh, lage (je 9 Zahlen), abstand, boxVon, boxBis }
  function zeige(a) {
    if (!v || !maskeT) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volT);
    gl.uniform1i(ort.vol, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tfT);
    gl.uniform1i(ort.tf, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, maskeT);
    gl.uniform1i(ort.maske, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_3D, segT);
    gl.uniform1i(ort.segTex, 3);
    gl.uniform3iv(ort.segGroesse, segGroesse);
    gl.uniform4fv(ort["segFarbe[0]"], segFarben);
    gl.uniform1i(ort.segAnzeige, a.segAnzeige ?? 0);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_3D, weichT);
    gl.uniform1i(ort.segWeich, 4);
    gl.uniform1f(ort.segTint, a.segTint ?? 0.6);
    gl.uniform1f(ort.leer, v.ct ? -1024 : v.min);
    gl.uniformMatrix3fv(ort.lage, false, a.lage);
    // Ausdehnung: Voxel mal Voxelgröße, größte Seite 1
    const echt = [v.b * v.abstand[0], v.h * v.abstand[1], v.t * v.abstand[2]];
    const m = Math.max(...echt);
    gl.uniform3fv(ort.groesse, echt.map((x) => x / m));
    gl.uniform3f(ort.voxel, v.b, v.h, v.t);
    gl.uniform2fv(ort.fenster, a.fenster);
    gl.uniform3fv(ort.boxVon, a.boxVon);
    gl.uniform3fv(ort.boxBis, a.boxBis);
    gl.uniformMatrix3fv(ort.dreh, false, a.dreh);
    gl.uniform1f(ort.abstand, a.abstand);
    gl.uniform2fv(ort.versatz, a.versatz ?? [0, 0]);
    gl.uniform1f(ort.seite, canvas.width / canvas.height);
    gl.uniform1i(ort.art, a.art);
    gl.uniform1f(ort.schwelle, a.schwelle);
    gl.uniform1f(ort.dichte, a.dichte);
    gl.uniform1f(ort.schritt, a.schritt);
    gl.uniform1f(ort.licht, a.licht);
    gl.uniform1f(ort.schlierenArt, a.schlierenArt ?? 0);
    gl.uniform1f(ort.schlierenStaerke, a.schlierenStaerke ?? 1);
    gl.uniform1f(ort.messerWinkel, ((a.messerWinkel ?? 0) * Math.PI) / 180);
    gl.uniform3fv(ort.grund, a.grund);
    gl.uniform3fv(ort.oberFarbe, a.oberFarbe);
    gl.uniform1i(ort.ct, v.ct ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // eine 3D-Textur, die schon auf der Grafikkarte liegt (die Simulation), statt Werten von der CPU; Wert in .r
  function setzeFremd(textur, vol) {
    if (!fremd) gl.deleteTexture(volT);
    fremd = true;
    volT = textur;
    v = vol;
  }

  return { gl, setze, setzeFremd, setzeTf, setzeMaske, setzeSegmente, setzeSegmentFarben, zeige };
}


