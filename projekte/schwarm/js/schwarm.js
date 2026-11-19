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
  // Im Starenmodus wird die topologische Nachbarschaft einen Schritt lang wiederverwendet.
  // Die echten Positionen werden trotzdem in jedem Schritt neu berechnet; nur die Indexliste ist eine Annäherung.
  const NACHBAR_STRIDE = 64;
  const nachbarn = new Int32Array(maxAnzahl * NACHBAR_STRIDE);
  const nachbarAnzahl = new Uint8Array(maxAnzahl);
  let cacheFrische = 0;
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
    // Abstand zum Intervall, einmal normal und einmal über den Torusrand.
    // Wichtig: laenge - (lo - q) wäre nicht der periodische Abstand zum linken Rand.
    let d = q < lo ? lo - q : q - hi;
    if (torus) {
      const ueberRand = q < lo ? q + (laenge - lo) : (laenge - q) + hi;
      d = Math.min(d, ueberRand);
    }
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
  let stareGewicht = 0, stareX = 0, stareY = 0, stareVx = 0, stareVy = 0, stareAbstX = 0, stareAbstY = 0;

  function pruefeBlick(dx, dy, d2) {
    if (d2 <= 1e-6 || suchBlickCos <= -1) return true;
    return (dx * qrx + dy * qry) / Math.sqrt(d2) >= suchBlickCos;
  }

  function zaehleNachbar(j, dx, dy, d2) {
    treffer++;
    sumVx += vx[j]; sumVy += vy[j];
    sumX += dx; sumY += dy;
    const distanz = Math.sqrt(d2);
    sumDistanz += distanz;

    // Für Stare werden die drei Zonen getrennt gewichtet:
    // Nahzone = Abstand, mittlere/äußere Zone = Orientierung und lokale Anziehung.
    const sicht = Math.max(1, aktivesRegelwerk.sicht);
    const gewicht = 0.35 + 0.65 * (1 - Math.min(1, distanz / sicht));
    stareGewicht += gewicht;
    stareX += dx * gewicht; stareY += dy * gewicht;
    stareVx += vx[j] * gewicht; stareVy += vy[j] * gewicht;
    const abstand = Math.max(1, aktivesRegelwerk.abstand);
    if (distanz < abstand && distanz > 1e-6) {
      const druck = (1 - distanz / abstand) / distanz;
      stareAbstX -= dx * druck;
      stareAbstY -= dy * druck;
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
      // Topologische Nachbarn sind nur die k nächsten INNERHALB der Sichtweite.
      // Ohne diese Grenze wurden selbst Vögel auf der gegenüberliegenden Seite verbunden.
      if (d2 <= suchRadius2 && pruefeBlick(dx, dy, d2)) heapEinfuegen(j, d2, suchK);
    }

    const a = achse[knoten], split = wert(j, a);
    let lLoX = loX, lHiX = hiX, lLoY = loY, lHiY = hiY;
    let rLoX = loX, rHiX = hiX, rLoY = loY, rHiY = hiY;
    if (a === 0) { lHiX = split; rLoX = split; }
    else { lHiY = split; rLoY = split; }

    const l = links[knoten], r = rechts[knoten];
    const ld = l < 0 ? Infinity : rechteckAbstand(qx, qy, lLoX, lHiX, lLoY, lHiY, suchTorus);
    const rd = r < 0 ? Infinity : rechteckAbstand(qx, qy, rLoX, rHiX, rLoY, rHiY, suchTorus);
    let grenze = heapAnzahl < suchK ? suchRadius2 : Math.min(heapDistanz[0], suchRadius2);
    if (ld <= rd) {
      if (ld <= grenze) sucheKNearest(l, lLoX, lHiX, lLoY, lHiY);
      grenze = heapAnzahl < suchK ? suchRadius2 : Math.min(heapDistanz[0], suchRadius2);
      if (rd <= grenze) sucheKNearest(r, rLoX, rHiX, rLoY, rHiY);
    } else {
      if (rd <= grenze) sucheKNearest(r, rLoX, rHiX, rLoY, rHiY);
      grenze = heapAnzahl < suchK ? suchRadius2 : Math.min(heapDistanz[0], suchRadius2);
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
    cacheFrische = 0;
    nachbarAnzahl.fill(0, 0, n);
    for (let i = 0; i < n; i++) {
      x[i] = zufall() * B;
      y[i] = zufall() * H;
      const w = zufall() * Math.PI * 2;
      vx[i] = Math.cos(w) * 60;
      vy[i] = Math.sin(w) * 60;
      lokaleDichte[i] = 0;
    }
  }

  function neuPulk(anzahl, breite, hoehe, tempo = 150, zufall = Math.random) {
    n = Math.max(1, Math.min(Math.floor(anzahl), maxAnzahl));
    B = breite; H = hoehe;
    cacheFrische = 0;
    nachbarAnzahl.fill(0, 0, n);
    const mitteX = B * (0.5 + (zufall() - 0.5) * 0.08);
    const mitteY = H * (0.5 + (zufall() - 0.5) * 0.08);
    const richtung = zufall() * Math.PI * 2;
    const streuX = Math.max(16, B * 0.075), streuY = Math.max(16, H * 0.085);
    const lappen = [[-0.75, -0.35, -0.12], [0.72, -0.05, 0.10], [0.02, 0.72, 0.02]];
    const normal = () => {
      const u = Math.max(1e-6, zufall()), v = zufall();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    for (let i = 0; i < n; i++) {
      const l = lappen[i % lappen.length];
      const ox = (normal() + l[0]) * streuX, oy = (normal() + l[1]) * streuY;
      x[i] = Math.max(2, Math.min(B - 2, mitteX + ox));
      y[i] = Math.max(2, Math.min(H - 2, mitteY + oy));
      // Drei überlappende Teilwolken mit leicht versetzter Richtung verschmelzen zu einem Verband.
      const tangente = Math.atan2(oy / streuY, ox / streuX) + Math.PI / 2;
      const winkel = richtung + l[2] + normal() * 0.22 + (zufall() - 0.5) * 0.12;
      const wirbel = 0.10 * Math.sin(tangente - richtung);
      const flug = tempo * (0.84 + zufall() * 0.22);
      vx[i] = Math.cos(winkel) * flug + Math.cos(tangente) * tempo * wirbel;
      vy[i] = Math.sin(winkel) * flug + Math.sin(tangente) * tempo * wirbel;
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
    const cacheVerwenden = r.modell === "stare" && r.topologisch && cacheFrische > 0;
    if (!cacheVerwenden) {
      baueBaum();
      cacheFrische = r.modell === "stare" && r.topologisch ? 1 : 0;
    } else {
      cacheFrische = 0;
    }
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
      stareGewicht = 0; stareX = 0; stareY = 0; stareVx = 0; stareVy = 0; stareAbstX = 0; stareAbstY = 0;

      if (r.topologisch) {
        if (cacheVerwenden) {
          const anzahl = nachbarAnzahl[i], offset = i * NACHBAR_STRIDE;
          for (let k = 0; k < anzahl; k++) {
            const j = nachbarn[offset + k];
            const dx = wickel(x[j] - qx, B, suchTorus), dy = wickel(y[j] - qy, H, suchTorus);
            const d2 = dx * dx + dy * dy;
            // Eine gecachte Beziehung darf nur weiterwirken, solange der Vogel noch sichtbar ist.
            if (d2 <= suchRadius2 && pruefeBlick(dx, dy, d2)) zaehleNachbar(j, dx, dy, d2);
          }
        } else {
          heapAnzahl = 0;
          sucheKNearest(wurzel, 0, B, 0, H);
          const offset = i * NACHBAR_STRIDE;
          nachbarAnzahl[i] = heapAnzahl;
          for (let k = 0; k < heapAnzahl; k++) {
            const j = heapIndex[k];
            nachbarn[offset + k] = j;
            const dx = wickel(x[j] - qx, B, suchTorus), dy = wickel(y[j] - qy, H, suchTorus);
            zaehleNachbar(j, dx, dy, heapDistanz[k]);
          }
        }
      } else {
        sucheImRadius(wurzel, 0, B, 0, H);
      }

      const dichte = treffer ? treffer / (sumDistanz / treffer + 1) : 0;
      lokaleDichte[i] = dichte;
      if (treffer) {
        if (r.modell === "stare") {
          // Zone 1: stark ausweichen, bevor sich die Silhouetten überlagern.
          if (stareAbstX || stareAbstY) lenke(stareAbstX, stareAbstY, r.trennung * 1.8);
          // Zone 2: die lokale Flugrichtung übernehmen; Nähe gewichtet stärker als Ferne.
          if (stareGewicht > 0) {
            lenke(stareVx / stareGewicht, stareVy / stareGewicht, r.ausrichtung);
            // Zone 3: in Richtung des lokalen Verbandes, nicht zu einem globalen Ziel.
            const cx = stareX / stareGewicht, cy = stareY / stareGewicht;
            lenke(cx, cy, r.zusammenhalt);
            // Ein kleiner tangentialer Anteil lässt den Verband rollen und sich verformen.
            if (r.wirbel) lenke(-cy, cx, r.wirbel);
          }
        } else {
          lenke(sumTrennungX, sumTrennungY, r.trennung);
          lenke(sumVx / treffer, sumVy / treffer, r.ausrichtung);
          lenke(sumX / treffer, sumY / treffer, r.zusammenhalt);
        }
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
        if (x[i] < 0) { x[i] = 0; vx[i] = Math.abs(vx[i]) * 0.72; }
        else if (x[i] > B) { x[i] = B; vx[i] = -Math.abs(vx[i]) * 0.72; }
        if (y[i] < 0) { y[i] = 0; vy[i] = Math.abs(vy[i]) * 0.72; }
        else if (y[i] > H) { y[i] = H; vy[i] = -Math.abs(vy[i]) * 0.72; }
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
      cacheFrische = 0; // Beim Fortsetzen nach dem Export die Nachbarn sicher neu bestimmen.
    };
  }

  return {
    neu, neuPulk, schritt, messe, sichere, x, y, vx, vy, lokaleDichte,
    get n() { return n; },
    groesse(b, h) {
      if (!B || !H) { B = b; H = h; return; }
      for (let i = 0; i < n; i++) { x[i] *= b / B; y[i] *= h / H; }
      B = b; H = h; cacheFrische = 0;
    },
  };
}
