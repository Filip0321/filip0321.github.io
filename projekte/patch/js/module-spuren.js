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
import { verstaerker, LEITER_WAHL, GRUNDTOENE } from "./bausteine.js";
import { neueRolle, wuerfle } from "./rolle.js";

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
const SPUREN = 8, SZENEN = 8;
const schluessel = (sp, sz) => `${sp}:${sz}`;

const clips = {
  titel: "Clips",
  gruppe: "Spuren",
  baue(ctx, { uhr, bild, tempo, modul }) {
    const noten = Array.from({ length: SPUREN }, () => new Noten());
    const taktAus = new Takt();
    const w = { modus: "frei", feld: 4, grundton: "0", leiter: "keine", neuTakte: 1 };
    // die Clips stehen in den Werten: so kommen sie mit in den Patch. Eine eigene Kopie (aus einer Vorlage kommt sonst
    // dasselbe Objekt, und Zeichnen würde die Vorlage selbst ändern)
    modul.werte.clips = structuredClone(modul.werte.clips ?? {});
    const C = () => (modul.werte.clips ??= {});
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
      for (let sp = 0; sp < SPUREN; sp++) {
        const s = spielt[sp];
        if (!s) continue;
        const clip = C()[s.key];
        if (!clip) {
          starte(sp, null, nr);
          continue;
        }
        const laenge = clip.takte * 16, schritt = (((nr - s.start) % laenge) + laenge) % laenge;
        for (const [a, n, l, vel] of clip.noten) if (a === schritt) noten[sp].an(t, n, vel, l * sechzehntel * 0.96);
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
          grundton: w.grundton, leiter: w.leiter, kopf: clip && spielt[sp]?.key === gewaehlt ? kopf[sp] : -1,
        };
      },
      geaendert: speichere, hoere, hoehe: 260, zeilen: 25,
    });

    // ----- Raster aus Knöpfen -----
    let felder = [], szeneKnoepfe = [], titel = null, streifen = null, taktWahl = null, zuletzt = -1;
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
    const zeichne = () => {
      // der Kopf wandert in jedem Bild; das Raster nur, wenn sich etwas geändert hat
      auffrischen();
      rolle.zeichne();
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
      ein: {},
      aus: {
        ...Object.fromEntries(noten.map((n, i) => [`Spur ${i + 1}`, { art: "noten", knoten: n, info: `Noten der Spur ${i + 1}: an ein Instrument (Tasten, Bläser, Stimmen, Noten → Ton …)` }])),
        Takt: { art: "takt", knoten: taktAus, info: "ein Schlag an jedem Taktanfang (alle 16 Sechzehntel)" },
      },
      regler: [],
      wahl: [
        { name: "modus", text: "Modus", optionen: [["frei", "frei (klicken)"], ["ablauf", "Ablauf (Zeitleiste)"]], wert: "frei", setze: (v) => { w.modus = v; version++; } },
        { name: "feld", text: "Takte je Feld", optionen: [["1", "1"], ["2", "2"], ["4", "4"], ["8", "8"]], wert: "4", setze: (v) => { w.feld = Number(v); version++; } },
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
            const b = knopf("", "clip-feld", () => {
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
        for (const n of [1, 2, 4]) taktWahl.append(new Option(`${n} Takt${n > 1 ? "e" : ""}`, String(n)));
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
          knopf("Clip löschen", "", () => {
            delete C()[gewaehlt];
            speichere();
          }),
        );
        const hilfe = document.createElement("p");
        hilfe.className = "hinweis";
        hilfe.textContent = "Feld klicken: wählen und (beim nächsten Takt) starten. In die Rolle zeichnen: Noten; in ein leeres Feld zeichnen legt einen Clip an. ▶: ganze Szene, ■: anhalten.";
        el.append(raster, ablaufZeile, streifen, titel, leiste, rolle.c, hilfe);
        bild.add(zeichne);
      },
      weg: () => {
        abo();
        bild.delete(zeichne);
      },
    };
  },
};

export const SPUREN_MODULE = { kanal, clips };
