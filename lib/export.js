import { erstelleExportDialog, mitRahmen } from "/lib/export-dialog.js";

const MAX_SEKUNDEN = 30; // Rendern: Bild für Bild dauert, darum kurz
const MAX_LIVE = 600; // Live: höchstens 10 Minuten (auch wenn "bis Stopp" eingestellt ist)
export const FPS = 30; // Bildrate beim Rendern

export function ladeHerunter(blob, dateiname) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Canvas als Bild herunterladen: typ "png" (verlustfrei) oder "webp" (viel kleiner, fürs Web)
// name ohne Endung; kann der Browser kein WebP (manche Safari), wird es eben PNG
export function speichereCanvas(canvas, typ, name) {
  const mime = typ === "webp" ? "image/webp" : "image/png";
  return new Promise((fertig, fehler) => {
    canvas.toBlob((blob) => {
      if (!blob) return fehler(new Error("Das Bild konnte nicht erstellt werden."));
      const endung = blob.type === "image/webp" ? "webp" : "png"; // was wirklich herauskam
      ladeHerunter(blob, `${name}.${endung}`);
      fertig();
    }, mime, 0.92); // 0,92: WebP-Qualität, kaum sichtbare Verluste
  });
}

export function zeitstempel() {
  const jetzt = new Date();
  const zwei = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}${zwei(jetzt.getMonth() + 1)}${zwei(jetzt.getDate())}`
    + `-${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}${zwei(jetzt.getSeconds())}`;
}

function knopf(text) {
  const k = document.createElement("button");
  k.type = "button";
  k.textContent = text;
  return k;
}

// gibt dem Browser kurz die Kontrolle zurück, damit er die Seite neu zeichnen kann
export function warte() {
  return new Promise((weiter) => setTimeout(weiter, 0));
}

// Dateitypen: was in welchen Behälter darf. MP4: H.264 + AAC läuft überall (Handy, WhatsApp, DaVinci);
// WebM: nur die freien Codecs (VP9, AV1, VP8 mit Opus), kleiner und gut fürs Web, aber Handys und WhatsApp mögen es nicht
const BEHAELTER = {
  mp4: { bild: ["avc", "vp9", "av1", "vp8"], ton: ["aac", "opus"], mime: "video/mp4" },
  webm: { bild: ["vp9", "av1", "vp8"], ton: ["opus"], mime: "video/webm" },
};

// erster Codec, den dieser Browser in dieser Größe kodieren kann, sonst null
// bei MP4 avc (H.264) zuerst, weil es überall abspielbar ist, auch in DaVinci
function waehleCodec(w, h, typ) {
  return Mediabunny.getFirstEncodableVideoCodec(BEHAELTER[typ].bild, {
    width: w,
    height: h,
    quality: Mediabunny.QUALITY_HIGH,
  });
}

// AudioBuffer -> WAV-Datei (16 Bit PCM), die jedes Programm öffnet (Ableton, DaVinci, …)
// Eine WAV ist fast nur rohe Samples: vorne 44 Bytes Kopf, der sagt, wie man sie lesen muss
export function zuWav(puffer) {
  const kanaele = puffer.numberOfChannels;
  const rate = puffer.sampleRate;
  const bytesProSample = 2; // 16 Bit
  const datenBytes = puffer.length * kanaele * bytesProSample;
  const bytes = new DataView(new ArrayBuffer(44 + datenBytes)); // DataView: Zahlen byteweise hineinschreiben
  const text = (pos, wort) => {
    for (let i = 0; i < wort.length; i++) bytes.setUint8(pos + i, wort.charCodeAt(i));
  };

  // Kopf; true = "little endian" (kleinstes Byte zuerst), so will es das WAV-Format
  text(0, "RIFF");
  bytes.setUint32(4, 36 + datenBytes, true); // Größe der Datei ab hier
  text(8, "WAVE");
  text(12, "fmt ");
  bytes.setUint32(16, 16, true); // Länge des fmt-Teils
  bytes.setUint16(20, 1, true); // 1 = PCM, unkomprimiert
  bytes.setUint16(22, kanaele, true);
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * kanaele * bytesProSample, true); // Bytes pro Sekunde
  bytes.setUint16(32, kanaele * bytesProSample, true); // Bytes pro Zeitpunkt (alle Kanäle)
  bytes.setUint16(34, 16, true); // Bits pro Sample
  text(36, "data");
  bytes.setUint32(40, datenBytes, true);

  // Samples abwechselnd pro Kanal (L R L R …), von -1..1 auf -32768..32767
  const kanalDaten = [];
  for (let k = 0; k < kanaele; k++) kanalDaten.push(puffer.getChannelData(k));
  let pos = 44;
  for (let i = 0; i < puffer.length; i++) {
    for (let k = 0; k < kanaele; k++) {
      const s = Math.max(-1, Math.min(1, kanalDaten[k][i])); // kappen, sonst kippt es ins Gegenteil
      bytes.setInt16(pos, s < 0 ? s * 32768 : s * 32767, true);
      pos += 2;
    }
  }
  return new Blob([bytes], { type: "audio/wav" });
}

// erster Audio-Codec, den dieser Browser kodieren kann, sonst null
// aac zuerst (läuft überall, auch in DaVinci), opus als Ersatz (Chromium unter Linux kann kein AAC)
// Firefox (auch Zen) kann AAC nicht selbst kodieren und nähme dann Opus.
// Opus in MP4 spielen Handys und WhatsApp oft nicht ab. Darum dort den AAC-Encoder
// nachladen (lib/mediabunny-aac-encoder.js: FFmpeg als WebAssembly, ~1 MB) und anmelden.
// Erst bei Bedarf geladen: Chrome und Edge können AAC selbst und laden die Datei nie
let aacGeladen = false; // der AAC-Encoder ist da (nur einmal laden)

function ladeSkript(pfad) {
  return new Promise((fertig, fehler) => {
    const skript = document.createElement("script");
    skript.src = pfad;
    skript.onload = fertig;
    skript.onerror = () => fehler(new Error(`${pfad} konnte nicht geladen werden`));
    document.head.append(skript);
  });
}

export async function waehleTonCodec(kanaele, rate, typ) {
  const optionen = { numberOfChannels: kanaele, sampleRate: rate, quality: Mediabunny.QUALITY_HIGH };
  if (typ === "webm") return Mediabunny.getFirstEncodableAudioCodec(BEHAELTER.webm.ton, optionen); // WebM: kein AAC
  // Klappt das Laden nicht (Netz, Speicher), wird es beim nächsten Video wieder versucht,
  // statt für den Rest der Seite still bei Opus zu bleiben
  if (!aacGeladen && !(await Mediabunny.canEncodeAudio("aac", optionen))) {
    try {
      if (typeof MediabunnyAacEncoder === "undefined") await ladeSkript("/lib/mediabunny-aac-encoder.js"); // setzt MediabunnyAacEncoder
      MediabunnyAacEncoder.registerAacEncoder(); // ab jetzt kann Mediabunny AAC
      aacGeladen = true;
    } catch (fehler) {
      console.warn("Kein AAC, der Ton wird Opus:", fehler); // dann eben Opus, das Video geht trotzdem
    }
  }
  return Mediabunny.getFirstEncodableAudioCodec(["aac", "opus"], optionen);
}

// Ausschnitt eines AudioBuffers (Samples von "von" bis vor "bis"), alle Kanäle.
// Damit bekommt das Video seinen Ton Bild für Bild statt alles auf einmal. null, wenn leer
export function schneideTon(puffer, von, bis) {
  const laenge = Math.min(bis, puffer.length) - von;
  if (laenge <= 0) return null;
  const stueck = new AudioBuffer({
    length: laenge,
    numberOfChannels: puffer.numberOfChannels,
    sampleRate: puffer.sampleRate,
  });
  for (let k = 0; k < puffer.numberOfChannels; k++) {
    // subarray: ein Blick auf einen Teil der Liste, ohne zu kopieren; copyToChannel kopiert dann einmal
    stueck.copyToChannel(puffer.getChannelData(k).subarray(von, von + laenge), k);
  }
  return stueck;
}

// Firefox (auch Zen) schreibt die Beschreibung des H.264-Stroms (avcC) fehlerhaft:
// das erste Byte jeder SPS und PPS steht doppelt drin ("67 67 64 …" statt "67 64 …").
// Normale Player lesen darüber hinweg, WhatsApp lehnt das Video ab. Hier wird sie vor dem Speichern neu gebaut.
// Aufbau (avcC): Version, Profil, Kompatibilität, Level, Längenfeld, Anzahl SPS, je SPS (2 Byte Länge + Daten),
// Anzahl PPS, je PPS (2 Byte Länge + Daten), bei High-Profil noch 4 Byte Farbformat
function repariereAvcBeschreibung(beschreibung) {
  const b = ArrayBuffer.isView(beschreibung)
    ? new Uint8Array(beschreibung.buffer, beschreibung.byteOffset, beschreibung.byteLength)
    : new Uint8Array(beschreibung);
  let pos = 6;
  // n Einträge lesen: je 2 Byte Länge, dann die Daten; doppelten Kopf (erstes Byte = zweites) entfernen
  const lies = (n) => {
    const liste = [];
    for (let i = 0; i < n; i++) {
      const laenge = (b[pos] << 8) | b[pos + 1];
      let daten = b.subarray(pos + 2, pos + 2 + laenge);
      pos += 2 + laenge;
      if (daten.length > 1 && daten[0] === daten[1]) daten = daten.subarray(1);
      liste.push(daten);
    }
    return liste;
  };
  const sps = lies(b[5] & 31);
  const pps = lies(b[pos++]);
  const neu = [1, b[1], b[2], b[3], 0xfc | (b[4] & 3), 0xe0 | sps.length];
  for (const nal of sps) neu.push(nal.length >> 8, nal.length & 255, ...nal);
  neu.push(pps.length);
  for (const nal of pps) neu.push(nal.length >> 8, nal.length & 255, ...nal);
  if ([100, 110, 122, 144].includes(b[1])) neu.push(0xfd, 0xf8, 0xf8, 0); // High: 4:2:0, 8 Bit, keine Erweiterung
  return new Uint8Array(neu);
}

// Sicherheitsnetz für die fertige Datei: steht in der avcC-Box noch die kaputte Firefox-Beschreibung
// (passiert sie aus irgendeinem Grund den Hook oben), wird sie hier in der fertigen MP4 ersetzt.
// Eine MP4 ist eine Schachtel aus Boxen (je 4 Byte Größe, 4 Byte Name, Inhalt). Wird avcC länger,
// müssen alle Boxen darum mitwachsen, und weil moov vor den Daten liegt, verschieben sich deren Adressen (stco).
const HUELLEN = { moov: 8, trak: 8, mdia: 8, minf: 8, stbl: 8, stsd: 16, avc1: 86, avc3: 86 }; // Kopfgröße je Box
export function repariereMp4(puffer) {
  const d = new Uint8Array(puffer);
  const lies32 = (i) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
  const schreib32 = (z, i, wert) => z.set([wert >>> 24, (wert >>> 16) & 255, (wert >>> 8) & 255, wert & 255], i);
  const name = (i) => String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
  // Pfad bis zur avcC-Box suchen: [{ anfang, groesse, typ }, …]
  function suche(von, bis, pfad) {
    for (let i = von; i + 8 <= bis; ) {
      const groesse = lies32(i);
      const typ = name(i);
      if (groesse < 8) return null; // 64-Bit-Größen kommen hier nicht vor
      if (typ === "avcC") return [...pfad, { anfang: i, groesse, typ }];
      if (typ in HUELLEN) {
        const treffer = suche(i + HUELLEN[typ], i + groesse, [...pfad, { anfang: i, groesse, typ }]);
        if (treffer) return treffer;
      }
      i += groesse;
    }
    return null;
  }
  const pfad = suche(0, d.length, []);
  if (!pfad) return puffer; // kein H.264
  const avcc = pfad.at(-1);
  const alt = d.subarray(avcc.anfang + 8, avcc.anfang + avcc.groesse);
  const sps = alt[8]; // erstes Byte der ersten SPS
  if (!(sps === alt[9] && (alt[4] & 0xfc) !== 0xfc)) return puffer; // schon in Ordnung
  const neu = repariereAvcBeschreibung(alt);
  const unterschied = neu.length - alt.length;
  const ergebnis = new Uint8Array(d.length + unterschied);
  ergebnis.set(d.subarray(0, avcc.anfang));
  schreib32(ergebnis, avcc.anfang, 8 + neu.length);
  ergebnis.set(d.subarray(avcc.anfang + 4, avcc.anfang + 8), avcc.anfang + 4); // Name "avcC"
  ergebnis.set(neu, avcc.anfang + 8);
  ergebnis.set(d.subarray(avcc.anfang + avcc.groesse), avcc.anfang + 8 + neu.length);
  for (const huelle of pfad.slice(0, -1)) schreib32(ergebnis, huelle.anfang, huelle.groesse + unterschied);
  // liegen die Daten (mdat) hinter moov, verschieben sich alle Chunk-Adressen (stco) um den Unterschied
  const moov = pfad[0];
  const moovEnde = moov.anfang + moov.groesse + unterschied;
  const lies = (i) => ((ergebnis[i] << 24) | (ergebnis[i + 1] << 16) | (ergebnis[i + 2] << 8) | ergebnis[i + 3]) >>> 0;
  let mdatDahinter = false;
  for (let i = 0; i + 8 <= ergebnis.length; i += lies(i)) {
    const typ = String.fromCharCode(...ergebnis.subarray(i + 4, i + 8));
    if (typ === "mdat") mdatDahinter = i > moov.anfang;
    if (lies(i) < 8) break;
  }
  if (mdatDahinter) {
    // stco nur in moov suchen (klein), nicht in den Videodaten
    for (let k = moov.anfang; k + 16 <= moovEnde; k++) {
      if (ergebnis[k + 4] !== 0x73 || ergebnis[k + 5] !== 0x74 || ergebnis[k + 6] !== 0x63 || ergebnis[k + 7] !== 0x6f) continue; // "stco"
      const anzahl = lies(k + 12);
      for (let e = 0; e < anzahl; e++) schreib32(ergebnis, k + 16 + 4 * e, lies(k + 16 + 4 * e) + unterschied);
    }
  }
  console.info("H.264-Beschreibung in der fertigen Datei repariert");
  return ergebnis.buffer;
}

// Eine Aufnahme: eigener Canvas mit festen, geraden Maßen und eine MP4-Ausgabe
// fps nur beim Rendern; live sind die Abstände unregelmäßig
// hintergrund: Farbe hinter durchsichtigen Stellen (Foto-Effekte geben zustand.hintergrund mit)
// ton: null (stumm, wie bisher) oder { kanaele, rate } -> mit Tonspur, gefüttert über aufnahme.ton(puffer)
// typ: "mp4" (Standard) oder "webm"; die fertige Aufnahme sagt in endung, wie die Datei heißen muss
export async function neueAufnahme(vorlage, fps, hintergrund = "#111111", ton = null, typ = "mp4") {
  const w = vorlage.width - (vorlage.width % 2); // H.264 verlangt gerade Maße
  const h = vorlage.height - (vorlage.height % 2);

  const codec = await waehleCodec(w, h, typ);
  if (!codec) {
    throw new Error(`Dein Browser kann kein Video in ${w}×${h} kodieren.`);
  }
  console.info(`Video: ${codec}, ${w}×${h}`);

  const leinwand = document.createElement("canvas");
  leinwand.width = w;
  leinwand.height = h;
  const ctx = leinwand.getContext("2d");

  const output = new Mediabunny.Output({
    format: typ === "webm" ? new Mediabunny.WebMOutputFormat() : new Mediabunny.Mp4OutputFormat(),
    target: new Mediabunny.BufferTarget(),
  });
  const quelle = new Mediabunny.CanvasSource(leinwand, {
    codec,
    quality: Mediabunny.QUALITY_VERY_HIGH,
    // vor dem Speichern jedes Bildes: kaputte H.264-Beschreibung von Firefox reparieren (siehe oben)
    onEncodedPacket: (paket, meta) => {
      const beschreibung = meta?.decoderConfig?.description;
      if (codec === "avc" && beschreibung) meta.decoderConfig.description = repariereAvcBeschreibung(beschreibung);
    },
  });
  output.addVideoTrack(quelle, fps ? { frameRate: fps } : {});

  // Tonspur muss vor start() angemeldet sein, wie die Bildspur
  let tonQuelle = null;
  let tonCodec = null; // bleibt null bei stummen Videos
  if (ton) {
    tonCodec = await waehleTonCodec(ton.kanaele, ton.rate, typ);
    if (!tonCodec) {
      throw new Error("Dein Browser kann keinen Ton für das Video kodieren.");
    }
    console.info(`Ton: ${tonCodec}, ${ton.kanaele} Kanäle, ${ton.rate} Hz`);
    tonQuelle = new Mediabunny.AudioBufferSource({ codec: tonCodec, bitrate: Mediabunny.QUALITY_HIGH });
    output.addAudioTrack(tonQuelle);
  }
  await output.start();

  return {
    endung: typ, // "mp4" oder "webm", für den Dateinamen
    codec, // gewählte Codecs, z. B. "avc" und "aac": Handys und WhatsApp wollen genau diese zwei
    tonCodec,
    // Bild sofort kopieren (synchron), dann kodieren lassen (asynchron)
    bild(canvas, zeit, dauer) {
      // Video kennt keine Transparenz; ohne Füllen würden durchsichtige
      // Stellen das vorige Bild durchscheinen lassen
      ctx.fillStyle = hintergrund;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(canvas, 0, 0, w, h);
      return quelle.add(zeit, dauer);
    },
    // Ton anhängen: jeder Puffer kommt direkt hinter den vorigen (der erste bei 0 s).
    // Am besten im gleichen Tempo wie die Bilder füttern, nicht alles auf einmal:
    // die MP4 legt Bild und Ton abwechselnd ab und wartet sonst auf die langsamere Spur
    ton(puffer) {
      return tonQuelle.add(puffer);
    },
    async fertig() {
      quelle.close();
      tonQuelle?.close();
      await output.finalize();
      const datei = codec === "avc" ? repariereMp4(output.target.buffer) : output.target.buffer;
      return new Blob([datei], { type: BEHAELTER[typ].mime });
    },
    abbrechen() {
      return output.cancel();
    },
  };
}

export function richteExportEin({
  canvas,                  // das Feld der Simulation (bestimmt die Videogröße)
  ziel,                    // wohin die Knöpfe kommen
  name,                    // Dateiname, Text oder Funktion
  anzeige = () => canvas,  // was gerade zu sehen ist (Bild speichern, Live, Vorschau)
  endbild = () => canvas,  // fertiges Bild zur Zeit t in Sekunden (Rendern)
  render = null,           // { start(n), bild(i, dt), ende(), merke(), vorschau(i, n, dt) } oder null
  zuschnitt = () => null,  // CRT: welcher Anteil mittig bleibt, wenn die gewölbten Ränder weg sollen (null = nichts)
}) {
  // render.merke():           merkt sich den Zustand, gibt eine Funktion zurück, die ihn wiederherstellt
  // render.vorschau(i, n, dt): direkt Bild i von n zeigen (gleich nach start), ohne die Bilder davor
  // fehlen beide, rechnet die Vorschau alle Bilder bis i nacheinander (langsamer)
  const dateiname = () => {
    const basis = typeof name === "function" ? name() : name;
    return `${basis}-${zeitstempel()}`;
  };

  const bildKnopf = knopf("Bild speichern");
  const liveKnopf = knopf("Live aufnehmen");
  const renderKnopf = knopf("Video rendern");
  ziel.append(bildKnopf, liveKnopf);
  if (render) ziel.append(renderKnopf);

  // Sekunden stehen im Export-Fenster (nur beim Video zu sehen)
  const felder = document.createElement("div");
  felder.className = "steuerung nur-video";
  const label = document.createElement("label");
  const sekundenFeld = document.createElement("input");
  sekundenFeld.type = "number";
  sekundenFeld.min = 0;
  sekundenFeld.max = MAX_LIVE;
  sekundenFeld.step = 1;
  sekundenFeld.value = 5;
  const sekundenText = document.createElement("span");
  label.append(sekundenText, sekundenFeld);
  felder.append(label);

  let modus = "bild"; // "bild", "live" oder "video": welches Fenster gerade offen ist
  let zurueck = null; // stellt den Zustand von vor der Vorschau wieder her (render.merke)

  // Video: Bild i von n zeigen, immer vom gemerkten Zustand aus
  function zeigeRenderBild(i, n) {
    zurueck?.();
    render.start(n);
    if (render.vorschau) render.vorschau(i, n, 1 / FPS);
    else for (let j = 0; j <= i; j++) render.bild(j, 1 / FPS);
  }

  // das Häkchen "CRT: Rahmen über die gewölbten Ränder" steht im Fenster selbst (zuschnitt),
  // der Anteil kommt dann in den Einstellungen mit (einst.anteil), mitRahmen schneidet danach zu
  const fenster = erstelleExportDialog({
    felder,
    zuschnitt,
    zeichneVorschau: (allgemein, zeit) => {
      if (modus === "video" && zeit !== null) {
        const n = Math.round(leseSekunden() * FPS);
        const i = Math.min(n - 1, Math.round(zeit * (n - 1)));
        zeigeRenderBild(i, n);
        return mitRahmen(endbild(i / FPS), allgemein);
      }
      return mitRahmen(anzeige(), allgemein); // Bild und Live: was gerade zu sehen ist
    },
  });

  const bedienung = [bildKnopf, liveKnopf, renderKnopf];
  function sperre(gesperrt, ausser = null) {
    for (const element of bedienung) {
      if (element !== ausser) element.disabled = gesperrt;
    }
  }

  // Live darf 0 haben (= bis Stopp), Rendern braucht mindestens 1 Sekunde
  function leseSekunden() {
    const live = modus === "live";
    let sekunden = Math.round(Number(sekundenFeld.value));
    if (!Number.isFinite(sekunden)) sekunden = 5;
    sekunden = Math.min(Math.max(sekunden, live ? 0 : 1), live ? MAX_LIVE : MAX_SEKUNDEN);
    sekundenFeld.value = sekunden;
    return sekunden;
  }

  function oeffne(neuerModus, ueberschrift, optionen = {}) {
    modus = neuerModus;
    sekundenText.textContent = modus === "live" ? "Sekunden (0 = bis Stopp) " : "Sekunden ";
    return fenster.oeffne({ art: modus === "bild" ? "bild" : "video", ueberschrift, ...optionen });
  }

  bildKnopf.addEventListener("click", async () => {
    const einst = await oeffne("bild", "Bild speichern");
    if (!einst) return; // abgebrochen
    await speichereCanvas(mitRahmen(anzeige(), einst), einst.bildTyp, dateiname());
  });

  if (typeof Mediabunny === "undefined" || typeof VideoEncoder === "undefined") {
    for (const k of [liveKnopf, renderKnopf]) {
      k.disabled = true;
      k.title = "Dein Browser kann keine Videos kodieren.";
    }
    return;
  }

  // ein Canvas für alle Bilder eines Videos: jedes Bild bekommt denselben Rahmen
  function rahmenFuer(einst) {
    const leinwand = document.createElement("canvas");
    return (quelle) => mitRahmen(quelle, einst, leinwand); // einst.anteil steht fest, die Größe ändert sich nicht
  }

  // Live: nimmt auf, was gerade passiert, auch Ziehen und Malen
  // Zeit = echte Zeit; schafft der Kodierer ein Bild nicht, wird es ausgelassen
  // Start mit dem Knopf, Stopp mit demselben Knopf oder nach den eingestellten Sekunden (0 = nur mit dem Knopf)

  let liveLaeuft = false;
  let stoppGewuenscht = false;

  function nimmLiveAuf(aufnahme, sekunden, bildMitRahmen) {
    return new Promise((fertig, fehlschlag) => {
      let start = null;
      let offen = null; // Bild, das gerade kodiert wird
      let fehler = null;
      const grenze = sekunden > 0 ? sekunden : MAX_LIVE; // ohne Angabe: bis Stopp (höchstens MAX_LIVE)

      function takt(zeitpunkt) {
        start ??= zeitpunkt;
        const t = (zeitpunkt - start) / 1000;

        if (stoppGewuenscht || fehler || t >= grenze) {
          Promise.resolve(offen).then(() => (fehler ? fehlschlag(fehler) : fertig()));
          return;
        }

        liveKnopf.textContent = sekunden > 0 ? `Stopp … ${Math.ceil(sekunden - t)} s` : `Stopp (${Math.floor(t)} s)`;

        if (!offen) {
          offen = aufnahme.bild(bildMitRahmen(anzeige()), t, 0)
            .catch((e) => { fehler = e; })
            .finally(() => { offen = null; });
        }

        requestAnimationFrame(takt);
      }

      requestAnimationFrame(takt);
    });
  }

  liveKnopf.addEventListener("click", async () => {
    if (liveLaeuft) {
      stoppGewuenscht = true; // zweiter Klick beendet die Aufnahme
      return;
    }
    const einst = await oeffne("live", "Live aufnehmen", { zeit: false });
    if (!einst) return;

    liveLaeuft = true;
    stoppGewuenscht = false;
    sperre(true, liveKnopf);
    let aufnahme = null;

    try {
      const sekunden = leseSekunden();
      const bildMitRahmen = rahmenFuer(einst);
      aufnahme = await neueAufnahme(bildMitRahmen(anzeige()), undefined, undefined, null, einst.videoTyp); // Größe mit Rahmen
      await nimmLiveAuf(aufnahme, sekunden, bildMitRahmen);
      liveKnopf.textContent = "Speichern …";
      ladeHerunter(await aufnahme.fertig(), `${dateiname()}.${aufnahme.endung}`);
    } catch (fehler) {
      console.error(fehler);
      await aufnahme?.abbrechen();
      alert(`Die Aufnahme ist fehlgeschlagen: ${fehler.message}`);
    } finally {
      liveLaeuft = false;
      liveKnopf.textContent = "Live aufnehmen";
      sperre(false);
    }
  });

  // Rendern: Bild für Bild, Zeit = i / FPS, egal wie lange ein Bild dauert
  // dadurch ruckelfrei, aber ohne Eingriffe während der Aufnahme

  if (!render) return;

  renderKnopf.addEventListener("click", async () => {
    // Zustand merken und anhalten: die Vorschau springt durchs Video und stellt danach alles zurück
    zurueck = render.merke?.() ?? null;
    render.start(Math.round(leseSekunden() * FPS));
    const einst = await oeffne("video", "Video rendern", { laenge: () => leseSekunden() });
    zurueck?.(); // vor dem Rendern (oder Abbrechen) wieder der Zustand von vorher
    zurueck = null;
    if (!einst) {
      render.ende();
      return;
    }
    sperre(true);
    let aufnahme = null;
    let gestartet = false;

    try {
      const sekunden = leseSekunden();
      const n = Math.round(sekunden * FPS);
      // Bereich: nur die Bilder von erstes bis letztes kommen ins Video, gerechnet werden alle bis letztes
      const erstes = Math.round(einst.von * (n - 1));
      const letztes = Math.max(erstes, Math.round(einst.bis * (n - 1)));
      const bildMitRahmen = rahmenFuer(einst);
      aufnahme = await neueAufnahme(bildMitRahmen(anzeige()), FPS, undefined, null, einst.videoTyp);

      render.start(n);
      gestartet = true;

      for (let i = 0; i <= letztes; i++) {
        render.bild(i, 1 / FPS);
        if (i >= erstes) {
          const t = (i - erstes) / FPS; // Zeit im Video fängt beim Bereich an
          await aufnahme.bild(bildMitRahmen(endbild(i / FPS)), t, 1 / FPS);
        }
        renderKnopf.textContent = `Rendern … ${Math.round(((i + 1) / (letztes + 1)) * 100)} %`;
        await warte();
      }

      renderKnopf.textContent = "Speichern …";
      ladeHerunter(await aufnahme.fertig(), `${dateiname()}.${aufnahme.endung}`);
    } catch (fehler) {
      console.error(fehler);
      await aufnahme?.abbrechen();
      alert(`Beim Rendern ist ein Fehler aufgetreten: ${fehler.message}`);
    } finally {
      if (gestartet) render.ende();
      renderKnopf.textContent = "Video rendern";
      sperre(false);
    }
  });
}
