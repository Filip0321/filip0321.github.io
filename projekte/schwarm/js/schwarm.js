// Schwarm (Boids, Craig Reynolds 1987): kein Vogel kennt den Schwarm. Jeder sieht nur seine Nachbarn und folgt drei
// Regeln; die Form des Ganzen (Wolken von Staren, kreisende Fischschwärme) entsteht von selbst.
//
//   Trennung        weg von Nachbarn, die zu nah sind (gewichtet mit 1 / Abstand: je näher, desto stärker)
//   Ausrichtung     in dieselbe Richtung fliegen wie die Nachbarn (ihre mittlere Geschwindigkeit)
//   Zusammenhalt    zur Mitte der Nachbarn hin
//
// Jede Regel ergibt eine Wunschrichtung. Daraus wird eine Lenkkraft wie bei Reynolds („steering“):
//   Kraft = begrenzt( Wunschrichtung auf Höchsttempo gebracht − jetzige Geschwindigkeit, auf „Kraft“ )
// Die gewichtete Summe der drei Kräfte ändert die Geschwindigkeit, die Geschwindigkeit die Lage (Euler-Schritt).
//
// Wer ist Nachbar?
//   metrisch     alle im Umkreis „Sichtweite“ (Reynolds)
//   topologisch  die k nächsten, egal wie weit (k = 7). So machen es echte Stare: Ballerini u. a. (2008) haben in
//                Rom 3D-Fotos von Schwärmen ausgewertet; jeder Vogel richtet sich nach etwa 6 bis 7 Nachbarn, auch
//                wenn der Schwarm dünner oder dichter wird. Darum reißt ein Starenschwarm nicht so leicht auseinander.
// Blickwinkel: Nachbarn direkt hinter einem zählen nicht (bei 270° ist ein toter Winkel von 90° im Rücken).
//
// Schnell genug für Tausende: wer neben wem ist, steht in einem Gitter aus Zellen von der Größe der Sichtweite
// (räumliches Hashing). Jeder schaut nur in seine Zelle und die 8 Nachbarzellen statt alle n anzusehen: n · k statt n².
// Das Gitter ist eine verkettete Liste in zwei Zahlen-Arrays: kopf[zelle] = erster Vogel darin, weiter[i] = nächster.

