import { ladeBild, rastere, zeigeRaster, zeigeOriginal, 
         originalBild, rastertBild, dateiName, schneide,
         setzeOriginal, rasterAlsBild, fotoBild } from "./bild.js";
import { waehleFarbskala } from "/lib/farben.js";
import { erzeugeTon, alsAudioBuffer, zeileZuFrequenz, rueckwaerts } from "./ton.js";
import { zuWav, ladeHerunter, zeitstempel } from "/lib/export.js";
import { passeGroesseAn, setzeSkala } from "./kopf.js";
import { erstelleExportDialog } from "/lib/export-dialog.js";
import { zeichneSzene, speichereVideo, speichereBild } from "./video.js";
import { baueSzene } from "./szene.js";
import { analysiere } from "./ton-in-bild.js";
import { erzeugeRauschen } from "./rauschen.js";
import { richteMausInfoEin, zeigeFrequenz, notenName, zeigeZeit } from "/lib/maus-info.js";

const datei = hole("datei");
const spaltenRegler = hole("spalten");
const zeilenRegler = hole("zeilen");
const invertieren = hole("invertieren");
const anzeige = hole("anzeige"); // raster / verzerrt / original
const anzeigeLabel = hole("anzeigeLabel"); // erst sichtbar, wenn ein Bild geladen ist
const farbskala = hole("farbskala");
const farbenLabel = hole("farbenLabel"); // nur beim Raster
const spaltenAnzeige = hole("spaltenAnzeige");
const zeilenAnzeige = hole("zeilenAnzeige");
const feld = hole("feld"); // bekommt die Klasse "original" (weich skalieren, bild-zu-ton.css)
const stapel = hole("stapel"); // bekommt --verhaeltnis (dort steht es auch im CSS)
const meldung = hole("meldung");
const dauerRegler = hole("dauer");
const dauerAnzeige = hole("dauerAnzeige");
const tiefsteFeld = hole("tiefste");
const hoechsteFeld = hole("hoechste");
const dynamikRegler = hole("dynamik");
const dynamikAnzeige = hole("dynamikAnzeige");
const erzeugenKnopf = hole("erzeugen");
const spieler = hole("spieler");
const wavSpeichern = hole("wavSpeichern");
const videoSpeichern = hole("videoSpeichern");
const schleife = hole("schleife");
const schwelleAb = hole("schwelleAb");
const schwelleBis = hole("schwelleBis");
const schwelleAbAnzeige = hole("schwelleAbAnzeige");
const schwelleBisAnzeige = hole("schwelleBisAnzeige");
const zurueckKnopf = hole("zurueckInsBild");
const kippen = hole("kippen");
const rundenFeld = hole("runden");
const rundenKnopf = hole("rundenStarten");
const stufenFeld = hole("stufen"); // hier erscheinen die kleinen Bilder der Stufen
const bildSpeichern = hole("bildSpeichern");
const rueckwaertsCheck = hole("rueckwaerts");
const artKnoepfe = hole("syntheseArt"); // "Töne" und "Rauschen", der gewählte hat aria-pressed="true"
const durchgaengeLabel = hole("durchgaengeLabel");
const durchgaengeRegler = hole("durchgaenge");
const durchgaengeAnzeige = hole("durchgaengeAnzeige");
// Felder im Export-Fenster (stehen im HTML in #exportFelder)
const exportInhalt = hole("exportInhalt");
const exportAblauf = hole("exportAblauf");
const exportAnordnung = hole("exportAnordnung");
const exportSpalten = hole("exportSpalten");
const exportAnsicht = hole("exportAnsicht");
const exportBeschriftung = hole("exportBeschriftung");
const exportHintergrund = hole("exportHintergrund");

let wav = null; 
let puffer = null;
let letzterTon = null; // { spalten, zeilen, tief, hoch, dynamik, dauer, art, durchgaenge }
let syntheseArt = "toene"; // "toene" oder "rauschen"
let stufen = []; // Runde 0 (Start) bis N: { raster, spalten, zeilen, negativ, ton }
let originalNegativ = false; // ist das jetzige Original ein Negativ des Fotos? (für "Farben des Originals")

const spalten = () => Number(spaltenRegler.value);
const zeilen = () => Number(zeilenRegler.value);
const ab = () => Number(schwelleAb.value);
const bis = () => Number(schwelleBis.value);

function zeigeMeldung(text) {
  meldung.textContent = text;
  meldung.hidden = text === ""; // leer = Zeile verstecken
}

