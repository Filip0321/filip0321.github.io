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
//   heilen  an dieser Stelle kommt das Bild der Quelle als Keyframe (aus daten.schluessel): der Mosh ist
//           vorbei, das Bild wieder sauber.
// Dazu zwei Schalter:
//   schnitteMoshen  an jedem Schnitt (Anfang eines Clips) den Keyframe weglassen. Dann fließt jeder Clip
//                   in den nächsten über, ganz ohne Eingriffe.
//   heilenNach      so viele Bilder nach jedem Sprung (und jedem Schnitt-Mosh) automatisch heilen, 0 = nie.
//                   Ein Mosh, der nie endet, wird nach ein paar Sekunden nur noch Rauschen.
//
// Ein Eintrag der Folge ist eine Zahl: unter pakete.length ein normales Paket, darüber ein Keyframe aus
// schluessel (Nummer minus pakete.length). paketVon() macht daraus das Paket.

export function paketVon({ pakete, schluessel }, eintrag) {
  return eintrag < pakete.length ? pakete[eintrag] : schluessel[eintrag - pakete.length];
}

export function baueFolge({ pakete, anfaenge }, ereignisse, { schnitteMoshen, heilenNach = 0, maxLaenge = 30 * 60 * 10 }) {
  const folge = [];
  const nachBild = new Map();
  const merke = (e) => {
    if (!nachBild.has(e.bei)) nachBild.set(e.bei, []);
    nachBild.get(e.bei).push(e);
  };
  for (const e of ereignisse) {
    merke(e);
    if (e.art === "sprung" && heilenNach > 0) merke({ art: "heilen", bei: e.bei + heilenNach });
  }
  let pos = 0;
  let heile = false;
  let halteNoch = 0; // so viele Bilder wird noch gehalten
  let haltePaket = 0;
  // ein Bild nach dem anderen, damit jedes Ereignis an seiner Stelle drankommt, auch mitten im Halten
  while (folge.length < maxLaenge) {
    for (const e of nachBild.get(folge.length) ?? []) {
      if (e.art === "sprung") {
        pos = Math.min(Math.max(e.nach, 0), pakete.length - 1);
        if (pakete[pos].typ === "key" && folge.length > 0) pos++; // genau den nicht
        halteNoch = 0;
      } else if (e.art === "halten" && folge.length > 0) {
        let letztes = folge[folge.length - 1];
        if (letztes >= pakete.length) letztes -= pakete.length; // nach dem Heilen: das P-Frame dieser Stelle
        haltePaket = bezugsPaket(pakete, letztes);
        halteNoch = e.dauer;
      } else if (e.art === "heilen") {
        heile = true;
        halteNoch = 0; // Heilen beendet auch das Halten
      }
    }
    if (halteNoch > 0) {
      folge.push(haltePaket);
      halteNoch--;
      continue;
    }
    if (pos >= pakete.length) break;
    if (heile) {
      folge.push(pos + pakete.length); // das Bild dieser Stelle als Keyframe
      heile = false;
      pos++;
      continue;
    }
    // Keyframe an einem Schnitt: weglassen (außer ganz am Anfang, irgendwo muss ein Bild herkommen)
    if (schnitteMoshen && pakete[pos].typ === "key" && folge.length > 0) {
      if (heilenNach > 0) merke({ art: "heilen", bei: folge.length + heilenNach });
      pos++;
      continue;
    }
    folge.push(pos);
    pos++;
  }
  return folge;
}

// Halten wiederholt ein P-Frame, das das Bezugsbild erneuert: nur dann baut jede Wiederholung auf der
// vorigen auf und das Bild fließt weiter. (Mit Zeitschichten erneuert nur jedes zweite Paket das Bezugsbild,
// die dazwischen würden immer wieder dasselbe Bild verschieben, und es stünde still.) Keyframes nie:
// die würden das Bild nur wieder herstellen.
function bezugsPaket(pakete, i) {
  const passt = (k) => pakete[k] && pakete[k].typ === "delta" && pakete[k].erneuertLetztes !== false;
  for (let d = 0; d < 8; d++) {
    if (passt(i - d)) return i - d;
    if (passt(i + d)) return i + d;
  }
  return Math.min(i + 1, pakete.length - 1);
}

// wo in der Quelle ist man bei Bild n der Folge? (für die Anzeige)
export function quelleBei(daten, folge, n) {
  if (!folge.length) return null;
  const eintrag = folge[Math.min(n, folge.length - 1)];
  const p = paketVon(daten, eintrag);
  return { clip: p.clip, bild: p.bild, geheilt: eintrag >= daten.pakete.length };
}
