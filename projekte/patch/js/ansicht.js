// Ansicht der Wand: Zoom wie in Bitwig (Strg + Mausrad oder die Knöpfe − und +).
//
// Alles auf der Wand (Fenster, Kabel) liegt in einem inneren Element, das per CSS-transform: scale(s) vergrößert
// wird, Ursprung oben links. Die Fenster und Kabel rechnen weiter in ihren eigenen, unvergrößerten Koordinaten
// („lokal“): Lage modul.x, modul.y; die Kabel im SVG ebenso. Nur wo die Maus ins Spiel kommt, wird umgerechnet:
//   lokal = (Bildschirm − linke obere Ecke des Inneren) / s
// getBoundingClientRect liefert Bildschirm-Koordinaten (schon vergrößert und gescrollt), darum reicht diese eine
// Formel für Maus und Buchsen. Ein unsichtbarer Platzhalter in Größe 2200 · s × 1500 · s sorgt dafür, dass man
// genauso weit scrollen kann, wie die Wand vergrößert groß ist.

export const BREITE = 2200, HOEHE = 1500;

export function erstelleAnsicht(wand, svg) {
  const inhalt = document.createElement("div");
  inhalt.className = "wand-inhalt";
  const platz = document.createElement("div");
  platz.className = "wand-platz";
  wand.append(platz, inhalt);
  inhalt.append(svg);
  let s = 1;

  function lokal(x, y) {
    const r = inhalt.getBoundingClientRect();
    return { x: (x - r.left) / s, y: (y - r.top) / s };
  }

  // um einen Punkt (Bildschirm) herum zoomen: er soll danach unter der Maus bleiben
  function setze(neu, um = null) {
    neu = Math.min(2, Math.max(0.3, neu));
    const w = wand.getBoundingClientRect();
    const mx = um ? um.x - w.left : wand.clientWidth / 2, my = um ? um.y - w.top : wand.clientHeight / 2;
    const lx = (wand.scrollLeft + mx) / s, ly = (wand.scrollTop + my) / s; // lokal unter dem Punkt
    s = neu;
    inhalt.style.transform = `scale(${s})`;
    platz.style.width = `${BREITE * s}px`;
    platz.style.height = `${HOEHE * s}px`;
    wand.style.backgroundSize = `${40 * s}px ${40 * s}px`;
    wand.scrollLeft = lx * s - mx;
    wand.scrollTop = ly * s - my;
    beiAenderung(s);
  }
  let beiAenderung = () => {};

  wand.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return; // ohne Strg scrollt das Rad wie immer
    ev.preventDefault();
    setze(s * Math.exp(-ev.deltaY * 0.0015), { x: ev.clientX, y: ev.clientY });
  }, { passive: false });

  setze(1);
  return {
    inhalt,
    lokal,
    massstab: () => s,
    setze,
    beiAenderung: (f) => (beiAenderung = f),
  };
}