function zeige() {
  const art = anzeige.value;
  const rasterVerhaeltnis = spalten() / zeilen();
  const fotoVerhaeltnis = fotoBild.width / fotoBild.height;
  if (art === "raster") zeigeRaster(spalten(), zeilen());
  else zeigeOriginal(art === "original" ? fotoVerhaeltnis : rasterVerhaeltnis, invertieren.checked);
  stapel.style.setProperty("--verhaeltnis", art === "original" ? fotoVerhaeltnis : rasterVerhaeltnis);
  feld.classList.toggle("original", art !== "raster");
  farbenLabel.hidden = art !== "raster"; 
}

function aktualisiere() {
  spaltenAnzeige.textContent = spalten();
  zeilenAnzeige.textContent = zeilen();
  zeigeTonRegler();
  zeigeSchwelle();
  if (!originalBild) return; // noch kein Bild geladen
  rastere(spalten(), zeilen(), invertieren.checked);
  schneide(rastertBild, ab(), bis());
  zeige();
}

datei.addEventListener("change", async () => {
  const gewaehlt = datei.files[0]; 
  if (!gewaehlt) return; // Dialog abgebrochen
  zeigeMeldung("");
  try {
    await ladeBild(gewaehlt);
  } catch {
    zeigeMeldung("Das Bild kann der Browser nicht lesen.");
    return; 
  }
  anzeigeLabel.hidden = false;
  originalNegativ = false; // das neue Foto ist kein Negativ von irgendwas
  stufen = []; // die Stufen gehörten zum alten Bild
  zeigeStufen();
  aktualisiere();
});

// Knöpfe, die rechnen, während einer Rechnung sperren: sonst funkt ein zweiter Klick dazwischen
function sperre(an) {
  for (const knopf of [erzeugenKnopf, zurueckKnopf, rundenKnopf, videoSpeichern, bildSpeichern]) knopf.disabled = an;
}

// Ton -> neues Bild: misst mit denselben Werten, mit denen der Ton erzeugt wurde
async function zurueck() {
  const { spalten: sp, zeilen: ze, tief, hoch, dynamik } = letzterTon;
  const raster = await analysiere(puffer.getChannelData(0), sp, ze, {
    tief,
    hoch,
    dynamik,
    beiFortschritt: (anteil) => zeigeMeldung(`Höre zurück ... ${Math.round(anteil * 100)} %`),
  });
  // genau eins von beiden an -> umdrehen (XOR): so kippt es mit "kippen" immer, egal wie es angefangen hat
  const umkehren = invertieren.checked !== kippen.checked;
  setzeOriginal(await rasterAlsBild(raster, sp, ze, umkehren));
  // gerastert war (invertieren XOR alt), umgedreht wird mit (invertieren XOR kippen): invertieren hebt sich auf
  originalNegativ = originalNegativ !== kippen.checked;
  aktualisiere(); // das neue Original rastern (Schwelle wirkt auch wieder) und zeigen
}

zurueckKnopf.addEventListener("click", async () => {
  if (!puffer) {
    zeigeMeldung("Erst einen Ton erzeugen.");
    return;
  }
  sperre(true);
  try {
    await zurueck();
    zeigeMeldung("");
  } catch (fehler) {
    console.error(fehler);
    zeigeMeldung(`Zurück ins Bild hat nicht geklappt: ${fehler.message}`);
  } finally {
    sperre(false);
  }
});

spaltenRegler.addEventListener("input", aktualisiere);
zeilenRegler.addEventListener("input", aktualisiere);
invertieren.addEventListener("change", aktualisiere);
anzeige.addEventListener("change", zeige); // nur zeigen, das Raster bleibt gleich
farbskala.addEventListener("change", () => {
  waehleFarbskala(farbskala.value);
  if (originalBild) zeige();
  zeigeStufen();
});
  
// ab darf nicht über bis: der gezogene Regler schiebt den anderen mit
function nichtUeberholen(gezogen) {
  if (ab() <= bis()) return; // alles in Ordnung
  if (gezogen === schwelleAb) schwelleBis.value = schwelleAb.value;
  else schwelleAb.value = schwelleBis.value;
}

// Helligkeit -> dB, wie in ton.js: Weiß 0 dB, Schwarz −dynamik dB
function alsDb(wert) {
  return `${Math.round((wert - 1) * Number(dynamikRegler.value))} dB`;
}

