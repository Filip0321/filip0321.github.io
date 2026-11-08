// Klang für Effekte der Sammlung (RGB-Versatz zum Bass, Circuit Bending im Takt): wie laut Bass, Mitte und
// Höhen gerade sind und ob ein Schlag kam, je 0 bis 1. Drei Quellen, der Effekt wählt mit dem Regler „Klang“:
//   0  Musik der Seite: audioreaktiv.js (Fraktale, Attraktoren) meldet jedes Bild, was es misst, live und beim
//      Video-Export an der Zeit des Bildes. Ohne Musik auf der Seite: Stille.
//   1  Mikrofon: eigene kleine Messung (AnalyserNode), nur live; der Browser fragt einmal um Erlaubnis.
//   2  Takt: ein künstlicher Schlag im eingestellten Tempo (BPM), aus der Zeit gerechnet. Genau gleich in
//      Vorschau und Export, darum der sichere Weg für Videos.
//
// Bass und Schlag gehen hier nicht durch eine FFT wie in audioreaktiv.js: der Analyser liefert schon die
// Lautstärke je Frequenz in dB (getFloatFrequencyData), es reicht, die Fächer unter 150 Hz zu mitteln.

const STILLE = { bass: 0, mitte: 0, hoehen: 0, schlag: 0 };
let vonDerSeite = { ...STILLE };

// audioreaktiv.js ruft das bei jeder Messung (verteile)
export function meldeKlang(werte) {
  vonDerSeite = { bass: werte.bass ?? 0, mitte: werte.mitte ?? 0, hoehen: werte.hoehen ?? 0, schlag: werte.schlag ?? 0 };
}

// ---------- Mikrofon ----------
let mikro = null; // { analyser, daten, spitze, wert, letzte }
let mikroLaeuft = false;
async function starteMikrofon() {
  if (mikroLaeuft) return;
  mikroLaeuft = true;
  try {
    const strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ac = new AudioContext();
    await ac.resume();
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    ac.createMediaStreamSource(strom).connect(analyser); // nicht an die Lautsprecher (sonst pfeift es)
    mikro = { analyser, daten: new Float32Array(analyser.frequencyBinCount), rate: ac.sampleRate, spitze: { bass: 1e-3, mitte: 1e-3, hoehen: 1e-3 }, wert: { ...STILLE }, bassMittel: 0, letzte: 0 };
  } catch (fehler) {
    console.warn("Mikrofon für Effekte:", fehler.message);
  }
}

// Band von bis Hz: mittlere Leistung (aus dB), dann an der lautesten Stelle der letzten Sekunden gemessen
function band(m, von, bis) {
  const fach = m.rate / 2 / m.daten.length;
  let summe = 0;
  let n = 0;
  for (let i = Math.max(1, Math.floor(von / fach)); i <= Math.min(m.daten.length - 1, Math.ceil(bis / fach)); i++) {
    summe += 10 ** (m.daten[i] / 10);
    n++;
  }
  return n ? summe / n : 0;
}

function mikroWerte() {
  const m = mikro;
  const jetzt = performance.now();
  if (jetzt - m.letzte < 10) return m.wert; // mehrmals im selben Bild gefragt: dieselbe Antwort
  const dt = Math.min(0.1, (jetzt - m.letzte) / 1000 || 0.016);
  m.letzte = jetzt;
  m.analyser.getFloatFrequencyData(m.daten);
  const roh = { bass: band(m, 20, 150), mitte: band(m, 150, 2000), hoehen: band(m, 2000, 12000) };
  for (const k of ["bass", "mitte", "hoehen"]) {
    // Lautstärke-Anpassung: die Spitze vergisst langsam (4 s), so wird leise Musik nicht zu Null
    m.spitze[k] = Math.max(roh[k], m.spitze[k] * Math.exp(-dt / 4));
    const ziel = Math.sqrt(roh[k] / m.spitze[k]);
    m.wert[k] += (ziel - m.wert[k]) * (1 - Math.exp(-dt / (ziel > m.wert[k] ? 0.03 : 0.25)));
  }
  // Schlag: Bass springt deutlich über seinen Mittelwert
  m.bassMittel += (m.wert.bass - m.bassMittel) * (1 - Math.exp(-dt / 0.5));
  m.wert.schlag = m.wert.bass > m.bassMittel * 1.4 && m.wert.bass > 0.35 ? 1 : m.wert.schlag * Math.exp(-dt / 0.18);
  return m.wert;
}

// ---------- Takt ----------
function taktWerte(zeit, bpm) {
  const schlaege = (zeit * bpm) / 60;
  const phase = schlaege - Math.floor(schlaege); // 0 genau auf dem Schlag, dann bis 1
  const schlag = Math.exp(-phase * 7); // schnell abklingend, wie eine Bassdrum
  return { bass: schlag, mitte: 0.5 + 0.5 * Math.sin(schlaege * Math.PI * 0.5), hoehen: Math.exp(-((schlaege * 2) % 1) * 9), schlag };
}

// was ein Effekt bekommt: quelle wie der Regler „Klang“ (0 Seite, 1 Mikrofon, 2 Takt), zeit in Sekunden
export function klang(quelle, zeit, bpm = 120) {
  if (quelle > 1.5) return taktWerte(zeit, bpm);
  if (quelle > 0.5) {
    starteMikrofon(); // beim ersten Mal: fragt um Erlaubnis, bis dahin Stille
    return mikro ? mikroWerte() : STILLE;
  }
  return vonDerSeite;
}

// Nummer des Schlags (für Zufall, der pro Schlag gleich bleibt): im Takt genau, sonst aus der Zeit
export function schlagNummer(quelle, zeit, bpm = 120) {
  return Math.floor((zeit * bpm) / 60);
}

// Regler, die jeder Klang-Effekt hat
export const KLANG_REGLER = [
  { name: "klangQuelle", text: "Klang", auswahl: ["Musik der Seite", "Mikrofon", "Takt"], wert: 2 },
  { name: "bpm", text: "Takt (BPM)", min: 40, max: 200, schritt: 1, wert: 120 },
];
