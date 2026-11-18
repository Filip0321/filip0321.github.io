// Rückgängig, Wiederholen, Kopieren, Einfügen, Löschen (Runde 21).
//
// Rückgängig: Nach jeder Änderung (Modul dazu, Kabel, Knopf gedreht) speichert main.js den Patch ohnehin nach einer
// halben Sekunde Ruhe als Text (für den Browser-Speicher). Genau diese Texte kommen hier in eine Liste, höchstens 60.
// Strg+Z lädt den vorigen. Das ist das einfachste sichere Verfahren („Schnappschüsse“): man muss nicht für jede Art
// von Änderung wissen, wie man sie umkehrt (das wäre das andere Verfahren, „Befehle“ mit je einer Umkehrung, wie in
// Ableton oder Photoshop). Preis: beim Zurückspringen wird der Patch neu gebaut, der Ton setzt kurz ab.
// Ein halbe Sekunde Ruhe heißt auch: zehn schnelle Knopfdrehungen sind ein Schritt, nicht zehn.
//
// Kopieren: die markierten Module (Rechteck auf der Wand ziehen) und die Kabel zwischen ihnen, als Daten im selben
// Format wie ein Patch. Einfügen: neue Nummern, etwas versetzt, Kabel nach innen wieder gesteckt.
// Tasten: Strg/Cmd + Z, Strg + Umschalt + Z oder Strg + Y, Strg + C, Strg + V, Strg + D (verdoppeln), Entf.

export function erstelleRueckgaengig({ alsDaten, lade, module, kabel, neuesModul, loesche, gruppen, melde, merkeBald }) {
  const zurueck = [], vor = [];
  let jetzt = null, laedt = false, ablage = null;

  // main.js ruft das nach jedem Speichern auf
  function merke(text) {
    if (laedt) {
      jetzt = text;
      return;
    }
    if (text === jetzt) return;
    if (jetzt !== null) zurueck.push(jetzt);
    if (zurueck.length > 60) zurueck.shift();
    vor.length = 0;
    jetzt = text;
  }

  function springe(von, nach, wort) {
    if (!von.length) return melde(`Nichts mehr ${wort}.`, 1500);
    nach.push(jetzt);
    jetzt = von.pop();
    laedt = true;
    lade(JSON.parse(jetzt));
    setTimeout(() => (laedt = false), 900); // lade() steckt die Kabel ein Bild später, dann wird gespeichert
  }
  const rueck = () => springe(zurueck, vor, "rückgängig zu machen");
  const wieder = () => springe(vor, zurueck, "zu wiederholen");

  function kopiere() {
    const liste = gruppen.auswahl();
    if (!liste.length) return melde("Erst Module markieren: auf der freien Wand ein Rechteck ziehen.", 2500), false;
    const ids = new Set(liste.map((m) => m.id));
    const alles = alsDaten();
    ablage = {
      module: alles.module.filter((m) => ids.has(m.id)),
      kabel: alles.kabel.filter(([a, , b]) => ids.has(a) && ids.has(b)),
    };
    melde(`${liste.length} ${liste.length === 1 ? "Modul" : "Module"} kopiert.`, 1500);
    return true;
  }

  function fuegeEin(versatz = 40) {
    if (!ablage) return;
    const neu = new Map();
    for (const d of ablage.module) {
      if (d.typ === "ausgang") continue;
      const m = neuesModul({ ...d, id: null, x: d.x + versatz, y: d.y + versatz, werte: structuredClone(d.werte) });
      if (m) neu.set(d.id, m);
    }
    // die Ablage wandert mit: nochmal Einfügen setzt die nächsten Kopien wieder versetzt daneben
    ablage = { ...ablage, module: ablage.module.map((d) => ({ ...d, x: d.x + versatz, y: d.y + versatz })) };
    requestAnimationFrame(() => {
      for (const [a, an, b, bn] of ablage.kabel) {
        const von = neu.get(a), nach = neu.get(b);
        try {
          if (von && nach) kabel.verbinde({ modul: von, name: an }, { modul: nach, name: bn });
        } catch {}
      }
      gruppen.waehleAus([...neu.values()]);
      merkeBald();
    });
  }

  function loescheAuswahl() {
    const liste = gruppen.auswahl();
    for (const m of liste) loesche(m);
    if (liste.length) melde(`${liste.length} gelöscht (Strg+Z holt sie zurück).`, 2000);
  }

  window.addEventListener("keydown", (ev) => {
    // nicht, während man in ein Feld tippt
    if (ev.target.closest?.("input, select, textarea, [contenteditable]") && ev.target.type !== "range") return;
    const strg = ev.ctrlKey || ev.metaKey, taste = ev.key.toLowerCase();
    if (strg && taste === "z" && !ev.shiftKey) rueck();
    else if (strg && ((taste === "z" && ev.shiftKey) || taste === "y")) wieder();
    else if (strg && taste === "c") kopiere();
    else if (strg && taste === "v") fuegeEin();
    else if (strg && taste === "d") kopiere() && fuegeEin();
    else if ((ev.key === "Delete" || ev.key === "Backspace") && !strg && gruppen.auswahl().length) loescheAuswahl();
    else return;
    ev.preventDefault();
  });

  return { merke, rueck, wieder, kopiere, fuegeEin, loescheAuswahl };
}
