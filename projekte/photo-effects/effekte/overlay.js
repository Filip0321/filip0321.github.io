import { RAHMEN, rahmenGeladen, fensterMassstab, baueFenster, setzeSchatten } from "./rahmen.js";

const overlayCanvas = document.createElement("canvas");
const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: true });

// Größe eines Overlays auf einem Bild der Breite w
// breite, hoehe: nur der Inhalt (Grafik, Video oder leere Fläche)
// gesamtB, gesamtH: mit Fenster drumherum, falls es eins hat
export function overlayMasse(schritt, w) {
  const breite = w * schritt.groesse;
  const hoehe = breite * schritt.verhaeltnis; // Höhe / Breite, beim Laden bestimmt

  if (!schritt.fenster || !rahmenGeladen()) {
    return { breite, hoehe, gesamtB: breite, gesamtH: hoehe, s: 0 };
  }

  const s = fensterMassstab(w);
  const { innen } = RAHMEN;
  return {
    breite, hoehe, s,
    gesamtB: breite + (innen.links + innen.rechts) * s,
    gesamtH: hoehe + (innen.oben + innen.unten) * s,
  };
}

export function zeichneOverlay(bild, schritt) {
  const w = bild.width;
  const h = bild.height;
  const m = overlayMasse(schritt, w);

  // was gezeichnet wird: entweder das fertige Fenster oder nur der Inhalt
  let quelle;
  if (m.s > 0) {
    quelle = baueFenster(schritt.grafik, m.breite, m.hoehe, m.s, schritt.titel);
  } else {
    quelle = schritt.grafik;
  }
  if (!quelle) return bild; // leeres Overlay ohne Fenster: nichts zu sehen

  overlayCanvas.width = w;
  overlayCanvas.height = h;
  overlayCtx.putImageData(bild, 0, 0);

  overlayCtx.save();
  overlayCtx.globalAlpha = schritt.deckkraft;
  overlayCtx.globalCompositeOperation = schritt.mischmodus;
  if (schritt.schatten) setzeSchatten(overlayCtx, w);

  // Ursprung in die Mitte des Overlays legen, dort drehen
  // die Schattenrichtung wird von translate/rotate NICHT erfasst,
  // dadurch fällt das Licht immer von derselben Seite
  overlayCtx.translate(schritt.x * w, schritt.y * h);
  overlayCtx.rotate((schritt.winkel * Math.PI) / 180);
  overlayCtx.drawImage(quelle, -m.gesamtB / 2, -m.gesamtH / 2, m.gesamtB, m.gesamtH);

  overlayCtx.restore();

  return overlayCtx.getImageData(0, 0, w, h);
}


// Bilder eines Videos zu bestimmten Zeiten, für den Export
// dekodiert fortlaufend; neu gesucht wird nur, wenn die Zeit zurückspringt

class Bildfolge {
  constructor(sink) {
    this.sink = sink;
    this.iter = null;
    this.jetzt = null;      // { canvas, timestamp, duration }
    this.naechstes = null;
  }

  async neuStarten(t) {
    await this.iter?.return();
    this.iter = this.sink.canvases(t);
    this.jetzt = (await this.iter.next()).value ?? null;
    this.naechstes = this.jetzt ? (await this.iter.next()).value ?? null : null;
  }

  async bildBei(t) {
    if (!this.jetzt || t < this.jetzt.timestamp) await this.neuStarten(t);

    while (this.naechstes && this.naechstes.timestamp <= t) {
      this.jetzt = this.naechstes;
      this.naechstes = (await this.iter.next()).value ?? null;
    }
    return this.jetzt?.canvas ?? null;
  }

  async zuruecksetzen() {
    await this.iter?.return();
    this.iter = null;
    this.jetzt = null;
    this.naechstes = null;
  }
}

// Zeit im Overlay-Video zur Zeit t des Ergebnisses (in Schleife, mit Versatz)
function lokaleZeit(schritt, t) {
  const d = schritt.dauer;
  return (((t + schritt.versatz) % d) + d) % d;
}

// vor jedem Exportbild: Video-Overlays auf das Bild zur Zeit t stellen
export async function stelleOverlaysAuf(schritte, t) {
  for (const schritt of schritte) {
    if (!schritt.folge) continue;
    const bild = await schritt.folge.bildBei(schritt.anfang + lokaleZeit(schritt, t));
    schritt.grafik = bild ?? schritt.video;
  }
}

// nach dem Export: wieder das laufende <video> zeigen
export function stelleOverlaysZurueck(schritte) {
  for (const schritt of schritte) {
    if (!schritt.folge) continue;
    schritt.grafik = schritt.video;
    schritt.folge.zuruecksetzen();
  }
}

