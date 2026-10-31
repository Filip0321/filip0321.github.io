// Szenen zeichnen (aus szene.js) und als Video oder PNG speichern.
// Eine Szene ist eine Folge von Abschnitten; jeder Abschnitt hat seinen Ton und Ebenen:
//   { bild, feld: { x, y, breite, hoehe }, entsteht, strich, skala, pixelig }
// entsteht: das Bild erscheint nur, wo der Strich schon war; strich: der Lesekopf läuft durch dieses Feld
// szene.rueckwaerts: der Strich läuft von rechts nach links, jeder Ton ist umgedreht

import { neueAufnahme, schneideTon, ladeHerunter, speichereCanvas, zeitstempel, warte, FPS } from "/lib/export.js";
import { zeichneSkala } from "./kopf.js";
import { rueckwaerts } from "./ton.js";

const KOPF_FARBE = "#dddddd";
const RAND_FARBE = "rgba(17, 17, 17, 0.8)";

function zeichneStrich(c, feld, anteil, breite) {
  const x = feld.x + Math.min(Math.round(anteil * feld.breite), feld.breite - breite); // am Ende nicht über den Rand
  c.fillStyle = RAND_FARBE;
  c.fillRect(x - 1, feld.y, breite + 2, feld.hoehe);
  c.fillStyle = KOPF_FARBE;
  c.fillRect(x, feld.y, breite, feld.hoehe);
}

// Abschnitt k, der Strich steht bei anteil (0 bis 1). anteil = null: alles fertig, kein Strich (PNG)
export function zeichneSzene(c, szene, k, anteil) {
  c.fillStyle = szene.rahmenFarbe;
  c.fillRect(0, 0, szene.breite, szene.hoehe);
  const innen = szene.innen;
  c.fillStyle = szene.hintergrund;
  c.fillRect(innen.x, innen.y, innen.breite, innen.hoehe);

  if (szene.texte.length > 0) {
    c.font = `${szene.schrift}px monospace`;
    c.textBaseline = "middle";
    c.fillStyle = szene.textFarbe;
    for (const text of szene.texte) c.fillText(text.inhalt, text.x, text.y);
  }

  // wo der Strich steht (0 links, 1 rechts): rückwärts fängt er rechts an
  const lauf = anteil === null ? null : szene.rueckwaerts ? 1 - anteil : anteil;

  for (const ebene of szene.abschnitte[k].ebenen) {
    const { bild, feld } = ebene;
    c.imageSmoothingEnabled = !ebene.pixelig;
    c.imageSmoothingQuality = "high";
    if (ebene.entsteht && lauf !== null) {
      // nur der Teil, über den der Strich schon gelaufen ist: vorwärts links von ihm, rückwärts rechts
      // Quell-Rechteck und Ziel-Rechteck gleich weit (von bis bis, als Anteil der Breite)
      const von = szene.rueckwaerts ? lauf : 0;
      const bis = szene.rueckwaerts ? 1 : lauf;
      const quellBreite = bild.width * (bis - von);
      if (quellBreite > 0) {
        c.drawImage(bild, bild.width * von, 0, quellBreite, bild.height,
          feld.x + feld.breite * von, feld.y, feld.breite * (bis - von), feld.hoehe);
      }
    } else {
      c.drawImage(bild, feld.x, feld.y, feld.breite, feld.hoehe);
    }
    if (ebene.skala) {
      // die Skala immer ganz, auch wenn das Bild erst entsteht; clip: nicht über den Feldrand
      c.save();
      c.beginPath();
      c.rect(feld.x, feld.y, feld.breite, feld.hoehe);
      c.clip();
      c.translate(feld.x, feld.y);
      zeichneSkala(c, feld.breite, feld.hoehe, Math.max(1, (2 * feld.hoehe) / 1080)); // wie früher: Maßstab 2 bei 1080
      c.restore();
    }
    if (ebene.strich && lauf !== null) zeichneStrich(c, feld, lauf, szene.strichBreite);
  }
}

