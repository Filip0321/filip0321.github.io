// Woher das Bild kommt: eine Videodatei oder die Kamera. Beides landet im selben <video>-Element,
// aus dem die Grafikkarte jedes neue Bild als Textur holt (gpu.js).
// Das <video> selbst hängt nicht auf der Seite, man sieht es nur über das Canvas.
// Immer dasselbe Element, weil der Originalton nur einmal pro Element in den AudioContext darf (klang.js).

import { erkenneDrehung } from "/lib/video-drehung.js";

export const video = document.createElement("video");
video.muted = true; // bis der Ton angeht: stumm, sonst blockiert der Browser das Abspielen
video.playsInline = true; // iPhone: nicht im Vollbild öffnen
video.loop = true;

let kamera = null; // MediaStream, solange die Kamera läuft
let adresse = null; // blob:… der geöffneten Datei
let datei = null; // die Datei selbst (für den Export: ihr Ton wird dann noch einmal dekodiert)
let ausrichtung = null; // { drehung, breite, hoehe }: was der Browser beim Hochladen nicht gedreht hat (video-drehung.js)

function aufraeumen() {
  kamera?.getTracks().forEach((spur) => spur.stop()); // Kamera-Lämpchen aus
  kamera = null;
  if (adresse) URL.revokeObjectURL(adresse);
  adresse = null;
  datei = null;
  ausrichtung = null;
  video.srcObject = null;
  video.removeAttribute("src");
}

// wartet, bis das erste Bild da ist (dann kennt das Video seine Größe)
function bereit() {
  return new Promise((fertig, fehler) => {
    video.onloadeddata = () => fertig(video);
    video.onerror = () => fehler(new Error("Dieses Video kann der Browser nicht abspielen (am Computer gehen MP4 mit H.264 und WebM)."));
  });
}

export async function oeffneDatei(neueDatei) {
  aufraeumen();
  datei = neueDatei;
  adresse = URL.createObjectURL(neueDatei);
  video.src = adresse;
  await bereit();
  // nachsehen, wie der Browser das Bild in die Textur legt (nicht beim ersten Bild: das ist oft schwarz)
  const zeit = Math.min(1, (video.duration || 0) / 3);
  await springe(zeit);
  ausrichtung = await erkenneDrehung(video, neueDatei, zeit);
  await video.play();
  return video;
}
export const holeAusrichtung = () => ausrichtung;

// vorne: die Kamera zum Gesicht (am Handy), sonst die Rückkamera
export async function oeffneKamera(vorne = true) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kamera geht nur auf https oder localhost.");
  aufraeumen();
  try {
    kamera = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: vorne ? "user" : "environment" },
    });
  } catch (fehler) {
    throw new Error(fehler.name === "NotAllowedError" ? "Kamera nicht erlaubt. Im Browser neben der Adresse freigeben." : `Kamera-Fehler: ${fehler.message}`);
  }
  video.srcObject = kamera;
  await bereit();
  await video.play();
  return video;
}

export const istKamera = () => Boolean(kamera);
export const geoeffneteDatei = () => datei;

// zu einer Zeit springen und warten, bis das Bild dort wirklich da ist (für den Export Bild für Bild)
export function springe(sekunden) {
  return new Promise((fertig) => {
    if (Math.abs(video.currentTime - sekunden) < 1e-4) return fertig();
    video.addEventListener("seeked", () => fertig(), { once: true });
    video.currentTime = sekunden;
  });
}

