// Mobile wie bei Alexander Calder: mehrere Attraktoren hängen an Balken, die Balken hängen an Fäden.
//
// Aufbau als Baum: ein Knoten ist entweder ein Blatt (ein Attraktor) oder ein Balken mit einem linken
// und einem rechten Kind. Jeder Knoten hängt an seinem eigenen Faden und kann sich darum drehen
// (Torsionspendel wie beim Strick). Dreht sich ein Balken, wandern seine Kinder mit herum.
//
//        Haken
//          │
//    ┌─────┴───────────┐      oberster Balken
//    │                 │
//   (A)          ┌─────┴──┐   Balken darunter
//                │        │
//               (B)      (C)
//
// Gleichgewicht: ein Balken hängt dort, wo sich beide Seiten die Waage halten (Hebelgesetz):
//   Masse links · Arm links = Masse rechts · Arm rechts
// Hängt rechts doppelt so viel, ist der rechte Arm halb so lang. Darum sieht ein Mobile schief aus
// und ist doch im Gleichgewicht. Jeder Attraktor zählt hier als Masse 1, ein Balken als die Summe darunter.

import { drehY, mal, anwenden } from "./lage.js";

const SKALA = 0.42; // ein Attraktor (sonst −1 bis 1 groß) wird im Mobile so klein
const BALKEN = [2.1, 1.2]; // Länge des obersten Balkens, der Balken darunter
const FADEN_OBEN = 0.35; // vom Haken zum obersten Balken
const FADEN_BALKEN = 0.35; // vom Balken zum Balken darunter
const FADEN_BLATT = [0.3, 0.6, 0.42, 0.75]; // zu den Attraktoren: verschieden lang, das wirkt lebendiger
const TORSION = 1.2; // wie beim Strick: wie stark ein verdrillter Faden zurückdreht
const KOPPLUNG = 0.6; // wie stark ein Kind gegen die Drehung seines Balkens zurückbleibt (Trägheit)

// Baum für 2, 3 oder 4 Attraktoren (die Nummern sind die Punktlisten 1, 2, … im Shader)
function baueBaum(anzahl) {
  const blatt = (i) => ({ blatt: i + 1 });
  if (anzahl === 2) return { links: blatt(0), rechts: blatt(1) };
  if (anzahl === 3) return { links: blatt(0), rechts: { links: blatt(1), rechts: blatt(2) } };
  return { links: { links: blatt(0), rechts: blatt(1) }, rechts: { links: blatt(2), rechts: blatt(3) } };
}

function masse(knoten) {
  return knoten.blatt ? 1 : masse(knoten.links) + masse(knoten.rechts);
}

