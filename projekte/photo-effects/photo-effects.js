// Bilder müssen limitiert werden, um nicht ewig zu rechnen

const MAX_KANTE = 2400;

// die ganzen HTML Elemente für die basic Einstellungen

const canvas = hole("bild");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const overlayCanvas = document.createElement("canvas");
const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: true });

const overlayFeld = hole("overlay-datei");
// read frequently macht dass der canvas nicht auf die Grafikkarte gelegt wird,
// da er auch permanent verändert wird

// Die ganzen HTML Elemente schonmal holen dass ich sie einfach nutzen kann
const dateiFeld = hole("datei"); // upload Feld

const pixelFeld = hole("pixelgroesse"); // verpixeln
const pixelWert = hole("pixelwert");

const ditherFeld = hole("dither-an"); // dithering
const stufenFeld = hole("stufen");
const stufenWert = hole("stufenwert");
const grauFeld = hole("grau");

const vhsFeld = hole("vhs-an"); // toggle für vhs
const crtFeld = hole("crt-an"); // toggle für crt

const rahmenFeld = hole("rahmen-an");
const rahmenTitelFeld = hole("rahmen-titel");
let rahmenAn = rahmenFeld.checked;
let rahmenTitel = rahmenTitelFeld.value;

const overlayAuswahl = hole("overlay-auswahl");
const overlayName = hole("overlay-name");
const overlayGroesseFeld = hole("overlay-groesse");
const overlayGroesseWert = hole("overlay-groesse-wert");
const overlayFensterFeld = hole("overlay-fenster");
const overlayTitelFeld = hole("overlay-titel");
const overlayEntfernenKnopf = hole("overlay-entfernen");

let ausgewaehlt = null;   // der Zettel des gerade ausgewählten Overlays

const vergleichFeld = hole("vergleich"); // slider für vorher/nachher
const vergleichWert = hole("vergleichwert");

const speichernKnopf = hole("speichern"); // export optionen
const abspielKnopf = hole("abspielen");
const frameKnopf = hole("frame-speichern");
const videoKnopf = hole("video-speichern");

const formatFeld = hole("format");
let format = formatFeld.value;
let bitmap = null; // das geladene Foto, damit man es bei Formatwechsel neu zuschneiden kann

const hintergrundFeld = hole("hintergrund");
const transparentFeld = hole("transparent");
let hintergrund = hintergrundFeld.value;
let transparent = transparentFeld.checked;

// Variablen und was ich brauch

let quelle = null; // Kopie des Originals (für vorher/nachher)
let ergebnis = null;
let video = null;
let videoUrl = null; // für <video> src=...
let videoDatei = null; // für export

let pixelgroesse = Number(pixelFeld.value); // welche Zahl hat der Slider bekommen
let ditherAn = ditherFeld.checked; // ist eine Checkbox, also Boolean
let stufen = Number(stufenFeld.value);
let grau = grauFeld.checked;
let vhsAn = vhsFeld.checked;
let crtAn = crtFeld.checked;
let teilung = 0;
let geplant = false;

const werte = { crt: {}, vhs: {}, rahmen: {} }; // bringen beide einige eigene Einstellungen mit
// und können später auch erweitert werden

if (!gl) {
  crtFeld.disabled = true;
  vhsFeld.disabled = true;
  crtFeld.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
  vhsFeld.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
} // da zum rendern shader benutzt werden muss ich checken ob WebGL überhaupt da ist

// wenn es ein Bild sollen die "nur-bild" Elemente hidden "false" haben
// Bei Video das gleiche

function zeigeModus(modus) {
  document.querySelectorAll(".nur-bild").forEach((element) => {
    element.hidden = modus !== "bild";
  });
  document.querySelectorAll(".nur-video").forEach((element) => {
    element.hidden = modus !== "video";
  });
}

// Format: welcher Ausschnitt der Quelle landet wo auf dem Canvas

