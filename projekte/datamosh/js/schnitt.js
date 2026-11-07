// Der Schnitt: Clips auf Spuren, wie in einem Schnittprogramm. Daraus wird die Grundfolge: welches Bild
// welches Clips zu welcher Zeit kommt, bevor irgendein Eingriff (Sprung, Halten …) dazukommt.
// Reine Rechnung, ohne Seite.
//
//   Zeit t       in Bildern bei der gemeinsamen Bildrate, ab 0
//   Spur 0       die oberste. Wo sich Clips überlappen, gewinnt die obere: wie in DaVinci.
//   Schnitt      überall, wo das gezeigte Bild nicht einfach das nächste Bild desselben Clips ist: am Anfang
//                eines Clips, wo ein oberer Clip anfängt oder aufhört, nach einer Lücke.
//   Lücke        Zeiten ohne Clip werden übersprungen (im Video gibt es sie nicht).
//
// Was an einem Schnitt passiert, entscheidet folge.js: normal kommt dort ein I-Frame (Keyframe), das Bild
// ist sauber. Ohne ihn (gelöscht) laufen die P-Frames des neuen Clips auf dem alten Bild weiter: Mosh.
//
// Ein Eintrag der Grundfolge: { t, clip (Index in clips), id (Clip-Id), k (Bild im Clip), p (Paketnummer), schnitt }

export const ende = (c) => c.start + c.laenge;

// Lage vervollständigen: neue Clips hinten an Spur 0 hängen, Längen auf das Kodierte begrenzen
export function lege(clips) {
  let hinten = 0;
  for (const c of clips) if (c.start !== null && c.laenge) hinten = Math.max(hinten, ende(c));
  for (const c of clips) {
    const n = c.bilderGesamt ?? 1;
    c.von = Math.min(Math.max(0, c.von), n - 1);
    c.laenge = Math.min(c.laenge ?? n, n - c.von) || 1;
    if (c.start === null) {
      c.start = hinten;
      c.spur = 0;
      hinten = ende(c);
    }
  }
  // Spuren lückenlos durchnummerieren (nach dem Ziehen kann eine leer sein oder -1 vorkommen)
  const benutzt = [...new Set(clips.map((c) => c.spur))].sort((a, b) => a - b);
  for (const c of clips) c.spur = benutzt.indexOf(c.spur);
}

export function baueGrund(clips, anfaenge) {
  const grund = [];
  const letzte = Math.max(0, ...clips.map(ende));
  let vorher = null;
  for (let t = 0; t < letzte; t++) {
    let oben = -1;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (t >= c.start && t < ende(c) && (oben < 0 || c.spur < clips[oben].spur)) oben = i;
    }
    if (oben < 0) {
      vorher = null; // Lücke
      continue;
    }
    const c = clips[oben];
    const k = c.von + t - c.start;
    const schnitt = !vorher || vorher.clip !== oben || vorher.k + 1 !== k;
    grund.push({ t, clip: oben, id: c.id, k, p: anfaenge[oben] + k, schnitt });
    vorher = { clip: oben, k };
  }
  return grund;
}

// Kennung eines Schnitts, um sich zu merken, ob dort das I-Frame gelöscht ist: welcher Clip, ab welchem Bild.
// (Verschiebt man den oberen Clip, ändert sich das Bild, ab dem der untere weitergeht; dann ist es ein neuer Schnitt.)
export const schnittName = (g) => `${g.id}:${g.k}`;
