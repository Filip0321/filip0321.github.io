// Übersicht der Sammlung mit Vorschaubildern: jeder Effekt als kleines Bild, gerechnet auf dem Bild, das gerade
// bearbeitet wird (oder einem Testbild, wenn es keins gibt). Ein Klick schaltet den Effekt an oder aus und
// klappt seine Regler auf. Gedacht als schneller Überblick statt dreißig Namen in fünf Gruppen.
//
// Die Bildchen entstehen erst beim Aufklappen (und bei jedem Aufklappen neu, damit sie zum Bild passen) und mit
// den Startwerten der Regler, nicht mit deinen: sie zeigen, was ein Effekt grundsätzlich macht.
// Gerechnet wird wie in der Kette: Shader auf der Grafikkarte (rendere), Canvas-Effekte auf dem Prozessor.

import { SAMMLUNG } from "./sammlung.js";
import { programmVon } from "./hilfen.js";
import { gl, rendere, glCanvas } from "/lib/webgl.js";
import { letzteFlecken, merkeFlecken } from "./instanzen.js";

const BREITE = 192; // gerechnet wird etwas größer als gezeigt, sonst sähen Raster und Pixel ganz anders aus
const HOEHE = 108;

// Startwerte eines Effekts aus seinen Reglern
function startwerte(def) {
  const w = {};
  for (const g of def.regler) for (const r of g.regler) w[r.name] = r.wert ?? 0;
  return w;
}

// Testbild, wenn die Seite noch kein Bild hat: Verlauf mit ein paar Formen, damit jeder Effekt etwas zu tun hat
function testbild() {
  const c = document.createElement("canvas");
  c.width = BREITE;
  c.height = HOEHE;
  const ctx = c.getContext("2d");
  const verlauf = ctx.createLinearGradient(0, 0, BREITE, HOEHE);
  verlauf.addColorStop(0, "#1b2a6b");
  verlauf.addColorStop(0.5, "#c2410c");
  verlauf.addColorStop(1, "#fde68a");
  ctx.fillStyle = verlauf;
  ctx.fillRect(0, 0, BREITE, HOEHE);
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.arc(BREITE * 0.3, HOEHE * 0.5, HOEHE * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(BREITE * 0.6, HOEHE * 0.2, BREITE * 0.25, HOEHE * 0.6);
  return c;
}

// ein Vorschaubild: quelle (BREITE × HOEHE) durch den Effekt
function vorschau(def, quelle, ziel) {
  const ctx = ziel.getContext("2d", { willReadFrequently: true });
  const werte = startwerte(def);
  const g = def.neuesGedaechtnis?.() ?? {};
  try {
    if (def.shader) {
      if (!gl) return;
      const einst = def.einstellungen ? def.einstellungen(werte, 1.5, g) : { ...werte, zeit: 1.5 };
      rendere(programmVon(def), quelle, BREITE, HOEHE, einst);
      def.nachher?.(g); // Pixel Sorting sortiert erst hier
      ctx.drawImage(glCanvas, 0, 0);
    } else if (def.cpu) {
      ctx.drawImage(quelle, 0, 0);
      const rahmen = letzteFlecken(); // Blob-Tracking merkt sich seine Rahmen für „Bereich“: das Bildchen soll sie nicht überschreiben
      ctx.putImageData(def.cpu(ctx.getImageData(0, 0, BREITE, HOEHE), werte, 1.5, g), 0, 0);
      if (rahmen) merkeFlecken(rahmen.flecken, rahmen.breite, rahmen.hoehe);
    }
  } finally {
    def.gibFrei?.(g); // Feedbacks Textur wieder weg
  }
}

// ziel: wohin die Übersicht kommt (vor die Gruppen); vorschauQuelle: () => Canvas oder null
export function baueEffektMenue(ziel, { vorschauQuelle = () => null, nurGpu = false }) {
  const abschnitt = document.createElement("details");
  abschnitt.className = "regler-gruppe effekt-menue";
  abschnitt.innerHTML = `<summary>Übersicht mit Bildern</summary><div class="effekt-kacheln"></div>`;
  ziel.prepend(abschnitt);
  const kacheln = abschnitt.querySelector(".effekt-kacheln");

  const knoepfe = [];
  for (const def of SAMMLUNG) {
    if (nurGpu && !def.shader) continue;
    const k = document.createElement("button");
    k.type = "button";
    k.className = "effekt-kachel";
    const bild = document.createElement("canvas");
    bild.width = BREITE;
    bild.height = HOEHE;
    const name = document.createElement("span");
    name.textContent = def.name;
    k.append(bild, name);
    k.addEventListener("click", () => {
      const schalter = document.getElementById(`${def.id}-an`);
      if (!schalter || schalter.disabled) return;
      schalter.checked = !schalter.checked;
      schalter.dispatchEvent(new Event("change"));
      k.setAttribute("aria-pressed", schalter.checked);
      // die Regler zeigen: Gruppe auf, hinscrollen
      const gruppe = schalter.closest("details.regler-gruppe");
      if (gruppe && schalter.checked) {
        gruppe.open = true;
        schalter.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    kacheln.append(k);
    knoepfe.push({ def, k, bild });
  }

  abschnitt.addEventListener("toggle", () => {
    if (!abschnitt.open) return;
    // die Quelle auf Vorschaugröße bringen (mittig zugeschnitten, wie object-fit: cover)
    const roh = vorschauQuelle() ?? testbild();
    const quelle = document.createElement("canvas");
    quelle.width = BREITE;
    quelle.height = HOEHE;
    const f = Math.max(BREITE / roh.width, HOEHE / roh.height);
    quelle.getContext("2d").drawImage(roh, (BREITE - roh.width * f) / 2, (HOEHE - roh.height * f) / 2, roh.width * f, roh.height * f);
    // eins nach dem anderen, damit die Seite nicht für alle dreißig stehen bleibt
    let i = 0;
    const naechstes = () => {
      if (i >= knoepfe.length || !abschnitt.open) return;
      const { def, k, bild } = knoepfe[i++];
      k.setAttribute("aria-pressed", Boolean(document.getElementById(`${def.id}-an`)?.checked));
      vorschau(def, quelle, bild);
      requestAnimationFrame(naechstes);
    };
    naechstes();
  });
}
