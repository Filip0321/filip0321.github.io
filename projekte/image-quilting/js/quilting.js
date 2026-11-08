// Image Quilting nach Efros und Freeman (2001): ein Bild aus Stücken eines anderen zusammennähen.
//
// 1. Das Ausgabebild wird Block für Block gefüllt (Zeile für Zeile), jeder Block B × B Pixel. Nachbarblöcke
//    überlappen um O Pixel.
// 2. Für jeden Block wird in der Quelle ein Stück gesucht, das dort, wo schon etwas steht (die Überlappung),
//    möglichst gut passt: Summe der quadrierten Farbunterschiede (SSD). Nicht immer das beste, sondern zufällig
//    eins der Stücke, die höchstens (1 + Toleranz) · bestes sind, sonst wiederholt sich dasselbe Stück.
// 3. In der Überlappung wird nicht gerade abgeschnitten, sondern entlang des Pfads mit dem kleinsten Fehler
//    (dynamische Programmierung): Zeile für Zeile E(y, x) = e(y, x) + min(E(y−1, x−1), E(y−1, x), E(y−1, x+1)),
//    am Ende vom kleinsten E zurückgehen. Links vom Pfad bleibt das Alte, rechts kommt das Neue. So läuft die
//    Naht dort, wo sich alt und neu ohnehin gleichen, und man sieht sie kaum.
// 4. Texturtransfer: zusätzlich soll das Stück in der Helligkeit zu einem Zielbild passen. Fehler =
//    α · Überlappung + (1 − α) · Abstand zum Ziel. Mehrere Durchgänge mit kleiner werdenden Blöcken, α steigt
//    (Efros und Freeman: α = 0,8 · i / (n − 1) + 0,1); ab dem zweiten Durchgang zählt auch, wie gut das Stück zum
//    Ergebnis des vorigen passt.
//
// Gesucht wird nicht an jeder Stelle der Quelle (das wären hunderttausende Stücke mit je tausend Pixeln pro
// Block), sondern an einer zufälligen Auswahl („Kandidaten“). Mehr Kandidaten: besser, langsamer.

// Helligkeit (für den Texturtransfer)
export function helligkeit(rgba, n) {
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return l;
}