// "aus", wenn an dieser Seite nichts abgeschnitten wird
function zeigeSchwelle() {
  schwelleAbAnzeige.textContent = ab() === 0 ? "aus" : alsDb(ab());
  schwelleBisAnzeige.textContent = bis() === 1 ? "aus" : alsDb(bis());
}

for (const regler of [schwelleAb, schwelleBis]) {
  regler.addEventListener("input", () => {
    nichtUeberholen(regler);
    aktualisiere(); // neu rastern, schneiden, zeigen
  });
}

function zeigeTonRegler() {
  const msProSpalte = Math.round((Number(dauerRegler.value) * 1000) / spalten());
  dauerAnzeige.textContent = `${dauerRegler.value} s (${msProSpalte} ms pro Spalte)`;
  dynamikAnzeige.textContent = `${dynamikRegler.value} dB`;
}
dauerRegler.addEventListener("input", zeigeTonRegler);
dynamikRegler.addEventListener("input", () => { 
  zeigeTonRegler(); 
  zeigeSchwelle(); 
});

// tiefste und höchste Frequenz passen zusammen? Sonst Meldung und false
function frequenzenOk() {
  const tief = Number(tiefsteFeld.value);
  const hoch = Number(hoechsteFeld.value);
  if (tief > 0 && hoch > tief) return true;
  zeigeMeldung("Die höchste Frequenz muss über der tiefsten liegen.");
  return false;
}

// Töne oder Rauschen: ein Knopf für jede Art, der gewählte ist hervorgehoben
artKnoepfe.addEventListener("click", (event) => {
  const knopf = event.target.closest("button[data-art]");
  if (!knopf) return; // zwischen die Knöpfe geklickt
  syntheseArt = knopf.dataset.art;
  for (const k of artKnoepfe.querySelectorAll("button")) k.setAttribute("aria-pressed", k === knopf);
  durchgaengeLabel.hidden = syntheseArt !== "rauschen";
});
durchgaengeRegler.addEventListener("input", () => {
  durchgaengeAnzeige.textContent = durchgaengeRegler.value;
});
durchgaengeAnzeige.textContent = durchgaengeRegler.value;

// eine Stelle für beide Arten: Ton erzeugen, Runden und die Stufen-Töne im Video merken davon nichts
function synthese(raster, sp, ze, werte) {
  return werte.art === "rauschen" ? erzeugeRauschen(raster, sp, ze, werte) : erzeugeTon(raster, sp, ze, werte);
}

// Raster -> Ton, mit den Werten der Regler; merkt sich alles fürs Zurück, Video und WAV
async function erzeuge() {
  // alle Werte JETZT festhalten: wer während des Rechnens an Reglern zieht, verändert nichts mehr
  const anzahlSpalten = spalten();
  const anzahlZeilen = zeilen();
  const tief = Number(tiefsteFeld.value);
  const hoch = Math.min(Number(hoechsteFeld.value), 23999); // wie in erzeugeTon: nicht über Nyquist
  const dynamik = Number(dynamikRegler.value);
  const dauer = Number(dauerRegler.value);
  const art = syntheseArt;
  const durchgaenge = Number(durchgaengeRegler.value);
  zeigeMeldung("Rechne ... 0 %");
  const ton = await synthese(rastertBild, anzahlSpalten, anzahlZeilen, {
    dauer,
    tief,
    hoch,
    dynamik,
    art,
    durchgaenge,
    beiFortschritt: (anteil) => zeigeMeldung(`Rechne ... ${Math.round(anteil * 100)} %`),
  });
  puffer = alsAudioBuffer(ton); // fürs Video (schneidet pro Bild ein Stück heraus) und fürs Zurück
  letzterTon = { spalten: anzahlSpalten, zeilen: anzahlZeilen, tief, hoch, dynamik, dauer, art, durchgaenge };
  setzeWiedergabe();
  setzeSkala(anzahlZeilen, tief, hoch);
}

// was Player und WAV abspielen: der Ton vorwärts oder umgedreht. puffer selbst bleibt immer vorwärts,
// weil "Ton zurück ins Bild" ihn so braucht (rückwärts käme ein gespiegeltes Bild heraus)
function setzeWiedergabe() {
  wav = zuWav(rueckwaertsCheck.checked ? rueckwaerts(puffer) : puffer);
  if (spieler.src.startsWith("blob:")) URL.revokeObjectURL(spieler.src);
  spieler.src = URL.createObjectURL(wav);
}

