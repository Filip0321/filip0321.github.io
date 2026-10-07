// ---------- Export: Bild und Video aus einem Canvas ----------

const MAX_SEKUNDEN = 30;

function ladeHerunter(blob, dateiname) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function zeitstempel() {
  const jetzt = new Date();
  const zwei = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}${zwei(jetzt.getMonth() + 1)}${zwei(jetzt.getDate())}`
    + `-${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}${zwei(jetzt.getSeconds())}`;
}

function waehleVideoformat() {
  if (typeof MediaRecorder === "undefined") return null;

  const kandidaten = [
    { mime: "video/mp4;codecs=avc1", endung: "mp4" },
    { mime: "video/mp4", endung: "mp4" },
    { mime: "video/webm;codecs=vp9", endung: "webm" },
    { mime: "video/webm", endung: "webm" }
  ];

  return kandidaten.find(k => MediaRecorder.isTypeSupported(k.mime)) || null;
}

function richteExportEin({ canvas, ziel, name }) {
  const dateiname = () => {
    const basis = typeof name === "function" ? name() : name;
    return `${basis}-${zeitstempel()}`;
  };

  const bildKnopf = document.createElement("button");
  bildKnopf.type = "button";
  bildKnopf.textContent = "Bild speichern";

  const label = document.createElement("label");
  const sekundenFeld = document.createElement("input");
  sekundenFeld.type = "number";
  sekundenFeld.min = 1;
  sekundenFeld.max = MAX_SEKUNDEN;
  sekundenFeld.step = 1;
  sekundenFeld.value = 5;
  label.append("Sekunden ", sekundenFeld);

  const videoKnopf = document.createElement("button");
  videoKnopf.type = "button";
  videoKnopf.textContent = "Video aufnehmen";

  ziel.append(bildKnopf, label, videoKnopf);

  bildKnopf.addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (blob) ladeHerunter(blob, `${dateiname()}.png`);
    }, "image/png");
  });

  const format = waehleVideoformat();

  if (!format) {
    videoKnopf.disabled = true;
    videoKnopf.title = "Dein Browser kann keine Videos aufnehmen.";
    return;
  }

  videoKnopf.addEventListener("click", () => {
    let sekunden = Math.round(Number(sekundenFeld.value));
    if (!Number.isFinite(sekunden)) sekunden = 5;
    sekunden = Math.min(Math.max(sekunden, 1), MAX_SEKUNDEN);
    sekundenFeld.value = sekunden;

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mime,
      videoBitsPerSecond: 8000000
    });
    const teile = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) teile.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach(spur => spur.stop());
      ladeHerunter(new Blob(teile, { type: format.mime }), `${dateiname()}.${format.endung}`);
      bildKnopf.disabled = false;
      videoKnopf.disabled = false;
      videoKnopf.textContent = "Video aufnehmen";
    };

    bildKnopf.disabled = true;
    videoKnopf.disabled = true;

    let rest = sekunden;
    videoKnopf.textContent = `Aufnahme … ${rest} s`;

    const zaehler = setInterval(() => {
      rest--;
      if (rest > 0) videoKnopf.textContent = `Aufnahme … ${rest} s`;
    }, 1000);

    recorder.start();

    setTimeout(() => {
      clearInterval(zaehler);
      recorder.stop();
    }, sekunden * 1000);
  });
}