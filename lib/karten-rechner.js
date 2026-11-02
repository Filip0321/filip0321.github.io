// Rechnet Zeilen der Parameterkarte im Hintergrund (Web Worker), damit die Seite nicht einfriert.
// Ein Worker ist ein eigenes Skript in einem eigenen Faden: Er sieht kein HTML und keine Variablen
// der Seite, beide reden nur über Nachrichten (postMessage hin, onmessage zurück).
// parameterkarte.js startet mehrere davon (einen pro Prozessorkern) und gibt jedem eine Zeile nach der anderen.
//
// Bekommt:  { modul, typName, werte, start, xName, yName, xVon, xBis, yVon, yBis, groesse, y }
//           modul: Adresse der attraktor.js, deren TYPEN und lyapunov() benutzt werden (2D oder 3D)
// Schickt:  { y, zeile }   zeile: Lyapunov-Exponent für jeden Pixel dieser Zeile

const module = {}; // schon geladene attraktor.js, damit nicht jede Zeile neu lädt

self.onmessage = async ({ data }) => {
  const { modul, typName, werte, start, xName, yName, xVon, xBis, yVon, yBis, groesse, y } = data;
  // import() als Funktion: lädt ein Modul erst, wenn es gebraucht wird, und die Adresse darf eine Variable sein
  module[modul] ??= await import(modul);
  const { TYPEN, lyapunov } = module[modul];
  const typ = TYPEN[typName];
  const w = { ...werte }; // Kopie: zwei Werte werden pro Pixel verstellt, die anderen bleiben

  // + 0.5: der Wert in der Mitte des Pixels, nicht an seinem Rand; oben im Bild = großer Wert
  w[yName] = yBis - ((y + 0.5) / groesse) * (yBis - yVon);
  const zeile = new Float32Array(groesse);
  for (let x = 0; x < groesse; x++) {
    w[xName] = xVon + ((x + 0.5) / groesse) * (xBis - xVon);
    zeile[x] = lyapunov(typ, w, start ?? typ.start);
  }
  // [zeile.buffer]: den Speicher übergeben statt kopieren (danach ist zeile hier leer)
  self.postMessage({ y, zeile }, [zeile.buffer]);
};
