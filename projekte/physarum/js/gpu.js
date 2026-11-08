// Physarum auf der Grafikkarte, mit WebGPU (Compute-Shader statt Bilder malen).
//
// Warum WebGPU: Hier sind es Hunderttausende einzelne Agenten, die jeder an eine andere Stelle schreiben (ihre
// Duftspur ablegen). In WebGL geht das nur mit Tricks (jeden Agenten als Punkt zeichnen). In WebGPU gibt es
// Compute-Shader: Programme, die nicht malen, sondern einfach für jedes Element eines Puffers laufen, und
// atomare Operationen, mit denen viele gleichzeitig in dieselbe Zelle addieren dürfen, ohne sich zu stören.
//
// Puffer:
//   agenten   je Agent vec4: x, y, Richtung (Bogenmaß), frei
//   spur      die Duftspur, eine Zahl je Pixel (zwei Stück, abwechselnd gelesen und geschrieben)
//   ablage    was die Agenten in diesem Schritt ablegen, als Ganzzahl (atomicAdd geht nur mit Ganzzahlen;
//             darum mal 1000 und beim Verteilen wieder durch 1000: „Festkomma“)
//   futter    Helligkeit des Fotos je Pixel (0 bis 1); riecht für die Agenten wie Spur, verteilt sich aber nicht
// Ein Schritt: 1. Agenten (riechen, drehen, gehen, ablegen)  2. Spur (verteilen, verfallen, Ablage und Futter dazu)
// Anzeigen: ein Bild-Shader liest die Spur und färbt sie über eine Farbtabelle.

const PARAMS = `
struct Params {
  breite: u32,
  hoehe: u32,
  anzahl: u32,
  bild: u32,           // Zähler, damit der Zufall in jedem Schritt anders ist
  sensorWinkel: f32,   // Bogenmaß
  sensorAbstand: f32,  // Pixel
  drehWinkel: f32,     // Bogenmaß
  schritt: f32,        // Pixel pro Schritt
  ablage: f32,
  verfall: f32,        // Anteil, der pro Schritt verschwindet
  diffusion: f32,      // 0: bleibt, 1: ganz zum Mittel der 3 × 3 Nachbarn
  futter: f32,         // wie stark das Foto lockt
  rand: f32,           // 0: herumlaufen (Torus), 1: abprallen
  helligkeit: f32,
  gamma: f32,
  frei: f32,
  pinsel: vec4f,       // x, y (Pixel), Radius (Pixel), Stärke (+ lockt, − vertreibt)
}
@group(0) @binding(0) var<uniform> p: Params;
`;

// Zufall: ein Hash (PCG) aus Agent und Schritt, gibt 0 bis 1
const ZUFALL = `
fn hash(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn zufall(a: u32, b: u32) -> f32 {
  return f32(hash(a ^ hash(b))) / 4294967295.0;
}`;

