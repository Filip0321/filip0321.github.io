// Drei Schnittansichten wie in jedem Programm für CT und MRT: axial (von oben, z fest), koronal (von vorn, y fest),
// sagittal (von der Seite, x fest). Gezeichnet auf der CPU aus den Werten, mit demselben Fenster als Graustufen
// („Fensterung“: von → schwarz, bis → weiß). Ein Klick in eine Ansicht setzt die beiden anderen Schnitte.

export function richteSchnitteEin(canvasse, beiKlick) {
  const ansichten = [
    { c: canvasse.axial, achse: 2, h: 0, v: 1 },     // waagerecht x, senkrecht y
    { c: canvasse.koronal, achse: 1, h: 0, v: 2 },   // x, z
    { c: canvasse.sagittal, achse: 0, h: 1, v: 2 },  // y, z
  ];
  let vol = null;
  let stelle = [0.5, 0.5, 0.5];

  for (const a of ansichten) {
    a.c.addEventListener("pointerdown", (event) => {
      if (!vol) return;
      const r = a.c.getBoundingClientRect();
      const neu = [...stelle];
      neu[a.h] = (event.clientX - r.left) / r.width;
      neu[a.v] = a.v === 2 ? 1 - (event.clientY - r.top) / r.height : (event.clientY - r.top) / r.height;
      beiKlick(neu);
    });
  }

  // fenster: [von, bis]; s: [x, y, z] von 0 bis 1
  function zeichne(fenster, s) {
    if (!vol) return;
    stelle = s;
    const n = [vol.b, vol.h, vol.t];
    for (const a of ansichten) {
      const bw = n[a.h];
      const bh = n[a.v];
      if (a.c.width !== bw || a.c.height !== bh) {
        a.c.width = bw;
        a.c.height = bh;
        // echtes Seitenverhältnis (Voxel sind nicht immer Würfel)
        a.c.style.aspectRatio = `${bw * vol.abstand[a.h]} / ${bh * vol.abstand[a.v]}`;
      }
      const fest = Math.min(n[a.achse] - 1, Math.round(s[a.achse] * (n[a.achse] - 1)));
      const bild = new ImageData(bw, bh);
      const d = bild.data;
      const skal = 255 / (fenster[1] - fenster[0]);
      for (let j = 0; j < bh; j++) {
        // senkrecht z: oben ist das Ende (Kopf), also umdrehen
        const vj = a.v === 2 ? bh - 1 - j : j;
        for (let i = 0; i < bw; i++) {
          const k = [0, 0, 0];
          k[a.achse] = fest;
          k[a.h] = i;
          k[a.v] = vj;
          const w = vol.werte[k[0] + k[1] * vol.b + k[2] * vol.b * vol.h];
          const g = Math.max(0, Math.min(255, (w - fenster[0]) * skal));
          const p = (i + j * bw) * 4;
          d[p] = d[p + 1] = d[p + 2] = g;
          d[p + 3] = 255;
        }
      }
      const ctx = a.c.getContext("2d");
      ctx.putImageData(bild, 0, 0);
      // Fadenkreuz: wo die anderen beiden Schnitte liegen
      // Linien als Rechtecke: Voxel sind oft nicht quadratisch (die Leinwand wird dann ungleich gestreckt), die
      // Dicke wird darum in jeder Richtung für sich auf die gestreckte Größe umgerechnet
      ctx.fillStyle = "rgba(255, 80, 60, 0.8)";
      const dickeH = Math.max(1, bw / 300);
      const dickeV = Math.max(0.3, (bw / 300) * (vol.abstand[a.h] / vol.abstand[a.v]));
      const x = s[a.h] * bw;
      const y = a.v === 2 ? (1 - s[a.v]) * bh : s[a.v] * bh;
      ctx.fillRect(x - dickeH / 2, 0, dickeH, bh);
      ctx.fillRect(0, y - dickeV / 2, bw, dickeV);
    }
  }
  return { setze: (v) => (vol = v), zeichne };
}
