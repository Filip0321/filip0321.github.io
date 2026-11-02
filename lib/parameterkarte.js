// Parameterkarte für den 2D- und den 3D-Attraktor: jeder Pixel ist ein Wertepaar
// (z. B. a waagerecht, b senkrecht), gefärbt nach dem Lyapunov-Exponenten (lyapunov() in attraktor.js):
//   hell (Glut)   Chaos: hier entsteht ein seltsamer Attraktor
//   dunkelblau    Ruhe: der Punkt landet auf einem Fixpunkt oder einer festen Runde
//   schwarz       der Punkt läuft davon
// Ein Klick übernimmt die Werte unter dem Zeiger. So findet man schöne Attraktoren gezielt,
// statt blind Zahlen zu probieren: die interessanten liegen oft an den Rändern der Chaos-Inseln.
//
// Gerechnet wird in karten-rechner.js (Web Worker), hier wird nur verteilt, gemalt und bedient.

import { farbtabelle, skalaAnker } from "/lib/farben.js";

const GLUT = farbtabelle(skalaAnker("glut"));

// grob nach fein: erst jede 16. Zeile (nach einem Sechzehntel der Zeit sieht man schon die Form),
// dann jede 8., 4., 2. und zuletzt die übrigen; Lücken füllt die nächste gerechnete Zeile darüber
const STUFEN = [16, 8, 4, 2, 1];

// so viele Worker wie Prozessorkerne, einen weniger für die Seite selbst, aber mindestens einen
const ANZAHL_RECHNER = Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, 8));