const AGENTEN = `${PARAMS}${ZUFALL}
@group(0) @binding(1) var<storage, read_write> agenten: array<vec4f>;
@group(0) @binding(2) var<storage, read> spur: array<f32>;
@group(0) @binding(3) var<storage, read_write> ablage: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> futter: array<f32>;

// die Spur an einer Stelle (mit Herumlaufen an den Rändern), dazu das Futter
fn riechen(q: vec2f) -> f32 {
  let b = i32(p.breite);
  let h = i32(p.hoehe);
  let x = ((i32(floor(q.x)) % b) + b) % b;
  let y = ((i32(floor(q.y)) % h) + h) % h;
  let i = u32(x + y * b);
  // Futter in derselben Größenordnung wie die Spur: im Gleichgewicht liegt etwa Ablage / Verfall pro Agent und Pixel,
  // darum damit malnehmen (sonst ginge das Foto bei viel Spur unter, bei wenig wäre es übermächtig)
  return spur[i] + p.futter * futter[i] * p.ablage / p.verfall;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= p.anzahl) { return; }
  var a = agenten[i];
  var pos = a.xy;
  var w = a.z;
  // 1. riechen: drei Fühler vorn, links vorn, rechts vorn
  let vorn = riechen(pos + p.sensorAbstand * vec2f(cos(w), sin(w)));
  let links = riechen(pos + p.sensorAbstand * vec2f(cos(w + p.sensorWinkel), sin(w + p.sensorWinkel)));
  let rechts = riechen(pos + p.sensorAbstand * vec2f(cos(w - p.sensorWinkel), sin(w - p.sensorWinkel)));
  // 2. drehen (Jeff Jones): vorn am stärksten → geradeaus; vorn am schwächsten → zufällig links oder rechts;
  //    sonst zur stärkeren Seite
  let z = zufall(i, p.bild);
  if (vorn > links && vorn > rechts) {
  } else if (vorn < links && vorn < rechts) {
    w += select(-p.drehWinkel, p.drehWinkel, z < 0.5);
  } else if (links > rechts) {
    w += p.drehWinkel;
  } else if (rechts > links) {
    w -= p.drehWinkel;
  }
  // 3. gehen
  pos += p.schritt * vec2f(cos(w), sin(w));
  let b = f32(p.breite);
  let h = f32(p.hoehe);
  if (p.rand > 0.5) {
    // abprallen: am Rand umdrehen (zufällige neue Richtung nach innen, sonst kleben sie an der Wand)
    if (pos.x < 0.0 || pos.x >= b || pos.y < 0.0 || pos.y >= h) {
      pos = clamp(pos, vec2f(0.0), vec2f(b - 0.01, h - 0.01));
      w = z * 6.2831853;
    }
  } else {
    pos = (pos % vec2f(b, h) + vec2f(b, h)) % vec2f(b, h);
  }
  // 4. ablegen (Festkomma, damit viele Agenten gleichzeitig in dieselbe Zelle addieren können)
  let zelle = u32(pos.x) + u32(pos.y) * p.breite;
  atomicAdd(&ablage[zelle], u32(p.ablage * 1000.0));
  agenten[i] = vec4f(pos, w, a.w);
}`;

const SPUR = `${PARAMS}
@group(0) @binding(1) var<storage, read> spurAlt: array<f32>;
@group(0) @binding(2) var<storage, read_write> spurNeu: array<f32>;
@group(0) @binding(3) var<storage, read_write> ablage: array<atomic<u32>>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= p.breite || id.y >= p.hoehe) { return; }
  let b = i32(p.breite);
  let h = i32(p.hoehe);
  let x = i32(id.x);
  let y = i32(id.y);
  let i = id.x + id.y * p.breite;
  // verteilen: Mittel der 3 × 3 Nachbarn (Ränder laufen herum)
  var summe = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let nx = (x + dx + b) % b;
      let ny = (y + dy + h) % h;
      summe += spurAlt[u32(nx + ny * b)];
    }
  }
  var wert = mix(spurAlt[i], summe / 9.0, p.diffusion);
  // verfallen, dann was die Agenten abgelegt haben dazu (und den Zähler wieder auf 0)
  wert = wert * (1.0 - p.verfall) + f32(atomicExchange(&ablage[i], 0u)) / 1000.0;
  // Pinsel: lockt (+) oder vertreibt (−) im Kreis
  let d = distance(vec2f(f32(x), f32(y)), p.pinsel.xy);
  if (p.pinsel.z > 0.0 && d < p.pinsel.z) {
    wert = max(0.0, wert + p.pinsel.w * (1.0 - d / p.pinsel.z));
  }
  spurNeu[i] = wert;
}`;

const ANZEIGE = `${PARAMS}
@group(0) @binding(1) var<storage, read> spur: array<f32>;
@group(0) @binding(2) var<storage, read> tabelle: array<vec4f>;

@vertex
fn vs(@builtin(vertex_index) n: u32) -> @builtin(position) vec4f {
  // ein Dreieck, das den ganzen Bildschirm bedeckt
  let ecke = vec2f(f32((n << 1u) & 2u), f32(n & 2u));
  return vec4f(ecke * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) stelle: vec4f) -> @location(0) vec4f {
  let x = min(u32(stelle.x), p.breite - 1u);
  let y = min(u32(stelle.y), p.hoehe - 1u);
  let s = spur[x + y * p.breite];
  // 1 − e^(−s · Helligkeit): hohe Werte laufen sanft gegen 1, statt hart abgeschnitten zu werden; dann Gamma
  let t = pow(1.0 - exp(-s * p.helligkeit), p.gamma);
  let f = tabelle[u32(clamp(t, 0.0, 1.0) * 255.0)];
  return vec4f(f.rgb, 1.0);
}`;

