// Ton -> Ton-Ebene: die STFT einer Aufnahme, in genau den Spalten und Fächern der Leinwand.
// Das Gegenstück zum Klang (klang-worklet.js): der baut aus Spalten wieder Ton.
//
// Spalte s ist ein Fenster mit der Mitte bei Sample s · sprung (so steht sie im Bild genau dort,
// wo man sie hört). Pro Fach kommen drei Zahlen heraus:
//   betrag  wie laut. |X| · 4 / fenster: ein Sinus mit Ausschlag 1 hat dann betrag 1, wie gemalte 0 dB
//           (das Hann-Fenster halbiert, und ein Sinus verteilt sich auf Fach k und sein Spiegelbild)
//   phase   wo der Sinus in diesem Fach gerade steht
//   dreh    wie weit sich die Phase bis zur nächsten Spalte dreht. Das ist die eigentliche Frequenz:
//           Ein Ton von 450 Hz liegt in Fach 19 (bei 23,4 Hz pro Fach 445 Hz), dreht sich aber etwas
//           schneller als die Fachmitte. Aus diesem Unterschied rechnet der Phasen-Vocoder.
//           Gespeichert wird dreh nur zwischen −π und π (ganze Umdrehungen ändern an der Phase nichts).
//           Sonst wären es bei hohen Fächern Zahlen bis 800, und ein Float32 hätte dort nur noch
//           4 Stellen hinter dem Komma: Über hunderte Spalten addiert, verrutscht die Phase hörbar.
//           Die ganze Drehung bekommt man mit drehGanz wieder (z. B. für Tonhöhe verschieben).
//
// Warum dreh speichern und nicht nur die Phase? Spielt man schneller, langsamer, rückwärts oder hält an,
// passen die gespeicherten Phasen nicht mehr aneinander. Der Klang dreht dann jede Phase selbst weiter,
// immer um dreh der Spalte, die gerade klingt (Phasen-Vocoder). Bei Tempo 1 vorwärts kommt dabei genau
// die gespeicherte Phase heraus, und die Aufnahme klingt wie vorher.

import { baueFft } from "/lib/fft.js";

const ZWEI_PI = 2 * Math.PI;

// auf −π bis π bringen
export const umEins = (winkel) => winkel - ZWEI_PI * Math.round(winkel / ZWEI_PI);

// die ganze Drehung pro Sprung aus dem gespeicherten dreh (Fach k, mitte = Drehung der Fachmitte)
export function drehGanz(dreh, k, leinwand) {
  const mitte = (ZWEI_PI * k * leinwand.sprung) / leinwand.fenster;
  return mitte + umEins(dreh - mitte); // die Abweichung von der Mitte ist immer kleiner als π
}

// eine leere Ton-Ebene mit Platz für spalten Spalten
export function leereTonDaten(spalten, faecher) {
  const groesse = spalten * faecher;
  const maske = new Float32Array(groesse);
  maske.fill(1); // nichts wegradiert
  return {
    spalten,
    betrag: new Float32Array(groesse),
    phase: new Float32Array(groesse),
    dreh: new Float32Array(groesse),
    maske,
  };
}

export function baueAnalyse(leinwand) {
  const { fenster, sprung, faecher } = leinwand;
  const fft = baueFft(fenster);
  const hann = new Float32Array(fenster);
  for (let n = 0; n < fenster; n++) hann[n] = 0.5 - 0.5 * Math.cos((ZWEI_PI * n) / fenster);
  const stueck = new Float32Array(fenster);
  const re = new Float32Array(fenster);
  const im = new Float32Array(fenster);
  const normal = 4 / fenster;

  // um so viel dreht sich die Mitte von Fach k pro Sprung (wie im Klang; normale Zahlen, kein Float32)
  const mitte = [];
  for (let k = 0; k < faecher; k++) mitte.push((ZWEI_PI * k * sprung) / fenster);

  // wie viele Spalten passen zu laenge Samples? (die letzte hat ihre Mitte noch im Ton)
  const spaltenFuer = (laenge) => Math.ceil(laenge / sprung) + 1;

  // fertig ist Spalte s, sobald ihr Fenster ganz im Ton liegt (oder der Ton zu Ende ist)
  const fertigBis = (laenge, zuEnde) =>
    zuEnde ? spaltenFuer(laenge) - 1 : Math.floor((laenge - fenster / 2) / sprung);

  // Spalten von bis bis (beide mit) aus samples[0 .. laenge) in ton schreiben (betrag und phase)
  function spaltenRechnen(ton, samples, laenge, von, bis) {
    for (let s = von; s <= bis; s++) {
      const anfang = s * sprung - fenster / 2;
      for (let n = 0; n < fenster; n++) {
        const i = anfang + n;
        stueck[n] = i >= 0 && i < laenge ? samples[i] * hann[n] : 0; // vor dem Anfang und nach dem Ende: Stille
      }
      fft(stueck, re, im);
      const basis = s * faecher;
      for (let k = 0; k < faecher; k++) {
        ton.betrag[basis + k] = Math.hypot(re[k], im[k]) * normal;
        ton.phase[basis + k] = Math.atan2(im[k], re[k]);
      }
    }
  }

  // dreh für Spalten von bis bis: braucht die Phase der nächsten Spalte (die letzte nimmt die Fachmitte)
  function drehRechnen(ton, von, bis) {
    for (let s = von; s <= bis; s++) {
      const basis = s * faecher;
      const letzte = s + 1 >= ton.spalten;
      for (let k = 0; k < faecher; k++) {
        // gemessene Drehung (die letzte Spalte hat keine nächste: dort die Fachmitte), auf −π bis π
        ton.dreh[basis + k] = letzte ? umEins(mitte[k]) : umEins(ton.phase[basis + faecher + k] - ton.phase[basis + k]);
      }
    }
  }

  return { spaltenFuer, fertigBis, spaltenRechnen, drehRechnen };
}

// eine ganze Aufnahme auf einmal (höchstens maxSpalten Spalten)
export function analysiere(samples, leinwand, maxSpalten) {
  const analyse = baueAnalyse(leinwand);
  const spalten = Math.max(1, Math.min(analyse.spaltenFuer(samples.length), maxSpalten));
  const ton = leereTonDaten(spalten, leinwand.faecher);
  analyse.spaltenRechnen(ton, samples, samples.length, 0, spalten - 1);
  analyse.drehRechnen(ton, 0, spalten - 1);
  return ton;
}
