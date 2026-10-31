// Export-Fenster für alle Projekte: Rahmen, Videobreite und eine Vorschau in voller Auflösung.
// Das Projekt bringt zwei Dinge mit:
//   felder          ein Element aus seinem HTML mit den eigenen Einstellungen (wird ins Fenster verschoben)
//   zeichneVorschau (allgemein, zeit) => Canvas: zeichnet das fertige Bild (zeit = null)
//                   oder ein Bild aus dem Video (zeit 0 bis 1)
// Die allgemeinen Einstellungen merkt sich der Browser, für alle Projekte gemeinsam.

const SPEICHER = "export-dialog";
const STANDARD = { rahmen: "aus", rahmenBreite: 4, rahmenFarbe: "#ffffff", groesse: 2160 };

// Rahmen um einen Inhalt breite × hoehe: wie groß wird das Ganze, wo sitzt der Inhalt?
// Breite in Prozent der kürzeren Seite, damit er bei hohen und breiten Bildern gleich wirkt
export function rahmenMasse(breite, hoehe, { rahmen, rahmenBreite }) {
  if (rahmen === "aus") return { breite, hoehe, x: 0, y: 0 };
  const rand = (Math.min(breite, hoehe) * rahmenBreite) / 100;
  const unten = rahmen === "polaroid" ? rand * 4 : rand; // Polaroid: unten viel Platz zum Beschriften
  return { breite: breite + 2 * rand, hoehe: hoehe + rand + unten, x: rand, y: rand };
}

// Um wie viel muss etwas der Größe breite × hoehe wachsen oder schrumpfen, damit es in den Kasten passt?
// groesse ist die kürzere Seite wie bei "1080p", die längere darf 16/9 davon sein (2160 -> 3840 × 2160).
// Gilt quer und hochkant gleich: ein Hochformat in 4K wird also 2160 × 3840, nicht 1215 × 2160.
export function massstab(breite, hoehe, { groesse }) {
  const kurz = groesse;
  const lang = Math.round((groesse * 16) / 9);
  return Math.min(kurz / Math.min(breite, hoehe), lang / Math.max(breite, hoehe));
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

export function erstelleExportDialog({ felder, zeichneVorschau }) {
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
          <h3 class="gruppe">Größe</h3>
          <div class="steuerung">
            <label>Größe
              <select name="groesse">
                <option value="2160">4K (3840 × 2160)</option>
                <option value="1440">1440p (2560 × 1440)</option>
                <option value="1080">Full HD (1920 × 1080)</option>
                <option value="720">720p (1280 × 720)</option>
              </select>
            </label>
            <label class="nur-video">Vorschau bei
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

  dialog.querySelector(".export-projekt").append(felder); // verschieben, nicht kopieren: die ids bleiben gültig
  felder.hidden = false;

  // Startwerte aus dem Speicher in die Felder
  const gemerkt = ladeEinstellungen();
  for (const name of Object.keys(STANDARD)) feld(name).value = gemerkt[name];

  function lies() {
    return {
      rahmen: feld("rahmen").value,
      rahmenBreite: Number(feld("rahmenBreite").value),
      rahmenFarbe: feld("rahmenFarbe").value,
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
        const bild = await zeichneVorschau(werte, istVideo() ? Number(feld("zeit").value) : null);
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
