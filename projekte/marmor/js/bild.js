// Zeichnen auf der Grafikkarte: für jedes Pixel die Züge rückwärts (zuege.js), bis es in einem Tropfen liegt.
//
// Die Züge liegen in einer Float-Textur, je Zug zwei Pixel (8 Zahlen), höchstens MAX Züge. Der Shader geht sie vom
// letzten zum ersten durch und wendet jeweils die Umkehrung an:
//   Tropfen  liegt der Punkt im Kreis: Farbe gefunden. Sonst: p = c + (q − c) · √(1 − r² / |q − c|²)
//   Nadel, Kamm, Welle: dieselbe Verschiebung abziehen (der Abstand zur Geraden ändert sich dabei nicht)
//   Wirbel   um den negativen Winkel zurückdrehen
//   Stift    keine Formel: vier Schritte p = q − D(p) (zuege.js)
// Der letzte Zug kann halb fertig sein (teil < 1): so wächst ein Tropfen beim Abspielen, die Nadel zieht langsam.
//
// Was die Farbe lebendig macht: Pigment ist körnig (Rauschen in den Koordinaten des Tropfens: es wird mit verzogen
// und gestreckt wie die Farbe selbst), an den Rändern sammelt sich etwas mehr Pigment (dunkler Saum, „Ränder“),
// und das Papier hat Struktur.

const VOLL = `#version 300 es
in vec2 lage;
out vec2 uv;
void main() {
  uv = lage * 0.5 + 0.5;
  gl_Position = vec4(lage, 0.0, 1.0);
}`;

export const MAX = 2048;

const BILD = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 farbe;
uniform sampler2D zuege;  // ${MAX * 2} × 1, RGBA32F
uniform int anzahl;
uniform float teil;       // wie weit der letzte Zug ist (0 bis 1)
uniform vec2 groesse;     // Pixel
uniform vec3 wasser;      // Farbe dort, wo keine Farbe hinkam
uniform vec3 papier;
uniform float raender, koernung, struktur, glatt;

float zufall(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float wert(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(zufall(i), zufall(i + vec2(1, 0)), f.x), mix(zufall(i + vec2(0, 1)), zufall(i + vec2(1, 1)), f.x), f.y);
}

// q in Wasser-Koordinaten (y von 0 oben bis 1 unten); gibt die Farbe zurück
vec3 farbeBei(vec2 q) {
  // WebGL2 erlaubt Schleifen mit veränderlicher Grenze: nur so viele Durchläufe, wie es Züge gibt
  for (int i = anzahl - 1; i >= 0; i--) {
    vec4 a = texelFetch(zuege, ivec2(2 * i, 0), 0);
    vec4 b = texelFetch(zuege, ivec2(2 * i + 1, 0), 0);
    float s = i == anzahl - 1 ? teil : 1.0;
    int art = int(a.x + 0.5);
    if (art == 0) {
      // Tropfen: wächst beim Abspielen mit der Fläche (r · √teil)
      vec2 c = a.yz;
      float r = a.w * sqrt(s);
      vec2 d = q - c;
      float l2 = dot(d, d);
      if (l2 < r * r) {
        float l = sqrt(l2);
        vec3 f = b.rgb;
        // Körnung: Rauschen in den Koordinaten des Tropfens (wird später mit verzogen)
        f *= 1.0 + (wert(d / a.w * 18.0 + b.w * 91.0) - 0.5) * koernung;
        // Rand: etwas dunkler, schmal (in den Koordinaten des Tropfens: er wird mit gestreckt und gestaucht)
        f *= 1.0 - raender * 0.45 * (1.0 - smoothstep(0.0, 0.12, (r - l) / max(r, 1e-6)));
        return f;
      }
      q = c + d * sqrt(max(0.0, 1.0 - r * r / l2));
    } else if (art == 4) {
      vec2 c = a.yz;
      vec2 d = q - c;
      float l = length(d) / b.y;
      float th = -b.x * s * exp(-l * l);
      q = c + mat2(cos(th), sin(th), -sin(th), cos(th)) * d;
    } else if (art == 5) {
      // Stift: p' = p + D(p), umgekehrt p = q − D(p): von p = q aus ein paar Mal einsetzen
      vec2 M = vec2(cos(a.w), sin(a.w));
      vec2 p = q;
      for (int k = 0; k < 4; k++) {
        float w = b.y / (length(p - a.yz) + b.y);
        p = q - M * b.x * s * w * w;
      }
      q = p;
    } else {
      vec2 M = vec2(cos(a.w), sin(a.w));
      vec2 N = vec2(-M.y, M.x);
      float t = dot(q - a.yz, N);
      if (art == 1) {
        q -= M * b.x * s * b.y / (abs(t) + b.y);
      } else if (art == 2) {
        float d = abs(mod(t + 0.5 * b.z, b.z) - 0.5 * b.z);
        q -= M * b.x * s * b.y / (d + b.y);
      } else {
        q -= M * b.x * s * sin(6.2831853 * dot(q, N) / b.y + b.z);
      }
    }
  }
  return wasser;
}

