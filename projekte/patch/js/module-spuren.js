// Spuren (Runde 23b): was eine DAW wie Ableton ausmacht, als Module auf der Wand.
//
// Eine Spur ist eine Kette: Noten → Instrument → Effekte → Kanal. Auf der Wand ist sie eine Gruppe (zugeklappt sieht
// man nur Pegel, Lage, Send; ± zeigt das ganze Instrument). Darüber steht ein Clip-Player wie Abletons Session-Ansicht.
//
//   Kanal   der Kanalzug eines Mischpults: Pegel in dB, Lage (Panorama), Send (Abzweig zum Hall), Solo, Anzeige.
//           Aus (⏻) gibt es schon an jedem Modul.
//   Clips   ein Raster: Spalten = Spuren (1 … 8), Zeilen = Szenen (1 … 8). Jedes Feld kann einen Clip halten, eine
//           kurze Notenschleife (1, 2 oder 4 Takte), gezeichnet in derselben Rolle wie die Pianoroll. Ein Klick
//           startet den Clip, aber erst beim nächsten Takt (Quantisierung: so bleibt alles im Gleichschritt, egal
//           wann man klickt). Je Spalte spielt höchstens ein Clip; ein neuer ersetzt den alten. ▶ an einer Zeile
//           startet die ganze Szene. Im Modus „Ablauf“ spielt der Player selbst eine Folge von Szenen ab: das ist
//           die Zeitleiste, das Arrangement („1 1 2 3“ = Szene 1 für zwei Felder, dann 2, dann 3, dann von vorn).

import { Takt, Noten } from "./takt.js";
import { verstaerker, konstante, LEITER_WAHL, GRUNDTOENE } from "./bausteine.js";
import { neueRolle, wuerfle, RASTER } from "./rolle.js";

const geaendert = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));

// ---------- Kanal ----------
// Pegel in Dezibel: das Ohr hört Lautstärke logarithmisch. −6 dB ist halbe Amplitude, −20 dB ein Zehntel, −60 dB
// fast nichts (dort ist der Knopf ganz zu). Faktor = 10^(dB / 20).
// Solo: drückt man an einem Kanal Solo, verstummen alle Kanäle ohne Solo. Das müssen die Kanäle untereinander wissen;
// darum stehen alle in einer gemeinsamen Menge (KANAELE), und jeder Solo-Druck rechnet alle neu.
// Send: ein Abzweig hinter dem Pegel („post fader“: wird die Spur leiser, wird auch ihr Hall leiser). Viele Spuren
// schicken an EINEN Hall; das spart Rechenzeit und klingt wie ein gemeinsamer Raum.
// Anzeige: Spitzenwert in dB, mit einem Strich, der die höchste Spitze der letzten 1,5 s hält (Peak Hold).
const KANAELE = new Set();
const soloNeu = () => {
  const irgendein = [...KANAELE].some((k) => k.solo);
  for (const k of KANAELE) k.soloStumm.gain.setTargetAtTime(irgendein && !k.solo ? 0 : 1, k.ctx.currentTime, 0.01);
};
const dB = (v) => (v <= -59.9 ? 0 : 10 ** (v / 20));

const kanal = {
  titel: "Kanal",
  gruppe: "Spuren",
  baue(ctx, { bild, modul }) {
    const ein = verstaerker(ctx, 1), pegel = verstaerker(ctx, 1), lage = ctx.createStereoPanner(), soloStumm = verstaerker(ctx, 1);
    const send = verstaerker(ctx, 0), mess = ctx.createAnalyser();
    mess.fftSize = 1024;
    ein.connect(pegel);
    pegel.connect(lage);
    lage.connect(soloStumm);
    soloStumm.connect(send);
    soloStumm.connect(mess);
    const k = { ctx, soloStumm, solo: false };
    KANAELE.add(k);
    const daten = new Float32Array(1024);
    let c = null, g = null, halte = -60, halteZeit = 0;
    const zeichne = () => {
      if (!c || c.offsetParent === null) return;
      mess.getFloatTimeDomainData(daten);
      let spitze = 0;
      for (const v of daten) spitze = Math.max(spitze, Math.abs(v));
      const d = spitze > 0 ? Math.max(-60, 20 * Math.log10(spitze)) : -60;
      const jetzt = performance.now();
      if (d >= halte || jetzt - halteZeit > 1500) {
        halte = d;
        halteZeit = jetzt;
      }
      const B = c.width, H = c.height, x = (v) => ((Math.min(6, v) + 60) / 66) * B;
      g.clearRect(0, 0, B, H);
      g.fillStyle = getComputedStyle(c).color;
      g.globalAlpha = 0.25;
      for (const m of [-48, -36, -24, -12, -6, 0]) g.fillRect(x(m), 0, 1, H); // Teilstriche
      g.globalAlpha = 1;
      g.fillRect(0, 3, x(d), H - 6);
      g.fillRect(x(halte) - 1, 0, 2, H);
      if (halte > 0) g.strokeRect(0.5, 0.5, B - 1, H - 1); // über 0 dB: Rahmen als Warnung (gleich wird begrenzt)
    };
    return {
      ein: { ein: { art: "ton", ziel: ein } },
      aus: { aus: { art: "ton", knoten: soloStumm }, Send: { art: "ton", knoten: send, info: "Abzweig hinter dem Pegel, für einen gemeinsamen Hall oder ein Echo" } },
      regler: [
        { name: "pegel", text: "Pegel", min: -60, max: 6, wert: 0, schritt: 0.5, einheit: "dB", setze: (v) => pegel.gain.setTargetAtTime(dB(v), ctx.currentTime, 0.01) },
        { name: "lage", text: "Lage", min: -1, max: 1, wert: 0, setze: (v) => lage.pan.setTargetAtTime(v, ctx.currentTime, 0.01) },
        { name: "send", text: "Send", min: 0, max: 1, wert: 0, setze: (v) => send.gain.setTargetAtTime(v, ctx.currentTime, 0.01) },
      ],
      extra: (el) => {
        const reihe = document.createElement("div");
        reihe.className = "steuerung knopf-reihe";
        const solo = document.createElement("button");
        solo.type = "button";
        solo.textContent = "Solo";
        solo.className = "solo-knopf";
        const setze = (an) => {
          k.solo = an;
          modul.werte.solo = an || undefined;
          solo.setAttribute("aria-pressed", String(an));
          soloNeu();
        };
        solo.addEventListener("click", () => {
          setze(!k.solo);
          geaendert(solo);
        });
        setze(Boolean(modul.werte.solo));
        c = document.createElement("canvas");
        c.width = 220;
        c.height = 14;
        c.className = "pegel-anzeige";
        g = c.getContext("2d");
        reihe.append(solo);
        el.append(c, reihe);
        bild.add(zeichne);
      },
      weg: () => {
        KANAELE.delete(k);
        soloNeu();
        bild.delete(zeichne);
      },
    };
  },
};

