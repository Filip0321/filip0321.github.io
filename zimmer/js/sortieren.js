// Sortieren nach Tiefe, in einem eigenen Thread (Web Worker), damit die Seite dabei nicht ruckelt.
//
// Halb durchsichtige Flecken lassen sich nur richtig übereinander malen, wenn man hinten anfängt (wie ein Maler:
// was vorn ist, kommt zuletzt). Bei jeder neuen Blickrichtung ändert sich die Reihenfolge. Hunderttausende Zahlen
// mit sort() zu sortieren dauert zu lang; die Tiefe muss aber gar nicht genau sein: sie wird auf 65 536 Stufen
// gerundet und dann mit Counting Sort sortiert (einmal zählen, wie viele in jede Stufe fallen, daraus die Startplätze,
// dann jeden an seinen Platz). Das ist linear in der Anzahl, ein paar Millisekunden für eine Million.
//
// Nachrichten: { lage } einmal am Anfang; danach { ansicht } (4 × 4, Spalten zuerst), Antwort { reihenfolge }.

let lage = null;
let tiefe = null;
let stufe = null;
const zaehler = new Uint32Array(65536);

onmessage = ({ data }) => {
  if (data.lage) {
    lage = data.lage;
    const n = lage.length / 3;
    tiefe = new Float32Array(n);
    stufe = new Uint16Array(n);
    return;
  }
  if (!data.ansicht || !lage) return;
  const m = data.ansicht;
  const n = tiefe.length;
  // Tiefe im Blick: die z-Zeile der Ansichtsmatrix (die Kamera schaut nach −z: weiter weg = kleiner)
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = m[2] * lage[3 * i] + m[6] * lage[3 * i + 1] + m[10] * lage[3 * i + 2] + m[14];
    tiefe[i] = z;
    if (z < min) min = z;
    if (z > max) max = z;
  }
  const f = 65535 / Math.max(1e-9, max - min);
  zaehler.fill(0);
  for (let i = 0; i < n; i++) {
    const s = ((tiefe[i] - min) * f) | 0;
    stufe[i] = s;
    zaehler[s]++;
  }
  // Startplätze: kleinste Tiefe (am weitesten weg) zuerst
  let summe = 0;
  for (let s = 0; s < 65536; s++) {
    const c = zaehler[s];
    zaehler[s] = summe;
    summe += c;
  }
  const reihenfolge = new Uint32Array(n);
  for (let i = 0; i < n; i++) reihenfolge[zaehler[stufe[i]]++] = i;
  postMessage({ reihenfolge }, [reihenfolge.buffer]);
};