void main() {
  vec2 px = uv * groesse;
  vec2 q0 = vec2(uv.x * groesse.x / groesse.y, 1.0 - uv.y);
  vec3 f;
  if (glatt > 0.5) {
    // Kantenglättung: vier Proben je Pixel (gedrehtes Gitter)
    vec2 e = 1.0 / groesse.y * vec2(1.0, -1.0);
    f = (farbeBei(q0 + vec2(0.125, 0.375) * e) + farbeBei(q0 + vec2(-0.375, 0.125) * e)
       + farbeBei(q0 + vec2(-0.125, -0.375) * e) + farbeBei(q0 + vec2(0.375, -0.125) * e)) * 0.25;
  } else f = farbeBei(q0);
  // aufs Papier abgezogen: Papierfarbe scheint ein wenig durch, Fasern
  float faser = (wert(px / 3.0) - 0.5) * 0.08 + (wert(px / 40.0) - 0.5) * 0.04;
  f = f * mix(vec3(1.0), papier, 0.15) * (1.0 + faser * struktur);
  farbe = vec4(clamp(f, 0.0, 1.0), 1.0);
}`;

export function erstelleBild(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
  const p = gl.createProgram();
  for (const [typ, text] of [[gl.VERTEX_SHADER, VOLL], [gl.FRAGMENT_SHADER, BILD]]) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const ort = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const n = gl.getActiveUniform(p, i).name;
    ort[n] = gl.getUniformLocation(p, n);
  }
  const puffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindAttribLocation(p, 0, "lage");

  const textur = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textur);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, MAX * 2, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const daten = new Float32Array(MAX * 8);
  let hochgeladen = -1;

  // zuege: Liste von Listen mit 8 Zahlen; version: wenn sie sich ändert, neu hochladen
  function zeige(zuege, version, a) {
    const n = Math.min(zuege.length, MAX);
    if (version !== hochgeladen) {
      for (let i = 0; i < n; i++) daten.set(zuege[i], i * 8);
      gl.bindTexture(gl.TEXTURE_2D, textur);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Math.max(1, n * 2), 1, gl.RGBA, gl.FLOAT, daten.subarray(0, Math.max(1, n * 2) * 4));
      hochgeladen = version;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textur);
    gl.uniform1i(ort.zuege, 0);
    gl.uniform1i(ort.anzahl, n);
    gl.uniform1f(ort.teil, a.teil ?? 1);
    gl.uniform2f(ort.groesse, canvas.width, canvas.height);
    gl.uniform3fv(ort.wasser, a.wasser);
    gl.uniform3fv(ort.papier, a.papier);
    gl.uniform1f(ort.raender, a.raender);
    gl.uniform1f(ort.koernung, a.koernung);
    gl.uniform1f(ort.struktur, a.struktur);
    gl.uniform1f(ort.glatt, a.glatt ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  return { zeige };
}