export function erstelleSchwarm(maxAnzahl = 20000) {
  const x = new Float32Array(maxAnzahl), y = new Float32Array(maxAnzahl);
  const vx = new Float32Array(maxAnzahl), vy = new Float32Array(maxAnzahl);
  const weiter = new Int32Array(maxAnzahl);
  let kopf = new Int32Array(1), spalten = 1, zeilen = 1, zelle = 1;
  let n = 0, B = 1, H = 1;
  // für die topologische Suche: Kandidaten (Abstand², Index), wiederverwendet
  const kandAbstand = new Float32Array(512), kandIndex = new Int32Array(512);

  function neu(anzahl, breite, hoehe, zufall = Math.random) {
    n = Math.min(anzahl, maxAnzahl);
    B = breite;
    H = hoehe;
    for (let i = 0; i < n; i++) {
      x[i] = zufall() * B;
      y[i] = zufall() * H;
      const w = zufall() * Math.PI * 2;
      vx[i] = Math.cos(w) * 60;
      vy[i] = Math.sin(w) * 60;
    }
  }

  // Abstand mit Torus (wer rechts hinausfliegt, kommt links wieder herein): der kürzere Weg um die Welt
  const wickel = (d, L, torus) => (torus ? d - L * Math.round(d / L) : d);

  function baueGitter(groesse) {
    zelle = Math.max(4, groesse);
    spalten = Math.max(1, Math.ceil(B / zelle));
    zeilen = Math.max(1, Math.ceil(H / zelle));
    if (kopf.length < spalten * zeilen) kopf = new Int32Array(spalten * zeilen);
    kopf.fill(-1, 0, spalten * zeilen);
    for (let i = 0; i < n; i++) {
      const cx = Math.min(spalten - 1, Math.max(0, Math.floor(x[i] / zelle)));
      const cy = Math.min(zeilen - 1, Math.max(0, Math.floor(y[i] / zelle)));
      const c = cy * spalten + cx;
      weiter[i] = kopf[c];
      kopf[c] = i;
    }
  }

  // r: Regeln { sicht, abstand, trennung, ausrichtung, zusammenhalt, vmax, vmin, kraft, blick (Grad), topologisch, k,
  //             torus, zittern }
  // stoerer: [{ x, y, art: "jagen" | "locken", radius, staerke }]   waende: [[x1, y1, x2, y2], …]
  function schritt(dt, r, stoerer = [], waende = []) {
    baueGitter(r.topologisch ? r.sicht * 0.75 : r.sicht);
    const sicht2 = r.sicht * r.sicht, abstand2 = r.abstand * r.abstand;
    const blickCos = Math.cos(((r.blick / 2) * Math.PI) / 180);
    const ax = new Float32Array(n), ay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const sp = Math.hypot(vx[i], vy[i]) || 1, rx = vx[i] / sp, ry = vy[i] / sp; // Blickrichtung
      let anzahl = 0, sx = 0, sy = 0, avx = 0, avy = 0, mx = 0, my = 0;
      let kn = 0;
      const cx = Math.floor(x[i] / zelle), cy = Math.floor(y[i] / zelle);
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          let zx = cx + ox, zy = cy + oy;
          if (r.torus) {
            zx = (zx + spalten) % spalten;
            zy = (zy + zeilen) % zeilen;
          } else if (zx < 0 || zy < 0 || zx >= spalten || zy >= zeilen) continue;
          for (let j = kopf[zy * spalten + zx]; j !== -1; j = weiter[j]) {
            if (j === i) continue;
            const dx = wickel(x[j] - x[i], B, r.torus), dy = wickel(y[j] - y[i], H, r.torus);
            const d2 = dx * dx + dy * dy;
            if (!r.topologisch && d2 > sicht2) continue;
            if (d2 > 1e-6 && r.blick < 360) {
              const cosw = (dx * rx + dy * ry) / Math.sqrt(d2);
              if (cosw < blickCos) continue; // im toten Winkel
            }
            if (r.topologisch) {
              if (kn < kandAbstand.length) {
                kandAbstand[kn] = d2;
                kandIndex[kn] = j;
                kn++;
              }
              continue;
            }
            anzahl++;
            avx += vx[j];
            avy += vy[j];
            mx += dx;
            my += dy;
            if (d2 < abstand2 && d2 > 1e-6) {
              sx -= dx / d2;
              sy -= dy / d2;
            }
          }
        }
      if (r.topologisch && kn) {
        // die k nächsten: teilweise sortieren (k ist klein, Auswahl durch k Durchläufe reicht)
        const k = Math.min(r.k, kn);
        for (let a = 0; a < k; a++) {
          let best = a;
          for (let b = a + 1; b < kn; b++) if (kandAbstand[b] < kandAbstand[best]) best = b;
          [kandAbstand[a], kandAbstand[best]] = [kandAbstand[best], kandAbstand[a]];
          [kandIndex[a], kandIndex[best]] = [kandIndex[best], kandIndex[a]];
          const j = kandIndex[a], d2 = kandAbstand[a];
          const dx = wickel(x[j] - x[i], B, r.torus), dy = wickel(y[j] - y[i], H, r.torus);
          anzahl++;
          avx += vx[j];
          avy += vy[j];
          mx += dx;
          my += dy;
          if (d2 < abstand2 && d2 > 1e-6) {
            sx -= dx / d2;
            sy -= dy / d2;
          }
        }
      }
      // Lenkkraft: Wunschrichtung auf vmax bringen, jetzige Geschwindigkeit abziehen, auf „kraft“ begrenzen
      const lenke = (dx, dy, w) => {
        const l = Math.hypot(dx, dy);
        if (l < 1e-9 || w === 0) return;
        let fx = (dx / l) * r.vmax - vx[i], fy = (dy / l) * r.vmax - vy[i];
        const fl = Math.hypot(fx, fy);
        if (fl > r.kraft) {
          fx *= r.kraft / fl;
          fy *= r.kraft / fl;
        }
        ax[i] += fx * w;
        ay[i] += fy * w;
      };
      if (anzahl) {
        lenke(sx, sy, r.trennung);
        lenke(avx / anzahl, avy / anzahl, r.ausrichtung);
        lenke(mx / anzahl, my / anzahl, r.zusammenhalt);
      }
      // Störer (Maus, Musik): Raubvogel = Flucht, je näher desto stärker; Futter = hin
      for (const s of stoerer) {
        const dx = wickel(s.x - x[i], B, r.torus), dy = wickel(s.y - y[i], H, r.torus), d = Math.hypot(dx, dy);
        if (d > s.radius || d < 1e-6) continue;
        const nah = 1 - d / s.radius;
        lenke(s.art === "jagen" ? -dx : dx, s.art === "jagen" ? -dy : dy, s.staerke * (s.art === "jagen" ? 3 * nah : nah));
      }
      // Wände: im Abstand „sicht“ vor einer Wand von ihr weg lenken (nächster Punkt auf der Strecke)
      for (const [x1, y1, x2, y2] of waende) {
        const wx = x2 - x1, wy = y2 - y1, l2 = wx * wx + wy * wy || 1;
        const t = Math.min(1, Math.max(0, ((x[i] - x1) * wx + (y[i] - y1) * wy) / l2));
        const dx = x[i] - (x1 + t * wx), dy = y[i] - (y1 + t * wy), d = Math.hypot(dx, dy);
        if (d < r.sicht && d > 1e-6) lenke(dx, dy, 4 * (1 - d / r.sicht));
      }
      // ohne Torus: weich am Rand umkehren
      if (!r.torus) {
        const rand = Math.min(B, H) * 0.08;
        if (x[i] < rand) lenke(1, 0, 2 * (1 - x[i] / rand));
        if (x[i] > B - rand) lenke(-1, 0, 2 * (1 - (B - x[i]) / rand));
        if (y[i] < rand) lenke(0, 1, 2 * (1 - y[i] / rand));
        if (y[i] > H - rand) lenke(0, -1, 2 * (1 - (H - y[i]) / rand));
      }
      // Zittern: ein bisschen Zufall (Mücken haben viel davon)
      if (r.zittern) {
        ax[i] += (Math.random() - 0.5) * r.zittern * r.kraft * 4;
        ay[i] += (Math.random() - 0.5) * r.zittern * r.kraft * 4;
      }
    }
    // alle gleichzeitig weiterbewegen (sonst sähe Vogel 500 schon die neue Lage von Vogel 3)
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * dt;
      vy[i] += ay[i] * dt;
      const sp = Math.hypot(vx[i], vy[i]);
      const ziel = Math.min(r.vmax, Math.max(r.vmin, sp));
      if (sp > 1e-6 && sp !== ziel) {
        vx[i] *= ziel / sp;
        vy[i] *= ziel / sp;
      }
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      if (r.torus) {
        x[i] = ((x[i] % B) + B) % B;
        y[i] = ((y[i] % H) + H) % H;
      } else {
        x[i] = Math.min(B, Math.max(0, x[i]));
        y[i] = Math.min(H, Math.max(0, y[i]));
      }
    }
  }

  // Kennzahlen für Ton und Patch-Wand: mittleres Tempo, Ordnung (wie gleich alle fliegen, 0 … 1: Länge der mittleren
  // Richtung), Mitte des Schwarms
  function messe() {
    let sp = 0, rx = 0, ry = 0, mx = 0, my = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.hypot(vx[i], vy[i]) || 1;
      sp += s;
      rx += vx[i] / s;
      ry += vy[i] / s;
      mx += x[i];
      my += y[i];
    }
    const k = n || 1;
    return { tempo: sp / k, ordnung: Math.hypot(rx, ry) / k, mitteX: mx / k / B, mitteY: my / k / H };
  }

  function sichere() {
    const kopie = [x, y, vx, vy].map((a) => a.slice(0, n)), alt = { n, B, H };
    return () => {
      ({ n, B, H } = alt);
      [x, y, vx, vy].forEach((a, i) => a.set(kopie[i]));
    };
  }

  return {
    neu, schritt, messe, sichere, x, y, vx, vy,
    get n() { return n; },
    groesse(b, h) {
      // Lage mitstrecken, wenn das Feld seine Größe ändert
      for (let i = 0; i < n; i++) {
        x[i] *= b / B;
        y[i] *= h / H;
      }
      B = b;
      H = h;
    },
  };
}
