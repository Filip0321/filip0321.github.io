// aria-...: Beschreibung für Hilfsprogramme (Screenreader, Sprachsteuerung), ändert nichts am Aussehen

const ZIEH_WEG = 180; // Knopf: Pixel für den ganzen Bereich
const FEIN = 10; // mit Shift braucht man den zehnfachen Weg

// Knopf: rund, Ziehen über ZIEH_WEG Pixel
export function macheDrehknopf(regler, beschriftung, alsText) {
  const knopf = baueBedienteil(regler, beschriftung, "knopf", "mit-knopf");
  verbinde(regler, knopf, () => ZIEH_WEG, alsText);
  // als Funktion, weil verbinde() beim Fader eine braucht (Schiene ändert ihre Größe); beim Knopf immer 180
}

// Fader: senkrechte Schiene mit Kappe. Der Ziehweg ist die Schiene selbst,
export function macheFader(regler, beschriftung, alsText) {
  const fader = baueBedienteil(regler, beschriftung, "fader", "mit-fader");
  fader.setAttribute("aria-orientation", "vertical");
  const kappe = document.createElement("span");
  kappe.className = "fader-kappe";
  fader.append(kappe); // append: als letztes Kind hinein
  verbinde(regler, fader, () => fader.clientHeight - kappe.offsetHeight, alsText);
}

// gemeinsamer Teil: Element bauen, hinter den Regler setzen, Regler verstecken
function baueBedienteil(regler, beschriftung, klasse, labelKlasse) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = klasse;
  element.setAttribute("role", "slider"); // Screenreader: "Schieberegler", nicht "Schaltfläche"
  element.setAttribute("aria-label", beschriftung);

  regler.classList.add("regler-versteckt");
  regler.tabIndex = -1; // mit Tab nur noch zum Knopf, nicht vorher zum unsichtbaren Regler
  regler.insertAdjacentElement("afterend", element); // direkt hinter den Regler ins HTML
  regler.closest("label").classList.add(labelKlasse); // closest: das nächste umgebende <label>
  return element;
}

