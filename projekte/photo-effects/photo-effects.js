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

const dateiFeld = hole("datei"); // upload Feld

const pixelFeld = hole("pixelgroesse"); // verpixeln
const pixelWert = hole("pixelwert");

const ditherFeld = hole("dither-an"); // dithering
const stufenFeld = hole("stufen");
const stufenWert = hole("stufenwert");
const grauFeld = hole("grau");

const vhsFeld = hole("vhs-an"); // toggle für vhs
const crtFeld = hole("crt-an"); // toggle für crt

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

const werte = { crt: {}, vhs: {} }; // bringen beide einige eigene Einstellungen mit
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

// Bild laden

async function ladeBild(datei) {
  stoppeVideo();
  if (bitmap) bitmap.close();
  bitmap = await createImageBitmap(datei);

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
      sx = (qw - sw) / 2;
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
    sx,
    sy,
    sw,
    sh,
    dx: Math.round((w - dw) / 2),
    dy: Math.round((h - dh) / 2),
    dw,
    dh,
  };
}

function passeCanvasAn(qw, qh) {
  const r = berechneRahmen(qw, qh);
  canvas.width = r.w;
  canvas.height = r.h;
}

function zeichneQuelle(ziel, quelle, qw, qh) {
  const r = berechneRahmen(qw, qh);
  ziel.clearRect(0, 0, r.w, r.h); // alles löschen, auch das vorige Bild
  if (!transparent) {
    ziel.fillStyle = hintergrund;
    ziel.fillRect(0, 0, r.w, r.h);
  }
  ziel.drawImage(quelle, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
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
      // 1. Hilfs-Canvas so groß wie das Foto, Foto hineinlegen
      overlayCanvas.width = bild.width;
      overlayCanvas.height = bild.height;
      overlayCtx.putImageData(bild, 0, 0);

      // 2. Größe des Overlays in Pixeln, Seitenverhältnis der Grafik bleibt
      const breite = bild.width * schritt.groesse;
      const hoehe = (breite * schritt.grafik.height) / schritt.grafik.width;

      // 3. aus dem Mittelpunkt (0 bis 1) die linke obere Ecke in Pixeln
      const links = schritt.x * bild.width - breite / 2;
      const oben = schritt.y * bild.height - hoehe / 2;

      // 4. Overlay darüber zeichnen, Transparenz bleibt erhalten
      overlayCtx.drawImage(schritt.grafik, links, oben, breite, hoehe);

      // 5. zurück als ImageData
      return overlayCtx.getImageData(0, 0, bild.width, bild.height);
    },
  },
};

// Die Kette: Reihenfolge der Effekte, später umsortierbar

let kette = [{ typ: "pixel" }, { typ: "vhs" }, { typ: "crt" }];

// Kette anzeigen

const ketteListe = hole("kette");

function zeigeKette() {
  ketteListe.replaceChildren(); // liste leeren
  kette.forEach((schritt, i) => {
    // schritt ist in dem fall das gleiche wie kette[i]
    const effekt = EFFEKTE[schritt.typ];
    const name = effekt.name ?? schritt.typ.toUpperCase();

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

function aktiveSchritte() {
  return kette.filter((schritt) => EFFEKTE[schritt.typ].an());
}

function wendeSchrittAn(schritt, bild, zeit) {
  const effekt = EFFEKTE[schritt.typ];
  if (!effekt.gpu) return effekt.anwenden(bild, zeit, schritt);

  rendere(
    effekt.programm,
    bild,
    bild.width,
    bild.height,
    effekt.einstellungen(zeit),
  );
  return zurueckholen(bild.width, bild.height);
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
  const effekte = aktiveSchritte();

  const schritte = aktiveSchritte();

  zeichneQuelle(ctx, video, video.videoWidth, video.videoHeight);

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

function baueQuelleNeu() {
  if (video) {
    passeCanvasAn(video.videoWidth, video.videoHeight);
    zeichneVideobild();
  } else if (bitmap) {
    bereiteBildVor();
    wendeAn();
  }
}

// Listener

overlayFeld.addEventListener("change", async () => {
  const datei = overlayFeld.files[0];
  if (!datei) return;

  const grafik = await createImageBitmap(datei); // einmal laden, nicht bei jedem Bild

  kette.push({
    typ: "overlay",
    name: datei.name, // für die Anzeige in der Liste
    grafik,
    x: 0.5, // Mitte, waagerecht
    y: 0.5, // Mitte, senkrecht
    groesse: 0.3, // 30 % der Bildbreite
  }); // Mitte ist wichtig zum späteren skalieren und rotieren

  overlayFeld.value = "";
  zeigeKette();
  planeAnwenden();
});

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

crtFeld.addEventListener("change", () => {
  crtAn = crtFeld.checked;
  zeigeKette();
  planeAnwenden();
});

formatFeld.addEventListener("change", () => {
  format = formatFeld.value;
  if (video) {
    passeCanvasAn(video.videoWidth, video.videoHeight);
    zeichneVideobild();
  } else if (bitmap) {
    bereiteBildVor();
    wendeAn();
  }
});
// auf Änderungen im HTML reagieren

document.querySelectorAll("[data-regler]").forEach((feld) => {
  const [effekt, name] = feld.dataset.regler.split(".");
  const anzeige = feld.nextElementSibling;

  werte[effekt][name] = Number(feld.value);
  anzeige.textContent = feld.value;

  feld.addEventListener("input", () => {
    werte[effekt][name] = Number(feld.value);
    anzeige.textContent = feld.value;
    planeAnwenden();
  });
});

document.querySelectorAll("[data-zeigt]").forEach((schalter) => {
  const gruppe = hole(schalter.dataset.zeigt);
  const aktualisiere = () => {
    gruppe.hidden = !schalter.checked;
  };
  schalter.addEventListener("change", aktualisiere);
  aktualisiere();
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

