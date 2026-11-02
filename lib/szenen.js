// Szenen speichern: alle Einstellungen einer Seite auf einmal, damit eine gute Einstellung nicht verloren geht.
// Eine Szene ist ein Objekt { version, werte, seite }:
//   werte  alle Regler mit data-wert (aus regler.js: einstellung)
//   seite  was die Seite sonst noch weiß (Attraktor-Typ und seine Zahlen, Kamera, Musik-Zuordnung …)
// Drei Wege:
//   im Browser    unter einem Namen, in localStorage (nur auf diesem Gerät, in diesem Browser)
//   als Datei     .json zum Aufheben und Weitergeben
//   als Link      die Szene steckt hinter # in der Adresse; wer den Link öffnet, sieht genau diese Szene
//                 (hinter # wird nichts an den Server geschickt, die Szene bleibt im Browser)

import { ladeHerunter, zeitstempel } from "/lib/export.js";

const VERSION = 1;

// Text → Base64 und zurück. btoa kann nur Zeichen bis 255; Umlaute (ä = 2 Bytes in UTF-8)
// erst in Bytes verwandeln, dann jedes Byte als ein Zeichen
function zuBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binaer = "";
  for (const byte of bytes) binaer += String.fromCharCode(byte);
  // URL-sicher: + und / bedeuten in Adressen etwas anderes, = am Ende braucht es nicht
  return btoa(binaer).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function ausBase64(text) {
  const binaer = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return new TextDecoder().decode(Uint8Array.from(binaer, (zeichen) => zeichen.charCodeAt(0)));
}

function knopf(text) {
  const k = document.createElement("button");
  k.type = "button";
  k.textContent = text;
  return k;
}

