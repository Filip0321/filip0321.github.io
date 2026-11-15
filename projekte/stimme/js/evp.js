// EVP („electronic voice phenomena“): Stimmen im Rauschen.
//
// Seit Friedrich Jürgenson (1959) und Konstantīns Raudive („Unhörbares wird hörbar“, 1968) nehmen Menschen Rauschen
// auf (Radio zwischen den Sendern, leere Tonbänder) und hören darin Stimmen. Was man hört, ist zum größten Teil
// das eigene Gehirn: es sucht in jedem Geräusch nach Sprache (auditive Pareidolie) und findet sie, sobald das
// Rauschen ein bisschen nach Sprache aussieht. Und Sprache erkennt das Ohr an wenig:
//   - Formanten: zwei, drei Resonanzen, die langsam wandern (Vokale sind nur das: F1 und F2)
//   - Silbenrhythmus: die Lautstärke schwankt etwa 3- bis 6-mal pro Sekunde, dazwischen Pausen (Wörter)
//   - ab und zu ein Zischen (s, sch) oder ein Knacken (Verschluss)
// Mehr braucht es nicht. Eine Tonhöhe braucht es nicht einmal: Flüstern ist Rauschen durch den Mund.
//
// Darum macht dieses Modul genau das mit dem Rohr der Stimme: es flüstert (Stimmlippen fast still), der Mund
// wandert zufällig zwischen Vokalen, in Silben und Wortgruppen, und das Ganze liegt leise unter Rauschen, Brummen
// und Knistern (das macht das Worklet). Was „gesagt“ wird, ist Zufall; was man hört, nicht.
//
// Zwei alte Tricks dazu (im Worklet):
//   rückwärts   die Aufnahme in Stücken rückwärts: Raudive suchte so nach „Rückwärtsbotschaften“; rückwärts
//               bleibt das Spektrum sprachähnlich, der Sinn ist sicher weg, und trotzdem hört man Wörter
//   Sendersuche wie eine „Spirit Box“ (Frank Sumption, 2002): ein Radio springt alle 50 bis 150 ms weiter; die
//               Schnipsel reihen sich zu Silben, die keiner gesprochen hat

import { VOKALE } from "./laute.js";

const POSEN = ["a", "e", "i", "o", "u", "E", "@", "2", "y", "O", "U"].map((n) => VOKALE[n]);
const ZISCH = [{ ort: 36, weite: 0.45, rausch: 1 }, { ort: 33, weite: 0.5, rausch: 1 }, { ort: 41, weite: 0.5, rausch: 0.3 }];

export function erstelleEvp(zufall = Math.random) {
  const z = {
    ziel: POSEN[0],
    ort: 17.5,
    weite: 2.5,
    lippen: 3,
    silbeRest: 0,   // Sekunden bis zur nächsten Silbe
    wortRest: 1,    // Sekunden, die die Wortgruppe noch dauert (danach Pause)
    pause: 0,       // Sekunden Pause
    laut: 0,        // Hüllkurve der Silbe (0 bis 1)
    zisch: null,
    zischRest: 0,
  };

  // dt Sekunden weiter; tempo: Silben pro Sekunde, deutlich: wie weit der Mund geht (0 nuschelt, 1 klar)
  function schritt(dt, { tempo, deutlich }) {
    if (z.pause > 0) {
      z.pause -= dt;
      z.laut += (0 - z.laut) * Math.min(1, dt * 20);
    } else {
      z.wortRest -= dt;
      z.silbeRest -= dt;
      if (z.wortRest <= 0) {
        // Wortgruppe zu Ende: Pause, dann eine neue (1 bis 6 Silben)
        z.pause = 0.25 + zufall() * 1.4;
        z.wortRest = (1 + Math.floor(zufall() * 6)) / tempo;
      }
      if (z.silbeRest <= 0) {
        // neue Silbe: neuer Vokal, manchmal mit Zischen davor
        z.silbeRest = (0.6 + zufall() * 0.8) / tempo;
        z.ziel = POSEN[Math.floor(zufall() * POSEN.length)];
        if (zufall() < 0.25) {
          z.zisch = ZISCH[Math.floor(zufall() * ZISCH.length)];
          z.zischRest = 0.06 + zufall() * 0.08;
        }
      }
      // Hüllkurve: in jeder Silbe auf und ab (Mitte laut, Ränder leise)
      const phase = 1 - z.silbeRest * tempo / 1.0;
      z.laut += (Math.sin(Math.PI * Math.min(1, Math.max(0, phase))) - z.laut) * Math.min(1, dt * 25);
    }
    z.zischRest -= dt;
    if (z.zischRest <= 0) z.zisch = null;
    // der Mund gleitet zum Ziel (nicht springen: Formanten wandern, das ist das Sprachähnliche)
    const k = Math.min(1, dt * 12);
    const mitte = VOKALE["@"];
    const zielOrt = mitte.zungeOrt + (z.ziel.zungeOrt - mitte.zungeOrt) * deutlich;
    const zielWeite = mitte.zungeWeite + (z.ziel.zungeWeite - mitte.zungeWeite) * deutlich;
    const zielLippen = 3 + (z.ziel.lippen - 3) * deutlich;
    z.ort += (zielOrt - z.ort) * k;
    z.weite += (zielWeite - z.weite) * k;
    z.lippen += (zielLippen - z.lippen) * k;
    return {
      zungeOrt: z.ort,
      zungeWeite: z.weite,
      lippen: z.lippen,
      laut: z.laut,
      enge: z.zisch ? [z.zisch] : [],
    };
  }
  return { schritt };
}
