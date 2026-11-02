// Vorwärts und rückwärts hören mit einem <audio controls>.
// Für bild-zu-ton, das Spektrogramm (Dateien und Aufnahmen) und den Ton der Attraktoren.
//
// Der Player bekommt zwei Quellen: den Ton vorwärts und denselben Ton umgedreht (die Samples von hinten
// nach vorn). Das Häkchen „rückwärts“ wechselt zwischen beiden, an derselben Stelle im Ton:
// Steht der Player vorwärts bei t, steht er rückwärts bei Dauer − t.
//
// Warum nicht ein eigener Abspieler mit Web Audio? Das <audio> bringt Leiste, Lautstärke, Schleife
// und Springen schon mit, und im Spektrogramm hängt die ganze Analyse an genau diesem Element
// (createMediaElementSource). Was hier fehlte, war nur die zweite Richtung.
//
// Zeiten nach außen sind immer Zeiten im Ton vorwärts (zeit(), springe()): der Lesekopf läuft
// rückwärts von rechts nach links, ohne dass die Seite selbst umrechnen muss.

import { zuWav } from "/lib/export.js";

export function richteWiedergabeEin({ spieler, rueckwaertsFeld }) {
  let ton = null; // AudioBuffer vorwärts: aus ihm wird die umgedrehte Fassung gebaut
  let vorwaerts = null; // Adresse der Quelle vorwärts (blob:…)
  let rueckwaerts = null; // … und rückwärts, erst gebaut, wenn man sie braucht
  let eigeneVorwaerts = false; // vorwaerts selbst gebaut (dann auch selbst freigeben)

  // umgedreht: dieselben Samples in umgekehrter Reihenfolge, in einem neuen Puffer
  function umdrehen(puffer) {
    const umgedreht = new AudioBuffer({
      length: puffer.length,
      numberOfChannels: puffer.numberOfChannels,
      sampleRate: puffer.sampleRate,
    });
    for (let k = 0; k < puffer.numberOfChannels; k++) {
      const samples = puffer.getChannelData(k).slice(); // Kopie: reverse() dreht sonst den Puffer selbst um
      samples.reverse();
      umgedreht.copyToChannel(samples, k);
    }
    return umgedreht;
  }

  function quelleRueckwaerts() {
    // erst beim ersten Umschalten: eine WAV-Datei von 5 Minuten Stereo ist gut 50 MB groß
    rueckwaerts ??= URL.createObjectURL(zuWav(umdrehen(ton)));
    return rueckwaerts;
  }

  function istRueckwaerts() {
    return Boolean(ton) && rueckwaertsFeld.checked;
  }

  // Neuer Ton. url: die Datei selbst (Spektrogramm, spart das Umwandeln), sonst wird aus puffer eine WAV.
  // puffer fehlt (Datei nicht lesbar): dann gibt es nur vorwärts.
  function lade({ url = null, puffer = null }) {
    if (eigeneVorwaerts && vorwaerts) URL.revokeObjectURL(vorwaerts);
    if (rueckwaerts) URL.revokeObjectURL(rueckwaerts);
    rueckwaerts = null;
    ton = puffer;
    if (!ton) rueckwaertsFeld.checked = false; // noch kein Puffer (Spektrogramm liest noch): erst einmal vorwärts
    eigeneVorwaerts = !url;
    vorwaerts = url ?? URL.createObjectURL(zuWav(puffer));
    rueckwaertsFeld.disabled = !ton;
    spieler.src = istRueckwaerts() ? quelleRueckwaerts() : vorwaerts;
  }

  // nur den Puffer nachreichen (das Spektrogramm spielt die Datei schon, während es sie noch liest)
  function setzePuffer(puffer) {
    ton = puffer;
    rueckwaertsFeld.disabled = !ton;
  }

  function zeit() {
    if (!Number.isFinite(spieler.duration)) return 0; // noch nichts geladen (duration ist NaN)
    return istRueckwaerts() ? spieler.duration - spieler.currentTime : spieler.currentTime;
  }

  function springe(sekunden) {
    if (!Number.isFinite(spieler.duration)) return;
    spieler.currentTime = istRueckwaerts() ? spieler.duration - sekunden : sekunden;
  }

  // 0 am Anfang des Tons vorwärts, 1 am Ende (für Lesekopf und Bild)
  function anteil() {
    return Number.isFinite(spieler.duration) && spieler.duration > 0 ? zeit() / spieler.duration : 0;
  }

  // Umschalten, auch während es läuft: an derselben Stelle weiter.
  // Ganz am Anfang (oder ganz am Ende) bleibt es am Anfang, sonst stünde der Player gleich am Ende
  // und wäre sofort fertig.
  rueckwaertsFeld.addEventListener("change", () => {
    if (!ton) return;
    const amRand = spieler.currentTime === 0 || spieler.ended;
    const stelle = amRand ? 0 : spieler.duration - spieler.currentTime;
    const lief = !spieler.paused;
    spieler.src = rueckwaertsFeld.checked ? quelleRueckwaerts() : vorwaerts; // neue Quelle: fängt bei 0 an und lädt
    spieler.addEventListener("loadedmetadata", () => {
      spieler.currentTime = stelle;
      if (lief) spieler.play();
    }, { once: true });
  });

  rueckwaertsFeld.disabled = true; // bis ein Ton da ist

  return { lade, setzePuffer, zeit, springe, anteil, istRueckwaerts, umdrehen };
}
