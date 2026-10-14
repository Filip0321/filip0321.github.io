// Zeichnet eine Punktliste mit WebGL2.

const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 punkt; // ein Punkt aus der Liste, für jeden Punkt einmal

uniform vec2 mitte; // welcher Punkt in der Bildmitte liegt
uniform float zoom; // Pixel pro Einheit
uniform vec2 aufloesung; // Größe des Canvas

uniform float anzahl; // wie viele Punkte es insgesamt gibt
out float fortschritt; // 0 beim ersten Punkt, 1 beim letzten

void main() {
  vec2 pixel = (punkt - mitte) * zoom; // Abstand zur Mitte
  vec2 clip = pixel / (aufloesung * 0.5); // auf -1 bis 1 umrechnen
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); // y umdrehen: im Canvas zeigt y nach unten
  gl_PointSize = 1.0;

  fortschritt = float(gl_VertexID) / anzahl;
}`;

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in float fortschritt;
uniform float invertiert; // 1.0 = weißer Grund, die Punkte dunkeln ihn ab
uniform float farbig; // 1.0 = farbig, 0.0 = grau
uniform float blue;
uniform float red;

uniform float staerke; // wie viel Helligkeit ein Punkt hinzufügt, 0 bis 1
out vec4 farbe;

void main() {
  vec3 anfang = vec3(0.0, 0.0, blue); // blau
  vec3 ende = vec3(red, 0.0, 0.0); // rot
  vec3 grundfarbe;
  if (farbig > 0.5) {
    // fortschritt entscheidet die Farbe (früher Punkt blau, später rot)
    grundfarbe = mix(anfang, ende, fortschritt);
    // invertiert wird vom Weiß abgezogen (siehe blendEquation in zeichne):
    // zieht man die Gegenfarbe ab, bleibt die Farbe selbst übrig
    // Weiß (1, 1, 1) minus Gegenfarbe von Blau (1, 1, 0) = Blau (0, 0, 1)
    if (invertiert > 0.5) grundfarbe = vec3(1.0) - grundfarbe;
  } else {
    // grau: alle 3 Kanäle gleich
    grundfarbe = vec3(1.0);
  }
  // wendet auf die ersten 3 werte die Helligkeit an
  // staerke wie hell (invertiert: wie dunkel) ein Punkt macht
  farbe = vec4(grundfarbe * staerke, 1.0);
}`;

/*
  Punktliste
      │
      ▼
Vertex-Shader      einmal pro Punkt: Wo liegt er auf dem Bildschirm?
      │
      ▼
Rasterisierung     die Grafikkarte macht aus jedem Punkt Pixel
      │
      ▼
Fragment-Shader    einmal pro Pixel: Welche Farbe hat er?
      │
      ▼
    Bild
*/

function baueShader(gl, typ, quelltext) {
  const shader = gl.createShader(typ);
  // erstellt erstmal einen shader, also VERTEX_SHADER oder FRAGMENT_SHADER
  // an die wird dann der Text von meinen übergeben (quelltext)
  gl.shaderSource(shader, quelltext);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function baueProgramm(gl) {
  const programm = gl.createProgram();
  // gl.VERTEX_SHADER ist nur die Art (eine Nummer von WebGL),
  // VERTEX_SHADER (ohne gl.) ist mein Quelltext von oben
  gl.attachShader(programm, baueShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(programm, baueShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(programm);
  if (!gl.getProgramParameter(programm, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(programm));
  }
  return programm;
}

export function erstelleShader(canvas) {
  // preserveDrawingBuffer: das Bild bleibt nach dem Zeichnen stehen,
  // sonst können "Bild speichern", Video-Export und die Effekt-Schicht
  // es später nicht mehr auslesen (sie sehen dann nur Schwarz)
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, alpha: false });
  if (!gl) throw new Error("Dein Browser unterstützt kein WebGL2.");

  const programm = baueProgramm(gl);
  const puffer = gl.createBuffer();
  const ort = gl.getAttribLocation(programm, "punkt");
  let anzahl = 0;

  // Orte der Uniforms einmal nachschlagen, nicht bei jedem Bild
  const uniform = {};
  for (const name of ["mitte", "zoom", "aufloesung", "staerke", "anzahl", "invertiert", "farbig", "red", "blue"]) {
    uniform[name] = gl.getUniformLocation(programm, name);
  }

  // Punkte einmal zur Grafikkarte schicken
  function ladePunkte(daten) {
    // durch 2 teilen, damit man weiß wieviele einzelne Punkte (alle x und y)
    anzahl = daten ? daten.length / 2 : 0;
    if (!daten) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.bufferData(gl.ARRAY_BUFFER, daten, gl.STATIC_DRAW);
  }

  // Ein Bild zeichnen, so oft man will, ohne neu zu rechnen
  // sichtbar: wie viele Punkte gezeichnet werden (zum Entstehen lassen), ohne Angabe alle
  function zeichne({ mitteX, mitteY, zoom, staerke, invertiert, farbig, red, blue, sichtbar = anzahl }) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Hintergrund: das Grau der Seite (#111111) oder invertiert Weiß (clearColor will 0 bis 1)
    const grund = invertiert ? 1 : 17 / 255;
    gl.clearColor(grund, grund, grund, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (anzahl === 0) return;

    gl.useProgram(programm);
    // einfach wieviele uniform floats 1f oder 2f und ihren Namen die Werte geben
    // dadurch können die daten aus der javascript datei weitergegeben werden
    gl.uniform2f(uniform.mitte, mitteX, mitteY);
    gl.uniform1f(uniform.zoom, zoom);
    gl.uniform2f(uniform.aufloesung, canvas.width, canvas.height);
    gl.uniform1f(uniform.staerke, staerke / 255);
    gl.uniform1f(uniform.anzahl, anzahl); // alle Punkte, damit die Farben beim Entstehen nicht wandern
    gl.uniform1f(uniform.invertiert, invertiert ? 1 : 0);
    gl.uniform1f(uniform.farbig, farbig ? 1 : 0);
    gl.uniform1f(uniform.red, red);
    gl.uniform1f(uniform.blue, blue);

    // Helligkeit addieren statt übermalen: Ergebnis = Ziel + Punkt
    // invertiert abziehen: Ergebnis = Ziel - Punkt, jeder Punkt dunkelt das Weiß ein Stück ab
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(invertiert ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD);

    // Wie die Liste zu lesen ist: je 2 Kommazahlen pro Punkt
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.enableVertexAttribArray(ort);
    gl.vertexAttribPointer(ort, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, Math.min(sichtbar, anzahl));
  }

  return { ladePunkte, zeichne };
}

