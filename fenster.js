// XP-Fenster auf der Bühne
// ziehen an der Titelleiste, zuletzt angefasstes nach vorn, schließen, über Symbole öffnen

let oben = 1; // höchster z-index bisher

function nachVorn(fenster) {
  oben += 1;
  fenster.style.zIndex = oben;
}

function begrenze(wert, min, max) {
  return Math.min(Math.max(wert, min), Math.max(min, max));
}

// Fenster komplett in der Bühne halten
function holeRein(fenster, buehne) {
  if (fenster.hidden) return;
  const x = begrenze(fenster.offsetLeft, 0, buehne.clientWidth - fenster.offsetWidth);
  const y = begrenze(fenster.offsetTop, 0, buehne.clientHeight - fenster.offsetHeight);
  fenster.style.left = `${x}px`;
  fenster.style.top = `${y}px`;
}

export function richteFensterEin(buehne) {
  const alle = [...buehne.querySelectorAll(".fenster")];

  for (const fenster of alle) {
    const leiste = fenster.querySelector(".fenster-leiste");
    const schliessen = fenster.querySelector(".schliessen");

    // irgendwo angefasst: nach vorn
    fenster.addEventListener("pointerdown", () => nachVorn(fenster));

    // Ziehen nur an der Titelleiste
    // pageX statt clientX: bleibt richtig, auch wenn die Seite währenddessen scrollt
    let griff = null;

    leiste.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return; // auf den Knöpfen wird nicht gezogen
      griff = {
        x: e.pageX - fenster.offsetLeft,
        y: e.pageY - fenster.offsetTop,
      };
      leiste.setPointerCapture(e.pointerId);
      fenster.classList.add("zieht");
    });

    leiste.addEventListener("pointermove", (e) => {
      if (!griff) return;
      const x = begrenze(e.pageX - griff.x, 0, buehne.clientWidth - fenster.offsetWidth);
      const y = begrenze(e.pageY - griff.y, 0, buehne.clientHeight - fenster.offsetHeight);
      fenster.style.left = `${x}px`;
      fenster.style.top = `${y}px`;
    });

    const lassLos = () => {
      griff = null;
      fenster.classList.remove("zieht");
    };
    leiste.addEventListener("pointerup", lassLos);
    leiste.addEventListener("pointercancel", lassLos);

    schliessen.addEventListener("click", () => {
      fenster.hidden = true;
    });
  }

  // Symbole öffnen ihr Fenster (die Öffnungsanimation startet von selbst,
  // weil das Element von display: none wieder sichtbar wird)
  buehne.querySelectorAll("[data-oeffnet]").forEach((knopf) => {
    knopf.addEventListener("click", () => {
      const fenster = document.getElementById(knopf.dataset.oeffnet);
      fenster.hidden = false;
      nachVorn(fenster);
      holeRein(fenster, buehne);
    });
  });

  // nach dem Verkleinern des Browserfensters alle wieder in die Bühne holen
  window.addEventListener("resize", () => {
    for (const fenster of alle) holeRein(fenster, buehne);
  });
}

// Umschalter XP-Rahmen / schlicht; die Klasse sitzt auf <html>,
// damit sie später auf jeder Seite mit Fenstern gilt
const STIL_SCHLUESSEL = "fenster-stil";

export function richteStilWechselEin(knopf) {
  const wurzel = document.documentElement;

  const setze = (schlicht) => {
    wurzel.classList.toggle("schlicht", schlicht);
    knopf.setAttribute("aria-pressed", schlicht);
    try {
      localStorage.setItem(STIL_SCHLUESSEL, schlicht ? "schlicht" : "xp");
    } catch {}
    // andere Maße: alle Fenster wieder in die Bühne holen
    window.dispatchEvent(new Event("resize"));
  };

  setze(wurzel.classList.contains("schlicht")); // Stand aus dem Kopf-Skript übernehmen
  knopf.addEventListener("click", () => setze(!wurzel.classList.contains("schlicht")));
}