export function richteSzenenEin({
  ziel,       // Element, in das die Bedienung kommt
  seitenName, // z. B. "3d-attraktor": Szenen jeder Seite liegen getrennt
  einstellung, // alle Regler (regler.js)
  setzeAlle,  // regler.js: Regler auf einmal setzen
  sammle,     // () => { … }: was die Seite außer den Reglern braucht
  stelleHer,  // (seite) => …: das wieder einstellen (vor den Reglern aufgerufen)
}) {
  const SPEICHER = `szenen:${seitenName}`;
  const meldung = document.createElement("p");
  meldung.className = "hinweis";

  // gespeicherte Szenen: { "Name": szene, … }; ohne Speicher (privates Fenster) einfach leer
  function liesListe() {
    try {
      return JSON.parse(localStorage.getItem(SPEICHER)) ?? {};
    } catch {
      return {};
    }
  }
  function schreibeListe(liste) {
    try {
      localStorage.setItem(SPEICHER, JSON.stringify(liste));
      return true;
    } catch {
      meldung.textContent = "Der Browser lässt hier nichts speichern (privates Fenster?). Als Datei oder Link geht es trotzdem.";
      return false;
    }
  }

  function aktuelleSzene() {
    return { version: VERSION, werte: { ...einstellung }, seite: sammle() };
  }

  function wende(szene) {
    if (!szene || typeof szene !== "object" || !szene.werte) throw new Error("Das ist keine Szene.");
    stelleHer(szene.seite ?? {}); // erst Typ und Kamera, dann die Regler (die zeichnen danach neu)
    setzeAlle(szene.werte);
  }

  // Bedienung: Auswahl der gespeicherten, Name zum Speichern, Datei und Link
  const auswahl = document.createElement("select");
  auswahl.setAttribute("aria-label", "gespeicherte Szenen");
  const nameFeld = document.createElement("input");
  nameFeld.type = "text";
  nameFeld.placeholder = "Name der Szene";
  nameFeld.setAttribute("aria-label", "Name der Szene");
  const speichern = knopf("Speichern");
  const laden = knopf("Laden");
  const loeschen = knopf("Löschen");
  const alsDatei = knopf("Als Datei");
  const dateiLabel = document.createElement("label");
  dateiLabel.className = "datei-knopf";
  const dateiFeld = document.createElement("input");
  dateiFeld.type = "file";
  dateiFeld.accept = ".json,application/json";
  dateiLabel.append("Datei laden ", dateiFeld);
  const alsLink = knopf("Link kopieren");

  const zeile = (...kinder) => {
    const gruppe = document.createElement("span");
    gruppe.className = "steuerung-gruppe";
    gruppe.append(...kinder);
    return gruppe;
  };
  ziel.append(zeile(nameFeld, speichern), zeile(auswahl, laden, loeschen), zeile(alsDatei, dateiLabel, alsLink));
  ziel.after(meldung);

  function fuelleAuswahl() {
    const namen = Object.keys(liesListe()).sort((a, b) => a.localeCompare(b, "de"));
    auswahl.replaceChildren(...namen.map((n) => new Option(n, n)));
    if (namen.length === 0) auswahl.append(new Option("noch keine Szene", ""));
    laden.disabled = loeschen.disabled = namen.length === 0;
  }
  fuelleAuswahl();

  speichern.addEventListener("click", () => {
    const name = nameFeld.value.trim() || `Szene ${zeitstempel()}`;
    const liste = liesListe();
    liste[name] = aktuelleSzene();
    if (schreibeListe(liste)) meldung.textContent = `„${name}“ gespeichert.`;
    fuelleAuswahl();
    auswahl.value = name;
  });

  laden.addEventListener("click", () => {
    const szene = liesListe()[auswahl.value];
    if (!szene) return;
    wende(szene);
    nameFeld.value = auswahl.value;
    meldung.textContent = `„${auswahl.value}“ geladen.`;
  });

  loeschen.addEventListener("click", () => {
    const liste = liesListe();
    delete liste[auswahl.value];
    schreibeListe(liste);
    meldung.textContent = `„${auswahl.value}“ gelöscht.`;
    fuelleAuswahl();
  });

  alsDatei.addEventListener("click", () => {
    const text = JSON.stringify(aktuelleSzene(), null, 2); // eingerückt, damit man sie auch lesen kann
    const name = (nameFeld.value.trim() || "szene").replace(/[^\p{L}\p{N}_-]+/gu, "-");
    ladeHerunter(new Blob([text], { type: "application/json" }), `${seitenName}-${name}-${zeitstempel()}.json`);
  });

  dateiFeld.addEventListener("change", async () => {
    const datei = dateiFeld.files[0];
    if (!datei) return;
    try {
      wende(JSON.parse(await datei.text()));
      meldung.textContent = `${datei.name} geladen.`;
    } catch (fehler) {
      meldung.textContent = `Die Datei passt nicht: ${fehler.message}`;
    }
    dateiFeld.value = ""; // dieselbe Datei noch einmal wählen geht sonst nicht
  });

  alsLink.addEventListener("click", async () => {
    const adresse = `${location.origin}${location.pathname}#szene=${zuBase64(JSON.stringify(aktuelleSzene()))}`;
    try {
      await navigator.clipboard.writeText(adresse);
      meldung.textContent = "Link kopiert. Wer ihn öffnet, sieht genau diese Szene.";
    } catch {
      // ohne Erlaubnis für die Zwischenablage: den Link in die Adresszeile, von dort kopieren
      history.replaceState(null, "", adresse);
      meldung.textContent = "Kopieren ging nicht; der Link steht jetzt oben in der Adresszeile.";
    }
  });

  // eine Szene im Link? Dann gleich anwenden (die Seite ruft das auf, wenn sie fertig aufgebaut ist)
  function ladeAusLink() {
    const treffer = location.hash.match(/^#szene=(.+)$/);
    if (!treffer) return false;
    try {
      wende(JSON.parse(ausBase64(treffer[1])));
      meldung.textContent = "Szene aus dem Link geladen.";
      return true;
    } catch {
      meldung.textContent = "Die Szene im Link ist kaputt.";
      return false;
    }
  }

  return { ladeAusLink };
}
