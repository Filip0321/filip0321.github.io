import { spieler, zeigeMeldung } from "./seite.js";
import { audio, mischer, ausgang, dateiQuelle } from "./audio.js";
import { stoppeAufnahme } from "./aufnehmen.js";

const quelle = hole("quelle");
const dateiKnopf = hole("dateiKnopf");
const aufnehmenFeld = hole("aufnehmenFeld"); // Aufnehmen gibt es nur bei Mikrofon und Systemton
const eingang = hole("eingang"); 
const eingangLabel = hole("eingangLabel");
const mithoeren = hole("mithoeren"); // Häkchen: Mikrofon auch auf die Lautsprecher
const mithoerenLabel = hole("mithoerenLabel");
const systemHinweis = hole("systemHinweis"); // Anleitung, nur beim Systemton sichtbar

let liveQuelle = null; // MediaStreamSource vom Mikrofon
let liveStrom = null; // der MediaStream selbst, zum Ausschalten

export function quellenArt() {
  return quelle.value;
}

export function zeigeQuelle() {
  const art = quelle.value; // "datei", "mikrofon", "system"
  dateiKnopf.hidden = art !== "datei";
  aufnehmenFeld.hidden = art === "datei";
  spieler.hidden = art !== "datei";
  eingangLabel.hidden = art !== "mikrofon";
  mithoerenLabel.hidden = art !== "mikrofon";
  systemHinweis.hidden = art !== "system";
  if (art === "system" && !kannSystemton) zeigeMeldung(warumKeinTon());
}

// alte Quelle lösen, neue anstecken
export async function setzeQuelle() {
  zeigeMeldung(""); // erst alte Meldung weg
  zeigeQuelle();
  if (!audio) return;
  stoppeAufnahme(); 

  dateiQuelle.disconnect(); 
  stoppeLive();

  if (quelle.value === "datei") {
    dateiQuelle.connect(mischer);
  } else {
    spieler.pause(); // sonst läuft die Datei unhörbar weiter
    if (quelle.value === "mikrofon") await starteMikrofon();
    else await starteSystemton();
  }
  setzeAusgang();
}

async function starteMikrofon() {
  if (!navigator.mediaDevices?.getUserMedia) {
    zeigeMeldung("Mikrofon geht nur auf https oder localhost.");
    return;
  }
  try {
    liveStrom = await navigator.mediaDevices.getUserMedia({
      audio: {
        // exact bedeutet "genau dieses Gerät, sonst Fehler" (statt still ein anderes zu nehmen)
        deviceId: eingang.value ? { exact: eingang.value } : undefined,
        
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    if (quelle.value !== "mikrofon") {
      stoppeLive();
      return;
    }
    liveQuelle = audio.createMediaStreamSource(liveStrom);
    liveQuelle.connect(mischer);
    await fuelleEingaenge(); 
  } catch (fehler) {
    stoppeLive();
    zeigeMeldung(erklaereFehler(fehler));
  }
}

async function starteSystemton() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    zeigeMeldung("Systemton geht nur in Chrome oder Edge, auf https oder localhost.");
    return;
  }
  try {
    const strom = await navigator.mediaDevices.getDisplayMedia({
      video: true, // ohne Bild lässt Chrome nicht freigeben
      audio: {
        echoCancellation: false, 
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false, 
      },
      systemAudio: "include", 
    });

    const geteilt = strom.getVideoTracks()[0]?.getSettings().displaySurface;
    strom.getVideoTracks().forEach((spur) => spur.stop()); // Bild weg

    const tonSpur = strom.getAudioTracks()[0];
    if (!tonSpur) {
      zeigeMeldung(warumKeinTon(geteilt));
      return;
    }

    if (quelle.value !== "system") {
      strom.getTracks().forEach((spur) => spur.stop());
      return;
    }
    liveStrom = strom;
    liveQuelle = audio.createMediaStreamSource(strom);
    liveQuelle.connect(mischer);

    // "ended" kommt, wenn die Freigabe von außen endet 
    tonSpur.addEventListener("ended", async () => {
      if (liveStrom !== strom) return; // inzwischen läuft schon eine andere Quelle
      quelle.value = "datei";
      await setzeQuelle();
      zeigeMeldung("Freigabe beendet, zurück auf Datei.");
    });
  } catch (fehler) {
    stoppeLive();
    zeigeMeldung(fehler.name === "NotAllowedError" ? "Freigabe abgebrochen." : erklaereFehler(fehler));
  }
}

const kannSystemton = Boolean(navigator.userAgentData);

function warumKeinTon(geteilt) {
  if (!kannSystemton) {
    return "Dieser Browser (z. B. Firefox oder Zen) schickt beim Freigeben keinen Ton mit. Bitte die Seite in Chrome oder Edge öffnen.";
  }
  if (geteilt === "window") {
    return "Einzelne Fenster haben keinen Ton. „Gesamter Bildschirm“ wählen und „Systemaudio teilen“ anhaken (so geht auch Ableton).";
  }
  return "Es wurde kein Ton geteilt. Beim Freigeben das Häkchen „Systemaudio teilen“ bzw. „Tab-Audio teilen“ setzen.";
}

function stoppeLive() {
  liveQuelle?.disconnect();
  liveQuelle = null;
  // Spuren beenden, erst dann geht die Aufnahme-Anzeige im Browser aus
  liveStrom?.getTracks().forEach((spur) => spur.stop());
  liveStrom = null;
}

function erklaereFehler(fehler) {
  const SAETZE = {
    NotAllowedError: "Mikrofon nicht erlaubt. Im Browser neben der Adresse freigeben.",
    NotFoundError: "Kein Mikrofon gefunden.",
    NotReadableError: "Das Mikrofon wird gerade von einem anderen Programm benutzt.",
    OverconstrainedError: "Dieses Eingangsgerät gibt es nicht mehr. Bitte neu wählen.",
    NotSupportedError: "Der Browser kann dieses Gerät nicht verbinden (Abtastrate?). In Chrome versuchen oder am Gerät 48 kHz einstellen.",
  };
  return SAETZE[fehler.name] ?? `Mikrofon-Fehler: ${fehler.message}`; // ?? -> rechts, wenn links nichts ist
}

async function fuelleEingaenge() {
  const geraete = await navigator.mediaDevices.enumerateDevices();
  const gewaehlt = eingang.value;
  eingang.replaceChildren(new Option("Standard", "")); // alles raus, nur "Standard" rein
  for (const geraet of geraete) {
    if (geraet.kind !== "audioinput" || geraet.deviceId === "default") continue;
    eingang.add(new Option(geraet.label || "Eingang ohne Namen", geraet.deviceId));
  }
  // vorherige Wahl behalten, wenn es das Gerät noch gibt
  const gibtEs = [...eingang.options].some((option) => option.value === gewaehlt);
  eingang.value = gibtEs ? gewaehlt : "";
}

function setzeAusgang() {
  if (!ausgang) return;
  const an = quelle.value === "datei" || (quelle.value === "mikrofon" && mithoeren.checked);
  ausgang.gain.setTargetAtTime(an ? 1 : 0, audio.currentTime, 0.01); // sanft, ohne Knacken
}

quelle.addEventListener("change", setzeQuelle);
eingang.addEventListener("change", setzeQuelle); // anderes Gerät: Mikrofon neu öffnen
mithoeren.addEventListener("change", setzeAusgang);
// Gerät ein- oder ausgesteckt -> Liste neu 
// "?." falls es mediaDevices nicht gibt, also wenn ohne https oder so
navigator.mediaDevices?.addEventListener("devicechange", fuelleEingaenge);