function berechneRahmen(qw, qh) {
  let sx = 0,
    sy = 0,
    sw = qw,
    sh = qh; // Ausschnitt aus der Quelle, erst mal alles
  let rw = qw,
    rh = qh; // Größe des Ergebnisses, noch ohne MAX_KANTE

  if (format === "4:3") {
    if (qw / qh > 4 / 3) {
      // Quelle breiter als 4:3: links und rechts abschneiden
      sw = (qh * 4) / 3;
      sx = (qw - sw) / 2; // hälfte differenz, weil einfach später
      // bei späterem x anfangen zu malen
    } else {
      // Quelle höher als 4:3: oben und unten abschneiden
      sh = (qw * 3) / 4;
      sy = (qh - sh) / 2;
    }
    rw = sw;
    rh = sh;
  } else if (format === "balken") {
    if (qw / qh > 4 / 3) {
      rh = (qw * 3) / 4; // Balken oben und unten
    } else {
      rw = (qh * 4) / 3; // Balken links und rechts
    }
  }

  const faktor = Math.min(1, MAX_KANTE / Math.max(rw, rh));
  const w = Math.round(rw * faktor);
  const h = Math.round(rh * faktor);
  const dw = Math.round(sw * faktor);
  const dh = Math.round(sh * faktor);

  return {
    w,
    h,
    sx, // wo angefangen wird mit malen
    sy,
    sw, // bezieht sich auf die Originalgröße
    sh, // bzw. veränderung bei dem Original
    dx: Math.round((w - dw) / 2),
    dy: Math.round((h - dh) / 2),
    dw, // angepasst auf die MAX_KANTE
    dh,
  };
}

function passeCanvasAn(qw, qh) {
  const r = berechneRahmen(qw, qh);
  canvas.width = r.w;
  canvas.height = r.h;
}

// Bild laden

async function ladeBild(datei) {
  stoppeVideo(); // falls ein Video schon spielt
  if (bitmap) bitmap.close(); // falls ein Bild schon existiert
  bitmap = await createImageBitmap(datei); // neues Bild laden

  bereiteBildVor();

  canvas.hidden = false;
  speichernKnopf.disabled = false;
  zeigeModus("bild");
  wendeAn();
}

function bereiteBildVor() {
  passeCanvasAn(bitmap.width, bitmap.height);
  zeichneQuelle(ctx, bitmap, bitmap.width, bitmap.height);
  quelle = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Video laden

function ladeVideo(datei) {
  stoppeVideo();
  quelle = null;
  ergebnis = null;
  videoDatei = datei;

  videoUrl = URL.createObjectURL(datei); // <video> braucht eine src
  // eine adresse die auf den Arbeitsspeicher zeigt wird erstellt
  const neuesVideo = document.createElement("video");
  neuesVideo.src = videoUrl;
  neuesVideo.muted = true;
  neuesVideo.loop = true;
  neuesVideo.playsInline = true;

  neuesVideo.addEventListener("play", () => {
    abspielKnopf.textContent = "Pause";
  });
  neuesVideo.addEventListener("pause", () => {
    abspielKnopf.textContent = "Abspielen";
  });

  neuesVideo.addEventListener(
    "loadedmetadata",
    () => {
      passeCanvasAn(neuesVideo.videoWidth, neuesVideo.videoHeight);
      canvas.hidden = false;

      video = neuesVideo;
      zeigeModus("video");
      video.play();
      starteVideoSchleife(video);
    },
    { once: true },
  );
}

function stoppeVideo() {
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video = null;
  }
  if (videoUrl) {
    URL.revokeObjectURL(videoUrl);
    videoUrl = null;
  }
  videoDatei = null;
} // stoppe Video gibt den ganzen speicher des Videos frei

function starteVideoSchleife(diesesVideo) {
  function schritt() {
    if (diesesVideo !== video) return;
    zeichneVideobild();

    if (diesesVideo.requestVideoFrameCallback) {
      diesesVideo.requestVideoFrameCallback(schritt);
    } else {
      requestAnimationFrame(schritt);
    } // normales proceder bei animationen
  }
  schritt();
}

