// Die Folge: welche Pakete in welcher Reihenfolge an den Dekoder gehen. Hier passiert der Mosh.
// Reine Rechnung, ohne Seite: dieselbe Folge für die Vorschau und den Export, darum sieht der Export
// genau so aus wie das, was du live gespielt hast.
//
// Normal: Paket 0, 1, 2, … bis zum Ende.
// Eingriffe (Ereignisse), jeweils bei einem Bild der Ausgabe ("bei"):
//   sprung  ab hier geht es an einer anderen Stelle der Quelle weiter ("nach": Paketnummer), und zwar ohne
//           deren Keyframe. Die Bewegung von dort wird auf das Bild von hier angewendet: der klassische Mosh.
//   halten  das letzte Paket wird "dauer" Mal wiederholt. Ein P-Frame sagt „verschiebe diesen Block um
//           so viel“; wiederholt verschiebt er immer weiter: das Bild zerfließt in Richtung der Bewegung
//           (im Datamosh-Jargon „Bloom“).
// Dazu ein Schalter: an jedem Schnitt (Anfang eines Clips) den Keyframe weglassen. Dann fließt jeder Clip
// in den nächsten über, ganz ohne Eingriffe.

export function baueFolge({ pakete, anfaenge }, ereignisse, { schnitteMoshen, maxLaenge = 30 * 60 * 10 }) {
  const folge = [];
  const nachBild = new Map();
  for (const e of ereignisse) {
    if (!nachBild.has(e.bei)) nachBild.set(e.bei, []);
    nachBild.get(e.bei).push(e);
  }
  let pos = 0;
  while (pos < pakete.length && folge.length < maxLaenge) {
    for (const e of nachBild.get(folge.length) ?? []) {
      if (e.art === "sprung") {
        pos = Math.min(Math.max(e.nach, 0), pakete.length - 1);
        if (pakete[pos].typ === "key" && folge.length > 0) pos++; // genau den nicht
      } else if (e.art === "halten" && folge.length > 0) {
        const letztes = folge[folge.length - 1];
        for (let i = 0; i < e.dauer && folge.length < maxLaenge; i++) folge.push(pakete[letztes].typ === "key" ? letztes + 1 : letztes);
      }
    }
    if (pos >= pakete.length) break;
    // Keyframe an einem Schnitt: weglassen (außer ganz am Anfang, irgendwo muss ein Bild herkommen)
    if (schnitteMoshen && pakete[pos].typ === "key" && folge.length > 0) {
      pos++;
      continue;
    }
    folge.push(pos);
    pos++;
  }
  return folge;
}

// wo in der Quelle ist man bei Bild n der Folge? (für die Anzeige)
export function quelleBei(daten, folge, n) {
  const p = daten.pakete[folge[Math.min(n, folge.length - 1)]];
  return p ? { clip: p.clip, bild: p.bild } : null;
}
