// Ton kaputt und knisternd: was alte Geräte, Platten und Bänder mit einem Klang machen, Sample für Sample und
// mit Gedächtnis (der nächste Block weiß, was im letzten war). So geht es in Stücken, wie sie live (Vorhören) und
// beim Video-Export (Mediabunny gibt den Ton blockweise) ankommen.
//
//   knistern    Platte: einzelne Knackser (kurze Spitzen, zufällig verteilt, mal laut, mal leise) und darunter
//               leises Prasseln. Dichte und Lautstärke wachsen mit dem Regler
//   rauschen    Bandrauschen, gleichmäßig
//   leiern      Gleichlauf wie ein altes Tonband: der Ton wird über eine kurze Verzögerung gelesen, deren Länge
//               langsam schwankt (0,6 Hz, bis 6 ms). Kürzer werdende Verzögerung = schneller lesen = höher
//   bits        weniger Stufen pro Sample (16 = wie CD, 4 = grob): leise Stellen werden zu Rauschen und Krach
//   teiler      Abtastrate runter: nur jedes n-te Sample wird gemessen und so lange gehalten (Sample and Hold).
//               Was über rate / (2 · n) liegt, spiegelt sich nach unten (Aliasing): das metallische Klirren
//   aussetzer   wie ein kaputtes Kabel oder eine springende CD: manchmal ist kurz Stille, manchmal wiederholt sich
//               das letzte Stück (50 bis 120 ms) ein paar Mal
//   verzerren   übersteuern: tanh drückt Spitzen weich zusammen, je mehr, desto mehr Obertöne
//   hoehen      Höhen weg (einfacher Tiefpass): von offen bis Telefon
//
// werte: { knistern, rauschen, leiern, bits, teiler, aussetzer, verzerren, hoehen } (siehe Seite für die Bereiche)
//        dazu stottern: true = genau jetzt (am Anfang dieses Blocks) ein Stück wiederholen (Datamosh: beim Sprung)

export const KAPUTT_AUS = { knistern: 0, rauschen: 0, leiern: 0, bits: 16, teiler: 1, aussetzer: 0, verzerren: 0, hoehen: 1 };
export const istAus = (w) => Object.keys(KAPUTT_AUS).every((k) => w[k] === KAPUTT_AUS[k]);

export function erstelleKaputt(rate, kanaele) {
  const RING = Math.ceil(rate * 0.5); // fürs Leiern und die Wiederholungen
  const ring = Array.from({ length: kanaele }, () => new Float32Array(RING));
  const gehalten = new Float32Array(kanaele);
  const tief = new Float32Array(kanaele);
  let schreib = 0;
  let zaehler = 0; // Samples seit dem Anfang (für Leiern und Teiler)
  let knack = 0; // die Hülle des Knacksers, der gerade klingt
  let knackLaut = 0;
  let ausfall = 0; // so viele Samples noch: Stille oder Wiederholung
  let ausfallArt = "still";
  let wiederholLaenge = 0;
  let wiederholStart = 0;

  return function verarbeite(daten, w) {
    const n = daten[0].length;
    const k = Math.min(kanaele, daten.length);
    const stufen = 2 ** (Math.round(w.bits) - 1);
    const teiler = Math.max(1, Math.round(w.teiler));
    const fc = 300 * (20000 / 300) ** w.hoehen; // Grenzfrequenz, log von 300 Hz bis 20 kHz
    const a = 1 - Math.exp((-2 * Math.PI * fc) / rate);
    const antrieb = 1 + w.verzerren * 20;
    const ausgleich = 1 / Math.sqrt(antrieb); // grob gleich laut wie vorher (sonst wird nur lauter, was verzerrt)
    const knackRate = (w.knistern ** 2 * 30) / rate; // bis 30 Knackser pro Sekunde
    if (w.stottern && ausfall <= 0) {
      ausfallArt = "wieder";
      ausfall = Math.round(rate * (0.12 + Math.random() * 0.2));
      wiederholLaenge = Math.round(rate * (0.03 + Math.random() * 0.05));
      wiederholStart = (schreib - wiederholLaenge + RING) % RING;
    }
    for (let i = 0; i < n; i++, zaehler++) {
      // Aussetzer: ab und zu (bis 2-mal pro Sekunde) beginnt einer
      if (ausfall <= 0 && Math.random() < (w.aussetzer * 2) / rate) {
        ausfallArt = Math.random() < 0.5 ? "still" : "wieder";
        ausfall = Math.round(rate * (0.03 + Math.random() * 0.2));
        wiederholLaenge = Math.round(rate * (0.05 + Math.random() * 0.07));
        wiederholStart = (schreib - wiederholLaenge + RING) % RING;
      }
      // Knackser: einer beginnt, klingt in 1 bis 2 ms ab
      if (Math.random() < knackRate) {
        knack = 1;
        knackLaut = (0.2 + Math.random() * 0.8) * w.knistern * (Math.random() < 0.5 ? -1 : 1);
      }
      const knackJetzt = knack * knackLaut;
      knack *= 0.985;
      const prasseln = (Math.random() * 2 - 1) * w.knistern * 0.02 * (Math.random() < 0.1 ? 1 : 0.2);
      const zisch = (Math.random() * 2 - 1) * w.rauschen * 0.08;
      // Leiern: Verzögerung in Samples, schwankt langsam
      const verz = w.leiern > 0 ? (0.003 + 0.003 * Math.sin((2 * Math.PI * 0.6 * zaehler) / rate)) * w.leiern * rate + 1 : 0;
      const halten = zaehler % teiler === 0;
      for (let c = 0; c < k; c++) {
        const kanal = daten[c];
        ring[c][schreib] = kanal[i];
        let x = kanal[i];
        if (verz > 0) {
          const pos = schreib - verz;
          const p0 = Math.floor(pos);
          const t = pos - p0;
          const r0 = ring[c][(p0 + RING) % RING];
          const r1 = ring[c][(p0 + 1 + RING) % RING];
          x = r0 + (r1 - r0) * t;
        }
        if (ausfall > 0) x = ausfallArt === "still" ? 0 : ring[c][(wiederholStart + ((zaehler % wiederholLaenge) + RING)) % RING];
        if (w.verzerren > 0) x = Math.tanh(x * antrieb) * ausgleich; // lauter machen, abschneiden, wieder leiser
        if (halten) gehalten[c] = x;
        x = gehalten[c];
        if (stufen < 32768) x = Math.round(x * stufen) / stufen;
        tief[c] += (x - tief[c]) * a;
        x = tief[c] + knackJetzt + prasseln + zisch;
        kanal[i] = Math.max(-1, Math.min(1, x));
      }
      if (ausfall > 0) ausfall--;
      schreib = (schreib + 1) % RING;
    }
  };
}
