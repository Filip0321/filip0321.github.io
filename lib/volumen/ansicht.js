// Gemeinsame Ansicht für Volumen: Bild, Kamera, Schnitte, Ausblenden, Aufbau, Effekte, Export.
// Benutzt vom Volumen-Viewer (/projekte/volumen, Daten aus Dateien) und von Rayleigh-Taylor
// (/projekte/rayleigh-taylor, Daten aus der Simulation). Was eine Seite zusätzlich hat (Laden, Simulation),
// steht in ihrer eigenen main.js.
//
//   volumen.js   3D-Textur und Strahlen (Volumen, Oberfläche, MIP, Röntgen, Schlieren)
//   tf.js        Transferfunktion (Gewebe-Voreinstellungen für CT, eigene)
//   schnitte.js  axial, koronal, sagittal (und dort mit dem Pinsel ausblenden)
//   maske.js     was ausgeblendet ist (Pinsel, Schere, Stück)
//   sim3d.js     Strömung in 3D (wird hier nicht gebraucht, nur von Rayleigh-Taylor)
//
// Die Seite braucht dieselben Felder wie /projekte/volumen/index.html (feld, stapel, lasso, meldung, info,
// axial/koronal/sagittal, die data-wert-Regler). Fehlt ein Abschnitt (z. B. „Gewebe“ bei der Simulation), wird er
// einfach übersprungen.
//
// erstelleAnsicht({ extra, name, schritt }) gibt zurück:
//   e, setze            die Regler (setze überspringt Namen, die es auf der Seite nicht gibt)
//   zeige(v, gezeigt)   ein Volumen zeigen. v: { b, h, t, werte, abstand, name, ct, min, max }, gezeigt: dasselbe
//                       in kleiner (halbe Auflösung) oder v. Mit v.textur() kommt die 3D-Textur von woanders
//                       (Simulation): die wird dann bei jedem Bild neu genommen.
//   transfer(), zeichneSchnitte(), neu() (beim nächsten Bild neu zeichnen), melde(text)
//   formNeu()           nach geänderter Voxelgröße: Schnitte und Bild neu, alles andere bleibt
//   geladen(), gezeigt(), volumen (die Grafikkarten-Seite, volumen.gl für eigene Rechnungen)
//   schnitteOffen()     ob die Schnitte gerade zu sehen sind (dann lohnt es, Werte auf die CPU zu holen)
//   lage                Ausrichtung lesen und setzen
//   starte()            die Zeichenschleife beginnen
import { erstelleVolumen } from "./volumen.js";
import { GEWEBE, ausPunkten, eigene } from "./tf.js";
import { richteSchnitteEin } from "./schnitte.js";
import { erstelleMaske, merke, rueckgaengig, allesZeigen, pinsel, schere, stueck } from "./maske.js";
import { richteReglerEin } from "/lib/regler.js";
import { hexZuRgb } from "/lib/farben.js";
import { richteExportEin } from "/lib/export.js";
import { endbild, sichtbaresBild, crtZuschnitt } from "/lib/effekt-schicht.js";

// Ausrichtung (spaltenweise wie im Shader). Für CT: Kopf nach oben, Gesicht zur Kamera.
// Die Achsen im CT (DICOM, „LPS“): x zur linken Seite des Patienten, y nach hinten, z zum Kopf. Die Kamera schaut
// am Anfang von +z auf die Mitte, oben ist +y. Also: Welt-x = x, Welt-y = z, Welt-z = −y (Drehung um x um −90°).
export const EINHEIT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const KOPF_OBEN = [1, 0, 0, 0, 0, -1, 0, 1, 0];

const hole = (id) => document.getElementById(id);

