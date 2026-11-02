// Lesestriche: Liste (welcher ist aktiv, löschen) und die Einstellungen des aktiven Strichs.
// Wie die Ebenen in Spektral-Malen: die Felder entstehen aus einer Beschreibung (FELDER), ein neues
// Feld ist eine Zeile. Wird bei jeder Änderung an der Liste neu gebaut.
//
// Mehrere Striche:
//   Stereo   zwei Striche, links im Bild nach links, rechts nach rechts (Panorama): Bewegung wandert
//            im Kopfhörer mit
//   Akkord   mehrere Striche, jeder um ein paar Halbtöne verschoben: dasselbe Bild klingt als Akkord

export const MAX_STRICHE = 4; // jeder Strich hat bis zu 256 Stimmen, mehr schafft ein Handy nicht

let naechsteId = 1;
export function neuerStrich(werte = {}) {
  return {
    id: naechsteId++,
    mitte: 0.5, // quer zum Strich, Anteil des Bildes (bzw. der Lupe)
    breite: 1, // Prozent des Bildes quer
    senkrecht: true,
    rueckwaerts: false, // tief oben (bzw. rechts) statt unten (links)
    pan: 0, // −1 links, 1 rechts
    halbtoene: 0,
    welle: false, // Lichtton wörtlich: der Strich ist eine Schwingung
    grundton: 110, // Hz, nur für welle
    ...werte,
  };
}

// Vorlagen für die Knöpfe
export const VORLAGEN = {
  einer: () => [neuerStrich()],
  stereo: () => [neuerStrich({ mitte: 0.25, pan: -1 }), neuerStrich({ mitte: 0.75, pan: 1 })],
  akkord: () => [neuerStrich({ mitte: 0.5 }), neuerStrich({ mitte: 0.5, halbtoene: 4 }), neuerStrich({ mitte: 0.5, halbtoene: 7 })],
};

const FELDER = [
  { name: "senkrecht", text: "Richtung", typ: "select", optionen: [[true, "senkrecht"], [false, "waagerecht"]] },
  { name: "breite", text: "Breite (%)", typ: "range", min: 0.1, max: 20, step: 0.1 },
  { name: "rueckwaerts", text: "rückwärts (tief oben bzw. rechts)", typ: "checkbox" },
  { name: "pan", text: "Panorama", typ: "range", min: -1, max: 1, step: 0.05 },
  { name: "welle", text: "Art", typ: "select", optionen: [[false, "Spektrum"], [true, "Lichtton (Wellenform)"]] },
  { name: "halbtoene", text: "Halbtöne", typ: "range", min: -24, max: 24, step: 1, nur: (s) => !s.welle },
  { name: "grundton", text: "Grundton (Hz)", typ: "number", min: 20, max: 2000, step: 1, nur: (s) => s.welle },
];

export function richteStrichListeEin({ liste, eigenschaften, beiWahl, beiAenderung, beiLoeschen }) {
  function knopf(text, titel, aktion) {
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = text;
    k.title = titel;
    k.addEventListener("click", aktion);
    return k;
  }

  function baueFeld(s, b) {
    const label = document.createElement("label");
    let feld;
    if (b.typ === "select") {
      feld = document.createElement("select");
      b.optionen.forEach(([wert, text], i) => feld.append(new Option(text, String(i), false, s[b.name] === wert)));
      feld.addEventListener("input", () => beiAenderung(s.id, { [b.name]: b.optionen[Number(feld.value)][0] }, true));
      label.append(`${b.text} `, feld);
      return label;
    }
    feld = document.createElement("input");
    feld.type = b.typ;
    for (const attr of ["min", "max", "step"]) if (b[attr] !== undefined) feld[attr] = b[attr];
    if (b.typ === "checkbox") {
      feld.checked = s[b.name];
      feld.addEventListener("input", () => beiAenderung(s.id, { [b.name]: feld.checked }));
      label.append(feld, ` ${b.text}`);
      return label;
    }
    feld.value = s[b.name];
    const anzeige = b.typ === "range" ? document.createElement("output") : null;
    if (anzeige) anzeige.textContent = feld.value;
    feld.addEventListener(b.typ === "range" ? "input" : "change", () => {
      const wert = Number(feld.value);
      if (!Number.isFinite(wert)) return;
      if (anzeige) anzeige.textContent = feld.value;
      beiAenderung(s.id, { [b.name]: wert });
    });
    label.append(`${b.text} `, feld);
    if (anzeige) label.append(anzeige);
    return label;
  }

  return {
    zeige(striche, aktiv) {
      liste.replaceChildren();
      striche.forEach((s, i) => {
        const zeile = document.createElement("li");
        const wahl = knopf(`Strich ${i + 1}`, "diesen Strich einstellen und ziehen", () => beiWahl(s.id));
        wahl.className = "strich-name";
        wahl.setAttribute("aria-pressed", String(s.id === aktiv));
        zeile.append(wahl);
        if (striche.length > 1) zeile.append(knopf("×", "Strich löschen", () => beiLoeschen(s.id)));
        liste.append(zeile);
      });

      eigenschaften.replaceChildren();
      const s = striche.find((x) => x.id === aktiv);
      if (!s) return;
      const steuerung = document.createElement("div");
      steuerung.className = "steuerung";
      for (const b of FELDER) if (!b.nur || b.nur(s)) steuerung.append(baueFeld(s, b));
      eigenschaften.append(steuerung);
    },
  };
}
