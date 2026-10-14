const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec3 punkt; // welcher Punkt wird bearbeitet (3 dimensionen)

uniform vec3 mitte; // mitte des Attraktors (nach vermessen)
uniform float mass; // größte Ausdehnung des Attraktors (aus vermessen)
uniform float winkel; // Drehung um senkrechte (um y-Achse -> x und z drehen)
uniform float neigung; // Drehung um waagerechte (um x-Achse -> y und z drehen)
uniform float abstand; // wie weit die Kamera weg ist (zoomen = Kamerafahrt)
uniform float brennweite;
uniform vec2 aufloesung;
uniform vec2 versatz;

uniform float kopf;
uniform float laenge;
uniform float rest; // wie hell der Attraktor außerhalb des Kometen bleibt
uniform float glanz;
out float leuchten;

uniform float anzahl;
out float fortschritt; // ist 0 für den ersten und 1 für den letzten Punkt
// muss nicht aber will irgendwas rausgeben
// gerade noch placeholder für coolere effekte

void main() {
  vec3 p = ((punkt - mitte) / mass * 2.0); 
  // was ist der Abstand des Punktes zur Mitte und
  // verhältnis des punktes Abstand zur mitte zur länge (größte Ausdehnung) des Attraktors
  // 0 bis 1: positiver Abstand zur Mitte
  // 0 bis -1: negativer Abstand zur Mitte

  // Drehen
  // ------
  // x' = x * cos(w) - y * sin(w)
  // y' = x * sin(w) + y * cos(w)
  // 
  // w ist Winkel und sonst einfach die Formel des Einheitskreises

  // um die y-Achse (winkel)
  float c = cos(winkel); 
  float s = sin(winkel);
  float drehenYX = p.x * c - p.z * s;
  float drehenYZ = p.x * s + p.z * c;
  p.x = drehenYX;
  p.z = drehenYZ;

  // um die x-Achse (neigung)
  c = cos(neigung); 
  s = sin(neigung);
  float drehenXY = p.y * c - p.z * s;
  float drehenXZ = p.y * s + p.z * c;
  p.y = drehenXY;
  p.z = drehenXZ;

  // Perspektive: die Grafikkarte teilt selbst durch den 4. Wert
  float tiefe = p.z + abstand;
  gl_Position = vec4(
    // entweder x mal Verhältnis Bilddimension y zu x (wenn es sich nach der hoehe richten soll)
    // oder y mal Verhältnis Bilddimension x zu y --> damit es quadratisch wird
    p.x * brennweite * (aufloesung.y / aufloesung.x), 
    p.y * brennweite, 
    0.0, 
    tiefe
  );
  // gl_Position teilt selber durch die letzte Zahl
  // Perspektive ist wie bei einer Kamera - Kegelförmige Ausdehnung vom Sensor aus
  // --> je weiter weg oder größer die tiefe, desto näher sind die Punkte zusammen
  // wie bei der Lochkamera: Bild = Gegenstand · (Loch bis Papier) / (Loch bis Gegenstand)
  // brennweite = Loch bis Papier, tiefe = Loch bis Punkt
  gl_Position.xy += versatz * tiefe; 
  // nach dem Teilen durch tiefe bleibt genau versatz übrig
  gl_PointSize = 1.0;

  fortschritt = float(gl_VertexID) / anzahl;
  float hinter = mod(kopf - float(gl_VertexID), anzahl);
  if (hinter < laenge) {
    leuchten = (1.0 - hinter / laenge) * glanz; 
  } else {
    leuchten = rest;
  }
}`

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in float leuchten;
uniform float travel;
uniform float invertiert; // 1.0 = weißer Grund, die Punkte dunkeln ihn ab

in float fortschritt;
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
    
    if (invertiert > 0.5) {
      grundfarbe = vec3(1.0) - grundfarbe;
    }
  } else {
    // grau: alle 3 Kanäle gleich
    grundfarbe = vec3(1.0);
  }
  // wendet auf die ersten 3 werte die Helligkeit an
  // staerke wie hell (invertiert: wie dunkel) ein Punkt macht
  farbe = vec4(grundfarbe * staerke, 1.0);
  if (travel > 0.5) farbe.rgb *= leuchten;
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
  for (const name of ["mitte", "mass", "winkel", "neigung", 
                      "abstand", "brennweite", "aufloesung", 
                      "anzahl", "travel", "kopf", "laenge", "rest", "glanz", "versatz",
                      "invertiert", "farbig", "red", "blue", "staerke"]) {
    uniform[name] = gl.getUniformLocation(programm, name);
  }

  // Punkte einmal zur Grafikkarte schicken
  function ladePunkte(daten) {
    // durch 3 teilen, damit man weiß wieviele einzelne Punkte (alle x, y und z)
    anzahl = daten ? daten.length / 3 : 0;
    if (!daten) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.bufferData(gl.ARRAY_BUFFER, daten, gl.STATIC_DRAW);
  }

  // Ein Bild zeichnen, so oft man will, ohne neu zu rechnen
  // sichtbar: wie viele Punkte gezeichnet werden (zum Entstehen lassen), ohne Angabe alle
  function zeichne({ mitteX, mitteY, mitteZ, mass, 
                     winkel, neigung, abstand, brennweite, staerke, 
                     travel, laenge, kopf, rest, glanz, versatz,
                     invertiert, farbig, red, blue, sichtbar = anzahl }) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Hintergrund: das Grau der Seite (#111111) oder invertiert Weiß
    // clearColor will Werte von 0 bis 1, nicht 0 bis 255 (255 wird einfach auf 1 abgeschnitten)
    const grund = invertiert ? 1 : 17 / 255;
    gl.clearColor(grund, grund, grund, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (anzahl === 0) return;

    gl.useProgram(programm);
    // einfach wieviele uniform floats 1f, 2f oder 3f und ihren Namen die Werte geben
    // dadurch können die daten aus der javascript datei weitergegeben werden
    gl.uniform3f(uniform.mitte, mitteX, mitteY, mitteZ);
    gl.uniform1f(uniform.mass, mass);
    gl.uniform1f(uniform.winkel, winkel);
    gl.uniform1f(uniform.neigung, neigung);
    gl.uniform1f(uniform.abstand, abstand);
    gl.uniform1f(uniform.brennweite, brennweite);
    gl.uniform2f(uniform.aufloesung, canvas.width, canvas.height);
    gl.uniform2f(uniform.versatz, versatz.x, versatz.y);
    gl.uniform1f(uniform.anzahl, anzahl); // alle Punkte, damit die Farben beim Entstehen nicht wandern
    gl.uniform1f(uniform.staerke, staerke / 255);
    gl.uniform1f(uniform.travel, travel ? 1 : 0);
    gl.uniform1f(uniform.laenge, laenge);
    gl.uniform1f(uniform.kopf, kopf);
    gl.uniform1f(uniform.rest, rest);
    gl.uniform1f(uniform.glanz, glanz);
    gl.uniform1f(uniform.invertiert, invertiert ? 1 : 0);
    gl.uniform1f(uniform.farbig, farbig ? 1 : 0);
    gl.uniform1f(uniform.red, red);
    gl.uniform1f(uniform.blue, blue);

    // Helligkeit addieren statt übermalen: Ergebnis = Ziel + Punkt
    // invertiert abziehen: Ergebnis = Ziel - Punkt, jeder Punkt dunkelt das Weiß ein Stück ab
    // (SRC_ALPHA/ONE_MINUS_SRC_ALPHA würde übermalen statt sammeln, dann gäbe es keine dichten Stellen mehr)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(invertiert ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD);

    // Wie die Liste zu lesen ist: je 3 Kommazahlen pro Punkt
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.enableVertexAttribArray(ort);
    gl.vertexAttribPointer(ort, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, Math.min(sichtbar, anzahl));
  }

  return { ladePunkte, zeichne };
}
