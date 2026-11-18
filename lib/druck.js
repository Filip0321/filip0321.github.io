// Druck: ein Bild nicht hochziehen, sondern in der Druckgröße neu rechnen.
//
// Hochziehen (wie bisher beim Export) macht aus einem Bildschirm-Pixel viele Druck-Pixel: unscharf oder pixelig.
// Für einen Druck braucht man so viele Pixel, wie das Papier bei der gewünschten Auflösung hat:
//   Pixel = Zentimeter / 2,54 · dpi
// A2 (42 × 59,4 cm) bei 300 dpi sind 4961 × 7016 Pixel, also 35 Millionen; ein Bildschirm hat etwa 2 bis 8.
//
// Diese Datei hat drei Teile, die jedes Projekt benutzen kann, das in beliebiger Größe rechnen kann:
//   oeffneDruckDialog()  Papier, Ausrichtung, dpi, Rand, Farben, Qualität wählen
//   kacheln()            ein großes Bild Stück für Stück rechnen (die Grafikkarte kann nicht beliebig groß zeichnen,
//                        meist höchstens 8192 oder 16384 Pixel pro Seite, und der Speicher reicht oft nicht einmal dafür)
//   speichereDruck()     als PNG oder JPEG speichern, mit der Auflösung in der Datei: dann weiß das Druckprogramm,
//                        wie groß in Zentimetern das Bild gemeint ist (sonst nimmt es oft 72 dpi an)

// Papier in Millimetern, hochkant (Breite < Höhe); quer wird getauscht
export const PAPIERE = {
  a4: { text: "A4 (21 × 29,7 cm)", b: 210, h: 297 },
  a3: { text: "A3 (29,7 × 42 cm)", b: 297, h: 420 },
  a2: { text: "A2 (42 × 59,4 cm)", b: 420, h: 594 },
  a1: { text: "A1 (59,4 × 84,1 cm)", b: 594, h: 841 },
  p30x40: { text: "30 × 40 cm", b: 300, h: 400 },
  p40x50: { text: "40 × 50 cm", b: 400, h: 500 },
  p50x70: { text: "50 × 70 cm", b: 500, h: 700 },
  p70x100: { text: "70 × 100 cm", b: 700, h: 1000 },
  q30: { text: "Quadrat 30 × 30 cm", b: 300, h: 300 },
  q50: { text: "Quadrat 50 × 50 cm", b: 500, h: 500 },
  eigen: { text: "eigene Größe …", b: 400, h: 600 },
};

// so viele Pixel darf ein Canvas höchstens haben (Chrome: 268 Millionen, je Seite 32767), mit Abstand darunter
const MAX_PIXEL = 150e6;

const mmZuPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);