// Vorschau mit Hauptvideo: Overlay an dessen Zeit koppeln
// erst ab 0,25 s Abweichung springen, sonst würde es ständig suchen
export function synchronisiere(schritt, t) {
  const soll = lokaleZeit(schritt, t);
  if (Math.abs(schritt.video.currentTime - soll) > 0.25) {
    schritt.video.currentTime = soll;
  }
}

// Speicher eines Video-Overlays freigeben
export function gibOverlayFrei(schritt) {
  if (!schritt.video) return;
  schritt.video.pause();
  schritt.video.removeAttribute("src");
  schritt.video.load();
  URL.revokeObjectURL(schritt.url);
  schritt.folge.zuruecksetzen();
  schritt.input.dispose();
}


// Neue Overlays

function grundZettel() {
  return {
    typ: "overlay",
    x: 0.5, // Mitte, waagerecht (Anteil der Bildbreite)
    y: 0.5, // Mitte, senkrecht (Anteil der Bildhöhe)
    groesse: 0.3, // 30 % der Bildbreite
    winkel: 0, // Grad, im Uhrzeigersinn
    schatten: true,
    deckkraft: 1,
    mischmodus: "source-over", // normal
  };
}

export async function neuesOverlay(datei) {
  if (datei.type.startsWith("video/")) return neuesVideoOverlay(datei);

  const grafik = await createImageBitmap(datei); // einmal laden, nicht bei jedem Bild

  return {
    ...grundZettel(),
    name: datei.name,
    grafik,
    verhaeltnis: grafik.height / grafik.width,
    fenster: false,
    titel: datei.name,
  };
}

async function neuesVideoOverlay(datei) {
  // live: ein <video>, das stumm in Schleife läuft
  const url = URL.createObjectURL(datei);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;

  await new Promise((fertig, fehlschlag) => {
    video.addEventListener("loadeddata", fertig, { once: true });
    video.addEventListener("error", () => {
      fehlschlag(new Error("Das Video lässt sich nicht abspielen."));
    }, { once: true });
  });
  video.play();

  // Export: dieselbe Datei über Mediabunny, Bild für Bild
  const input = new Mediabunny.Input({
    source: new Mediabunny.BlobSource(datei),
    formats: Mediabunny.ALL_FORMATS,
  });
  const spur = await input.getPrimaryVideoTrack();
  if (!spur || !(await spur.canDecode())) {
    throw new Error("Dieses Video kann der Browser nicht dekodieren.");
  }

  const anfang = await spur.getFirstTimestamp();
  const ende = await spur.computeDuration();
  // ein Overlay ist selten bildschirmfüllend, kleiner dekodieren spart Zeit
  const breite = Math.min(1280, await spur.getDisplayWidth());

  return {
    ...grundZettel(),
    name: datei.name,
    grafik: video,
    video,
    url,
    input,
    folge: new Bildfolge(new Mediabunny.CanvasSink(spur, { width: breite })),
    anfang,
    dauer: Math.max(ende - anfang, 1 / 30),
    versatz: 0,
    verhaeltnis: video.videoHeight / video.videoWidth,
    fenster: false,
    titel: datei.name,
  };
}

// Fenster ohne Inhalt: die Mitte bleibt durchsichtig
export function neuesFenster(nummer) {
  return {
    ...grundZettel(),
    name: `Fenster ${nummer}`,
    grafik: null,
    verhaeltnis: 3 / 4,
    fenster: true,
    titel: "Unbenannt",
    leer: true,       // kein eigenes Bild, Höhe frei einstellbar
    fuellung: null,   // null = durchsichtig, sonst Farbe
  };
}

// punkt in Anteilen (0..1), w und h in Pixeln
export function trifft(overlays, punkt, w, h) {
  return (
    overlays.find((schritt) => {
      const m = overlayMasse(schritt, w);

      // Abstand zur Mitte in echten Pixeln
      // (in Anteilen würde die Drehung auf nicht-quadratischen Bildern verzerren)
      const dx = (punkt.x - schritt.x) * w;
      const dy = (punkt.y - schritt.y) * h;

      // den Punkt zurückdrehen, statt das Rechteck zu drehen
      const r = (-schritt.winkel * Math.PI) / 180;
      const lx = dx * Math.cos(r) - dy * Math.sin(r);
      const ly = dx * Math.sin(r) + dy * Math.cos(r);

      return Math.abs(lx) <= m.gesamtB / 2 && Math.abs(ly) <= m.gesamtH / 2;
    }) ?? null
  );
}

// 1×1-Fläche in einer Farbe; drawImage streckt sie auf jede Größe
export function farbFlaeche(farbe) {
  const flaeche = document.createElement("canvas");
  flaeche.width = 1;
  flaeche.height = 1;
  const ctx = flaeche.getContext("2d");
  ctx.fillStyle = farbe;
  ctx.fillRect(0, 0, 1, 1);
  return flaeche;
}