export function richteKarteEin({
  canvas, xWahl, yWahl, bereichFeld, knopf, anzeige, abschnitt,
  modul,           // Adresse der attraktor.js mit TYPEN und lyapunov()
  groesse = 160,   // gerechnete Pixel pro Seite (3D ist viel teurer pro Pixel, dort kleiner)
  kleinsteSkala,   // so hell muss Chaos mindestens sein, damit Rauschen nicht als Chaos leuchtet
  aktuell,         // () => { typName, werte, start }: was main.js gerade zeigt
  beiKlick,        // ({ a: 1.2, b: -0.4 }) => …: Werte übernehmen
}) {
  const pinsel = canvas.getContext("2d");

  // die Karte in Rechengröße, beim Zeichnen auf die Canvas-Größe gestreckt
  const quelle = document.createElement("canvas");
  quelle.width = groesse;
  quelle.height = groesse;
  const quellPinsel = quelle.getContext("2d");
  const bild = quellPinsel.createImageData(groesse, groesse); // 4 Bytes pro Pixel: r, g, b, a

  const exponenten = new Float32Array(groesse * groesse); // pro Pixel, für Farbe und Anzeige
  // aus welcher Stufe die Zeile gerade stammt: 0 = selbst gerechnet, 16 = von einer groben Zeile kopiert,
  // 255 = noch gar nichts. Eine Zeile wird nur von einer genaueren überschrieben, egal in welcher
  // Reihenfolge die Worker fertig werden.
  const herkunft = new Uint8Array(groesse);

  let bereich = null; // { xName, yName, xVon, xBis, yVon, yBis } der Karte, die gerade zu sehen ist
  let rechner = []; // die laufenden Worker
  let typName = null;
  let veraltet = true; // Typ oder Preset gewechselt, Karte passt nicht mehr
  let malGeplant = false;
  let skala = kleinsteSkala; // größter Chaos-Wert bisher: der wird volle Helligkeit

  // Exponent → Farbe; Chaos relativ zum größten Wert der Karte, damit auch schwaches Chaos
  // (Thomas λ ≈ 0,1) genauso hell wird wie starkes (Lorenz λ ≈ 0,9)
  function farbe(l) {
    if (!Number.isFinite(l)) return [0, 0, 0]; // läuft davon (Infinity) oder noch nicht gerechnet (NaN)
    if (l > 0) {
      // ab 70 im Verlauf, damit schwaches Chaos nicht im Schwarz der Glut verschwindet
      const i = Math.round(70 + Math.min(l / skala, 1) * 185);
      return [GLUT[i * 3], GLUT[i * 3 + 1], GLUT[i * 3 + 2]];
    }
    // Ruhe: je stabiler (je negativer), desto dunkler
    const k = Math.exp((l / skala) * 3);
    return [20 + 40 * k, 28 + 52 * k, 45 + 75 * k];
  }

  function maleZeile(r) {
    for (let x = 0; x < groesse; x++) {
      const [rot, gruen, blau] = farbe(exponenten[r * groesse + x]);
      const i = (r * groesse + x) * 4;
      bild.data[i] = rot;
      bild.data[i + 1] = gruen;
      bild.data[i + 2] = blau;
      bild.data[i + 3] = 255;
    }
  }

  function leere() {
    exponenten.fill(NaN);
    herkunft.fill(255);
    skala = kleinsteSkala;
    for (let r = 0; r < groesse; r++) maleZeile(r);
    quellPinsel.putImageData(bild, 0, 0);
  }

  // eine Zeile kommt aus einem Worker: sie gilt auch für die Zeilen darunter (bis zur nächsten ihrer Stufe)
  function nimmZeile(y, schritt, zeile) {
    // neuer größter Chaos-Wert: alles neu färben, sonst passen alte und neue Zeilen nicht zusammen
    let neueSkala = skala;
    for (const l of zeile) if (Number.isFinite(l) && l > neueSkala) neueSkala = l;
    const allesNeu = neueSkala > skala * 1.1;
    if (allesNeu) skala = neueSkala;

    for (let r = y; r < Math.min(y + schritt, groesse); r++) {
      const genauigkeit = r === y ? 0 : schritt;
      if (genauigkeit >= herkunft[r]) continue; // da steht schon etwas Genaueres
      herkunft[r] = genauigkeit;
      exponenten.set(zeile, r * groesse);
      if (!allesNeu) maleZeile(r);
    }
    if (allesNeu) {
      for (let r = 0; r < groesse; r++) maleZeile(r);
    }
    quellPinsel.putImageData(bild, 0, 0);
    planeZeichnen();
  }

  // höchstens einmal pro Bild zeichnen, auch wenn viele Zeilen auf einmal ankommen
  function planeZeichnen() {
    if (malGeplant) return;
    malGeplant = true;
    requestAnimationFrame(() => {
      malGeplant = false;
      zeichne();
    });
  }

  // Wert → Stelle auf der Karte (0 bis 1, oben ist der große y-Wert)
  function stelleVon(werte) {
    return {
      x: (werte[bereich.xName] - bereich.xVon) / (bereich.xBis - bereich.xVon),
      y: (bereich.yBis - werte[bereich.yName]) / (bereich.yBis - bereich.yVon),
    };
  }

  function zeichne() {
    if (canvas.clientWidth === 0) return; // Abschnitt zu: nichts zu sehen
    const dpr = window.devicePixelRatio || 1;
    const breite = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== breite) {
      canvas.width = breite;
      canvas.height = breite;
    }
    pinsel.imageSmoothingEnabled = true; // beim Strecken weich mischen statt Klötzchen
    pinsel.drawImage(quelle, 0, 0, canvas.width, canvas.height);

    // Kreis an den Werten, die der Attraktor gerade hat (zweimal: dunkel breit, hell schmal → auf jedem Grund sichtbar)
    if (!bereich) return;
    const s = stelleVon(aktuell().werte);
    if (s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1) return;
    for (const [farbeStrich, dicke] of [["#000", 4], ["#fff", 1.5]]) {
      pinsel.beginPath();
      pinsel.arc(s.x * canvas.width, s.y * canvas.height, 6 * dpr, 0, Math.PI * 2);
      pinsel.strokeStyle = farbeStrich;
      pinsel.lineWidth = dicke * dpr;
      pinsel.stroke();
    }
  }

  function zahl(v) {
    return Number(v.toPrecision(4)).toLocaleString("de-DE");
  }

  function zeigeLegende() {
    if (!bereich) return;
    const { xName, yName, xVon, xBis, yVon, yBis } = bereich;
    anzeige.textContent = `→ ${xName} von ${zahl(xVon)} bis ${zahl(xBis)} · ↑ ${yName} von ${zahl(yVon)} bis ${zahl(yBis)}. `
      + "Hell = Chaos, dunkelblau = Ruhe oder feste Runde, schwarz = läuft davon. Klick übernimmt die Werte.";
  }

  function stoppe() {
    rechner.forEach((r) => r.terminate()); // alte Rechnung abbrechen, sonst kämen ihre Zeilen in die neue Karte
    rechner = [];
  }

  function rechne() {
    stoppe();
    if (xWahl.options.length < 2) return; // nur ein Wert: keine Karte (siehe neuerTyp)
    const { typName: name, werte, start } = aktuell();
    const halb = Math.max(Number(bereichFeld.value) || 1, 0.001);
    const xName = xWahl.value;
    const yName = yWahl.value;
    bereich = {
      xName, yName,
      xVon: werte[xName] - halb, xBis: werte[xName] + halb,
      yVon: werte[yName] - halb, yBis: werte[yName] + halb,
    };
    veraltet = false;
    leere();
    zeigeLegende();
    zeichne();

    // Arbeitsliste in der Reihenfolge grob nach fein: [y, schritt]
    const auftraege = [];
    for (const schritt of STUFEN) {
      for (let y = 0; y < groesse; y += schritt) {
        if (schritt !== STUFEN[0] && y % (schritt * 2) === 0) continue; // in der Stufe davor schon dran
        auftraege.push([y, schritt]);
      }
    }
    const auftrag = { modul, typName: name, werte, start, ...bereich, groesse };

    // jeder Worker bekommt eine Zeile; ist er fertig, die nächste aus der Liste.
    // So sind alle beschäftigt, auch wenn manche Zeilen länger dauern (davonlaufende Punkte sind schnell fertig).
    for (let i = 0; i < ANZAHL_RECHNER; i++) {
      // type: "module", damit der Worker selbst import benutzen kann
      const worker = new Worker(new URL("./karten-rechner.js", import.meta.url), { type: "module" });
      const gibArbeit = () => {
        const naechster = auftraege.shift();
        if (!naechster) return;
        worker.schritt = naechster[1]; // merken, zu welcher Stufe die Zeile gehört
        worker.postMessage({ ...auftrag, y: naechster[0] });
      };
      worker.onmessage = ({ data }) => {
        nimmZeile(data.y, worker.schritt, data.zeile);
        gibArbeit();
      };
      rechner.push(worker);
      gibArbeit();
    }
  }

  // Wertepaar unter dem Zeiger
  function unterZeiger(event) {
    const rect = canvas.getBoundingClientRect();
    const sx = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 0.9999);
    const sy = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 0.9999);
    return {
      x: bereich.xVon + sx * (bereich.xBis - bereich.xVon),
      y: bereich.yBis - sy * (bereich.yBis - bereich.yVon),
      l: exponenten[Math.floor(sy * groesse) * groesse + Math.floor(sx * groesse)],
    };
  }

  canvas.addEventListener("pointermove", (event) => {
    if (!bereich) return;
    const { x, y, l } = unterZeiger(event);
    const grenze = skala * 0.03; // so nah an 0 gilt als Grenze (die Messung ist nie ganz genau)
    let art = "noch nicht gerechnet";
    if (l === Infinity) art = "läuft davon";
    else if (l > grenze) art = "Chaos";
    else if (l < -grenze) art = "Ruhe oder feste Runde";
    else if (Number.isFinite(l)) art = "an der Grenze";
    const wert = Number.isFinite(l) ? ` λ = ${l.toFixed(3)}` : "";
    anzeige.textContent = `${bereich.xName} = ${zahl(x)}, ${bereich.yName} = ${zahl(y)} ·${wert} (${art})`;
  });
  canvas.addEventListener("pointerleave", zeigeLegende);

  canvas.addEventListener("click", (event) => {
    if (!bereich) return;
    const { x, y } = unterZeiger(event);
    // auf 4 Nachkommastellen: genauer sieht man es nicht, und die Felder bleiben lesbar
    beiKlick({ [bereich.xName]: Number(x.toFixed(4)), [bereich.yName]: Number(y.toFixed(4)) });
    zeichne();
  });

  // dieselbe Achse zweimal ergibt keine Karte: dann die andere auf die alte Wahl tauschen
  let alteWahl = { x: null, y: null };
  function achseGewechselt(feld, anderes, schluessel, andererSchluessel) {
    if (feld.value === anderes.value) anderes.value = alteWahl[schluessel];
    alteWahl = { [schluessel]: feld.value, [andererSchluessel]: anderes.value };
    rechne();
  }
  xWahl.addEventListener("change", () => achseGewechselt(xWahl, yWahl, "x", "y"));
  yWahl.addEventListener("change", () => achseGewechselt(yWahl, xWahl, "y", "x"));
  bereichFeld.addEventListener("change", rechne);
  knopf.addEventListener("click", rechne);

  // erst rechnen, wenn jemand die Karte sehen will (sie kostet ein paar Sekunden Rechenzeit)
  abschnitt.addEventListener("toggle", () => {
    if (abschnitt.open && veraltet) rechne();
    else zeichne();
  });

  // neuer Typ oder neues Preset: Achsen passend füllen, Karte neu (sofort, wenn sie offen ist)
  function neuerTyp(name, parameter) {
    if (name !== typName) {
      typName = name;
      const optionen = () => parameter.map((p) => new Option(p, p));
      xWahl.replaceChildren(...optionen());
      yWahl.replaceChildren(...optionen());
      xWahl.value = parameter[0];
      yWahl.value = parameter[1] ?? parameter[0];
      alteWahl = { x: xWahl.value, y: yWahl.value };
    }
    stoppe();
    // eine Karte braucht zwei Achsen; Thomas, Halvorsen und Nose-Hoover haben nur einen Wert
    const genug = parameter.length >= 2;
    canvas.hidden = !genug;
    bereich = null;
    leere();
    if (!genug) {
      anzeige.textContent = "Dieser Attraktor hat nur einen Wert, eine Karte braucht zwei.";
      return;
    }
    veraltet = true;
    if (abschnitt.open) rechne();
  }

  new ResizeObserver(zeichne).observe(canvas); // breiteres Fenster: Canvas schärfer nachzeichnen
  leere();

  return { neuerTyp, zeichne };
}
