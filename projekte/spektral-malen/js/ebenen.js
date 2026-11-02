// Ebenen: was es gibt und wie sie zusammen klingen. Reine Rechnung, ohne Seite und ohne Grafikkarte,
// darum benutzen sie die Seite (Anzeige) und der Audio-Thread (klang-worklet.js) gleich.
//
// Drei Arten, alle auf demselben Raster aus Spalten und Fächern (leinwand.js):
//   mal   die Malschicht. werte: Helligkeit 0 bis 1 pro Stelle, so groß wie die Leinwand
//   bild  ein eingefügtes Bild. werte: wie bei der Malschicht, aus dem Bild gerechnet (bild-ebene.js)
//   ton   eine eingefügte Aufnahme, als STFT mit Phase (ton-analyse.js), ab Spalte "start":
//         betrag  wie laut jedes Fach ist (1 = ein Sinus mit Ausschlag 1)
//         phase   wo jeder Sinus gerade steht (Bogenmaß)
//         dreh    um wie viel sich die Phase bis zur nächsten Spalte dreht = die echte Frequenz
//         maske   Helligkeit 0 bis 1, Startwert 1: darauf malt und radiert man, die Aufnahme bleibt
//
// Alle drei haben gain (dB) und stumm. Eine Ton-Ebene kann eine andere Ebene als Filter nehmen
// (Kreuzsynthese): dann klingt diese andere Ebene nicht selbst, sie formt nur die Aufnahme.
//
// Alles liegt Spalte für Spalte im Speicher: werte[spalte · faecher + fach] (wie in klang-worklet.js)

// Helligkeit -> Lautstärke über dB, wie zuAmplitude in /lib/ton.js:
//   1 = 0 dB (Ausschlag 1), 0 = Stille, dazwischen −dynamik dB bis 0 dB
// 10 ** x für jede Stelle wäre für die ganze Leinwand zu langsam (eine Million Stellen), darum eine
// Tabelle mit 1024 Schritten, zwischen zwei Schritten wird gerade verbunden (kaum zu hören)
export const SCHRITTE = 1024;

export function amplitudenTabelle(dynamik) {
  const tabelle = new Float32Array(SCHRITTE + 2); // + 2: auch wert = 1 hat noch einen rechten Nachbarn
  for (let i = 1; i < tabelle.length; i++) tabelle[i] = 10 ** ((((i / SCHRITTE) - 1) * dynamik) / 20);
  return tabelle; // tabelle[0] = 0: Schwarz ist echte Stille
}

export function amplitude(tabelle, wert) {
  if (wert <= 0) return 0;
  const x = Math.min(wert, 1) * SCHRITTE;
  const i = Math.floor(x);
  return tabelle[i] + (tabelle[i + 1] - tabelle[i]) * (x - i);
}

// Lautstärke -> Helligkeit (umgekehrt, für Maus-Info und Anzeige-Shader)
export function helligkeit(amp, dynamik) {
  return amp > 0 ? Math.max(0, 1 + (20 * Math.log10(amp)) / dynamik) : 0;
}

export const dbZuFaktor = (db) => 10 ** (db / 20);

// Wer klingt wie? Einmal nach jeder Änderung an den Ebenen ausrechnen, nicht bei jeder Stelle
//   flaechig  Malschicht und Bilder, die selbst klingen
//   toene     Ton-Ebenen, die klingen (mit ihrem Filter, falls einer gewählt ist)
export function rollen(ebenen) {
  const nachId = new Map(ebenen.map((e) => [e.id, e]));
  const filter = new Set();
  const toene = [];
  for (const e of ebenen) {
    if (e.art !== "ton") continue;
    const f = e.filter ? nachId.get(e.filter) : null; // gelöschte Filter-Ebene: kein Filter
    if (f) filter.add(f.id);
    if (!e.stumm) toene.push({ ebene: e, filter: f ?? null });
  }
  const flaechig = ebenen.filter((e) => e.art !== "ton" && !e.stumm && !filter.has(e.id));
  return { flaechig, toene, filter };
}

// Für die Anzeige: Lautstärke jeder Stelle von Spalte von bis bis (beide mit) in ziel.
// Phasen werden hier nicht beachtet (Beträge addiert): man sieht, wie laut jede Ebene beiträgt.
// nur: eine einzelne Ebene zeigen, ohne Filter und auch wenn sie stumm ist (Ansicht „aktive Ebene“)
export function mischeAnzeige(ziel, von, bis, { leinwand, ebenen, tabelle, nur = null }) {
  const { faecher, spalten } = leinwand;
  const { flaechig, toene } = nur
    ? rollen([{ ...nur, stumm: false, filter: null }])
    : rollen(ebenen);
  for (let s = von; s <= bis; s++) {
    const basis = s * faecher;
    ziel.fill(0, basis, basis + faecher);
    for (const e of flaechig) {
      const g = dbZuFaktor(e.gain);
      const w = e.werte;
      for (let k = 0; k < faecher; k++) {
        const v = w[basis + k];
        if (v > 0) ziel[basis + k] += amplitude(tabelle, v) * g;
      }
    }
    for (const { ebene: e, filter: f } of toene) {
      const lokal = s - e.start; // Spalte in der Aufnahme
      if (lokal < 0 || lokal >= e.spalten || s >= spalten) continue;
      const lb = lokal * faecher;
      const g = dbZuFaktor(e.gain);
      const fg = f ? dbZuFaktor(f.gain) : 1;
      for (let k = 0; k < faecher; k++) {
        const b = e.betrag[lb + k];
        if (b <= 0) continue;
        let v = b * amplitude(tabelle, e.maske[lb + k]) * g;
        if (f) v *= amplitude(tabelle, f.werte[basis + k]) * fg;
        ziel[basis + k] += v;
      }
    }
  }
}