// felder: zusätzliche Einstellungen der Seite, z. B.
//   [{ name: "hintergrund", text: "Hintergrund", art: "farbe", wert: "#111111" }]
// gibt ein Versprechen auf { breite, hoehe (Pixel), rand (Pixel), dpi, mm: { b, h }, randFarbe, qualitaet, datei,
// …felder } zurück, oder null bei Abbrechen
export function oeffneDruckDialog({ titel = "Für den Druck rechnen", felder = [], hinweis = "" } = {}) {
  const gemerkt = lies();
  const d = document.createElement("dialog");
  d.className = "export-dialog druck-dialog";
  const zeile = (text, feld) => `<label>${text} ${feld}</label>`;
  const optionen = (liste, wert) => liste.map(([w, t]) => `<option value="${w}"${String(w) === String(wert) ? " selected" : ""}>${t}</option>`).join("");
  d.innerHTML = `
    <h2>${titel}</h2>
    <div class="steuerung">
      ${zeile("Papier", `<select name="papier">${optionen(Object.entries(PAPIERE).map(([k, p]) => [k, p.text]), gemerkt.papier ?? "a3")}</select>`)}
      <span class="steuerung-gruppe druck-eigen">
        <label>Breite (mm) <input type="number" name="eigenB" min="50" max="2000" value="${gemerkt.eigenB ?? 400}"></label>
        <label>Höhe (mm) <input type="number" name="eigenH" min="50" max="2000" value="${gemerkt.eigenH ?? 600}"></label>
      </span>
      ${zeile("Ausrichtung", `<select name="lage">${optionen([["hoch", "hochkant"], ["quer", "quer"]], gemerkt.lage ?? "hoch")}</select>`)}
      ${zeile("Auflösung", `<select name="dpi">${optionen([[150, "150 dpi (Poster, von weitem)"], [200, "200 dpi"], [300, "300 dpi (Fotodruck, von nah)"]], gemerkt.dpi ?? 300)}</select>`)}
      ${zeile("Rand (mm)", `<input type="number" name="rand" min="0" max="200" value="${gemerkt.rand ?? 0}">`)}
      ${zeile("Randfarbe", `<input type="color" name="randFarbe" value="${gemerkt.randFarbe ?? "#ffffff"}">`)}
      ${felder.map((f) => zeile(f.text, f.art === "farbe"
        ? `<input type="color" name="${f.name}" value="${f.wert}">`
        : `<select name="${f.name}">${optionen(f.optionen, f.wert)}</select>`)).join("")}
      ${zeile("Feinheit", `<select name="qualitaet">${optionen([["fein", "fein (am meisten Punkte, dauert)"], ["mittel", "mittel"], ["schnell", "schnell (Probedruck)"]], gemerkt.qualitaet ?? "mittel")}</select>`)}
      ${zeile("Datei", `<select name="datei">${optionen([["png", "PNG (verlustfrei, groß)"], ["jpeg", "JPEG 95 % (viel kleiner, für Druckereien üblich)"]], gemerkt.datei ?? "png")}</select>`)}
    </div>
    <p class="hinweis druck-masse"></p>
    ${hinweis ? `<p class="hinweis">${hinweis}</p>` : ""}
    <div class="steuerung">
      <button type="button" value="los">Rechnen und speichern</button>
      <button type="button" value="ab">Abbrechen</button>
    </div>`;
  document.body.append(d);

  const feld = (name) => d.querySelector(`[name="${name}"]`);
  function werte() {
    const papier = feld("papier").value;
    let { b, h } = PAPIERE[papier];
    if (papier === "eigen") [b, h] = [Number(feld("eigenB").value) || 400, Number(feld("eigenH").value) || 600];
    if ((feld("lage").value === "quer") === b < h) [b, h] = [h, b]; // eigene Größe: Ausrichtung dreht sie auch
    const dpi = Number(feld("dpi").value);
    const ergebnis = {
      papier, lage: feld("lage").value, dpi, mm: { b, h },
      breite: mmZuPx(b, dpi), hoehe: mmZuPx(h, dpi),
      rand: mmZuPx(Math.max(0, Number(feld("rand").value) || 0), dpi),
      randFarbe: feld("randFarbe").value, qualitaet: feld("qualitaet").value, datei: feld("datei").value,
      eigenB: feld("eigenB").value, eigenH: feld("eigenH").value, randMm: feld("rand").value,
    };
    for (const f of felder) ergebnis[f.name] = feld(f.name).value;
    return ergebnis;
  }
  function zeige() {
    const w = werte();
    d.querySelector(".druck-eigen").hidden = w.papier !== "eigen";
    const mp = (w.breite * w.hoehe) / 1e6;
    const zuGross = w.breite * w.hoehe > MAX_PIXEL || Math.max(w.breite, w.hoehe) > 32000;
    d.querySelector(".druck-masse").textContent = `${w.breite} × ${w.hoehe} Pixel (${mp.toFixed(0)} Megapixel)` +
      (zuGross ? " · zu groß für den Browser: kleineres Papier oder weniger dpi" : mp > 60 ? " · groß: kann eine Weile dauern und viel Speicher brauchen" : "");
    d.querySelector('[value="los"]').disabled = zuGross;
  }
  d.addEventListener("input", zeige);
  d.addEventListener("change", zeige);
  zeige();
  d.showModal();

  return new Promise((fertig) => {
    d.addEventListener("click", (ev) => {
      const k = ev.target.closest("button");
      if (!k) return;
      const w = k.value === "los" ? werte() : null;
      if (w) merke({ papier: w.papier, lage: w.lage, dpi: w.dpi, rand: w.randMm, randFarbe: w.randFarbe, qualitaet: w.qualitaet, datei: w.datei, eigenB: w.eigenB, eigenH: w.eigenH });
      d.close();
      d.remove();
      fertig(w);
    });
    d.addEventListener("cancel", () => {
      d.remove();
      fertig(null);
    });
  });
}

function lies() {
  try {
    return JSON.parse(localStorage.getItem("druck-dialog")) ?? {};
  } catch {
    return {};
  }
}
function merke(w) {
  try {
    localStorage.setItem("druck-dialog", JSON.stringify(w));
  } catch {}
}

// Ein Bild breite × hoehe in Kacheln rechnen. zeichneKachel(x0, y0, groesse) zeichnet das Stück, dessen linke obere
// Ecke bei (x0, y0) im ganzen Bild liegt, in einen Canvas groesse × groesse und gibt ihn zurück. Jede Kachel wird
// mit einem Überstand („ueber“ Pixel auf jeder Seite) gerechnet und nur ihr Inneres übernommen: Was über die
// Nachbarschaft rechnet (weiche Schatten, Fläche aus Mipmaps), sieht an den Nähten dann so aus wie mittendrin.
// fortschritt(anteil) für die Anzeige. Gibt einen 2D-Canvas in voller Größe zurück.
export async function kacheln({ breite, hoehe, kachel, ueber, zeichneKachel, fortschritt = () => {} }) {
  const ganz = document.createElement("canvas");
  ganz.width = breite;
  ganz.height = hoehe;
  const g = ganz.getContext("2d");
  if (!g) throw new Error("So ein großes Bild kann dieser Browser nicht anlegen (zu wenig Speicher).");
  const innen = kachel - 2 * ueber;
  const nx = Math.ceil(breite / innen), ny = Math.ceil(hoehe / innen);
  for (let ty = 0; ty < ny; ty++)
    for (let tx = 0; tx < nx; tx++) {
      const x0 = tx * innen - ueber, y0 = ty * innen - ueber;
      const stueck = await zeichneKachel(x0, y0, kachel, (anteil) => fortschritt((ty * nx + tx + anteil) / (nx * ny)));
      g.drawImage(stueck, ueber, ueber, innen, innen, x0 + ueber, y0 + ueber, innen, innen);
      fortschritt((ty * nx + tx + 1) / (nx * ny));
      await new Promise((r) => setTimeout(r)); // Seite atmen lassen (Fortschritt zeichnen)
    }
  return ganz;
}

// Rand in randFarbe um das Bild (deckt zu, was der Attraktor dort hingezeichnet hat)
export function maleRand(canvas, rand, farbe) {
  if (rand <= 0) return;
  const g = canvas.getContext("2d"), { width: b, height: h } = canvas;
  g.fillStyle = farbe;
  g.fillRect(0, 0, b, rand);
  g.fillRect(0, h - rand, b, rand);
  g.fillRect(0, 0, rand, h);
  g.fillRect(b - rand, 0, rand, h);
}

// ---------- Auflösung in die Datei schreiben ----------

// PNG: Block „pHYs“ (Pixel pro Meter, x und y, Einheit 1 = Meter) direkt nach dem Kopf-Block IHDR einfügen.
// Jeder Block: Länge (4 Byte), Name (4), Inhalt, CRC32 über Name und Inhalt (4).
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngMitDpi(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const block = new Uint8Array(21);
  const v = new DataView(block.buffer);
  v.setUint32(0, 9);
  block.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  block[16] = 1;
  v.setUint32(17, crc32(block.subarray(4, 17)));
  const nachIhdr = 8 + 25; // Signatur (8) + IHDR (4 + 4 + 13 + 4)
  const neu = new Uint8Array(bytes.length + 21);
  neu.set(bytes.subarray(0, nachIhdr));
  neu.set(block, nachIhdr);
  neu.set(bytes.subarray(nachIhdr), nachIhdr + 21);
  return neu;
}
// JPEG: im JFIF-Kopf (APP0) stehen Einheit und Dichte; Einheit 1 = Punkte pro Zoll
function jpegMitDpi(bytes, dpi) {
  const istJfif = bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46;
  if (!istJfif) return bytes;
  const neu = bytes.slice();
  neu[13] = 1;
  neu[14] = dpi >> 8;
  neu[15] = dpi & 255;
  neu[16] = dpi >> 8;
  neu[17] = dpi & 255;
  return neu;
}

export async function speichereDruck(canvas, { datei = "png", dpi = 300 }, name) {
  const typ = datei === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((r) => canvas.toBlob(r, typ, 0.95));
  if (!blob) throw new Error("Das Bild ließ sich nicht kodieren (zu groß für diesen Browser?).");
  const roh = new Uint8Array(await blob.arrayBuffer());
  const bytes = datei === "jpeg" ? jpegMitDpi(roh, dpi) : pngMitDpi(roh, dpi);
  const url = URL.createObjectURL(new Blob([bytes], { type: typ }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${datei === "jpeg" ? "jpg" : "png"}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
