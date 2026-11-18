// Tonspeicher (Runde 33): Aufnahmen und Tondateien bleiben erhalten, auch nach dem Neuladen der Seite.
//
// Ein Patch ist Text (JSON): ein paar Kilobyte. Eine Aufnahme sind Megabytes. Darum steht im Patch nur ein Schlüssel
// (werte.ton = "t…"), die Bytes selbst liegen in der IndexedDB des Browsers: einer kleinen Datenbank je Website, die
// große Binärdaten speichern darf (localStorage kann nur Text, und nur etwa 5 MB). Gespeichert wird die Datei so, wie
// sie kam (WAV, MP3, die WebM-Aufnahme vom Mikrofon), und beim Laden wieder mit decodeAudioData entpackt.
//
// Grenze: die IndexedDB gehört zu DIESEM Browser auf DIESEM Gerät. Ein Patch als Datei an jemand anderen (oder
// an Firefox statt Chrome) hat die Töne nicht dabei; dafür gibt es „als WAV“ (alsWav unten) zum Herunterladen.

const DB = "patch-toene", LAGER = "toene";
let offen = null;
const db = () =>
  (offen ??= new Promise((ja, nein) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LAGER);
    r.onsuccess = () => ja(r.result);
    r.onerror = () => nein(r.error);
  }));

const anfrage = async (art, tu) => {
  const d = await db();
  return new Promise((ja, nein) => {
    const t = d.transaction(LAGER, art), r = tu(t.objectStore(LAGER));
    r.onsuccess = () => ja(r.result);
    r.onerror = () => nein(r.error);
  });
};

// Bytes ablegen; gibt den Schlüssel zurück
export async function legeAb(bytes) {
  const schluessel = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  try {
    await anfrage("readwrite", (l) => l.put(bytes, schluessel));
    return schluessel;
  } catch {
    return null; // privater Modus oder voll: dann eben nicht gespeichert
  }
}

export async function hole(schluessel) {
  try {
    return (await anfrage("readonly", (l) => l.get(schluessel))) ?? null;
  } catch {
    return null;
  }
}

// AudioBuffer → WAV (16 Bit, wie eine CD): 44 Bytes Kopf, dann die Samples Kanal für Kanal verschränkt
export function alsWav(puffer) {
  const k = puffer.numberOfChannels, n = puffer.length, sr = puffer.sampleRate, bytes = 44 + n * k * 2;
  const v = new DataView(new ArrayBuffer(bytes));
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, k, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * k * 2, true);
  v.setUint16(32, k * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * k * 2, true);
  const kanaele = Array.from({ length: k }, (_, c) => puffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, kanaele[c][i])) * 32767, true);
  return new Blob([v], { type: "audio/wav" });
}

export function ladeHerunter(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
