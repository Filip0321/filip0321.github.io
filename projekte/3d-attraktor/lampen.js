// Weitere Lampen: bis zu drei, zusätzlich zum Licht oben („Licht“: Sonne, Lampe oder Scheinwerfer).
// Jede hat ihre eigenen Einstellungen: wo sie steht (wie das Licht oben: rundherum, Höhe, Abstand von der
// Mitte), Farbe, Helligkeit, Lampe oder Scheinwerfer (der zeigt immer auf den Attraktor), eigener Schatten.
//
// Wie mehrere Schatten gehen (shader.js): Der Schatten des Lichts oben wird gezählt wie die Punkte, in
// einer Textur mit Kommazahlen, Kanal Rot. Diese Textur hat vier Kanäle; jede weitere Lampe bekommt einen
// eigenen (Grün, Blau, Alpha). Für jede Lampe werden die Punkte noch einmal auf Boden und Wände gelegt,
// von ihr aus gesehen, und mit gl.colorMask darf dieser Durchgang nur in ihren Kanal schreiben.
// So hat jede Lampe ihren eigenen Schatten, und der dunkelt nur ihr eigenes Licht ab.
//
// Die Bedienung baut dieses Modul selbst (die Regler in regler.js sind fest im HTML, hier kommen Lampen
// dazu und gehen weg). Gemerkt werden die Lampen im Browser (localStorage).

const MAX = 3;
const SPEICHER = "attraktor-lampen";

const NEU = { von: 220, hoehe: 35, abstand: 2.5, farbe: "#ff7a3d", staerke: 1, art: "lampe", kegel: 40, schatten: true, zeigen: true };

let lampen = lade();
let beiAenderung = () => {};

function lade() {
  try {
    const l = JSON.parse(localStorage.getItem(SPEICHER));
    return Array.isArray(l) ? l.slice(0, MAX).map((x) => ({ ...NEU, ...x })) : [];
  } catch {
    return [];
  }
}
function merke() {
  try {
    localStorage.setItem(SPEICHER, JSON.stringify(lampen));
  } catch {
    // privates Fenster: dann eben nicht gemerkt
  }
}

// Lage einer Lampe in der Welt: dieselben Kugelkoordinaten wie das Licht oben (main.js lampenRuhe)
// Scheinwerfer: zeigt auf die Mitte; Kegel als Kosinus des halben Winkels (innen voll hell, außen dunkel)
export function weitereLampen() {
  return lampen.map((l) => {
    const r = (l.von * Math.PI) / 180;
    const h = (l.hoehe * Math.PI) / 180;
    const pos = [Math.cos(h) * Math.cos(r) * l.abstand, Math.sin(h) * l.abstand, Math.cos(h) * Math.sin(r) * l.abstand];
    const len = Math.hypot(...pos) || 1;
    const halb = ((l.kegel / 2) * Math.PI) / 180;
    const farbe = [1, 3, 5].map((i) => parseInt(l.farbe.slice(i, i + 2), 16) / 255);
    return {
      pos,
      richtung: pos.map((k) => -k / len),
      farbe,
      staerke: l.staerke,
      kegelAussen: l.art === "scheinwerfer" ? Math.cos(halb) : -2,
      kegelInnen: l.art === "scheinwerfer" ? Math.cos(halb * 0.7) : -1.5,
      schatten: l.schatten,
      zeigen: l.zeigen,
    };
  });
}

// ein Regler: Beschriftung, Schieber, Anzeige des Werts
function regler(text, wert, min, max, schritt, setze) {
  const label = document.createElement("label");
  const feld = document.createElement("input");
  Object.assign(feld, { type: "range", min, max, step: schritt, value: wert });
  const anzeige = document.createElement("output");
  anzeige.textContent = wert;
  feld.addEventListener("input", () => {
    anzeige.textContent = feld.value;
    setze(Number(feld.value));
  });
  label.append(`${text} `, feld, anzeige);
  return label;
}

function zeigeListe(ziel) {
  ziel.replaceChildren();
  lampen.forEach((l, i) => {
    const kasten = document.createElement("div");
    kasten.className = "steuerung lampe-kasten";
    const titel = document.createElement("strong");
    titel.textContent = `Lampe ${i + 2}`; // Lampe 1 ist das Licht oben
    const geaendert = () => {
      merke();
      beiAenderung();
    };
    const setze = (name) => (w) => {
      l[name] = w;
      geaendert();
    };
    const farbe = document.createElement("input");
    Object.assign(farbe, { type: "color", value: l.farbe });
    farbe.addEventListener("input", () => setze("farbe")(farbe.value));
    const farbLabel = document.createElement("label");
    farbLabel.append("Farbe ", farbe);
    const art = document.createElement("select");
    for (const [w, t] of [["lampe", "Lampe"], ["scheinwerfer", "Scheinwerfer (auf den Attraktor)"]]) art.add(new Option(t, w, false, l.art === w));
    const kegel = regler("Kegel", l.kegel, 5, 150, 1, setze("kegel"));
    kegel.hidden = l.art !== "scheinwerfer";
    art.addEventListener("change", () => {
      kegel.hidden = art.value !== "scheinwerfer";
      setze("art")(art.value);
    });
    const artLabel = document.createElement("label");
    artLabel.append(art);
    const haken = (text, name) => {
      const label = document.createElement("label");
      const k = document.createElement("input");
      k.type = "checkbox";
      k.checked = l[name];
      k.addEventListener("change", () => setze(name)(k.checked));
      label.append(k, ` ${text}`);
      return label;
    };
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "entfernen";
    weg.addEventListener("click", () => {
      lampen.splice(i, 1);
      zeigeListe(ziel);
      geaendert();
    });
    kasten.append(
      titel,
      regler("Licht von", l.von, 0, 360, 1, setze("von")),
      regler("Höhe", l.hoehe, -30, 90, 1, setze("hoehe")),
      regler("von der Mitte", l.abstand, 0.3, 10, 0.1, setze("abstand")),
      farbLabel,
      regler("Helligkeit", l.staerke, 0, 4, 0.05, setze("staerke")),
      artLabel,
      kegel,
      haken("eigener Schatten", "schatten"),
      haken("zeigen", "zeigen"),
      weg,
    );
    ziel.append(kasten);
    window.mitHexFeld?.(farbe); // Textfeld für den Hex-Code davor (script.js)
  });
}

// ziel: wohin die Kästen kommen; knopf: „Lampe hinzufügen“; aenderung: neu zeichnen
export function richteLampenEin(ziel, knopf, aenderung) {
  beiAenderung = aenderung;
  const pruefe = () => (knopf.disabled = lampen.length >= MAX);
  knopf.addEventListener("click", () => {
    if (lampen.length >= MAX) return;
    // jede neue Lampe von einer anderen Seite, damit sie nicht aufeinander liegen
    lampen.push({ ...NEU, von: (NEU.von + lampen.length * 110) % 360 });
    merke();
    zeigeListe(ziel);
    pruefe();
    aenderung();
  });
  const alt = beiAenderung;
  beiAenderung = () => {
    pruefe();
    alt();
  };
  zeigeListe(ziel);
  pruefe();
}
