// Die Folge: welche Pakete in welcher Reihenfolge an den Dekoder gehen. Hier passiert der Mosh.
// Reine Rechnung, ohne Seite: dieselbe Folge für die Vorschau und den Export, darum sieht der Export
// genau so aus wie das, was du live gespielt hast.
//
// Grundlage ist die Grundfolge aus dem Schnitt (schnitt.js): Bild für Bild, welcher Clip gerade oben liegt.
// An jedem Schnitt kommt normal ein I-Frame (Keyframe). Ist er gelöscht, laufen die P-Frames des neuen Clips
// auf dem alten Bild weiter. Liegt der Schnitt am Anfang eines Clips, fällt das Bild ganz weg (dort gibt es
// nur den Keyframe, kein P-Frame): genau wie in Avidemux, wenn man den I-Frame am Schnitt löscht.
//
// Eingriffe (Ereignisse), jeweils bei einem Bild der Ausgabe ("bei"):
//   sprung    ab hier geht es an einer anderen Stelle der Quelle weiter ("nach": Paketnummer), ohne deren
//             Keyframe, bis zum nächsten Schnitt. Die Bewegung von dort läuft auf dem Bild von hier: der
//             klassische Mosh. nach = pakete.length heißt: Rest gelöscht.
//   halten    das letzte Paket wird "dauer" Mal wiederholt. Ein P-Frame sagt „verschiebe diesen Block um
//             so viel“; wiederholt verschiebt er immer weiter: das Bild zerfließt in Richtung der Bewegung
//             (im Datamosh-Jargon „Bloom“).
//   heilen    an dieser Stelle kommt das Bild der Quelle als Keyframe (aus daten.schluessel): der Mosh ist
//             vorbei, das Bild wieder sauber.
//   ersetzen  (aus der Zeitleiste) "weg" Bilder der Grundfolge fallen weg, dafür kommen die Einträge "liste".
//             Damit gehen Löschen (liste leer), Wiederholen (weg 0), Umkehren und Mischen. "wie" sagt, was es war.
//   wiederholen  (alt, Runde 3) wie ersetzen mit weg 0 und der Liste "mal" Mal.
// Dazu Schalter:
//   schnitteMoshen  an jedem Schnitt das I-Frame weglassen. Zahl: so viele Bilder lang, danach heilt es
//                   (0 = aus, Infinity = nie heilen).
//   heilenNach      so viele Bilder nach jedem Sprung automatisch heilen, 0 = nie.
//   iWeg, iBleibt   Mengen von Schnitt-Namen (schnitt.js): hier I-Frame sicher weg (heilt nicht von selbst)
//                   oder sicher da (auch wenn schnitteMoshen an ist)
//
// Ein Eintrag der Folge ist eine Zahl: unter pakete.length ein normales Paket, darüber ein Keyframe aus
// schluessel (Nummer minus pakete.length). paketVon() macht daraus das Paket.
// Daneben die Herkunft jedes Bildes, für die Zeitleiste und den Ton:
//   { t: Zeit im Schnitt, art: "grund" | "sprung" | "einschub", schnitt: Name oder null, iWeg: true/false }

import { schnittName } from "./schnitt.js";

export function paketVon({ pakete, schluessel }, eintrag) {
  return eintrag < pakete.length ? pakete[eintrag] : schluessel[eintrag - pakete.length];
}