export async function erstelleGpu(canvas) {
  if (!navigator.gpu) throw new Error("Dieser Browser kann kein WebGPU. Es geht in neueren Versionen von Chrome, Edge und Safari.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU ist da, aber keine Grafikkarte dafür gefunden.");
  const geraet = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 512 * 1024 * 1024),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 512 * 1024 * 1024),
    },
  });
  geraet.lost.then((info) => console.warn("WebGPU verloren:", info.reason, info.message));
  const ctx = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device: geraet, format, alphaMode: "opaque" });

  const S = GPUBufferUsage.STORAGE;
  const K = GPUBufferUsage.COPY_DST;
  const paramsPuffer = geraet.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | K });
  const tabellePuffer = geraet.createBuffer({ size: 256 * 16, usage: S | K });

  const modul = (code) => geraet.createShaderModule({ code });
  const agentenPipe = geraet.createComputePipeline({ layout: "auto", compute: { module: modul(AGENTEN), entryPoint: "main" } });
  const spurPipe = geraet.createComputePipeline({ layout: "auto", compute: { module: modul(SPUR), entryPoint: "main" } });
  const anzeigeModul = modul(ANZEIGE);
  const anzeigePipe = geraet.createRenderPipeline({
    layout: "auto",
    vertex: { module: anzeigeModul, entryPoint: "vs" },
    fragment: { module: anzeigeModul, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  let b = 0, h = 0, anzahl = 0;
  let agenten, spur = [], ablage, futter;
  let gruppen = null; // Bindungen, je Richtung des Ping-Pong
  let jetzt = 0; // welche Spur gerade gilt
  let zaehler = 0;

  function binde() {
    const eintraege = (pipe, puffer) =>
      geraet.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: puffer.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    gruppen = [0, 1].map((k) => ({
      agenten: eintraege(agentenPipe, [paramsPuffer, agenten, spur[k], ablage, futter]),
      spur: eintraege(spurPipe, [paramsPuffer, spur[k], spur[1 - k], ablage]),
      anzeige: eintraege(anzeigePipe, [paramsPuffer, spur[k], tabellePuffer]),
    }));
  }

  // neue Größe und Zahl der Agenten; start: Float32Array mit je x, y, w, 0
  function neu(breite, hoehe, start) {
    for (const x of [agenten, ...spur, ablage, futter]) x?.destroy();
    b = breite;
    h = hoehe;
    anzahl = start.length / 4;
    canvas.width = b;
    canvas.height = h;
    agenten = geraet.createBuffer({ size: start.byteLength, usage: S | K | GPUBufferUsage.COPY_SRC });
    geraet.queue.writeBuffer(agenten, 0, start);
    spur = [0, 1].map(() => geraet.createBuffer({ size: b * h * 4, usage: S | K | GPUBufferUsage.COPY_SRC }));
    ablage = geraet.createBuffer({ size: b * h * 4, usage: S | K });
    futter = geraet.createBuffer({ size: b * h * 4, usage: S | K });
    jetzt = 0;
    binde();
  }

  function setzeFutter(werte) {
    geraet.queue.writeBuffer(futter, 0, werte);
  }
  // zahlen: 256 · 3 Bytes (wie farbtabelle in /lib/farben.js)
  function setzeTabelle(zahlen) {
    const f = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++) f.set([zahlen[i * 3] / 255, zahlen[i * 3 + 1] / 255, zahlen[i * 3 + 2] / 255, 1], i * 4);
    geraet.queue.writeBuffer(tabellePuffer, 0, f);
  }

  function schreibeParams(w) {
    const d = new ArrayBuffer(80);
    const u = new Uint32Array(d);
    const f = new Float32Array(d);
    u[0] = b;
    u[1] = h;
    u[2] = anzahl;
    u[3] = zaehler++;
    f[4] = w.sensorWinkel;
    f[5] = w.sensorAbstand;
    f[6] = w.drehWinkel;
    f[7] = w.schritt;
    f[8] = w.ablage;
    f[9] = w.verfall;
    f[10] = w.diffusion;
    f[11] = w.futter;
    f[12] = w.rand;
    f[13] = w.helligkeit;
    f[14] = w.gamma;
    f.set(w.pinsel, 16); // vec4 beginnt bei Byte 64 (muss durch 16 teilbar sein)
    geraet.queue.writeBuffer(paramsPuffer, 0, d);
  }

  // n Schritte, dann anzeigen. Jeder Schritt bekommt seine eigenen Parameter (der Zähler für den Zufall), darum
  // ein eigener Auftrag pro Schritt: writeBuffer gilt erst für die Aufträge, die danach abgeschickt werden
  function schritte(n, w) {
    for (let s = 0; s < n; s++) {
      schreibeParams(s === 0 ? w : { ...w, pinsel: [0, 0, 0, 0] });
      const auftrag = geraet.createCommandEncoder();
      const pass = auftrag.beginComputePass();
      pass.setPipeline(agentenPipe);
      pass.setBindGroup(0, gruppen[jetzt].agenten);
      pass.dispatchWorkgroups(Math.ceil(anzahl / 256));
      pass.setPipeline(spurPipe);
      pass.setBindGroup(0, gruppen[jetzt].spur);
      pass.dispatchWorkgroups(Math.ceil(b / 16), Math.ceil(h / 16));
      pass.end();
      geraet.queue.submit([auftrag.finish()]);
      jetzt = 1 - jetzt;
    }
  }
  function zeige(w) {
    schreibeParams({ ...w, pinsel: [0, 0, 0, 0] });
    const auftrag = geraet.createCommandEncoder();
    const pass = auftrag.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(anzeigePipe);
    pass.setBindGroup(0, gruppen[jetzt].anzeige);
    pass.draw(3);
    pass.end();
    geraet.queue.submit([auftrag.finish()]);
  }

  // Zustand merken (Agenten und Spur) und zurückholen, für die Vorschau im Export-Fenster. Alles bleibt auf der
  // Grafikkarte: kopiert wird in zwei Ersatzpuffer und zurück (kein Lesen zur CPU, das ginge nur asynchron)
  function merke() {
    const kopiere = (von, nach, groesse) => {
      const auftrag = geraet.createCommandEncoder();
      auftrag.copyBufferToBuffer(von, 0, nach, 0, groesse);
      geraet.queue.submit([auftrag.finish()]);
    };
    const a = geraet.createBuffer({ size: anzahl * 16, usage: K | GPUBufferUsage.COPY_SRC });
    const sp = geraet.createBuffer({ size: b * h * 4, usage: K | GPUBufferUsage.COPY_SRC });
    const welche = jetzt;
    const ziele = { agenten, spur: spur[welche] };
    kopiere(agenten, a, anzahl * 16);
    kopiere(spur[welche], sp, b * h * 4);
    return () => {
      if (ziele.agenten !== agenten) return; // inzwischen neu angelegt: nichts zurückzuholen
      kopiere(a, agenten, anzahl * 16);
      kopiere(sp, spur[welche], b * h * 4);
      jetzt = welche;
    };
  }

  // zum Testen (in node mit Dawn): ein paar Zahlen über Agenten und Spur
  async function statistik() {
    const lies = async (quelle, groesse) => {
      const ziel = geraet.createBuffer({ size: groesse, usage: GPUBufferUsage.MAP_READ | K });
      const auftrag = geraet.createCommandEncoder();
      auftrag.copyBufferToBuffer(quelle, 0, ziel, 0, groesse);
      geraet.queue.submit([auftrag.finish()]);
      await ziel.mapAsync(GPUMapMode.READ);
      const kopie = new Float32Array(ziel.getMappedRange().slice(0));
      ziel.destroy();
      return kopie;
    };
    const a = await lies(agenten, anzahl * 16);
    let rand = 0, nan = 0;
    for (let i = 0; i < anzahl; i++) {
      const x = a[i * 4], y = a[i * 4 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) nan++;
      else if (x < 2 || y < 2 || x > b - 2 || y > h - 2) rand++;
    }
    const sp = await lies(spur[jetzt], b * h * 4);
    let max = 0, summe = 0;
    for (const v of sp) { max = Math.max(max, v); summe += v; }
    return { a: [...a.slice(0, 8)], max, mittel: summe / sp.length, b, h, anzahl, rand, nan };
  }
  return { statistik, neu, setzeFutter, setzeTabelle, schritte, zeige, merke, warte: () => geraet.queue.onSubmittedWorkDone() };
}
