// Analoges Videosignal, nachgerechnet statt nachgemalt (Effekt „Analoges Signal“ in /lib/effekte/signal.js).
//
// Ein Farbfernseher bekommt pro Zeile EIN Signal (Composite, ein Draht). Darin stecken:
//   Y   die Helligkeit, so wie ein Schwarzweißfernseher sie braucht
//   U,V die Farbe, aufmoduliert auf einen Hilfsträger: eine Schwingung von 4,43 MHz (PAL) oder 3,58 MHz (NTSC),
//       U auf dem Sinus, V auf dem Kosinus (Quadraturmodulation). Die Phase sagt den Farbton, die Höhe die Sättigung.
//   s(x) = Y + U · sin φ(x) + V · cos φ(x)
// Der Fernseher muss das wieder trennen. Was dabei nicht ganz klappt, ist der Look:
//   Farbbluten        die Farbe hat viel weniger Bandbreite als die Helligkeit, sie verschmiert waagerecht
//   Dot Crawl         Reste des Hilfsträgers bleiben in der Helligkeit: feine Punkte an Farbkanten, die sich von
//                     Bild zu Bild verschieben (die Phase springt jede Zeile und jedes Bild)
//   Regenbogen        feine helle Muster sehen für den Fernseher aus wie Farbe (Cross-Color)
//   Überschwingen     ein Kabel mit zu wenig Bandbreite schwingt an harten Kanten nach (helle und dunkle Säume)
// Der Kammfilter (bessere Fernseher) nutzt, dass die Phase des Trägers von Zeile zu Zeile springt: Summe zweier
// Zeilen = Helligkeit, Differenz = Farbe. PAL dreht V jede Zeile um (Phase Alternating Line); mittelt der
// Fernseher zwei Zeilen, heben sich Phasenfehler auf (statt falscher Farbe nur etwas blasser). NTSC hat das nicht:
// dort wird ein Phasenfehler grün oder lila („Never The Same Color“).
//
// Farbburst: am Anfang jeder Zeile sendet der Sender ein paar Schwingungen des reinen Trägers. Der Fernseher stellt
// daran seine eigene Schwingung auf dieselbe Phase und Höhe ein. Weil der Burst durch dasselbe Kabel kommt, wird
// dabei auch die Verschiebung ausgeglichen, die das Kabel dem Träger antut; hier: Phase und Dämpfung des
// Kabelfilters bei der Trägerfrequenz ausrechnen und beim Zurückholen wieder abziehen.
//
// VHS-Band (wenn eingeschaltet), vor dem Kodieren für den Fernseher, wie es in einem Videorekorder passiert:
//   Helligkeit   wird als FM aufs Band geschrieben, mit nur etwa 3 MHz Bandbreite (Sendung: 5 MHz). Der
//                Rekorder schärft beim Abspielen nach: helle Säume an Kanten („Schärfe“)
//   Color-Under  die Farbe wird vom Träger auf etwa 627 kHz (PAL) heruntergemischt und unter die Helligkeit
//                gelegt, mit nur etwa 0,5 MHz Bandbreite, ein Sechstel der Helligkeit. Darum verschmiert Farbe
//                auf VHS so weit, und das Farbrauschen läuft in langen waagerechten Streifen
//   Kopfumschaltung  zwei Köpfe auf der Trommel schreiben abwechselnd je ein Halbbild. Wo der eine aufhört und
//                der andere anfängt, ein paar Zeilen über dem unteren Rand, springt die Zeitbasis: die untersten
//                Zeilen sind verschoben und verrauscht (im Fernseher meist vom Rand verdeckt, auf Computern nicht)
//   Dropouts     fehlt an einer Stelle Magnetschicht, fehlt das FM-Signal: kurze weiße, verrauschte Striche
//   Tracking     liegen die Köpfe nicht genau auf der Spur, läuft ein Band aus Rauschen und Versatz durchs Bild
//   Generation   jede Kopie (Band auf Band) geht noch einmal durch alles: unschärfer, rauschiger
//
// Abgetastet wird jede Zeile mit genau 4 Werten pro Trägerschwingung (wie viele digitale Videogeräte, 4 · fsc),
// also etwa 920 Werte bei PAL und 750 bei NTSC, egal wie breit das Bild ist. Zeilen: höchstens so viele wie die
// Norm sichtbar hat. Danach zurück auf die Größe des Bildes.

