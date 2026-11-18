"""Einen Satz in vielen Seiten auf einmal ersetzen, ohne die Seiten sonst anzufassen.

Damit ich dir für eine kleine Textänderung nicht deine ganzen HTML-Seiten schicken muss (deine eigenen Änderungen
darin gingen sonst verloren). Ersetzt wird nur genau der alte Text, alles andere bleibt Byte für Byte gleich.

  py werkzeuge\\ersetze-text.py "alter Text" "neuer Text" projekte\\*\\index.html
  py werkzeuge\\ersetze-text.py "alter Text" "neuer Text" projekte\\*\\index.html --probe   (nur zeigen, nichts schreiben)

Mehrfach ausführen schadet nicht: ist der alte Text schon weg, passiert nichts.
"""

import argparse
import glob
import sys

teil = argparse.ArgumentParser(description="Text in vielen Dateien ersetzen")
teil.add_argument("alt")
teil.add_argument("neu")
teil.add_argument("dateien", nargs="+", help="Dateien oder Muster wie projekte\\*\\index.html")
teil.add_argument("--probe", action="store_true", help="nur zeigen, was sich ändern würde")
a = teil.parse_args()

# Windows' Eingabeaufforderung löst * nicht selbst auf, darum hier
pfade = sorted({p for muster in a.dateien for p in (glob.glob(muster) or [muster])})
geaendert = 0
for pfad in pfade:
    try:
        with open(pfad, encoding="utf-8", newline="") as f:  # newline="": Zeilenenden bleiben, wie sie sind
            text = f.read()
    except OSError as fehler:
        print(f"übersprungen {pfad}: {fehler}", file=sys.stderr)
        continue
    n = text.count(a.alt)
    if not n:
        continue
    geaendert += 1
    print(f"{pfad}: {n}×")
    if not a.probe:
        with open(pfad, "w", encoding="utf-8", newline="") as f:
            f.write(text.replace(a.alt, a.neu))
print(f"{geaendert} Datei(en) {'würden geändert' if a.probe else 'geändert'}.")
