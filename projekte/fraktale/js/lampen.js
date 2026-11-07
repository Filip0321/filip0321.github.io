// Eigene Lampen in den 3D-Welten: man fliegt hin und stellt eine Lampe ab („Lampe hier abstellen“ oder L).
// Sie bleibt dort stehen, leuchtet in alle Richtungen (wie eine Glühbirne), wirft Schatten und leuchtet im
// Nebel. Bis zu vier, jede mit Farbe, Helligkeit und Schatten an oder aus.
//
// Gemerkt wird pro Welt (die Orte gehören zu ihr) und im Browser (localStorage).
// Wo sie steht, lässt sich auch mit Reglern stellen, wie bei den 3D-Attraktoren: „Licht von“ (Grad rundherum),
// „Höhe“ (Grad über der waagerechten Ebene) und „Abstand von der Mitte“. Das sind Kugelkoordinaten um den
// Ursprung, in dem die Fraktale liegen:
//   x = cos(Höhe) · cos(von) · Abstand,  y = sin(Höhe) · Abstand,  z = cos(Höhe) · sin(von) · Abstand
// und zurück: Abstand = Länge, Höhe = asin(y / Abstand), von = atan2(z, x).
// shader.js bekommt sie als Listen: lampenOrt[4], lampenFarbe[4], lampenStaerke[4], lampenSchatten[4].

const MAX = 4;
const SPEICHER = "fraktale-lampen";
const FARBEN = ["#ffb35c", "#5cb8ff", "#ff5c8a", "#a8ff5c"];

let alle = lade(); // { welt: [{ ort, farbe, staerke, schatten }] }
let welt = "";
let ziel = null;
let beiAenderung = () => {};
let reichweite = () => 4; // wie weit der Regler „Abstand“ geht (main.js: je nach Welt)

const grad = (r) => (r * 180) / Math.PI;
const bogen = (g) => (g * Math.PI) / 180;
function kugel([x, y, z]) {
  const a = Math.hypot(x, y, z) || 1e-6;
  return { von: (grad(Math.atan2(z, x)) + 360) % 360, hoehe: grad(Math.asin(Math.max(-1, Math.min(1, y / a)))), abstand: a };
}
function ausKugel({ von, hoehe, abstand }) {
  return [Math.cos(bogen(hoehe)) * Math.cos(bogen(von)) * abstand, Math.sin(bogen(hoehe)) * abstand, Math.cos(bogen(hoehe)) * Math.sin(bogen(von)) * abstand];
}

function lade() {
  try {
    return JSON.parse(localStorage.getItem(SPEICHER)) ?? {};
  } catch {
    return {};
  }
}
function merke() {
  try {
    localStorage.setItem(SPEICHER, JSON.stringify(alle));
  } catch {
    // privates Fenster: nicht gemerkt
  }
}
const liste = () => (alle[welt] ??= []);

// für den Shader: Farbe als 0 bis 1
export function lampenFuerShader() {
  return liste().map((l) => ({
    ort: l.ort,
    farbe: [1, 3, 5].map((i) => parseInt(l.farbe.slice(i, i + 2), 16) / 255),
    staerke: l.staerke,
    schatten: l.schatten,
  }));
}

// ort: wo die Lampe hinkommt (main.js: etwas vor der Kamera)
export function stelleLampeAb(ort) {
  if (liste().length >= MAX) return false;
  liste().push({ ort: [...ort], farbe: FARBEN[liste().length % FARBEN.length], staerke: 1, schatten: true });
  merke();
  zeige();
  beiAenderung();
  return true;
}

export function wechsleWelt(neu) {
  welt = neu;
  zeige();
}

function regler(text, wert, min, max, schritt, setze) {
  const label = document.createElement("label");
  const feld = document.createElement("input");
  Object.assign(feld, { type: "range", min, max, step: schritt, value: wert });
  const anzeige = document.createElement("output");
  const zeigeWert = () => (anzeige.textContent = Number(feld.value).toFixed(schritt < 1 ? 2 : 0).replace(".", ","));
  zeigeWert();
  feld.addEventListener("input", () => {
    zeigeWert();
    setze(Number(feld.value));
  });
  label.append(`${text} `, feld, anzeige);
  return label;
}

function zeige() {
  if (!ziel) return;
  ziel.replaceChildren();
  liste().forEach((l, i) => {
    const kasten = document.createElement("div");
    kasten.className = "steuerung";
    const titel = document.createElement("strong");
    titel.textContent = `Lampe ${i + 1}`;
    const geaendert = () => {
      merke();
      beiAenderung();
    };
    const farbe = document.createElement("input");
    Object.assign(farbe, { type: "color", value: l.farbe });
    farbe.addEventListener("input", () => {
      l.farbe = farbe.value;
      geaendert();
    });
    const farbLabel = document.createElement("label");
    farbLabel.append("Farbe ", farbe);
    // Lage als Kugelkoordinaten (siehe oben); jeder Regler ändert eine davon, die anderen bleiben
    const k = kugel(l.ort);
    const lage = (name) => (w) => {
      k[name] = w;
      l.ort = ausKugel(k);
      geaendert();
    };
    const max = Math.max(reichweite(), k.abstand);
    const schatten = document.createElement("input");
    schatten.type = "checkbox";
    schatten.checked = l.schatten;
    schatten.addEventListener("change", () => {
      l.schatten = schatten.checked;
      geaendert();
    });
    const schattenLabel = document.createElement("label");
    schattenLabel.append(schatten, " Schatten");
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "entfernen";
    weg.addEventListener("click", () => {
      liste().splice(i, 1);
      merke();
      zeige();
      beiAenderung();
    });
    kasten.append(
      titel,
      farbLabel,
      regler("Helligkeit", l.staerke, 0, 6, 0.05, (w) => {
        l.staerke = w;
        geaendert();
      }),
      regler("Licht von", k.von, 0, 360, 1, lage("von")),
      regler("Höhe", k.hoehe, -90, 90, 1, lage("hoehe")),
      regler("Abstand von der Mitte", k.abstand, 0, max, max / 400, lage("abstand")),
      schattenLabel,
      weg,
    );
    ziel.append(kasten);
    window.mitHexFeld?.(farbe); // Textfeld für den Hex-Code davor (script.js)
  });
  if (!liste().length) ziel.textContent = "Noch keine eigenen Lampen in dieser Welt.";
}

// weite: () => wie weit „Abstand von der Mitte“ höchstens geht
export function richteLampenEin(platz, aenderung, weite = reichweite) {
  ziel = platz;
  beiAenderung = aenderung;
  reichweite = weite;
  zeige();
}
