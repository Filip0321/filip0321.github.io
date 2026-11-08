// Die Kette: welche Effekte in welcher Reihenfolge laufen, als Liste zum Umsortieren.
//   ↑ ↓   verschiebt (das Ergebnis eines Effekts ist das Bild des nächsten: Reihenfolge ändert das Bild)
//   ⧉     macht eine Kopie mit eigenen Werten und eigenem Gedächtnis (instanzen.js)
//   ×     schaltet aus (wie das Häkchen)
// Für effekt-schicht.js (Attraktoren, Fraktale, Game of Life). Die Foto-Effekte haben ihre eigene Liste
// (projekte/photo-effects/main.js), weil dort auch Overlays und das Fenster ums Bild in der Kette stehen.
//
// Neue Effekte kommen ans Ende, aber vor den „letzten“ (CRT: die gewölbten Ränder sollen über allem liegen).

export function richteKetteEin(liste, { name, kopierbar = () => false, beiKopie = () => {}, beiAus = () => {}, beiAenderung = () => {}, letzte = [] }) {
  const kette = []; // Schlüssel der Effekte, in der Reihenfolge, in der sie rechnen
  const nachbarn = new Map(); // Kopie -> Vorbild: eine neue Kopie kommt direkt hinter ihr Vorbild

  function knopf(text, beschriftung, aus, beiKlick) {
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = text;
    k.setAttribute("aria-label", beschriftung);
    k.disabled = aus;
    k.addEventListener("click", beiKlick);
    return k;
  }

  function zeige() {
    liste.replaceChildren();
    liste.closest("details")?.toggleAttribute("hidden", kette.length === 0); // leer: Abschnitt weg
    kette.forEach((s, i) => {
      const li = document.createElement("li");
      const n = name(s);
      li.append(
        n,
        knopf("↑", `${n} nach oben`, i === 0, () => tausche(i, i - 1)),
        knopf("↓", `${n} nach unten`, i === kette.length - 1, () => tausche(i, i + 1)),
      );
      if (kopierbar(s)) li.append(knopf("⧉", `${n} kopieren`, false, () => beiKopie(s)));
      li.append(knopf("×", `${n} ausschalten`, false, () => beiAus(s)));
      liste.append(li);
    });
  }

  function tausche(i, j) {
    if (j < 0 || j >= kette.length) return;
    [kette[i], kette[j]] = [kette[j], kette[i]];
    zeige();
    beiAenderung();
  }

  return {
    kette,
    // vor dem Einschalten einer Kopie: hinter wem sie stehen soll
    merkeNachbar(s, vorbild) {
      nachbarn.set(s, vorbild);
    },
    nimmAuf(s) {
      if (kette.includes(s)) return;
      let stelle = kette.findIndex((k) => letzte.includes(k));
      if (stelle < 0 || letzte.includes(s)) stelle = kette.length;
      const vorbild = nachbarn.get(s);
      nachbarn.delete(s);
      if (vorbild && kette.includes(vorbild)) stelle = kette.indexOf(vorbild) + 1;
      kette.splice(stelle, 0, s);
      zeige();
    },
    nimmRaus(s) {
      const i = kette.indexOf(s);
      if (i >= 0) kette.splice(i, 1);
      zeige();
    },
    zeige,
    tausche, // auch von außen (das Export-Fenster verschiebt in derselben Kette)
  };
}