// umschalten, während es läuft: an derselben Stelle im Bild weiter (aus Zeit t wird Dauer − t)
rueckwaertsCheck.addEventListener("change", () => {
  if (!puffer) return; // noch kein Ton: kopf.js zeichnet trotzdem neu
  // ganz am Anfang bleibt es am Anfang, sonst stünde der Strich nach dem Umschalten gleich am Ende
  const stelle = spieler.currentTime === 0 ? 0 : spieler.duration - spieler.currentTime;
  const lief = !spieler.paused;
  setzeWiedergabe(); // neuer Ton: der Player fängt bei 0 an und muss erst laden
  spieler.addEventListener("loadedmetadata", () => {
    spieler.currentTime = stelle;
    if (lief) spieler.play();
  }, { once: true });
});

erzeugenKnopf.addEventListener("click", async () => {
  if (!rastertBild) {
    zeigeMeldung("Erst ein Bild öffnen.");
    return;
  }
  if (!frequenzenOk()) return;
  sperre(true);
  try {
    await erzeuge();
    zeigeMeldung("");
  } catch (fehler) {
    console.error(fehler);
    zeigeMeldung(`Der Ton konnte nicht erzeugt werden: ${fehler.message}`);
  } finally {
    sperre(false);
  }
});

// Kreislauf: automatisch N Runden
//------------------------------------------------------
// eine Stufe merken: das Raster selbst (zum Zeigen, Weiterbenutzen und für den Export)
function merkeStufe() {
  const raster = rastertBild.slice(); // Kopie: rastertBild wird in der nächsten Runde überschrieben
  // negativ: die Stufe zeigt das Foto umgedreht (wichtig für "Farben des Originals" im Export)
  stufen.push({ raster, spalten: spalten(), zeilen: zeilen(), negativ: invertieren.checked !== originalNegativ });
}