function zeichneQuelle(ziel, quelle, qw, qh) {
  const r = berechneRahmen(qw, qh);
  // console.log(r);
  ziel.clearRect(0, 0, r.w, r.h); // alles löschen, auch das vorige Bild
  if (!transparent) {
    ziel.fillStyle = hintergrund;
    ziel.fillRect(0, 0, r.w, r.h);
  }
  ziel.drawImage(quelle, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
}

function baueQuelleNeu() {
  if (video) {
    passeCanvasAn(video.videoWidth, video.videoHeight);
    zeichneVideobild();
  } else if (bitmap) {
    bereiteBildVor();
    wendeAn();
  }
}

// beim verpixeln braucht es zwei Schritte
// zuerst verkleinern, pixeliger machen
// dann vergrößern, dass sich die maße nicht ändern, man es sieht und es scharf bleibt

// Schritt 1: Verkleinern

function verkleinern(eingabe, groesse) {
  const w = eingabe.width;
  const h = eingabe.height;
  const ein = eingabe.data;
  const kw = Math.ceil(w / groesse); // kleiner machen um ein vielfaches
  const kh = Math.ceil(h / groesse);
  const ausgabe = new ImageData(kw, kh);
  const aus = ausgabe.data;

  for (let ky = 0; ky < kh; ky++) {
    for (let kx = 0; kx < kw; kx++) {
      const startX = kx * groesse; // Ein quadrat an Pixeln wird zu einem. Dafür bestimmt man hier
      const startY = ky * groesse; // die Startposition dieses quadrates (im Original natürlich, deswegen * größe wieder)
      const bw = Math.min(groesse, w - startX); // der zweite Fall tritt nur ganz am Ende ein
      const bh = Math.min(groesse, h - startY); // die größe der Seite des quadrates zum kleinern

      let r = 0; // Farbwert aller pixel des quadrates
      let g = 0;
      let b = 0;
      let a = 0;

      for (let y = startY; y < startY + bh; y++) {
        for (let x = startX; x < startX + bw; x++) {
          const i = (y * w + x) * 4;
          r += ein[i]; // den Farbwert der pixel in dem zusammenzufassenden Quadrat zusammenaddieren
          g += ein[i + 1];
          b += ein[i + 2];
          a += ein[i + 3];
        }
      }

      const anzahl = bw * bh; // anzahl der Pixel die zusammengefasst werden
      const k = (ky * kw + kx) * 4; // die for-schleife geht über x, hier muss man die index * 4 für die Farbwerte
      aus[k] = r / anzahl; // den Farbwert averagen über das Quadrat um den Pixelfarbwert zu bestimmen
      aus[k + 1] = g / anzahl;
      aus[k + 2] = b / anzahl;
      aus[k + 3] = a / anzahl;
    }
  }

  return ausgabe;
}

// Schritt 2: Vergrößern

function vergroessern(klein, groesse, w, h) {
  const ein = klein.data;
  const kw = klein.width;
  const ausgabe = new ImageData(w, h);
  const aus = ausgabe.data;

  for (let y = 0; y < h; y++) {
    const ky = Math.floor(y / groesse);
    for (let x = 0; x < w; x++) {
      const kx = Math.floor(x / groesse);
      const k = (ky * kw + kx) * 4; // bleibt für die größe des ursprünglichen Quadrates gleich
      // (jetzt ein Pixel der um den Faktor vergrößert wird)
      const i = (y * w + x) * 4; // verändert sich während das kleine gleich bleibt
      // denn ein pixel vom kleinen muss über mehrere im original gestreckt werden
      aus[i] = ein[k];
      aus[i + 1] = ein[k + 1];
      aus[i + 2] = ein[k + 2];
      aus[i + 3] = ein[k + 3];
    }
  }

  return ausgabe;
}

// Dithering (Floyd-Steinberg)

function dithern(eingabe, stufen, grau) {
  const w = eingabe.width;
  const h = eingabe.height;
  const ein = eingabe.data;
  const kanaele = grau ? 1 : 3; // entweder halt 3 Farbkanäle wenn Farbe, oder einen wenns eben grau ist
  const werteDither = new Float32Array(w * h * kanaele); // Array für alle Farbwerte aller pixel

  for (let i = 0; i < w * h; i++) {
    const r = ein[i * 4]; // alle Farbwerte der pixel jeweils pro schleife kurz speichern und anschauen
    const g = ein[i * 4 + 1]; // * 4, weil die eingabe auch einen alphachannel hat
    const b = ein[i * 4 + 2];
    if (grau) {
      werteDither[i] = 0.299 * r + 0.587 * g + 0.114 * b; // wenn grau dann hats nur ein Kanal und alle
      // Farbkanäle werden zusammengemischt
      // Das Auge nimmt grün stärker war...
    } else {
      werteDither[i * 3] = r; // * 3, weil der alphachannel nicht verändert werden soll
      werteDither[i * 3 + 1] = g;
      werteDither[i * 3 + 2] = b;
    }
  }

  const abstand = 255 / (stufen - 1); // wieviele abstufungen zwischen 0 und 255

  function verteile(x, y, k, fehler, anteil) {
    if (x < 0 || x >= w || y >= h) return;
    werteDither[(y * w + x) * kanaele + k] += fehler * anteil;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < kanaele; k++) {
        const i = (y * w + x) * kanaele + k; // so wurde die liste initialisiert (werteDither)
        const alt = werteDither[i]; // der alte wert in der Liste nehm ich schleife für schleife neu
        const neu = Math.min(
          255,
          Math.max(0, Math.round(alt / abstand) * abstand),
        ); // bring den Wert in die
        // richtige Abstufung
        werteDither[i] = neu;

        const fehler = alt - neu; // passte der alte Wert nicht genau in die Abstufung
        verteile(x + 1, y, k, fehler, 7 / 16);
        verteile(x - 1, y + 1, k, fehler, 3 / 16);
        verteile(x, y + 1, k, fehler, 5 / 16);
        verteile(x + 1, y + 1, k, fehler, 1 / 16);
        // der Wert wird auf die Kanalwerte der Pixel rechts und die drei in der nächsten Reihe verteilt
      }
    }
  }

  const ausgabe = new ImageData(w, h);
  const aus = ausgabe.data;

  for (let i = 0; i < w * h; i++) {
    if (grau) {
      aus[i * 4] = werteDither[i];
      aus[i * 4 + 1] = werteDither[i];
      aus[i * 4 + 2] = werteDither[i];
    } else {
      aus[i * 4] = werteDither[i * 3];
      aus[i * 4 + 1] = werteDither[i * 3 + 1];
      aus[i * 4 + 2] = werteDither[i * 3 + 2];
    }
    aus[i * 4 + 3] = ein[i * 4 + 3]; // alpha bleibt gleich
  }

  return ausgabe;
}