export function erstelleMobile(anzahl) {
  const baum = baueBaum(anzahl);
  const knotenListe = []; // alle Knoten, für das Pendeln

  // jedem Knoten seine Fadenlänge, Drehung und (bei Balken) die Arme nach dem Hebelgesetz geben
  function richteEin(knoten, tiefe, eltern) {
    knoten.eltern = eltern;
    knoten.drill = 0; // wie weit sein Faden verdrillt ist (Bogenmaß)
    knoten.drillTempo = 0;
    knoten.masse = masse(knoten);
    // schwere Knoten drehen träger (längere Schwingungsdauer), so schwingt nicht alles im Gleichtakt
    knoten.steifheit = TORSION / Math.sqrt(knoten.masse);
    knotenListe.push(knoten);
    if (knoten.blatt) {
      knoten.faden = FADEN_BLATT[(knoten.blatt - 1) % FADEN_BLATT.length];
      return;
    }
    knoten.faden = tiefe === 0 ? FADEN_OBEN : FADEN_BALKEN;
    const laenge = BALKEN[Math.min(tiefe, BALKEN.length - 1)];
    const links = masse(knoten.links);
    const rechts = masse(knoten.rechts);
    // Hebelgesetz: links · armLinks = rechts · armRechts und armLinks + armRechts = laenge
    knoten.armLinks = (laenge * rechts) / (links + rechts);
    knoten.armRechts = (laenge * links) / (links + rechts);
    richteEin(knoten.links, tiefe + 1, knoten);
    richteEin(knoten.rechts, tiefe + 1, knoten);
  }
  richteEin(baum, 0, null);

  // Wo hängt was? haken: Aufhängung oben (Welt). teile: pro Punktliste { tiefster, hoechster } (Raum −1 bis 1).
  // Ergebnis: koerper (Lage jedes Attraktors), striche (Fäden und Balken), tiefster (unterster Punkt in Ruhe)
  // startDrehung: das ganze Mobile gedreht (Regler „Attraktor drehen“, Drehen lassen, Musik)
  function lagen(haken, teile, startDrehung = [1, 0, 0, 0, 1, 0, 0, 0, 1]) {
    const koerper = [];
    const striche = [];
    let tiefster = Infinity;

    function platziere(knoten, aufhaenger, drehungEltern) {
      // der Faden hängt senkrecht nach unten (Drehungen um die Senkrechte lassen ihn senkrecht)
      const unten = [aufhaenger[0], aufhaenger[1] - knoten.faden, aufhaenger[2]];
      striche.push({ von: aufhaenger, bis: unten, dicke: 1 });
      // eigene Drehung = die des Balkens darüber, dazu die Verdrillung des eigenen Fadens
      const drehung = mal(drehungEltern, drehY(knoten.drill));

      if (knoten.blatt) {
        const { tiefster: t, hoechster: h } = teile[knoten.blatt];
        // der Faden ist am höchsten Punkt festgemacht, die Mitte liegt SKALA · h darunter
        const mitte = [unten[0], unten[1] - SKALA * h, unten[2]];
        const skala = [SKALA, 0, 0, 0, SKALA, 0, 0, 0, SKALA]; // verkleinern ist auch eine Matrix
        koerper.push({ nummer: knoten.blatt, lage: mal(drehung, skala), lageVersatz: mitte });
        tiefster = Math.min(tiefster, mitte[1] + SKALA * t);
        return;
      }

      // Balken: Enden links und rechts vom Aufhängepunkt, mitgedreht
      const plus = (a, b) => a.map((k, i) => k + b[i]);
      const links = plus(unten, anwenden(drehung, [-knoten.armLinks, 0, 0]));
      const rechts = plus(unten, anwenden(drehung, [knoten.armRechts, 0, 0]));
      striche.push({ von: links, bis: rechts, dicke: 2.5 });
      platziere(knoten.links, links, drehung);
      platziere(knoten.rechts, rechts, drehung);
    }

    platziere(baum, haken, startDrehung);
    return { koerper, striche, tiefster };
  }

  // Pendeln: jeder Faden ein Torsionspendel. Dazu die Kopplung: beschleunigt ein Balken seine Drehung,
  // bleiben die Kinder durch ihre Trägheit zurück, sie drehen sich also gegen ihn (relativ zu ihm).
  // So reicht ein Stoß, und alles bewegt sich, jedes Teil in seinem eigenen Takt.
  function schwinge(sekunden, daempfung) {
    const schritte = Math.max(1, Math.ceil(sekunden / 0.004));
    const h = sekunden / schritte;
    for (let s = 0; s < schritte; s++) {
      // von oben nach unten: so kennt jedes Kind die Beschleunigung seines Balkens schon
      for (const knoten of knotenListe) {
        let beschleunigung = -knoten.steifheit * knoten.drill - daempfung * knoten.drillTempo;
        if (knoten.eltern) beschleunigung -= KOPPLUNG * knoten.eltern.beschleunigung;
        knoten.beschleunigung = beschleunigung;
        knoten.drillTempo += beschleunigung * h;
        knoten.drill += knoten.drillTempo * h;
      }
    }
  }

  // Anstoßen: der oberste Balken dreht sich, die anderen bekommen jeder einen eigenen kleinen Ruck
  function stupse(dx) {
    knotenListe.forEach((knoten, i) => {
      const richtung = i === 0 ? 1 : (i % 2 ? -1 : 1) * (0.5 + 0.5 * Math.random());
      knoten.drillTempo += dx * 1.5 * richtung;
    });
  }

  function bewegtSich() {
    return knotenListe.some((k) => Math.abs(k.drill) > 0.0005 || Math.abs(k.drillTempo) > 0.0005);
  }

  function halte() {
    for (const knoten of knotenListe) knoten.drill = knoten.drillTempo = 0;
  }

  // für Export und Vorschau: den Zustand merken und wiederherstellen
  function merke() {
    const alt = knotenListe.map((k) => [k.drill, k.drillTempo]);
    return () => knotenListe.forEach((k, i) => ([k.drill, k.drillTempo] = alt[i]));
  }

  return { lagen, schwinge, stupse, bewegtSich, halte, merke };
}
