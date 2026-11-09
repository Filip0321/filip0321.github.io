function richteFormatEin() {
  // Einheitliche Formatwahl für feste Visualisierungen ohne eigenes Format-Menü.
  // Quellgebundene Werkzeuge (Foto/Video als Vorlage) bekommen absichtlich kein Menü:
  // dort soll das Seitenverhältnis der Quelle erhalten bleiben.

  const FORMATE = [
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["9:16", 9 / 16],
    ["3:2", 3 / 2],
    ["21:9", 21 / 9],
  ];

  const stapel = document.querySelector("main.werkbank .feld-rahmen .feld-stapel");
  const bedienung = document.querySelector("main.werkbank .bedienung");
  const canvas = stapel?.querySelector("canvas:not(.schicht)");

  // Wenn eine Seite bereits ein eigenes Format-Menü hat, bleibt dessen Logik zuständig.
  if (stapel && bedienung && canvas && !document.querySelector('[data-wert="format"]')) {
    function ratioAus(css) {
      const teile = String(css ?? "").replace(/^auto\s+/, "").split("/").map(Number);
      if (teile.length === 2 && teile.every((n) => Number.isFinite(n) && n > 0)) return teile[0] / teile[1];
      const n = Number(teile[0]);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }

    const stil = getComputedStyle(canvas);
    const canvasRatioText = stil.aspectRatio;
    const startRatio = canvasRatioText && canvasRatioText !== "auto"
      ? ratioAus(canvasRatioText)
      : ratioAus(getComputedStyle(stapel).aspectRatio);
    const passend = FORMATE.reduce((best, format) =>
      Math.abs(Math.log(format[1] / startRatio)) < Math.abs(Math.log(best[1] / startRatio)) ? format : best,
    FORMATE[0]);

    const details = document.createElement("details");
    details.className = "abschnitt format-auswahl";
    details.open = true;
    const titel = document.createElement("summary");
    titel.textContent = "Format";
    const steuerung = document.createElement("div");
    steuerung.className = "steuerung";
    const label = document.createElement("label");
    label.textContent = "Bildformat";
    const auswahl = document.createElement("select");
    auswahl.setAttribute("aria-label", "Bildformat");
    for (const [name] of FORMATE) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      auswahl.append(option);
    }
    label.append(auswahl);
    steuerung.append(label);
    details.append(titel, steuerung);
    bedienung.prepend(details);

    function stelle(name, speichere = true) {
      const format = FORMATE.find(([n]) => n === name) ?? passend;
      const ratio = format[1];
      auswahl.value = format[0];
      stapel.classList.add("format-einstellbar");
      stapel.style.setProperty("--format", String(ratio));
      stapel.style.setProperty("--verhaeltnis", String(ratio));
      stapel.style.aspectRatio = String(ratio);
      canvas.style.aspectRatio = String(ratio);
      // Der Event erlaubt Projekten mit eigener Pixelgröße, auch ihren Export passend umzustellen.
      window.dispatchEvent(new CustomEvent("formatwechsel", { detail: { format: format[0], ratio } }));
      // Attraktoren beobachten die Canvas-Größe; andere Projekte hängen oft an window.resize.
      window.dispatchEvent(new Event("resize"));
      if (speichere) {
        try { localStorage.setItem(`bildformat:${location.pathname}`, format[0]); } catch {}
      }
    }

    let start = passend[0];
    try {
      const gespeichert = localStorage.getItem(`bildformat:${location.pathname}`);
      if (FORMATE.some(([name]) => name === gespeichert)) start = gespeichert;
    } catch {}
    auswahl.addEventListener("change", () => stelle(auswahl.value));
    stelle(start, false);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", richteFormatEin, { once: true });
} else {
  richteFormatEin();
}
