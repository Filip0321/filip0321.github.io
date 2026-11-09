// Strömung in 3D auf der Grafikkarte (WebGL2), für Rayleigh-Taylor (/projekte/rayleigh-taylor): dieselbe Rechnung wie die 2D-Strömung
// (Stable Fluids, Stam 1999; siehe /projekte/stroemung/js/fluid.js), nur mit 3D-Texturen. Gezeigt wird das Ergebnis
// mit genau der Darstellung der CT-Daten.
//
// Was hier fließt (Boussinesq-Näherung: die Dichte ändert fast nichts außer dem Gewicht):
//   r = „schwerer Stoff“ (sichtbar): schwere Flüssigkeit, Milch, Tinte
//   g = Salz (unsichtbar): macht das Wasser unten schwerer
// Jeder Stoff zieht nach unten: Kraft f_y = −(Auftrieb · r + Salz · g). Ein überall gleicher Zug wäre ein
// Druckgefälle und würde von der Projektion einfach weggenommen: es zählt nur, was schwerer ist als daneben.
//
// Drei Versuche:
//   Rayleigh-Taylor  schwer liegt über leicht, die Grenze ist leicht gewellt. Jede Welle wächst (je kürzer, desto
//                    schneller, mit √(A · g · k)), das Schwere fällt in Fingern und Pilzen hinein, das Leichte steigt
//                    in Blasen auf. Dieselbe Instabilität formt Supernova-Reste und die Krebsnebel-Fäden.
//   Wolkentank       wie im Film vor dem Computer (Douglas Trumbull für „Unheimliche Begegnung der dritten Art“,
//                    1977): ein Tank, unten Salzwasser, darüber Süßwasser. Von oben fließt Milch (oder weiße Farbe)
//                    hinein. Sie ist schwerer als Süßwasser und sinkt, aber leichter als Salzwasser: an der Grenze
//                    bleibt sie liegen, breitet sich flach aus und quillt in Wolkenbänken, auf dem Kopf gefilmt sehen
//                    sie aus wie Gewitterwolken am Himmel.
//   Tropfen Tinte    ein Tropfen fällt ins Wasser, rollt sich zu einem Wirbelring ein, der Ring wird instabil und
//                    zerfällt in kleinere Ringe (Thomson und Newall 1885).
//
// 3D-Texturen kann man in WebGL2 nur Schicht für Schicht beschreiben: für jeden Rechenschritt wird jede Schicht
// einmal gemalt (framebufferTextureLayer). Bei 64³ und 20 Druck-Schritten sind das etwa 1600 kleine Malvorgänge
// pro Zeitschritt, für eine Grafikkarte wenig.

const VOLL = `#version 300 es
in vec2 lage;
void main() { gl_Position = vec4(lage, 0.0, 1.0); }`;

const KOPF = `#version 300 es
precision highp float;
precision highp sampler3D;
out vec4 farbe;
uniform float z;      // Schicht, die gerade gemalt wird
uniform vec3 n;       // Zellen je Achse
vec3 zelle() { return vec3(gl_FragCoord.xy, z + 0.5); }   // Mitte der Zelle, in Zellen
vec3 tex(vec3 c) { return c / n; }                        // … als Texturkoordinate
ivec3 iz(vec3 c) { return clamp(ivec3(floor(c)), ivec3(0), ivec3(n) - 1); } // ganze Zelle (am Rand festgehalten)
`;

// Mitnehmen (semi-Lagrange): woher kam der Inhalt dieser Zelle?
const ADVEKTION = `${KOPF}
uniform sampler3D geschw, quelle;
uniform float dt, verlust;
void main() {
  vec3 c = zelle();
  vec3 v = texture(geschw, tex(c)).xyz;
  farbe = texture(quelle, tex(c - dt * v)) * verlust;
}`;