export function baueFolge({ pakete }, grund, ereignisse, { schnitteMoshen = 0, heilenNach = 0, iWeg = new Set(), iBleibt = new Set(), maxLaenge = 30 * 60 * 10 }) {
  const N = pakete.length;
  const folge = [];
  const herkunft = [];
  const nachBild = new Map();
  const merke = (e) => {
    if (!nachBild.has(e.bei)) nachBild.set(e.bei, []);
    nachBild.get(e.bei).push(e);
  };
  for (const e of ereignisse) {
    merke(e);
    if (e.art === "sprung" && heilenNach > 0) merke({ art: "heilen", bei: e.bei + heilenNach });
  }
  let g = 0; // Stelle in der Grundfolge
  let quelle = null; // während eines Sprungs: das nächste Paket der Quelle, sonst null
  let heile = false;
  let ueberspringe = 0; // so viele Bilder der Grundfolge fallen noch weg (ersetzen)
  let einschub = []; // was gerade statt der Grundfolge eingefügt wird (Halten, Ersetzen), ein Eintrag pro Bild
  let iWegOffen = null; // ein gelöschter I-Frame, dessen Bild ganz wegfiel: das nächste Bild trägt die Markierung
  let tJetzt = grund[0]?.t ?? 0; // Zeit im Schnitt des zuletzt genommenen Bildes (Eingesetztes bekommt diese)
  const gib = (eintrag, h) => {
    folge.push(eintrag);
    herkunft.push({ t: tJetzt, schnitt: null, iWeg: false, ...h });
  };

  // ein Bild nach dem anderen, damit jedes Ereignis an seiner Stelle drankommt, auch mitten im Halten
  while (folge.length < maxLaenge) {
    for (const e of nachBild.get(folge.length) ?? []) {
      if (e.art === "sprung") {
        if (e.nach >= N) {
          g = grund.length; // Rest gelöscht
          quelle = null;
        } else {
          quelle = Math.max(0, e.nach);
          if (pakete[quelle].typ === "key" && folge.length > 0) quelle++; // genau den nicht
        }
        einschub = [];
      } else if (e.art === "halten" && folge.length > 0) {
        let letztes = folge[folge.length - 1];
        if (letztes >= N) letztes -= N; // nach dem Heilen: das P-Frame dieser Stelle
        einschub = Array(e.dauer).fill(bezugsPaket(pakete, letztes));
      } else if (e.art === "ersetzen") {
        ueberspringe += e.weg;
        einschub = [...e.liste];
      } else if (e.art === "wiederholen") {
        einschub = [];
        for (let k = 0; k < e.mal; k++) einschub.push(...e.liste);
      } else if (e.art === "heilen") {
        heile = true;
        einschub = []; // Heilen beendet auch das Halten
      }
    }
    if (einschub.length) {
      gib(einschub.shift(), { art: "einschub" });
      continue;
    }
    // weggefallene Bilder der Grundfolge (Löschen, Umkehren …): die Quelle eines Sprungs rückt mit
    while (ueberspringe > 0 && g < grund.length) {
      g++;
      if (quelle !== null) quelle++;
      ueberspringe--;
    }
    if (g >= grund.length) break;
    const gr = grund[g];
    g++;
    tJetzt = gr.t;
    if (gr.schnitt) quelle = null; // ein Schnitt beendet den Sprung
    if (quelle !== null && (quelle >= N || pakete[quelle].typ === "key")) quelle = null; // Sprung lief bis ans Clipende

    // während eines Sprungs: das Paket der Quelle statt der Grundfolge
    if (quelle !== null) {
      const p = quelle++;
      if (heile) {
        heile = false;
        gib(p + N, { art: "sprung" });
      } else gib(p, { art: "sprung" });
      continue;
    }

    let p = gr.p;
    const h = { art: "grund" };
    if (gr.schnitt && folge.length > 0) {
      const name = schnittName(gr);
      h.schnitt = name;
      const sicherWeg = iWeg.has(name);
      const moshen = sicherWeg || (schnitteMoshen > 0 && !iBleibt.has(name));
      if (moshen) {
        if (!sicherWeg && Number.isFinite(schnitteMoshen)) merke({ art: "heilen", bei: folge.length + schnitteMoshen });
        if (pakete[p].typ === "key") {
          iWegOffen = name; // Anfang eines Clips: es gibt hier nur den Keyframe, das Bild fällt weg
          continue;
        }
        h.iWeg = true;
        heile = false;
        gib(p, h);
        continue;
      }
      // I-Frame bleibt: am Clipanfang ist das Paket selbst einer, mitten im Clip kommt er aus schluessel
      gib(pakete[p].typ === "key" ? p : p + N, h);
      heile = false;
      continue;
    }
    if (iWegOffen) {
      // das Bild nach einem ganz weggefallenen I-Frame: hier sieht man, wo er war
      h.schnitt = iWegOffen;
      h.iWeg = true;
      iWegOffen = null;
    }
    if (folge.length === 0 && pakete[p].typ !== "key") p += N; // irgendwo muss das erste Bild herkommen
    else if (heile) {
      p += N;
      heile = false;
    }
    gib(p, h);
  }
  return { folge, herkunft };
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

// die P-Frames eines Clips ab einem Bild, ohne Keyframes (zum Mischen: fremde Bewegung einsetzen)
export function pFramesAb(daten, clip, bild, anzahl) {
  const liste = [];
  const anfang = daten.anfaenge[clip];
  const ende = clip + 1 < daten.anfaenge.length ? daten.anfaenge[clip + 1] : daten.pakete.length;
  let p = Math.max(anfang + bild, anfang + 1);
  while (liste.length < anzahl && ende - anfang > 1) {
    if (p >= ende) p = anfang + 1; // kürzer als die Auswahl: von vorn (ohne den Keyframe)
    liste.push(p++);
  }
  return liste;
}
