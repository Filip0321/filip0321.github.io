// Den Attraktor hören: die Ansicht, wie sie gerade ist (Drehung, Zoom, Farben, ohne Boden und Schatten),
// wird wie in bild-zu-ton als Spektrogramm gelesen: links nach rechts ist die Zeit, unten tief, oben hoch,
// je deutlicher sich ein Pixel vom Hintergrund abhebt, desto lauter. Ein Lesekopf zeigt, wo man gerade ist.
//
// Gleich für 2D und 3D; im HTML stehen die Felder mit den ids unten (Abschnitt „Ton“) und über dem
// Canvas ein durchsichtiger Canvas für den Lesekopf.
//
// Das Raster, aus dem der Ton entsteht, sieht man nie: es wird nur gerechnet. Zu sehen (und im Video)
// ist die Ansicht selbst, so wie sie beim Erzeugen war.

import { erzeugeTon, alsAudioBuffer } from "/lib/ton.js";
import { richteWiedergabeEin } from "/lib/wiedergabe.js";
import { zuWav, ladeHerunter, zeitstempel, neueAufnahme, schneideTon, warte, FPS } from "/lib/export.js";
import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";
import { hexZuRgb } from "/lib/farben.js";

const SPALTEN_PRO_SEKUNDE = 25; // 40 ms pro Spalte: fein genug für Bewegung, grob genug für Töne
const KOPF_FARBE = "#dddddd";
const RAND_FARBE = "rgba(17, 17, 17, 0.8)";

