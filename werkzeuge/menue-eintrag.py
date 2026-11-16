#!/usr/bin/env python3
"""
Einen Eintrag ins Menü aller Seiten setzen (das <nav id="menu"> steht in jeder HTML-Datei einzeln).

    py werkzeuge\\menue-eintrag.py                                        „Mein Zimmer“ vor „About“
    py werkzeuge\\menue-eintrag.py --link /zimmer/ --name "Mein Zimmer" --vor /about/

Läuft über alle .html im Ordner (vom Repo aus starten), ändert nur das Menü und nur dort, wo der Eintrag noch fehlt.
Zweimal laufen lassen schadet also nicht. Am Ende steht, welche Dateien es geändert hat.
"""
import argparse
import re
from pathlib import Path

a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
a.add_argument("--link", default="/zimmer/")
a.add_argument("--name", default="Mein Zimmer")
a.add_argument("--vor", default="/about/", help="vor dem Eintrag mit diesem Link einfügen")
a.add_argument("--ordner", default=".")
arg = a.parse_args()

geaendert = []
for datei in sorted(Path(arg.ordner).rglob("*.html")):
    if any(teil.startswith(("_", ".")) or teil == "node_modules" for teil in datei.parts):
        continue  # Testseiten, versteckte Ordner
    text = datei.read_text(encoding="utf-8")
    nav = re.search(r'<nav id="menu"[^>]*>.*?</nav>', text, re.S)
    if not nav or f'href="{arg.link}"' in nav.group(0):
        continue
    # die Zeile mit dem Eintrag, vor den der neue soll, samt ihrer Einrückung
    zeile = re.search(r'(\n[ \t]*)(<li><a href="' + re.escape(arg.vor) + r'"[^>]*>)', nav.group(0))
    if not zeile:
        print(f"übersprungen (kein {arg.vor} im Menü): {datei}")
        continue
    aktuell = ' aria-current="page"' if datei.parent.name == arg.link.strip("/") else ""
    neu = f'{zeile.group(1)}<li><a href="{arg.link}"{aktuell}>{arg.name}</a></li>'
    menue = nav.group(0).replace(zeile.group(0), neu + zeile.group(0), 1)
    datei.write_text(text.replace(nav.group(0), menue, 1), encoding="utf-8")
    geaendert.append(str(datei))

print(f"{len(geaendert)} Dateien geändert")
for d in geaendert:
    print("  " + d)
