// ---------- Hilfsfunktion ----------

function hole(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Im HTML fehlt ein Element mit id="${id}"`);
  }
  return element;
}

// ---------- Einstellungen ----------

const MAX_KANTE = 2400;

// ---------- Elemente ----------

const canvas = hole("bild");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const dateiFeld = hole("datei");
const pixelFeld = hole("pixelgroesse");
const pixelWert = hole("pixelwert");
const ditherFeld = hole("dither-an");
const stufenFeld = hole("stufen");
const stufenWert = hole("stufenwert");
const grauFeld = hole("grau");
const vhsFeld = hole("vhs-an");
const crtFeld = hole("crt-an");
const vergleichFeld = hole("vergleich");
const vergleichWert = hole("vergleichwert");
const speichernKnopf = hole("speichern");
const abspielKnopf = hole("abspielen");
const frameKnopf = hole("frame-speichern");
const videoKnopf = hole("video-speichern");

// ---------- Zustand ----------

let quelle = null;
let ergebnis = null;
let video = null;
let videoUrl = null;
let videoDatei = null;

let pixelgroesse = Number(pixelFeld.value);
let ditherAn = ditherFeld.checked;
let stufen = Number(stufenFeld.value);
let grau = grauFeld.checked;
let vhsAn = vhsFeld.checked;
let crtAn = crtFeld.checked;
let teilung = 0;
let geplant = false;

const werte = { crt: {}, vhs: {} };

if (!gl) {
  crtFeld.disabled = true;
  vhsFeld.disabled = true;
  crtFeld.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
  vhsFeld.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
}

// ---------- Modus ----------

function zeigeModus(modus) {
  document.querySelectorAll(".nur-bild").forEach((element) => {
    element.hidden = modus !== "bild";
  });
  document.querySelectorAll(".nur-video").forEach((element) => {
    element.hidden = modus !== "video";
  });
}

// ---------- Bild laden ----------

async function ladeBild(datei) {
  stoppeVideo();

  const bitmap = await createImageBitmap(datei);

  const faktor = Math.min(1, MAX_KANTE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * faktor);
  const h = Math.round(bitmap.height * faktor);

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  quelle = ctx.getImageData(0, 0, w, h);

  canvas.hidden = false;
  speichernKnopf.disabled = false;
  zeigeModus("bild");
  wendeAn();
}

// ---------- Video laden ----------

function ladeVideo(datei) {
  stoppeVideo();
  quelle = null;
  ergebnis = null;
  videoDatei = datei;

  videoUrl = URL.createObjectURL(datei);
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

  neuesVideo.addEventListener("loadedmetadata", () => {
    const faktor = Math.min(1, MAX_KANTE / Math.max(neuesVideo.videoWidth, neuesVideo.videoHeight));
    canvas.width = Math.round(neuesVideo.videoWidth * faktor);
    canvas.height = Math.round(neuesVideo.videoHeight * faktor);
    canvas.hidden = false;

    video = neuesVideo;
    zeigeModus("video");
    video.play();
    starteVideoSchleife(video);
  }, { once: true });
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
}

function starteVideoSchleife(diesesVideo) {
  function schritt() {
    if (diesesVideo !== video) return;
    zeichneVideobild();

    if (diesesVideo.requestVideoFrameCallback) {
      diesesVideo.requestVideoFrameCallback(schritt);
    } else {
      requestAnimationFrame(schritt);
    }
  }
  schritt();
}

// ---------- Effekt: Verkleinern ----------

function verkleinern(eingabe, groesse) {
  const w = eingabe.width;
  const h = eingabe.height;
  const ein = eingabe.data;
  const kw = Math.ceil(w / groesse);
  const kh = Math.ceil(h / groesse);
  const ausgabe = new ImageData(kw, kh);
  const aus = ausgabe.data;

  for (let ky = 0; ky < kh; ky++) {
    for (let kx = 0; kx < kw; kx++) {
      const startX = kx * groesse;
      const startY = ky * groesse;
      const bw = Math.min(groesse, w - startX);
      const bh = Math.min(groesse, h - startY);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let y = startY; y < startY + bh; y++) {
        for (let x = startX; x < startX + bw; x++) {
          const i = (y * w + x) * 4;
          r += ein[i];
          g += ein[i + 1];
          b += ein[i + 2];
          a += ein[i + 3];
        }
      }

      const anzahl = bw * bh;
      const k = (ky * kw + kx) * 4;
      aus[k] = r / anzahl;
      aus[k + 1] = g / anzahl;
      aus[k + 2] = b / anzahl;
      aus[k + 3] = a / anzahl;
    }
  }

  return ausgabe;
}

// ---------- Effekt: Vergrößern ----------

function vergroessern(klein, groesse, w, h) {
  const ein = klein.data;
  const kw = klein.width;
  const ausgabe = new ImageData(w, h);
  const aus = ausgabe.data;

  for (let y = 0; y < h; y++) {
    const ky = Math.floor(y / groesse);
    for (let x = 0; x < w; x++) {
      const kx = Math.floor(x / groesse);
      const k = (ky * kw + kx) * 4;
      const i = (y * w + x) * 4;
      aus[i] = ein[k];
      aus[i + 1] = ein[k + 1];
      aus[i + 2] = ein[k + 2];
      aus[i + 3] = ein[k + 3];
    }
  }

  return ausgabe;
}

// ---------- Effekt: Dithering (Floyd-Steinberg) ----------

function dithern(eingabe, stufen, grau) {
  const w = eingabe.width;
  const h = eingabe.height;
  const ein = eingabe.data;
  const kanaele = grau ? 1 : 3;
  const werteDither = new Float32Array(w * h * kanaele);

  for (let i = 0; i < w * h; i++) {
    const r = ein[i * 4];
    const g = ein[i * 4 + 1];
    const b = ein[i * 4 + 2];
    if (grau) {
      werteDither[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    } else {
      werteDither[i * 3] = r;
      werteDither[i * 3 + 1] = g;
      werteDither[i * 3 + 2] = b;
    }
  }

  const abstand = 255 / (stufen - 1);

  function verteile(x, y, k, fehler, anteil) {
    if (x < 0 || x >= w || y >= h) return;
    werteDither[(y * w + x) * kanaele + k] += fehler * anteil;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < kanaele; k++) {
        const i = (y * w + x) * kanaele + k;
        const alt = werteDither[i];
        const neu = Math.min(255, Math.max(0, Math.round(alt / abstand) * abstand));
        werteDither[i] = neu;

        const fehler = alt - neu;
        verteile(x + 1, y, k, fehler, 7 / 16);
        verteile(x - 1, y + 1, k, fehler, 3 / 16);
        verteile(x, y + 1, k, fehler, 5 / 16);
        verteile(x + 1, y + 1, k, fehler, 1 / 16);
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
    aus[i * 4 + 3] = ein[i * 4 + 3];
  }

  return ausgabe;
}

// ---------- Die Effekt-Kette ----------

function cpuEffekteAn() {
  return pixelgroesse > 1 || ditherAn;
}

function wendeEffekteAn(eingabe, zeit) {
  let bild = eingabe;

  if (pixelgroesse > 1) {
    bild = verkleinern(bild, pixelgroesse);
  }

  if (ditherAn) {
    bild = dithern(bild, stufen, grau);
  }

  if (pixelgroesse > 1) {
    bild = vergroessern(bild, pixelgroesse, eingabe.width, eingabe.height);
  }

  if (vhsAn && gl) {
    bild = vhs(bild, { ...werte.vhs, zeit });
  }

  if (crtAn && gl) {
    bild = crt(bild, { ...werte.crt, zufall: zeit });
  }

  return bild;
}

// ---------- Anzeigen ----------

function zeichneTrennlinie(x, w, h) {
  const dicke = Math.max(2, Math.round(w / 400));
  ctx.fillStyle = "#ddd";
  ctx.fillRect(x - dicke / 2, 0, dicke, h);
}

function zeichneVideobild() {
  const w = canvas.width;
  const h = canvas.height;
  const zeit = video.currentTime;

  if (cpuEffekteAn()) {
    ctx.drawImage(video, 0, 0, w, h);
    const original = ctx.getImageData(0, 0, w, h);
    ctx.putImageData(wendeEffekteAn(original, zeit), 0, 0);
  } else {
    let gezeichnet = false;

    if (vhsAn && gl) {
      rendere(vhsProgramm, video, w, h, { ...werte.vhs, zeit });
      ctx.drawImage(glCanvas, 0, 0);
      gezeichnet = true;
    }

    if (crtAn && gl) {
      rendere(crtProgramm, gezeichnet ? canvas : video, w, h, { ...werte.crt, zufall: zeit });
      ctx.drawImage(glCanvas, 0, 0);
      gezeichnet = true;
    }

    if (!gezeichnet) {
      ctx.drawImage(video, 0, 0, w, h);
    }
  }

  const x = Math.round(teilung * w);
  if (x > 0) {
    ctx.drawImage(video, 0, 0, video.videoWidth * teilung, video.videoHeight, 0, 0, x, h);
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

// ---------- Video rendern ----------

async function bereiteKonvertierungVor(format, w, h, verarbeite) {
  const input = new Mediabunny.Input({
    source: new Mediabunny.BlobSource(videoDatei),
    formats: Mediabunny.ALL_FORMATS
  });

  const output = new Mediabunny.Output({
    format,
    target: new Mediabunny.BufferTarget()
  });

  const conversion = await Mediabunny.Conversion.init({
    input,
    output,
    video: {
      width: w,
      height: h,
      fit: "fill",
      process: verarbeite
    }
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

  const arbeit = new OffscreenCanvas(w, h);
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
    let { conversion, output } = await bereiteKonvertierungVor(new Mediabunny.Mp4OutputFormat(), w, h, verarbeite);

    if (!conversion.isValid) {
      endung = "webm";
      mime = "video/webm";
      ({ conversion, output } = await bereiteKonvertierungVor(new Mediabunny.WebMOutputFormat(), w, h, verarbeite));
    }

    if (!conversion.isValid) {
      alert("Dein Browser kann dieses Video leider nicht umwandeln.");
      return;
    }

    conversion.onProgress = (fortschritt) => {
      videoKnopf.textContent = `Rendern … ${Math.round(fortschritt * 100)} %`;
    };

    await conversion.execute();

    ladeHerunter(new Blob([output.target.buffer], { type: mime }), `foto-effekte-${zeitstempel()}.${endung}`);
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

// ---------- Steuerung ----------

dateiFeld.addEventListener("change", () => {
  const datei = dateiFeld.files[0];
  if (!datei) return;

  if (datei.type.startsWith("video/")) {
    ladeVideo(datei);
  } else {
    ladeBild(datei);
  }
});

pixelFeld.addEventListener("input", () => {
  pixelgroesse = Number(pixelFeld.value);
  pixelWert.textContent = pixelgroesse;
  planeAnwenden();
});

ditherFeld.addEventListener("change", () => {
  ditherAn = ditherFeld.checked;
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
  planeAnwenden();
});

crtFeld.addEventListener("change", () => {
  crtAn = crtFeld.checked;
  planeAnwenden();
});

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

// ---------- Start ----------

zeigeModus("bild");