export function richteAttraktorTonEin({
  canvas,          // der Attraktor
  kopf,            // durchsichtiger Canvas darüber für den Lesekopf
  ansichtOhneBoden, // () => zeichnet einmal ohne Boden und Schatten (das Bild, das gelesen wird)
  zeichneNormal,   // () => danach wieder wie vorher
  hintergrund,     // () => "#111111": was als Stille gilt
  name,            // () => Dateiname
  anzeige = () => canvas, // was gerade zu sehen ist, mit Effekten (fürs Video)
  zuschnitt = () => null, // CRT: welcher Anteil mittig bleibt (wie in export.js)
}) {
  const dauerFeld = hole("ton-dauer");
  const zeilenFeld = hole("ton-zeilen");
  const tiefFeld = hole("ton-tief");
  const hochFeld = hole("ton-hoch");
  const dynamikFeld = hole("ton-dynamik");
  const anschlagFeld = hole("ton-anschlag");
  const knopf = hole("ton-erzeugen");
  const spieler = hole("ton-spieler");
  const schleife = hole("ton-schleife");
  const speichernKnopf = hole("ton-speichern");
  const videoKnopf = hole("ton-video");
  const meldung = hole("ton-meldung");
  const wiedergabe = richteWiedergabeEin({ spieler, rueckwaertsFeld: hole("ton-rueckwaerts") });

  const pinsel = kopf.getContext("2d");
  let puffer = null; // der Ton vorwärts
  let schnappschuss = null; // die Ansicht beim Erzeugen (mit Boden, Schatten und Effekten): das Bild im Video
  let laufId = null;

  // Regler zeigen ihren Wert im <output> dahinter
  for (const feld of [dauerFeld, zeilenFeld, dynamikFeld]) {
    const zeige = () => (feld.nextElementSibling.textContent = feld.value);
    feld.addEventListener("input", zeige);
    zeige();
  }

  // Die Ansicht in ein grobes Raster: pro Zelle der Durchschnitt, wie stark sich die Pixel
  // vom Hintergrund abheben (größter Unterschied in r, g oder b, 0 bis 1).
  // Abstand zum Hintergrund statt Helligkeit: auch „Schwarz auf Weiß“ klingt dann wie „Weiß auf Schwarz“.
  function rastere(spalten, zeilen) {
    const breite = canvas.width;
    const hoehe = canvas.height;
    const hilf = document.createElement("canvas");
    hilf.width = breite;
    hilf.height = hoehe;
    const c = hilf.getContext("2d", { willReadFrequently: true });
    c.drawImage(canvas, 0, 0);
    const pixel = c.getImageData(0, 0, breite, hoehe).data;
    const [hr, hg, hb] = hexZuRgb(hintergrund());

    const summe = new Float32Array(spalten * zeilen);
    const anzahl = new Float32Array(spalten * zeilen);
    for (let y = 0; y < hoehe; y++) {
      // Zeile 0 ist im Ton die tiefste, im Bild aber unten: darum umdrehen
      const zeile = zeilen - 1 - Math.floor((y / hoehe) * zeilen);
      for (let x = 0; x < breite; x++) {
        const i = (y * breite + x) * 4;
        const unterschied = Math.max(
          Math.abs(pixel[i] - hr), Math.abs(pixel[i + 1] - hg), Math.abs(pixel[i + 2] - hb)) / 255;
        const zelle = Math.floor((x / breite) * spalten) * zeilen + zeile; // wie in bild-zu-ton: Spalte für Spalte
        summe[zelle] += unterschied;
        anzahl[zelle] += 1;
      }
    }

    // Durchschnitt, dann auf den hellsten Wert bringen: ein feiner Attraktor soll nicht fast stumm sein
    let groesster = 0;
    for (let i = 0; i < summe.length; i++) {
      summe[i] = anzahl[i] ? summe[i] / anzahl[i] : 0;
      groesster = Math.max(groesster, summe[i]);
    }
    if (groesster > 0) for (let i = 0; i < summe.length; i++) summe[i] /= groesster;
    return summe;
  }

  async function erzeuge() {
    const tief = Number(tiefFeld.value);
    const hoch = Number(hochFeld.value);
    if (!(tief > 0 && hoch > tief)) {
      meldung.textContent = "Die höchste Frequenz muss über der tiefsten liegen.";
      return;
    }
    const dauer = Number(dauerFeld.value);
    const zeilen = Number(zeilenFeld.value);
    const spalten = Math.round(dauer * SPALTEN_PRO_SEKUNDE);

    knopf.disabled = true;
    try {
      ansichtOhneBoden();
      const raster = rastere(spalten, zeilen);
      zeichneNormal();
      schnappschuss = kopie(anzeige());
      const ton = await erzeugeTon(raster, spalten, zeilen, {
        dauer, tief, hoch,
        dynamik: Number(dynamikFeld.value),
        anschlag: anschlagFeld.checked,
        beiFortschritt: (anteil) => (meldung.textContent = `Rechne … ${Math.round(anteil * 100)} %`),
      });
      puffer = alsAudioBuffer(ton);
      wiedergabe.lade({ puffer });
      meldung.textContent = "Der Lesekopf zeigt das Bild von eben. Drehst du weiter, passt er nicht mehr dazu, bis du neu erzeugst.";
      kopf.hidden = false;
      zeichneKopf();
    } finally {
      knopf.disabled = false;
    }
  }

  function zeichneKopf() {
    if (kopf.width !== canvas.width || kopf.height !== canvas.height) {
      kopf.width = canvas.width;
      kopf.height = canvas.height;
    }
    pinsel.clearRect(0, 0, kopf.width, kopf.height); // durchsichtig: der Attraktor darunter bleibt sichtbar
    if (!puffer) return;
    const breite = Math.max(1, Math.round(canvas.width / Math.max(canvas.clientWidth, 1))); // 1 CSS-Pixel
    const x = Math.min(Math.round(wiedergabe.anteil() * kopf.width), kopf.width - breite);
    pinsel.fillStyle = RAND_FARBE;
    pinsel.fillRect(x - breite, 0, breite * 3, kopf.height);
    pinsel.fillStyle = KOPF_FARBE;
    pinsel.fillRect(x, 0, breite, kopf.height);
  }

  function laufe() {
    zeichneKopf();
    laufId = requestAnimationFrame(laufe);
  }

  spieler.addEventListener("play", () => {
    if (laufId === null) laufe();
  });
  const halte = () => {
    cancelAnimationFrame(laufId);
    laufId = null;
    zeichneKopf();
  };
  spieler.addEventListener("pause", halte);
  spieler.addEventListener("ended", halte);
  spieler.addEventListener("seeked", zeichneKopf);
  spieler.addEventListener("loadedmetadata", zeichneKopf);
  hole("ton-rueckwaerts").addEventListener("change", zeichneKopf);

  schleife.addEventListener("change", () => (spieler.loop = schleife.checked));
  knopf.addEventListener("click", erzeuge);
  speichernKnopf.addEventListener("click", () => {
    if (!puffer) {
      meldung.textContent = "Erst einen Ton erzeugen.";
      return;
    }
    const rueckwaerts = wiedergabe.istRueckwaerts();
    const wav = zuWav(rueckwaerts ? wiedergabe.umdrehen(puffer) : puffer); // was gerade zu hören ist
    ladeHerunter(wav, `${name()}-ton${rueckwaerts ? "-rueckwaerts" : ""}-${zeitstempel()}.wav`);
  });

  // Video: die Ansicht von eben, der Lesekopf läuft darüber (oder sie entsteht bis zu ihm), der Ton als Spur.
  // Rückwärts, wenn der Player gerade rückwärts spielt: dann läuft auch der Strich von rechts nach links.

  function kopie(quelle) {
    const bild = document.createElement("canvas");
    bild.width = quelle.width;
    bild.height = quelle.height;
    bild.getContext("2d").drawImage(quelle, 0, 0);
    return bild;
  }

  // eigenes Feld im Export-Fenster
  const felder = document.createElement("div");
  felder.className = "steuerung nur-video";
  felder.innerHTML = `
    <label>Ablauf
      <select name="ablauf">
        <option value="lesekopf">Lesekopf darüber</option>
        <option value="aufbauen">aufbauen (entsteht bis zum Strich)</option>
      </select>
    </label>`;
  const ablaufFeld = felder.querySelector("[name=ablauf]");

  // ein Bild des Videos; zeit: 0 am Anfang, 1 am Ende des Tons
  const bild = document.createElement("canvas");
  function videoBild(zeit) {
    const w = schnappschuss.width;
    const h = schnappschuss.height;
    bild.width = w;
    bild.height = h;
    const c = bild.getContext("2d");
    const rueckwaerts = wiedergabe.istRueckwaerts();
    const x = Math.round((rueckwaerts ? 1 - zeit : zeit) * w); // rückwärts: der Anfang ist rechts
    if (ablaufFeld.value === "aufbauen") {
      // nur der Teil, über den der Strich schon gelaufen ist: vorwärts links von ihm, rückwärts rechts
      c.fillStyle = hintergrund();
      c.fillRect(0, 0, w, h);
      const von = rueckwaerts ? x : 0;
      const bis = rueckwaerts ? w : x;
      if (bis > von) c.drawImage(schnappschuss, von, 0, bis - von, h, von, 0, bis - von, h);
    } else {
      c.drawImage(schnappschuss, 0, 0);
    }
    const breite = Math.max(2, Math.round(w / 600)); // im Video etwas kräftiger als auf dem Bildschirm
    const xImBild = Math.min(x, w - breite);
    c.fillStyle = RAND_FARBE;
    c.fillRect(xImBild - breite, 0, breite * 3, h);
    c.fillStyle = KOPF_FARBE;
    c.fillRect(xImBild, 0, breite, h);
    return bild;
  }

  const fenster = erstelleExportDialog({
    felder,
    zuschnitt,
    zeichneVorschau: (allgemein, zeit) => mitRahmen(videoBild(zeit ?? 0), allgemein),
  });

  videoKnopf.addEventListener("click", async () => {
    if (!puffer) {
      meldung.textContent = "Erst einen Ton erzeugen.";
      return;
    }
    if (typeof Mediabunny === "undefined" || typeof VideoEncoder === "undefined") {
      meldung.textContent = "Dein Browser kann keine Videos kodieren.";
      return;
    }
    const dauer = puffer.duration;
    const einst = await fenster.oeffne({ art: "video", ueberschrift: "Ton als Video", laenge: dauer });
    if (!einst) return; // abgebrochen

    const rueckwaerts = wiedergabe.istRueckwaerts();
    const tonSpur = rueckwaerts ? wiedergabe.umdrehen(puffer) : puffer; // was im Player zu hören ist
    const rate = tonSpur.sampleRate;
    const n = Math.ceil(dauer * FPS);
    // Bereich aus dem Fenster: nur diese Bilder (und ihr Ton) kommen ins Video
    const erstes = Math.round(einst.von * (n - 1));
    const letztes = Math.max(erstes, Math.round(einst.bis * (n - 1)));
    const mitRand = document.createElement("canvas"); // jedes Bild mit Rahmen hier hinein (ein Canvas für alle)

    videoKnopf.disabled = true;
    let aufnahme = null;
    try {
      aufnahme = await neueAufnahme(mitRahmen(videoBild(0), einst, mitRand), FPS, hintergrund(),
        { kanaele: tonSpur.numberOfChannels, rate }, einst.videoTyp);
      let letztePause = performance.now();
      for (let i = erstes; i <= letztes; i++) {
        const t = (i - erstes) / FPS; // Zeit im Video fängt beim Bereich an
        // der Ton für genau dieses Bild: von seiner Zeit bis zum nächsten Bild
        const stueck = schneideTon(tonSpur, Math.round((i / FPS) * rate), Math.round(((i + 1) / FPS) * rate));
        await Promise.all([
          aufnahme.bild(mitRahmen(videoBild(i / FPS / dauer), einst, mitRand), t, 1 / FPS),
          stueck && aufnahme.ton(stueck),
        ]);
        if (performance.now() - letztePause > 50) {
          videoKnopf.textContent = `Video … ${Math.round(((i - erstes + 1) / (letztes - erstes + 1)) * 100)} %`;
          await warte();
          letztePause = performance.now();
        }
      }
      videoKnopf.textContent = "Speichern …";
      ladeHerunter(await aufnahme.fertig(), `${name()}-ton${rueckwaerts ? "-rueckwaerts" : ""}-${zeitstempel()}.${aufnahme.endung}`);
    } catch (fehler) {
      console.error(fehler);
      await aufnahme?.abbrechen();
      meldung.textContent = `Das Video ist fehlgeschlagen: ${fehler.message}`;
    } finally {
      videoKnopf.disabled = false;
      videoKnopf.textContent = "Video speichern";
    }
  });

  new ResizeObserver(zeichneKopf).observe(canvas);
}
