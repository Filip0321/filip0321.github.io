// Farbtabelle (farben.js) als Textur 256 × 1 auf die Grafikkarte; im Shader: texture(verlauf, vec2(h, 0.5)).rgb
export function ladeVerlauf(gl, tabelle, textur = gl.createTexture()) {
  gl.bindTexture(gl.TEXTURE_2D, textur);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // Zeilen sind Bytes ohne Auffüllen (Standard: auf 4 Bytes gerundet)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, tabelle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // zwischen zwei Farben mischen
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // bei h = 1 nicht wieder vorn anfangen
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return textur;
}