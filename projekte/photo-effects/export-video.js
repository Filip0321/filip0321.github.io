// Video rendern

async function bereiteKonvertierungVor(datei, ausgabeFormat, w, h, fit, verarbeite) {
  const input = new Mediabunny.Input({
    source: new Mediabunny.BlobSource(datei),
    formats: Mediabunny.ALL_FORMATS,
  });

  const output = new Mediabunny.Output({
    format: ausgabeFormat,
    target: new Mediabunny.BufferTarget(),
  });

  const conversion = await Mediabunny.Conversion.init({
    input,
    output,
    video: {
      width: w,
      height: h,
      fit: fit,
      process: verarbeite,
    },
  });

  return { conversion, output };
}

export async function renderVideo(datei, w, h, fit, verarbeite, beiFortschritt) {
    let endung = "mp4";
    let mime = "video/mp4";
    let { conversion, output } = await bereiteKonvertierungVor(
        datei,
        new Mediabunny.Mp4OutputFormat(),
        w,
        h,
        fit,
        verarbeite,
    );

    if (!conversion.isValid) {
        endung = "webm";
        mime = "video/webm";
        ({ conversion, output } = await bereiteKonvertierungVor(
        datei,
        new Mediabunny.WebMOutputFormat(),
        w,
        h,
        fit,
        verarbeite,
        ));
    }

    if (!conversion.isValid) {
        throw new Error("Dein Browser kann dieses Video leider nicht umwandeln.");
    }

    conversion.onProgress = beiFortschritt;
    await conversion.execute();

    return {
        blob: new Blob([output.target.buffer], { type: mime }),
        endung,
    };
}
