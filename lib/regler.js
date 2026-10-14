// Regler und Schalter für alle Seiten
// alles mit data-wert im HTML landet unter seinem Namen in einstellung:
// <input type="range" data-wert="laenge"> → einstellung.laenge
// Startwerte stehen dadurch nur im HTML
//
// (data-regler in effekt-schicht.js ist dasselbe Muster für VHS und CRT)

export function richteReglerEin({
  beiAenderung,  // wird nach jeder Änderung aufgerufen, meistens zeichne
  extra = {},    // { name: funktion }: was bei einem bestimmten Namen zusätzlich passieren soll
}) {
  const einstellung = {};
  const felder = {}; // die Felder selbst, damit der Code sie auch verstellen kann

  // steht direkt hinter dem Feld ein <output>, zeigt es den Wert an
  function zeigeWert(feld) {
    const anzeige = feld.nextElementSibling;
    if (anzeige?.tagName === "OUTPUT") anzeige.textContent = feld.value;
  }

  // Wert aus dem Feld lesen (Häkchen → true/false, alles andere → Zahl)
  function lies(name) {
    const feld = felder[name];
    einstellung[name] = feld.type === "checkbox" ? feld.checked : Number(feld.value);
    zeigeWert(feld);
  }

  // umgekehrt: Wert aus dem Code ins Feld schreiben (z. B. den Kopf beim Wandern)
  function setze(name, wert) {
    einstellung[name] = wert; // nicht zurücklesen, sonst schneidet das Feld an seinem max ab
    const feld = felder[name];
    if (feld.type === "checkbox") feld.checked = wert;
    else feld.value = wert;
    zeigeWert(feld);
  }

  // ein einziger Listener-Bauplan für alle Felder
  document.querySelectorAll("[data-wert]").forEach((feld) => {
    const name = feld.dataset.wert; // data-wert="laenge" → "laenge"
    felder[name] = feld;
    lies(name);

    // "input" statt "change": feuert schon beim Ziehen, nicht erst beim Loslassen
    // (bei Häkchen kommt "input" genauso beim Anklicken)
    feld.addEventListener("input", () => {
      lies(name);
      extra[name]?.(); // gibt es eine Extra-Aufgabe für diesen Namen? dann ausführen
      beiAenderung();
    });
  });

  return { einstellung, felder, setze };
}
