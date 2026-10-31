// Export-Fenster für alle Projekte: Rahmen, Format, Größe und eine Vorschau in voller Auflösung.
// Das Projekt bringt mit:
//   felder          (wahlweise) ein Element mit den eigenen Einstellungen (wird ins Fenster verschoben)
//   zeichneVorschau (allgemein, zeit) => Canvas: zeichnet das fertige Bild (zeit = null)
//                   oder ein Bild aus dem Video (zeit 0 bis 1)
// Beim Video gibt es eine Zeitleiste: "Vorschau bei" zum Durchscrubben und einen Bereich (von, bis, als Anteil
// 0 bis 1); außerhalb des Bereichs zeigt die Vorschau das Bild abgedunkelt. Was davon zu sehen ist, sagt oeffne().
//   zuschnitt       (wahlweise) () => Anteil oder null: bei CRT mit Wölbung bietet das Fenster an,
//                   die gewölbten Ränder gerade abzuschneiden (der Rahmen liegt dann darüber)
// Wer nur ein fertiges Canvas mit Rahmen braucht, nimmt mitRahmen(quelle, allgemein).
// Die allgemeinen Einstellungen merkt sich der Browser, für alle Projekte gemeinsam.

const SPEICHER = "export-dialog";
const STANDARD = { rahmen: "aus", rahmenBreite: 4, rahmenFarbe: "#ffffff", format: "frei", groesse: 2160, bildTyp: "png", videoTyp: "mp4", crtGerade: true };
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
// anteil: nur die Mitte zeigen (z. B. 0,9 = 90 % der Breite und Höhe; CRT gerade abschneiden), sonst alles;
//         steht schon in einst.anteil, wenn die Einstellungen aus dem Fenster kommen
// einst.durchsichtig: ohne Rahmen bleibt Durchsichtiges durchsichtig (PNG der Foto-Effekte), sonst schwarz
export function mitRahmen(quelle, einst, ziel = document.createElement("canvas"), anteil = einst.anteil ?? 1) {
  const qBreite = quelle.width * anteil;
  const qHoehe = quelle.height * anteil;
  const qx = (quelle.width - qBreite) / 2;
  const qy = (quelle.height - qHoehe) / 2;
  const ganz = rahmenMasse(qBreite, qHoehe, einst);
  const s = massstab(ganz.breite, ganz.hoehe, einst);
  const breite = gerade(Math.round(ganz.breite * s));
  const hoehe = gerade(Math.round(ganz.hoehe * s));
  if (ziel.width !== breite || ziel.height !== hoehe) {
    ziel.width = breite; // nur bei Änderung: das Setzen leert den Canvas und kostet Zeit
    ziel.height = hoehe;
  }
  const c = ziel.getContext("2d");
  if (einst.rahmen === "aus" && einst.durchsichtig) {
    c.clearRect(0, 0, breite, hoehe); // auch das vorige Bild weg, wenn der Canvas wiederbenutzt wird
  } else {
    c.fillStyle = einst.rahmen === "aus" ? "#000000" : einst.rahmenFarbe; // ohne Rahmen füllt Schwarz das Format auf
    c.fillRect(0, 0, breite, hoehe);
  }
  c.imageSmoothingQuality = "high";
  c.drawImage(quelle, qx, qy, qBreite, qHoehe,
    Math.round(ganz.x * s), Math.round(ganz.y * s), Math.round(qBreite * s), Math.round(qHoehe * s));
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

// 75,3 -> "1:15,3" (für die Zeitleiste)
function alsZeit(sekunden) {
  const m = Math.floor(sekunden / 60);
  return `${m}:${(sekunden - m * 60).toFixed(1).replace(".", ",").padStart(4, "0")}`;
}

export function erstelleExportDialog({ felder = null, zeichneVorschau, zuschnitt = () => null }) {
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
            <label class="export-crt"><input type="checkbox" name="crtGerade"> CRT: Rahmen über die gewölbten Ränder</label>
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
            <label class="nur-bild">Datei
              <select name="bildTyp">
                <option value="png">PNG (verlustfrei)</option>
                <option value="webp">WebP (klein, fürs Web)</option>
              </select>
            </label>
            <label class="nur-video">Datei
              <select name="videoTyp">
                <option value="mp4">MP4 (überall, auch Handy und WhatsApp)</option>
                <option value="webm">WebM (klein, fürs Web)</option>
              </select>
            </label>
            <button type="button" class="export-zoom" aria-pressed="false">100 %</button>
          </div>
          <div class="export-zeitleiste">
            <h3 class="gruppe">Zeit</h3>
            <div class="steuerung">
              <label>Vorschau bei
                <input type="range" name="zeit" min="0" max="1" step="0.001" value="0">
                <output class="zeit-anzeige"></output>
              </label>
              <label class="export-bereich">von
                <input type="range" name="von" min="0" max="1" step="0.001" value="0">
                <output class="von-anzeige"></output>
              </label>
              <label class="export-bereich">bis
                <input type="range" name="bis" min="0" max="1" step="0.001" value="1">
                <output class="bis-anzeige"></output>
              </label>
            </div>
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
  const zeitleiste = dialog.querySelector(".export-zeitleiste");
  const bereichFelder = dialog.querySelectorAll(".export-bereich");
  let mitZeit = false; // gerade eine Zeitleiste zu sehen?
  let mitBereich = false;
  let dauer = null; // Sekunden für die Anzeige (Zahl oder Funktion), sonst Prozent

  // von darf nicht über bis: der gezogene Regler schiebt den anderen mit
  for (const [gezogen, anderer] of [["von", "bis"], ["bis", "von"]]) {
    feld(gezogen).addEventListener("input", () => {
      const von = Number(feld("von").value);
      const bis = Number(feld("bis").value);
      if (von > bis) feld(anderer).value = feld(gezogen).value;
    });
  }

  function zeigeZeiten() {
    const sekunden = typeof dauer === "function" ? dauer() : dauer;
    const text = (anteil) => (sekunden ? alsZeit(anteil * sekunden) : `${Math.round(anteil * 100)} %`);
    dialog.querySelector(".zeit-anzeige").textContent = text(Number(feld("zeit").value));
    dialog.querySelector(".von-anzeige").textContent = text(Number(feld("von").value));
    dialog.querySelector(".bis-anzeige").textContent = text(Number(feld("bis").value));
  }

  const crtFeld = dialog.querySelector(".export-crt");
  let anteilCrt = null; // beim Öffnen gefragt: wie viel bliebe ohne die gewölbten Ränder (null = kein CRT)

  // Startwerte aus dem Speicher in die Felder (beim Häkchen zählt checked, nicht value)
  const gemerkt = ladeEinstellungen();
  for (const name of Object.keys(STANDARD)) {
    if (feld(name).type === "checkbox") feld(name).checked = gemerkt[name];
    else feld(name).value = gemerkt[name];
  }

  function lies() {
    return {
      rahmen: feld("rahmen").value,
      rahmenBreite: Number(feld("rahmenBreite").value),
      rahmenFarbe: feld("rahmenFarbe").value,
      format: feld("format").value,
      groesse: Number(feld("groesse").value),
      bildTyp: feld("bildTyp").value, // "png" oder "webp"
      videoTyp: feld("videoTyp").value, // "mp4" oder "webm"
      crtGerade: feld("crtGerade").checked,
      // Anteil, der mittig bleibt: mit Häkchen und CRT ohne die schwarzen, gewölbten Ränder, sonst alles
      anteil: anteilCrt !== null && feld("crtGerade").checked ? anteilCrt : 1,
      von: mitBereich ? Number(feld("von").value) : 0, // Anteil des Videos, ohne Bereich das Ganze
      bis: mitBereich ? Number(feld("bis").value) : 1,
    };
  }

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
        zeigeZeiten();
        const zeit = mitZeit ? Number(feld("zeit").value) : null;
        const bild = await zeichneVorschau(werte, zeit);
        if (meine !== nummer) return; // inzwischen wurde schon wieder etwas geändert
        const draussen = zeit !== null && (zeit < werte.von || zeit > werte.bis);
        if (draussen) {
          // außerhalb des Bereichs: dunkler, dieses Bild kommt nicht ins Video
          const c = bild.getContext("2d");
          c.fillStyle = "rgba(0, 0, 0, 0.65)";
          c.fillRect(0, 0, bild.width, bild.height);
        }
        vorschau.replaceChildren(bild);
        groesse.textContent = `${bild.width} × ${bild.height} Pixel${draussen ? " · außerhalb des Bereichs" : ""}`;
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
    // zeit: Zeitleiste zum Scrubben (Standard beim Video), bereich: von und bis (Standard: wie zeit)
    // laenge: Sekunden des Videos (Zahl oder Funktion) für die Anzeige, sonst Prozent
    // bereichStart: [von, bis] als Anteil, wenn das Projekt schon einen Bereich hat (sonst das Ganze)
    oeffne({ art, ueberschrift, zeit = art === "video", bereich = zeit, laenge = null, bereichStart = [0, 1] }) {
      dialog.dataset.art = art; // "video" oder "bild", im CSS versteckt .nur-video beim Bild
      titel.textContent = ueberschrift;
      mitZeit = zeit;
      mitBereich = zeit && bereich;
      dauer = laenge;
      anteilCrt = zuschnitt(); // einmal pro Öffnen, damit sich die Größe während des Videos nicht ändert
      crtFeld.hidden = anteilCrt === null; // ohne CRT (oder bei Wölbung nach innen) gibt es nichts abzuschneiden
      zeitleiste.hidden = !mitZeit;
      for (const f of bereichFelder) f.hidden = !mitBereich;
      feld("von").value = bereichStart[0]; // sonst fängt jedes Video mit dem Ganzen an
      feld("bis").value = bereichStart[1];
      feld("zeit").value = bereichStart[0]; // die Vorschau steht am Anfang des Bereichs
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
