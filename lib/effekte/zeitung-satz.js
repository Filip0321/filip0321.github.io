// Satz der Zeitungsseite: Text, Überschrift, Linien und das Feld für das Foto, gezeichnet mit Canvas 2D (echte
// Schrift, Blocksatz), als Bild, das der Shader (papier.js, ZEITUNG) nur noch liest.
//
// Warum so und nicht mehr im Shader (wie in Runde 7f): dort wurde jeder Buchstabe für jeden Pixel neu ausgerechnet
// (Spalte suchen, Zeile, Zeichen aus der Pixelschrift), und für das Verlaufen und Verschmieren noch zehnmal für die
// Nachbarn. Das war so viel Arbeit pro Bild, dass schwächere Grafikkarten aufgaben und die Seite zusammenbrach.
// Jetzt wird die Seite einmal gesetzt (nur wenn sich Text, Maße oder das Blatt ändern) und auf die Grafikkarte
// geladen; Verlaufen, Verschmieren und die durchscheinende Rückseite sind dann nur noch ein paar Lesezugriffe.
//
// Kanäle des Bildes: Rot = Druckfarbe (Text, Linien), Grün = wo das Foto hinkommt. Alle Maße in Prozent der Breite
// (wie vorher): der Export in 4K sieht aus wie die Vorschau, nur schärfer.

