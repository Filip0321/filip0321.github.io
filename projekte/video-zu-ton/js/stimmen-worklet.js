// Die Stimmen: für jeden Strich eine Bank von Oszillatoren im Audio-Thread (AudioWorklet), einer pro Zeile.
// Theorie im LIESMICH (Teil 4).
//
// Die Seite schickt pro Videobild (25- bis 30-mal pro Sekunde) die Helligkeit jeder Zeile. Der
// Audio-Thread braucht 48000 Werte pro Sekunde; dazwischen führt jede Stimme ihre Lautstärke weich nach
// (Glättung), sonst springt sie bei jedem Bild, und es knistert.
//
// Zwei Arten, einen Strich zu hören:
//   spektrum  jede Zeile ein Sinus, Helligkeit = Lautstärke (wie bild-zu-ton)
//   welle     Lichtton wörtlich: der ganze Strich ist eine Schwingung. Zeile für Zeile gelesen ist die
//             Helligkeit (= wie breit die helle Fläche quer zum Strich ist) die Auslenkung, wie auf der
//             Tonspur eines 35-mm-Films. Diese Form wird mit dem Grundton immer wieder abgespielt
//             (eine Wellentabelle, wie bei Oramics). Ändert sich das Bild, ändert sich die Klangfarbe.
// Jeder Strich hat ein Panorama (links bis rechts): zwei Striche links und rechts im Bild sind Stereo.
//
// Dieselbe Datei rechnet auch den Ton fürs Video: dann bekommt sie alle Helligkeiten vorab
// (processorOptions.zeitplan) und nimmt sich bei jedem Sample die des passenden Bildes.

const TABELLE = 4096; // Sinus als Tabelle: nachschlagen ist schneller als Math.sin, bei hunderten Stimmen zählt das
const SINUS = new Float32Array(TABELLE + 1);
for (let i = 0; i <= TABELLE; i++) SINUS[i] = Math.sin((2 * Math.PI * i) / TABELLE);

class Stimmen extends AudioWorkletProcessor {
  constructor(optionen) {
    super();
    this.striche = [];
    this.einstellung = { dynamik: 60, glaettung: 30, lautstaerke: 0.3 }; // glaettung in Millisekunden
    this.k = 0;
    this.zeitplan = null;
    this.bild = -1;
    this.port.onmessage = ({ data }) => this.nachricht(data);
    const vorab = optionen?.processorOptions;
    if (vorab) {
      this.nachricht({ art: "einstellung", werte: vorab.einstellung });
      this.nachricht({ art: "striche", striche: vorab.striche });
      this.zeitplan = vorab.zeitplan ?? null;
    } else {
      this.stelle({});
    }
  }

  nachricht(n) {
    if (n.art === "striche") this.baue(n.striche);
    else if (n.art === "werte") this.setzeZiele(n.werte);
    else if (n.art === "einstellung") this.stelle(n.werte);
  }

  // Striche neu: [{ freq (Hz pro Zeile), pan (−1 bis 1), welle (bool), grundton (Hz) }]
  // Phasen und Lautstärken bleiben, wo es die Stimme schon gab: sonst knackt jede Änderung an Tonleiter
  // oder Frequenz. Weil sich die Phase nur weiterdreht, wird ein Ton einfach schneller oder langsamer.
  baue(neue) {
    this.striche = neue.map((s, i) => {
      const alt = this.striche[i];
      const zeilen = s.freq.length;
      const st = {
        welle: s.welle,
        pan: s.pan,
        zeilen,
        schritt: new Float32Array(zeilen), // Anteil einer Umdrehung pro Sample (Phase von 0 bis 1)
        phase: new Float32Array(zeilen),
        amp: new Float32Array(zeilen), // Lautstärke jetzt (geglättet)
        ziel: new Float32Array(zeilen), // Lautstärke, die das Bild gerade will
        form: new Float32Array(zeilen), // welle: die Schwingung jetzt (geglättet) …
        formZiel: new Float32Array(zeilen), // … und wie das Bild sie will
        welleSchritt: s.grundton / sampleRate,
        wellePhase: alt?.wellePhase ?? 0,
      };
      for (let z = 0; z < zeilen; z++) {
        st.schritt[z] = s.freq[z] / sampleRate;
        st.phase[z] = alt && z < alt.zeilen ? alt.phase[z] : Math.random(); // zufälliger Start: sonst knallt es
        if (alt && z < alt.zeilen && alt.zeilen === zeilen) {
          st.amp[z] = alt.amp[z];
          st.ziel[z] = alt.ziel[z];
          st.form[z] = alt.form[z];
          st.formZiel[z] = alt.formZiel[z];
        }
      }
      return st;
    });
  }

  stelle(werte) {
    Object.assign(this.einstellung, werte);
    // Tiefpass erster Ordnung: nach glaettung ms sind 63 % (1 − 1/e) des Wegs zum Ziel geschafft.
    // (1 − k)^(τ · Abtastrate) = 1/e  ->  k = 1 − e^(−1 / (τ · Abtastrate))
    const tau = Math.max(this.einstellung.glaettung, 0.1) / 1000;
    this.k = 1 - Math.exp(-1 / (tau * sampleRate));
  }

