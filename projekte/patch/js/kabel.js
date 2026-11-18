// Kabel: wer mit wem verbunden ist, und wie es aussieht.
//
// Verbinden: Ton-Ausgang → Ton-Eingang ruft knoten.connect(ziel) auf (ziel ist ein AudioNode oder ein AudioParam;
// mehrere Kabel an einem Eingang werden addiert, so wie in einem echten Mischpunkt). Takt → Takt trägt die Funktion
// des Eingangs bei den Hörern des Ausgangs ein. Ton an Takt geht nicht (das eine sind Zahlen, das andere Ereignisse).
//
// Aussehen: ein Kabel hängt durch wie ein echtes. Gezeichnet als kubische Bézierkurve von Buchse zu Buchse, beide
// Stützpunkte um den Durchhang d nach unten verschoben:
//   P0 = a, P1 = a + (0, d), P2 = b + (0, d), P3 = b
// Der Durchhang wächst mit der Länge (d₀ = 0,25 · Länge + 30). Wird ein Fenster gezogen, schwingt das Kabel nach:
// d ist eine gedämpfte Feder (Masse 1), die Bewegung der Enden gibt ihr einen Stoß:
//   d'' = −k (d − d₀) − c d' ,  k = 60, c = 5   (schwach gedämpft: es schwingt ein-, zweimal und kommt zur Ruhe)
// Bei „Bewegung reduzieren“ hängt es still.

const wenigBewegung = matchMedia("(prefers-reduced-motion: reduce)");
const K = 60, C = 5;