// alle Töne der Abschnitte hintereinander zu einer Tonspur
function hintereinander(puffer) {
  const laenge = puffer.reduce((summe, p) => summe + p.length, 0);
  const kanaele = puffer[0].numberOfChannels;
  const ziel = new AudioBuffer({ length: laenge, numberOfChannels: kanaele, sampleRate: puffer[0].sampleRate });
  let pos = 0;
  for (const p of puffer) {
    for (let kanal = 0; kanal < kanaele; kanal++) ziel.copyToChannel(p.getChannelData(kanal), kanal, pos);
    pos += p.length;
  }
  return ziel;
}

// von, bis: der Bereich aus dem Export-Fenster als Anteil (0 bis 1) der ganzen Länge
// typ: "mp4" oder "webm"
export async function speichereVideo(szene, { name, beiFortschritt, von = 0, bis = 1, typ = "mp4" }) {
  const abschnitte = szene.abschnitte;
  // rückwärts: jeder Abschnitt für sich umgedreht, die Reihenfolge der Stufen bleibt
  const ton = hintereinander(abschnitte.map((a) => (szene.rueckwaerts ? rueckwaerts(a.puffer) : a.puffer)));
  // wann jeder Abschnitt anfängt (in Sekunden): 0, Dauer 1, Dauer 1 + Dauer 2, …
  const anfaenge = [];
  let summe = 0;
  for (const a of abschnitte) {
    anfaenge.push(summe);
    summe += a.puffer.duration;
  }

  const rahmen = document.createElement("canvas");
  rahmen.width = szene.breite;
  rahmen.height = szene.hoehe;
  const c = rahmen.getContext("2d");

  const rate = ton.sampleRate;
  let aufnahme = null; // außerhalb von try, damit catch es abbrechen kann
  try {
    aufnahme = await neueAufnahme(rahmen, FPS, szene.rahmenFarbe, { kanaele: ton.numberOfChannels, rate }, typ);
    // nur der Bereich: Bilder von erstes bis vor letztes, die Zeit im Video fängt beim Bereich bei 0 an
    const erstes = Math.round(von * ton.duration * FPS);
    const letztes = Math.max(erstes + 1, Math.ceil(bis * ton.duration * FPS));
    let k = 0;
    let letztePause = performance.now();
    for (let i = erstes; i < letztes; i++) {
      const tImTon = i / FPS; // wo im ganzen Ton
      const t = (i - erstes) / FPS; // wo im Video
      while (k < abschnitte.length - 1 && tImTon >= anfaenge[k + 1]) k++; // nächster Abschnitt?
      const anteil = Math.min((tImTon - anfaenge[k]) / abschnitte[k].puffer.duration, 1);
      zeichneSzene(c, szene, k, anteil);

      // der Ton für genau dieses Bild: von hier bis zum nächsten Bild
      const anfang = Math.round(tImTon * rate);
      const ende = Math.round(Math.min((i + 1) / FPS, bis * ton.duration) * rate);
      const tonStueck = schneideTon(ton, anfang, ende); // null, wenn nichts mehr übrig ist
      await Promise.all([aufnahme.bild(rahmen, t, 1 / FPS), tonStueck && aufnahme.ton(tonStueck)]);

      if (performance.now() - letztePause > 50) {
        beiFortschritt?.((i - erstes + 1) / (letztes - erstes));
        await warte();
        letztePause = performance.now();
      }
    }
    ladeHerunter(await aufnahme.fertig(), `${name}-${zeitstempel()}.${aufnahme.endung}`);
    return { codec: aufnahme.codec, tonCodec: aufnahme.tonCodec }; // für den Hinweis in main.js
  } catch (fehler) {
    await aufnahme?.abbrechen();
    throw fehler;
  }
}

// das fertige Bild (alles da, kein Strich) als PNG oder WebP (typ)
export function speichereBild(szene, name, typ = "png") {
  const bild = document.createElement("canvas");
  bild.width = szene.breite;
  bild.height = szene.hoehe;
  zeichneSzene(bild.getContext("2d"), szene, szene.abschnitte.length - 1, null);
  return speichereCanvas(bild, typ, `${name}-${zeitstempel()}`); // gibt ein Promise zurück: main.js kann warten
}