export function erstelleAnsicht({ extra = {}, name = () => "volumen", schritt: seitenSchritt = () => {} } = {}) {
  const canvas = hole("feld"); // "feld": so heißt das Bild, das /lib/effekt-schicht.js mit Effekten überzieht
  const stapel = hole("stapel");
  const meldung = hole("meldung");
  const info = hole("info");
  function melde(text) {
    meldung.hidden = !text;
    meldung.textContent = text ?? "";
  }
  let volumen;
  try {
    volumen = erstelleVolumen(canvas);
  } catch (fehler) {
    melde(fehler.message);
    throw fehler;
  }
  const schnitte = richteSchnitteEin(
    { axial: hole("axial"), koronal: hole("koronal"), sagittal: hole("sagittal") },
    (s) => {
      setze("schnittX", s[0]);
      setze("schnittY", s[1]);
      setze("schnittZ", s[2]);
      zeichneSchnitte();
    },
    (q, achse, wann) => malen(q, achse, wann),
    () => e.werkzeug,
  );

  let geladen = null; // in voller Auflösung (die Maske hat diese Größe)
  let vol = null; // was gezeigt wird (vielleicht halbiert)
  let fenster = [0, 1];
  const START_GIER = 0.6;
  const START_NICK = -0.35;
  const START_ABSTAND = 1.8;
  let gier = START_GIER;
  let nick = START_NICK;
  let versatz = { x: 0, y: 0 }; // Kamera parallel zur Bildebene verschieben
  let zeit = 0;
  let aufbauStart = null;
  let exportLaeuft = false;
  let neuZeichnen = true;
  let maske = null;
  let lage = EINHEIT;

  const regler = richteReglerEin({
    beiAenderung: () => (neuZeichnen = true),
    extra: {
      gewebe: () => transfer(),
      von: () => transfer(),
      bis: () => transfer(),
      skala: () => transfer(),
      deckkraft: () => transfer(),
      gamma: () => transfer(),
      schnittX: () => zeichneSchnitte(),
      schnittY: () => zeichneSchnitte(),
      schnittZ: () => zeichneSchnitte(),
      aufbauen: () => (aufbauStart = e.aufbauen ? zeit : null),
      format: () => stelleFormat(),
      ziehen: () => (stapel.style.cursor = e.ziehen === "drehen" ? "" : "crosshair"),
      ...extra,
    },
  });
  const e = regler.einstellung;
  const setze = (n, w) => regler.felder[n] && regler.setze(n, w);

  // ---------- Zeigen ----------
  function zeige(v, gezeigt = v) {
    if (!v) return;
    if (v !== geladen) {
      // neues Volumen: neue Maske, Ausrichtung passend zur Art
      maske = erstelleMaske(v.b, v.h, v.t);
      schnitte.setzeMaske(maske);
      lage = v.ct ? KOPF_OBEN : EINHEIT;
    }
    geladen = v;
    vol = gezeigt;
    try {
      if (vol.textur) volumen.setzeFremd(vol.textur(), vol);
      else volumen.setze(vol);
    } catch (fehler) {
      melde(`Die Grafikkarte nimmt das Volumen nicht (${fehler.message}). „halbe Auflösung“ versuchen.`);
      return;
    }
    schnitte.setze(vol);
    // Regler für das Fenster auf den Wertebereich der Daten stellen
    for (const n of ["von", "bis", "schwelle", "grenze"]) {
      const feld = regler.felder[n];
      if (!feld) continue;
      feld.min = Math.floor(v.min);
      feld.max = Math.ceil(v.max);
      feld.step = v.max - v.min > 50 ? 1 : (v.max - v.min) / 500;
    }
    setze("von", v.ct ? -200 : v.min);
    setze("bis", v.ct ? 1200 : v.max);
    setze("schwelle", v.ct ? 300 : v.min + (v.max - v.min) * 0.5);
    setze("grenze", v.ct ? 200 : Math.round((v.min + (v.max - v.min) * 0.3) * 100) / 100);
    setze("gewebe", v.ct ? "knochen" : "eigen");
    document.querySelectorAll("[data-nur-ct]").forEach((el) => (el.disabled = !v.ct));
    const mb = (v.werte.byteLength / 1e6).toFixed(0);
    info.textContent = `${v.name}: ${v.b} × ${v.h} × ${v.t} Voxel, Voxelgröße ${v.abstand.map((x) => +x.toFixed(2)).join(" × ")}, Werte ${Math.round(v.min)} bis ${Math.round(v.max)}${v.ct ? " (CT, Hounsfield)" : ""}, ${mb} MB` + (vol !== v ? `; gezeigt halbiert: ${vol.b} × ${vol.h} × ${vol.t}` : "");
    transfer();
    zeichneSchnitte();
    melde("");
  }

  // ---------- Transferfunktion ----------
  function transfer() {
    if (!vol) return;
    const gewebe = e.gewebe ?? "eigen";
    const tf = gewebe !== "eigen" && vol.ct ? ausPunkten(GEWEBE[gewebe]) : eigene(e.von, e.bis, e.skala, e.deckkraft, e.gamma);
    fenster = tf.fenster;
    volumen.setzeTf(tf.farben);
    zeichneSchnitte();
    neuZeichnen = true;
  }
  function zeichneSchnitte() {
    // die Schnitte zeigen immer das eigene Fenster (von, bis): beim Röntgen-Lesen braucht man das frei einstellbar
    if (vol) schnitte.zeichne([e.von, e.bis], [e.schnittX, e.schnittY, e.schnittZ]);
  }

  // ---------- Kamera ----------
  let ziehen = null;
  let umriss = null; // Punkte der Schere (Anteile 0 bis 1 im Bild)
  let lassoZeiger = null;
  const finger = new Map(); // pointerId → aktuelle Position, für Zwei-Finger-Gesten
  let zange = null;
  const lassoLinie = document.querySelector("#lasso polyline");
  const begrenze = (wert, min, max) => Math.max(min, Math.min(max, wert));
  function imBild(event) {
    const r = stapel.getBoundingClientRect();
    return [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height];
  }
  function zweiFinger() {
    const [a, b] = [...finger.values()];
    return {
      abstand: Math.hypot(a.x - b.x, a.y - b.y),
      mitte: [(a.x + b.x) / 2, (a.y + b.y) / 2],
    };
  }
  stapel.addEventListener("contextmenu", (event) => event.preventDefault());
  stapel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    stapel.setPointerCapture?.(event.pointerId);
    finger.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (finger.size >= 2) {
      // Zwei Finger: Abstand verändert den Zoom, die Mitte verschiebt das Volumen.
      ziehen = null;
      umriss = null;
      lassoZeiger = null;
      lassoLinie.setAttribute("points", "");
      const g = zweiFinger();
      zange = { ...g, zoom: e.abstand, versatz: { ...versatz } };
      return;
    }
    const schieben = event.button === 2 || event.shiftKey;
    const zoomen = event.altKey || event.ctrlKey;
    if (e.ziehen !== "drehen" && vol && !schieben && !zoomen) {
      umriss = [imBild(event)];
      lassoZeiger = event.pointerId;
      return;
    }
    const feldHoehe = Math.max(1, stapel.clientHeight);
    ziehen = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      gier,
      nick,
      abstand: e.abstand,
      versatz: { ...versatz },
      art: schieben ? "schieben" : zoomen ? "zoomen" : "drehen",
      feldHoehe,
    };
    stapel.classList.add("zieht");
  });
  stapel.addEventListener("pointermove", (event) => {
    if (finger.has(event.pointerId)) finger.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (zange && finger.size >= 2) {
      const jetzt = zweiFinger();
      const f = Math.max(1, jetzt.abstand);
      setze("abstand", begrenze(zange.zoom * zange.abstand / f, 0.6, 5));
      const h = Math.max(1, stapel.clientHeight);
      versatz = {
        x: zange.versatz.x + (jetzt.mitte[0] - zange.mitte[0]) / h,
        y: zange.versatz.y + (jetzt.mitte[1] - zange.mitte[1]) / h,
      };
      neuZeichnen = true;
      return;
    }
    if (umriss && lassoZeiger === event.pointerId) {
      umriss.push(imBild(event));
      lassoLinie.setAttribute("points", umriss.map((p) => p.join(",")).join(" "));
      return;
    }
    if (!ziehen || ziehen.id !== event.pointerId) return;
    const dx = event.clientX - ziehen.x;
    const dy = event.clientY - ziehen.y;
    if (ziehen.art === "schieben") {
      versatz = {
        x: ziehen.versatz.x + dx / ziehen.feldHoehe,
        y: ziehen.versatz.y + dy / ziehen.feldHoehe,
      };
    } else if (ziehen.art === "zoomen") {
      setze("abstand", begrenze(ziehen.abstand * Math.exp(dy * 0.005), 0.6, 5));
    } else {
      gier = ziehen.gier - dx * 0.008;
      nick = begrenze(ziehen.nick - dy * 0.008, -1.5, 1.5);
    }
    neuZeichnen = true;
  });
  for (const art of ["pointerup", "pointercancel"]) stapel.addEventListener(art, (event) => {
    finger.delete(event.pointerId);
    if (finger.size < 2) zange = null;
    if (ziehen?.id === event.pointerId) ziehen = null;
    if (ziehen === null) stapel.classList.remove("zieht");
    if (umriss && lassoZeiger === event.pointerId) {
      if (umriss.length > 2 && art === "pointerup") schneide(umriss);
      umriss = null;
      lassoZeiger = null;
      lassoLinie.setAttribute("points", "");
    }
  });
  stapel.addEventListener("wheel", (event) => {
    event.preventDefault();
    setze("abstand", begrenze(e.abstand * Math.exp(event.deltaY * 0.001), 0.6, 5));
    neuZeichnen = true;
  }, { passive: false });
  stapel.addEventListener("lostpointercapture", (event) => {
    finger.delete(event.pointerId);
    if (finger.size < 2) zange = null;
    if (ziehen?.id === event.pointerId) ziehen = null;
    if (ziehen === null) stapel.classList.remove("zieht");
  });
  hole("kameraZuruecksetzen")?.addEventListener("click", () => {
    gier = START_GIER;
    nick = START_NICK;
    versatz = { x: 0, y: 0 };
    setze("abstand", START_ABSTAND);
    ziehen = null;
    umriss = null;
    lassoZeiger = null;
    zange = null;
    finger.clear();
    lassoLinie.setAttribute("points", "");
    stapel.classList.remove("zieht");
    neuZeichnen = true;
  });

  // ---------- Ausblenden: Schere und Pinsel ----------
  // Schere: den Umriss in ein kleines Bild füllen (das macht der Browser), dann jede Zelle der Maske dort nachsehen
  function schneide(punkte) {
    const breite = Math.min(640, canvas.width);
    const hoehe = Math.round((breite * canvas.height) / canvas.width);
    const bild = new OffscreenCanvas(breite, hoehe);
    const ctx = bild.getContext("2d");
    ctx.beginPath();
    for (const [x, y] of punkte) ctx.lineTo(x * breite, y * hoehe);
    ctx.closePath();
    ctx.fill();
    const pixel = ctx.getImageData(0, 0, breite, hoehe).data;
    const innen = new Uint8Array(breite * hoehe);
    for (let i = 0; i < innen.length; i++) innen[i] = pixel[i * 4 + 3] > 127 ? 1 : 0;
    merke(maske);
    schere(maske, { breite, hoehe, innen }, { lage, dreh: drehung(), abstand: e.abstand, versatz: [versatz.x, versatz.y], seite: canvas.width / canvas.height, groesse: groesse() }, e.ziehen === "schereInnen" ? "innen" : "aussen");
    zeichneSchnitte();
    neuZeichnen = true;
  }
  // echte Ausdehnung, größte Seite 1 (wie im Shader)
  function groesse() {
    const echt = [vol.b * vol.abstand[0], vol.h * vol.abstand[1], vol.t * vol.abstand[2]];
    const m = Math.max(...echt);
    return echt.map((x) => x / m);
  }
  let malZeit = 0;
  function malen(q, achse, wann) {
    if (!maske) return;
    if (e.werkzeug.startsWith("stueck")) {
      // ein Klick: das zusammenhängende Stück unter dem Punkt behalten oder ausblenden
      if (wann !== "anfang") return;
      merke(maske);
      const zellen = stueck(maske, geladen, q, e.grenze, e.werkzeug === "stueckWeg" ? "weg" : "behalten");
      if (!zellen) {
        rueckgaengig(maske);
        melde(`Dort ist nichts über der Grenze (${e.grenze}) oder es ist schon ausgeblendet.`);
      } else melde("");
      zeichneSchnitte();
      neuZeichnen = true;
      return;
    }
    if (wann === "anfang") merke(maske);
    pinsel(maske, q, e.pinsel, groesse(), e.werkzeug === "radieren" ? 0 : 255, e.durchAlle ? achse : -1);
    neuZeichnen = true;
    // die Schnitte neu zeichnen kostet bei großen Scans: höchstens 20-mal pro Sekunde
    const jetzt = performance.now();
    if (jetzt - malZeit > 50 || wann === "anfang") {
      malZeit = jetzt;
      zeichneSchnitte();
    }
  }
  hole("rueckgaengig").addEventListener("click", () => {
    if (maske && rueckgaengig(maske)) {
      zeichneSchnitte();
      neuZeichnen = true;
    }
  });
  hole("allesZeigen").addEventListener("click", () => {
    if (!maske) return;
    allesZeigen(maske);
    zeichneSchnitte();
    neuZeichnen = true;
  });

  // ---------- Ausrichtung und Ansicht ----------
  // 3 × 3 spaltenweise multiplizieren: (A · B)
  function mal(A, B) {
    const C = new Array(9);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) C[3 * j + i] = A[i] * B[3 * j] + A[3 + i] * B[3 * j + 1] + A[6 + i] * B[3 * j + 2];
    return C;
  }
  // 90° um eine Achse der Welt (spaltenweise); spiegeln: links und rechts tauschen
  const DREHE = {
    x: [1, 0, 0, 0, 0, 1, 0, -1, 0],
    y: [0, 0, -1, 0, 1, 0, 1, 0, 0],
    z: [0, 1, 0, -1, 0, 0, 0, 0, 1],
    spiegeln: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  for (const knopf of document.querySelectorAll("[data-lage]")) {
    knopf.addEventListener("click", () => {
      const art = knopf.dataset.lage;
      if (art === "zurueck") lage = vol?.ct ? KOPF_OBEN : EINHEIT;
      else if (art === "roh") lage = EINHEIT;
      else lage = mal(DREHE[art], lage);
      neuZeichnen = true;
    });
  }
  const ANSICHTEN = { vorn: [0, 0], links: [-Math.PI / 2, 0], rechts: [Math.PI / 2, 0], hinten: [Math.PI, 0], oben: [0, -1.5], unten: [0, 1.5] };
  for (const knopf of document.querySelectorAll("[data-ansicht]")) {
    knopf.addEventListener("click", () => {
      [gier, nick] = ANSICHTEN[knopf.dataset.ansicht];
      versatz = { x: 0, y: 0 };
      neuZeichnen = true;
    });
  }
  // Drehmatrix aus gier (um die senkrechte Achse) und nick; Spalten für GLSL (mat3 ist spaltenweise)
  function drehung() {
    const cg = Math.cos(gier), sg = Math.sin(gier), cn = Math.cos(nick), sn = Math.sin(nick);
    // R = R_y(gier) · R_x(nick)
    return [cg, 0, -sg, sg * sn, cn, cg * sn, sg * cn, -sn, cg * cn];
  }
  function stelleFormat() {
    const alt = { quer: 16 / 9, quadrat: 1, hoch: 9 / 16 }[e.format];
    const [b, h] = (e.format ?? "16:9").split(":").map(Number);
    const ratio = alt ?? (b > 0 && h > 0 ? b / h : 16 / 9);
    stapel.style.setProperty("--format", ratio);
    stapel.style.setProperty("--verhaeltnis", ratio);
    neuZeichnen = true;
  }

  // ---------- Zeichnen ----------
  function schritt(dt) {
    zeit += dt;
    seitenSchritt(dt); // z. B. die Simulation weiterrechnen
    if (e.drehen) {
      gier += e.drehTempo * dt;
      neuZeichnen = true;
    }
    if (aufbauStart !== null) neuZeichnen = true;
  }
  function zeichne() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const b = Math.max(16, Math.round(stapel.clientWidth * dpr * e.bildAufloesung));
    const h = Math.max(16, Math.round(stapel.clientHeight * dpr * e.bildAufloesung));
    if (!exportLaeuft && (canvas.width !== b || canvas.height !== h)) {
      canvas.width = b;
      canvas.height = h;
    }
    if (!vol) return;
    // Aufbau: die Box wächst Schicht für Schicht entlang einer Achse, in die gewählte Richtung
    // (z vorwärts ist wie der Scanner aufnimmt: vom Fuß zum Kopf). „immer wieder“: nach dem Ende kurz ganz, dann neu.
    const von = [e.xVon, e.yVon, e.zVon];
    const bis = [e.xBis, e.yBis, e.zBis];
    if (aufbauStart !== null) {
      let s = (zeit - aufbauStart) / e.aufbauDauer;
      s = e.aufbauSchleife ? Math.min(1, s % 1.25) : Math.min(1, s);
      const k = { x: 0, y: 1, z: 2 }[e.aufbauRichtung[0]];
      if (e.aufbauRichtung[1] === "+") bis[k] = von[k] + s * (bis[k] - von[k]);
      else von[k] = bis[k] - s * (bis[k] - von[k]);
    }
    if (maske?.geaendert) volumen.setzeMaske(maske);
    if (vol.textur) volumen.setzeFremd(vol.textur(), vol); // die Simulation rechnet abwechselnd in zwei Texturen
    volumen.zeige({
      // MIP zeigt Graustufen im Fenster der Schnitte (von, bis), alles andere das der Transferfunktion
      fenster: e.art === "mip" ? [e.von, e.bis] : fenster,
      art: { volumen: 0, oberflaeche: 1, mip: 2, roentgen: 3, schlieren: 4 }[e.art],
      schlierenArt: Number(e.schlierenArt ?? 0),
      schlierenStaerke: e.schlierenStaerke ?? 1,
      messerWinkel: e.messerWinkel ?? 0,
      schwelle: e.schwelle ?? 0.5,
      dichte: e.dichte,
      schritt: e.schritt,
      licht: e.licht ?? 0.8,
      grund: hexZuRgb(e.grund).map((x) => x / 255),
      oberFarbe: hexZuRgb(e.oberFarbe ?? "#e9dcc4").map((x) => x / 255),
      dreh: drehung(),
      lage,
      abstand: e.abstand,
      versatz: [versatz.x, versatz.y],
      boxVon: von,
      boxBis: bis,
    });
  }

  let vorher = performance.now();
  function schleife(jetzt) {
    const dt = Math.min(0.05, Math.max(0, (jetzt - vorher) / 1000));
    vorher = jetzt;
    if (!exportLaeuft) {
      schritt(dt);
      // nur neu rechnen, wenn sich etwas geändert hat (große Volumen kosten viel)
      // (gerundet vergleichen wie in zeichne(), sonst ist es nie gleich und es würde jedes Bild neu gerechnet)
      if (neuZeichnen || Math.max(16, Math.round(stapel.clientWidth * Math.min(devicePixelRatio || 1, 2) * e.bildAufloesung)) !== canvas.width) {
        zeichne();
        neuZeichnen = false;
      }
    }
    requestAnimationFrame(schleife);
  }

  // ---------- Export ----------
  let anhalten = () => {}; // die Seite sagt, wie man ihre eigene Bewegung (Simulation) in der Vorschau anhält
  const render = {
    start() {
      exportLaeuft = true;
    },
    bild(i, dt) {
      schritt(dt);
      zeichne();
    },
    ende() {
      exportLaeuft = false;
      neuZeichnen = true;
    },
    merke() {
      const alt = { gier, zeit, aufbauStart };
      return () => {
        ({ gier, zeit, aufbauStart } = alt); // (nicht die Maske: die ändert sich beim Rendern nicht)
        neuZeichnen = true;
      };
    },
    vorschau(i, n, dt) {
      // eine Simulation lässt sich nicht zurückspulen: in der Vorschau steht sie still
      const weiter = anhalten();
      for (let j = 0; j < i; j++) schritt(dt);
      weiter?.();
      zeichne();
    },
  };
  richteExportEin({
    canvas,
    ziel: document.querySelector(".export"),
    name,
    anzeige: sichtbaresBild,
    endbild,
    render,
    zuschnitt: crtZuschnitt,
  });
  stelleFormat();

  return {
    e,
    setze,
    zeige,
    transfer,
    zeichneSchnitte,
    melde,
    volumen,
    neu: () => (neuZeichnen = true),
    formNeu() {
      schnitte.setze(vol);
      zeichneSchnitte();
      neuZeichnen = true;
    },
    geladen: () => geladen,
    gezeigt: () => vol,
    schnitteOffen: () => hole("schnitteAbschnitt")?.open ?? false,
    beiVorschau: (f) => (anhalten = f),
    get lage() {
      return lage;
    },
    set lage(l) {
      lage = l;
      neuZeichnen = true;
    },
    starte: () => requestAnimationFrame(schleife),
  };
}
