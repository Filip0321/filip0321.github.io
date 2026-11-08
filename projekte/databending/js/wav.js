// WAV-Datei aus Samples (−1 bis 1), mono, 16 Bit. Eine WAV ist ein kleiner Kopf (44 Bytes: „RIFF“, Format,
// Abtastrate, „data“ und die Länge) und danach einfach die Samples hintereinander, jedes als ganze Zahl.
export function alsWav(samples, rate) {
  const puffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(puffer);
  const text = (stelle, t) => [...t].forEach((z, i) => v.setUint8(stelle + i, z.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true); // true: little-endian, wie WAV es will
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true); // Länge dieses Teils
  v.setUint16(20, 1, true); // 1 = PCM, ohne Kompression
  v.setUint16(22, 1, true); // ein Kanal
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // Bytes pro Sekunde
  v.setUint16(32, 2, true); // Bytes pro Sample
  v.setUint16(34, 16, true); // Bits pro Sample
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([puffer], { type: "audio/wav" });
}
