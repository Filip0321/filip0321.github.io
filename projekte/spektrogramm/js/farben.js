export const farbenZahlen = new Uint8Array(256 * 3);

// Immer nur die "Anker" und alle farben dazwischen werden aus ihnen gemischt
// je nachdem wie weit die farben zwischen den beiden Farben ist
const SKALEN = {
  glut: [
    [0, 0, 4], // 0.00  fast schwarz - für leiste Töne
    [87, 16, 110], // 0.25  dunkelviolett
    [188, 55, 84], // 0.50  rot-pink
    [249, 142, 9], // 0.75  orange
    [252, 255, 164], // 1.00  hellgelb - für laute töne
  ],
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  eis: [
    [0, 0, 8],
    [10, 30, 90],
    [40, 110, 190],
    [150, 210, 240],
    [255, 255, 255],
  ],
  grau: [
    [0, 0, 0],
    [255, 255, 255],
  ],
};

let ANKER = SKALEN.glut;

function mischen(anker1, anker2, abstand) {
  return anker1 + (anker2 - anker1) * abstand;
  // wie mix() in GLSL
}

export function waehleFarbskala(name) {
  ANKER = SKALEN[name] ?? SKALEN.glut;
  farbenGenerieren();
}

function farbenGenerieren() {
  for (let v = 0; v < 256; v++) {
    // v: Lautstärke 0–255, jede bekommt ihre Farbe
    const position = (v / 255) * (ANKER.length - 1); // Zahl zwischen 0 und ANKER.length - 1
    const i = Math.min(Math.floor(position), ANKER.length - 2); // length - 1 sowieso, dann nochmal, 
    // weil sonst gibts kein + 1 zum mischen
    const abstand = position - i;

    const von = ANKER[i];
    const bis = ANKER[i + 1];
    farbenZahlen[v * 3] = Math.round(mischen(von[0], bis[0], abstand)); // rot
    farbenZahlen[v * 3 + 1] = Math.round(mischen(von[1], bis[1], abstand)); // grün
    farbenZahlen[v * 3 + 2] = Math.round(mischen(von[2], bis[2], abstand)); // blau
  }
}

farbenGenerieren(); 

export function baueVerlauf(kontext, hoehe) {
  const gradient = kontext.createLinearGradient(0, hoehe, 0, 0);
  for (let n = 0; n < ANKER.length; n++) {
    const [r, g, b] = ANKER[n];
    gradient.addColorStop(n / (ANKER.length - 1), `rgb(${r}, ${g}, ${b})`);
  }
  return gradient;
}