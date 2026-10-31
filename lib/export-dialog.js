// Export-Fenster für alle Projekte: Rahmen, Format, Größe und eine Vorschau in voller Auflösung.
// Das Projekt bringt mit:
//   felder          (wahlweise) ein Element mit den eigenen Einstellungen (wird ins Fenster verschoben)
//   zeichneVorschau (allgemein, zeit) => Canvas: zeichnet das fertige Bild (zeit = null)
//                   oder ein Bild aus dem Video (zeit 0 bis 1)
//   zeitVorschau    false, wenn das Projekt kein Bild aus der Zukunft zeigen kann (Simulationen)
// Wer nur ein fertiges Canvas mit Rahmen braucht, nimmt mitRahmen(quelle, allgemein).
// Die allgemeinen Einstellungen merkt sich der Browser, für alle Projekte gemeinsam.

const SPEICHER = "export-dialog";
const STANDARD = { rahmen: "aus", rahmenBreite: 4, rahmenFarbe: "#ffffff", format: "frei", groesse: 2160 };
const FORMATE = { "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16, "16:9": 16 / 9 }; // Breite / Höhe

const gerade = (zahl) => zahl - (zahl % 2); // H.264 verlangt gerade Maße

// Rahmen um einen Inhalt breite × hoehe: wie groß wird das Ganze, wo sitzt der Inhalt?
// Breite in Prozent der kürzeren Seite, damit er bei hohen und breiten Bildern gleich wirkt
// format: "frei" oder ein festes Seitenverhältnis (Story 9:16 …): dann wird mit der Rahmenfarbe aufgefüllt,
// der Inhalt bleibt mittig und wird nie beschnitten
export function rahmenMasse(breite, hoehe, { rahmen, rahmenBreite, format = "frei" }) {
  let ganz = { breite, hoehe, x: 0, y: 0 };
  if (rahmen !== "aus") {
    const rand = (Math.min(breite, hoehe) * rahmenBreite) / 100;
    const unten = rahmen === "polaroid" ? rand * 4 : rand; // Polaroid: unten viel Platz zum Beschriften
    ganz = { breite: breite + 2 * rand, hoehe: hoehe + rand + unten, x: rand, y: rand };
  }
  const ziel = FORMATE[format];
  if (ziel) {
    if (ganz.breite / ganz.hoehe < ziel) {
      const neu = ganz.hoehe * ziel; // zu schmal: links und rechts auffüllen
      ganz = { ...ganz, x: ganz.x + (neu - ganz.breite) / 2, breite: neu };
    } else {
      const neu = ganz.breite / ziel; // zu breit: oben und unten auffüllen
      ganz = { ...ganz, y: ganz.y + (neu - ganz.hoehe) / 2, hoehe: neu };
    }
  }
  return ganz;
}

// Um wie viel muss etwas der Größe breite × hoehe wachsen oder schrumpfen, damit es in den Kasten passt?
// groesse ist die kürzere Seite wie bei "1080p", die längere darf 16/9 davon sein (2160 -> 3840 × 2160).
// Gilt quer und hochkant gleich: ein Hochformat in 4K wird also 2160 × 3840, nicht 1215 × 2160.
// groesse 0 = "wie es ist": nicht vergrößern, nur verkleinern, wenn es über 4K hinausgeht
export function massstab(breite, hoehe, { groesse }) {
  const kurz = groesse || 2160;
  const lang = Math.round((kurz * 16) / 9);
  const passt = Math.min(kurz / Math.min(breite, hoehe), lang / Math.max(breite, hoehe));
  return groesse ? passt : Math.min(1, passt);
}

// fertiges Canvas (Simulation, Spektrogramm …) mit Rahmen und Format in der gewählten Größe
// ziel: ein Canvas zum Wiederbenutzen (Video: jedes Bild in dasselbe), sonst ein neues
export function mitRahmen(quelle, einst, ziel = document.createElement("canvas")) {
  const ganz = rahmenMasse(quelle.width, quelle.height, einst);
  const s = massstab(ganz.breite, ganz.hoehe, einst);
  const breite = gerade(Math.round(ganz.breite * s));
  const hoehe = gerade(Math.round(ganz.hoehe * s));
  if (ziel.width !== breite || ziel.height !== hoehe) {
    ziel.width = breite; // nur bei Änderung: das Setzen leert den Canvas und kostet Zeit
    ziel.height = hoehe;
  }
  const c = ziel.getContext("2d");
  c.fillStyle = einst.rahmen === "aus" ? "#000000" : einst.rahmenFarbe; // ohne Rahmen füllt Schwarz das Format auf
  c.fillRect(0, 0, breite, hoehe);
  c.imageSmoothingQuality = "high";
  c.drawImage(quelle, Math.round(ganz.x * s), Math.round(ganz.y * s), Math.round(quelle.width * s), Math.round(quelle.height * s));
  return ziel;
}

function ladeEinstellungen() {
  try {
    return { ...STANDARD, ...JSON.parse(localStorage.getItem(SPEICHER)) }; // null ergibt nur STANDARD
  } catch {
    return { ...STANDARD }; // privates Fenster oder kaputter Eintrag: einfach die Standardwerte
  }
}

function merkeEinstellungen(werte) {
  try {
    localStorage.setItem(SPEICHER, JSON.stringify(werte));
  } catch {
    // geht nicht (z. B. privates Fenster): dann eben beim nächsten Mal wieder Standard
  }
}

export function erstelleExportDialog({ felder = null, zeichneVorschau, zeitVorschau = true }) {
  const dialog = document.createElement("dialog");
  dialog.className = "export-dialog";
  dialog.innerHTML = `
    <form method="dialog">
      <h2 class="gruppe export-titel"></h2>
      <div class="export-inhalt">
        <div class="export-vorschau"></div>
        <div class="export-felder">
          <div class="export-projekt"></div>
          <h3 class="gruppe">Rahmen</h3>
          <div class="steuerung">
            <label>Rahmen
              <select name="rahmen">
                <option value="aus">ohne</option>
                <option value="gleich">gleichmäßig</option>
                <option value="polaroid">Polaroid</option>
              </select>
            </label>
            <label>Breite
              <input type="range" name="rahmenBreite" min="1" max="15" step="0.5">
              <output class="rahmen-anzeige"></output>
            </label>
            <label>Farbe
              <select name="rahmenFarbe">
                <option value="#ffffff">weiß</option>
                <option value="#000000">schwarz</option>
              </select>
            </label>
          </div>
          <h3 class="gruppe">Format und Größe</h3>
          <div class="steuerung">
            <label>Format
              <select name="format">
                <option value="frei">wie das Bild</option>
                <option value="1:1">Quadrat 1:1</option>
                <option value="4:5">Hochformat 4:5</option>
                <option value="9:16">Story 9:16</option>
                <option value="16:9">Breitbild 16:9</option>
              </select>
            </label>
            <label>Größe
              <select name="groesse">
                <option value="0">wie es ist (nur verkleinern)</option>
                <option value="2160">4K (3840 × 2160)</option>
                <option value="1440">1440p (2560 × 1440)</option>
                <option value="1080">Full HD (1920 × 1080)</option>
                <option value="720">720p (1280 × 720)</option>
              </select>
            </label>
            <label class="nur-video export-zeit">Vorschau bei
              <input type="range" name="zeit" min="0" max="1" step="0.001" value="0.4">
            </label>
            <button type="button" class="export-zoom" aria-pressed="false">100 %</button>
          </div>
          <p class="hinweis export-groesse"></p>
          <div class="steuerung">
            <button value="abbrechen">Abbrechen</button>
            <button value="ok">Speichern</button>
          </div>
        </div>
      </div>
    </form>`;
  document.body.append(dialog);

  const form = dialog.querySelector("form");
  const titel = dialog.querySelector(".export-titel");
  const vorschau = dialog.querySelector(".export-vorschau");
  const groesse = dialog.querySelector(".export-groesse");
  const rahmenAnzeige = dialog.querySelector(".rahmen-anzeige");
  const zoom = dialog.querySelector(".export-zoom");
  const feld = (name) => form.elements.namedItem(name);

  if (felder) {
    dialog.querySelector(".export-projekt").append(felder); // verschieben, nicht kopieren: die ids bleiben gültig
    felder.hidden = false;
  }
  if (!zeitVorschau) dialog.querySelector(".export-zeit").remove(); // Simulationen kennen die Zukunft nicht

  // Startwerte aus dem Speicher in die Felder
  const gemerkt = ladeEinstellungen();
  for (const name of Object.keys(STANDARD)) feld(name).value = gemerkt[name];

  function lies() {
    return {
      rahmen: feld("rahmen").value,
      rahmenBreite: Number(feld("rahmenBreite").value),
      rahmenFarbe: feld("rahmenFarbe").value,
      format: feld("format").value,
      groesse: Number(feld("groesse").value),
    };
  }

  const istVideo = () => dialog.dataset.art === "video";

  // Vorschau neu zeichnen. Mehrere Änderungen in einem Bild werden zu einer (requestAnimationFrame),
  // und eine ältere, langsame Vorschau überschreibt nie eine neuere (nummer)
  let geplant = false;
  let nummer = 0;
  function plane() {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(async () => {
      geplant = false;
      const meine = ++nummer;
      const werte = lies();
      rahmenAnzeige.textContent = `${werte.rahmenBreite} %`;
      feld("rahmenBreite").disabled = werte.rahmen === "aus";
      try {
        const zeit = istVideo() && feld("zeit") ? Number(feld("zeit").value) : null;
        const bild = await zeichneVorschau(werte, zeit);
        if (meine !== nummer) return; // inzwischen wurde schon wieder etwas geändert
        vorschau.replaceChildren(bild);
        groesse.textContent = `${bild.width} × ${bild.height} Pixel`;
      } catch (fehler) {
        console.error(fehler);
        groesse.textContent = `Vorschau geht nicht: ${fehler.message}`;
      }
    });
  }

  // jede Änderung im Fenster, auch in den Feldern des Projekts, zeichnet die Vorschau neu
  form.addEventListener("input", plane);
  form.addEventListener("change", plane);

  // 100 %: ein Canvas-Pixel = ein Bildschirm-Pixel, mit Scrollen statt eingepasst
  zoom.addEventListener("click", () => {
    const voll = vorschau.classList.toggle("voll");
    zoom.setAttribute("aria-pressed", voll);
  });

  return {
    // öffnet das Fenster; ergibt die allgemeinen Einstellungen oder null (abgebrochen, Esc)
    oeffne({ art, ueberschrift }) {
      dialog.dataset.art = art; // "video" oder "bild", im CSS versteckt .nur-video beim Bild
      titel.textContent = ueberschrift;
      dialog.returnValue = "";
      dialog.showModal();
      plane();
      return new Promise((fertig) => {
        dialog.addEventListener("close", () => {
          if (dialog.returnValue !== "ok") return fertig(null);
          const werte = lies();
          merkeEinstellungen(werte);
          fertig(werte);
        }, { once: true });
      });
    },
    // das Projekt hat etwas geändert, das nicht in einem Feld steht (z. B. neue Stufen)
    aktualisiere: plane,
  };
}
