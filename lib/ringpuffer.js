// Ringpuffer aus Videobildern auf der Grafikkarte: ein Textur-Array (TEXTURE_2D_ARRAY) mit festen
// Ebenen. Ein neues Bild kommt in die nächste Ebene; ist der Puffer voll, überschreibt es das älteste.
// Nichts wird verschoben oder neu angelegt: es gibt nur eine Liste, welche Ebene wie alt ist.
// Für alle Zeit-Projekte (Chronofotografie, Zeitquader, später Live-Datamosh).
//
// Geschrieben wird nicht mit texSubImage3D, sondern indem ein Shader in die Ebene zeichnet
// (framebufferTextureLayer). So kann beim Einlegen gleich etwas mitgerechnet werden (die Maske der
// Chronofotografie im Alphakanal), und jede Ebene steht richtig herum (y = 0 unten, wie gl_FragCoord).

// so viel Grafikspeicher darf ein Puffer nehmen (am Handy weniger)
const handy = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900;
export const BUDGET = handy ? 300e6 : 1.2e9;

// wie viele Bilder dieser Größe passen höchstens (4 Bytes pro Pixel, RGBA8)
export function plaetzeFuer(gl, breite, hoehe) {
  const geraet = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  return Math.max(2, Math.min(geraet, Math.floor(BUDGET / (breite * hoehe * 4)), 1024));
}

export function baueRingpuffer(gl, breite, hoehe, plaetze) {
  const textur = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, textur);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, breite, hoehe, plaetze); // Speicher einmal, fest
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const puffer = gl.createFramebuffer();

  let naechste = 0; // hierhin kommt das nächste Bild
  let gefuellt = 0;

  return {
    textur,
    breite,
    hoehe,
    plaetze,
    gefuellt: () => gefuellt,
    leere() {
      naechste = 0;
      gefuellt = 0;
    },
    // Framebuffer auf die Ebene, in die das nächste Bild kommt; danach weiter()
    zielBinden(ebene = naechste) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, puffer);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, textur, 0, ebene);
      gl.viewport(0, 0, breite, hoehe);
      return ebene;
    },
    weiter() {
      naechste = (naechste + 1) % plaetze;
      gefuellt = Math.min(gefuellt + 1, plaetze);
    },
    // Ebene des Bildes, das alter Bilder vor dem neuesten kam (0 = das neueste)
    ebeneVor(alter) {
      return (naechste - 1 - alter + plaetze * 2) % plaetze;
    },
    loesche() {
      gl.deleteTexture(textur);
      gl.deleteFramebuffer(puffer);
    },
  };
}

// ein Bild (Canvas, Video, VideoFrame) als 2D-Textur hochladen, richtig herum (y = 0 unten)
export function ladeBild2D(gl, textur, quelle) {
  gl.bindTexture(gl.TEXTURE_2D, textur);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

export function neueTextur2D(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
