// Quellen: Videos und Standbilder als Clips. Für kodieren.js sehen beide gleich aus:
//   { id, art: "video" | "bild", name, datei, breite, hoehe, fps, dauer, groesse(maxBreite), ... }
// Dazu die Lage im Schnitt (schnitt.js), alles in Bildern bei der gemeinsamen Bildrate:
//   spur    0 = oberste Spur (gewinnt, wo sich Clips überlappen)
//   start   ab welchem Bild der Clip im Schnitt liegt (null = noch nicht gelegt, wird hinten angehängt)
//   von     erstes benutztes Bild des Clips (Anfang abgeschnitten)
//   laenge  wie viele Bilder davon (null = bis zum Ende)
//
// Standbild: Ein Bild hat keine Dauer, du gibst sie vor (sekunden). Kodiert wird es wie ein Video, in dem
// sich nichts bewegt: ein Keyframe, dann P-Frames ohne Bewegung. Interessant wird es erst im Mosh: Ein Bild
// ist die perfekte Leinwand für die Bewegung eines anderen Clips (dessen P-Frames, ohne dessen Keyframe).

import { oeffneVideo } from "/lib/video-quelle.js";

let naechsteId = 1;

const istBild = (datei) => datei.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(datei.name);

export async function oeffneClip(datei) {
  const lage = { id: naechsteId++, spur: 0, start: null, von: 0, laenge: null };
  if (!istBild(datei)) return Object.assign(await oeffneVideo(datei), { art: "video" }, lage);

  // imageOrientation: Handyfotos stehen sonst oft auf der Seite (die Drehung steht nur in den EXIF-Daten)
  const bitmap = await createImageBitmap(datei, { imageOrientation: "from-image" });
  const breite = bitmap.width;
  const hoehe = bitmap.height;
  return {
    ...lage,
    art: "bild",
    name: datei.name.replace(/\.[^.]+$/, ""),
    datei,
    bitmap,
    breite,
    hoehe,
    sekunden: 3, // wie lange das Bild steht (im Clip-Fenster einstellbar)
    get dauer() {
      return this.sekunden;
    },
    fps: null, // ein Bild hat keine eigene Bildrate, es nimmt die gemeinsame
    groesse(maxBreite) {
      const faktor = Math.min(1, maxBreite / breite);
      const gerade = (x) => Math.max(2, Math.round(x / 2) * 2);
      return { breite: gerade(breite * faktor), hoehe: gerade(hoehe * faktor) };
    },
  };
}