// quelle: { b, h, rgba }; aus: { b, h, rgba } (wird beschrieben); bekannt: Uint8Array (b · h der Ausgabe, 1 = steht
// schon fest); bereich: { x0, y0, x1, y1 } was gefüllt wird; verboten: Uint8Array (b · h der Quelle, 1 = darf nicht
// in einem Stück vorkommen, z. B. das Rechteck selbst) oder null
// optionen: { B, O, kandidaten, toleranz, naht ("schnitt", "gerade", "keine"), rnd,
//             ziel: { quelle: Float32Array, aus: Float32Array } Helligkeiten für den Transfer oder null, alpha,
//             vorher: Uint8ClampedArray (Ergebnis des vorigen Durchgangs) oder null }
export function erstelleQuilt(quelle, aus, bekannt, bereich, verboten, optionen) {
  const { B, O, kandidaten, toleranz, naht, rnd, ziel = null, alpha = 1, vorher = null } = optionen;
  const qb = quelle.b, qh = quelle.h, q = quelle.rgba;
  const ab = aus.b, a = aus.rgba;

  // Summen über verboten (Integralbild): ob ein Stück verbotene Pixel enthält, in 4 Schritten statt b · h
  let integral = null;
  if (verboten) {
    integral = new Int32Array((qb + 1) * (qh + 1));
    for (let y = 0; y < qh; y++) {
      let zeile = 0;
      for (let x = 0; x < qb; x++) {
        zeile += verboten[x + y * qb];
        integral[x + 1 + (y + 1) * (qb + 1)] = integral[x + 1 + y * (qb + 1)] + zeile;
      }
    }
  }
  const frei = (sx, sy, w, h) => {
    if (!integral) return true;
    const W = qb + 1;
    return integral[sx + w + (sy + h) * W] - integral[sx + (sy + h) * W] - integral[sx + w + sy * W] + integral[sx + sy * W] === 0;
  };

  // Blockpositionen: von x0 − O in Schritten B − O, bis der Bereich bedeckt ist; die letzte Reihe und Spalte wird
  // so beschnitten, dass sie höchstens O über den Bereich hinausragt (dort steht schon etwas, die Naht entscheidet)
  const positionen = [];
  const schritt = B - O;
  const rand = (v0, v1, max) => {
    const liste = [];
    const start = v0 > 0 ? Math.max(0, v0 - O) : 0;
    const ende = Math.min(max, v1 + (v1 < max ? O : 0));
    for (let v = start; ; v += schritt) {
      const groesse = Math.min(B, ende - v);
      if (groesse <= 0) break;
      liste.push([v, groesse]);
      if (v + groesse >= ende) break;
    }
    return liste;
  };
  for (const [by, bh] of rand(bereich.y0, bereich.y1, aus.h)) {
    for (const [bx, bw] of rand(bereich.x0, bereich.x1, ab)) positionen.push({ bx, by, bw, bh });
  }

  let index = 0;
  const naehte = []; // Pixel der Nähte (Index in der Ausgabe), zum Zeigen

  // Fehler eines Stücks aus der Quelle an (sx, sy) für den Block; abbrechen, sobald er grenze übersteigt
  function fehler(p, sx, sy, grenze) {
    const { bx, by, bw, bh } = p;
    let summe = 0;
    let n = 0;
    let zielSumme = 0;
    let vorherSumme = 0;
    for (let y = 0; y < bh; y++) {
      const ay = (by + y) * ab;
      const qy = (sy + y) * qb;
      for (let x = 0; x < bw; x++) {
        const ai = ay + bx + x;
        const qi = qy + sx + x;
        if (bekannt[ai]) {
          const dr = a[ai * 4] - q[qi * 4], dg = a[ai * 4 + 1] - q[qi * 4 + 1], db = a[ai * 4 + 2] - q[qi * 4 + 2];
          summe += dr * dr + dg * dg + db * db;
          n++;
        }
        if (ziel) {
          const d = ziel.aus[ai] - ziel.quelle[qi];
          zielSumme += 3 * d * d; // · 3, damit es so viel zählt wie drei Farbkanäle
        }
        if (vorher) {
          const dr = vorher[ai * 4] - q[qi * 4], dg = vorher[ai * 4 + 1] - q[qi * 4 + 1], db = vorher[ai * 4 + 2] - q[qi * 4 + 2];
          vorherSumme += dr * dr + dg * dg + db * db;
        }
      }
      // früh aufhören, wenn schon klar zu schlecht (nur ohne Transfer, da wächst alles gleichmäßig)
      if (!ziel && !vorher && summe > grenze) return Infinity;
    }
    const flaeche = bw * bh;
    if (!ziel) return n ? summe / n : 0;
    const ueberlappung = (n ? summe / n : 0) + (vorher ? vorherSumme / flaeche : 0);
    return alpha * ueberlappung + (1 - alpha) * (zielSumme / flaeche);
  }

  // Pfad mit kleinstem Fehler durch ein Fehlerfeld e (laenge Zeilen × breite Spalten); gibt je Zeile die Spalte
  function kleinsterPfad(e, laenge, breite) {
    const E = new Float64Array(laenge * breite);
    for (let x = 0; x < breite; x++) E[x] = e[x];
    for (let y = 1; y < laenge; y++) {
      for (let x = 0; x < breite; x++) {
        let m = E[(y - 1) * breite + x];
        if (x > 0) m = Math.min(m, E[(y - 1) * breite + x - 1]);
        if (x < breite - 1) m = Math.min(m, E[(y - 1) * breite + x + 1]);
        E[y * breite + x] = e[y * breite + x] + m;
      }
    }
    const pfad = new Int32Array(laenge);
    let beste = 0;
    for (let x = 1; x < breite; x++) if (E[(laenge - 1) * breite + x] < E[(laenge - 1) * breite + beste]) beste = x;
    pfad[laenge - 1] = beste;
    for (let y = laenge - 2; y >= 0; y--) {
      const x = pfad[y + 1];
      let wahl = x;
      if (x > 0 && E[y * breite + x - 1] < E[y * breite + wahl]) wahl = x - 1;
      if (x < breite - 1 && E[y * breite + x + 1] < E[y * breite + wahl]) wahl = x + 1;
      pfad[y] = wahl;
    }
    return pfad;
  }

  // einen Block setzen; gibt false, wenn nichts mehr zu tun ist
  function weiter() {
    if (index >= positionen.length) return false;
    const p = positionen[index++];
    const { bx, by, bw, bh } = p;

    // Kandidaten: zufällige Stellen in der Quelle, an denen das Stück ganz hineinpasst und nichts Verbotenes hat
    const maxX = qb - bw;
    const maxY = qh - bh;
    if (maxX < 0 || maxY < 0) return true; // Quelle kleiner als der Block (die Seite verhindert das)
    const fehlerListe = [];
    let bester = Infinity;
    for (let k = 0, versuche = 0; k < kandidaten && versuche < kandidaten * 4; versuche++) {
      const sx = Math.floor(rnd() * (maxX + 1));
      const sy = Math.floor(rnd() * (maxY + 1));
      if (!frei(sx, sy, bw, bh)) continue;
      k++;
      const f = fehler(p, sx, sy, bester * (1 + toleranz) * (bw * bh));
      if (f < bester) bester = f;
      fehlerListe.push([f, sx, sy]);
    }
    if (!fehlerListe.length) return true;
    const gut = fehlerListe.filter(([f]) => f <= bester * (1 + toleranz) + 1e-9);
    const [, sx, sy] = gut[Math.floor(rnd() * gut.length)];

    // welche Pixel neu werden: unbekannte immer; bekannte nur in einer Überlappung und auf der neuen Seite jeder Naht
    const neu = new Uint8Array(bw * bh);
    const inNaht = new Uint8Array(bw * bh); // 1 = liegt in einer Überlappung
    const altBleibt = new Uint8Array(bw * bh); // 1 = eine Naht sagt: hier bleibt das Alte
    const e = (x, y) => {
      const ai = (by + y) * ab + bx + x;
      if (!bekannt[ai]) return 0;
      const qi = (sy + y) * qb + sx + x;
      const dr = a[ai * 4] - q[qi * 4], dg = a[ai * 4 + 1] - q[qi * 4 + 1], db = a[ai * 4 + 2] - q[qi * 4 + 2];
      return dr * dr + dg * dg + db * db;
    };
    const bekanntIn = (x0, y0, w, h) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (bekannt[(by + y) * ab + bx + x]) return true;
      return false;
    };
    const o = Math.min(O, bw, bh);
    // vier Seiten: senkrechte Nähte (links, rechts) laufen von oben nach unten, waagerechte (oben, unten) von links
    // nach rechts. altSeite(stelle, pfad): ob diese Stelle auf der alten Seite liegt
    const seiten = [
      { senkrecht: true, x0: 0, y0: 0, w: o, h: bh, alt: (s, k) => s < k },
      { senkrecht: true, x0: bw - o, y0: 0, w: o, h: bh, alt: (s, k) => s > k },
      { senkrecht: false, x0: 0, y0: 0, w: bw, h: o, alt: (s, k) => s < k },
      { senkrecht: false, x0: 0, y0: bh - o, w: bw, h: o, alt: (s, k) => s > k },
    ];
    for (const seite of seiten) {
      if (o <= 0 || !bekanntIn(seite.x0, seite.y0, seite.w, seite.h)) continue;
      const laenge = seite.senkrecht ? seite.h : seite.w;
      const breite = o;
      // Fehlerfeld in Pfad-Koordinaten: Zeile = entlang der Naht, Spalte = quer (0 bis o − 1)
      const feld = new Float64Array(laenge * breite);
      for (let l = 0; l < laenge; l++) {
        for (let s = 0; s < breite; s++) {
          const x = seite.senkrecht ? seite.x0 + s : l;
          const y = seite.senkrecht ? l : seite.y0 + s;
          feld[l * breite + s] = e(x, y);
        }
      }
      let pfad;
      if (naht === "schnitt") pfad = kleinsterPfad(feld, laenge, breite);
      else pfad = new Int32Array(laenge).fill(naht === "gerade" ? Math.floor(breite / 2) : (seite.alt(0, 1) ? 0 : breite - 1));
      for (let l = 0; l < laenge; l++) {
        for (let s = 0; s < breite; s++) {
          const x = seite.senkrecht ? seite.x0 + s : l;
          const y = seite.senkrecht ? l : seite.y0 + s;
          const i = x + y * bw;
          inNaht[i] = 1;
          if (naht !== "keine" && seite.alt(s, pfad[l])) altBleibt[i] = 1;
          if (s === pfad[l] && naht !== "keine") naehte.push((by + y) * ab + bx + x);
        }
      }
    }
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = x + y * bw;
        const ai = (by + y) * ab + bx + x;
        neu[i] = !bekannt[ai] || (inNaht[i] && !altBleibt[i]) ? 1 : 0;
      }
    }
    // einsetzen
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (!neu[x + y * bw]) continue;
        const ai = (by + y) * ab + bx + x;
        const qi = (sy + y) * qb + sx + x;
        a[ai * 4] = q[qi * 4];
        a[ai * 4 + 1] = q[qi * 4 + 1];
        a[ai * 4 + 2] = q[qi * 4 + 2];
        a[ai * 4 + 3] = 255;
        bekannt[ai] = 1;
      }
    }
    return index < positionen.length;
  }

  return {
    weiter,
    naehte,
    get fortschritt() { return positionen.length ? index / positionen.length : 1; },
    get fertig() { return index >= positionen.length; },
    anzahl: positionen.length,
  };
}
