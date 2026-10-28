// Einstellungen merken: Regler, Auswahlen und Häkchen im Browser speichern (localStorage)
// und beim nächsten Öffnen wiederherstellen. Gilt nur für diesen Browser auf diesem Gerät.

const SCHLUESSEL = "spektrogramm-einstellungen"; // unter diesem Namen liegt es im Browser
// Quelle und Eingang nicht: sonst fragt die Seite beim Öffnen sofort nach dem Mikrofon.
// Der Exportbereich auch nicht: er gehört zu einer bestimmten Datei
const NICHT_MERKEN = new Set(["quelle", "eingang", "datei", "exportVon", "exportBis"]);

// alle Felder mit id im Bereich, außer den ausgenommenen
function felder(bereich) {
  return [...bereich.querySelectorAll("input[id], select[id]")].filter(
    (feld) => !NICHT_MERKEN.has(feld.id) && feld.type !== "file",
  );
}

export function stelleWiederHer(bereich) {
  let werte = null;
  // localStorage kann fehlen oder werfen (privates Fenster, gesperrte Website-Daten)
  try {
    werte = JSON.parse(localStorage.getItem(SCHLUESSEL));
  } catch {
    return;
  }
  if (!werte) return;
  for (const feld of felder(bereich)) {
    if (!(feld.id in werte)) continue;
    if (feld.type === "checkbox") feld.checked = werte[feld.id];
    else feld.value = werte[feld.id];
    // so tun, als hätte ein Mensch es geändert: alle Listener laufen (Anzeigen, Knöpfe, Filter …)
    const art = feld.type === "checkbox" || feld.tagName === "SELECT" ? "change" : "input";
    feld.dispatchEvent(new Event(art, { bubbles: true }));
  }
}

// ab jetzt bei jeder Änderung speichern; ein Listener am Bereich reicht, weil Events "aufsteigen" (bubbles)
export function merkeEinstellungen(bereich) {
  const speichere = () => {
    const werte = {};
    for (const feld of felder(bereich)) {
      werte[feld.id] = feld.type === "checkbox" ? feld.checked : feld.value;
    }
    try {
      localStorage.setItem(SCHLUESSEL, JSON.stringify(werte));
    } catch {
      // nicht speicherbar: dann eben ohne Merken
    }
  };
  bereich.addEventListener("input", speichere);
  bereich.addEventListener("change", speichere);
}

