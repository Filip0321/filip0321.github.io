// Auslösen: aus dem, was ein Strich liest, werden Ereignisse. Wie bei den Videos, in denen jedes Auto,
// das eine Linie überquert, einen Ton spielt.
//
// Der Strich liefert pro Bild eine Helligkeit pro Zeile (am besten mit „Bewegung“: dann ist nur hell,
// was sich gerade bewegt). Daraus:
//   1. Objekte: zusammenhängende Zeilen über der Schwelle, mindestens "mindestens" Zeilen lang.
//      Mit Hysterese: ein Objekt beginnt erst über der Schwelle, gehört dann aber bis hinunter zu
//      60 % der Schwelle dazu. Sonst zerfällt ein Auto mit dunkler Scheibe in drei Objekte.
//   2. Neu ist ein Objekt, das sich mit keinem Objekt des letzten Bildes überschneidet.
//      Solange ein Auto über die Linie fährt, ist es in jedem Bild an fast derselben Stelle: kein neuer Ton.
//      Erst wenn es weg ist und ein neues kommt, klingt es wieder.
//   3. Jedes neue Objekt ist eine Note: die Zeile seiner Mitte gibt die Tonhöhe, Größe und Helligkeit
//      die Stärke.
//
// Grenzen (ehrlich): Schatten, Gegenlicht und Bäume im Wind sind auch Bewegung. Zwei Autos, die sich auf
// der Linie berühren, sind ein Objekt. Dagegen helfen Schwelle, Mindestgröße und ein ruhiger Bildausschnitt.

export function richteAusloeserEin() {
  const vorher = new Map(); // id des Strichs -> Objekte des letzten Bildes

  function objekte(werte, schwelle, mindestens) {
    const unten = schwelle * 0.6;
    const liste = [];
    let von = -1;
    let spitze = 0;
    let summe = 0;
    for (let z = 0; z <= werte.length; z++) {
      const w = z < werte.length ? werte[z] : 0; // am Ende einmal 0, damit das letzte Objekt endet
      if (w >= unten) {
        if (von < 0) {
          von = z;
          spitze = 0;
          summe = 0;
        }
        spitze = Math.max(spitze, w);
        summe += w;
      } else if (von >= 0) {
        const laenge = z - von;
        if (spitze >= schwelle && laenge >= mindestens) liste.push({ von, bis: z - 1, mitte: (von + z - 1) / 2, hell: summe / laenge, laenge });
        von = -1;
      }
    }
    return liste;
  }

  return {
    // werte eines Strichs -> neue Objekte (Noten-Rohdaten: Mitte, Länge, Helligkeit)
    neue(id, werte, { schwelle, mindestens }) {
      const jetzt = objekte(werte, schwelle, mindestens);
      const alt = vorher.get(id) ?? [];
      vorher.set(id, jetzt);
      return jetzt.filter((o) => !alt.some((a) => a.von <= o.bis + 1 && o.von <= a.bis + 1));
    },
    vergiss: () => vorher.clear(), // z. B. vor dem Export (sonst zählt das letzte Live-Bild mit)
  };
}
