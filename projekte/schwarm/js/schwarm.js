// Schwarm (Boids): kontinuierliche Positionen, Nachbarsuche über einen k-d-Baum.
// Anders als ein Zellgitter werden die Positionen nicht in Kacheln eingeteilt oder gerundet.
// Der Baum wird pro Simulationsschritt aus den aktuellen Positionen aufgebaut und dient nur dazu,
// nahe Vögel schneller zu finden. Die eigentliche Bewegung bleibt vollständig kontinuierlich.

export function erstelleSchwarm(maxAnzahl = 50000) {
  const x = new Float32Array(maxAnzahl), y = new Float32Array(maxAnzahl);
  const vx = new Float32Array(maxAnzahl), vy = new Float32Array(maxAnzahl);
  const ax = new Float32Array(maxAnzahl), ay = new Float32Array(maxAnzahl);
  const lokaleDichte = new Float32Array(maxAnzahl);

  // Ein k-d-Baum speichert nur Indizes. Die Vogelpositionen bleiben in x/y unverändert.
  const reihenfolge = new Uint32Array(maxAnzahl);
  const links = new Int32Array(maxAnzahl), rechts = new Int32Array(maxAnzahl);
  const achse = new Uint8Array(maxAnzahl);
  const heapDistanz = new Float64Array(64), heapIndex = new Int32Array(64);
  let heapAnzahl = 0;
  let wurzel = -1;
  let n = 0, B = 1, H = 1;
  let aktiverIndex = 0, aktivesRegelwerk = null;

  const wert = (index, a) => a === 0 ? x[index] : y[index];
  const wickel = (d, laenge, torus) => torus ? d - laenge * Math.round(d / laenge) : d;

  function waehleMedian(lo, hi, mitte, a) {
    let linksRand = lo, rechtsRand = hi;
    while (linksRand < rechtsRand) {
      const pivot = wert(reihenfolge[(linksRand + rechtsRand) >> 1], a);
      let i = linksRand, j = rechtsRand;
      while (i <= j) {
        while (i <= rechtsRand && wert(reihenfolge[i], a) < pivot) i++;
        while (j >= linksRand && wert(reihenfolge[j], a) > pivot) j--;
        if (i <= j) {
          const temp = reihenfolge[i];
          reihenfolge[i] = reihenfolge[j];
          reihenfolge[j] = temp;
          i++; j--;
        }
      }
      if (mitte <= j) rechtsRand = j;
      else if (mitte >= i) linksRand = i;
      else break;
    }
  }

  function baueKnoten(lo, hi, tiefe) {
    if (lo > hi) return -1;
    const mitte = (lo + hi) >> 1;
    const a = tiefe & 1;
    waehleMedian(lo, hi, mitte, a);
    achse[mitte] = a;
    links[mitte] = baueKnoten(lo, mitte - 1, tiefe + 1);
    rechts[mitte] = baueKnoten(mitte + 1, hi, tiefe + 1);
    return mitte;
  }

  function baueBaum() {
    for (let i = 0; i < n; i++) reihenfolge[i] = i;
    wurzel = n ? baueKnoten(0, n - 1, 0) : -1;
  }

  // Kleinster Abstand eines Abfragepunkts zu einem Baum-Rechteck.
  // Die zirkuläre Distanz wird berücksichtigt, wenn der Randmodus Torus aktiv ist.
  function abstandIntervall(q, lo, hi, laenge, torus) {
    if (q >= lo && q <= hi) return 0;
    let a = Math.abs(q - lo), b = Math.abs(q - hi);
    if (torus) {
      a = Math.min(a, laenge - a);
      b = Math.min(b, laenge - b);
    }
    const d = Math.min(a, b);
    return d * d;
  }

  function rechteckAbstand(qx, qy, loX, hiX, loY, hiY, torus) {
    return abstandIntervall(qx, loX, hiX, B, torus) + abstandIntervall(qy, loY, hiY, H, torus);
  }

  function heapEinfuegen(j, d2, k) {
    if (heapAnzahl < k) {
      let i = heapAnzahl++;
      while (i > 0) {
        const eltern = (i - 1) >> 1;
        if (heapDistanz[eltern] >= d2) break;
        heapDistanz[i] = heapDistanz[eltern];
        heapIndex[i] = heapIndex[eltern];
        i = eltern;
      }
      heapDistanz[i] = d2;
      heapIndex[i] = j;
      return;
    }
    if (d2 >= heapDistanz[0]) return;
    let i = 0;
    while (true) {
      let kind = i * 2 + 1;
      if (kind >= heapAnzahl) break;
      if (kind + 1 < heapAnzahl && heapDistanz[kind + 1] > heapDistanz[kind]) kind++;
      if (heapDistanz[kind] <= d2) break;
      heapDistanz[i] = heapDistanz[kind];
      heapIndex[i] = heapIndex[kind];
      i = kind;
    }
    heapDistanz[i] = d2;
    heapIndex[i] = j;
  }

  let qx = 0, qy = 0, qrx = 1, qry = 0, qIndex = -1;
  let suchK = 7, suchTorus = true, suchBlickCos = -1, suchRadius2 = 0;
  let treffer = 0, sumX = 0, sumY = 0, sumVx = 0, sumVy = 0, sumTrennungX = 0, sumTrennungY = 0, sumDistanz = 0;

  function pruefeBlick(dx, dy, d2) {
    if (d2 <= 1e-6 || suchBlickCos <= -1) return true;
    return (dx * qrx + dy * qry) / Math.sqrt(d2) >= suchBlickCos;
  }

  function zaehleNachbar(j, dx, dy, d2) {
    treffer++;
    sumVx += vx[j]; sumVy += vy[j];
    sumX += dx; sumY += dy;
    sumDistanz += Math.sqrt(d2);
    const abstand2 = aktivesRegelwerk.abstand * aktivesRegelwerk.abstand;
    if (d2 < abstand2 && d2 > 1e-6) {
      sumTrennungX -= dx / d2;
      sumTrennungY -= dy / d2;
    }
  }

  function sucheKNearest(knoten, loX, hiX, loY, hiY) {
    if (knoten < 0) return;
    const j = reihenfolge[knoten];
    if (j !== qIndex) {
      const dx = wickel(x[j] - qx, B, suchTorus), dy = wickel(y[j] - qy, H, suchTorus);
      const d2 = dx * dx + dy * dy;
      if (pruefeBlick(dx, dy, d2)) heapEinfuegen(j, d2, suchK);
    }

    const a = achse[knoten], split = wert(j, a);
    let lLoX = loX, lHiX = hiX, lLoY = loY, lHiY = hiY;
    let rLoX = loX, rHiX = hiX, rLoY = loY, rHiY = hiY;
    if (a === 0) { lHiX = split; rLoX = split; }
    else { lHiY = split; rLoY = split; }

    const l = links[knoten], r = rechts[knoten];
    const ld = l < 0 ? Infinity : rechteckAbstand(qx, qy, lLoX, lHiX, lLoY, lHiY, suchTorus);
    const rd = r < 0 ? Infinity : rechteckAbstand(qx, qy, rLoX, rHiX, rLoY, rHiY, suchTorus);
    let grenze = heapAnzahl < suchK ? Infinity : heapDistanz[0];
    if (ld <= rd) {
      if (ld <= grenze) sucheKNearest(l, lLoX, lHiX, lLoY, lHiY);
      grenze = heapAnzahl < suchK ? Infinity : heapDistanz[0];
      if (rd <= grenze) sucheKNearest(r, rLoX, rHiX, rLoY, rHiY);
    } else {
      if (rd <= grenze) sucheKNearest(r, rLoX, rHiX, rLoY, rHiY);
      grenze = heapAnzahl < suchK ? Infinity : heapDistanz[0];
      if (ld <= grenze) sucheKNearest(l, lLoX, lHiX, lLoY, lHiY);
    }
  }

  function sucheImRadius(knoten, loX, hiX, loY, hiY) {
    if (knoten < 0) return;
    const j = reihenfolge[knoten];
    if (j !== qIndex) {
      const dx = wickel(x[j] - qx, B, suchTorus), dy = wickel(y[j] - qy, H, suchTorus);
      const d2 = dx * dx + dy * dy;
      if (d2 <= suchRadius2 && pruefeBlick(dx, dy, d2)) zaehleNachbar(j, dx, dy, d2);
    }

    const a = achse[knoten], split = wert(j, a);
    let lLoX = loX, lHiX = hiX, lLoY = loY, lHiY = hiY;
    let rLoX = loX, rHiX = hiX, rLoY = loY, rHiY = hiY;
    if (a === 0) { lHiX = split; rLoX = split; }
    else { lHiY = split; rLoY = split; }
    const l = links[knoten], r = rechts[knoten];
    if (l >= 0 && rechteckAbstand(qx, qy, lLoX, lHiX, lLoY, lHiY, suchTorus) <= suchRadius2)
      sucheImRadius(l, lLoX, lHiX, lLoY, lHiY);
    if (r >= 0 && rechteckAbstand(qx, qy, rLoX, rHiX, rLoY, rHiY, suchTorus) <= suchRadius2)
      sucheImRadius(r, rLoX, rHiX, rLoY, rHiY);
  }

  function neu(anzahl, breite, hoehe, zufall = Math.random) {
    n = Math.max(1, Math.min(Math.floor(anzahl), maxAnzahl));
    B = breite; H = hoehe;
    for (let i = 0; i < n; i++) {
      x[i] = zufall() * B;
      y[i] = zufall() * H;
      const w = zufall() * Math.PI * 2;
      vx[i] = Math.cos(w) * 60;
      vy[i] = Math.sin(w) * 60;
      lokaleDichte[i] = 0;
    }
  }

  function lenke(dx, dy, gewicht) {
    if (gewicht === 0) return;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) return;
    const r = aktivesRegelwerk;
    let fx = (dx / l) * r.vmax - vx[aktiverIndex];
    let fy = (dy / l) * r.vmax - vy[aktiverIndex];
    const fl = Math.hypot(fx, fy);
    if (fl > r.kraft) { fx *= r.kraft / fl; fy *= r.kraft / fl; }
    ax[aktiverIndex] += fx * gewicht;
    ay[aktiverIndex] += fy * gewicht;
  }

  // r: Regeln { sicht, abstand, trennung, ausrichtung, zusammenhalt, vmax, vmin, kraft, blick, topologisch, k, torus, zittern }
  // stoerer: [{ x, y, art: "jagen" | "locken", radius, staerke }], waende: [[x1,y1,x2,y2], ...]
  function schritt(dt, r, stoerer = [], waende = []) {
    if (!n) return;
    aktivesRegelwerk = r;
    baueBaum();
    ax.fill(0, 0, n); ay.fill(0, 0, n);
    const sicht2 = r.sicht * r.sicht;
    suchTorus = !!r.torus;
    suchBlickCos = r.blick < 360 ? Math.cos((r.blick * Math.PI) / 360) : -1;
    suchRadius2 = sicht2;
    suchK = Math.max(1, Math.min(64, r.k || 7));

    for (let i = 0; i < n; i++) {
      aktiverIndex = i;
      const sp = Math.hypot(vx[i], vy[i]) || 1;
      qrx = vx[i] / sp; qry = vy[i] / sp;
      qx = x[i]; qy = y[i]; qIndex = i;
      treffer = 0; sumX = 0; sumY = 0; sumVx = 0; sumVy = 0;
      sumTrennungX = 0; sumTrennungY = 0; sumDistanz = 0;

      if (r.topologisch) {
        heapAnzahl = 0;
        sucheKNearest(wurzel, 0, B, 0, H);
        for (let k = 0; k < heapAnzahl; k++) {
          const j = heapIndex[k], dx = wickel(x[j] - qx, B, suchTorus), dy = wickel(y[j] - qy, H, suchTorus);
          zaehleNachbar(j, dx, dy, heapDistanz[k]);
        }
      } else {
        sucheImRadius(wurzel, 0, B, 0, H);
      }

      const dichte = treffer ? treffer / (sumDistanz / treffer + 1) : 0;
      lokaleDichte[i] = dichte;
      if (treffer) {
        lenke(sumTrennungX, sumTrennungY, r.trennung);
        lenke(sumVx / treffer, sumVy / treffer, r.ausrichtung);
        lenke(sumX / treffer, sumY / treffer, r.zusammenhalt);
      }

      for (const s of stoerer) {
        const dx = wickel(s.x - x[i], B, suchTorus), dy = wickel(s.y - y[i], H, suchTorus);
        const d = Math.hypot(dx, dy);
        if (d > s.radius || d < 1e-6) continue;
        const nah = 1 - d / s.radius;
        const flucht = s.art === "jagen";
        lenke(flucht ? -dx : dx, flucht ? -dy : dy, s.staerke * (flucht ? 3 * nah : nah));
      }

      for (const [x1, y1, x2, y2] of waende) {
        const wx = x2 - x1, wy = y2 - y1, l2 = wx * wx + wy * wy || 1;
        const t = Math.min(1, Math.max(0, ((x[i] - x1) * wx + (y[i] - y1) * wy) / l2));
        const dx = x[i] - (x1 + t * wx), dy = y[i] - (y1 + t * wy), d = Math.hypot(dx, dy);
        if (d < r.sicht && d > 1e-6) lenke(dx, dy, 4 * (1 - d / r.sicht));
      }

      if (!suchTorus) {
        const rand = Math.min(B, H) * 0.08;
        if (x[i] < rand) lenke(1, 0, 2 * (1 - x[i] / rand));
        if (x[i] > B - rand) lenke(-1, 0, 2 * (1 - (B - x[i]) / rand));
        if (y[i] < rand) lenke(0, 1, 2 * (1 - y[i] / rand));
        if (y[i] > H - rand) lenke(0, -1, 2 * (1 - (H - y[i]) / rand));
      }
      if (r.zittern) {
        ax[i] += (Math.random() - 0.5) * r.zittern * r.kraft * 4;
        ay[i] += (Math.random() - 0.5) * r.zittern * r.kraft * 4;
      }
    }

    // Erst alle Kräfte berechnen, dann alle Vögel gleichzeitig bewegen.
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * dt; vy[i] += ay[i] * dt;
      const sp = Math.hypot(vx[i], vy[i]);
      const ziel = Math.min(r.vmax, Math.max(r.vmin, sp));
      if (sp > 1e-6 && sp !== ziel) { vx[i] *= ziel / sp; vy[i] *= ziel / sp; }
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      if (r.torus) {
        x[i] = ((x[i] % B) + B) % B;
        y[i] = ((y[i] % H) + H) % H;
      } else {
        x[i] = Math.min(B, Math.max(0, x[i]));
        y[i] = Math.min(H, Math.max(0, y[i]));
      }
    }
  }

  function messe() {
    let sp = 0, rx = 0, ry = 0, mx = 0, my = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.hypot(vx[i], vy[i]) || 1;
      sp += s; rx += vx[i] / s; ry += vy[i] / s; mx += x[i]; my += y[i];
    }
    const k = n || 1;
    return { tempo: sp / k, ordnung: Math.hypot(rx, ry) / k, mitteX: mx / k / B, mitteY: my / k / H };
  }

  function sichere() {
    const kopie = [x, y, vx, vy, lokaleDichte].map((a) => a.slice(0, n));
    const alt = { n, B, H };
    return () => {
      ({ n, B, H } = alt);
      [x, y, vx, vy, lokaleDichte].forEach((a, i) => a.set(kopie[i]));
    };
  }

  return {
    neu, schritt, messe, sichere, x, y, vx, vy, lokaleDichte,
    get n() { return n; },
    groesse(b, h) {
      if (!B || !H) { B = b; H = h; return; }
      for (let i = 0; i < n; i++) { x[i] *= b / B; y[i] *= h / H; }
      B = b; H = h;
    },
  };
}