// lokal(x, y): Bildschirm → Koordinaten der Wand (ansicht.js, wegen Zoom)
// umleiten(modul, name, richtung): steckt das Modul in einer zugeklappten Gruppe, das Element, an dem das Kabel
//   stattdessen endet (die Buchse außen an der Gruppe oder ihr Rand), sonst null (gruppen.js)
// innen(k): liegt das Kabel ganz in einer zugeklappten Gruppe? Dann wird es nicht gezeichnet
export function erstelleKabel({ svg, wand, lokal, umleiten = () => null, innen = () => false }) {
  const kabel = new Set(); // { von: {modul, name}, nach: {modul, name}, art, pfad, d, v, alt }

  function mitte(el) {
    const r = el.getBoundingClientRect();
    return lokal(r.left + r.width / 2, r.top + r.height / 2);
  }
  function punktVon(modul, name, richtung) {
    const ersatz = umleiten(modul, name, richtung);
    if (ersatz) return mitte(ersatz);
    const b = modul.el.querySelector(`.buchse.${richtung}[data-name="${CSS.escape(name)}"]`);
    return b ? mitte(b) : null;
  }

  const pfadText = (a, b, d) => `M${a.x},${a.y} C${a.x},${a.y + d} ${b.x},${b.y + d} ${b.x},${b.y}`;
  const durchhang = (a, b) => 0.25 * Math.hypot(b.x - a.x, b.y - a.y) + 30;

  function verbinde(von, nach) {
    const a = von.modul.teil.aus[von.name], e = nach.modul.teil.ein[nach.name];
    if (!a || !e) return null;
    if (a.art !== e.art) throw new Error("Ton und Takt passen nicht zusammen: Ton an Ton, Takt an Takt.");
    for (const k of kabel) if (k.von.modul === von.modul && k.von.name === von.name && k.nach.modul === nach.modul && k.nach.name === nach.name) return k;
    if (a.art === "ton") a.knoten.connect(e.ziel);
    else a.knoten.hoerer.add(e.ziel);
    const pfad = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pfad.setAttribute("class", `kabel ${a.art}`);
    const griff = document.createElementNS("http://www.w3.org/2000/svg", "path"); // breiter, unsichtbar: zum Anfassen
    griff.setAttribute("class", "kabel-griff");
    const titel = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titel.textContent = `${von.modul.titel} ${von.name} → ${nach.modul.titel} ${nach.name} (Doppelklick: lösen)`;
    griff.append(titel);
    svg.append(pfad, griff);
    const k = { von, nach, art: a.art, pfad, griff, d: null, v: 0, alt: null };
    griff.addEventListener("dblclick", () => trenne(k));
    // am Handy: lange drücken löst
    let uhr = 0;
    griff.addEventListener("pointerdown", (ev) => {
      // liegt unter dem Kabel eine Buchse (an seinen Enden fast immer), gehört der Klick ihr
      const b = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => el.classList?.contains("buchse"));
      if (b) {
        ev.stopPropagation();
        b.dispatchEvent(new PointerEvent("pointerdown", { clientX: ev.clientX, clientY: ev.clientY, pointerId: ev.pointerId, pointerType: ev.pointerType, button: ev.button, bubbles: true, cancelable: true }));
        return;
      }
      uhr = setTimeout(() => trenne(k), 600);
    });
    griff.addEventListener("pointerup", () => clearTimeout(uhr));
    griff.addEventListener("pointerleave", () => clearTimeout(uhr));
    kabel.add(k);
    markiere();
    return k;
  }

  function trenne(k) {
    if (!kabel.has(k)) return;
    const a = k.von.modul.teil.aus[k.von.name], e = k.nach.modul.teil.ein[k.nach.name];
    try {
      if (k.art === "ton") a.knoten.disconnect(e.ziel);
      else a.knoten.hoerer.delete(e.ziel);
    } catch {
      // schon getrennt (z. B. weil das Modul gerade gelöscht wird)
    }
    k.pfad.remove();
    k.griff.remove();
    kabel.delete(k);
    markiere();
  }

  // belegte Buchsen kennzeichnen (gefüllt), damit man sieht, wo schon etwas steckt
  function markiere() {
    for (const b of wand.querySelectorAll(".buchse")) b.classList.remove("belegt");
    for (const k of kabel) {
      k.von.modul.el.querySelector(`.buchse.aus[data-name="${CSS.escape(k.von.name)}"]`)?.classList.add("belegt");
      k.nach.modul.el.querySelector(`.buchse.ein[data-name="${CSS.escape(k.nach.name)}"]`)?.classList.add("belegt");
    }
  }

  // in jedem Bild: Enden neu messen, Federn einen Schritt weiter, Pfade setzen
  function zeichne(dt) {
    for (const k of kabel) {
      const a = punktVon(k.von.modul, k.von.name, "aus"), b = punktVon(k.nach.modul, k.nach.name, "ein");
      const weg = !a || !b || innen(k);
      k.pfad.style.display = k.griff.style.display = weg ? "none" : "";
      if (weg) continue;
      const d0 = durchhang(a, b);
      if (k.d === null || wenigBewegung.matches) {
        k.d = d0;
        k.v = 0;
      } else {
        // Stoß: wie schnell sich die Mitte der beiden Enden gerade senkrecht bewegt (nach oben gerissen → hängt tiefer)
        if (k.alt) k.v -= ((a.y + b.y) / 2 - k.alt) * 0.5;
        k.v += (-K * (k.d - d0) - C * k.v) * dt;
        k.d += k.v * dt;
      }
      k.alt = (a.y + b.y) / 2;
      const text = pfadText(a, b, k.d);
      k.pfad.setAttribute("d", text);
      k.griff.setAttribute("d", text);
    }
  }

  // ein Kabel, das gerade gezogen wird (von der Buchse zur Maus)
  const zug = document.createElementNS("http://www.w3.org/2000/svg", "path");
  zug.setAttribute("class", "kabel zug");
  function zeigeZug(a, b, art) {
    if (!a) return zug.remove();
    zug.setAttribute("class", `kabel zug ${art}`);
    zug.setAttribute("d", pfadText(a, b, durchhang(a, b)));
    if (!zug.isConnected) svg.append(zug);
  }

  return {
    verbinde,
    trenne,
    zeichne,
    zeigeZug,
    punktVon,
    alle: () => [...kabel],
    vonModul: (m) => [...kabel].filter((k) => k.von.modul === m || k.nach.modul === m),
    amEingang: (m, name) => [...kabel].filter((k) => k.nach.modul === m && k.nach.name === name),
  };
}
