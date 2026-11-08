// Die Stimmen: für jeden Strich eine Bank von Oszillatoren im Audio-Thread (AudioWorklet), einer pro Zeile,
// oder eine Wellenform, oder einzelne Noten. Theorie im LIESMICH (Teil 4).
//
// Die Seite schickt pro Videobild (25- bis 30-mal pro Sekunde) die Helligkeit jeder Zeile. Der
// Audio-Thread braucht 48000 Werte pro Sekunde; dazwischen führt jede Stimme ihre Lautstärke weich nach
// (Glättung), sonst springt sie bei jedem Bild, und es knistert.
//
// Drei Arten, einen Strich zu hören:
//   spektrum   jede Zeile ein Ton, Helligkeit = Lautstärke (wie bild-zu-ton)
//   welle      Wellenform (Wavetable): der ganze Strich ist eine Schwingung. Zeile für Zeile gelesen ist
//              die Helligkeit (= wie viel Helles quer zum Strich liegt) die Auslenkung, wie auf der
//              Tonspur eines Films. Diese Form wird mit dem Grundton immer wieder abgespielt.
//   ausloesen  jedes neue Objekt auf dem Strich spielt eine Note (die Seite findet sie, ausloeser.js),
//              gezupft (Karplus-Strong) oder als Glocke, mit Nachklang
// Jeder Strich hat ein Panorama (links bis rechts): zwei Striche links und rechts im Bild sind Stereo.
//
// Dieselbe Datei rechnet auch den Ton fürs Video: dann bekommt sie alle Helligkeiten und Noten vorab
// (processorOptions.zeitplan) und nimmt sich bei jedem Sample die des passenden Bildes.

const TABELLE = 4096; // Schwingung als Tabelle: nachschlagen ist schneller als Math.sin
function tabelle(obertoene) {
  const t = new Float32Array(TABELLE + 1);
  let groesster = 0;
  for (let i = 0; i <= TABELLE; i++) {
    let x = 0;
    obertoene.forEach((a, n) => (x += a * Math.sin((2 * Math.PI * (n + 1) * i) / TABELLE)));
    t[i] = x;
    groesster = Math.max(groesster, Math.abs(x));
  }
  return t.map((x) => x / groesster);
}
// Klangfarben: reiner Sinus, oder „warm“ mit leisen Obertönen (2. und 3. Teilton): klingt weniger dünn
const FARBEN = { sinus: tabelle([1]), warm: tabelle([1, 0.35, 0.15, 0.05]) };
const MAX_NOTEN = 48; // so viele Noten klingen höchstens gleichzeitig (die älteste muss gehen)

class Stimmen extends AudioWorkletProcessor {
  constructor(optionen) {
    super();
    this.striche = [];
    this.noten = [];
    this.einstellung = { dynamik: 60, glaettung: 30, lautstaerke: 0.3, klangfarbe: "sinus" };
    this.k = 0;
    this.zeitplan = null;
    this.bild = -1;
    this.naechsteNote = 0; // im Zeitplan
    // Flecken als Stimmen: id -> { phase, schritt, schrittZiel, amp, ziel, pan, panZiel }
    this.flecken = new Map();
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
    else if (n.art === "noten") n.noten.forEach((note) => this.schlageAn(note));
    else if (n.art === "flecken") this.setzeFlecken(n.flecken);
  }

