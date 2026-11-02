// Was der Zeiger auf der Leinwand macht, je nach Werkzeug:
//   pinsel, radierer   Tupfer auf die aktive Ebene (Malschicht oder Maske einer Ton-Ebene)
//   auswahl            Rechteck aufziehen; in der Auswahl ziehen verschiebt den Inhalt (mit Alt oder
//                      dem Häkchen „Kopie“ bleibt das Original stehen)
//   verschieben        die ganze aktive Ebene ziehen (Bild: Zeit und Höhe, Ton: nur die Zeit)
// In jedem Werkzeug: in der Nähe des Lesekopfs greift man ihn, mit Shift setzt man ihn irgendwohin.
//
// Alles, was die Seite sonst weiß, kommt über s (main.js): Zustand, Grafikkarte, Klang und Helfer.

import { anteilZuFrequenz, frequenzZuAnteil } from "./leinwand.js";
import { felderVon, betroffen, verschiebe, stille } from "./auswahl.js";

const GREIF_ABSTAND = 10; // so nah (Bildpunkte) am Lesekopf greift man ihn statt zu malen
const ABSTAND_TUPFER = 0.25; // Tupfer entlang eines Strichs: alle 0,25 Radien einer

// auf welches Feld einer Ebene gemalt wird (null: auf diese Ebene malt man nicht)
export function malFeld(ebene) {
  return ebene?.art === "mal" ? "werte" : ebene?.art === "ton" && !ebene.aufnahme ? "maske" : null;
}

