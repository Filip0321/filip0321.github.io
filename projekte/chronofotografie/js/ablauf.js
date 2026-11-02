// Die Abläufe, für Vorschau und Export gleich (nur eine andere Größe und eine andere GPU-Instanz):
//   bereite          Grundbild (ein echtes Bild aus dem Video) und Median (leerer Hintergrund)
//   rechneStandbild  Bilder im Abstand (oder im Takt) in den Ringpuffer, einmal mischen
//   videoSchritte    Bild für Bild durch den Bereich: jedes n-te (oder jedes im Takt) kommt in den Puffer;
//                    das aktuelle Bild liegt obenauf, außer beim Stroboskop (dann ändert sich das Bild
//                    nur beim Schlag)
//
// chrono: gpu.js-Instanz, quelle: /lib/video-quelle.js, maske: eine zweite Quelle (Maskenvideo) oder null
// g: { breite, hoehe }, e: die Einstellungen

const MEDIAN_BILDER = 15;

// ein Canvas kopieren (die Bilder aus Mediabunny werden gleich wieder überschrieben)
function kopie(canvas) {
  const neu = document.createElement("canvas");
  neu.width = canvas.width;
  neu.height = canvas.height;
  neu.getContext("2d").drawImage(canvas, 0, 0);
  return neu;
}

// zwei asynchrone Folgen im Gleichschritt (Video und Maskenvideo); fehlt die zweite, kommt null
async function* paarweise(a, b) {
  const ib = b?.[Symbol.asyncIterator]();
  for await (const x of a) {
    const y = ib ? (await ib.next()).value ?? null : null;
    yield [x, y];
  }
}

// Grundbild und Median, wie e es braucht
export async function bereite(chrono, quelle, g, e) {
  if (e.maske === "median" && !chrono.hatReferenz()) {
    const zeiten = Array.from({ length: MEDIAN_BILDER }, (_, i) => e.von + ((i + 0.5) / MEDIAN_BILDER) * (e.bis - e.von));
    const bilder = [];
    for await (const b of quelle.bilderZu(g, zeiten)) if (b) bilder.push(kopie(b.canvas));
    chrono.rechneReferenz(bilder);
  }
  if (e.hintergrund === "grundbild") {
    for await (const b of quelle.bilderZu(g, [Math.min(e.grundbild, quelle.dauer - 0.01)])) if (b) chrono.setzeGrund(b.canvas);
  }
}

// welche Zeiten das Standbild nimmt: anzahl Bilder ab von, im Abstand (Bilder) oder im Takt
export function standbildZeiten(quelle, e, einsaetze) {
  if (e.takt && einsaetze?.length) return einsaetze.filter((t) => t >= e.von && t <= e.bis).slice(0, e.anzahl);
  const zeiten = [];
  for (let i = 0; i < e.anzahl; i++) {
    const t = e.von + (i * e.abstand) / quelle.fps;
    if (t > e.bis) break;
    zeiten.push(t);
  }
  return zeiten;
}

export async function rechneStandbild(chrono, quelle, maske, g, e, zeiten) {
  chrono.leere();
  for await (const [b, m] of paarweise(quelle.bilderZu(g, zeiten), maske?.bilderZu(g, zeiten))) {
    if (b) chrono.lege(b.canvas, m?.canvas, e);
  }
  chrono.mische({ ...e, fenster: Infinity, mitAktuell: false });
}

// asynchroner Generator: nach jedem Bild { t (Sekunden), n (Nummer) }, das Ergebnis steht dann im Canvas
export async function* videoSchritte(chrono, quelle, maske, g, e, einsaetze) {
  chrono.leere();
  let n = 0;
  let takt = 0; // nächster Einsatz
  const imTakt = e.takt && einsaetze?.length;
  const strobo = imTakt && e.stroboskop;
  while (imTakt && takt < einsaetze.length && einsaetze[takt] < e.von) takt++;
  for await (const [b, m] of paarweise(quelle.bilder(g, e.von, e.bis), maske?.bilder(g, e.von, e.bis))) {
    const t = b.timestamp - quelle.anfang;
    let dazu = !imTakt && n % e.abstand === 0;
    while (imTakt && takt < einsaetze.length && einsaetze[takt] <= t) {
      takt++;
      dazu = true;
    }
    if (strobo) {
      // Stroboskop: nur beim Schlag kommt ein Bild dazu, dazwischen steht alles still
      if (dazu) chrono.lege(b.canvas, m?.canvas, e);
      chrono.mische({ ...e, fenster: e.anzahl, mitAktuell: false });
    } else {
      chrono.setzeAktuell(b.canvas, m?.canvas, e);
      chrono.mische({ ...e, fenster: e.anzahl, mitAktuell: true });
      // erst nach dem Mischen in den Puffer: sonst läge dieses Bild doppelt (aktuell und als Schicht)
      if (dazu) chrono.lege(b.canvas, m?.canvas, e);
    }
    n++;
    yield { t, n };
  }
}
