// Ton von außen holen: Mikrofon (oder Interface) und Systemton (was der Computer gerade abspielt,
// z. B. Ableton oder ein anderer Tab). Für die Attraktoren (audioreaktiv.js) und später alle anderen
// Projekte, die zuhören; das Spektrogramm hat noch seine eigene Fassung in js/quelle.js.
//
// Beide Funktionen geben einen MediaStream zurück oder werfen einen Fehler mit einem Satz,
// den man so anzeigen kann.

// nur Chrome und Edge schicken beim Teilen des Bildschirms auch den Ton mit;
// navigator.userAgentData gibt es nur in Chromium-Browsern (Firefox, Zen und Safari kennen es nicht)
export const kannSystemton = Boolean(navigator.userAgentData);

const OHNE_BEARBEITUNG = {
  // Browser putzen Mikrofone für Telefonate: Echo weg, Rauschen weg, Lautstärke angleichen.
  // Für Musik ist das falsch (Bässe und leise Stellen verschwinden), darum alles aus
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export async function oeffneMikrofon(geraet = "") {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Mikrofon geht nur auf https oder localhost.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      // exact: genau dieses Gerät, sonst Fehler (statt still ein anderes zu nehmen)
      audio: { ...OHNE_BEARBEITUNG, deviceId: geraet ? { exact: geraet } : undefined },
    });
  } catch (fehler) {
    const SAETZE = {
      NotAllowedError: "Mikrofon nicht erlaubt. Im Browser neben der Adresse freigeben.",
      NotFoundError: "Kein Mikrofon gefunden.",
      NotReadableError: "Das Mikrofon wird gerade von einem anderen Programm benutzt.",
      OverconstrainedError: "Dieses Eingangsgerät gibt es nicht mehr. Bitte neu wählen.",
    };
    throw new Error(SAETZE[fehler.name] ?? `Mikrofon-Fehler: ${fehler.message}`);
  }
}

export async function oeffneSystemton() {
  if (!kannSystemton) {
    throw new Error("Dieser Browser (z. B. Firefox, Zen oder Safari) schickt beim Freigeben keinen Ton mit. Für Systemton die Seite in Chrome oder Edge öffnen.");
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Systemton geht nur auf https oder localhost.");
  let strom;
  try {
    strom = await navigator.mediaDevices.getDisplayMedia({
      video: true, // ohne Bild lässt Chrome nichts freigeben
      audio: { ...OHNE_BEARBEITUNG, suppressLocalAudioPlayback: false }, // weiter selbst hören
      systemAudio: "include",
    });
  } catch (fehler) {
    throw new Error(fehler.name === "NotAllowedError" ? "Freigabe abgebrochen." : `Systemton-Fehler: ${fehler.message}`);
  }
  const geteilt = strom.getVideoTracks()[0]?.getSettings().displaySurface;
  strom.getVideoTracks().forEach((spur) => spur.stop()); // das Bild braucht niemand
  if (strom.getAudioTracks().length === 0) {
    throw new Error(geteilt === "window"
      ? "Einzelne Fenster haben keinen Ton. „Gesamter Bildschirm“ wählen und „Systemaudio teilen“ anhaken (so geht auch Ableton)."
      : "Es wurde kein Ton geteilt. Beim Freigeben „Systemaudio teilen“ bzw. „Tab-Audio teilen“ anhaken.");
  }
  return strom;
}