// Schwingungen des Hilfsträgers im sichtbaren Teil einer Zeile (Träger · sichtbare Zeilenzeit)
const NORMEN = [
  { name: "PAL", traeger: 4.43361875e6, zyklen: 4.43361875e6 * 52e-6, zeilen: 576, zeilenSchritt: 0.75, bildSchritt: 0.25, palSchalter: true },
  { name: "NTSC", traeger: 3.579545e6, zyklen: 3.579545e6 * 52.66e-6, zeilen: 480, zeilenSchritt: 0.5, bildSchritt: 0.5, palSchalter: false },
];
const PRO_SCHWINGUNG = 4;

// Antwort des Biquads bei der Frequenz f (Anteil der Abtastrate): { phase, betrag }
function antwort(k, f) {
  const w = 2 * Math.PI * f;
  // H(z) = (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²) bei z = e^{jw}
  const re = (a, b, c) => a + b * Math.cos(w) + c * Math.cos(2 * w);
  const im = (b, c) => -b * Math.sin(w) - c * Math.sin(2 * w);
  const zr = re(k.b0, k.b1, k.b2), zi = im(k.b1, k.b2);
  const nr = re(1, k.a1, k.a2), ni = im(k.a1, k.a2);
  return { phase: Math.atan2(zi, zr) - Math.atan2(ni, nr), betrag: Math.hypot(zr, zi) / Math.hypot(nr, ni) };
}