// MacCormack (Selle und andere 2008): die einfache Mitnahme verwischt mit jedem Schritt. Darum einmal vorwärts
// mitnehmen, das Ergebnis wieder rückwärts, und der Unterschied zum Anfang ist der Fehler, den die Mitnahme macht:
// die Hälfte davon wird wieder dazugezählt. Damit dabei keine neuen Spitzen entstehen, wird das Ergebnis auf das
// begrenzt, was an der Herkunftsstelle in den acht Nachbarzellen stand. So bleiben Ränder viel länger scharf.
const KORREKTUR = `${KOPF}
uniform sampler3D geschw, alt, vor, zurueck;
uniform float dt;
void main() {
  vec3 c = zelle();
  vec4 r = texelFetch(vor, iz(c), 0) + 0.5 * (texelFetch(alt, iz(c), 0) - texelFetch(zurueck, iz(c), 0));
  vec3 p = c - dt * texture(geschw, tex(c)).xyz - 0.5;
  ivec3 b = ivec3(floor(p));
  vec4 lo = vec4(1e9), hi = vec4(-1e9);
  for (int i = 0; i < 8; i++) {
    vec4 w = texelFetch(alt, clamp(b + ivec3(i & 1, (i >> 1) & 1, (i >> 2) & 1), ivec3(0), ivec3(n) - 1), 0);
    lo = min(lo, w);
    hi = max(hi, w);
  }
  farbe = clamp(r, lo, hi);
}`;

// Kräfte: Gewicht der Stoffe, Strahl aus der Düse, ein wenig Unruhe (sonst bleibt eine ganz glatte Grenze glatt)
const KRAFT = `${KOPF}
uniform sampler3D geschw, stoff;
uniform float dt, auftrieb, salz, duese, strahl, zeit;
uniform vec3 dueseOrt;
void main() {
  vec3 c = zelle();
  vec4 v = texture(geschw, tex(c));
  vec4 s = texture(stoff, tex(c));
  v.y -= dt * (auftrieb * s.r + salz * s.g);
  float d = length(c - dueseOrt);
  v.y -= dt * strahl * duese * exp(-d * d / 6.0);
  farbe = v;
}`;

// Zufluss: Milch an der Düse
const ZUFLUSS = `${KOPF}
uniform sampler3D stoff;
uniform float dt, duese;
uniform vec3 dueseOrt;
void main() {
  vec3 c = zelle();
  vec4 s = texture(stoff, tex(c));
  float d = length(c - dueseOrt);
  s.r = min(1.0, s.r + dt * duese * 3.0 * exp(-d * d / 4.0));
  farbe = s;
}`;

// Divergenz: fließt mehr hinein als hinaus? (Wände: was dahinter läge, ist die gespiegelte eigene Geschwindigkeit)
const DIVERGENZ = `${KOPF}
uniform sampler3D geschw;
vec3 bei(vec3 c, vec3 o) {
  vec3 q = c + o;
  vec3 v = texelFetch(geschw, iz(q), 0).xyz;
  if (any(lessThan(q, vec3(0.0))) || any(greaterThanEqual(q, n))) v = -texelFetch(geschw, iz(c), 0).xyz;
  return v;
}
void main() {
  vec3 c = zelle();
  float d = bei(c, vec3(1, 0, 0)).x - bei(c, vec3(-1, 0, 0)).x
          + bei(c, vec3(0, 1, 0)).y - bei(c, vec3(0, -1, 0)).y
          + bei(c, vec3(0, 0, 1)).z - bei(c, vec3(0, 0, -1)).z;
  farbe = vec4(0.5 * d, 0.0, 0.0, 1.0);
}`;

// Druck (Jacobi): ∇²p = div; am Rand wie die eigene Zelle (kein Druckgefälle durch die Wand)
const JACOBI = `${KOPF}
uniform sampler3D druck, div;
float p(vec3 c) { return texelFetch(druck, iz(c), 0).r; }
void main() {
  vec3 c = zelle();
  float s = p(c + vec3(1, 0, 0)) + p(c - vec3(1, 0, 0)) + p(c + vec3(0, 1, 0)) + p(c - vec3(0, 1, 0)) + p(c + vec3(0, 0, 1)) + p(c - vec3(0, 0, 1));
  farbe = vec4((s - texelFetch(div, iz(c), 0).r) / 6.0, 0.0, 0.0, 1.0);
}`;