// kleiner Zufallsgenerator mit Startwert (mulberry32): dieselbe Ausgabe ergibt denselben Text
function zufallVon(saat) {
  let a = (Math.floor(saat * 9973) + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wörter aus Silben, die im Deutschen häufig sind: aus der Entfernung sieht es aus wie echter Text, aus der Nähe ist
// es Unsinn (wie Blindtext, aber deutsch klingend)
const SILBEN = ["ge", "ver", "be", "en", "er", "der", "die", "und", "sch", "ein", "ung", "ten", "lich", "keit", "heit", "stadt", "rat", "an", "auf", "aus", "bei", "mit", "nach", "zu", "um", "for", "wer", "land", "zeit", "tag", "berg", "wald", "haus", "wo", "ab", "re", "gen", "ner", "sa", "ma", "li", "ko", "ru", "te", "pe", "fa", "ni", "lo", "mu", "ka"];
const KLEIN = ["der", "die", "das", "und", "in", "den", "von", "zu", "mit", "sich", "des", "auf", "für", "ist", "im", "dem", "nicht", "ein", "eine", "als", "auch", "es", "an", "wird", "aus", "er", "hat", "dass", "sie", "nach", "bei", "um", "am", "noch", "wie", "über", "so", "zum", "war", "vor"];
function wort(z, gross) {
  let w = "";
  const n = 1 + Math.floor(z() * 3);
  for (let i = 0; i < n; i++) w += SILBEN[Math.floor(z() * SILBEN.length)];
  return gross ? w[0].toUpperCase() + w.slice(1) : w;
}
function satzAusZufall(z) {
  const n = 5 + Math.floor(z() * 12);
  const woerter = [];
  for (let i = 0; i < n; i++) {
    const r = z();
    woerter.push(r < 0.45 ? KLEIN[Math.floor(z() * KLEIN.length)] : wort(z, r < 0.7)); // Substantive groß
    if (i > 2 && i < n - 2 && z() < 0.08) woerter[woerter.length - 1] += ",";
  }
  woerter[0] = woerter[0][0].toUpperCase() + woerter[0].slice(1);
  return woerter.join(" ") + ".";
}
function absatzAusZufall(z) {
  const n = 2 + Math.floor(z() * 5);
  return Array.from({ length: n }, () => satzAusZufall(z)).join(" ");
}

// Wörter in Zeilen einer Breite b (Pixel) umbrechen; gibt Zeilen [{ woerter, letzte }] zurück
function umbrechen(ctx, text, b, einzug) {
  const zeilen = [];
  const woerter = text.split(/\s+/).filter(Boolean);
  let zeile = [];
  let breite = 0;
  const leer = ctx.measureText(" ").width;
  for (const w of woerter) {
    const ww = ctx.measureText(w).width;
    const platz = b - (zeilen.length === 0 ? einzug : 0);
    if (zeile.length && breite + leer + ww > platz) {
      zeilen.push({ woerter: zeile, letzte: false });
      zeile = [];
      breite = 0;
    }
    breite += (zeile.length ? leer : 0) + ww;
    zeile.push(w);
  }
  if (zeile.length) zeilen.push({ woerter: zeile, letzte: true });
  return zeilen;
}
// eine Zeile in Blocksatz (die Lücken gleichmäßig verteilt; die letzte Zeile eines Absatzes linksbündig)
function zeile(ctx, { woerter, letzte }, x, y, b) {
  if (letzte || woerter.length === 1) {
    ctx.fillText(woerter.join(" "), x, y);
    return;
  }
  const breiten = woerter.map((w) => ctx.measureText(w).width);
  const luecke = (b - breiten.reduce((a, c) => a + c, 0)) / (woerter.length - 1);
  let xx = x;
  woerter.forEach((w, i) => {
    ctx.fillText(w, xx, y);
    xx += breiten[i] + luecke;
  });
}

const SCHRIFT = 'Georgia, "Times New Roman", Times, serif';

// Die Seite setzen. w, h: Pixel; e: Werte des Effekts; saat: Startwert der Ausgabe.
// Gibt { leinwand, foto: [x0, y0, x1, y1] (uv, y nach oben) } zurück.
export function setzeSeite(leinwand, w, h, e, saat) {
  if (leinwand.width !== w || leinwand.height !== h) {
    leinwand.width = w;
    leinwand.height = h;
  }
  const ctx = leinwand.getContext("2d");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const z = zufallVon(saat);
  const p = w / 100; // ein Prozent der Breite
  const R = e.rand * p;
  const A = e.spaltenAbstand * p;
  const L = e.schriftGroesse * p; // Zeilenabstand
  const Lk = e.kopfGroesse * p;
  const n = Math.max(1, Math.round(e.spalten));
  const sb = (w - 2 * R - (n - 1) * A) / n;
  const mitFoto = e.seite > 0.5 && e.seite < 1.5;
  const strich = (x0, y0, x1, y1, d) => {
    ctx.fillRect(x0, y0 - d / 2, x1 - x0, d);
  };

  // Text: eigener (wiederholt, bis die Seite voll ist) oder Zufall
  const eigen = (e.eigenerText ?? "").trim();
  const absaetze = eigen ? eigen.split(/\n+/).map((x) => x.trim()).filter(Boolean) : [];
  let absatzNr = 0;
  const naechsterAbsatz = () => (absaetze.length ? absaetze[absatzNr++ % absaetze.length] : absatzAusZufall(z));

  // Überschrift
  ctx.fillStyle = "#f00"; // Druckfarbe im roten Kanal
  let oben = R;
  if (e.kopfGroesse > 0) {
    strich(R, R * 0.7, w - R, R * 0.7, Math.max(1, p * 0.15));
    strich(R, R * 0.7 + p * 0.35, w - R, R * 0.7 + p * 0.35, Math.max(1, p * 0.06));
    ctx.font = `bold ${Lk * 0.86}px ${SCHRIFT}`;
    ctx.textBaseline = "alphabetic";
    const titel = (e.eigeneUeberschrift ?? "").trim() || Array.from({ length: 3 + Math.floor(z() * 4) }, (_, i) => (i === 0 || z() < 0.5 ? wort(z, true) : KLEIN[Math.floor(z() * KLEIN.length)])).join(" ");
    const kz = umbrechen(ctx, titel, w - 2 * R, 0).slice(0, 3);
    let y = R + p * 0.6;
    for (const k of kz) {
      y += Lk;
      ctx.fillText(k.woerter.join(" "), R, y - Lk * 0.2);
    }
    oben = y + Lk * 0.15;
    strich(R, oben, w - R, oben, Math.max(1, p * 0.08));
    oben += L * 0.8;
  }
  const unten = h - R;

  // Foto: Spalten f0 .. f0 + fs − 1, ab fy, Höhe fh (0: Seitenverhältnis des Bildes), darunter die Bildunterschrift
  const fs = Math.min(n, Math.max(1, Math.round(e.fotoSpalten)));
  const f0 = Math.min(n - fs, Math.max(0, Math.round(e.fotoSpalte) - 1));
  const fx = R + f0 * (sb + A);
  const fb = fs * sb + (fs - 1) * A;
  const fy = oben + (e.fotoOben / 100) * (unten - oben);
  const fh = Math.min(e.fotoHoehe > 0 ? (e.fotoHoehe / 100) * h : (fb * h) / w, unten - fy);
  let block = fy; // ab hier geht der Text unter dem Foto weiter
  if (mitFoto) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#0f0";
    ctx.fillRect(fx, fy, fb, fh);
    ctx.fillStyle = "#f00";
    const d = Math.max(1, p * 0.08);
    ctx.strokeStyle = "#f00";
    ctx.lineWidth = d;
    ctx.strokeRect(fx, fy, fb, fh);
    block = fy + fh + L * 0.5;
    if (e.unterschrift > 0.5) {
      ctx.font = `italic ${L * 0.7}px ${SCHRIFT}`;
      const u = (e.eigeneUnterschrift ?? "").trim() || satzAusZufall(z);
      const uz = umbrechen(ctx, u, fb, 0).slice(0, 2);
      for (const k of uz) {
        block += L * 0.85;
        ctx.fillText(k.woerter.join(" "), fx, block - L * 0.15);
      }
      block += L * 0.6;
    }
  }

  // Spalten füllen: Absatz für Absatz, Zeile für Zeile, eingerückt, Blocksatz
  ctx.font = `${L * 0.76}px ${SCHRIFT}`;
  ctx.textBaseline = "alphabetic";
  let wartend = []; // Zeilen des angefangenen Absatzes
  const naechsteZeile = () => {
    if (!wartend.length) wartend = umbrechen(ctx, naechsterAbsatz(), sb, L * 1.2).map((zz, i) => ({ ...zz, einzug: i === 0 ? L * 1.2 : 0 }));
    return wartend.shift();
  };
  for (let k = 0; k < n; k++) {
    const x = R + k * (sb + A);
    const unterFoto = mitFoto && k >= f0 && k < f0 + fs;
    const stuecke = unterFoto ? [[oben, fy - L * 0.4], [block, unten]] : [[oben, unten]];
    for (const [von, bis] of stuecke) {
      for (let y = von + L; y <= bis; y += L) {
        const zz = naechsteZeile();
        if (!zz) break;
        zeile(ctx, zz, x + zz.einzug, y - L * 0.22, sb - zz.einzug);
      }
    }
    // Spaltenlinie in der Mitte des Abstands (nicht durch das Foto)
    if (k < n - 1) {
      const lx = x + sb + A / 2;
      const d = Math.max(1, p * 0.05);
      if (mitFoto && k >= f0 && k < f0 + fs - 1) {
        ctx.fillRect(lx - d / 2, oben, d, fy - L * 0.5 - oben);
        ctx.fillRect(lx - d / 2, block, d, unten - block);
      } else ctx.fillRect(lx - d / 2, oben, d, unten - oben);
    }
  }
  leinwand.version = (leinwand.version ?? 0) + 1;
  return { foto: mitFoto ? [fx / w, 1 - (fy + fh) / h, (fx + fb) / w, 1 - fy / h] : [2, 2, 2, 2] };
}
