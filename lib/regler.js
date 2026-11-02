// Regler und Schalter für alle Seiten
// alles mit data-wert im HTML landet unter seinem Namen in einstellung:
// <input type="range" data-wert="laenge"> → einstellung.laenge
// Startwerte stehen dadurch nur im HTML
//
// Zahlen (range, number) kommen als Zahl, Häkchen als true/false,
// alles andere (Farbe, Auswahl, Text) als Text: <input type="color"> → "#ff8800", <select> → "glut"
//
// Zwei Helfer, ebenfalls nur im HTML:
//   data-nur="faerbung=einfarbig"             nur sichtbar, wenn einstellung.faerbung "einfarbig" ist
//   data-nur="faerbung=reihenfolge,dichte"    … wenn es einer von beiden ist (Komma = oder)
//   data-nur="faerbung=dichte verlauf=eigen"  … wenn beides stimmt (Leerzeichen = und)
//   data-setze='{"hintergrund": "#ffffff", "punktfarbe": "#111111"}'
//                                             ein Knopf, der mehrere Felder auf einmal setzt (Preset)
//
// (data-regler in effekt-regler.js ist dasselbe Muster für VHS und CRT)

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

  // Wert aus dem Feld lesen (Häkchen → true/false, Regler und Zahlenfelder → Zahl, alles andere → Text)
  function lies(name) {
    const feld = felder[name];
    if (feld.type === "checkbox") einstellung[name] = feld.checked;
    else if (feld.type === "range" || feld.type === "number") einstellung[name] = Number(feld.value);
    else einstellung[name] = feld.value; // Farbe "#ff8800", Auswahl "glut"
    zeigeWert(feld);
  }

  // data-nur: jede Bedingung "name=wert1,wert2" muss stimmen, sonst wird das Element versteckt
  function zeigeNur() {
    document.querySelectorAll("[data-nur]").forEach((element) => {
      element.hidden = !element.dataset.nur.split(" ").every((bedingung) => {
        const [name, werte] = bedingung.split("=");
        return werte.split(",").includes(String(einstellung[name]));
      });
    });
  }

  // umgekehrt: Wert aus dem Code ins Feld schreiben (z. B. den Kopf beim Wandern)
  function setze(name, wert) {
    einstellung[name] = wert; // nicht zurücklesen, sonst schneidet das Feld an seinem max ab
    const feld = felder[name];
    if (feld.type === "checkbox") feld.checked = wert;
    else feld.value = wert;
    zeigeWert(feld);
    // anderen Bescheid sagen (z. B. dem Hex-Feld neben einer Farbe, script.js); "change" statt "input",
    // weil hier oben nur auf "input" gehört wird und sonst alles doppelt liefe
    feld.dispatchEvent(new Event("change"));
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
      zeigeNur();
      beiAenderung();
    });
  });

  // viele Felder auf einmal setzen, dann wie bei einer normalen Änderung (Preset-Knöpfe, Szenen)
  // unbekannte Namen (z. B. aus einer alten Szene) werden übersprungen
  function setzeAlle(werte) {
    for (const [name, wert] of Object.entries(werte)) {
      if (!felder[name]) continue;
      setze(name, wert);
      extra[name]?.();
    }
    zeigeNur();
    beiAenderung();
  }

  // Preset-Knöpfe: alle genannten Felder setzen
  document.querySelectorAll("[data-setze]").forEach((knopf) => {
    knopf.addEventListener("click", () => setzeAlle(JSON.parse(knopf.dataset.setze)));
  });

  zeigeNur(); // am Anfang einmal, passend zu den Startwerten

  return { einstellung, felder, setze, setzeAlle };
}