// Druckgefälle abziehen; an den Wänden die Geschwindigkeit durch die Wand auf 0
const GEFAELLE = `${KOPF}
uniform sampler3D druck, geschw;
float p(vec3 c) { return texelFetch(druck, iz(c), 0).r; }
void main() {
  vec3 c = zelle();
  vec3 g = 0.5 * vec3(p(c + vec3(1, 0, 0)) - p(c - vec3(1, 0, 0)), p(c + vec3(0, 1, 0)) - p(c - vec3(0, 1, 0)), p(c + vec3(0, 0, 1)) - p(c - vec3(0, 0, 1)));
  vec3 v = texelFetch(geschw, iz(c), 0).xyz - g;
  if (c.x < 1.0 || c.x > n.x - 1.0) v.x = 0.0;
  if (c.y < 1.0 || c.y > n.y - 1.0) v.y = 0.0;
  if (c.z < 1.0 || c.z > n.z - 1.0) v.z = 0.0;
  farbe = vec4(v, 0.0);
}`;

// Anfang: art 0 Rayleigh-Taylor, 1 Wolkentank, 2 Tropfen; unruhe: wie stark die Grenze gewellt ist
const START = `${KOPF}
uniform float art, unruhe, schicht, saat;
float zufall(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + saat) * 43758.5453); }
void main() {
  vec3 c = zelle();
  vec3 q = c / n;
  if (art < 0.5) {
    // Grenze in halber Höhe, gewellt aus mehreren zufälligen Wellen und etwas Rauschen pro Zelle
    float h = 0.5;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 k = vec2(zufall(vec3(fi, 1.0, 0.0)), zufall(vec3(fi, 2.0, 0.0))) * 6.0 + 1.0;
      h += unruhe * 0.02 / (1.0 + fi * 0.5) * sin(k.x * 6.2832 * q.x + zufall(vec3(fi, 3.0, 0.0)) * 6.2832) * sin(k.y * 6.2832 * q.z + zufall(vec3(fi, 4.0, 0.0)) * 6.2832);
    }
    h += unruhe * 0.004 * (zufall(vec3(floor(c.xz), 9.0)) - 0.5);
    farbe = vec4(smoothstep(-0.8, 0.8, c.y - h * n.y), 0.0, 0.0, 0.0);
  } else if (art < 1.5) {
    farbe = vec4(0.0, smoothstep(1.5, -1.5, c.y - schicht * n.y), 0.0, 0.0);
  } else {
    float d = length((q - vec3(0.5, 0.82, 0.5)) * n) - n.y * 0.07;
    farbe = vec4(smoothstep(1.0, -1.0, d), 0.0, 0.0, 0.0);
  }
}`;

