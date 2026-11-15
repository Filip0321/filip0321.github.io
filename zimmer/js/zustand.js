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
  rund: null, // Rundblick: steht im Mittelpunkt
  oben: null, // Draufsicht für den Grundriss
  draufsicht: false,

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

// Blickart: im Bearbeiten-Modus die aus der Leiste, sonst die aus zimmer.json
export const art = () => z.einst?.art ?? "parallax";

export function aktiveKamera() {
  if (z.draufsicht) return z.oben;
  return art() === "rundblick" && z.rund ? z.rund : z.kamera;
}

export const runde = (v) => Math.round(v * 1000) / 1000;

export function hexZuRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

const meldung = document.getElementById("meldung");
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