  // Striche neu: [{ freq (Hz pro Zeile), pan (−1 bis 1), art, grundton (Hz), instrument, nachklang }]
  // Phasen und Lautstärken bleiben, wo es die Stimme schon gab: sonst knackt jede Änderung an Tonleiter
  // oder Frequenz. Weil sich die Phase nur weiterdreht, wird ein Ton einfach schneller oder langsamer.
  baue(neue) {
    this.striche = neue.map((s, i) => {
      const alt = this.striche[i];
      const zeilen = s.freq.length;
      const st = {
        art: s.art,
        pan: s.pan,
        instrument: s.instrument,
        nachklang: s.nachklang,
        zeilen,
        schritt: new Float32Array(zeilen), // Anteil einer Umdrehung pro Sample (Phase von 0 bis 1)
        phase: new Float32Array(zeilen),
        amp: new Float32Array(zeilen), // Lautstärke jetzt (geglättet)
        ziel: new Float32Array(zeilen), // Lautstärke, die das Bild gerade will
        form: new Float32Array(zeilen), // welle: die Schwingung jetzt (geglättet) …
        formZiel: new Float32Array(zeilen), // … und wie das Bild sie will
        welleSchritt: s.grundton / sampleRate,
        wellePhase: alt?.wellePhase ?? 0,
        ausgleich: alt?.ausgleich ?? 1,
      };
      for (let z = 0; z < zeilen; z++) {
        st.schritt[z] = s.freq[z] / sampleRate;
        st.phase[z] = alt && z < alt.zeilen ? alt.phase[z] : Math.random(); // zufälliger Start: sonst knallt es
        if (alt && alt.zeilen === zeilen) {
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
      if (st.art === "welle") {
        // die Schwingung ohne Gleichanteil: Mittelwert abziehen, sonst verschiebt sich die Membran nur
        let mittel = 0;
        for (let z = 0; z < st.zeilen; z++) mittel += w[z];
        mittel /= st.zeilen;
        for (let z = 0; z < st.zeilen; z++) st.formZiel[z] = w[z] - mittel;
      } else if (st.art === "spektrum") {
        for (let z = 0; z < st.zeilen; z++) st.ziel[z] = w[z] > 0 ? 10 ** (((w[z] - 1) * dynamik) / 20) : 0;
      }
    });
  }

  // eine Note anschlagen: { strich, freq, staerke }
  // gezupft (Karplus-Strong, 1983): ein kurzer Puffer voller Rauschen, so lang wie eine Schwingung
  // (Abtastrate / f Samples), wird immer wieder abgespielt und dabei jedes Mal ein wenig geglättet
  // (Mittel zweier Nachbarn). Hohe Obertöne verschwinden zuerst, wie bei einer echten Saite.
  // Glocke: drei Sinustöne in unharmonischen Abständen (1, 2,76, 5,4: wie eine Glocke), die abklingen.
  schlageAn({ strich, freq, staerke }) {
    const st = this.striche[strich];
    if (!st || freq <= 20 || freq > sampleRate / 2.5) return;
    if (this.noten.length >= MAX_NOTEN) this.noten.shift();
    const winkel = ((st.pan + 1) * Math.PI) / 4;
    // pro Sample so viel leiser, dass nach "nachklang" Sekunden nur noch 1/1000 (−60 dB) übrig ist
    const abklingen = Math.exp(Math.log(0.001) / (Math.max(st.nachklang, 0.05) * sampleRate));
    const ende = Math.max(st.nachklang, 0.05) * 1.2 * sampleRate; // danach ist sie sicher unhörbar (unter −60 dB)
    const note = { links: Math.cos(winkel) * staerke, rechts: Math.sin(winkel) * staerke, abklingen, laut: 1, alter: 0, ende };
    if (st.instrument === "glocke") {
      note.teile = [1, 2.76, 5.4].map((v, n) => ({ schritt: (freq * v) / sampleRate, phase: 0, a: [1, 0.5, 0.25][n] }));
    } else {
      const laenge = Math.max(2, Math.round(sampleRate / freq));
      note.puffer = Float32Array.from({ length: laenge }, () => Math.random() * 2 - 1);
      note.pos = 0;
      // Glätten allein lässt tiefe Töne viel länger klingen als hohe: Verlust pro Durchlauf passend zum Nachklang
      note.verlust = Math.exp(Math.log(0.001) / (Math.max(st.nachklang, 0.05) * freq));
    }
    this.noten.push(note);
  }

  spieleNoten(links, rechts) {
    const n = links.length;
    for (const note of this.noten) {
      for (let i = 0; i < n; i++) {
        let x;
        if (note.teile) {
          x = 0;
          for (const t of note.teile) {
            x += t.a * FARBEN.sinus[(t.phase * TABELLE) | 0];
            t.phase += t.schritt;
            if (t.phase >= 1) t.phase -= 1;
          }
          x *= note.laut * 0.5;
          note.laut *= note.abklingen;
        } else {
          const p = note.puffer;
          const j = note.pos;
          const naechste = j + 1 === p.length ? 0 : j + 1;
          x = p[j];
          p[j] = 0.5 * (p[j] + p[naechste]) * note.verlust; // glätten und verlieren
          note.pos = naechste;
        }
        links[i] += x * note.links;
        rechts[i] += x * note.rechts;
      }
      note.alter += n;
    }
    this.noten = this.noten.filter((note) => note.alter < note.ende); // verklungene Noten weg
  }

  // Flecken: jeder Fleck eine Stimme, die ihm folgt. Wer verschwindet, wird leise (und dann vergessen), wer neu
  // ist, fängt leise an. Tonhöhe und Panorama gleiten (etwa 60 ms), damit ein wandernder Fleck singt statt springt
  setzeFlecken(liste) {
    const da = new Set();
    for (const f of liste) {
      da.add(f.id);
      const schritt = f.freq / sampleRate;
      const st = this.flecken.get(f.id) ?? { phase: Math.random(), schritt, amp: 0, pan: f.pan };
      st.schrittZiel = schritt;
      st.ziel = f.laut;
      st.panZiel = f.pan;
      this.flecken.set(f.id, st);
    }
    for (const [id, st] of this.flecken) if (!da.has(id)) st.ziel = 0;
  }

  spieleFlecken(links, rechts, sinus) {
    const n = links.length;
    const k = this.k;
    const gleiten = 1 - Math.exp(-1 / (0.06 * sampleRate));
    // wie bei den Zeilen: viele Stimmen zusammen durch die Wurzel ihrer Zahl
    const ausgleich = 1 / Math.sqrt(Math.max(1, this.flecken.size));
    for (const [id, st] of this.flecken) {
      let { phase, schritt, amp, pan } = st;
      for (let i = 0; i < n; i++) {
        amp += (st.ziel - amp) * k;
        schritt += (st.schrittZiel - schritt) * gleiten;
        pan += (st.panZiel - pan) * gleiten;
        const x = phase * TABELLE;
        const j = x | 0;
        const wert = amp * ausgleich * (sinus[j] + (sinus[j + 1] - sinus[j]) * (x - j));
        const winkel = ((pan + 1) * Math.PI) / 4;
        links[i] += wert * Math.cos(winkel);
        rechts[i] += wert * Math.sin(winkel);
        phase += schritt;
        if (phase >= 1) phase -= 1;
      }
      Object.assign(st, { phase, schritt, amp, pan });
      if (st.ziel === 0 && amp < 1e-4) this.flecken.delete(id);
    }
  }

  // beim Rechnen fürs Video: die Helligkeiten des Bildes, in dem dieses Sample liegt, und seine Noten
  folgeZeitplan() {
    const bild = Math.min(Math.floor((currentFrame * this.zeitplan.fps) / sampleRate), this.zeitplan.bilder - 1);
    if (bild === this.bild) return;
    this.bild = bild;
    this.setzeZiele(this.zeitplan.werte.map((w, i) => w.subarray(bild * this.striche[i].zeilen, (bild + 1) * this.striche[i].zeilen)));
    if (this.zeitplan.flecken) this.setzeFlecken(this.zeitplan.flecken[bild] ?? []);
    const noten = this.zeitplan.noten ?? [];
    while (this.naechsteNote < noten.length && noten[this.naechsteNote].bild <= bild) this.schlageAn(noten[this.naechsteNote++]);
  }

  process(_eingaenge, ausgaenge) {
    const [links, rechts] = ausgaenge[0];
    const n = links.length;
    if (!this.mono || this.mono.length !== n) this.mono = new Float32Array(n); // einmal anlegen
    const mono = this.mono;
    links.fill(0);
    rechts.fill(0);
    if (this.zeitplan) this.folgeZeitplan();
    const { k } = this;
    const sinus = FARBEN[this.einstellung.klangfarbe] ?? FARBEN.sinus;

    for (const st of this.striche) {
      if (st.art === "ausloesen") continue; // die Noten kommen unten
      mono.fill(0);
      if (st.art === "welle") {
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
        let summeZiel = 0;
        for (let z = 0; z < st.zeilen; z++) {
          let a = st.amp[z];
          const ziel = st.ziel[z];
          summeZiel += ziel;
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
            mono[i] += a * (sinus[j] + (sinus[j + 1] - sinus[j]) * (x - j));
            ph += schritt;
            if (ph >= 1) ph -= 1; // klein halten: die Phase ist ein Anteil einer Umdrehung
          }
          st.amp[z] = a;
          st.phase[z] = ph;
        }
        // Ausgleich: viele gleichzeitige Stimmen addieren sich. Teilen durch die Wurzel ihrer Summe
        // (Töne mit zufälliger Phase addieren sich in der Leistung, nicht im Ausschlag), weich nachgeführt
        const soll = 1 / Math.sqrt(Math.max(1, summeZiel));
        st.ausgleich += (soll - st.ausgleich) * (1 - (1 - k) ** n);
        for (let i = 0; i < n; i++) mono[i] *= st.ausgleich;
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
    if (this.noten.length) this.spieleNoten(links, rechts);
    if (this.flecken.size) this.spieleFlecken(links, rechts, sinus);

    // weich begrenzen wie in Spektral-Malen
    const { lautstaerke } = this.einstellung;
    for (let i = 0; i < n; i++) {
      links[i] = Math.tanh(links[i] * lautstaerke);
      rechts[i] = Math.tanh(rechts[i] * lautstaerke);
    }
    return true;
  }
}

registerProcessor("stimmen", Stimmen);