export function erstelleSimulation(gl) {
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Diese Grafikkarte kann nicht in Float-Texturen rechnen.");
  function programm(quelle) {
    const p = gl.createProgram();
    for (const [typ, text] of [[gl.VERTEX_SHADER, VOLL], [gl.FRAGMENT_SHADER, quelle]]) {
      const s = gl.createShader(typ);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "lage");
    gl.linkProgram(p);
    const orte = {};
    const k = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < k; i++) orte[gl.getActiveUniform(p, i).name] = gl.getUniformLocation(p, gl.getActiveUniform(p, i).name);
    return { p, orte };
  }
  const P = {
    advektion: programm(ADVEKTION), kraft: programm(KRAFT), zufluss: programm(ZUFLUSS), divergenz: programm(DIVERGENZ),
    jacobi: programm(JACOBI), gefaelle: programm(GEFAELLE), start: programm(START), korrektur: programm(KORREKTUR),
  };
  const viereck = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, viereck);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const fb = gl.createFramebuffer();

  let n = [64, 64, 64];
  let geschw, stoff, druck, div;
  let zeit = 0;
  let art = 0;

  function textur3d() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA16F, n[0], n[1], n[2]);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    return t;
  }
  // ein Durchgang: in jede Schicht von „nach“ malen
  function lauf(prog, nach, texturen, zahlen = {}) {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, n[0], n[1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, viereck);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    let einheit = 0;
    for (const [name, t] of Object.entries(texturen)) {
      gl.activeTexture(gl.TEXTURE0 + einheit);
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.uniform1i(prog.orte[name], einheit++);
    }
    const o = prog.orte;
    gl.uniform3f(o.n, ...n);
    for (const [name, w] of Object.entries(zahlen)) {
      if (!o[name]) continue;
      if (Array.isArray(w)) gl.uniform3f(o[name], ...w);
      else gl.uniform1f(o[name], w);
    }
    for (let z = 0; z < n[2]; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, nach, 0, z);
      gl.uniform1f(o.z, z);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // neu anfangen: groesse [b, h, t] Zellen, a: 0 Rayleigh-Taylor, 1 Wolkentank, 2 Tropfen
  function neu(groesse, a, e) {
    for (const t of [...(geschw ?? []), ...(stoff ?? []), ...(druck ?? []), div]) if (t) gl.deleteTexture(t);
    n = groesse;
    art = a;
    zeit = 0;
    geschw = [textur3d(), textur3d()];
    stoff = [textur3d(), textur3d(), textur3d(), textur3d()]; // aktuell, vorwärts, zurück, korrigiert
    druck = [textur3d(), textur3d()];
    div = textur3d();
    // alles auf 0 (texStorage3D lässt den Inhalt offen)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.clearColor(0, 0, 0, 0);
    for (const t of [...geschw, ...stoff, ...druck, div]) {
      for (let z = 0; z < n[2]; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    lauf(P.start, stoff[0], {}, { art: a, unruhe: e.unruhe, schicht: e.schicht, saat: e.saat ?? 1 });
  }

  // ein Zeitschritt; e: { auftrieb, salz, duese, strahl, jacobi }
  function schritt(dt, e) {
    zeit += dt;
    const dueseOrt = [n[0] / 2, n[1] - 3, n[2] / 2];
    const duese = art === 1 ? e.duese : 0;
    lauf(P.advektion, geschw[1], { geschw: geschw[0], quelle: geschw[0] }, { dt, verlust: 0.999 });
    lauf(P.kraft, geschw[0], { geschw: geschw[1], stoff: stoff[0] }, { dt, auftrieb: e.auftrieb, salz: e.salz, duese, strahl: e.strahl, dueseOrt, zeit });
    lauf(P.divergenz, div, { geschw: geschw[0] });
    let d = 0;
    for (let i = 0; i < e.jacobi; i++) {
      lauf(P.jacobi, druck[1 - d], { druck: druck[d], div });
      d = 1 - d;
    }
    lauf(P.gefaelle, geschw[1], { druck: druck[d], geschw: geschw[0] });
    if (d === 1) druck.reverse();
    geschw.reverse(); // die neue Geschwindigkeit liegt jetzt in geschw[0]
    lauf(P.advektion, stoff[1], { geschw: geschw[0], quelle: stoff[0] }, { dt, verlust: 1 });
    lauf(P.advektion, stoff[2], { geschw: geschw[0], quelle: stoff[1] }, { dt: -dt, verlust: 1 });
    lauf(P.korrektur, stoff[3], { geschw: geschw[0], alt: stoff[0], vor: stoff[1], zurueck: stoff[2] }, { dt });
    stoff.unshift(stoff.pop()); // das korrigierte nach vorn
    if (duese > 0) {
      lauf(P.zufluss, stoff[1], { stoff: stoff[0] }, { dt, duese, dueseOrt });
      [stoff[0], stoff[1]] = [stoff[1], stoff[0]];
    }
  }

  // die sichtbare Menge (r) auf die CPU holen, Schicht für Schicht (für die Schnitte und das Ausschneiden)
  function lies(ziel) {
    const schicht = new Float32Array(n[0] * n[1] * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    for (let z = 0; z < n[2]; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, stoff[0], 0, z);
      gl.readPixels(0, 0, n[0], n[1], gl.RGBA, gl.FLOAT, schicht);
      const o = z * n[0] * n[1];
      for (let i = 0; i < n[0] * n[1]; i++) ziel[o + i] = schicht[i * 4];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return { neu, schritt, lies, textur: () => stoff[0], groesse: () => n };
}
