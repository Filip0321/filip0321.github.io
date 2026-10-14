// Rechnet den 3D-Attraktor aus, das Zeichnen mach ich im Shader

const LIMIT_ABSTAND_PUNKTE = 1000000;
const EINPENDEL_ZEIT = 5; // Zeiteinheiten, nicht Schritte
// weil dt ein Bruchteil einer Zeiteinheit ist, und jeder Typ ein anderes dt hat
// (Lorenz dt = 0.005: 200 Schritte pro Zeiteinheit, Thomas dt = 0.05: nur 20)
// um sicherzugehen dass der Punkt schon auf der Laufbahn ist wenn man malt


// Attraktor-Typen
// 3D-Attraktoren werden mit Differentialgleichungen berechnet:
// die Formel gibt nicht direkt den neuen Punkt, sondern nur die Geschwindigkeit,
// mal dt ergibt das kleine Stück, das der Punkt pro Schritt weiterwandert (Euler-Verfahren)
// hab ich von http://www.3d-meier.de/tut19/Seite1.html

export const TYPEN = {
  lorenz: {
    name: "Lorenz",
    formel: "x' = a·(y - x)\ny' = x·(b - z) - y\nz' = x·y - c·z",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.005,
    start: [0.1, 0, 0],
    schritt(w, p, dt) {
      const dx = w.a * (p.y - p.x);
      const dy = p.x * (w.b - p.z) - p.y;
      const dz = p.x * p.y - w.c * p.z;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  aizawa: {
    name: "Aizawa",
    formel: "x' = (z - b)·x - d·y\ny' = d·x + (z - b)·y\nz' = c + a·z - z³/3 - (x² + y²)·(1 + e·z) + f·z·x³",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"], ["e", "e"], ["f", "f"]],
    dt: 0.01,
    start: [0.1, 0, 0],
    schritt(w, p, dt) {
      const dx = (p.z - w.b) * p.x - w.d * p.y;
      const dy = w.d * p.x + (p.z - w.b) * p.y;
      const dz = w.c + w.a * p.z - (p.z * p.z * p.z) / 3
        - (p.x * p.x + p.y * p.y) * (1 + w.e * p.z)
        + w.f * p.z * p.x * p.x * p.x;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  thomas: {
    name: "Thomas",
    formel: "x' = sin(y) - b·x\ny' = sin(z) - b·y\nz' = sin(x) - b·z",
    parameter: [["b", "b"]],
    dt: 0.05,
    start: [1.1, 1.1, -0.01],
    schritt(w, p, dt) {
      const dx = Math.sin(p.y) - w.b * p.x;
      const dy = Math.sin(p.z) - w.b * p.y;
      const dz = Math.sin(p.x) - w.b * p.z;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  halvorsen: {
    name: "Halvorsen",
    formel: "x' = -a·x - 4y - 4z - y²\ny' = -a·y - 4z - 4x - z²\nz' = -a·z - 4x - 4y - x²",
    parameter: [["a", "a"]],
    dt: 0.005,
    start: [-1.48, -1.51, 2.04],
    schritt(w, p, dt) {
      const dx = -w.a * p.x - 4 * p.y - 4 * p.z - p.y * p.y;
      const dy = -w.a * p.y - 4 * p.z - 4 * p.x - p.z * p.z;
      const dz = -w.a * p.z - 4 * p.x - 4 * p.y - p.x * p.x;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  arneodo: {
    name: "Arneodo",
    formel: "x' = y\ny' = z\nz' = -a·x - b·y - z + c·x³",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.01,
    start: [0.2, 0.2, -0.75],
    schritt(w, p, dt) {
      const dx = p.y;
      const dy = p.z;
      const dz = -w.a * p.x - w.b * p.y - p.z + w.c * p.x * p.x * p.x;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  burkeShaw: {
    name: "Burke-Shaw",
    formel: "x' = -s·(x + y)\ny' = -y - s·x·z\nz' = s·x·y + v",
    parameter: [["s", "s"], ["v", "v"]],
    dt: 0.005,
    start: [0.6, 0, 0],
    schritt(w, p, dt) {
      const dx = -w.s * (p.x + p.y);
      const dy = -p.y - w.s * p.x * p.z;
      const dz = w.s * p.x * p.y + w.v;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  chenLee: {
    name: "Chen-Lee",
    formel: "x' = a·x - y·z\ny' = b·y + x·z\nz' = c·z + x·y / 3",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.003,
    start: [1, 0, 4.5],
    schritt(w, p, dt) {
      const dx = w.a * p.x - p.y * p.z;
      const dy = w.b * p.y + p.x * p.z;
      const dz = w.c * p.z + (p.x * p.y) / 3;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  dadras: {
    name: "Dadras",
    formel: "x' = y - a·x + b·y·z\ny' = c·y - x·z + z\nz' = d·x·y - e·z",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"], ["e", "e"]],
    dt: 0.005,
    start: [1, 1, 1],
    schritt(w, p, dt) {
      const dx = p.y - w.a * p.x + w.b * p.y * p.z;
      const dy = w.c * p.y - p.x * p.z + p.z;
      const dz = w.d * p.x * p.y - w.e * p.z;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  fourWing: {
    name: "Four-Wing",
    formel: "x' = a·x + y·z\ny' = b·x + c·y - x·z\nz' = -z - x·y",
    parameter: [["a", "a"], ["b", "b"], ["c", "c"]],
    dt: 0.05,
    start: [1.3, -0.18, 0.01],
    schritt(w, p, dt) {
      const dx = w.a * p.x + p.y * p.z;
      const dy = w.b * p.x + w.c * p.y - p.x * p.z;
      const dz = -p.z - p.x * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  newtonLeipnik: {
    name: "Newton-Leipnik",
    formel: "x' = -a·x + y + 10·y·z\ny' = -x - 0.4·y + 5·x·z\nz' = b·z - 5·x·y",
    parameter: [["a", "a"], ["b", "b"]],
    dt: 0.01,
    start: [0.349, 0, -0.16],
    schritt(w, p, dt) {
      const dx = -w.a * p.x + p.y + 10 * p.y * p.z;
      const dy = -p.x - 0.4 * p.y + 5 * p.x * p.z;
      const dz = w.b * p.z - 5 * p.x * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  noseHoover: {
    name: "Nose-Hoover",
    formel: "x' = y\ny' = -x + y·z\nz' = a - y²",
    parameter: [["a", "a"]],
    dt: 0.01,
    start: [1, 0, 0],
    schritt(w, p, dt) {
      const dx = p.y;
      const dy = -p.x + p.y * p.z;
      const dz = w.a - p.y * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  },
  rucklidge: {
    name: "Rucklidge",
    formel: "x' = -k·x + a·y - y·z\ny' = x\nz' = -z + y²",
    parameter: [["k", "k"], ["a", "a"]],
    dt: 0.01,
    start: [1, 0, 4.5],
    schritt(w, p, dt) {
      const dx = -w.k * p.x + w.a * p.y - p.y * p.z;
      const dy = p.x;
      const dz = -p.z + p.y * p.y;
      p.x += dx * dt;
      p.y += dy * dt;
      p.z += dz * dt;
    }
  }
};


// Presets mit ihren Startwerten 

export const PRESETS = [
  { name: "Lorenz", typ: "lorenz", werte: { a: 10, b: 28, c: 2.6667 }, text: "Platzhalter." },
  { name: "Aizawa", typ: "aizawa", werte: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 }, text: "Platzhalter." },
  { name: "Thomas I", typ: "thomas", werte: { b: 0.208186 }, text: "Platzhalter." },
  { name: "Thomas II", typ: "thomas", werte: { b: 0.192 }, text: "Platzhalter." },
  { name: "Thomas III", typ: "thomas", werte: { b: 0.092 }, text: "Platzhalter." },
  { name: "Halvorsen", typ: "halvorsen", werte: { a: 1.4 }, text: "Platzhalter." },
  { name: "Arneodo", typ: "arneodo", werte: { a: -5, b: 3.5, c: -1 }, text: "Platzhalter." },
  { name: "Burke-Shaw", typ: "burkeShaw", werte: { s: 10, v: 4.272 }, text: "Platzhalter." },
  { name: "Chen-Lee", typ: "chenLee", werte: { a: 5, b: -10, c: -0.38 }, text: "Platzhalter." },
  { name: "Dadras", typ: "dadras", werte: { a: 3, b: 2.7, c: 1.7, d: 2, e: 9 }, text: "Platzhalter." },
  { name: "Four-Wing", typ: "fourWing", werte: { a: 0.2, b: 0.01, c: -0.4 }, text: "Platzhalter." },
  { name: "Newton-Leipnik", typ: "newtonLeipnik", werte: { a: 0.4, b: 0.175 }, text: "Platzhalter." },
  { name: "Nose-Hoover", typ: "noseHoover", werte: { a: 1.5 }, text: "Platzhalter." },
  { name: "Rucklidge", typ: "rucklidge", werte: { k: 2, a: 6.7 }, text: "Platzhalter." }
];


// Rechnen

// schauen ob der Punkt schon zu weit weg ist oder nicht mehr endlich
function punktNichtMehrDa(punkt) {
  return (
    !Number.isFinite(punkt.x + punkt.y + punkt.z) ||
    Math.abs(punkt.x) > LIMIT_ABSTAND_PUNKTE ||
    Math.abs(punkt.y) > LIMIT_ABSTAND_PUNKTE ||
    Math.abs(punkt.z) > LIMIT_ABSTAND_PUNKTE
  );
}

export function berechnePunkte(typ, werte, anzahl, start = typ.start) {
  const pos = { x: start[0], y: start[1], z: start[2] };
  const einpendeln = Math.ceil(EINPENDEL_ZEIT / typ.dt);

  for (let i = 0; i < einpendeln; i++) {
    typ.schritt(werte, pos, typ.dt);
    if (punktNichtMehrDa(pos)) return null; // schon beim Einpendeln davongelaufen
  }

  // anzahl * 3 weil jeder Punkt 3 Koordinaten hat (x, y, z)
  const daten = new Float32Array(anzahl * 3);

  for (let i = 0; i < anzahl; i++) {
    typ.schritt(werte, pos, typ.dt);
    if (punktNichtMehrDa(pos)) {
      // unterwegs davongelaufen: die Punkte bis hier behalten
      // subarray ist nur ein Blick auf den Anfang, es wird nichts kopiert
      return i > 0 ? daten.subarray(0, i * 3) : null;
    }
    // y und z getauscht: bei den meisten Attraktoren ist z die "Höhe" der Formel,
    // auf dem Bildschirm zeigt aber y nach oben (so steht der Lorenz aufrecht)
    daten[i * 3] = pos.x;
    daten[i * 3 + 1] = pos.z;
    daten[i * 3 + 2] = pos.y;
  }
  return daten;
}


// Den fertigen Attraktor vermessen: wo ist seine Mitte und wie groß ist er
// mit dem Ergebnis rückt der Shader den Attraktor in die Mitte 
// und bringt ihn auf Größe −1 bis 1, damit er sich um sich selbst dreht.
export function vermesseAttraktor(punkte) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  // jetzt hat jeder punkt eine x, y und z Koordinate nacheinander geschrieben
  // im Array, also muss += 3
  for (let i = 0; i < punkte.length; i += 3) {
    if (punkte[i] < minX) minX = punkte[i];
    if (punkte[i] > maxX) maxX = punkte[i];
    if (punkte[i + 1] < minY) minY = punkte[i + 1];
    if (punkte[i + 1] > maxY) maxY = punkte[i + 1];    
    if (punkte[i + 2] < minZ) minZ = punkte[i + 2];
    if (punkte[i + 2] > maxZ) maxZ = punkte[i + 2];
  }

  return {
    mitteX: (minX + maxX) / 2,
    mitteY: (minY + maxY) / 2,
    mitteZ: (minZ + maxZ) / 2,
    mass: Math.max(
      maxX - minX, 
      maxY - minY,
      maxZ - minZ, 1e-9),
    // nie 0, sonst teilt der Shader (punkt - mitte) / mass durch 0
    // würde ich hier wieder breite, hoehe und tiefe nehmen, dann hätte ich kein uniformen 
    // Attraktor beim Drehen
  };
}

