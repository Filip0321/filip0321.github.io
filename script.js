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

  tippe();
} // Typewriter effect

const btn = document.querySelector(".menu-btn");
const menu = document.getElementById("menu");

btn.addEventListener("click", () => {
  const offen = menu.classList.toggle("offen");
  btn.setAttribute("aria-expanded", offen);
  btn.textContent = offen ? "✖" : "Menü";
});

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