  // Helligkeit (0 bis 1) -> Lautstärke über dB: 1 = 0 dB, 0 = echte Stille (wie zuAmplitude in /lib/ton.js)
  setzeZiele(werte) {
    const { dynamik } = this.einstellung;
    this.striche.forEach((st, i) => {
      const w = werte[i];
      if (!w || w.length !== st.zeilen) return;
      if (st.welle) {
        // die Schwingung ohne Gleichanteil: Mittelwert abziehen, sonst verschiebt sich die Membran nur
        let mittel = 0;
        for (let z = 0; z < st.zeilen; z++) mittel += w[z];
        mittel /= st.zeilen;
        for (let z = 0; z < st.zeilen; z++) st.formZiel[z] = w[z] - mittel;
      } else {
        for (let z = 0; z < st.zeilen; z++) st.ziel[z] = w[z] > 0 ? 10 ** (((w[z] - 1) * dynamik) / 20) : 0;
      }
    });
  }

  // beim Rechnen fürs Video: die Helligkeiten des Bildes, in dem dieses Sample liegt
  folgeZeitplan() {
    const bild = Math.min(Math.floor((currentFrame * this.zeitplan.fps) / sampleRate), this.zeitplan.bilder - 1);
    if (bild === this.bild) return;
    this.bild = bild;
    this.setzeZiele(this.zeitplan.werte.map((w, i) => w.subarray(bild * this.striche[i].zeilen, (bild + 1) * this.striche[i].zeilen)));
  }

  process(_eingaenge, ausgaenge) {
    const [links, rechts] = ausgaenge[0];
    const n = links.length;
    if (!this.mono || this.mono.length !== n) this.mono = new Float32Array(n); // einmal anlegen, nicht 375-mal pro Sekunde
    const mono = this.mono;
    links.fill(0);
    rechts.fill(0);
    if (this.zeitplan) this.folgeZeitplan();
    const { k } = this;

    for (const st of this.striche) {
      mono.fill(0);
      if (st.welle) {
        // Wellentabelle: die Form pro Block (128 Samples) ein Stück Richtung Ziel, dann abspielen
        const kBlock = 1 - (1 - k) ** n;
        for (let z = 0; z < st.zeilen; z++) st.form[z] += (st.formZiel[z] - st.form[z]) * kBlock;
        let ph = st.wellePhase;
        for (let i = 0; i < n; i++) {
          const x = ph * st.zeilen; // Stelle in der Form, mit Komma: zwischen zwei Zeilen gerade verbinden
          const z0 = Math.floor(x);
          const z1 = z0 + 1 === st.zeilen ? 0 : z0 + 1; // nach der letzten Zeile wieder die erste (Kreis)
          mono[i] = st.form[z0] + (st.form[z1] - st.form[z0]) * (x - z0);
          ph += st.welleSchritt;
          if (ph >= 1) ph -= 1;
        }
        st.wellePhase = ph;
      } else {
        // Oszillatorbank: außen die Zeilen, innen die Samples (die Werte einer Zeile bleiben in Variablen)
        for (let z = 0; z < st.zeilen; z++) {
          let a = st.amp[z];
          const ziel = st.ziel[z];
          if (a < 1e-5 && ziel === 0) {
            st.amp[z] = 0; // still und bleibt still: überspringen (ein dunkles Bild kostet fast nichts)
            continue;
          }
          let ph = st.phase[z];
          const schritt = st.schritt[z];
          for (let i = 0; i < n; i++) {
            a += (ziel - a) * k; // Glättung
            const x = ph * TABELLE;
            const j = x | 0; // abrunden (schneller als Math.floor, geht bei positiven Zahlen)
            mono[i] += a * (SINUS[j] + (SINUS[j + 1] - SINUS[j]) * (x - j));
            ph += schritt;
            if (ph >= 1) ph -= 1; // klein halten: die Phase ist ein Anteil einer Umdrehung
          }
          st.amp[z] = a;
          st.phase[z] = ph;
        }
      }
      // Panorama mit gleicher Leistung: in der Mitte je cos(45°) ≈ 0,71, nicht 0,5 (sonst ein Loch in der Mitte)
      const winkel = ((st.pan + 1) * Math.PI) / 4;
      const gl = Math.cos(winkel);
      const gr = Math.sin(winkel);
      for (let i = 0; i < n; i++) {
        links[i] += mono[i] * gl;
        rechts[i] += mono[i] * gr;
      }
    }

    // viele Stimmen zusammen sind lauter als 1: weich begrenzen wie in Spektral-Malen
    const { lautstaerke } = this.einstellung;
    for (let i = 0; i < n; i++) {
      links[i] = Math.tanh(links[i] * lautstaerke);
      rechts[i] = Math.tanh(rechts[i] * lautstaerke);
    }
    return true;
  }
}

registerProcessor("stimmen", Stimmen);