// Biquad-Tiefpass (Robert Bristow-Johnson): fc als Anteil der Abtastrate (0 bis 0,5), q > 0,7 schwingt über
function tiefpassKoeffizienten(fc, q) {
  const w = 2 * Math.PI * Math.min(0.49, Math.max(0.005, fc));
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}
function biquad(x, k) {
  let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0]; // eingeschwungen auf den ersten Wert (kein Sprung am Rand)
  for (let i = 0; i < x.length; i++) {
    const y = k.b0 * x[i] + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

// gleitender Mittelwert über n Werte (mittig): ein Kastenfilter. Über genau eine Trägerperiode gemittelt
// verschwindet der Träger, darum ist er der einfachste Weg, die Helligkeit herauszuholen
function kasten(x, n, ziel) {
  const h = Math.max(1, Math.round(n));
  const halb = Math.floor(h / 2);
  let summe = 0;
  for (let i = -halb; i < h - halb; i++) summe += x[Math.min(x.length - 1, Math.max(0, i))];
  for (let i = 0; i < x.length; i++) {
    ziel[i] = summe / h;
    summe += x[Math.min(x.length - 1, i + h - halb)] - x[Math.max(0, i - halb)];
  }
}

const zufall = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function analogesSignal(bild, w, zeit) {
  const norm = NORMEN[Math.round(w.norm ?? 0)] ?? NORMEN[0];
  // auf Arbeitsgröße bringen
  const W = Math.round(norm.zyklen * PRO_SCHWINGUNG);
  const H = Math.max(2, Math.min(bild.height, norm.zeilen));
  const f = W / bild.width; // für Regler in Bildpixeln
  const quelle = groesse(bild, W, H);
  const d = quelle.data;
  const aus = new ImageData(W, H);
  const o = aus.data;

  const periode = W / norm.zyklen; // Pixel pro Schwingung des Trägers
  const bild30 = Math.floor(zeit * 30); // Bildnummer: die Phase wandert von Bild zu Bild (Dot Crawl krabbelt)
  // Bandbreite des Kabels: 1 = doppelte Trägerfrequenz (alles kommt durch), weniger dämpft auch die Farbe
  const kabel = tiefpassKoeffizienten((2 * (w.luma ?? 0.6)) / PRO_SCHWINGUNG, 0.7 + (w.ueberschwingen ?? 0.3) * 2.5);
  const burst = antwort(kabel, 1 / PRO_SCHWINGUNG); // was das Kabel dem Träger antut, misst der Fernseher am Burst
  const rauschen = w.rauschen ?? 0.02;
  const zittern = w.zittern ?? 0;
  const farbVersatz = Math.round((w.farbVersatz ?? 2) * f);
  const chromaLaenge = periode / Math.max(0.02, w.chroma ?? 0.25); // Kasten für die Farbe: kleinere Bandbreite = länger
  const fehler = ((w.phase ?? 0) * Math.PI) / 180 + burst.phase; // Phasenfehler von Hand, Kabelphase ausgeglichen
  const acc = 1 / Math.max(0.05, burst.betrag); // automatische Farbregelung: Dämpfung am Burst gemessen, ausgeglichen
  const kamm = (w.kamm ?? 0) > 0.5;

  // VHS: Abtastrate 4 · Träger; daraus die Filter fürs Band
  const vhs = (w.band ?? 0) > 0.5;
  const abtast = norm.traeger * PRO_SCHWINGUNG;
  const generationen = vhs ? Math.max(1, Math.round(w.generation ?? 1)) : 0;
  const bandLuma = tiefpassKoeffizienten(3.0e6 / abtast, 0.8);
  // Kastenlänge für ~0,5 MHz: ein Kasten der Länge L dämpft ab etwa 0,44 · Abtastrate / L auf −3 dB
  const bandChroma = Math.round((0.44 * abtast) / 0.5e6);
  const schaerfe = w.schaerfe ?? 0.6;
  const farbRauschen = w.farbRauschen ?? 0.3;
  const kopfZeilen = vhs && (w.kopf ?? 0) > 0 ? Math.max(3, Math.round(H * 0.025)) : 0;
  const dropouts = vhs ? w.dropouts ?? 0.2 : 0;
  const tracking = vhs ? w.tracking ?? 0 : 0;
  // das Tracking-Band wandert langsam von oben nach unten durch (und ein Stück darüber hinaus, dann kommt es wieder)
  const trackingMitte = (((zeit * 0.11) % 1) * 1.4 - 0.2) * H;
  const trackingHoehe = H * 0.05;

  const s = new Float32Array(W); // das Signal dieser Zeile
  const sVorher = new Float32Array(W); // für den Kammfilter (die Zeile, deren Träger genau gegenphasig liegt)
  const sVorvorher = new Float32Array(W);
  const Y = new Float32Array(W);
  const c = new Float32Array(W);
  const u = new Float32Array(W);
  const v = new Float32Array(W);
  const uVorher = new Float32Array(W); // PAL: die Farbe der Zeile davor (Verzögerungsleitung)
  const vVorher = new Float32Array(W);
  const Ry = new Float32Array(W);
  const Ru = new Float32Array(W);
  const Rv = new Float32Array(W);
  const tmp = new Float32Array(W);

  for (let y = 0; y < H; y++) {
    const zeilenPhase = 2 * Math.PI * (norm.zeilenSchritt * y + norm.bildSchritt * bild30);
    const vZeichen = norm.palSchalter && y % 2 ? -1 : 1;
    let verschub = zittern * (zufall(y, bild30) - 0.5) * 2; // Band: die Zeile kommt etwas zu früh oder spät
    // VHS: unten die Kopfumschaltung (je tiefer, desto weiter verschoben), dazu das Tracking-Band
    const imKopf = kopfZeilen && y >= H - kopfZeilen ? (y - (H - kopfZeilen) + 1) / kopfZeilen : 0;
    if (imKopf) verschub += (w.kopf ?? 0) * W * 0.06 * Math.sqrt(imKopf) * (1 + 0.3 * zufall(y, bild30 + 3));
    const imTracking = tracking > 0 ? Math.max(0, 1 - Math.abs(y - trackingMitte) / trackingHoehe) : 0;
    if (imTracking) verschub += tracking * imTracking * W * 0.03 * (zufall(y, bild30 + 9) - 0.3);

    // RGB → Helligkeit und Farbe (Rec. 601, wie im Fernsehen)
    for (let x = 0; x < W; x++) {
      const xq = Math.min(W - 1, Math.max(0, Math.round(x + verschub)));
      const i = (y * W + xq) * 4;
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      Ry[x] = 0.299 * r + 0.587 * g + 0.114 * b;
      Ru[x] = 0.492 * (b - Ry[x]);
      Rv[x] = 0.877 * (r - Ry[x]);
    }
    // VHS-Band: Helligkeit und Farbe getrennt aufs Band und zurück, so oft wie Generationen
    for (let g = 0; g < generationen; g++) {
      biquad(Ry, bandLuma);
      // Nachschärfen beim Abspielen: das, was ein kleiner Weichzeichner wegnimmt, noch einmal dazu (Säume)
      kasten(Ry, 5, tmp);
      for (let x = 0; x < W; x++) Ry[x] += schaerfe * (Ry[x] - tmp[x]);
      // Color-Under: wenig Bandbreite, und Rauschen, das genauso verschmiert wird (lange Streifen)
      for (const kanal of [Ru, Rv]) {
        for (let x = 0; x < W; x++) tmp[x] = kanal[x] + (Math.random() - 0.5) * farbRauschen * 0.6;
        kasten(tmp, bandChroma, kanal);
      }
      // Helligkeit rauscht auch, je Kopie etwas
      for (let x = 0; x < W; x++) Ry[x] += (Math.random() - 0.5) * 0.03;
    }
    if (vhs) {
      // Dropouts: hier und da ein weißer, verrauschter Strich, in jedem Bild woanders
      if (zufall(y * 7.3, bild30 * 1.7 + 1) < dropouts * 0.04) {
        const a = Math.floor(zufall(y, bild30 + 5) * W);
        const b = Math.min(W, a + Math.floor((0.01 + 0.2 * zufall(y, bild30 + 6)) * W));
        for (let x = a; x < b; x++) {
          Ry[x] = 0.75 + Math.random() * 0.35;
          Ru[x] = Rv[x] = 0;
        }
      }
      // Kopfumschaltung und Tracking: verrauscht, die Farbe geht verloren
      const kaputt = Math.max(imKopf * (w.kopf ?? 0), imTracking * tracking);
      if (kaputt > 0) {
        for (let x = 0; x < W; x++) {
          const streifen = Math.random() < kaputt * 0.25 ? Math.random() : 0; // weiße Rauschfetzen
          Ry[x] = Ry[x] * (1 - 0.5 * kaputt) + (Math.random() - 0.5) * kaputt * 0.5 + streifen * kaputt;
          Ru[x] *= 1 - kaputt;
          Rv[x] *= 1 - kaputt;
        }
      }
    }
    // Kodieren: Farbe auf den Träger, etwas hinter der Helligkeit (Farbe kommt im Band später an)
    for (let x = 0; x < W; x++) {
      const phi = (2 * Math.PI * x) / periode + zeilenPhase;
      const xc = Math.max(0, x - farbVersatz);
      s[x] = Ry[x] + Ru[xc] * Math.sin(phi) + vZeichen * Rv[xc] * Math.cos(phi);
    }
    // Kabel: begrenzte Bandbreite (schwingt an Kanten über) und Rauschen
    biquad(s, kabel);
    if (rauschen > 0) for (let x = 0; x < W; x++) s[x] += (Math.random() + Math.random() - 1) * rauschen;

    // Fernseher: Helligkeit und Farbe trennen
    const gegen = norm.palSchalter ? sVorvorher : sVorher; // PAL: zwei Zeilen zurück liegt der Träger gegenphasig
    if (kamm && y >= (norm.palSchalter ? 2 : 1)) {
      for (let x = 0; x < W; x++) {
        Y[x] = (s[x] + gegen[x]) / 2;
        c[x] = (s[x] - gegen[x]) / 2;
      }
    } else {
      kasten(s, periode, Y);
      for (let x = 0; x < W; x++) c[x] = s[x] - Y[x];
    }
    sVorvorher.set(sVorher);
    sVorher.set(s);

    // Farbe zurückholen: mit Sinus und Kosinus derselben Frequenz malnehmen, dann tiefpassen (Demodulation)
    for (let x = 0; x < W; x++) {
      const phi = (2 * Math.PI * x) / periode + zeilenPhase + fehler;
      tmp[x] = 2 * acc * c[x] * Math.sin(phi);
      v[x] = 2 * acc * c[x] * Math.cos(phi) * vZeichen;
    }
    kasten(tmp, chromaLaenge, u);
    tmp.set(v);
    kasten(tmp, chromaLaenge, v);
    // PAL: mit der Zeile davor mitteln, Phasenfehler heben sich auf
    if (norm.palSchalter) {
      for (let x = 0; x < W; x++) {
        const u0 = u[x];
        const v0 = v[x];
        if (y > 0) {
          u[x] = (u0 + uVorher[x]) / 2;
          v[x] = (v0 + vVorher[x]) / 2;
        }
        uVorher[x] = u0;
        vVorher[x] = v0;
      }
    }
    // zurück nach RGB
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const yy = Y[x];
      o[i] = 255 * (yy + v[x] / 0.877);
      o[i + 2] = 255 * (yy + u[x] / 0.492);
      o[i + 1] = 255 * ((yy - 0.299 * (yy + v[x] / 0.877) - 0.114 * (yy + u[x] / 0.492)) / 0.587);
      o[i + 3] = 255;
    }
  }
  return groesse(aus, bild.width, bild.height);
}

// ImageData auf eine andere Größe (über zwei Canvas)
function groesse(bild, w, h) {
  if (bild.width === w && bild.height === h) return bild;
  const a = document.createElement("canvas");
  a.width = bild.width;
  a.height = bild.height;
  a.getContext("2d").putImageData(bild, 0, 0);
  const b = document.createElement("canvas");
  b.width = w;
  b.height = h;
  const ctx = b.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(a, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
