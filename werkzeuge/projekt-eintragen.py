#!/usr/bin/env python3
"""
Ein neues Projekt in die Übersichten eintragen, ohne die Seiten zu überschreiben:
  projekte/index.html   eine Karte (Vorschau-Video mit Standbild, Titel, Text, Tags)
  index.html            ein Eintrag in der Liste im Fenster „Projekte“ der Startseite

    py werkzeuge\\projekt-eintragen.py --link /projekte/patch/ --name Patch-Wand --tags ton,modular --nach /projekte/marmor/

--nach: hinter dem Eintrag mit diesem Link (Karte und Liste); ohne Angabe ans Ende.
--text: Kartentext (ohne Angabe „Platzhalter: dein Kartentext.“, den schreibst du selbst).
Läuft vom Repo aus, ändert nur, wo das Projekt noch fehlt. Zweimal laufen lassen schadet also nicht.
"""
import argparse
import html
import re
from pathlib import Path

a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
a.add_argument("--link", required=True)
a.add_argument("--name", required=True)
a.add_argument("--tags", default="")
a.add_argument("--text", default="Platzhalter: dein Kartentext.")
a.add_argument("--nach", default="")
a.add_argument("--ordner", default=".")
arg = a.parse_args()
wurzel = Path(arg.ordner)
name, text = html.escape(arg.name), html.escape(arg.text)


def karte(einrueckung):
    i = einrueckung
    tags = "".join(f"\n{i}      <li>{html.escape(t.strip())}</li>" for t in arg.tags.split(",") if t.strip())
    return (f'{i}<li class="karte">\n'
            f'{i}  <a href="{arg.link}">\n'
            f'{i}    <video src="{arg.link}vorschau.webm" poster="{arg.link}vorschau.webp" width="800" height="600" preload="none" muted loop playsinline></video>\n'
            f'{i}    <h2>{name}</h2>\n'
            f'{i}    <p>{text}</p>\n'
            f'{i}    <ul class="tags">{tags}\n'
            f'{i}    </ul>\n'
            f'{i}  </a>\n'
            f'{i}</li>\n')


# ---------- Karte ----------
p = wurzel / "projekte" / "index.html"
t = p.read_text(encoding="utf-8")
if f'<a href="{arg.link}">' in t:
    print(f"Karte gibt es schon: {p}")
else:
    karten = list(re.finditer(r'^([ \t]*)<li class="karte">.*?^\1</li>\n', t, re.S | re.M))
    if not karten:
        raise SystemExit(f"Keine Karten gefunden in {p}")
    ziel = next((k for k in karten if f'href="{arg.nach}"' in k.group(0)), None) if arg.nach else None
    ziel = ziel or karten[-1]
    neu = "\n" + karte(ziel.group(1))
    t = t[: ziel.end()] + neu + t[ziel.end():]
    p.write_text(t, encoding="utf-8")
    print(f"Karte eingetragen: {p}")

# ---------- Liste auf der Startseite ----------
p = wurzel / "index.html"
t = p.read_text(encoding="utf-8")
fenster = re.search(r'<article class="fenster" id="fenster-projekte".*?</article>', t, re.S)
if not fenster:
    print("Kein Fenster „Projekte“ auf der Startseite gefunden, übersprungen.")
elif f'href="{arg.link}"' in fenster.group(0):
    print(f"Eintrag gibt es schon: {p}")
else:
    zeilen = list(re.finditer(r'^([ \t]*)<li><a href="/projekte/[^"]+/">[^<]*</a></li>\n', fenster.group(0), re.M))
    if not zeilen:
        raise SystemExit("Keine Liste im Fenster „Projekte“ gefunden.")
    ziel = next((z for z in zeilen if f'href="{arg.nach}"' in z.group(0)), None) if arg.nach else None
    ziel = ziel or zeilen[-1]
    neu = f'{ziel.group(1)}<li><a href="{arg.link}">{name}</a></li>\n'
    stelle = fenster.start() + ziel.end()
    t = t[:stelle] + neu + t[stelle:]
    p.write_text(t, encoding="utf-8")
    print(f"Eintrag eingetragen: {p}")
