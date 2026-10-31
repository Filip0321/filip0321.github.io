// Fußnoten als Randnoten: im HTML stehen die Fußnoten ganz normal am Ende (<section class="fussnoten">).
// So gehen sie überall: ohne JavaScript, in der Leseansicht, beim Drucken, mit Screenreader.
// Ist der Bildschirm breit genug, setzt dieses Skript eine Kopie jeder Fußnote an den Rand,
// genau auf die Höhe ihrer Stelle im Text, und versteckt die Liste am Ende (nur fürs Auge).
//
// HTML dazu (Nummern und ids von Hand, damit sie auch ohne JavaScript stimmen):
//   <p>… ein Satz<sup class="fussnote"><a href="#fn-1" id="ref-1">1</a></sup> …</p>
//   …
//   <section class="fussnoten">
//     <h2>Anmerkungen</h2>
//     <ol>
//       <li id="fn-1"><p>Text der Fußnote. <a href="#ref-1" aria-label="zurück zum Text">↩</a></p></li>
//     </ol>
//   </section>

const BREIT = window.matchMedia("(min-width: 80rem)"); // ab hier passt rechts neben 65ch noch eine Spalte
const ABSTAND = 12; // Pixel zwischen zwei Randnoten, die sich sonst überlappen würden

function richteEin(artikel) {
  const verweise = [...artikel.querySelectorAll("sup.fussnote a[href^='#fn-']")];
  if (verweise.length === 0) return;

  // zu jedem Verweis die Randnote bauen: Nummer + Inhalt der Fußnote, ohne den Zurück-Pfeil
  const paare = verweise.map((verweis) => {
    const fussnote = artikel.querySelector(verweis.getAttribute("href")); // "#fn-1" ist schon ein Selektor
    const randnote = document.createElement("aside");
    randnote.className = "randnote";
    randnote.setAttribute("aria-hidden", "true"); // Screenreader lesen die Liste am Ende, nicht die Kopie doppelt
    randnote.innerHTML = fussnote.innerHTML;
    randnote.querySelectorAll("a[href^='#ref-']").forEach((zurueck) => zurueck.remove());
    // die Nummer vorn in den ersten Absatz, damit sie in derselben Zeile steht wie der Text
    const nummer = document.createElement("span");
    nummer.className = "randnote-nummer";
    nummer.textContent = `${verweis.textContent} `;
    (randnote.querySelector("p") ?? randnote).prepend(nummer);
    artikel.append(randnote);
    return { verweis, randnote };
  });

  // Höhe jeder Randnote = Höhe ihres Verweises im Artikel; liegt die vorige noch im Weg, darunter
  function setze() {
    artikel.classList.toggle("mit-rand", BREIT.matches);
    if (!BREIT.matches) return;
    const oben = artikel.getBoundingClientRect().top;
    let frei = 0; // ab hier ist der Rand wieder frei
    for (const { verweis, randnote } of paare) {
      const soll = verweis.getBoundingClientRect().top - oben; // wo der Verweis im Artikel steht
      const y = Math.max(soll, frei);
      randnote.style.top = `${y}px`;
      frei = y + randnote.offsetHeight + ABSTAND;
    }
  }

  // Klick auf die Nummer: breit kurz die Randnote hervorheben, statt zur versteckten Liste zu springen
  for (const { verweis, randnote } of paare) {
    verweis.addEventListener("click", (e) => {
      if (!BREIT.matches) return; // schmal: ganz normal zur Fußnote am Ende springen
      e.preventDefault();
      randnote.classList.remove("hervor");
      void randnote.offsetWidth; // Trick: zwingt den Browser, neu zu rechnen, damit die Animation von vorn beginnt
      randnote.classList.add("hervor");
    });
  }

  // neu setzen, wenn sich etwas verschiebt: Breite ändert sich, Schrift fertig geladen, Bilder kommen dazu
  new ResizeObserver(setze).observe(artikel);
  BREIT.addEventListener("change", setze);
  document.fonts?.ready.then(setze);
  setze();
}

document.querySelectorAll(".lesetext").forEach(richteEin);
