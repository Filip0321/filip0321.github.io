import { gl, glCanvas, rendere } from "../../lib/webgl.js";
import { zustand } from "./zustand.js";
import { beiGeladen } from "./effekte/rahmen.js"
import { EFFEKTE, kette, aktiveSchritte, wendeEffekteAn, tausche, istZeitabhaengig } from "./kette.js";
import { richteFotoExportEin } from "./export.js";
import { berechneRahmen, zeichneQuelle } from "./quelle.js";
import { crtAnteil } from "/lib/effekte/crt.js";
import { verbindeRegler } from "/lib/effekt-regler.js"; // baut die Regler für VHS und CRT ins HTML, vor allem anderen
import { neuesOverlay,farbFlaeche, neuesFenster, trifft, stelleOverlaysAuf, stelleOverlaysZurueck, synchronisiere, gibOverlayFrei } from "./effekte/overlay.js";
// die ganzen HTML Elemente für die basic Einstellungen

const canvas = hole("bild");
const stapel = hole("stapel"); // um den Canvas, bekommt --verhaeltnis fürs Werkbank-Layout
const leer = hole("leer"); // "Bild oder Video öffnen", solange nichts geladen ist
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const overlayFeld = hole("overlay-datei");
// read frequently macht dass der canvas nicht auf die Grafikkarte gelegt wird,
// da er auch permanent verändert wird

// Die ganzen HTML Elemente schonmal holen dass ich sie einfach nutzen kann
const dateiFeld = hole("datei"); // upload Feld
const dateiLeerFeld = hole("datei-leer"); // dasselbe, im leeren Feld links

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
const fensterNeuKnopf = hole("fenster-neu");
const overlayWinkelFeld = hole("overlay-winkel");
const overlayWinkelWert = hole("overlay-winkel-wert");
const overlaySchattenFeld = hole("overlay-schatten");
const overlayVerhaeltnisLabel = hole("overlay-verhaeltnis-feld");
const overlayVerhaeltnisFeld = hole("overlay-verhaeltnis");
const overlayVerhaeltnisWert = hole("overlay-verhaeltnis-wert");
const overlayVersatzLabel = hole("overlay-versatz-feld");
const overlayVersatzFeld = hole("overlay-versatz");
const overlayDeckkraftFeld = hole("overlay-deckkraft");
const overlayDeckkraftWert = hole("overlay-deckkraft-wert");
const overlayMischmodusFeld = hole("overlay-mischmodus");
const overlayFuellungLabel = hole("overlay-fuellung-feld");
const overlayGefuelltFeld = hole("overlay-gefuellt");
const overlayFarbeFeld = hole("overlay-farbe");

let fensterNummer = 1;

let ausgewaehlt = null;   // der Zettel des gerade ausgewählten Overlays

const vergleichFeld = hole("vergleich"); // slider für vorher/nachher
const vergleichWert = hole("vergleichwert");

const abspielKnopf = hole("abspielen");

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

function passeCanvasAn(qw, qh) {
  const r = berechneRahmen(qw, qh);
  canvas.width = r.w;
  canvas.height = r.h;
  // Werkbank: das Bild wird so breit, dass es nie höher als der Bildschirm ist (css/canvas.css)
  stapel.style.setProperty("--verhaeltnis", r.w / r.h);
}

// statt des Platzhalters das Bild zeigen
function zeigeCanvas() {
  canvas.hidden = false;
  leer.hidden = true;
}

fensterNeuKnopf.addEventListener("click", () => {
  const schritt = neuesFenster(fensterNummer++);
  kette.push(schritt);
  ausgewaehlt = schritt;
  zeigeAuswahl();
  zeigeKette();
  planeAnwenden();
});

// Bild laden

