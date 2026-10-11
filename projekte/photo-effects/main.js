import { gl, glCanvas, rendere, zurueckholen } from "./webgl.js";
import { crtProgramm } from "./effekte/crt.js";
import { vhsProgramm } from "./effekte/vhs.js";
import { verkleinern, vergroessern, dithern } from "./effekte/pixel.js";
import { zustand } from "./zustand.js";
import { beiGeladen, fensterUmsBild } from "./effekte/rahmen.js"
import { zeichneOverlay, neuesOverlay, trifft } from "./effekte/overlay.js";

// Bilder müssen limitiert werden, um nicht ewig zu rechnen

const MAX_KANTE = 2400;

// die ganzen HTML Elemente für die basic Einstellungen

const canvas = hole("bild");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

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

const hintergrundFeld = hole("hintergrund");
const transparentFeld = hole("transparent");

let bitmap = null; // das geladene Foto, damit man es bei Formatwechsel neu zuschneiden kann
let quelle = null; // Kopie des Originals (für vorher/nachher)
let ergebnis = null;
let video = null;
let videoUrl = null; // für <video> src=...
let videoDatei = null; // für export

let geplant = false;

// Zustand aus dem HTML übernehmen
// (Browser merken sich beim Neuladen manchmal, was in Feldern stand)
zustand.format = formatFeld.value;
zustand.hintergrund = hintergrundFeld.value;
zustand.transparent = transparentFeld.checked;
zustand.pixelgroesse = Number(pixelFeld.value);
zustand.ditherAn = ditherFeld.checked;
zustand.stufen = Number(stufenFeld.value);
zustand.grau = grauFeld.checked;
zustand.vhsAn = vhsFeld.checked;
zustand.crtAn = crtFeld.checked;
zustand.rahmenAn = rahmenFeld.checked;
zustand.rahmenTitel = rahmenTitelFeld.value;

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

// zustand.format: welcher Ausschnitt der Quelle landet wo auf dem Canvas

function berechneRahmen(qw, qh) {
  let sx = 0,
    sy = 0,
    sw = qw,
    sh = qh; // Ausschnitt aus der Quelle, erst mal alles
  let rw = qw,
    rh = qh; // Größe des Ergebnisses, noch ohne MAX_KANTE

  if (zustand.format === "4:3") {
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
  } else if (zustand.format === "balken") {
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
  if (!zustand.transparent) {
    ziel.fillStyle = zustand.hintergrund;
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

// Die Effekte

const EFFEKTE = {
  pixel: {
    name: "Pixel & Dithering",
    gpu: false,
    an: () => zustand.pixelgroesse > 1 || zustand.ditherAn,
    anwenden(bild) {
      const w = bild.width;
      const h = bild.height;
      if (zustand.pixelgroesse > 1) bild = verkleinern(bild, zustand.pixelgroesse);
      if (zustand.ditherAn) bild = dithern(bild, zustand.stufen, zustand.grau);
      if (zustand.pixelgroesse > 1) bild = vergroessern(bild, zustand.pixelgroesse, w, h);
      return bild;
    },
  },
  vhs: {
    name: "VHS",
    gpu: true,
    an: () => zustand.vhsAn && gl,
    programm: vhsProgramm,
    einstellungen: (zeit) => ({ ...zustand.werte.vhs, zeit }),
  },
  crt: {
    name: "CRT",
    gpu: true,
    an: () => zustand.crtAn && gl,
    programm: crtProgramm,
    einstellungen: (zeit) => ({ ...zustand.werte.crt, zufall: zeit }),
  },
  overlay: {
    name: "Overlay",
    gpu: false,
    an: () => true,
    anwenden(bild, zeit, schritt) {
      return zeichneOverlay(bild, schritt);
    },  
  },
  rahmen: {
    name: "Fenster",
    gpu: false,
    an: () => zustand.rahmenAn,
    anwenden(bild) {
      return fensterUmsBild(bild, zustand.rahmenTitel);
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
    
    li.append(hoch, runter);
    ketteListe.appendChild(li);
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

  const schritt = await neuesOverlay(datei);  
  
  kette.push(schritt);
  ausgewaehlt = schritt;

  overlayFeld.value = "";
  zeigeAuswahl();
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

  return trifft(overlays, punkt, canvas.width, canvas.height)
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

  const x = Math.round(zustand.teilung * w);
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
  const x = Math.round(zustand.teilung * w);

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

// Mediabunny kann im Browser videos rendern - im zustand.hintergrund
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
      fit: { original: "fill", "4:3": "cover", balken: "contain" }[zustand.format],
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
  zustand.format = formatFeld.value;
  baueQuelleNeu();
});

hintergrundFeld.addEventListener("input", () => {
  zustand.hintergrund = hintergrundFeld.value;
  baueQuelleNeu();
});

transparentFeld.addEventListener("change", () => {
  zustand.transparent = transparentFeld.checked;
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
  zustand.pixelgroesse = Number(pixelFeld.value);
  pixelWert.textContent = zustand.pixelgroesse;
  zeigeKette();
  planeAnwenden();
});

ditherFeld.addEventListener("change", () => {
  zustand.ditherAn = ditherFeld.checked;
  zeigeKette();
  planeAnwenden();
});

stufenFeld.addEventListener("input", () => {
  zustand.stufen = Number(stufenFeld.value);
  stufenWert.textContent = zustand.stufen;
  planeAnwenden();
});

grauFeld.addEventListener("change", () => {
  zustand.grau = grauFeld.checked;
  planeAnwenden();
});

vhsFeld.addEventListener("change", () => {
  zustand.vhsAn = vhsFeld.checked;
  zeigeKette();
  planeAnwenden();
});

rahmenFeld.addEventListener("change", () => {
  zustand.rahmenAn = rahmenFeld.checked;
  zeigeKette();
  planeAnwenden();
});

rahmenTitelFeld.addEventListener("input", () => {
  zustand.rahmenTitel = rahmenTitelFeld.value;
  planeAnwenden();
});

crtFeld.addEventListener("change", () => {
  zustand.crtAn = crtFeld.checked;
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

  // zustand.werte aus reglern übergeben
  zustand.werte[effekt][name] = Number(feld.value);
  anzeige.textContent = feld.value;

  feld.addEventListener("input", () => {
    zustand.werte[effekt][name] = Number(feld.value);
    anzeige.textContent = feld.value;
    planeAnwenden();
  });
});

vergleichFeld.addEventListener("input", () => {
  zustand.teilung = Number(vergleichFeld.value) / 100;
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
beiGeladen(planeAnwenden)
zeigeModus("bild"); // starte mit Bild, wenn Video wird es auch geändert
