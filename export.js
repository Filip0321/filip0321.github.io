// Export für Bilder und Videos
// Videos laufen über Mediabunny (muss vorher als klassisches Skript /lib/mediabunny.js geladen sein)

const MAX_SEKUNDEN = 30;
export const FPS = 30; // Bildrate beim Rendern

export function ladeHerunter(blob, dateiname) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

// erster Codec, den dieser Browser in dieser Größe kodieren kann, sonst null
// avc (H.264) zuerst, weil es überall abspielbar ist, auch in DaVinci
function waehleCodec(w, h) {
  return Mediabunny.getFirstEncodableVideoCodec(["avc", "vp9", "av1", "vp8"], {
    width: w,
    height: h,
    quality: Mediabunny.QUALITY_HIGH,
  });
}

// Eine Aufnahme: eigener Canvas mit festen, geraden Maßen und eine MP4-Ausgabe
// fps nur beim Rendern; live sind die Abstände unregelmäßig
export async function neueAufnahme(vorlage, fps) {
  const w = vorlage.width - (vorlage.width % 2); // H.264 verlangt gerade Maße
  const h = vorlage.height - (vorlage.height % 2);

  const codec = await waehleCodec(w, h);
  if (!codec) {
    throw new Error(`Dein Browser kann kein Video in ${w}×${h} kodieren.`);
  }
  console.info(`Video: ${codec}, ${w}×${h}`);

  const leinwand = document.createElement("canvas");
  leinwand.width = w;
  leinwand.height = h;
  const ctx = leinwand.getContext("2d");

  const output = new Mediabunny.Output({
    format: new Mediabunny.Mp4OutputFormat(),
    target: new Mediabunny.BufferTarget(),
  });
  const quelle = new Mediabunny.CanvasSource(leinwand, {
    codec,
    quality: Mediabunny.QUALITY_HIGH,
  });
  output.addVideoTrack(quelle, fps ? { frameRate: fps } : {});
  await output.start();

  return {
    // Bild sofort kopieren (synchron), dann kodieren lassen (asynchron)
    bild(canvas, zeit, dauer) {
      // Video kennt keine Transparenz; ohne Füllen würden durchsichtige
      // Stellen das vorige Bild durchscheinen lassen
      ctx.fillStyle = hintergrund;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(canvas, 0, 0, w, h);
      return quelle.add(zeit, dauer);
    },
    async fertig() {
      quelle.close();
      await output.finalize();
      return new Blob([output.target.buffer], { type: "video/mp4" });
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
  anzeige = () => canvas,  // was gerade zu sehen ist (Bild speichern, Live)
  endbild = () => canvas,  // fertiges Bild zur Zeit t in Sekunden (Rendern)
  render = null,           // { start(n), bild(i, dt), ende() } oder null
}) {
  const dateiname = () => {
    const basis = typeof name === "function" ? name() : name;
    return `${basis}-${zeitstempel()}`;
  };

  const bildKnopf = knopf("Bild speichern");

  const label = document.createElement("label");
  const sekundenFeld = document.createElement("input");
  sekundenFeld.type = "number";
  sekundenFeld.min = 1;
  sekundenFeld.max = MAX_SEKUNDEN;
  sekundenFeld.step = 1;
  sekundenFeld.value = 5;
  label.append("Sekunden ", sekundenFeld);

  const liveKnopf = knopf("Live aufnehmen");
  const renderKnopf = knopf("Video rendern");

  ziel.append(bildKnopf, label, liveKnopf);
  if (render) ziel.append(renderKnopf);

  const bedienung = [bildKnopf, sekundenFeld, liveKnopf, renderKnopf];
  function sperre(gesperrt, ausser = null) {
    for (const element of bedienung) {
      if (element !== ausser) element.disabled = gesperrt;
    }
  }

  function leseSekunden() {
    let sekunden = Math.round(Number(sekundenFeld.value));
    if (!Number.isFinite(sekunden)) sekunden = 5;
    sekunden = Math.min(Math.max(sekunden, 1), MAX_SEKUNDEN);
    sekundenFeld.value = sekunden;
    return sekunden;
  }

  bildKnopf.addEventListener("click", () => {
    anzeige().toBlob((blob) => {
      if (blob) ladeHerunter(blob, `${dateiname()}.png`);
    }, "image/png");
  });

  if (typeof Mediabunny === "undefined" || typeof VideoEncoder === "undefined") {
    for (const k of [liveKnopf, renderKnopf]) {
      k.disabled = true;
      k.title = "Dein Browser kann keine Videos kodieren.";
    }
    return;
  }

  // Live: nimmt auf, was gerade passiert, auch Ziehen und Malen
  // Zeit = echte Zeit; schafft der Kodierer ein Bild nicht, wird es ausgelassen

  let liveLaeuft = false;
  let stoppGewuenscht = false;

  function nimmLiveAuf(aufnahme, sekunden) {
    return new Promise((fertig, fehlschlag) => {
      let start = null;
      let offen = null; // Bild, das gerade kodiert wird
      let fehler = null;

      function takt(zeitpunkt) {
        start ??= zeitpunkt;
        const t = (zeitpunkt - start) / 1000;

        if (stoppGewuenscht || fehler || t >= sekunden) {
          Promise.resolve(offen).then(() => (fehler ? fehlschlag(fehler) : fertig()));
          return;
        }

        liveKnopf.textContent = `Stopp … ${Math.ceil(sekunden - t)} s`;

        if (!offen) {
          offen = aufnahme.bild(anzeige(), t, 0)
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
      stoppGewuenscht = true; // zweiter Klick beendet früher
      return;
    }

    liveLaeuft = true;
    stoppGewuenscht = false;
    sperre(true, liveKnopf);
    let aufnahme = null;

    try {
      const sekunden = leseSekunden();
      aufnahme = await neueAufnahme(canvas);
      await nimmLiveAuf(aufnahme, sekunden);
      liveKnopf.textContent = "Speichern …";
      ladeHerunter(await aufnahme.fertig(), `${dateiname()}.mp4`);
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
    sperre(true);
    let aufnahme = null;
    let gestartet = false;

    try {
      const sekunden = leseSekunden();
      const n = Math.round(sekunden * FPS);
      aufnahme = await neueAufnahme(canvas, FPS);

      render.start(n);
      gestartet = true;

      for (let i = 0; i < n; i++) {
        const t = i / FPS;
        render.bild(i, 1 / FPS);
        await aufnahme.bild(endbild(t), t, 1 / FPS);
        renderKnopf.textContent = `Rendern … ${Math.round(((i + 1) / n) * 100)} %`;
        await warte();
      }

      renderKnopf.textContent = "Speichern …";
      ladeHerunter(await aufnahme.fertig(), `${dateiname()}.mp4`);
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