export function richteWerkzeugeEin(s) {
  const { bild, stapel, gpu, klang, einstellung, z } = s;

  // Zeiger -> Bildpunkte, y = 0 unten (wie im Shader)
  function imBild(event) {
    const rahmen = bild.getBoundingClientRect();
    return { x: event.clientX - rahmen.left, y: rahmen.bottom - event.clientY };
  }
  const pxProSpalte = () => bild.clientWidth / z.leinwand.spalten;
  const yZuFrequenz = (y) => {
    const a = s.ansicht();
    return anteilZuFrequenz(y / a.hoehe, a.tief, a.hoch);
  };
  // um wie viel sich eine Frequenz ändert, wenn man dy Bildpunkte nach oben zieht (logarithmisch: ein Faktor)
  const faktorFuer = (dy) => {
    const a = s.ansicht();
    return (a.hoch / a.tief) ** (dy / a.hoehe);
  };
  const ebeneFuer = (felder) => {
    const e = s.aktiveEbene();
    return e && felder.includes(e.art) && !e.aufnahme ? e : null;
  };

  // Spalten von bis bis (der Ebene) von feld überall hin, wo es gebraucht wird:
  // auf die Grafikkarte (falls man darauf malt), zum Klang, in die Anzeige
  function verteile(ebene, feld, von, bis) {
    const { faecher } = z.leinwand;
    if (feld === malFeld(ebene)) gpu.schreibe(ebene.id, von, bis, ebene[feld]);
    klang.teil(ebene.id, feld, ebene[feld], von * faecher, (bis + 1) * faecher);
    const versatz = ebene.art === "ton" ? ebene.start : 0;
    s.mischeBald(von + versatz, bis + versatz);
  }

  // alle Felder einer Ebene von Spalte von bis bis merken; zurück kommt, was sie wiederherstellt
  function merkeSpalten(ebene, von, bis) {
    const { faecher } = z.leinwand;
    const alt = felderVon(ebene).map((feld) => [feld, ebene[feld].slice(von * faecher, (bis + 1) * faecher)]);
    return () => {
      for (const [feld, werte] of alt) {
        ebene[feld].set(werte, von * faecher);
        verteile(ebene, feld, von, bis);
      }
    };
  }

  // ---------- Malen ----------

  let tupfer = []; // gesammelt seit dem letzten Bild
  let strich = null; // { x, y, ebene, alt: Map(spalte -> alte Werte) } solange gemalt wird

  function neuerTupfer(x, y) {
    tupfer.push({ x, y });
    s.zeichneBald();
  }

  // zwischen zwei Zeiger-Meldungen können viele Pixel liegen: dort Tupfer nachreichen
  function malBis(x, y) {
    const schritt = Math.max(1, einstellung.groesse * ABSTAND_TUPFER);
    const dx = x - strich.x;
    const dy = y - strich.y;
    const laenge = Math.hypot(dx, dy);
    if (laenge < schritt) return; // noch zu nah am letzten Tupfer
    const anzahl = Math.floor(laenge / schritt);
    for (let i = 1; i <= anzahl; i++) neuerTupfer(strich.x + (dx * i * schritt) / laenge, strich.y + (dy * i * schritt) / laenge);
    strich.x += (dx * anzahl * schritt) / laenge;
    strich.y += (dy * anzahl * schritt) / laenge;
  }

  // einmal pro Bild (main.js): alle gesammelten Tupfer auf die Grafikkarte, geänderte Spalten zurücklesen
  function tupfeAlle() {
    if (!tupfer.length || !strich) {
      tupfer = [];
      return;
    }
    const { ebene } = strich;
    const feld = malFeld(ebene);
    const versatz = ebene.art === "ton" ? ebene.start : 0;
    const a = s.ansicht();
    const t = {
      radius: einstellung.groesse,
      staerke: einstellung.staerke,
      haerte: einstellung.haerte,
      helligkeit: einstellung.helligkeit,
      radieren: einstellung.werkzeug === "radierer",
    };
    let von = Infinity;
    let bis = -Infinity;
    for (const { x, y } of tupfer) {
      const bereich = gpu.tupfe(ebene.id, a, { ...t, x, y }, versatz);
      if (!bereich) continue;
      von = Math.min(von, bereich[0]);
      bis = Math.max(bis, bereich[1]);
    }
    tupfer = [];
    if (von > bis) return;

    // für Rückgängig: jede Spalte, bevor dieser Strich sie das erste Mal ändert
    const { faecher } = z.leinwand;
    for (let sp = von; sp <= bis; sp++) {
      if (!strich.alt.has(sp)) strich.alt.set(sp, ebene[feld].slice(sp * faecher, (sp + 1) * faecher));
    }
    gpu.lies(ebene.id, von, bis, ebene[feld]); // neue Werte in den Speicher
    klang.teil(ebene.id, feld, ebene[feld], von * faecher, (bis + 1) * faecher); // zum Klang
    s.mischeBald(von + versatz, bis + versatz); // und in die Anzeige
  }

  function strichFertig() {
    tupfeAlle(); // was noch wartet, gehört zu diesem Strich
    const { ebene, alt } = strich;
    strich = null;
    if (!alt.size) return;
    const feld = malFeld(ebene);
    const { faecher } = z.leinwand;
    s.merke(() => {
      for (const [sp, werte] of alt) {
        ebene[feld].set(werte, sp * faecher);
        verteile(ebene, feld, sp, sp);
      }
    });
  }

  // ---------- Auswahl ----------

  let auswahl = null; // { von, bis (Spalten der Leinwand), unten, oben (Hz) }
  let aufziehen = null; // { x, y } Startpunkt beim Aufziehen
  let verschieben = null; // { x, y, dx, dy } beim Ziehen einer Auswahl oder Ebene

  function inAuswahl(p) {
    if (!auswahl) return false;
    const sp = p.x / pxProSpalte();
    const f = yZuFrequenz(p.y);
    return sp >= auswahl.von && sp <= auswahl.bis + 1 && f >= auswahl.unten && f <= auswahl.oben;
  }

  function setzeAuswahl(p0, p1) {
    const { spalten } = z.leinwand;
    const von = Math.max(0, Math.floor(Math.min(p0.x, p1.x) / pxProSpalte()));
    const bis = Math.min(spalten - 1, Math.floor(Math.max(p0.x, p1.x) / pxProSpalte()));
    auswahl = { von, bis, unten: yZuFrequenz(Math.min(p0.y, p1.y)), oben: yZuFrequenz(Math.max(p0.y, p1.y)) };
  }

  function auswahlVerschieben(kopie) {
    const ebene = ebeneFuer(["mal", "ton"]);
    if (!ebene) return;
    const d = Math.round(verschieben.dx / pxProSpalte());
    const faktor = faktorFuer(verschieben.dy);
    if (!d && Math.abs(faktor - 1) < 1e-3) return;
    const bereich = betroffen(ebene, auswahl, d, z.leinwand);
    if (!bereich) return;
    s.merke(merkeSpalten(ebene, ...bereich));
    verschiebe(ebene, auswahl, { d, faktor, kopie }, z.leinwand, z.tabelle);
    for (const feld of felderVon(ebene)) verteile(ebene, feld, ...bereich);
    // die Auswahl geht mit
    const { spalten } = z.leinwand;
    auswahl = {
      von: Math.max(0, auswahl.von + d),
      bis: Math.min(spalten - 1, auswahl.bis + d),
      unten: auswahl.unten * faktor,
      oben: auswahl.oben * faktor,
    };
  }

  function auswahlStille() {
    const ebene = ebeneFuer(["mal", "ton"]);
    if (!ebene || !auswahl) return;
    const bereich = betroffen(ebene, auswahl, 0, z.leinwand);
    if (!bereich) return;
    s.merke(merkeSpalten(ebene, ...bereich));
    stille(ebene, auswahl, z.leinwand);
    for (const feld of felderVon(ebene)) verteile(ebene, feld, ...bereich);
  }

  // ---------- ganze Ebene verschieben ----------

  function ebeneVerschieben(ebene, dx, dy, endgueltig) {
    const d = dx / pxProSpalte();
    if (ebene.art === "ton") {
      // Ton: nur die Zeit, und gleich (der Klang braucht nur die neue Startspalte)
      const start = Math.round(verschieben.alt.start + d);
      if (start !== ebene.start) {
        ebene.start = start;
        klang.eigenschaften(ebene.id, { start });
        s.mischeBald();
      }
      if (endgueltig && start !== verschieben.alt.start) {
        const alt = verschieben.alt.start;
        s.merke(() => s.aendere(ebene.id, { start: alt }));
      }
      return;
    }
    // Bild: beim Ziehen nur den Rahmen zeigen, erst beim Loslassen neu rechnen (das dauert etwas)
    const faktor = faktorFuer(dy);
    const neu = {
      anfang: verschieben.alt.anfang + d,
      ende: verschieben.alt.ende + d,
      unten: verschieben.alt.unten * faktor,
      oben: verschieben.alt.oben * faktor,
    };
    if (!endgueltig) {
      verschieben.vorschau = neu;
      return;
    }
    verschieben.vorschau = null;
    const alt = { ...verschieben.alt };
    s.aendere(ebene.id, neu);
    s.merke(() => s.aendere(ebene.id, alt));
  }

  // ---------- Zeiger ----------

  let ziehtKopf = false;

  stapel.addEventListener("pointerdown", (event) => {
    if (!z.leinwand || event.button > 0) return; // nur linke Maustaste, Finger, Stift
    const p = imBild(event);
    stapel.setPointerCapture(event.pointerId);
    const kopfX = (z.pos / z.leinwand.spalten) * bild.clientWidth;
    // Lesekopf: anfassen und ziehen, oder mit Shift irgendwohin klicken
    if (event.shiftKey || Math.abs(p.x - kopfX) < GREIF_ABSTAND) {
      ziehtKopf = true;
      s.setzeLesekopf(p.x / pxProSpalte());
      return;
    }
    const werkzeug = einstellung.werkzeug;
    if (werkzeug === "pinsel" || werkzeug === "radierer") {
      const ebene = s.aktiveEbene();
      if (!malFeld(ebene)) {
        s.zeige(ebene?.aufnahme ? "Diese Ebene wird gerade aufgenommen." : "Auf Bild-Ebenen malt man nicht. Wähle die Malschicht oder eine Ton-Ebene.");
        return;
      }
      s.zeige("");
      strich = { x: p.x, y: p.y, ebene, alt: new Map() };
      neuerTupfer(p.x, p.y);
    } else if (werkzeug === "auswahl") {
      if (!ebeneFuer(["mal", "ton"])) {
        s.zeige("Auswählen geht auf der Malschicht und auf Ton-Ebenen.");
        return;
      }
      s.zeige("");
      if (inAuswahl(p)) verschieben = { x: p.x, y: p.y, dx: 0, dy: 0, kopie: event.altKey || einstellung.kopie };
      else {
        aufziehen = p;
        auswahl = null;
      }
    } else if (werkzeug === "verschieben") {
      const ebene = ebeneFuer(["bild", "ton"]);
      if (!ebene) {
        s.zeige("Verschieben geht mit Bild- und Ton-Ebenen. Die Malschicht verschiebst du mit der Auswahl.");
        return;
      }
      s.zeige("");
      const { start, anfang, ende, unten, oben } = ebene;
      verschieben = { x: p.x, y: p.y, dx: 0, dy: 0, ebene, alt: { start, anfang, ende, unten, oben } };
    }
    s.zeichneBald();
  });

  stapel.addEventListener("pointermove", (event) => {
    if (!stapel.hasPointerCapture(event.pointerId)) return; // nur bei gedrückter Maus
    const p = imBild(event);
    if (ziehtKopf) s.setzeLesekopf(p.x / pxProSpalte());
    else if (strich) malBis(p.x, p.y);
    else if (aufziehen) setzeAuswahl(aufziehen, p);
    else if (verschieben) {
      verschieben.dx = p.x - verschieben.x;
      verschieben.dy = p.y - verschieben.y;
      if (verschieben.ebene) ebeneVerschieben(verschieben.ebene, verschieben.dx, verschieben.dy, false);
    }
    s.zeichneBald();
  });

  function lassLos() {
    if (strich) strichFertig();
    if (verschieben?.ebene) ebeneVerschieben(verschieben.ebene, verschieben.dx, verschieben.dy, true);
    else if (verschieben) auswahlVerschieben(verschieben.kopie);
    verschieben = null;
    aufziehen = null;
    ziehtKopf = false;
    s.zeichneBald();
  }
  stapel.addEventListener("pointerup", lassLos);
  stapel.addEventListener("pointercancel", lassLos);

  // ---------- Rahmen über dem Bild (kopf.js) ----------

  function rechteck(spalteVon, spalteBis, unten, oben, gestrichelt) {
    const { spalten } = z.leinwand;
    const a = s.ansicht();
    return {
      links: spalteVon / spalten,
      rechts: spalteBis / spalten,
      unten: frequenzZuAnteil(unten, a.tief, a.hoch),
      oben: frequenzZuAnteil(oben, a.tief, a.hoch),
      gestrichelt,
    };
  }

  function rechtecke() {
    const liste = [];
    const e = s.aktiveEbene();
    const a = s.ansicht();
    if (e?.art === "bild") {
      const lage = verschieben?.vorschau ?? e;
      liste.push(rechteck(lage.anfang, lage.ende, lage.unten, lage.oben, false));
    } else if (e?.art === "ton") {
      liste.push(rechteck(e.start, e.start + e.spalten, a.tief, a.hoch, false));
    }
    if (auswahl && einstellung.werkzeug === "auswahl") {
      // beim Ziehen: dort, wo sie hinkommt
      const d = verschieben && !verschieben.ebene ? verschieben.dx / pxProSpalte() : 0;
      const f = verschieben && !verschieben.ebene ? faktorFuer(verschieben.dy) : 1;
      liste.push(rechteck(auswahl.von + d, auswahl.bis + 1 + d, auswahl.unten * f, auswahl.oben * f, true));
    }
    return liste;
  }

  return {
    tupfeAlle,
    rechtecke,
    auswahlStille,
    auswahlWeg: () => {
      auswahl = null;
      s.zeichneBald();
    },
    neueLeinwand: () => {
      auswahl = null;
      strich = null;
      tupfer = [];
    },
  };
}
