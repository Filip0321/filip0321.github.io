// Der Ton fürs Oszilloskop im Audio-Thread (AudioWorklet): links = x, rechts = y.
// Die Schleife ist dieselbe wie rechne() in ton.js (die Erklärung steht dort); hier steht sie noch einmal, weil
// nicht jeder Browser Importe in einem Worklet erlaubt. Wer eine ändert, ändert beide.
// Dazu hier: Gleiten (die Frequenz geht in gleit Sekunden auf den neuen Wert, Portamento), damit die Tonhöhe
// ohne Knacken wechselt.
// Die Zeichenfläche dreht sich mit: das Worklet meldet etwa 90-mal pro Sekunde seine Winkel ({ winkel }), und
// von Hand gedreht wird mit { drehe: [wx, wy, wz] } (dazuzählen) oder { winkel: [...] } (setzen).

class OsziTon extends AudioWorkletProcessor {
  constructor() {
    super();
    this.u = { x: new Float32Array(1), y: new Float32Array(1), z: new Float32Array(1) };
    this.w = { f: 110, laut: 0.3, drehX: 0, drehY: 0, drehZ: 0, abstand: 0, atmen: 0, atmenF: 0.5, gleit: 0.05 };
    this.ziel = 110;
    this.z = { phase: 0, wx: 0, wy: 0, wz: 0, atem: 0 };
    this.bloecke = 0;
    this.port.onmessage = (e) => {
      const { f, umlauf, drehe, winkel, ...rest } = e.data;
      if (umlauf) this.u = umlauf;
      if (drehe) {
        this.z.wx += drehe[0];
        this.z.wy += drehe[1];
        this.z.wz += drehe[2];
      }
      if (winkel) [this.z.wx, this.z.wy, this.z.wz] = winkel;
      Object.assign(this.w, rest);
      if (f !== undefined) this.ziel = f;
    };
  }
  process(_, ausgaenge) {
    const [links, rechts] = ausgaenge[0];
    const { u, w, z } = this;
    const n = u.x.length;
    const k = w.gleit > 0 ? 1 - Math.exp(-1 / (w.gleit * sampleRate)) : 1;
    for (let i = 0; i < links.length; i++) {
      w.f += (this.ziel - w.f) * k;
      const p = z.phase * n;
      const i0 = Math.floor(p) % n;
      const i1 = (i0 + 1) % n;
      const t = p - Math.floor(p);
      let x = u.x[i0] + (u.x[i1] - u.x[i0]) * t;
      let y = u.y[i0] + (u.y[i1] - u.y[i0]) * t;
      let q = u.z[i0] + (u.z[i1] - u.z[i0]) * t;
      [y, q] = [y * Math.cos(z.wx) - q * Math.sin(z.wx), y * Math.sin(z.wx) + q * Math.cos(z.wx)];
      [x, q] = [x * Math.cos(z.wy) + q * Math.sin(z.wy), -x * Math.sin(z.wy) + q * Math.cos(z.wy)];
      [x, y] = [x * Math.cos(z.wz) - y * Math.sin(z.wz), x * Math.sin(z.wz) + y * Math.cos(z.wz)];
      const s = (1 + w.atmen * Math.sin(2 * Math.PI * z.atem)) * (w.abstand > 0 ? w.abstand / (w.abstand - q) : 1);
      links[i] = x * s * w.laut;
      if (rechts) rechts[i] = y * s * w.laut;
      z.phase = (z.phase + w.f / sampleRate) % 1;
      z.wx = (z.wx + (2 * Math.PI * w.drehX) / sampleRate) % (2 * Math.PI);
      z.wy = (z.wy + (2 * Math.PI * w.drehY) / sampleRate) % (2 * Math.PI);
      z.wz = (z.wz + (2 * Math.PI * w.drehZ) / sampleRate) % (2 * Math.PI);
      z.atem = (z.atem + w.atmenF / sampleRate) % 1;
    }
    if (++this.bloecke % 4 === 0) this.port.postMessage({ winkel: [z.wx, z.wy, z.wz] });
    return true;
  }
}
registerProcessor("oszi-ton", OsziTon);
