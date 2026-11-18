// Takt: Ereignisse statt Ton. Ein Takt-Ausgang ruft alle angeschlossenen Eingänge mit (zeit, dauer) auf; zeit ist
// eine Zeit der Audio-Uhr (AudioContext.currentTime), meist ein kleines Stück in der Zukunft.
//
// Warum vorausplanen? JavaScript-Zeitgeber (setTimeout, setInterval) kommen oft 10–50 ms zu spät, wenn die Seite
// gerade zeichnet; im Rhythmus hört man das sofort. Die Audio-Uhr dagegen läuft auf das Sample genau. Also schaut
// eine grobe JS-Schleife alle 25 ms nach, welche Schläge in den nächsten 100 ms fällig sind, und trägt sie mit ihrer
// genauen Zeit in den Fahrplan der Audio-Regler ein („A Tale of Two Clocks“, Chris Wilson, 2013). Solange die
// Schleife nicht länger als 100 ms hängt, kommt jeder Schlag pünktlich.

export class Takt {
  constructor() {
    this.hoerer = new Set();
  }
  // dauer: wie lange der Ton gehalten wird; Infinity = bis loslassen() kommt (eine Taste am MIDI-Keyboard:
  // beim Anschlag weiß man noch nicht, wann sie losgelassen wird)
  sende(zeit, dauer) {
    this.blink?.(zeit); // das Lämpchen an der Buchse (main.js)
    for (const h of this.hoerer) h(zeit, dauer);
  }
  // Taste los: wer gehaltene Töne kennt (Hüllkurve), hat eine Funktion .los am Eingang
  loslassen(zeit) {
    for (const h of this.hoerer) h.los?.(zeit);
  }
}

// Noten (Runde 21): Ereignisse mit Tonhöhe, beliebig viele gleichzeitig. Ein Ton-Kabel kann nur EINE Tonhöhe tragen
// (eine Zahl je Sample, wie eine Spannung); für einen Akkord bräuchte man drei Kabel und drei Stimmen. Ein Noten-Kabel
// trägt stattdessen Nachrichten wie MIDI: „Note 60 an, Anschlag 0,8“ und später „Note 60 aus“. Wer zuhört (die
// Stimmen), verteilt sie selbst auf seine Stimmen. So arbeiten auch Bitwig (Notenkabel) und Max (MIDI-Ströme).
//   an(zeit, ton, anschlag, dauer)   ton: MIDI-Nummer (60 = C4, Kommazahlen erlaubt), anschlag 0 … 1,
//                                    dauer in Sekunden oder Infinity (bis aus() kommt, wie eine gehaltene Taste)
//   aus(zeit, ton)                   nur nötig bei dauer = Infinity
// Ein Hörer ist eine Funktion (zeit, ton, anschlag, dauer) mit einer Funktion .aus(zeit, ton) daran.
export class Noten {
  constructor() {
    this.hoerer = new Set();
  }
  an(zeit, ton, anschlag = 0.8, dauer = Infinity) {
    this.blink?.(zeit);
    for (const h of this.hoerer) h(zeit, ton, anschlag, dauer);
  }
  aus(zeit, ton) {
    for (const h of this.hoerer) h.aus?.(zeit, ton);
  }
  alleAus(zeit) {
    for (const h of this.hoerer) h.alleAus?.(zeit);
  }
}

export function erstelleUhr(ctx) {
  const VORAUS = 0.1, ALLE = 25;
  const abos = new Set();
  const null_ = ctx.currentTime; // alle Abos zählen ab demselben Nullpunkt: gleiches Tempo → gleicher Schlag
  setInterval(() => {
    if (ctx.state !== "running") return;
    const bis = ctx.currentTime + VORAUS;
    for (const a of abos) {
      const schritt = 60 / Math.max(1, a.tempo());
      if (a.naechste === null || a.naechste < ctx.currentTime - 0.2) {
        // neu (oder lange angehalten): auf den nächsten Schlag des gemeinsamen Rasters setzen
        const n = Math.ceil((ctx.currentTime + 0.01 - null_) / schritt);
        a.naechste = null_ + n * schritt;
        a.nr = n;
      }
      while (a.naechste < bis) {
        a.rufe(a.naechste, a.nr);
        a.nr += 1;
        a.naechste += schritt;
      }
    }
  }, ALLE);
  return {
    nullpunkt: null_,
    // tempo: () => Schläge pro Minute; rufe: (zeit, nummer); gibt eine Funktion zum Abmelden zurück
    abonniere(tempo, rufe) {
      const a = { tempo, rufe, naechste: null, nr: 0 };
      abos.add(a);
      return () => abos.delete(a);
    },
  };
}