// gleiche Werte? Dann ist der Ton, der gerade erzeugt wurde, wirklich der Ton dieser Stufe
function gleichesRaster(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Ton einer Stufe fürs Video: aus den Runden übernommen oder jetzt erzeugt (die letzte hat noch keinen)
async function tonFuerStufe(stufe, i) {
  if (stufe.ton) return stufe.ton;
  const { tief, hoch, dynamik, dauer, art, durchgaenge } = letzterTon; // dieselben Werte wie in den Runden
  const ton = await synthese(stufe.raster, stufe.spalten, stufe.zeilen, {
    dauer, tief, hoch, dynamik, art, durchgaenge,
    beiFortschritt: (anteil) => zeigeMeldung(`Ton für Stufe ${i} ... ${Math.round(anteil * 100)} %`),
  });
  stufe.ton = alsAudioBuffer(ton);
  return stufe.ton;
}

function zeigeStufen() {
  stufenFeld.replaceChildren(); // alles Alte raus
  stufen.forEach((stufe, i) => {
    const figur = document.createElement("figure");
    const leinwand = document.createElement("canvas");
    leinwand.width = stufe.spalten;
    leinwand.height = stufe.zeilen;
    zeigeRaster(stufe.spalten, stufe.zeilen, stufe.raster, leinwand);
    const text = document.createElement("figcaption");
    text.textContent = i === 0 ? "Start" : `Runde ${i}`;
    figur.append(leinwand, text);
    figur.title = "Diese Stufe weiterbenutzen";
    // Klick: diese Stufe wird das Bild. "invertieren" wirkt beim Rastern wieder, also vorher umdrehen
    figur.addEventListener("click", async () => {
      setzeOriginal(await rasterAlsBild(stufe.raster, stufe.spalten, stufe.zeilen, invertieren.checked));
      originalNegativ = stufe.negativ !== invertieren.checked; // beim Rastern dreht invertieren es wieder zurück
      aktualisiere();
    });
    stufenFeld.append(figur);
  });
}

rundenKnopf.addEventListener("click", async () => {
  if (!rastertBild) {
    zeigeMeldung("Erst ein Bild öffnen.");
    return;
  }
  if (!frequenzenOk()) return;
  const anzahl = Math.max(1, Math.round(Number(rundenFeld.value)));
  sperre(true);
  try {
    // Startstufe nur, wenn das jetzige Raster noch keine ist (sonst steht die letzte Stufe doppelt da)
    if (stufen.length === 0 || !gleichesRaster(stufen.at(-1).raster, rastertBild)) merkeStufe();
    zeigeStufen();
    for (let runde = 1; runde <= anzahl; runde++) {
      const klingt = stufen.at(-1);
      await erzeuge();
      if (gleichesRaster(klingt.raster, rastertBild)) klingt.ton = puffer; // fürs Video "Stufen" merken
      await zurueck();
      merkeStufe();
      zeigeStufen(); // nach jeder Runde, dann sieht man die Reihe wachsen
      zeigeMeldung(`Runde ${runde} von ${anzahl} fertig`);
    }
    zeigeMeldung("");
  } catch (fehler) {
    console.error(fehler);
    zeigeMeldung(`Die Runden haben nicht geklappt: ${fehler.message}`);
  } finally {
    sperre(false);
  }
});
//------------------------------------------------------

wavSpeichern.addEventListener("click", () => {
  if (!wav) {
    zeigeMeldung("Erst einen Ton erzeugen.");
    return;
  }
  ladeHerunter(wav, `${dateiName}${rueckwaertsCheck.checked ? "-rueckwaerts" : ""}-${zeitstempel()}.wav`);
});

// Export: Bild und Video über das Export-Fenster (/lib/export-dialog.js)
//------------------------------------------------------
let exportArt = "bild"; // "bild" oder "video": welches Fenster gerade offen ist

// die eigenen Felder im Fenster lesen
function leseFelder() {
  return {
    inhalt: exportInhalt.value, // "ansicht" oder "stufen"
    ablauf: exportAblauf.value, // "gesehen" oder "aufbauen" (nur Video mit Ansicht)
    anordnung: exportAnordnung.value, // "paar" oder "gitter" (nur Video mit Stufen)
    spalten: Math.max(0, Math.round(Number(exportSpalten.value))), // 0 = automatisch
    ansicht: exportAnsicht.value, // "raster", "verzerrt" oder "original"
    beschriftung: exportBeschriftung.checked,
    hintergrund: exportHintergrund.value,
  };
}

// nur zeigen, was bei dieser Wahl etwas bewirkt
function passeFelderAn() {
  const video = exportArt === "video";
  const mitStufen = exportInhalt.value === "stufen";
  const gitter = !video || exportAnordnung.value === "gitter"; // ein Bild ist immer ein Gitter
  hole("exportAblaufLabel").hidden = !video || mitStufen;
  hole("exportAnordnungLabel").hidden = !video || !mitStufen;
  hole("exportSpaltenLabel").hidden = !mitStufen || !gitter;
  hole("exportBeschriftungLabel").hidden = !mitStufen || !gitter;
}
for (const feld of [exportInhalt, exportAnordnung]) feld.addEventListener("change", passeFelderAn);

// alles, woraus szene.js die Bilder baut
function quellen() {
  return {
    raster: rastertBild, // so, wie es klingt (schon mit Schwelle)
    spalten: spalten(),
    zeilen: zeilen(),
    original: originalBild, // nach dem Kreislauf die letzte Stufe
    invertieren: invertieren.checked,
    puffer,
    stufen,
    foto: fotoBild,
    farbskala: farbskala.value,
    rueckwaerts: rueckwaertsCheck.checked,
  };
}

// Vorschau im Fenster: zeit = null beim Bild, sonst 0 bis 1 über das ganze Video
// (hier ist jeder Abschnitt gleich lang; die echten Töne werden erst beim Speichern gebraucht)
function zeichneVorschau(allgemein, zeit) {
  const szene = baueSzene({ ...allgemein, ...leseFelder() }, quellen(), exportArt === "video");
  const bild = document.createElement("canvas");
  bild.width = szene.breite;
  bild.height = szene.hoehe;
  const c = bild.getContext("2d");
  const anzahl = szene.abschnitte.length;
  if (zeit === null) {
    zeichneSzene(c, szene, anzahl - 1, null);
  } else {
    const stelle = Math.min(zeit * anzahl, anzahl - 0.001); // z. B. 1,4 = Abschnitt 1, Strich bei 40 %
    zeichneSzene(c, szene, Math.floor(stelle), stelle % 1);
  }
  return bild;
}

const exportFenster = erstelleExportDialog({ felder: hole("exportFelder"), zeichneVorschau });

async function exportiere(art, inhalt) {
  zeigeMeldung("");
  if (!originalBild) {
    zeigeMeldung("Erst ein Bild öffnen.");
    return;
  }
  if (art === "video" && (typeof Mediabunny === "undefined" || typeof VideoEncoder === "undefined")) {
    zeigeMeldung("Dein Browser kann keine Videos kodieren.");
    return;
  }
  exportArt = art;
  exportAnsicht.value = anzeige.value; // fängt mit dem an, was gerade auf der Seite zu sehen ist
  exportInhalt.querySelector('[value="stufen"]').disabled = stufen.length === 0; // ohne Runden keine Stufen
  if (inhalt) exportInhalt.value = inhalt;
  if (stufen.length === 0) exportInhalt.value = "ansicht";
  passeFelderAn();

  const allgemein = await exportFenster.oeffne({
    art,
    ueberschrift: art === "video" ? "Video speichern" : "Bild speichern",
  });
  if (!allgemein) return; // abgebrochen
  const einst = { ...allgemein, ...leseFelder() };
  const mitStufen = einst.inhalt === "stufen";
  if (art === "video" && !mitStufen && !puffer) {
    zeigeMeldung("Erst einen Ton erzeugen.");
    return;
  }

  sperre(true); // nicht zweimal gleichzeitig, und nicht während der Runden
  try {
    const q = quellen();
    const richtung = art === "video" && rueckwaertsCheck.checked ? "-rueckwaerts" : "";
    const name = `${dateiName}-${mitStufen ? "stufen" : "bild"}-${einst.ansicht}${richtung}`;
    if (art === "bild") {
      await speichereBild(baueSzene(einst, q, false), name);
      return;
    }
    if (mitStufen) {
      q.toene = [];
      for (let i = 0; i < stufen.length; i++) q.toene.push(await tonFuerStufe(stufen[i], i));
      zeigeMeldung("");
    }
    const { codec, tonCodec } = await speichereVideo(baueSzene(einst, q, true), {
      name,
      beiFortschritt: (anteil) => (videoSpeichern.textContent = `Video ... ${Math.round(anteil * 100)} %`),
    });
    // nur H.264 + AAC läuft überall (Handy, WhatsApp, Instagram)
    if (codec !== "avc" || tonCodec !== "aac") {
      zeigeMeldung(`Hinweis: Das Video ist ${codec} mit ${tonCodec}. Handys und WhatsApp spielen das vielleicht nicht ab, Chrome oder Edge machen H.264 mit AAC.`);
    }
  } catch (fehler) {
    console.error(fehler);
    zeigeMeldung(`Der Export ist fehlgeschlagen: ${fehler.message}`);
  } finally {
    sperre(false);
    videoSpeichern.textContent = "Video speichern";
  }
}

bildSpeichern.addEventListener("click", () => exportiere("bild"));
videoSpeichern.addEventListener("click", () => exportiere("video"));
//------------------------------------------------------

schleife.addEventListener("change", () => {
  spieler.loop = schleife.checked;
});
spieler.loop = schleife.checked;

// Maus-Info: was unter dem Zeiger klingt, mit den jetzigen Reglern (so, wie das Raster gerade aussieht)
richteMausInfoEin(stapel, hole("mausInfo"), (x, y) => {
  if (!rastertBild) return null; // noch kein Bild
  const sp = spalten();
  const ze = zeilen();
  const spalte = Math.min(Math.floor(x * sp), sp - 1); // ganz rechts ist x = 1: sonst eine Spalte zu weit
  const zeile = ze - 1 - Math.min(Math.floor(y * ze), ze - 1); // oben = höchste Zeile, wie in rastere
  const tief = Number(tiefsteFeld.value);
  const hoch = Math.min(Number(hoechsteFeld.value), 23999); // wie in erzeuge
  const f = zeileZuFrequenz(zeile, ze, tief, hoch); // genau der Sinus dieser Zeile, nicht stufenlos
  const zeit = (rueckwaertsCheck.checked ? 1 - x : x) * Number(dauerRegler.value); // rückwärts: rechts ist der Anfang
  const wert = rastertBild[spalte * ze + zeile];
  const laut = wert === 0 ? "still" : alsDb(wert);
  return `${zeigeFrequenz(f)} · ${notenName(f)} · ${zeigeZeit(zeit)} · ${laut}`;
});

zeigeStufen(); // am Anfang leer
waehleFarbskala(farbskala.value); 
aktualisiere(); 
zeigeTonRegler();

const beobachter = new ResizeObserver(passeGroesseAn);
beobachter.observe(stapel);
