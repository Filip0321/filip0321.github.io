// Eigene Lampen in den 3D-Welten: man fliegt hin und stellt eine Lampe ab („Lampe hier abstellen“ oder L).
// Sie bleibt dort stehen, leuchtet in alle Richtungen (wie eine Glühbirne), wirft Schatten und leuchtet im
// Nebel. Bis zu vier, jede mit Farbe, Helligkeit und Schatten an oder aus.
//
// Gemerkt wird pro Welt (die Orte gehören zu ihr) und im Browser (localStorage).
// shader.js bekommt sie als Listen: lampenOrt[4], lampenFarbe[4], lampenStaerke[4], lampenSchatten[4].

const MAX = 4;
const SPEICHER = "fraktale-lampen";
const FARBEN = ["#ffb35c", "#5cb8ff", "#ff5c8a", "#a8ff5c"];

let alle = lade(); // { welt: [{ ort, farbe, staerke, schatten }] }
let welt = "";
let ziel = null;
let beiAenderung = () => {};

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

function zeige() {
  if (!ziel) return;
  ziel.replaceChildren();
  liste().forEach((l, i) => {
    const zeile = document.createElement("div");
    zeile.className = "steuerung";
    const titel = document.createElement("strong");
    titel.textContent = `Lampe ${i + 1}`;
    const farbe = document.createElement("input");
    Object.assign(farbe, { type: "color", value: l.farbe });
    farbe.addEventListener("input", () => {
      l.farbe = farbe.value;
      merke();
      beiAenderung();
    });
    const staerke = document.createElement("input");
    Object.assign(staerke, { type: "range", min: 0, max: 6, step: 0.05, value: l.staerke });
    const anzeige = document.createElement("output");
    anzeige.textContent = l.staerke;
    staerke.addEventListener("input", () => {
      l.staerke = Number(staerke.value);
      anzeige.textContent = staerke.value;
      merke();
      beiAenderung();
    });
    const schatten = document.createElement("input");
    schatten.type = "checkbox";
    schatten.checked = l.schatten;
    schatten.addEventListener("change", () => {
      l.schatten = schatten.checked;
      merke();
      beiAenderung();
    });
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "entfernen";
    weg.addEventListener("click", () => {
      liste().splice(i, 1);
      merke();
      zeige();
      beiAenderung();
    });
    const label = (text, ...feld) => {
      const x = document.createElement("label");
      x.append(text, ...feld);
      return x;
    };
    zeile.append(titel, label("Farbe ", farbe), label("Helligkeit ", staerke, anzeige), label(schatten, " Schatten"), weg);
    ziel.append(zeile);
  });
  if (!liste().length) ziel.textContent = "Noch keine eigenen Lampen in dieser Welt.";
}

export function richteLampenEin(platz, aenderung) {
  ziel = platz;
  beiAenderung = aenderung;
  zeige();
}
