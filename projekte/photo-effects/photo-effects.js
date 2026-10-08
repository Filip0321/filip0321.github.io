// ---------- Einstellungen ----------

const MAX_KANTE = 2400;

// ---------- Elemente ----------

const canvas = document.getElementById("bild");
const ctx = canvas.getContext("2d");
const dateiFeld = document.getElementById("datei");
const pixelFeld = document.getElementById("pixelgroesse");
const pixelWert = document.getElementById("pixelwert");
const ditherFeld = document.getElementById("dither-an");
const stufenFeld = document.getElementById("stufen");
const stufenWert = document.getElementById("stufenwert");
const grauFeld = document.getElementById("grau");
const crtFeld = document.getElementById("crt-an");
const vergleichFeld = document.getElementById("vergleich");
const vergleichWert = document.getElementById("vergleichwert");
const speichernKnopf = document.getElementById("speichern");
const abspielKnopf = document.getElementById("abspielen");

// ---------- Zustand ----------

let quelle = null;
let ergebnis = null;
let video = null;
let videoUrl = null;

let pixelgroesse = Number(pixelFeld.value);
let ditherAn = ditherFeld.checked;
let stufen = Number(stufenFeld.value);
let grau = grauFeld.checked;
let crtAn = crtFeld.checked;
let teilung = 0;
let geplant = false;

const crtWerte = {};

if (!gl) {
  crtFeld.disabled = true;
  crtFeld.parentElement.title = "Dein Browser unterstützt kein WebGL2.";
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

// ---------- Effekte ----------

// HIER kommen deine unveränderten Funktionen
// verkleinern, vergroessern und dithern hin.

// ---------- Anzeigen ----------

function zeichneTrennlinie(x, w, h) {
  const dicke = Math.max(2, Math.round(w / 400));
  ctx.fillStyle = "#ddd";
  ctx.fillRect(x - dicke / 2, 0, dicke, h);
}

function zeichneVideobild() {
  const w = canvas.width;
  const h = canvas.height;

  if (crtAn && gl) {
    rendere(video, w, h, { ...crtWerte, zufall: performance.now() / 1000 });
    ctx.drawImage(glCanvas, 0, 0);
  } else {
    ctx.drawImage(video, 0, 0, w, h);
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

  let bild = quelle;

  if (pixelgroesse > 1) {
    bild = verkleinern(bild, pixelgroesse);
  }

  if (ditherAn) {
    bild = dithern(bild, stufen, grau);
  }

  if (pixelgroesse > 1) {
    bild = vergroessern(bild, pixelgroesse, quelle.width, quelle.height);
  }

  if (crtAn) {
    bild = crt(bild, { ...crtWerte, zufall: 0 });
  }

  ergebnis = bild;
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

crtFeld.addEventListener("change", () => {
  crtAn = crtFeld.checked;
  planeAnwenden();
});

document.querySelectorAll("[data-crt]").forEach((feld) => {
  const name = feld.dataset.crt;
  const anzeige = feld.nextElementSibling;

  crtWerte[name] = Number(feld.value);
  anzeige.textContent = feld.value;

  feld.addEventListener("input", () => {
    crtWerte[name] = Number(feld.value);
    anzeige.textContent = feld.value;
    planeAnwenden();
  });
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
    if (blob) ladeHerunter(blob, `bildmaschine-${zeitstempel()}.png`);
  }, "image/png");
});

// ---------- Start ----------

zeigeModus("bild");

richteExportEin({
  canvas,
  ziel: document.querySelector(".export"),
  name: "bildmaschine"
});