// Fenster-Rahmen

function ladeGrafik(pfad) {
  const grafik = new Image();
  grafik.src = pfad;
  grafik.addEventListener("load", planeAnwenden); // neu zeichnen, sobald geladen
  return grafik;
}

function geladen(grafik) {
  return grafik.complete && grafik.naturalWidth > 0;
} // check obs geladen ist

const RAHMEN = {
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

// unsichtbare Arbeitsflächen
const inhaltCanvas = document.createElement("canvas");
const inhaltCtx = inhaltCanvas.getContext("2d");
const fensterCanvas = document.createElement("canvas");
const fensterCtx = fensterCanvas.getContext("2d");
const rahmenCanvas = document.createElement("canvas");
const rahmenCtx = rahmenCanvas.getContext("2d", { willReadFrequently: true });

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
      if (i === 1 && j === 1) continue; // Mitte ist transparent
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
function baueFenster(inhalt, iw, ih, s, titel) {
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

function rahmenGeladen() {
  return [RAHMEN.grafik, ...RAHMEN.knoepfe].every(geladen);
}

// Maßstab der Rahmenränder für ein Bild der Breite w
function fensterMassstab(w) {
  return (w / RAHMEN.grafik.naturalWidth) * werte.rahmen.staerke;
}

// Schatten für alle Fenster gleich einstellen
function setzeSchatten(ziel, w) {
  const r = werte.rahmen;
  ziel.shadowColor = `rgba(0, 0, 0, ${r.schattenDeckkraft})`;
  ziel.shadowBlur = r.schattenWeich * w;
  ziel.shadowOffsetX = r.schattenVersatz * w;
  ziel.shadowOffsetY = r.schattenVersatz * w;
}

// Größe eines Overlays auf einem Bild der Breite w 
// breite, hoehe: nur die Grafik
// gesamtB, gesamtH: mit Fenster drumherum, falls es eins hat
function overlayMasse(schritt, w) {
  const breite = w * schritt.groesse;
  const hoehe = (breite * schritt.grafik.height) / schritt.grafik.width;

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

// Die Effekte

const EFFEKTE = {
  pixel: {
    name: "Pixel & Dithering",
    gpu: false,
    an: () => pixelgroesse > 1 || ditherAn,
    anwenden(bild) {
      const w = bild.width;
      const h = bild.height;
      if (pixelgroesse > 1) bild = verkleinern(bild, pixelgroesse);
      if (ditherAn) bild = dithern(bild, stufen, grau);
      if (pixelgroesse > 1) bild = vergroessern(bild, pixelgroesse, w, h);
      return bild;
    },
  },
  vhs: {
    name: "VHS",
    gpu: true,
    an: () => vhsAn && gl,
    programm: vhsProgramm,
    einstellungen: (zeit) => ({ ...werte.vhs, zeit }),
  },
  crt: {
    name: "CRT",
    gpu: true,
    an: () => crtAn && gl,
    programm: crtProgramm,
    einstellungen: (zeit) => ({ ...werte.crt, zufall: zeit }),
  },
  overlay: {
    name: "Overlay",
    gpu: false,
    an: () => true,
    anwenden(bild, zeit, schritt) {
      const w = bild.width;
      const h = bild.height;

      overlayCanvas.width = w;
      overlayCanvas.height = h;
      overlayCtx.putImageData(bild, 0, 0);

      const m = overlayMasse(schritt, w);
      const links = schritt.x * w - m.gesamtB / 2;   // Mitte → linke Kante
      const oben = schritt.y * h - m.gesamtH / 2;

      if (m.s > 0) {
        // mit Fenster: bauen, dann einmal mit Schatten zeichnen
        const fenster = baueFenster(schritt.grafik, m.breite, m.hoehe, m.s, schritt.titel);
        overlayCtx.save();
        setzeSchatten(overlayCtx, w);
        overlayCtx.drawImage(fenster, links, oben);
        overlayCtx.restore();
      } else {
        overlayCtx.drawImage(schritt.grafik, links, oben, m.breite, m.hoehe);
      }

      return overlayCtx.getImageData(0, 0, w, h);
    },  
  },
  rahmen: {
    name: "Fenster",
    gpu: false,
    an: () => rahmenAn,
    anwenden(bild, zeit, schritt) {
      if (!rahmenGeladen()) return bild; // noch nicht geladen

      const w = bild.width;
      const h = bild.height;
      const { innen } = RAHMEN;
      const r = werte.rahmen;

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

      const fenster = baueFenster(inhaltCanvas, iw, ih, s, rahmenTitel);

      // Hintergrund, wie in zeichneQuelle
      rahmenCanvas.width = w;
      rahmenCanvas.height = h;
      if (!transparent) {
        rahmenCtx.fillStyle = hintergrund;
        rahmenCtx.fillRect(0, 0, w, h);
      }

      // Fenster mittig, mit einem einzigen Schatten
      rahmenCtx.save();
      rahmenCtx.save();
      setzeSchatten(rahmenCtx, w);
      rahmenCtx.drawImage(fenster, (w - fenster.width) / 2, (h - fenster.height) / 2);
      rahmenCtx.restore();      
      rahmenCtx.drawImage(
        fenster,
        (w - fenster.width) / 2,
        (h - fenster.height) / 2,
      );
      rahmenCtx.restore();

      return rahmenCtx.getImageData(0, 0, w, h);
    },
  },
};

// Die Kette: Reihenfolge der Effekte, später umsortierbar
// overlay kommt mit kette.push() erst beim laden
let kette = [
  { typ: "pixel" },
  { typ: "vhs" },
  { typ: "rahmen" },
  { typ: "crt" },
];

// Kette anzeigen

const ketteListe = hole("kette");

function zeigeKette() {
  ketteListe.replaceChildren(); // liste leeren
  kette.forEach((schritt, i) => {
    // schritt ist in dem fall das gleiche wie kette[i]
    const effekt = EFFEKTE[schritt.typ];
    const name = schritt.name ?? schritt.typ.toUpperCase();

    const li = document.createElement("li");
    li.textContent = name;

    if (!effekt.an()) {
      li.classList.add("aus");
    }

    const hoch = document.createElement("button");
    hoch.textContent = "↑";
    hoch.setAttribute("aria-label", `${name} nach oben`);
    hoch.disabled = i === 0;
    hoch.addEventListener("click", () => verschiebe(i, -1));

    const runter = document.createElement("button");
    runter.textContent = "↓";
    runter.setAttribute("aria-label", `${name} nach unten`);
    runter.disabled = i === kette.length - 1;
    runter.addEventListener("click", () => verschiebe(i, 1));

    li.append(hoch, runter);
    ketteListe.appendChild(li);

    if (schritt.typ === "overlay") {
      const waehlen = document.createElement("button");
      waehlen.textContent = name;
      waehlen.setAttribute("aria-pressed", schritt === ausgewaehlt);
      waehlen.addEventListener("click", () => {
        ausgewaehlt = schritt;
        zeigeAuswahl();
        zeigeKette();
      });
      li.append(waehlen);
    } else {
      li.append(name);
    }
  });
}

function verschiebe(i, richtung) {
  const j = i + richtung;

  if (j < 0 || j >= kette.length) return;

  [kette[i], kette[j]] = [kette[j], kette[i]]; // tauschen

  zeigeKette();
  planeAnwenden();
}

zeigeKette();

overlayFeld.addEventListener("change", async () => {
  const datei = overlayFeld.files[0];
  if (!datei) return;

  const grafik = await createImageBitmap(datei); // einmal laden, nicht bei jedem Bild

  // packe es hinten an die Kette dran
  const schritt = {
    typ: "overlay",
    name: datei.name, // für die Anzeige in der Liste
    grafik,
    x: 0.5, // Mitte, waagerecht
    y: 0.5, // Mitte, senkrecht
    groesse: 0.3, // 30 % der ganzen Bildbreite (canvasBreite)
    fenster: false,
    titel: datei.name,
  }; // Mitte ist wichtig zum späteren skalieren und rotieren

  kette.push(schritt);
  ausgewaehlt = schritt;

  overlayFeld.value = "";
  zeigeKette();
  planeAnwenden();
});

// Overlays ziehen

let gezogen = null; // der Schritt, der gerade gezogen wird
let griff = null; // { x, y }: Abstand Fingerpunkt zu Overlay-Mitte

function punktAusEreignis(e) {
  const rect = canvas.getBoundingClientRect(); // wo auf dem Canvas wird geklickt
  const x = (e.clientX - rect.left) / rect.width; // auf 0..1 reduzieren
  const y = (e.clientY - rect.top) / rect.height;
  return {
    x: Math.min(Math.max(x, 0), 1), // auf 0 bis 1 begrenzen, falls der Zeiger
    y: Math.min(Math.max(y, 0), 1),
  };
}

function trifftOverlay(punkt) {
  const overlays = kette
    .filter((schritt) => schritt.typ === "overlay")
    .reverse();
  // alle overlays aus der Kette rückwärts speichern (das oberste ist wichtig)

  return (
    overlays.find((schritt) => {
      // find gibt das erste Element zurück wo es zu "true" ausgewertet wird
      const m = overlayMasse(schritt, canvas.width);
      const halbeBreite = m.gesamtB / canvas.width / 2;
      const halbeHoehe = m.gesamtH / canvas.height / 2;
      return (
        Math.abs(punkt.x - schritt.x) <= halbeBreite && // einfach dass der Punkt max halbe größe des Overlays
        Math.abs(punkt.y - schritt.y) <= halbeHoehe
      ); // von der mitte des Overlays entfernt ist
    }) ?? null
  );
  // das return .find() gibt also das SchrittObjekt zurück
}

canvas.addEventListener("pointerdown", (e) => {
  const punkt = punktAusEreignis(e);
  const treffer = trifftOverlay(punkt);
  if (!treffer) return;
  gezogen = treffer; // das SchrittObjekt was gefunden wurde
  ausgewaehlt = treffer;
  zeigeAuswahl();
  zeigeKette();
  griff = {
    x: punkt.x - treffer.x,
    y: punkt.y - treffer.y,
  };
  canvas.setPointerCapture(e.pointerId); // jetzt kann man anfangen zu tracken
});

canvas.addEventListener("pointermove", (e) => {
  if (!gezogen) return;

  const punkt = punktAusEreignis(e);
  gezogen.x = punkt.x - griff.x;
  gezogen.y = punkt.y - griff.y;
  planeAnwenden();
});

function lassLos() {
  gezogen = null;
  griff = null;
}

canvas.addEventListener("pointerup", lassLos);
canvas.addEventListener("pointercancel", lassLos);

function wendeSchrittAn(schritt, bild, zeit) {
  const effekt = EFFEKTE[schritt.typ];
  if (!effekt.gpu) return effekt.anwenden(bild, zeit, schritt);
  // ohne gpu, normale anwenden Funktion in EFFEKTE, die andern haben shader

  rendere(
    effekt.programm,
    bild,
    bild.width,
    bild.height,
    effekt.einstellungen(zeit),
  );
  return zurueckholen(bild.width, bild.height);
}

// gibt die Effekte zurück, dessen "an" Funktion "true" zurückgibt
// geht kette durch und nimmt string von typ um in EFFEKTE zu suchen
function aktiveSchritte() {
  return kette.filter((schritt) => EFFEKTE[schritt.typ].an());
}

function wendeEffekteAn(eingabe, zeit) {
  let bild = eingabe;
  for (const schritt of aktiveSchritte()) {
    bild = wendeSchrittAn(schritt, bild, zeit);
  }
  return bild;
}

// Canvas zeichnen

function zeichneTrennlinie(x, w, h) {
  const dicke = Math.max(2, Math.round(w / 400));
  ctx.fillStyle = "#DDDDDD";
  ctx.fillRect(x - dicke / 2, 0, dicke, h);
} // für den Vergleich

function zeichneVideobild() {
  const w = canvas.width;
  const h = canvas.height;
  const zeit = video.currentTime;

  const schritte = aktiveSchritte();

  zeichneQuelle(ctx, video, video.videoWidth, video.videoHeight);

  // wenn alle effekte gpu sind kann man einfach über diese rendere() aufrufen
  // sonst muss man schleife mit wendeSchrittAn()
  if (schritte.every((schritt) => EFFEKTE[schritt.typ].gpu)) {
    for (const schritt of schritte) {
      const effekt = EFFEKTE[schritt.typ];
      rendere(effekt.programm, canvas, w, h, effekt.einstellungen(zeit));
      ctx.drawImage(glCanvas, 0, 0);
    }
  } else {
    const original = ctx.getImageData(0, 0, w, h);
    ctx.putImageData(wendeEffekteAn(original, zeit), 0, 0);
  }

  const x = Math.round(teilung * w);
  if (x > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, x, h);
    ctx.clip();
    zeichneQuelle(ctx, video, video.videoWidth, video.videoHeight);
    ctx.restore();
    zeichneTrennlinie(x, w, h);
  }
}

function wendeAn() {
  if (video) {
    if (video.paused) zeichneVideobild();
    return;
  }

  if (!quelle) return;

  ergebnis = wendeEffekteAn(quelle, 0);
  zeige();
}

function zeige() {
  if (video) {
    if (video.paused) zeichneVideobild();
    return;
  }

  if (!ergebnis) return;

  const w = canvas.width;
  const h = canvas.height;
  const x = Math.round(teilung * w);

  ctx.putImageData(ergebnis, 0, 0);

  if (x > 0) {
    ctx.putImageData(quelle, 0, 0, 0, 0, x, h);
    zeichneTrennlinie(x, w, h);
  }
}

function planeAnwenden() {
  if (geplant) return;
  geplant = true;
  requestAnimationFrame(() => {
    geplant = false;
    wendeAn();
  });
}

// Mediabunny kann im Browser videos rendern - im Hintergrund
// also wartet auch jedes Bild ab

// Video rendern

async function bereiteKonvertierungVor(ausgabeFormat, w, h, verarbeite) {
  const input = new Mediabunny.Input({
    source: new Mediabunny.BlobSource(videoDatei),
    formats: Mediabunny.ALL_FORMATS,
  });

  const output = new Mediabunny.Output({
    format: ausgabeFormat,
    target: new Mediabunny.BufferTarget(),
  });

  const conversion = await Mediabunny.Conversion.init({
    input,
    output,
    video: {
      width: w,
      height: h,
      fit: { original: "fill", "4:3": "cover", balken: "contain" }[format],
      process: verarbeite,
    },
  });

  return { conversion, output };
}

async function speichereVideo() {
  if (!videoDatei) return;

  const w = canvas.width;
  const h = canvas.height;

  videoKnopf.disabled = true;
  frameKnopf.disabled = true;
  abspielKnopf.disabled = true;
  dateiFeld.disabled = true;
  videoKnopf.textContent = "Wird vorbereitet …";
  video.pause();

  const arbeit = new OffscreenCanvas(w, h); // das rendern wird nicht gezeigt (neuer Canvas)
  const arbeitCtx = arbeit.getContext("2d", { willReadFrequently: true });

  const verarbeite = (sample) => {
    sample.draw(arbeitCtx, 0, 0);
    const original = arbeitCtx.getImageData(0, 0, w, h);
    arbeitCtx.putImageData(wendeEffekteAn(original, sample.timestamp), 0, 0);
    return arbeit;
  };

  try {
    let endung = "mp4";
    let mime = "video/mp4";
    let { conversion, output } = await bereiteKonvertierungVor(
      new Mediabunny.Mp4OutputFormat(),
      w,
      h,
      verarbeite,
    );

    if (!conversion.isValid) {
      endung = "webm";
      mime = "video/webm";
      ({ conversion, output } = await bereiteKonvertierungVor(
        new Mediabunny.WebMOutputFormat(),
        w,
        h,
        verarbeite,
      ));
    }

    if (!conversion.isValid) {
      alert("Dein Browser kann dieses Video leider nicht umwandeln.");
      return;
    }

    conversion.onProgress = (fortschritt) => {
      videoKnopf.textContent = `Rendern … ${Math.round(fortschritt * 100)} %`;
    };

    await conversion.execute();

    ladeHerunter(
      new Blob([output.target.buffer], { type: mime }),
      `foto-effekte-${zeitstempel()}.${endung}`,
    );
  } catch (fehler) {
    console.error(fehler);
    alert(`Beim Rendern ist ein Fehler aufgetreten: ${fehler.message}`);
  } finally {
    videoKnopf.textContent = "Video speichern";
    videoKnopf.disabled = false;
    frameKnopf.disabled = false;
    abspielKnopf.disabled = false;
    dateiFeld.disabled = false;
  }
}

// Buttons
// Listener
//
formatFeld.addEventListener("change", () => {
  format = formatFeld.value;
  baueQuelleNeu();
});

hintergrundFeld.addEventListener("input", () => {
  hintergrund = hintergrundFeld.value;
  baueQuelleNeu();
});

transparentFeld.addEventListener("change", () => {
  transparent = transparentFeld.checked;
  baueQuelleNeu();
});

dateiFeld.addEventListener("change", () => {
  const datei = dateiFeld.files[0];
  if (!datei) return;

  if (datei.type.startsWith("video/")) {
    ladeVideo(datei);
  } else {
    ladeBild(datei);
  }
}); // wenn ein Video muss ich Video laden, sonst Bild

pixelFeld.addEventListener("input", () => {
  pixelgroesse = Number(pixelFeld.value);
  pixelWert.textContent = pixelgroesse;
  zeigeKette();
  planeAnwenden();
});

ditherFeld.addEventListener("change", () => {
  ditherAn = ditherFeld.checked;
  zeigeKette();
  planeAnwenden();
});

stufenFeld.addEventListener("input", () => {
  stufen = Number(stufenFeld.value);
  stufenWert.textContent = stufen;
  planeAnwenden();
});

grauFeld.addEventListener("change", () => {
  grau = grauFeld.checked;
  planeAnwenden();
});

vhsFeld.addEventListener("change", () => {
  vhsAn = vhsFeld.checked;
  zeigeKette();
  planeAnwenden();
});

rahmenFeld.addEventListener("change", () => {
  rahmenAn = rahmenFeld.checked;
  zeigeKette();
  planeAnwenden();
});

rahmenTitelFeld.addEventListener("input", () => {
  rahmenTitel = rahmenTitelFeld.value;
  planeAnwenden();
});

crtFeld.addEventListener("change", () => {
  crtAn = crtFeld.checked;
  zeigeKette();
  planeAnwenden();
});

// Einstellungen des ausgewählten Overlays

function zeigeAuswahl() {
  overlayAuswahl.hidden = !ausgewaehlt;
  if (!ausgewaehlt) return;

  overlayName.textContent = ausgewaehlt.name;
  overlayGroesseFeld.value = ausgewaehlt.groesse;
  overlayGroesseWert.textContent = ausgewaehlt.groesse;
  overlayFensterFeld.checked = ausgewaehlt.fenster;
  overlayTitelFeld.value = ausgewaehlt.titel;
}

overlayGroesseFeld.addEventListener("input", () => {
  ausgewaehlt.groesse = Number(overlayGroesseFeld.value);
  overlayGroesseWert.textContent = overlayGroesseFeld.value;
  planeAnwenden();
});

overlayFensterFeld.addEventListener("change", () => {
  ausgewaehlt.fenster = overlayFensterFeld.checked;
  planeAnwenden();
});

overlayTitelFeld.addEventListener("input", () => {
  ausgewaehlt.titel = overlayTitelFeld.value;
  planeAnwenden();
});

overlayEntfernenKnopf.addEventListener("click", () => {
  kette.splice(kette.indexOf(ausgewaehlt), 1);   // genau diesen Zettel aus der Kette nehmen
  ausgewaehlt = null;
  zeigeAuswahl();
  zeigeKette();
  planeAnwenden();
});

// auf Änderungen im HTML reagieren

document.querySelectorAll("[data-regler]").forEach((feld) => {
  const [effekt, name] = feld.dataset.regler.split(".");
  const anzeige = feld.nextElementSibling;
  // console.log([effekt, name]);

  // Werte aus reglern übergeben
  werte[effekt][name] = Number(feld.value);
  anzeige.textContent = feld.value;

  feld.addEventListener("input", () => {
    werte[effekt][name] = Number(feld.value);
    anzeige.textContent = feld.value;
    planeAnwenden();
  });
});

vergleichFeld.addEventListener("input", () => {
  teilung = Number(vergleichFeld.value) / 100;
  vergleichWert.textContent = `${vergleichFeld.value} %`;
  zeige();
});

// export und möglichkeit es anzuzeigen
abspielKnopf.addEventListener("click", () => {
  if (!video) return;
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
});

speichernKnopf.addEventListener("click", () => {
  if (!ergebnis) return;

  const speicher = document.createElement("canvas");
  speicher.width = ergebnis.width;
  speicher.height = ergebnis.height;
  speicher.getContext("2d").putImageData(ergebnis, 0, 0);

  speicher.toBlob((blob) => {
    if (blob) ladeHerunter(blob, `foto-effekte-${zeitstempel()}.png`);
  }, "image/png");
});

frameKnopf.addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (blob) ladeHerunter(blob, `foto-effekte-${zeitstempel()}.png`);
  }, "image/png");
});

videoKnopf.addEventListener("click", speichereVideo);

// Start

zeigeModus("bild"); // starte mit Bild, wenn Video wird es auch geändert
