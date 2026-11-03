// Die Sammlung: alle Effekte aus dem Fahrplan-Abschnitt „Shader und Effekte“, nach Gruppen in Dateien.
// Jeder Effekt ist nur eine Beschreibung, gebaut wird er von den Foto-Effekten (kette.js, sammlung-ui.js):
//
//   {
//     id, name, gruppe,
//     shader:  GLSL ab den eigenen uniforms (der Kopf unten kommt davor)   ┐ genau eins von beiden
//     cpu:     (bild: ImageData, werte, zeit) => ImageData                  ┘ (Linien und Geometrie: Canvas)
//     regler:  [{ gruppe, regler: [{ name, text, min, max, schritt, wert, ruhig? } | { name, text, auswahl }] }]
//     einstellungen?: (werte, zeit) => { name: Zahl | WebGLTexture }   (Standard: die Regler und die Zeit)
//     zeitabhaengig?: ändert sich mit der Zeit (Export eines Fotos als Video bewegt sich)
//     lebendig?:      bewegt sich schon in der Vorschau eines Fotos (Korn, Feedback)
//     nachher?:       () => nach dem Zeichnen (Feedback merkt sich dort sein Bild)
//   }
//
// Die Regler-Namen sind zugleich die Namen der uniforms: "staerke" im Regler → uniform float staerke.
// Auswahlfelder liefern die Nummer der Wahl als float (0.0, 1.0 …), im Shader also "if (modus < 0.5)".

import { FILM } from "./film.js";
import { DRUCK } from "./druck.js";
import { RAUM } from "./raum.js";
import { LICHT } from "./licht.js";
import { LINIEN } from "./linien.js";
import { PIXELSORT } from "./pixelsort.js";
import { BLOBS } from "./blobs.js";

export const SAMMLUNG = [...FILM, ...DRUCK, PIXELSORT, ...RAUM, ...LICHT, ...LINIEN, BLOBS];

