import { zustand } from "../zustand.js";

function ladeGrafik(pfad) {
  const grafik = new Image();
  grafik.src = pfad;
  return grafik;
}

function geladen(grafik) {
  return grafik.complete && grafik.naturalWidth > 0;
} // check obs geladen ist

export const RAHMEN = {
  grafik: ladeGrafik("rahmen/rahmen.png"),
  schnitte: { oben: 280, links: 120, rechts: 120, unten: 16 }, // wo geschnitten wird
  innen: { oben: 280, links: 16, rechts: 16, unten: 16 }, // wo der Inhalt beginnt
  knoepfe: [
    // von links nach rechts
    ladeGrafik("rahmen/kleiner.png"),
    ladeGrafik("rahmen/groesser.png"),
    ladeGrafik("rahmen/schluss_normal.png"),
  ],
  knopfGroesse: 160,
  knopfAbstand: 16, // zwischen den Knöpfen
  knopfRand: 60, // vom rechten Rand
  titelLinks: 70, // wo der Titel beginnt
};

const alleGrafiken = [RAHMEN.grafik, ...RAHMEN.knoepfe];

export function beiGeladen(funktion) {
  for (const grafik of alleGrafiken) {
    grafik.addEventListener("load", funktion);
  }
}

// unsichtbare Arbeitsflächen
const inhaltCanvas = document.createElement("canvas");
const inhaltCtx = inhaltCanvas.getContext("2d");

const fensterCanvas = document.createElement("canvas");
const fensterCtx = fensterCanvas.getContext("2d");

const rahmenCanvas = document.createElement("canvas");
const rahmenCtx = rahmenCanvas.getContext("2d", { willReadFrequently: true });

export function fensterUmsBild(bild, titel) {
  if (!rahmenGeladen()) return bild; // noch nicht geladen

  const w = bild.width;
  const h = bild.height;
  const { innen } = RAHMEN;
  const r = zustand.werte.rahmen;

  // Bild als Inhalt bereitlegen
  inhaltCanvas.width = w;
  inhaltCanvas.height = h;
  inhaltCtx.putImageData(bild, 0, 0);

  // Maßstab der Ränder, abhängig von der Bildbreite
  const s = fensterMassstab(w);

  // Platz für das Fenster, abzüglich Abstand zum Rand [Pixel]
  const platzW = w * (1 - 2 * r.abstand);
  const platzH = h * (1 - 2 * r.abstand);

  // Inhalt so verkleinern, dass Inhalt plus Rahmen in den Platz passt,
  // Seitenverhältnis des Bildes bleibt
  const randW = (innen.links + innen.rechts) * s;
  const randH = (innen.oben + innen.unten) * s;
  const faktor = Math.min((platzW - randW) / w, (platzH - randH) / h);
  const iw = w * faktor;
  const ih = h * faktor;

  const fenster = baueFenster(inhaltCanvas, iw, ih, s, titel);

  // zustand.hintergrund, wie in zeichneQuelle
  rahmenCanvas.width = w;
  rahmenCanvas.height = h;
  if (!zustand.transparent) {
    rahmenCtx.fillStyle = zustand.hintergrund;
    rahmenCtx.fillRect(0, 0, w, h);
  }

  // Fenster mittig, mit einem einzigen Schatten
  rahmenCtx.save();
  setzeSchatten(rahmenCtx, w);
  rahmenCtx.drawImage(
    fenster,
    (w - fenster.width) / 2,
    (h - fenster.height) / 2,
  );
  rahmenCtx.restore();

  return rahmenCtx.getImageData(0, 0, w, h);
}

// Grafik in 9 Teilen auf die Fläche x, y, w, h verteilen
function zeichneNeunteilig(ziel, grafik, schnitte, x, y, w, h, s) {
  const { oben, links, rechts, unten } = schnitte;
  const gw = grafik.naturalWidth;
  const gh = grafik.naturalHeight;

  const qx = [0, links, gw - rechts, gw]; // Kanten im Original Rahmen
  const qy = [0, oben, gh - unten, gh];
  const zx = [x, x + links * s, x + w - rechts * s, x + w]; // Kanten im  die gestreched werden
  const zy = [y, y + oben * s, y + h - unten * s, y + h];

  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      if (i === 1 && j === 1) continue; // Mitte ist zustand.transparent
      ziel.drawImage(
        grafik,
        qx[i],
        qy[j],
        qx[i + 1] - qx[i],
        qy[j + 1] - qy[j],
        zx[i],
        zy[j],
        zx[i + 1] - zx[i],
        zy[j + 1] - zy[j],
      );
    }
  }
}

// Fenster um einen Inhalt bauen, ohne Schatten
export function baueFenster(inhalt, iw, ih, s, titel) {
  const { innen } = RAHMEN;
  const fw = iw + (innen.links + innen.rechts) * s;
  const fh = ih + (innen.oben + innen.unten) * s;

  fensterCanvas.width = Math.round(fw); // setzt auch den Inhalt zurück
  fensterCanvas.height = Math.round(fh);
  fensterCtx.imageSmoothingQuality = "high";

  // 1. Inhalt in die Innenfläche
  fensterCtx.drawImage(inhalt, innen.links * s, innen.oben * s, iw, ih);

  // 2. Rahmen darüber, die transparente Mitte lässt den Inhalt durch
  zeichneNeunteilig(
    fensterCtx,
    RAHMEN.grafik,
    RAHMEN.schnitte,
    0,
    0,
    fw,
    fh,
    s,
  );

  // 3. Knöpfe von rechts nach links
  const kg = RAHMEN.knopfGroesse * s;
  const ky = ((innen.oben - RAHMEN.knopfGroesse) / 2) * s; // senkrecht mittig in der Titelleiste
  let kx = fw - RAHMEN.knopfRand * s;
  for (let i = RAHMEN.knoepfe.length - 1; i >= 0; i--) {
    kx -= kg;
    fensterCtx.drawImage(RAHMEN.knoepfe[i], kx, ky, kg, kg);
    kx -= RAHMEN.knopfAbstand * s;
  }

  // 4. Titel, höchstens bis vor die Knöpfe
  const tx = RAHMEN.titelLinks * s;
  fensterCtx.fillStyle = "#ffffff";
  fensterCtx.font = `bold ${Math.round(100 * s)}px sans-serif`;
  fensterCtx.textBaseline = "middle";
  fensterCtx.fillText(titel, tx, (innen.oben / 2) * s, Math.max(0, kx - tx));

  return fensterCanvas;
}

export function rahmenGeladen() {
  return [RAHMEN.grafik, ...RAHMEN.knoepfe].every(geladen);
}

// Maßstab der Rahmenränder für ein Bild der Breite w
export function fensterMassstab(w) {
  return (w / RAHMEN.grafik.naturalWidth) * zustand.werte.rahmen.staerke;
}

// Schatten für alle Fenster gleich einstellen
export function setzeSchatten(ziel, w) {
  const r = zustand.werte.rahmen;
  ziel.shadowColor = `rgba(0, 0, 0, ${r.schattenDeckkraft})`;
  ziel.shadowBlur = r.schattenWeich * w;
  ziel.shadowOffsetX = r.schattenVersatz * w;
  ziel.shadowOffsetY = r.schattenVersatz * w;
}