// ---------- Clips ----------
const SPUREN = 16, SZENEN = 8; // Runde 29: 16 Spuren (vorher 8)
const schluessel = (sp, sz) => `${sp}:${sz}`;

const clips = {
  titel: "Clips",
  gruppe: "Spuren",
  baue(ctx, { uhr, bild, tempo, modul, lautsprecher }) {
    const noten = Array.from({ length: SPUREN }, () => new Noten());
    const taktAus = new Takt();
    const w = { modus: "frei", feld: 4, grundton: "0", leiter: "keine", neuTakte: 1, raster: 1, arrTakte: 16 };
    // die Clips stehen in den Werten: so kommen sie mit in den Patch. Eine eigene Kopie (aus einer Vorlage kommt sonst
    // dasselbe Objekt, und Zeichnen würde die Vorlage selbst ändern)
    modul.werte.clips = structuredClone(modul.werte.clips ?? {});
    const C = () => (modul.werte.clips ??= {});
    // Arrangement (Runde 27): je Spur eine Liste von Platzierungen [Starttakt, Szene, Länge in Takten]. Eine Platzierung
    // zeigt auf den Clip dieser Spur in dieser Szene; ist sie länger als der Clip, läuft der Clip darin im Kreis.
    modul.werte.arr = structuredClone(modul.werte.arr ?? {});
    const A = () => (modul.werte.arr ??= {});
    let arrStart = null, arrKopf = -1;
    modul.werte.auto = structuredClone(modul.werte.auto ?? []);
    const auto = (a) => (modul.werte.auto[a] ??= []);
    const autoWert = (a, takt) => {
      const pk = auto(a);
      if (!pk.length) return 0;
      if (takt <= pk[0][0]) return pk[0][1];
      for (let i = 1; i < pk.length; i++) if (takt <= pk[i][0]) {
        const [t0, v0] = pk[i - 1], [t1, v1] = pk[i];
        return v0 + ((v1 - v0) * (takt - t0)) / Math.max(1e-6, t1 - t0);
      }
      return pk.at(-1)[1];
    };
    const autoAus = Array.from({ length: 4 }, () => konstante(ctx, 0));
    // Aufnehmen (Runde 30): Noten am Eingang „Aufnahme“ werden in den gewählten Clip geschrieben, an die Stelle, an
    // der er gerade spielt. Die Uhr merkt sich den letzten Schlag (Zeit und Nummer); daraus ist für jede Zeit t die
    // Position in Sechzehnteln: nr + (t − Zeit) / Sechzehntel. Gerundet aufs Raster (frei: nicht gerundet).
    let letzt = { t: 0, nr: 0 }, aufnahme = false, aufKnopf = null, zaehleBis = null, vorAufnahme = null;
    // Metronom (Runde 31): während der Aufnahme ein Klick je Viertel, der erste im Takt höher. Einzähler: der Clip
    // startet erst nach einem ganzen Takt Klicks (wie Abletons Count-In: 1 Takt), damit man den Einsatz trifft.
    const klick = (t, hoch) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = hoch ? 1760 : 1320;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g).connect(lautsprecher ?? ctx.destination);
      o.start(t);
      o.stop(t + 0.06);
    };
    const offen = new Map(); // Note → [Eintrag, Startzeit]: Länge erst beim Loslassen bekannt
    const rec = (t, n, vel = 0.8, d = Infinity) => {
      if (!aufnahme) return;
      const sp = Number(gewaehlt.split(":")[0]);
      const clip = (C()[gewaehlt] ??= { takte: w.neuTakte, tiefste: 48, noten: [] });
      const s = spielt[sp];
      if (s?.key !== gewaehlt) {
        // der Clip spielt noch nicht (oder es wird gerade eingezählt): diese Note geht verloren; ohne Einzähler startet
        // er beim nächsten Takt
        if (zaehleBis === null) wartet[sp] = gewaehlt;
        version++;
        return;
      }
      const sech = 15 / tempo(), laenge = clip.takte * 16, r = w.raster;
      let pos = (((letzt.nr + (t - letzt.t) / sech - s.start) % laenge) + laenge) % laenge;
      pos = r > 0 ? (Math.round(pos / r) * r) % laenge : Math.round(pos * 100) / 100;
      const roh = Number.isFinite(d) ? d / sech : 1;
      const e = [pos, n, r > 0 ? Math.max(r, Math.round(roh / r) * r) : Math.max(0.25, Math.round(roh * 100) / 100), vel];
      clip.noten.push(e);
      if (!Number.isFinite(d)) offen.set(n, [e, t]);
      version++;
    };
    rec.aus = (t, n) => {
      const o = offen.get(n);
      if (!o) return;
      offen.delete(n);
      const sech = 15 / tempo(), r = w.raster;
      let l = (t - o[1]) / sech;
      l = r > 0 ? Math.max(r, Math.round(l / r) * r) : Math.max(0.25, Math.round(l * 100) / 100);
      o[0][2] = l;
      if (platz) geaendert(platz);
    };
    rec.alleAus = (t) => [...offen.keys()].forEach((n) => rec.aus(t, n));
    const spielt = Array(SPUREN).fill(null); // { key, start }
    const wartet = Array(SPUREN).fill(undefined); // key, "stop" oder undefined
    const kopf = Array(SPUREN).fill(-1);
    let gewaehlt = schluessel(0, 0), leer = [], ablaufStart = null, letzteSzene = null, ablaufFeld = -1, version = 0;
    const ablauf = () => String(modul.werte.ablauf ?? "1").split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= SZENEN);

    const starte = (sp, key, nr) => {
      spielt[sp] = key ? { key, start: nr } : null;
      if (!key) kopf[sp] = -1;
      version++;
    };
    const szene = (sz, nr) => {
      for (let sp = 0; sp < SPUREN; sp++) {
        const key = schluessel(sp, sz);
        if (C()[key]) starte(sp, key, nr);
        else starte(sp, null, nr); // leeres Feld in einer Szene: diese Spur schweigt (wie in Ableton)
      }
    };

    const abo = uhr.abonniere(() => tempo() * 4, (t, nr) => {
      const sechzehntel = 15 / tempo();
      letzt = { t, nr };
      if (aufnahme && nr % 4 === 0) klick(t, nr % 16 === 0);
      if (zaehleBis !== null && nr % 16 === 0) {
        // der Einzähl-Takt: erst beim zweiten Taktanfang nach dem Drücken startet der Clip
        if (zaehleBis === "warte") zaehleBis = nr + 16;
        else if (nr >= zaehleBis) {
          const sp = Number(gewaehlt.split(":")[0]);
          wartet[sp] = gewaehlt;
          zaehleBis = null;
        }
      }
      if (nr % 16 === 0) {
        // Taktanfang: was wartet, beginnt jetzt
        taktAus.sende(t, sechzehntel);
        for (let sp = 0; sp < SPUREN; sp++) {
          if (wartet[sp] === undefined) continue;
          starte(sp, wartet[sp] === "stop" ? null : wartet[sp], nr);
          wartet[sp] = undefined;
        }
        if (w.modus === "ablauf") {
          const liste = ablauf();
          ablaufStart ??= nr;
          const takt = Math.floor((nr - ablaufStart) / 16);
          if (liste.length && takt % w.feld === 0) {
            ablaufFeld = Math.floor(takt / w.feld) % liste.length;
            const sz = liste[ablaufFeld] - 1;
            // dieselbe Szene im nächsten Feld läuft einfach weiter (ein 4-Takt-Clip in 2-Takt-Feldern bricht nicht ab)
            if (sz !== letzteSzene) szene(sz, nr);
            letzteSzene = sz;
            version++;
          }
        } else {
          ablaufStart = null;
          letzteSzene = null;
          ablaufFeld = -1;
        }
      }
      if (w.modus === "arrangement") {
        // die Zeitleiste spielt: jede Spur nimmt die Platzierung, die gerade unter dem Kopf liegt
        if (arrStart === null && nr % 16 === 0) arrStart = nr;
        if (arrStart !== null) {
          const ganz = w.arrTakte * 16, pos = (((nr - arrStart) % ganz) + ganz) % ganz, takt = Math.floor(pos / 16);
          setTimeout(() => (arrKopf = pos / 16), Math.max(0, (t - ctx.currentTime) * 1000));
          // Automation: bis zu diesem Schlag gleitend auf den Wert der Linie (eine Rampe je Sechzehntel)
          for (let a = 0; a < AUTOS; a++) autoAus[a].offset.linearRampToValueAtTime(autoWert(a, pos / 16), t);
          for (let sp = 0; sp < SPUREN; sp++) {
            const pl = (A()[sp] ?? []).find(([a, , l]) => takt >= a && takt < a + l);
            const key = pl && C()[schluessel(sp, pl[1])] ? schluessel(sp, pl[1]) : null;
            if (!key) {
              if (spielt[sp]) starte(sp, null, nr);
              continue;
            }
            const start = nr - (pos - pl[0] * 16); // der Clip beginnt am Anfang seiner Platzierung
            if (spielt[sp]?.key !== key || spielt[sp].start !== start) {
              spielt[sp] = { key, start };
              version++;
            }
          }
        }
      } else if (arrStart !== null) {
        arrStart = null;
        arrKopf = -1;
        spielt.fill(null);
        version++;
      }
      for (let sp = 0; sp < SPUREN; sp++) {
        const s = spielt[sp];
        if (!s) continue;
        const clip = C()[s.key];
        if (!clip) {
          starte(sp, null, nr);
          continue;
        }
        const laenge = clip.takte * 16, schritt = (((nr - s.start) % laenge) + laenge) % laenge;
        // auch Noten neben dem Raster: im Sechzehntel, in dem sie liegen, um den Bruchteil später
        // Audio-Clip mit „Re-Pitch“ (wie der gleichnamige Warp-Modus in Ableton): ist das Tempo anders als beim
        // Anlegen, spielt der Sampler die Datei schneller oder langsamer, damit sie in ihre Takte passt. Die Tonhöhe
        // geht mit (wie bei einem Plattenspieler): 12 · log₂(neu / alt) Halbtöne
        // (Hängt an der Spur „Strecken“, folgt die Datei dem Tempo selbst, ohne Tonhöhe: dann nichts verschieben.)
        const verschiebe = clip.audio && clip.audioTempo && !ziel(sp)?.audio?.strecken ? 12 * Math.log2(tempo() / clip.audioTempo) : 0;
        for (const [a, n, l, vel] of clip.noten) if (Math.floor(a) === schritt) noten[sp].an(t + (a - schritt) * sechzehntel, n + verschiebe, vel, l * sechzehntel * 0.96);
        setTimeout(() => (kopf[sp] = spielt[sp] === s ? schritt : -1), Math.max(0, (t - ctx.currentTime) * 1000));
      }
    });

    // ----- Rolle für den gewählten Clip -----
    const clipVon = (key) => C()[key];
    const hoere = (n, vel) => {
      const sp = Number(gewaehlt.split(":")[0]);
      noten[sp].an(ctx.currentTime + 0.01, n, vel, 0.2);
    };
    let platz = null;
    const speichere = () => {
      // in ein leeres Feld gezeichnet: jetzt ist dort ein Clip
      if (!clipVon(gewaehlt) && leer.length) {
        C()[gewaehlt] = { takte: w.neuTakte, tiefste: 48, noten: leer };
        leer = [];
      }
      version++;
      if (platz) geaendert(platz);
    };
    const rolle = neueRolle({
      stand: () => {
        const clip = clipVon(gewaehlt), sp = Number(gewaehlt.split(":")[0]);
        return {
          liste: clip ? clip.noten : leer, schritte: (clip?.takte ?? w.neuTakte) * 16, tiefste: clip?.tiefste ?? 48,
          grundton: w.grundton, leiter: w.leiter, raster: w.raster, kopf: clip && spielt[sp]?.key === gewaehlt ? kopf[sp] : -1,
        };
      },
      geaendert: speichere, hoere, hoehe: 260, zeilen: 25,
    });

    // ----- Raster aus Knöpfen -----
    let unten = null, felder = [], szeneKnoepfe = [], titel = null, streifen = null, taktWahl = null, zuletzt = -1;
    const auffrischen = () => {
      if (version === zuletzt || !felder.length) return;
      zuletzt = version;
      for (let sp = 0; sp < SPUREN; sp++) {
        for (let sz = 0; sz < SZENEN; sz++) {
          const key = schluessel(sp, sz), b = felder[sp][sz], clip = C()[key];
          b.textContent = clip ? `${clip.takte} T` : "";
          b.classList.toggle("voll", Boolean(clip));
          b.classList.toggle("spielt", spielt[sp]?.key === key);
          b.classList.toggle("wartet", wartet[sp] === key);
          b.classList.toggle("gewaehlt", gewaehlt === key);
        }
      }
      const [sp, sz] = gewaehlt.split(":").map(Number), clip = clipVon(gewaehlt);
      titel.textContent = clip ? `Spur ${sp + 1}, Szene ${sz + 1}: ${clip.takte} Takt${clip.takte > 1 ? "e" : ""}, ${clip.noten.length} Noten`
        : `Spur ${sp + 1}, Szene ${sz + 1}: leer. Zeichnen legt einen Clip an.`;
      taktWahl.value = String(clip?.takte ?? w.neuTakte);
      const liste = ablauf();
      streifen.replaceChildren(...liste.map((n, i) => {
        const f = document.createElement("span");
        f.textContent = n;
        f.classList.toggle("jetzt", w.modus === "ablauf" && i === ablaufFeld);
        return f;
      }));
    };
    // ----- Arrangement-Ansicht: lange Spuren, Takte waagrecht, Spurnamen rechts (wie in Ableton) -----
    // Runde 29: die Ansicht liegt unter der Wand (wie in Ableton unten die Arrangement-Spuren über der Clip-Ansicht).
    // Scharf: die Leinwand bekommt so viele echte Pixel, wie der Bildschirm hat (devicePixelRatio), gezeichnet wird in
    // CSS-Pixeln. Zoom = Pixel je Takt; ist es breiter als der Platz, scrollt die Ansicht waagrecht.
    const ZH = 22, KOPF = 14, NAMEN = 130;
    // Automation (Runde 30): vier Linien unter den Spuren. Jede ist eine Folge von Punkten [Takt, Wert −1 … 1];
    // dazwischen gerade. Der Clip-Player gibt den Wert an „Auto 1“ … „Auto 4“ aus: an die Buchse neben einem Knopf
    // gesteckt dreht die Linie den Knopf über die Zeit (1,0 = eine halbe Umdrehung). Nur im Modus „Arrangement“.
    const LH = 40, AUTOS = 4;
    let arr = null, ag = null, AW = 640, AH = KOPF + SPUREN * ZH + AUTOS * LH, zoom = 48;
    const groesse = () => {
      const dpr = window.devicePixelRatio || 1, soll = Math.max(arr.parentElement?.clientWidth || 640, w.arrTakte * zoom + NAMEN);
      if (soll === AW && arr.width === Math.round(soll * dpr)) return;
      AW = soll;
      arr.width = Math.round(AW * dpr);
      arr.height = Math.round(AH * dpr);
      arr.style.width = `${AW}px`;
      arr.style.height = `${AH}px`;
    };
    const zeichneArr = () => {
      if (!arr || arr.offsetParent === null) return;
      groesse();
      const dpr = window.devicePixelRatio || 1;
      ag.setTransform(dpr, 0, 0, dpr, 0, 0);
      const B = AW - NAMEN, tb = B / w.arrTakte, farbe = getComputedStyle(arr).color;
      ag.clearRect(0, 0, AW, AH);
      ag.fillStyle = ag.strokeStyle = farbe;
      ag.font = "10px monospace";
      for (let t = 0; t <= w.arrTakte; t++) {
        ag.globalAlpha = t % 4 === 0 ? 0.5 : 0.15;
        ag.fillRect(t * tb, KOPF, 1, AH - KOPF);
        if (t % 4 === 0 && t < w.arrTakte) {
          ag.globalAlpha = 1;
          ag.fillText(String(t + 1), t * tb + 2, 10);
        }
      }
      for (let sp = 0; sp < SPUREN; sp++) {
        const y = KOPF + sp * ZH;
        ag.globalAlpha = 0.15;
        ag.fillRect(0, y + ZH - 1, B, 1);
        ag.globalAlpha = 1;
        ag.fillText(spurName(sp), B + 4, y + 15); // Name rechts (Klick öffnet die Spur auf der Wand)
        for (const [a, sz, l] of A()[sp] ?? []) {
          if (a >= w.arrTakte) continue;
          const x = a * tb, b = Math.min(l, w.arrTakte - a) * tb, da = Boolean(C()[schluessel(sp, sz)]);
          ag.globalAlpha = da ? 0.35 : 0.1;
          ag.fillRect(x + 1, y + 2, b - 2, ZH - 5);
          ag.globalAlpha = 1;
          ag.strokeRect(x + 1.5, y + 2.5, b - 3, ZH - 6);
          ag.fillText(`S${sz + 1}`, x + 4, y + 15);
          // Audio-Clip: hängt an der Spur ein Sampler mit Datei, zeigt die Platzierung dessen Wellenform (so lang, wie
          // die Datei im aktuellen Tempo dauert, und je Clip-Länge wiederholt)
          const clip = C()[schluessel(sp, sz)], wf = welle(sp);
          if (clip?.audio && wf) {
            const taktS = 240 / tempo(), clipB = clip.takte * tb, dB = Math.min(clipB, (wf.dauer / taktS) * tb);
            ag.globalAlpha = 0.9;
            for (let r = x; r < x + b - 1; r += clipB) {
              const bis = Math.min(dB, x + b - r);
              for (let px = 0; px < bis; px++) {
                const v = wf.spitzen[Math.floor((px / dB) * (wf.spitzen.length - 1))];
                ag.fillRect(r + px, y + ZH / 2 - v * (ZH / 2 - 3), 1, Math.max(1, v * (ZH - 6)));
              }
            }
            ag.globalAlpha = 1;
          }
        }
      }
      for (let a = 0; a < AUTOS; a++) {
        const y0 = KOPF + SPUREN * ZH + a * LH, wy = (v) => y0 + 4 + ((1 - v) / 2) * (LH - 8);
        ag.globalAlpha = 0.3;
        ag.fillRect(0, y0, B, 1);
        ag.globalAlpha = 0.12;
        ag.fillRect(0, wy(0), B, 1);
        ag.globalAlpha = 1;
        ag.fillText(`Auto ${a + 1}`, B + 4, y0 + 24);
        const pk = auto(a);
        if (!pk.length) continue;
        ag.beginPath();
        ag.moveTo(0, wy(pk[0][1]));
        for (const [t, v] of pk) ag.lineTo(t * tb, wy(v));
        ag.lineTo(B, wy(pk.at(-1)[1]));
        ag.stroke();
        for (const [t, v] of pk) ag.fillRect(t * tb - 3, wy(v) - 3, 6, 6);
      }
      if (w.modus === "arrangement" && arrKopf >= 0) {
        ag.globalAlpha = 0.9;
        ag.fillRect(arrKopf * tb, 0, 2, AH);
        ag.globalAlpha = 1;
      }
    };
    const zeichne = () => {
      // der Kopf wandert in jedem Bild; das Raster nur, wenn sich etwas geändert hat
      auffrischen();
      rolle.zeichne();
      zeichneArr();
    };
    // Bedienen: in eine leere Stelle klicken setzt den gewählten Clip dieser Spur (sonst ihren ersten); ziehen
    // verschiebt, am rechten Rand ziehen ändert die Länge; Doppel- oder Rechtsklick löscht
    const arrOrt = (ev) => {
      const r = arr.getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * AW, y = ((ev.clientY - r.top) / r.height) * AH;
      const tb = (AW - NAMEN) / w.arrTakte;
      return { takt: x / tb, sp: Math.floor((y - KOPF) / ZH), tb, y };
    };
    // Wohin geht der Ausgang „Spur i“? Das Ziel und (wenn es in einer Gruppe steckt) deren Titel als Spurname
    const ziel = (sp) => window.patch?.kabel?.alle().find((k) => k.von.modul === modul && k.von.name === `Spur ${sp + 1}`)?.nach.modul ?? null;
    const spurName = (sp) => {
      const m = ziel(sp);
      if (!m) return `Spur ${sp + 1}`;
      const t = window.patch.gruppen?.titelVon?.(m) ?? m.titel ?? "";
      return `${sp + 1} ${t.split(": ").pop()}`.slice(0, 18); // nur der letzte Teil: „Kick 808“ statt „Spur 1: Trommel: Kick 808“
    };
    // Wellenform des Samplers an Spur sp (zwischengespeichert je Puffer): 400 Spitzenwerte
    const wellen = new WeakMap();
    const welle = (sp) => {
      const a = ziel(sp)?.audio, puf = a?.puffer();
      if (!puf) return null;
      if (!wellen.has(puf)) {
        const d = puf.getChannelData(0), n = 400, sch = Math.max(1, Math.floor(d.length / n)), spitzen = new Float32Array(n);
        for (let i = 0; i < n; i++) for (let j = i * sch; j < Math.min(d.length, (i + 1) * sch); j += 8) spitzen[i] = Math.max(spitzen[i], Math.abs(d[j]));
        wellen.set(puf, { spitzen, dauerGanz: puf.duration });
      }
      const e = wellen.get(puf);
      return { spitzen: e.spitzen, dauer: a.dauer ? a.dauer() : e.dauerGanz * Math.min(1 - a.start(), a.laenge()) };
    };
    const arrTreffer = ({ takt, sp }) => (A()[sp] ?? []).find(([a, , l]) => takt >= a && takt < a + l);
    let arrGriff = null, arrKlick = { zeit: 0, p: null };
    const arrSpeichere = () => {
      version++;
      if (platz) geaendert(platz);
    };
    const arrUnten = (ev) => {
      ev.preventDefault();
      const o = arrOrt(ev);
      if (o.sp >= SPUREN && o.takt < w.arrTakte) {
        // eine Automationslinie: Punkt setzen (oder greifen), ziehen bewegt, Doppel- oder Rechtsklick löscht
        const a = Math.floor((o.y - KOPF - SPUREN * ZH) / LH);
        if (a < 0 || a >= AUTOS) return;
        const y0 = KOPF + SPUREN * ZH + a * LH, wert = Math.max(-1, Math.min(1, 1 - ((o.y - y0 - 4) / (LH - 8)) * 2));
        const pk = auto(a), nah = pk.find(([t, v]) => Math.abs(t - o.takt) * o.tb < 6 && Math.abs(y0 + 4 + ((1 - v) / 2) * (LH - 8) - o.y) < 8);
        const doppelt = nah && nah === arrKlick.p && ev.timeStamp - arrKlick.zeit < 350;
        arrKlick = { zeit: ev.timeStamp, p: nah ?? null };
        if (nah && (ev.button === 2 || doppelt)) {
          pk.splice(pk.indexOf(nah), 1);
          return arrSpeichere();
        }
        const punkt = nah ?? [Math.round(o.takt * 4) / 4, wert];
        if (!nah) {
          pk.push(punkt);
          arrKlick.p = punkt;
        }
        try { arr.setPointerCapture(ev.pointerId); } catch {}
        arrGriff = { art: "punkt", p: punkt, a, y0 };
        pk.sort((x, z) => x[0] - z[0]);
        return arrSpeichere();
      }
      if (o.sp < 0 || o.sp >= SPUREN) return;
      if (o.takt >= w.arrTakte) {
        // Klick auf den Namen: die Spur (Instrument, Effekte, Kanal) auf der Wand aufklappen und hinscrollen
        const m = ziel(o.sp);
        if (!m) return;
        window.patch.gruppen?.oeffneVon?.(m);
        requestAnimationFrame(() => m.el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
        return;
      }
      const p = arrTreffer(o), liste = (A()[o.sp] ??= []);
      const doppelt = p && p === arrKlick.p && ev.timeStamp - arrKlick.zeit < 350;
      arrKlick = { zeit: ev.timeStamp, p: p ?? null };
      if (ev.button === 2 || doppelt) {
        if (p) liste.splice(liste.indexOf(p), 1);
        return arrSpeichere();
      }
      try { arr.setPointerCapture(ev.pointerId); } catch {}
      if (p && (ev.altKey || ev.ctrlKey || ev.metaKey)) {
        // Alt (oder Strg/Cmd) + ziehen: eine Kopie ziehen, wie in Ableton
        const kopie = [...p];
        liste.push(kopie);
        arrGriff = { art: "ziehen", p: kopie, d: o.takt - kopie[0] };
        return;
      }
      if (p) {
        const rand = (p[0] + p[2] - o.takt) * o.tb < 8;
        arrGriff = rand ? { art: "laenge", p } : { art: "ziehen", p, d: o.takt - p[0] };
        return;
      }
      const [gsp, gsz] = gewaehlt.split(":").map(Number);
      let sz = gsp === o.sp && C()[gewaehlt] ? gsz : -1;
      if (sz < 0) for (let i = 0; i < SZENEN; i++) if (C()[schluessel(o.sp, i)]) { sz = i; break; }
      if (sz < 0) {
        // Runde 29: diese Spur hat noch keinen Clip: einen leeren anlegen (erste freie Szene) und gleich zum Zeichnen öffnen
        sz = 0;
        C()[schluessel(o.sp, sz)] = { takte: w.neuTakte, tiefste: 48, noten: [] };
        gewaehlt = schluessel(o.sp, sz);
        leer = [];
      }
      const neu = [Math.floor(o.takt), sz, C()[schluessel(o.sp, sz)].takte];
      liste.push(neu);
      arrKlick.p = neu;
      arrGriff = { art: "ziehen", p: neu, d: o.takt - neu[0] };
      arrSpeichere();
    };
    const arrBewegt = (ev) => {
      if (!arrGriff) return;
      const o = arrOrt(ev), p = arrGriff.p;
      if (arrGriff.art === "punkt") {
        p[0] = Math.max(0, Math.min(w.arrTakte, Math.round(o.takt * 4) / 4)); // auf Viertel-Takte
        p[1] = Math.max(-1, Math.min(1, 1 - ((o.y - arrGriff.y0 - 4) / (LH - 8)) * 2));
        auto(arrGriff.a).sort((x, z) => x[0] - z[0]);
        version++;
        return;
      }
      if (arrGriff.art === "laenge") p[2] = Math.max(1, Math.min(w.arrTakte - p[0], Math.round(o.takt - p[0])));
      else p[0] = Math.max(0, Math.min(w.arrTakte - p[2], Math.round(o.takt - arrGriff.d)));
      version++;
    };
    const arrLos = () => {
      if (!arrGriff) return;
      arrGriff = null;
      arrSpeichere();
    };
    const knopf = (text, klasse, rufe, titelText) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      if (klasse) b.className = klasse;
      if (titelText) b.title = titelText;
      b.addEventListener("click", rufe);
      return b;
    };

    return {
      ein: { Aufnahme: { art: "noten", ziel: rec, info: "Noten zum Aufnehmen (z. B. von der Tastatur): mit „● Aufnahme“ in den gewählten Clip" } },
      aus: {
        ...Object.fromEntries(noten.map((n, i) => [`Spur ${i + 1}`, { art: "noten", knoten: n, info: `Noten der Spur ${i + 1}: an ein Instrument (Tasten, Bläser, Stimmen, Noten → Ton …)` }])),
        Takt: { art: "takt", knoten: taktAus, info: "ein Schlag an jedem Taktanfang (alle 16 Sechzehntel)" },
        ...Object.fromEntries(autoAus.map((k, a) => [`Auto ${a + 1}`, { art: "ton", knoten: k, info: `Automation ${a + 1} (−1 … 1): an die Buchse neben einem Knopf stecken, die Linie im Arrangement dreht ihn` }])),
      },
      regler: [],
      wahl: [
        { name: "modus", text: "Modus", optionen: [["frei", "frei (klicken)"], ["ablauf", "Ablauf (Szenen-Folge)"], ["arrangement", "Arrangement (Spuren)"]], wert: "frei", setze: (v) => { w.modus = v; version++; } },
        { name: "arrTakte", text: "Arrangement-Länge", optionen: [["8", "8 Takte"], ["16", "16"], ["32", "32"], ["64", "64"]], wert: "16", setze: (v) => { w.arrTakte = Number(v); version++; } },
        { name: "feld", text: "Takte je Feld", optionen: [["1", "1"], ["2", "2"], ["4", "4"], ["8", "8"]], wert: "4", setze: (v) => { w.feld = Number(v); version++; } },
        { name: "raster", text: "Raster", optionen: RASTER, wert: "1", setze: (v) => (w.raster = Number(v)) },
        { name: "grundton", text: "Tonart", optionen: GRUNDTOENE, wert: "0", setze: (v) => (w.grundton = v) },
        { name: "leiter", text: "Leiter zeigen", optionen: [["keine", "keine"], ...LEITER_WAHL.filter(([k]) => k !== "chromatisch")], wert: "keine", setze: (v) => (w.leiter = v) },
      ],
      klasse: "breit",
      extra: (el) => {
        platz = el;
        // Raster: oben die Spuren, links ▶ je Szene, unten ■ je Spur
        const raster = document.createElement("div");
        raster.className = "clip-raster";
        raster.style.gridTemplateColumns = `auto repeat(${SPUREN}, 1fr)`;
        raster.append(document.createElement("span"));
        for (let sp = 0; sp < SPUREN; sp++) {
          const kopfZeile = document.createElement("span");
          kopfZeile.className = "clip-kopf";
          kopfZeile.textContent = sp + 1;
          raster.append(kopfZeile);
        }
        felder = Array.from({ length: SPUREN }, () => []);
        for (let sz = 0; sz < SZENEN; sz++) {
          const sk = knopf(`▶ ${sz + 1}`, "szene-knopf", () => {
            for (let sp = 0; sp < SPUREN; sp++) wartet[sp] = C()[schluessel(sp, sz)] ? schluessel(sp, sz) : "stop";
            version++;
          }, "ganze Szene starten (beim nächsten Takt)");
          szeneKnoepfe.push(sk);
          raster.append(sk);
          for (let sp = 0; sp < SPUREN; sp++) {
            const key = schluessel(sp, sz);
            const b = knopf("", "clip-feld", (ev) => {
              if ((ev.altKey || ev.ctrlKey || ev.metaKey) && C()[gewaehlt] && gewaehlt !== key) {
                // Alt (oder Strg/Cmd) + Klick: den gewählten Clip hierher kopieren (eine eigene Kopie, kein Verweis)
                C()[key] = structuredClone(C()[gewaehlt]);
                gewaehlt = key;
                return speichere();
              }
              gewaehlt = key;
              if (C()[key] && spielt[sp]?.key !== key) wartet[sp] = key; // starten, beim nächsten Takt
              leer = [];
              version++;
            });
            felder[sp][sz] = b;
            raster.append(b);
          }
        }
        raster.append(knopf("■", "szene-knopf", () => { wartet.fill("stop"); version++; }, "alle anhalten (beim nächsten Takt)"));
        for (let sp = 0; sp < SPUREN; sp++) raster.append(knopf("■", "clip-stopp", () => { wartet[sp] = "stop"; version++; }, `Spur ${sp + 1} anhalten`));

        // Ablauf: Folge von Szenen, ein Feld = „Takte je Feld“ Takte
        const ablaufZeile = document.createElement("label");
        ablaufZeile.className = "steuerung ablauf-zeile";
        ablaufZeile.append("Ablauf ");
        const feld = document.createElement("input");
        feld.type = "text";
        feld.value = modul.werte.ablauf ?? "1";
        feld.title = "Szenen-Nummern nacheinander, z. B. 1 1 2 3; gilt im Modus „Ablauf“";
        feld.addEventListener("input", () => {
          modul.werte.ablauf = feld.value;
          version++;
          geaendert(feld);
        });
        ablaufZeile.append(feld);
        streifen = document.createElement("div");
        streifen.className = "ablauf-streifen";

        // Clip-Leiste: Titel, Länge, würfeln, leeren, Oktave, löschen
        titel = document.createElement("p");
        titel.className = "hinweis clip-titel";
        const leiste = document.createElement("div");
        leiste.className = "steuerung knopf-reihe";
        taktWahl = document.createElement("select");
        for (const n of [1, 2, 4, 8, 16]) taktWahl.append(new Option(`${n} Takt${n > 1 ? "e" : ""}`, String(n)));
        taktWahl.addEventListener("change", (ev) => {
          ev.stopPropagation();
          const clip = clipVon(gewaehlt), n = Number(taktWahl.value);
          if (clip) {
            clip.takte = n;
            clip.noten = clip.noten.filter(([a]) => a < n * 16);
          } else w.neuTakte = n;
          speichere();
        });
        const oktave = (d) => () => {
          const clip = clipVon(gewaehlt);
          if (!clip) return;
          clip.tiefste = Math.max(12, Math.min(96, clip.tiefste + 12 * d));
          speichere();
        };
        leiste.append(
          taktWahl,
          knopf("würfeln", "", () => {
            const clip = clipVon(gewaehlt);
            const neu = wuerfle({ schritte: (clip?.takte ?? w.neuTakte) * 16, tiefste: clip?.tiefste ?? 48, grundton: w.grundton, leiter: w.leiter }, rolle.ZEILEN);
            if (clip) clip.noten = neu;
            else leer = neu;
            speichere();
          }),
          knopf("leeren", "", () => {
            const clip = clipVon(gewaehlt);
            if (clip) clip.noten = [];
            speichere();
          }),
          knopf("Okt −", "", oktave(-1), "Ausschnitt eine Oktave tiefer"),
          knopf("Okt +", "", oktave(1), "Ausschnitt eine Oktave höher"),
          (aufKnopf = knopf("● Aufnahme", "", () => {
            aufnahme = !aufnahme;
            aufKnopf.setAttribute("aria-pressed", String(aufnahme));
            if (aufnahme) {
              // den gewählten Clip starten (gibt es ihn nicht, wird er angelegt), nach einem Takt Einzählen
              const sp = Number(gewaehlt.split(":")[0]);
              C()[gewaehlt] ??= { takte: w.neuTakte, tiefste: 48, noten: [] };
              vorAufnahme = { key: gewaehlt, noten: C()[gewaehlt].noten.map((x) => [...x]) }; // für „Aufnahme zurück“
              if (spielt[sp]?.key !== gewaehlt) zaehleBis = "warte";
            } else {
              zaehleBis = null;
              if (platz) geaendert(platz);
            }
            version++;
          }, "Noten am Eingang „Aufnahme“ in den gewählten Clip schreiben (dazu, nichts wird gelöscht)")),
          knopf("Aufnahme zurück", "", () => {
            // die letzte Aufnahme rückgängig: der Clip wie vor dem Drücken von „● Aufnahme“
            if (!vorAufnahme || !C()[vorAufnahme.key]) return;
            C()[vorAufnahme.key].noten = vorAufnahme.noten.map((x) => [...x]);
            speichere();
          }, "den Clip so, wie er vor der letzten Aufnahme war"),
          knopf("Audio-Clip", "", () => {
            // ein Clip aus EINER Note auf dem Grundton des Samplers an dieser Spur, so lang wie die Datei (höchstens 16 Takte)
            const sp = Number(gewaehlt.split(":")[0]), a = ziel(sp)?.audio, wf = welle(sp);
            if (!a || !wf) {
              titel.textContent = `Spur ${sp + 1}: für einen Audio-Clip muss der Ausgang „Spur ${sp + 1}“ an einem Sampler mit Datei hängen.`;
              return;
            }
            const takte = wf.dauer / (240 / tempo()), lang = [1, 2, 4, 8, 16].find((n) => n >= takte) ?? 16;
            C()[gewaehlt] = { takte: lang, tiefste: a.grund() - 12, audio: true, audioTempo: tempo(), noten: [[0, a.grund(), Math.min(lang * 16, Math.max(1, takte * 16)), 1]] };
            leer = [];
            speichere();
          }, "Clip aus der Datei des Samplers an dieser Spur"),
          knopf("Clip löschen", "", () => {
            delete C()[gewaehlt];
            speichere();
          }),
        );
        const hilfe = document.createElement("p");
        hilfe.className = "hinweis";
        hilfe.textContent = "Feld klicken: wählen und (beim nächsten Takt) starten. Alt + Klick: den gewählten Clip in dieses Feld kopieren. In die Rolle zeichnen: Noten; in ein leeres Feld zeichnen legt einen Clip an. ▶: ganze Szene, ■: anhalten.";
        arr = document.createElement("canvas");
        arr.className = "rolle arrangement";
        arr.title = "Arrangement: klicken setzt den gewählten Clip, ziehen verschiebt, rechter Rand: Länge, Doppel-/Rechtsklick löscht";
        ag = arr.getContext("2d");
        arr.addEventListener("pointerdown", arrUnten);
        arr.addEventListener("pointermove", arrBewegt);
        arr.addEventListener("pointerup", arrLos);
        arr.addEventListener("pointercancel", arrLos);
        arr.addEventListener("contextmenu", (e) => e.preventDefault());
        const arrHilfe = document.createElement("p");
        arrHilfe.className = "hinweis";
        arrHilfe.textContent = "In eine Spur klicken setzt deren gewählten Clip (hat sie keinen: ein neuer, leerer, gleich unten zum Zeichnen); ziehen verschiebt (mit Alt oder Strg: eine Kopie), am rechten Rand ziehen macht ihn länger (er läuft darin im Kreis); Doppel- oder Rechtsklick löscht. Klick auf einen Namen rechts öffnet die Spur auf der Wand (Instrument, Effekte, Kanal). Unten vier Automationslinien: klicken setzt einen Punkt, ziehen bewegt ihn, Doppel- oder Rechtsklick löscht; „Auto 1“ … „Auto 4“ an die Buchse neben einem Knopf stecken.";
        // Runde 29: Arrangement, Clip-Leiste und Rolle liegen in einem eigenen Feld UNTER der Wand
        unten = document.createElement("section");
        unten.className = "arrangement-feld";
        const kopfzeile = document.createElement("div");
        kopfzeile.className = "steuerung knopf-reihe";
        const name = document.createElement("strong");
        name.textContent = "Arrangement";
        const nurArr = knopf("nur Arrangement", "", () => setzeNurArr(!modul.werte.nurArr), "Clip-Raster im Fenster ausblenden, Modus Arrangement (die Clips bleiben)");
        const setzeNurArr = (an) => {
          modul.werte.nurArr = an || undefined;
          modul.el.classList.toggle("nur-arr", an);
          nurArr.setAttribute("aria-pressed", String(an));
          if (an) {
            const sel = modul.el.querySelector('select[data-wahl="modus"]');
            if (sel && sel.value !== "arrangement") {
              sel.value = "arrangement";
              sel.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          geaendert(nurArr);
        };
        kopfzeile.append(name, nurArr, knopf("Zoom −", "", () => (zoom = Math.max(12, zoom / 1.5))), knopf("Zoom +", "", () => (zoom = Math.min(240, zoom * 1.5))));
        const scroll = document.createElement("div");
        scroll.className = "arrangement-scroll";
        scroll.append(arr);
        unten.append(kopfzeile, scroll, arrHilfe, titel, leiste, rolle.c, hilfe);
        el.append(raster, ablaufZeile, streifen);
        (document.getElementById("wand") ?? el).after(unten);
        if (modul.werte.nurArr) requestAnimationFrame(() => setzeNurArr(true));
        bild.add(zeichne);
      },
      weg: () => {
        abo();
        bild.delete(zeichne);
        unten?.remove();
      },
    };
  },
};

export const SPUREN_MODULE = { kanal, clips };
