// Was sich alle Teile des Zimmers teilen: ein Objekt z, das jedes Modul importiert. So muss kein Modul ein anderes
// kennen (keine Kreise beim Importieren); wer etwas ändert, ruft neu() und das Bild wird beim nächsten Durchlauf
// der Schleife neu gezeichnet.

export const z = {
  canvas: document.getElementById("zimmer"),
  ebene: document.getElementById("dinge"), // die Links über den Gegenständen

  einst: null, // zimmer.json
  roh: null, // die Szene, wie geladen und gedreht
  szene: null, // was gezeigt wird (roh, oder zugeschnitten auf den Grundriss)

  kamera: null, // Parallaxe und frei: kreist um ein Ziel
  rund: null, // Rundblick und Herumgehen: steht im Mittelpunkt (beim Gehen wandert sie)
  ed: null, // Bearbeiten: eigene, frei bewegliche Kamera (der Startblick der Besucher bleibt davon unberührt)
  edAn: true, // im Bearbeiten-Modus mit der eigenen Kamera arbeiten (aus: so sehen, wie Besucher es sehen)
  cursor: null, // Bearbeiten: 3D-Cursor wie in Blender (Ecken und Gegenstände entstehen hier, wenn nichts getroffen wird)
  werkzeug: { nah: 0, kugel: 0, roentgen: 1 }, // Bearbeiten: Schnitt vor der Kamera, Kugel um die Auswahl, Röntgen
  oben: null, // Draufsicht für den Grundriss
  draufsicht: false,
  zeig: null, // „Zeigen“: kreist um einen Gegenstand, solange sein Text zu sehen ist (dinge.js)

  dinge: [], // { name, link, lage, radius, element }
  hervor: null, // Gegenstand unter der Maus
  gewaehlt: null, // im Bearbeiten-Modus ausgewählt
  bearbeiten: new URLSearchParams(location.search).has("bearbeiten"),
  abfangen: null, // Bearbeiten: Funktion, die einen Klick ins Bild übernimmt (gibt true zurück, wenn ja)
  letzteEingabe: 0, // Zeitpunkt der letzten Bewegung (Rundblick dreht sich erst nach einer Pause von allein)

  neu: true, // neu zeichnen
  beiNeuerSzene: null, // setzt main.js: Szene zur Grafikkarte und zum Sortieren schicken
};

export const neu = () => (z.neu = true);

// Blickart der Besucher aus zimmer.json; im Bearbeiten-Modus mit eigener Kamera immer „frei“
export const editorKamera = () => z.bearbeiten && z.edAn && !!z.ed;
export const art = () => (editorKamera() ? "frei" : z.einst?.art ?? "parallax");

export function aktiveKamera() {
  if (z.draufsicht) return z.oben;
  if (z.zeig) return z.zeig;
  if (editorKamera()) return z.ed;
  return (art() === "rundblick" || art() === "begehen") && z.rund ? z.rund : z.kamera;
}

export const runde = (v) => Math.round(v * 1000) / 1000;

export function hexZuRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

const meldung = document.getElementById("meldung");
z.zeigeMeldung = (...a) => zeige(...a);
let uhr = 0;
export function zeige(text, dauer = 0) {
  meldung.textContent = text;
  meldung.hidden = !text;
  clearTimeout(uhr);
  if (dauer) uhr = setTimeout(() => (meldung.hidden = true), dauer);
}

// Punkt auf dem Bildschirm (CSS-Pixel relativ zum Canvas) → Bildpixel
export function bildpunkt(ev) {
  const r = z.canvas.getBoundingClientRect();
  return [((ev.clientX - r.left) / r.width) * z.canvas.width, ((ev.clientY - r.top) / r.height) * z.canvas.height];
}
