// Höhenlinien der Helligkeit (Marching Squares), als Linien aus Punkten in Pixeln: für den Plotter
// (/lib/effekte/plotter.js). Dieselbe Rechnung wie im Oszilloskop (projekte/oszilloskop/js/nachzeichnen.js, dort
// steht die Erklärung), nur ohne das Umrechnen auf −1 bis 1.
//
// hell: Float32Array W · H (0 bis 1, Zeile für Zeile), schwelle: welche Helligkeit die Linie nachfährt
// Zurück: [[[x, y], …], …], die Linien in der Reihenfolge, in der sie entstanden sind

export function konturen(hell, W, H, schwelle) {
  // Marching Squares: Stückchen [[x1, y1], [x2, y2]]
  const stuecke = [];
  const kreuz = (a, b) => (schwelle - a) / (b - a || 1e-6); // wo zwischen a und b die Schwelle liegt (0 bis 1)
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = hell[y * W + x]; // oben links
      const b = hell[y * W + x + 1]; // oben rechts
      const c2 = hell[(y + 1) * W + x + 1]; // unten rechts
      const e = hell[(y + 1) * W + x]; // unten links
      const fall = (a > schwelle ? 8 : 0) | (b > schwelle ? 4 : 0) | (c2 > schwelle ? 2 : 0) | (e > schwelle ? 1 : 0);
      if (fall === 0 || fall === 15) continue;
      // die Punkte auf den vier Seiten
      const oben = [x + kreuz(a, b), y];
      const rechts = [x + 1, y + kreuz(b, c2)];
      const unten = [x + kreuz(e, c2), y + 1];
      const links = [x, y + kreuz(a, e)];
      const paare = {
        1: [[links, unten]], 2: [[unten, rechts]], 3: [[links, rechts]], 4: [[oben, rechts]],
        5: [[links, oben], [unten, rechts]], 6: [[oben, unten]], 7: [[links, oben]], 8: [[links, oben]],
        9: [[oben, unten]], 10: [[links, unten], [oben, rechts]], 11: [[oben, rechts]], 12: [[links, rechts]],
        13: [[unten, rechts]], 14: [[links, unten]],
      }[fall];
      for (const p of paare) stuecke.push(p);
    }
  }

  // Stückchen an gleichen Enden zu Linien verbinden
  const schluessel = ([x, y]) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const anEnde = new Map();
  stuecke.forEach((s, i) => {
    for (const p of s) {
      const k = schluessel(p);
      if (!anEnde.has(k)) anEnde.set(k, []);
      anEnde.get(k).push(i);
    }
  });
  const benutzt = new Uint8Array(stuecke.length);
  const linien = [];
  for (let i = 0; i < stuecke.length; i++) {
    if (benutzt[i]) continue;
    benutzt[i] = 1;
    const linie = [...stuecke[i]];
    // in beide Richtungen weiterlaufen
    for (const vorne of [false, true]) {
      for (;;) {
        const ende = vorne ? linie[0] : linie[linie.length - 1];
        const naechstes = (anEnde.get(schluessel(ende)) ?? []).find((j) => !benutzt[j]);
        if (naechstes === undefined) break;
        benutzt[naechstes] = 1;
        const [p, q] = stuecke[naechstes];
        const weiter = schluessel(p) === schluessel(ende) ? q : p;
        if (vorne) linie.unshift(weiter);
        else linie.push(weiter);
      }
    }
    linien.push(linie);
  }

  return linien;
}

// Reihenfolge wie ein Plotter: immer zum nächsten Strich (kürzere Leerfahrten), umgedreht, wenn sein Ende näher
// liegt als sein Anfang. start: wo der Stift anfängt
export function ordne(striche, start = [0, 0]) {
  const rest = [...striche];
  const aus = [];
  let wo = start;
  while (rest.length) {
    let beste = 0;
    let umgedreht = false;
    let abstand = Infinity;
    rest.forEach((s, i) => {
      const a = Math.hypot(s[0][0] - wo[0], s[0][1] - wo[1]);
      const b = Math.hypot(s.at(-1)[0] - wo[0], s.at(-1)[1] - wo[1]);
      if (a < abstand) [abstand, beste, umgedreht] = [a, i, false];
      if (b < abstand) [abstand, beste, umgedreht] = [b, i, true];
    });
    const s = rest.splice(beste, 1)[0];
    if (umgedreht) s.reverse();
    aus.push(s);
    wo = s.at(-1);
  }
  return aus;
}

