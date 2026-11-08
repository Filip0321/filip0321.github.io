// Eigene Bilder, SVG und Text als Striche für das Oszilloskop.
//
// Bild (und Text, der erst in ein Bild geschrieben wird): Umrisse mit Marching Squares. Das Bild wird klein
// gerechnet und weichgezeichnet; dann wird für jedes Quadrat aus vier Nachbarpixeln geschaut, welche Ecken heller
// als die Schwelle sind. Daraus folgt, wo die Grenzlinie durch das Quadrat läuft (16 Fälle), und zwar genau an der
// Stelle, wo die Helligkeit die Schwelle kreuzt (linear zwischen den Ecken). Die Stückchen werden an ihren Enden
// zu Linien zusammengesetzt. Ergebnis: Höhenlinien der Helligkeit, wie auf einer Landkarte.
// Zu viele kleine Umrisse machen das Bild blass (der Strahl muss alles in einer Runde zeichnen); darum fallen
// kurze weg und die übrigen werden ausgedünnt.
//
// SVG: der Browser kennt die Länge jeder Form und den Punkt an jeder Stelle (getTotalLength, getPointAtLength),
// auch für Kurven, Kreise und Rechtecke. Dafür muss das SVG kurz unsichtbar in der Seite hängen.

// ---------- Bild ----------
export function bildZuStrichen(quelle, { schwelle = 0.5, aufloesung = 160, mindestens = 0.04, umkehren = false } = {}) {
  const f = aufloesung / Math.max(quelle.width, quelle.height);
  const w = Math.max(8, Math.round(quelle.width * f));
  const h = Math.max(8, Math.round(quelle.height * f));
  const c = document.createElement("canvas");
  c.width = w + 2; // ein Rand rundherum: so schließen sich Umrisse, die am Bildrand liegen
  c.height = h + 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = umkehren ? "#fff" : "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = "blur(0.7px)"; // weicher: glattere Linien, weniger Krümel
  ctx.drawImage(quelle, 1, 1, w, h);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width;
  const H = c.height;
  const hell = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    hell[i] = umkehren ? 1 - v : v;
  }

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

  // in −1 bis 1 (y nach oben), kurze weg, ausdünnen
  const s = 1.8 / Math.max(W, H);
  const striche = linien
    .map((l) => l.map(([x, y]) => [(x - W / 2) * s, (H / 2 - y) * s]))
    .filter((l) => laenge(l) > mindestens)
    .map((l) => duenne(l, 0.01));
  return ordne(striche);
}

const laenge = (l) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);

// Punkte weglassen, die näher als abstand am letzten behaltenen liegen
function duenne(l, abstand) {
  const aus = [l[0]];
  for (let i = 1; i < l.length; i++) {
    const q = aus[aus.length - 1];
    if (Math.hypot(l[i][0] - q[0], l[i][1] - q[1]) >= abstand || i === l.length - 1) aus.push(l[i]);
  }
  return aus;
}

// Reihenfolge: immer zum nächstgelegenen Strich (kürzere Sprünge = weniger sichtbare Linien), umgedreht, wenn
// sein Ende näher liegt als sein Anfang
export function ordne(striche) {
  const rest = [...striche];
  const aus = [];
  let wo = [0, 0];
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

// ---------- Text ----------
export function textZuStrichen(text, schrift = "bold 120px sans-serif") {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = schrift;
  const zeilen = text.split("\n");
  const breite = Math.max(...zeilen.map((z) => ctx.measureText(z).width), 10);
  const hoehe = 140 * zeilen.length;
  c.width = Math.ceil(breite + 40);
  c.height = hoehe + 40;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff";
  ctx.font = schrift;
  ctx.textBaseline = "middle";
  zeilen.forEach((z, i) => ctx.fillText(z, 20, 20 + 70 + i * 140));
  return bildZuStrichen(c, { schwelle: 0.5, aufloesung: Math.min(400, Math.max(160, c.width / 2)), mindestens: 0.01 });
}

// ---------- SVG ----------
export function svgZuStrichen(text, schritt = 0.008) {
  const platz = document.createElement("div");
  platz.style.cssText = "position:absolute;left:-9999px;top:0;width:500px;height:500px;visibility:hidden";
  platz.innerHTML = text;
  document.body.append(platz);
  try {
    const svg = platz.querySelector("svg");
    if (!svg) throw new Error("Das ist kein SVG.");
    const formen = [...svg.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect")];
    // erst alle Punkte in SVG-Koordinaten (mit den Verschiebungen der Gruppen: getCTM), dann gemeinsam einpassen
    const roh = [];
    const wurzel = svg.getScreenCTM();
    for (const form of formen) {
      const l = form.getTotalLength();
      if (!(l > 0)) continue;
      const matrix = wurzel.inverse().multiply(form.getScreenCTM());
      const n = Math.max(8, Math.min(2000, Math.round(l / 2)));
      const strich = [];
      for (let i = 0; i <= n; i++) {
        const p = form.getPointAtLength((l * i) / n).matrixTransform(matrix);
        strich.push([p.x, p.y]);
      }
      roh.push(strich);
    }
    if (!roh.length) throw new Error("Im SVG ist keine Form, die sich zeichnen lässt.");
    const alle = roh.flat();
    const [x0, x1] = [Math.min(...alle.map((p) => p[0])), Math.max(...alle.map((p) => p[0]))];
    const [y0, y1] = [Math.min(...alle.map((p) => p[1])), Math.max(...alle.map((p) => p[1]))];
    const s = 1.7 / Math.max(x1 - x0, y1 - y0, 1e-6);
    return ordne(roh.map((st) => duenne(st.map(([x, y]) => [(x - (x0 + x1) / 2) * s, ((y0 + y1) / 2 - y) * s]), schritt)));
  } finally {
    platz.remove();
  }
}
