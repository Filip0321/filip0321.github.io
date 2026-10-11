// WebGL: Basic für beide shader

export const VERTEX_SHADER = /* glsl */ `#version 300 es  
                      // GLSL ES 3.00 - die version die WebGL2 verwendet
out vec2 uv;
// 2-dimensionale ausgabe (wird an den FRAGMENT_SHADER abgegeben)

void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  // Der Fragment shader geht nur über die Punkte, welcher der Vertex shader abdeckt
  // dafür malen wir ein Dreieck, welches den Bildschirm (von -1 bis 1) komplett abdeckt
  //  ID	binär	  (ID << 1) & 2	ID & 2	  pos	    gl_Position
  //	0	  00      0 & 2 = 0	    0	        (0, 0)	(-1, -1)
  //  1	  01	    2 & 2 = 2	    0	        (2, 0)	( 3, -1)
  //  2	  10	    4 & 2 = 0	    2	        (0, 2)	(-1,  3)

  // Ein Dreieck entsteht welcher zu groß ist. Es wird am Rand des Bildschirmes abgeschnitten
  // aber alle punkte des Bildes (canvas) sind im Dreieck und können dadurch eine genaue Position bekommen
  uv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;
// Funktion wird für jede Vertex ausgeführt

// WebGL einrichten

export const glCanvas = document.createElement("canvas");
export const gl = glCanvas.getContext("webgl2");

const ablage = document.createElement("canvas");
const ablageCtx = ablage.getContext("2d", { willReadFrequently: true });

function baueShader(typ, quelltext) {
  const shader = gl.createShader(typ);
  gl.shaderSource(shader, quelltext);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

export function baueProgramm(vertexQuelle, fragmentQuelle) {
  const programm = gl.createProgram();
  gl.attachShader(programm, baueShader(gl.VERTEX_SHADER, vertexQuelle));
  gl.attachShader(programm, baueShader(gl.FRAGMENT_SHADER, fragmentQuelle));
  gl.linkProgram(programm);

  if (!gl.getProgramParameter(programm, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(programm));
  }
  return programm;
}

const textur = gl ? gl.createTexture() : null;

// Effekt rendern

export function rendere(programm, quelle, w, h, einstellungen) {
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }
  gl.viewport(0, 0, w, h);

  gl.bindTexture(gl.TEXTURE_2D, textur);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.useProgram(programm);
  gl.uniform1i(gl.getUniformLocation(programm, "bild"), 0);
  gl.uniform2f(gl.getUniformLocation(programm, "aufloesung"), w, h);

  for (const [name, wert] of Object.entries(einstellungen)) {
    gl.uniform1f(gl.getUniformLocation(programm, name), wert);
  }

  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function zurueckholen(w, h) {
  ablage.width = w;
  ablage.height = h;
  ablageCtx.drawImage(glCanvas, 0, 0);
  return ablageCtx.getImageData(0, 0, w, h);
}
