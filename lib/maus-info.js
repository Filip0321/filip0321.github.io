// Schild unter dem Mauszeiger, für jedes Projekt: welcher Text dort steht, sagt das Projekt
// (beim Merge nach /lib; das Spektrogramm kann es dann auch benutzen)

const NOTEN = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

// A4 = 440 Hz (MIDI-Note 69), jede Verdopplung eine Oktave = 12 Halbtöne
// Also: Halbtöne über A4 = 12 · log2(f / 440)
export function notenName(f) {
  const midi = 69 + 12 * Math.log2(f / 440);
  const naechste = Math.round(midi);
  const cent = Math.round((midi - naechste) * 100); // wie weit daneben, ±50 ct
  const oktave = Math.floor(naechste / 12) - 1; // MIDI 60 = C4
  const name = NOTEN[naechste % 12];
  const abweichung = cent === 0 ? "" : ` ${cent > 0 ? "+" : "−"}${Math.abs(cent)} ct`;
  return `${name}${oktave}${abweichung}`;
}

// 250 -> "250 Hz", 4000 -> "4 kHz"
export function zeigeFrequenz(f) {
  return f < 1000 ? `${Math.round(f)} Hz` : `${Math.round(f / 100) / 10} kHz`;
}

// 75,3 -> "1:15,3"
export function zeigeZeit(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = (sekunden - m * 60).toFixed(1).replace(".", ",").padStart(4, "0");
  return `${m}:${s}`;
}

// ziel: worüber gemessen wird; schild: das Schildchen (liegt im Ziel, position: absolute)
// text(x, y): x und y als Anteil von 0 bis 1 (links oben 0, 0) -> Text, oder null = verstecken
export function richteMausInfoEin(ziel, schild, text) {
  function zeige(event) {
    const rahmen = ziel.getBoundingClientRect();
    const x = event.clientX - rahmen.left; // Pixel im Ziel
    const y = event.clientY - rahmen.top;
    const inhalt = x < 0 || y < 0 || x > rahmen.width || y > rahmen.height
      ? null // daneben (z. B. beim Ziehen über den Rand)
      : text(x / rahmen.width, y / rahmen.height);
    if (inhalt === null) {
      schild.hidden = true;
      return;
    }
    schild.textContent = inhalt;
    schild.hidden = false;
    schild.style.left = `${x}px`;
    schild.style.top = `${y}px`;
    schild.classList.toggle("links", x > rahmen.width * 0.6); // am rechten Rand nach links klappen
  }
  ziel.addEventListener("pointermove", zeige);
  ziel.addEventListener("pointerdown", zeige); // am Handy: beim Antippen
  ziel.addEventListener("pointerleave", () => {
    schild.hidden = true;
  });
}