// gemeinsamer Teil: Anzeige, Ziehen, Rad, Tasten, Doppelklick.
// zuWeg ist eine FUNKTION, weil die Schiene des Faders ihre Größe ändern kann
// zuWeg gibt einfach "ZIEH_WEG" zurück oder "fader.clientHeight - kappe.offsetHeight"
function verbinde(regler, element, zuWeg, alsText) {
  // Grenzen einmal lesen. Nicht Number(regler.max) || 100: 
  // bei max="0" (Weißpunkt) ist 0 "falsch" und es käme 100 heraus
  const min = regler.min === "" ? 0 : Number(regler.min); // wenn gesetzt ist wird min und max genutzt
  const max = regler.max === "" ? 100 : Number(regler.max);
  const spanne = max - min;
  const startwert = Number(regler.value); 

  // ein Schritt für Tasten und Mausrad: ein Hundertstel des Bereichs,
  // aber nie feiner als der Regler selbst kann (step im HTML)
  const schritt = Math.max(Number(regler.step) || 0, spanne / 100); // maximum aus step und spanne / 100 (wenn kein step dann 0)

  element.setAttribute("aria-valuemin", String(min)); // nur sprechassistent
  element.setAttribute("aria-valuemax", String(max));

  function aktualisiere() {
    const wert = Number(regler.value);
    const anteil = spanne === 0 ? 0 : (wert - min) / spanne; // spanne === 0 nur als sicherung
    element.style.setProperty("--anteil", anteil);
    element.setAttribute("aria-valuenow", String(wert));
    // lesbarer Text für Screenreader, z. B. "250 Hz" statt "0.36" - wenn mitgegeben
    if (alsText) element.setAttribute("aria-valuetext", alsText(wert));
  }

  function setzeWert(wert) {
    regler.value = String(wert); // der Regler rundet selbst auf step und kappt an min/max
    regler.dispatchEvent(new Event("input", { bubbles: true })); // so tun, als hätte ein Mensch gezogen: 
    // alle input-Listener laufen; bubbles: auch Listener weiter oben (z. B. document) hören es
  }

  regler.addEventListener("input", aktualisiere);
  regler.aktualisiereKnopf = aktualisiere; // für haltePaar in main.js
  aktualisiere();

  // Ziehen: in jedem Schritt nur die Bewegung seit dem letzten Mal dazurechnen.
  // So kann man mitten im Ziehen Shift drücken, ohne dass der Wert springt.
  let letztesY = 0;
  let wertZiehen = 0; // ungerundet, sonst gingen feine Bewegungen unter einem step verloren

  element.addEventListener("pointerdown", (event) => {
    event.preventDefault(); // beim Ziehen keinen Text markieren
    letztesY = event.clientY;
    wertZiehen = Number(regler.value);
    element.setPointerCapture(event.pointerId); // Bewegungen kommen auch außerhalb an
    element.focus(); // preventDefault verhindert auch den Fokus, also selbst fokussieren
  });

  element.addEventListener("pointermove", (event) => {
    if (!element.hasPointerCapture(event.pointerId)) return; // nur während gedrückt
    const weg = letztesY - event.clientY; // nach oben = positiv
    letztesY = event.clientY;
    const teiler = event.shiftKey ? zuWeg() * FEIN : zuWeg();
    wertZiehen = Math.min(max, Math.max(min, wertZiehen + (weg * spanne) / teiler));
    setzeWert(wertZiehen);
  });

  element.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault(); // nicht die Seite scrollen
      // Shift + Rad wird in manchen Browsern zu deltaX, deshalb beides ansehen
      const richtung = -Math.sign(event.deltaY || event.deltaX); // Rad hoch = mehr
      setzeWert(Number(regler.value) + richtung * schritt);
    },
    { passive: false }, // sonst darf preventDefault beim Rad nicht wirken
  );

  element.addEventListener("dblclick", () => setzeWert(startwert));

  element.addEventListener("keydown", (event) => {
    const grob = event.shiftKey ? 10 : 1;
    const wert = Number(regler.value);
    // Nachschlagen statt if-Kette: Taste → neuer Wert
    const TASTEN = {
      ArrowUp: wert + schritt * grob,
      ArrowRight: wert + schritt * grob,
      ArrowDown: wert - schritt * grob,
      ArrowLeft: wert - schritt * grob,
      Home: min,
      End: max,
    };
    if (!(event.key in TASTEN)) return; // andere Tasten (Tab …) normal lassen
    event.preventDefault(); // Pfeiltasten scrollen sonst die Seite
    setzeWert(TASTEN[event.key]);
  });
}

// zwei Regler wie min und max von etwas sollten sich nie kreuzen, genauso sollten sie nicht 0 
// voneinander entfernt sein - lieber einen bestimmten abstand (halt den anderen auch schieben)
export function haltePaar(unten, oben, abstand, gezogen) {
  let min = Number(unten.value);
  let max = Number(oben.value);
  if (max - min < abstand) {
    // wenn der untere gezogen wird und abstand zu klein, wird der obere weitergezogen
    if (gezogen === unten) {
      oben.value = min + abstand; // mitschieben (der Regler kappt selbst an seinem max)
      max = Number(oben.value);
      min = Math.min(min, max - abstand); // weil am max wird das schieben gestoppt lol
      unten.value = min;
    } else { // wenn der obere gezogen wird und der abstand zu klein wird
      unten.value = max - abstand; // unten wird mitgezogen
      min = Number(unten.value);
      max = Math.max(max, min + abstand);
      oben.value = max;
    }
  }
  // value direkt setzen löst kein input-Event aus, also die Knöpfe selbst nachziehen
  // "?.()"" ruft nur auf, wenn es die Funktion wirklich gibt, also nur bei Knöpfen halt
  unten.aktualisiereKnopf?.();
  oben.aktualisiereKnopf?.();
  return [Number(unten.value), Number(oben.value)];
}
