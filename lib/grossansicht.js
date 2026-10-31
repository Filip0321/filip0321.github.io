// Großansicht für Fotoserien: Klick auf ein Bild öffnet es groß in einem <dialog>,
// mit Bildunterschrift, Blättern (Knöpfe, Pfeiltasten, Wischen) und Schließen (Esc, Klick daneben, ×).
// Ohne JavaScript öffnet der Link wie bisher einfach die Bilddatei.
//
// Gilt für jede Sammlung auf der Seite (.pinnwand, .mosaik, .galerie), jede für sich:
//   <div class="pinnwand">
//     <figure>
//       <a href="001.webp"><img src="001.webp" alt="…"></a>
//       <figcaption>…</figcaption>   (wahlweise)
//     </figure>
//   </div>

const WISCHEN = 50; // so viele Pixel waagerecht, dann zählt es als Wischen

function baueDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "grossansicht";
  dialog.innerHTML = `
    <figure>
      <img alt="">
      <figcaption></figcaption>
    </figure>
    <p class="grossansicht-zaehler"></p>
    <button type="button" class="grossansicht-zurueck" aria-label="voriges Bild">←</button>
    <button type="button" class="grossansicht-weiter" aria-label="nächstes Bild">→</button>
    <button type="button" class="grossansicht-zu" aria-label="schließen">×</button>`;
  document.body.append(dialog);
  return dialog;
}

function richteEin(sammlung) {
  const links = [...sammlung.querySelectorAll("figure > a")];
  if (links.length === 0) return;

  const dialog = baueDialog();
  const bild = dialog.querySelector("img");
  bild.draggable = false; // sonst greift die Maus beim Wischen das Bild (Drag & Drop) und pointerup kommt nie
  const text = dialog.querySelector("figcaption");
  const zaehler = dialog.querySelector(".grossansicht-zaehler");
  let jetzt = 0;

  function zeige(i) {
    jetzt = (i + links.length) % links.length; // am Ende wieder vorn, vor dem ersten das letzte
    const link = links[jetzt];
    const vorschau = link.querySelector("img");
    bild.src = link.href; // die große Datei, auf die der Link zeigt
    bild.alt = vorschau?.alt ?? "";
    text.textContent = link.closest("figure").querySelector("figcaption")?.textContent ?? "";
    text.hidden = text.textContent === "";
    zaehler.textContent = `${jetzt + 1} / ${links.length}`;
    // das nächste Bild schon laden, dann ist es beim Weiterblättern sofort da
    new Image().src = links[(jetzt + 1) % links.length].href;
  }

  links.forEach((link, i) => {
    link.addEventListener("click", (e) => {
      e.preventDefault(); // nicht zur Bilddatei springen
      zeige(i);
      dialog.showModal(); // modal: Esc schließt, der Rest der Seite ist gesperrt
    });
  });

  dialog.querySelector(".grossansicht-zurueck").addEventListener("click", () => zeige(jetzt - 1));
  dialog.querySelector(".grossansicht-weiter").addEventListener("click", () => zeige(jetzt + 1));
  dialog.querySelector(".grossansicht-zu").addEventListener("click", () => dialog.close());

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") zeige(jetzt - 1);
    if (e.key === "ArrowRight") zeige(jetzt + 1);
  });

  // Wischen am Handy: Startpunkt merken, beim Loslassen den Abstand ansehen
  let start = null;
  let gewischt = false; // nach dem Wischen kommt noch ein click, der soll nicht schließen

  // Klick neben das Bild (auf den dunklen Hintergrund des Dialogs) schließt
  dialog.addEventListener("click", (e) => {
    if (gewischt) {
      gewischt = false;
      return;
    }
    if (e.target === dialog || e.target.tagName === "FIGURE") dialog.close();
  });

  dialog.addEventListener("pointerdown", (e) => {
    start = e.clientX;
  });
  dialog.addEventListener("pointerup", (e) => {
    if (start === null) return;
    const weg = e.clientX - start;
    start = null;
    gewischt = Math.abs(weg) > WISCHEN;
    if (weg > WISCHEN) zeige(jetzt - 1); // nach rechts gewischt: das Bild davor
    if (weg < -WISCHEN) zeige(jetzt + 1);
  });

  // nach dem Schließen das große Bild loslassen (spart Speicher bei vielen Fotos)
  dialog.addEventListener("close", () => {
    bild.removeAttribute("src");
  });
}

document.querySelectorAll(".pinnwand, .mosaik, .galerie").forEach(richteEin);
