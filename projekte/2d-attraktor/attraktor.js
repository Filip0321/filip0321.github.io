// Rechne den Attraktor aus, gezeichnet wird er dann vom shader
// Dadurch muss ich die Punkte nicht mit jeder Bewegung komplett neu berechnen

const LIMIT_ABSTAND_PUNKTE = 1000000; // weiter weg gilt als davongelaufen
const EINPENDELN = 100; // so viele Schritte am Anfang nicht speichern


// Hilfsfunktion für Gumowski-Mira-Attraktor 

function gmFunktion(x, b) {
  return b * x + (2 * (1 - b) * x * x) / (1 + x * x);
}


// Attraktor-Typen
// hab ich von http://www.3d-meier.de/tut19/Seite1.html

export const TYPEN = {
  clifford: {
    name: "Clifford",
    formel: "x' = sin(a·y) + c·cos(a·x)\ny' = sin(b·x) + d·cos(b·y)",
    parameter: ["a", "b", "c", "d"],
    start: [0.1, 0.1],  // Startwerte für x und y, sind bei attraktoren egal 
                        // (bei gumowski führen sie zu unterschiedlichen Bildern)
    schritt(w, pos) {   // w = Werte, pos = Position
      const x = Math.sin(w.a * pos.y) + w.c * Math.cos(w.a * pos.x);
      const y = Math.sin(w.b * pos.x) + w.d * Math.cos(w.b * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  dejong: {
    name: "Peter de Jong",
    formel: "x' = sin(a·y) - cos(b·x)\ny' = sin(c·x) - cos(d·y)",
    parameter: ["a", "b", "c", "d"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const x = Math.sin(w.a * pos.y) - Math.cos(w.b * pos.x);
      const y = Math.sin(w.c * pos.x) - Math.cos(w.d * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  svensson: {
    name: "Svensson",
    formel: "x' = d·sin(a·x) - sin(b·y)\ny' = c·cos(a·x) + cos(b·y)",
    parameter: ["a", "b", "c", "d"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const x = w.d * Math.sin(w.a * pos.x) - Math.sin(w.b * pos.y);
      const y = w.c * Math.cos(w.a * pos.x) + Math.cos(w.b * pos.y);
      pos.x = x;
      pos.y = y;
    }
  },
  hopalong: {
    name: "Hopalong",
    formel: "x' = y - sign(x)·√|b·x - c|\ny' = a - x",
    parameter: ["a", "b", "c"],
    start: [0, 0],
    schritt(w, pos) {
      const x = pos.y - Math.sign(pos.x) * Math.sqrt(Math.abs(w.b * pos.x - w.c));
      const y = w.a - pos.x;
      pos.x = x;
      pos.y = y;
    }
  },
  gumowskiMira: {
    name: "Gumowski-Mira",
    formel: "f(x) = b·x + 2·(1 - b)·x² / (1 + x²)\nx' = y + a·(1 - 0.05·y²)·y + f(x)\ny' = -x + f(x')",
    parameter: ["a", "b"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const x = pos.y + w.a * (1 - 0.05 * pos.y * pos.y) * pos.y + gmFunktion(pos.x, w.b);
      const y = -pos.x + gmFunktion(x, w.b);
      pos.x = x;
      pos.y = y;
    }
  },
  tinkerbell: {
    name: "Tinkerbell",
    formel: "x' = x² - y² + a·x + b·y\ny' = 2·x·y + c·x + d·y",
    parameter: ["a", "b", "c", "d"],
    start: [-0.72, -0.64],
    schritt(w, pos) {
      const x = pos.x * pos.x - pos.y * pos.y + w.a * pos.x + w.b * pos.y;
      const y = 2 * pos.x * pos.y + w.c * pos.x + w.d * pos.y;
      pos.x = x;
      pos.y = y;
    }
  },
  ikeda: {
    name: "Ikeda",
    formel: "t = c - 6 / (1 + x² + y²)\nx' = 1 + u·(x·cos t - y·sin t)\ny' = u·(x·sin t + y·cos t)",
    parameter: ["c", "u"],
    start: [0.1, 0.1],
    schritt(w, pos) {
      const t = w.c - 6 / (1 + pos.x * pos.x + pos.y * pos.y);
      const x = 1 + w.u * (pos.x * Math.cos(t) - pos.y * Math.sin(t));
      const y = w.u * (pos.x * Math.sin(t) + pos.y * Math.cos(t));
      pos.x = x;
      pos.y = y;
    }
  },
};


// Die Presets und ihre initialen Werte

export const PRESETS = [
  { name: "Clifford I", typ: "clifford", werte: { a: -1.4, b: 1.6, c: 1.0, d: 0.7 }, text: "Platzhalter." },
  { name: "Clifford II", typ: "clifford", werte: { a: 1.7, b: 1.7, c: 0.6, d: 1.2 }, text: "Platzhalter." },
  { name: "De Jong I", typ: "dejong", werte: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 }, text: "Platzhalter." },
  { name: "De Jong II", typ: "dejong", werte: { a: -2.7, b: -0.09, c: -0.86, d: -2.2 }, text: "Platzhalter." },
  { name: "Svensson", typ: "svensson", werte: { a: 1.4, b: 1.56, c: 1.4, d: -6.56 }, text: "Platzhalter." },
  { name: "Hopalong I", typ: "hopalong", werte: { a: 0.4, b: 1.0, c: 0.0 }, text: "Platzhalter." },
  { name: "Hopalong II", typ: "hopalong", werte: { a: 0.5, b: -0.3, c: 0.7 }, text: "Platzhalter." },
  { name: "Gumowski-Mira I", typ: "gumowskiMira", werte: { a: 0.008, b: -0.9 }, text: "Platzhalter." },
  { name: "Gumowski-Mira II", typ: "gumowskiMira", werte: { a: 0.0, b: -0.31 }, start: [0.0, 0.5], text: "Platzhalter." },
  { name: "Tinkerbell", typ: "tinkerbell", werte: { a: 0.9, b: -0.6013, c: 2.0, d: 0.5 }, text: "Platzhalter." },
  { name: "Ikeda", typ: "ikeda", werte: { c: 0.00, u: 0.97 }, text: "Platzhalter." },
];


// Rechnen

// Hilfsfunktion
// Check ob der Punkt außerhalb des Limits oder im Unendlichen ist
function punktNichtMehrDa(punkt) {
  return (
    !Number.isFinite(punkt.x + punkt.y) ||
    Math.abs(punkt.x) > LIMIT_ABSTAND_PUNKTE ||
    Math.abs(punkt.y) > LIMIT_ABSTAND_PUNKTE
  );
}

// Alle Punkte einmal berechnen.
// Ergebnis: Float32Array mit x0, y0, x1, y1, … oder null, wenn der Punkt davonläuft
// start ist optional, ohne nimmt er den Start vom Typ
export function berechnePunkte(typ, werte, anzahl, start = typ.start) {
  const pos = { x: start[0], y: start[1] }; // eigene Position, nicht global

  for (let i = 0; i < EINPENDELN; i++) {
    typ.schritt(werte, pos);
  }

  // anzahl * 2 weil jeder Punkt eine x und y Koordinate hat
  const daten = new Float32Array(anzahl * 2);

  for (let i = 0; i < anzahl; i++) {
    typ.schritt(werte, pos);
    if (punktNichtMehrDa(pos)) return null;
    daten[i * 2] = pos.x;
    daten[i * 2 + 1] = pos.y;
  }

  return daten;
}

// Den fertigen Attraktor vermessen: wo ist seine Mitte und wie groß ist er
// gemalt wird hier nichts, mit dem Ergebnis kann main.js den Zoom so wählen,
// dass der Attraktor mittig und ganz im Bild ist
export function vermesseAttraktor(punkte) {
  let minX = Infinity; // der erste Punkt ist sicher kleiner
  let minY = Infinity;
  let maxX = -Infinity; // und sicher größer
  let maxY = -Infinity;

  // jetzt hat jeder punkt eine x und y Koordinate nacheinander geschrieben
  // im Array, also muss += 2
  for (let i = 0; i < punkte.length; i += 2) {
    if (punkte[i] < minX) minX = punkte[i];
    if (punkte[i] > maxX) maxX = punkte[i];
    if (punkte[i + 1] < minY) minY = punkte[i + 1];
    if (punkte[i + 1] > maxY) maxY = punkte[i + 1];
  }

  return {
    mitteX: (minX + maxX) / 2,
    mitteY: (minY + maxY) / 2,
    breite: Math.max(maxX - minX, 1e-9), // nie 0, sonst teilt passenderZoom durch 0
    hoehe: Math.max(maxY - minY, 1e-9),
  };
}
