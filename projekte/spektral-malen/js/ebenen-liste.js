// Ebenen in der Bedienung: die Liste (welche ist aktiv, stumm, löschen) und darunter die
// Einstellungen der aktiven Ebene. Wird bei jeder Änderung an den Ebenen ganz neu gebaut
// (es sind nur ein paar Zeilen, das ist einfacher, als einzelne Felder nachzuführen).
//
// Die Felder entstehen aus einer Beschreibung (FELDER) statt aus eigenem Code pro Feld, wie bei
// data-wert in /lib/regler.js: ein neues Feld ist eine Zeile.

const ART = { mal: "Malschicht", bild: "Bild", ton: "Ton" };

// Einstellungen pro Art: name (Eigenschaft der Ebene), text, typ, und wie Ebene <-> Feld umgerechnet wird
// (zeit: Spalten <-> Sekunden; alles andere wird so übernommen)
const FELDER = {
  alle: [{ name: "gain", text: "Lautstärke (dB)", typ: "range", min: -40, max: 12, step: 1 }],
  bild: [
    { name: "invertieren", text: "invertieren", typ: "checkbox" },
    { name: "schwelle", text: "Schwelle", typ: "range", min: 0, max: 1, step: 0.01 },
    { name: "anfang", text: "Anfang (s)", typ: "number", min: 0, step: 0.1, zeit: true },
    { name: "ende", text: "Ende (s)", typ: "number", min: 0, step: 0.1, zeit: true },
    { name: "unten", text: "tiefste (Hz)", typ: "number", min: 1, max: 24000, step: 1 },
    { name: "oben", text: "höchste (Hz)", typ: "number", min: 2, max: 24000, step: 1 },
  ],
  ton: [
    { name: "start", text: "Anfang (s)", typ: "number", step: 0.1, zeit: true },
    { name: "filter", text: "Filter (Kreuzsynthese)", typ: "select" },
  ],
};

const HINWEIS = {
  mal: "Pinsel und Radierer malen hier. Die Malschicht klingt mit, außer eine Ton-Ebene nimmt sie als Filter.",
  bild: "Mit dem Werkzeug „Verschieben“ ziehst du das Bild an eine andere Stelle, hoch oder tief. Auf Bilder malt man nicht.",
  ton: "Pinsel und Radierer malen auf die Maske dieser Aufnahme: radieren nimmt Teile weg, malen holt sie zurück. "
    + "Mit einem Filter klingt die Aufnahme nur dort, wo die Filter-Ebene hell ist, und die Filter-Ebene selbst schweigt.",
};

export function richteEbenenListeEin({ liste, eigenschaften, beiWahl, beiAenderung, beiLoeschen }) {
  function knopf(text, titel, aktion) {
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = text;
    if (titel) k.title = titel;
    k.addEventListener("click", aktion);
    return k;
  }

  function zeigeListe(ebenen, aktiv) {
    liste.replaceChildren();
    // oben die neueste, wie in Malprogrammen
    for (const e of [...ebenen].reverse()) {
      const zeile = document.createElement("li");
      const wahl = knopf(e.art === "mal" ? e.name : `${ART[e.art]}: ${e.name}`, "diese Ebene bearbeiten", () => beiWahl(e.id));
      wahl.className = "ebene-name";
      wahl.setAttribute("aria-pressed", String(e.id === aktiv));
      const stumm = document.createElement("label");
      const haken = document.createElement("input");
      haken.type = "checkbox";
      haken.checked = e.stumm;
      haken.disabled = Boolean(e.aufnahme);
      haken.addEventListener("input", () => beiAenderung(e.id, { stumm: haken.checked }));
      stumm.append(haken, " stumm");
      zeile.append(wahl, stumm);
      if (e.art !== "mal" && !e.aufnahme) zeile.append(knopf("×", "Ebene löschen", () => beiLoeschen(e.id)));
      liste.append(zeile);
    }
  }

  function baueFeld(e, beschreibung, ebenen, leinwand) {
    const label = document.createElement("label");
    const { name, typ } = beschreibung;
    const zuFeld = (wert) => (beschreibung.zeit ? Math.round(wert * leinwand.sekundenProSpalte * 100) / 100 : wert);
    const vonFeld = (wert) => (beschreibung.zeit ? wert / leinwand.sekundenProSpalte : wert);
    let feld;

    if (typ === "select") {
      // Filter: keiner, die Malschicht oder ein Bild
      feld = document.createElement("select");
      const moeglich = [{ id: "", text: "kein Filter" }];
      for (const x of ebenen) if (x.art !== "ton") moeglich.push({ id: x.id, text: x.art === "mal" ? x.name : `${ART[x.art]}: ${x.name}` });
      for (const m of moeglich) feld.append(new Option(m.text, m.id, false, (e[name] ?? "") === m.id));
      feld.addEventListener("input", () => beiAenderung(e.id, { [name]: feld.value || null }));
      label.append(beschreibung.text, " ", feld);
      return label;
    }

    feld = document.createElement("input");
    feld.type = typ;
    for (const attr of ["min", "max", "step"]) if (beschreibung[attr] !== undefined) feld[attr] = beschreibung[attr];
    if (typ === "checkbox") {
      feld.checked = e[name];
      feld.addEventListener("input", () => beiAenderung(e.id, { [name]: feld.checked }));
      label.append(feld, ` ${beschreibung.text}`);
      return label;
    }
    feld.value = zuFeld(e[name]);
    const anzeige = typ === "range" ? document.createElement("output") : null;
    if (anzeige) anzeige.textContent = feld.value;
    // Zahlenfelder erst beim Verlassen oder Enter ("change"), sonst springt das Bild bei jeder Ziffer
    feld.addEventListener(typ === "range" ? "input" : "change", () => {
      const wert = Number(feld.value);
      if (!Number.isFinite(wert)) return;
      if (anzeige) anzeige.textContent = feld.value;
      beiAenderung(e.id, { [name]: vonFeld(wert) });
    });
    label.append(beschreibung.text, " ", feld);
    if (anzeige) label.append(anzeige);
    return label;
  }

  function zeigeEigenschaften(ebenen, aktiv, leinwand) {
    eigenschaften.replaceChildren();
    const e = ebenen.find((x) => x.id === aktiv);
    if (!e) return;
    const steuerung = document.createElement("div");
    steuerung.className = "steuerung";
    for (const beschreibung of [...FELDER.alle, ...(FELDER[e.art] ?? [])]) {
      steuerung.append(baueFeld(e, beschreibung, ebenen, leinwand));
    }
    const hinweis = document.createElement("p");
    hinweis.className = "hinweis";
    hinweis.textContent = e.aufnahme ? "Wird gerade aufgenommen." : HINWEIS[e.art];
    eigenschaften.append(steuerung, hinweis);
  }

  return {
    zeige(ebenen, aktiv, leinwand) {
      zeigeListe(ebenen, aktiv);
      zeigeEigenschaften(ebenen, aktiv, leinwand);
    },
  };
}
