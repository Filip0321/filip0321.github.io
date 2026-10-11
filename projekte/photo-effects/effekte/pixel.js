// beim verpixeln braucht es zwei Schritte
// zuerst verkleinern, pixeliger machen
// dann vergrößern, dass sich die maße nicht ändern, man es sieht und es scharf bleibt

// Schritt 1: Verkleinern

export function verkleinern(eingabe, groesse) {
  const w = eingabe.width;
  const h = eingabe.height;
  const ein = eingabe.data;
  const kw = Math.ceil(w / groesse); // kleiner machen um ein vielfaches
  const kh = Math.ceil(h / groesse);
  const ausgabe = new ImageData(kw, kh);
  const aus = ausgabe.data;

  for (let ky = 0; ky < kh; ky++) {
    for (let kx = 0; kx < kw; kx++) {
      const startX = kx * groesse; // Ein quadrat an Pixeln wird zu einem. Dafür bestimmt man hier
      const startY = ky * groesse; // die Startposition dieses quadrates (im Original natürlich, deswegen * größe wieder)
      const bw = Math.min(groesse, w - startX); // der zweite Fall tritt nur ganz am Ende ein
      const bh = Math.min(groesse, h - startY); // die größe der Seite des quadrates zum kleinern

      let r = 0; // Farbwert aller pixel des quadrates
      let g = 0;
      let b = 0;
      let a = 0;

      for (let y = startY; y < startY + bh; y++) {
        for (let x = startX; x < startX + bw; x++) {
          const i = (y * w + x) * 4;
          r += ein[i]; // den Farbwert der pixel in dem zusammenzufassenden Quadrat zusammenaddieren
          g += ein[i + 1];
          b += ein[i + 2];
          a += ein[i + 3];
        }
      }

      const anzahl = bw * bh; // anzahl der Pixel die zusammengefasst werden
      const k = (ky * kw + kx) * 4; // die for-schleife geht über x, hier muss man die index * 4 für die Farbwerte
      aus[k] = r / anzahl; // den Farbwert averagen über das Quadrat um den Pixelfarbwert zu bestimmen
      aus[k + 1] = g / anzahl;
      aus[k + 2] = b / anzahl;
      aus[k + 3] = a / anzahl;
    }
  }

  return ausgabe;
}

// Schritt 2: Vergrößern

export function vergroessern(klein, groesse, w, h) {
  const ein = klein.data;
  const kw = klein.width;
  const ausgabe = new ImageData(w, h);
  const aus = ausgabe.data;

  for (let y = 0; y < h; y++) {
    const ky = Math.floor(y / groesse);
    for (let x = 0; x < w; x++) {
      const kx = Math.floor(x / groesse);
      const k = (ky * kw + kx) * 4; // bleibt für die größe des ursprünglichen Quadrates gleich
      // (jetzt ein Pixel der um den Faktor vergrößert wird)
      const i = (y * w + x) * 4; // verändert sich während das kleine gleich bleibt
      // denn ein pixel vom kleinen muss über mehrere im original gestreckt werden
      aus[i] = ein[k];
      aus[i + 1] = ein[k + 1];
      aus[i + 2] = ein[k + 2];
      aus[i + 3] = ein[k + 3];
    }
  }

  return ausgabe;
}

// Dithering (Floyd-Steinberg)

export function dithern(eingabe, stufen, grau) {
  const w = eingabe.width;
  const h = eingabe.height;
  const ein = eingabe.data;
  const kanaele = grau ? 1 : 3; // entweder halt 3 Farbkanäle wenn Farbe, oder einen wenns eben grau ist
  const werteDither = new Float32Array(w * h * kanaele); // Array für alle Farbwerte aller pixel

  for (let i = 0; i < w * h; i++) {
    const r = ein[i * 4]; // alle Farbwerte der pixel jeweils pro schleife kurz speichern und anschauen
    const g = ein[i * 4 + 1]; // * 4, weil die eingabe auch einen alphachannel hat
    const b = ein[i * 4 + 2];
    if (grau) {
      werteDither[i] = 0.299 * r + 0.587 * g + 0.114 * b; // wenn grau dann hats nur ein Kanal und alle
      // Farbkanäle werden zusammengemischt
      // Das Auge nimmt grün stärker war...
    } else {
      werteDither[i * 3] = r; // * 3, weil der alphachannel nicht verändert werden soll
      werteDither[i * 3 + 1] = g;
      werteDither[i * 3 + 2] = b;
    }
  }

  const abstand = 255 / (stufen - 1); // wieviele abstufungen zwischen 0 und 255

  function verteile(x, y, k, fehler, anteil) {
    if (x < 0 || x >= w || y >= h) return;
    werteDither[(y * w + x) * kanaele + k] += fehler * anteil;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < kanaele; k++) {
        const i = (y * w + x) * kanaele + k; // so wurde die liste initialisiert (werteDither)
        const alt = werteDither[i]; // der alte wert in der Liste nehm ich schleife für schleife neu
        const neu = Math.min(
          255,
          Math.max(0, Math.round(alt / abstand) * abstand),
        ); // bring den Wert in die
        // richtige Abstufung
        werteDither[i] = neu;

        const fehler = alt - neu; // passte der alte Wert nicht genau in die Abstufung
        verteile(x + 1, y, k, fehler, 7 / 16);
        verteile(x - 1, y + 1, k, fehler, 3 / 16);
        verteile(x, y + 1, k, fehler, 5 / 16);
        verteile(x + 1, y + 1, k, fehler, 1 / 16);
        // der Wert wird auf die Kanalwerte der Pixel rechts und die drei in der nächsten Reihe verteilt
      }
    }
  }

  const ausgabe = new ImageData(w, h);
  const aus = ausgabe.data;

  for (let i = 0; i < w * h; i++) {
    if (grau) {
      aus[i * 4] = werteDither[i];
      aus[i * 4 + 1] = werteDither[i];
      aus[i * 4 + 2] = werteDither[i];
    } else {
      aus[i * 4] = werteDither[i * 3];
      aus[i * 4 + 1] = werteDither[i * 3 + 1];
      aus[i * 4 + 2] = werteDither[i * 3 + 2];
    }
    aus[i * 4 + 3] = ein[i * 4 + 3]; // alpha bleibt gleich
  }

  return ausgabe;
}