async function ladeBild(datei) {
  stoppeVideo(); // falls ein Video schon spielt
  if (bitmap) bitmap.close(); // falls ein Bild schon existiert
  bitmap = await createImageBitmap(datei); // neues Bild laden

  bereiteBildVor();

  zeigeCanvas();
  zeigeModus("bild");
  wendeAn();
  exportKnoepfe.aktualisiere();
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
      zeigeCanvas();

      video = neuesVideo;
      zeigeModus("video");
      video.play();
      starteVideoSchleife(video);
      exportKnoepfe.aktualisiere();
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

function baueQuelleNeu() {
  if (video) {
    passeCanvasAn(video.videoWidth, video.videoHeight);
    zeichneVideobild();
  } else if (bitmap) {
    bereiteBildVor();
    wendeAn();
  }
}

// Kette anzeigen

const ketteListe = hole("kette");

function zeigeKette() {
  ketteListe.replaceChildren(); // liste leeren
  kette.forEach((schritt, i) => {
    // schritt ist in dem fall das gleiche wie kette[i]
    const effekt = EFFEKTE[schritt.typ];
    const name = schritt.name ?? effekt.name;

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
  if (!tausche(i, i + richtung)) return;
  zeigeKette();
  planeAnwenden();
}

zeigeKette();

overlayFeld.addEventListener("change", async () => {
  const datei = overlayFeld.files[0];
  if (!datei) return;

  try {
    const schritt = await neuesOverlay(datei);
    kette.push(schritt);
    ausgewaehlt = schritt;
    zeigeAuswahl();
    zeigeKette();
    planeAnwenden();
  } catch (fehler) {
    console.error(fehler);
    alert(fehler.message);
  } finally {
    overlayFeld.value = "";
  }
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
  
  for (const schritt of kette) {
    if (schritt.video) synchronisiere(schritt, zeit);
  }

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

function overlayVideoSchleife() {
  requestAnimationFrame(overlayVideoSchleife);
  if (!video && quelle && kette.some((schritt) => schritt.folge)) wendeAn();
}
requestAnimationFrame(overlayVideoSchleife);

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

// Export: das fertige Bild zur Zeit t, ohne Vergleichslinie (export.js zeichnet daraus Vorschau, Bild und Video)

const arbeit = document.createElement("canvas"); // eigener Canvas, die Anzeige bleibt, wie sie ist
const arbeitCtx = arbeit.getContext("2d", { willReadFrequently: true });

// Video an eine Stelle springen lassen und warten, bis das Bild dort da ist
function springe(v, t) {
  return new Promise((fertig) => {
    if (Math.abs(v.currentTime - t) < 0.001) return fertig();
    v.addEventListener("seeked", fertig, { once: true });
    v.currentTime = t;
  });
}

function zeigeErgebnis(bild) {
  if (arbeit.width !== bild.width || arbeit.height !== bild.height) {
    arbeit.width = bild.width;
    arbeit.height = bild.height;
  }
  arbeitCtx.putImageData(bild, 0, 0);
  return arbeit;
}

// gibt eine Funktion (t) => Canvas zurück; einmal pro Export-Fenster, weil die Effekte dann feststehen
function bildRechner() {
  if (video) {
    return async (t) => {
      await springe(video, Math.min(t, video.duration - 0.001));
      await stelleOverlaysAuf(kette, t);
      arbeit.width = canvas.width;
      arbeit.height = canvas.height;
      zeichneQuelle(arbeitCtx, video, video.videoWidth, video.videoHeight);
      return zeigeErgebnis(wendeEffekteAn(arbeitCtx.getImageData(0, 0, arbeit.width, arbeit.height), t));
    };
  }
  // Foto: alles bis zum ersten zeitabhängigen Effekt nur einmal rechnen
  const schritte = aktiveSchritte();
  let erster = schritte.findIndex(istZeitabhaengig);
  if (erster === -1) erster = schritte.length;
  const fest = wendeEffekteAn(quelle, 0, schritte.slice(0, erster));
  const bewegt = schritte.slice(erster);
  return async (t) => {
    await stelleOverlaysAuf(kette, t);
    return zeigeErgebnis(wendeEffekteAn(fest, t, bewegt));
  };
}

const exportKnoepfe = richteFotoExportEin({
  ziel: hole("export"),
  art: () => (video ? "video" : quelle ? "bild" : null),
  rechner: bildRechner,
  // ein Bild aus der Konvertierung (schon auf Canvas-Größe gebracht) durch die Effekte
  zeichneSample: async (sample, t) => {
    await stelleOverlaysAuf(kette, t);
    arbeit.width = canvas.width;
    arbeit.height = canvas.height;
    sample.draw(arbeitCtx, 0, 0);
    return zeigeErgebnis(wendeEffekteAn(arbeitCtx.getImageData(0, 0, arbeit.width, arbeit.height), t));
  },
  video: () => ({
    datei: videoDatei,
    dauer: video.duration,
    jetzt: video.currentTime,
    breite: canvas.width,
    hoehe: canvas.height,
    fit: { original: "fill", "4:3": "cover", balken: "contain" }[zustand.format],
  }),
  // solange das Fenster offen ist, steht das Video; danach läuft es weiter, wo es war
  anhalten: () => {
    if (!video) return () => stelleOverlaysZurueck(kette);
    const v = video;
    const lief = !v.paused;
    const stelle = v.currentTime;
    v.pause();
    return () => {
      stelleOverlaysZurueck(kette);
      if (v !== video) return; // inzwischen ein anderes geladen
      v.currentTime = stelle;
      if (lief) v.play();
    };
  },
  // CRT als letzter Effekt: dann gibt es gewölbte Ränder, die man abschneiden kann (sonst liegt etwas darüber)
  zuschnitt: () => (aktiveSchritte().at(-1)?.typ === "crt" ? crtAnteil(zustand.werte.crt.woelbung) : null),
  hintergrund: () => zustand.hintergrund,
  durchsichtig: () => zustand.transparent,
  sperre: (gesperrt) => {
    for (const element of [dateiFeld, dateiLeerFeld, overlayFeld, abspielKnopf]) element.disabled = gesperrt;
  },
});

// Buttons
// Listener

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

function ladeDatei(datei) {
  if (!datei) return;
  if (datei.type.startsWith("video/")) {
    ladeVideo(datei);
  } else if (datei.type.startsWith("image/")) {
    ladeBild(datei);
  }
} // wenn ein Video muss ich Video laden, sonst Bild

dateiFeld.addEventListener("change", () => ladeDatei(dateiFeld.files[0]));
dateiLeerFeld.addEventListener("change", () => ladeDatei(dateiLeerFeld.files[0]));

// Datei aufs Feld ziehen: dragover muss abgebrochen werden, sonst erlaubt der Browser kein drop
// (er würde die Datei selbst öffnen)
stapel.addEventListener("dragover", (e) => {
  e.preventDefault();
  stapel.classList.add("zieht-datei");
});
stapel.addEventListener("dragleave", () => stapel.classList.remove("zieht-datei"));
stapel.addEventListener("drop", (e) => {
  e.preventDefault();
  stapel.classList.remove("zieht-datei");
  ladeDatei(e.dataTransfer.files[0]);
});

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
  overlayWinkelFeld.value = ausgewaehlt.winkel;
  overlayWinkelWert.textContent = `${ausgewaehlt.winkel}°`;
  overlaySchattenFeld.checked = ausgewaehlt.schatten;
  // Höhe nur bei leeren Fenstern, sonst würde die Grafik verzerrt
  overlayVerhaeltnisLabel.hidden = ausgewaehlt.grafik !== null;
  overlayVerhaeltnisFeld.value = ausgewaehlt.verhaeltnis;
  overlayVerhaeltnisWert.textContent = ausgewaehlt.verhaeltnis;
  overlayVerhaeltnisLabel.hidden = !ausgewaehlt.leer;
  overlayFuellungLabel.hidden = !ausgewaehlt.leer;
  overlayGefuelltFeld.checked = Boolean(ausgewaehlt.fuellung);
  if (ausgewaehlt.fuellung) overlayFarbeFeld.value = ausgewaehlt.fuellung;
  overlayVersatzFeld.value = ausgewaehlt.versatz ?? 0;
  overlayDeckkraftFeld.value = ausgewaehlt.deckkraft;
  overlayDeckkraftWert.textContent = ausgewaehlt.deckkraft;
  overlayMischmodusFeld.value = ausgewaehlt.mischmodus;
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
  gibOverlayFrei(ausgewaehlt);
  kette.splice(kette.indexOf(ausgewaehlt), 1);   // genau diesen Zettel aus der Kette nehmen
  ausgewaehlt = null;
  zeigeAuswahl();
  zeigeKette();
  planeAnwenden();
});

overlayWinkelFeld.addEventListener("input", () => {
  ausgewaehlt.winkel = Number(overlayWinkelFeld.value);
  overlayWinkelWert.textContent = `${ausgewaehlt.winkel}°`;
  planeAnwenden();
});

overlaySchattenFeld.addEventListener("change", () => {
  ausgewaehlt.schatten = overlaySchattenFeld.checked;
  planeAnwenden();
});

overlayVerhaeltnisFeld.addEventListener("input", () => {
  ausgewaehlt.verhaeltnis = Number(overlayVerhaeltnisFeld.value);
  overlayVerhaeltnisWert.textContent = overlayVerhaeltnisFeld.value;
  planeAnwenden();
});

overlayVersatzFeld.addEventListener("input", () => {
  const zahl = Number(overlayVersatzFeld.value);
  if (!Number.isFinite(zahl) || zahl < 0) return;
  ausgewaehlt.versatz = zahl;
  // Vorschau ohne Hauptvideo: einmal auf die neue Startstelle springen
  if (!video) ausgewaehlt.video.currentTime = zahl % ausgewaehlt.dauer;
  planeAnwenden();
});

overlayDeckkraftFeld.addEventListener("input", () => {
  ausgewaehlt.deckkraft = Number(overlayDeckkraftFeld.value);
  overlayDeckkraftWert.textContent = overlayDeckkraftFeld.value;
  planeAnwenden();
});

overlayMischmodusFeld.addEventListener("change", () => {
  ausgewaehlt.mischmodus = overlayMischmodusFeld.value;
  planeAnwenden();
});

function setzeFuellung() {
  ausgewaehlt.fuellung = overlayGefuelltFeld.checked ? overlayFarbeFeld.value : null;
  ausgewaehlt.grafik = ausgewaehlt.fuellung ? farbFlaeche(ausgewaehlt.fuellung) : null;
  planeAnwenden();
}

overlayGefuelltFeld.addEventListener("change", setzeFuellung);
overlayFarbeFeld.addEventListener("input", () => {
  overlayGefuelltFeld.checked = true; // Farbe wählen heißt füllen
  setzeFuellung();
});

// auf Änderungen im HTML reagieren

// zustand.werte aus den Reglern übernehmen, bei jeder Änderung neu rechnen
// (die Regler für VHS und CRT baut /lib/effekt-regler.js, die für das Fenster stehen im HTML)
verbindeRegler(zustand.werte, planeAnwenden);

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



// Start
beiGeladen(planeAnwenden)
zeigeModus("bild"); // starte mit Bild, wenn Video wird es auch geändert
