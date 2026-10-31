const wenigBewegung = window.matchMedia("(prefers-reduced-motion: reduce)");

const el = document.getElementById("name");

if (el) {
  const text = "Filip\nWinkler";
  let i = 0;

  function tippe() {
    if (i < text.length) {
      el.textContent += text[i];
      i++;
      const pause = text[i - 1] === "\n" ? 300 : 80 + Math.random() * 120;
      setTimeout(tippe, pause);
    }
  }

  if (wenigBewegung.matches) {
    el.textContent = text;
  } else {
    tippe();
  }
} // Typewriter effect

const btn = document.querySelector(".menu-btn");
const menu = document.getElementById("menu");

// nur wenn es auf der Seite ein Menü gibt (sonst bricht hier das ganze Skript ab)
if (btn && menu) {
  btn.addEventListener("click", () => {
    const offen = menu.classList.toggle("offen");
    btn.setAttribute("aria-expanded", offen);
    btn.textContent = offen ? "✖" : "Menü";
  });
}

// den Code in den Details-Boxen erst laden, wenn sie geöffnet werden

document.querySelectorAll("details[data-quelle]").forEach((box) => {
  const ziel = box.querySelector("code");

  box.addEventListener("toggle", () => {
    fetch(box.dataset.quelle)
      .then((antwort) => {
        if (!antwort.ok) throw new Error(antwort.status);
        return antwort.text();
      })
      .then((text) => {
        ziel.textContent = text;
      })
      .catch(() => {
        ziel.textContent = "Der Code konnte nicht geladen werden.";
      });
  }, { once: true });
});


// Hilfsfunktion

function hole(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Im HTML fehlt ein Element mit id="${id}"`);
  }
  return element;
}


// bei for Each ist "schalter" und "feld" indexvariable (nimmt jeden wert einmal an)
document.querySelectorAll("[data-zeigt]").forEach((schalter) => {
  const gruppe = hole(schalter.dataset.zeigt);
  const aktualisiere = () => {
    gruppe.hidden = !schalter.checked;
  }; // wenn Schalter soll data-zeigt gruppe gezeigt werden
  schalter.addEventListener("change", aktualisiere);
  aktualisiere();
});

// Abschnitte der Bedienung (<details class="abschnitt">): welche offen sind, merkt sich der Browser pro Seite.
// Gespeichert als { "Quelle": true, "Export": false, … } unter dem Pfad der Seite.
// Ohne Speicher (privates Fenster) gilt einfach, was im HTML steht (open oder nicht).
const abschnitte = document.querySelectorAll("details.abschnitt");
if (abschnitte.length > 0) {
  const schluessel = `abschnitte:${location.pathname}`;
  let offen = {};
  try {
    offen = JSON.parse(localStorage.getItem(schluessel)) ?? {};
  } catch {
    // kaputter Eintrag oder kein Speicher: wie im HTML
  }
  // Name: die id, sonst die Überschrift (die id, wenn sich die Überschrift ändert, z. B. beim Overlay)
  const name = (abschnitt) => abschnitt.id || abschnitt.querySelector("summary").textContent.trim();

  abschnitte.forEach((abschnitt) => {
    if (name(abschnitt) in offen) abschnitt.open = offen[name(abschnitt)];
    abschnitt.addEventListener("toggle", () => {
      offen[name(abschnitt)] = abschnitt.open;
      try {
        localStorage.setItem(schluessel, JSON.stringify(offen));
      } catch {
        // geht nicht: dann eben nur für dieses Mal
      }
    });
  });
}

function stelleVideosEin() {
  document.querySelectorAll(".karte video").forEach((video) => {
    if (wenigBewegung.matches) {
      video.load();
    } else {
      video.play().catch(() => {});
    }
  });
}
stelleVideosEin();
wenigBewegung.addEventListener("change", stelleVideosEin);
