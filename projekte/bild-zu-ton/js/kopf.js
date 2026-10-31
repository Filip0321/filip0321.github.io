const kopf = hole("kopf");
const ctx = kopf.getContext("2d");
const spieler = hole("spieler");
const stapel = hole("stapel"); 
const skalaZeigen = hole("skalaZeigen"); 
const rueckwaerts = hole("rueckwaerts"); // Häkchen: der Strich läuft von rechts nach links

const SKALA = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const KOPF_FARBE = "#dddddd"; 
const LINIEN_FARBE = "rgba(221, 221, 221, 0.3)"; 
const RAND_FARBE = "rgba(17, 17, 17, 0.8)"; 
const SCHRIFT = 12; 

let dpr = 2;
let skala = null; // { zeilen, tief, hoch } 
let laufId = null; 

export function passeGroesseAn() {
  dpr = Math.max(window.devicePixelRatio || 1, 2);
  kopf.width = Math.round(kopf.clientWidth * dpr);
  kopf.height = Math.round(kopf.clientHeight * dpr);
  zeichne(); 
}

export function setzeSkala(zeilen, tief, hoch) {
  skala = { zeilen, tief, hoch };
  zeichne();
}

function frequenzZuY(f, hoehe) {
  const { zeilen, tief, hoch } = skala;
  const zeilePos = ((zeilen - 1) * Math.log(f / tief)) / Math.log(hoch / tief); // 0 = unterste Zeile
  return ((zeilen - 1 - zeilePos + 0.5) / zeilen) * hoehe; // + 0,5: Mitte der Zeile, umgedreht wie im Bild
}

function beschriftung(frequenz) {
  return frequenz < 1000 ? `${frequenz}` : `${frequenz / 1000}k`;
}

export function zeichneSkala(c, breite, hoehe, massstab) {
  if (!skala || !skalaZeigen.checked) return; // noch kein Ton oder ausgeschaltet
  const linie = Math.round(massstab); 
  c.font = `${SCHRIFT * massstab}px monospace`; 
  c.textAlign = "left";
  c.textBaseline = "bottom"; 
  c.lineWidth = 3 * massstab;
  c.lineJoin = "round";
  for (const f of SKALA) {
    if (f < skala.tief || f > skala.hoch) continue; // nur was es im Ton auch gibt
    const y = Math.round(frequenzZuY(f, hoehe));
    c.fillStyle = LINIEN_FARBE;
    c.fillRect(0, y, breite, linie);
    const text = beschriftung(f);
    const x = 4 * massstab;
    c.strokeStyle = RAND_FARBE;
    c.strokeText(text, x, y - 2 * massstab); 
    c.fillStyle = KOPF_FARBE;
    c.fillText(text, x, y - 2 * massstab); 
  }
}

function zeichneLesekopf() {
  if (!Number.isFinite(spieler.duration) || spieler.duration === 0) return; // noch kein Ton (duration ist NaN)
  const breite = Math.round(dpr); 
  let anteil = spieler.currentTime / spieler.duration; // 0 am Anfang, 1 am Ende des Tons
  if (rueckwaerts.checked) anteil = 1 - anteil; // rückwärts: Anfang des Tons = rechter Rand
  const x = Math.round(anteil * kopf.width);
  const xImBild = Math.min(x, kopf.width - breite); // am Ende nicht über Rand
  ctx.fillStyle = RAND_FARBE;
  ctx.fillRect(xImBild - breite, 0, breite * 3, kopf.height); 
  ctx.fillStyle = KOPF_FARBE;
  ctx.fillRect(xImBild, 0, breite, kopf.height);
}

function zeichne() {
  ctx.clearRect(0, 0, kopf.width, kopf.height); // durchsichtig, das Bild darunter bleibt sichtbar
  zeichneSkala(ctx, kopf.width, kopf.height, dpr);
  zeichneLesekopf();
}

// jedes Bild neu zeichnen, solange der Player läuft
function laufe() {
  zeichne();
  laufId = requestAnimationFrame(laufe);
}

function halte() {
  cancelAnimationFrame(laufId);
  laufId = null;
  zeichne(); // einmal an der Stelle, wo angehalten wurde
}

skalaZeigen.addEventListener("change", zeichne);
rueckwaerts.addEventListener("change", zeichne);

spieler.addEventListener("play", () => {
  if (laufId === null) laufe(); // nicht zwei Schleifen gleichzeitig
});
spieler.addEventListener("pause", halte);
spieler.addEventListener("ended", halte);
spieler.addEventListener("seeked", zeichne); 
spieler.addEventListener("loadedmetadata", zeichne); // neuer Ton: Lesekopf zurück an den Anfang

// Klicken oder Ziehen im Bild
function zeitBeiZeiger(event) {
  const rahmen = stapel.getBoundingClientRect(); // Lage und Größe in CSS-Pixeln
  const anteil = Math.min(Math.max((event.clientX - rahmen.left) / rahmen.width, 0), 1); // 0 links, 1 rechts
  return (rueckwaerts.checked ? 1 - anteil : anteil) * spieler.duration; // rückwärts: rechts ist der Anfang
}

stapel.addEventListener("pointerdown", (event) => {
  if (!Number.isFinite(spieler.duration)) return; // noch kein Ton
  stapel.setPointerCapture(event.pointerId); // weiterziehen geht auch über den Rand hinaus
  spieler.currentTime = zeitBeiZeiger(event);
  zeichne();
});
stapel.addEventListener("pointermove", (event) => {
  if (!stapel.hasPointerCapture(event.pointerId)) return; // nur bei gedrückter Maus
  spieler.currentTime = zeitBeiZeiger(event);
  zeichne();
});
