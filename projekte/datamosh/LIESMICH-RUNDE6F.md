# Runde 6f: Databending, analoges Signal, Circuit Bending, RGB-Versatz zum Bass

## Dateien (Portfolio)
Neu:
- `projekte/databending/` (index.html, databending.css, js/main.js, js/welle.js, js/wav.js): das Projekt
- `lib/databending.js`   Bytes als Ton und die Audio-Effekte (Projekt und Sammlung benutzen es)
- `lib/analog.js`        PAL/NTSC: kodieren, Kabel, dekodieren
- `lib/klang-signale.js` Bass, Schlag … für Effekte: Musik der Seite, Mikrofon oder Takt
- `lib/effekte/signal.js` die neue Gruppe „Signal und Störung“ mit vier Effekten
Ersetzen:
- `lib/effekte/sammlung.js` (die neue Gruppe), `lib/audioreaktiv.js` (meldet seine Signale den Effekten)
- `projekte/index.html` (Karte Databending, Kartentext ist ein Platzhalter für dich), `index.html` (Menü)
Die eigenen Repos (Fraktale, Datamosh, Video zu Ton) haben je ein Zip mit den lib-Dateien.

## Was neu ist
**Databending (eigenes Projekt).** Bild öffnen; darunter die Bytes als Welle. Ziehen in der Welle oder
senkrecht im Bild markiert einen Bereich (rastet auf ganze Zeilen ein, abschaltbar). Effekt wählen, „auf die
Auswahl“: Echo, Tiefpass, Hochpass, Verzerrung, Bitcrush, Rückwärts, Kanal-Versatz, Tempo, Verstärken, jeder
Bereich mit eigenen Reglern, Reihenfolge mit ↑ ↓. Anhören (8, 22 oder 44,1 kHz, nur die Auswahl, wenn es eine
gibt), der rote Punkt zeigt im Bild, welches Pixel gerade klingt. Ton als WAV, Bild über das Export-Fenster.

**Vier Effekte in der Sammlung** (Gruppe „Signal und Störung“, also überall: Foto-Effekte, Attraktoren,
Fraktale, Game of Life und im Export-Fenster der anderen):
- RGB-Versatz zum Bass: Rot und Blau rücken mit dem Signal auseinander; Klang aus der Musik der Seite, dem
  Mikrofon oder einem Takt (BPM), mit „Zittern“ pro Schlag.
- Circuit Bending: Bild- und Zeilenfang verloren, Farbträger verstimmt, übersteuert, Helligkeit und Farbe
  vertauscht, Zeilen doppelt; „im Takt“ kommen die Fehler mit dem Schlag, jedes Mal mit neuem Zufall.
- Analoges Signal (PAL/NTSC): echt kodiert und dekodiert, Farbbluten, Dot Crawl und Regenbogen entstehen selbst.
- Databending: dieselben Bytes-Effekte als ein Effekt mit festen Stufen, auch für Video.

Getestet: alle vier im Bild, das Projekt mit drei Bereichen (Welle und Bild als Auswahl), Abspielen, WAV;
Farbbalken durch PAL und NTSC (Farben bleiben richtig; bei 30° Phasenfehler wird NTSC lila, PAL nur blasser);
1920 × 1080 dauert je etwa 0,1 s auf dem Prozessor. Alle 14 Projektseiten laden ohne Fehler.

## Theorie
### Databending
Audacity öffnet jede Datei als Ton („Rohdaten importieren“), wenn man ihm sagt, wie es die Bytes lesen soll.
Ein Bild ohne Kompression (BMP, TIFF) ist nur eine lange Reihe von Zahlen; ein Audio-Effekt weiß nichts von
Zeilen und Pixeln, er rechnet Sample für Sample. Darum: ein Echo um d Bytes ist eine Kopie d/3 Pixel weiter; ist
d kein Vielfaches von 3, rutscht die Farbe (das Rot der Kopie landet im Grün). Ein Tiefpass glättet benachbarte
Bytes, also R, G und B desselben Pixels: Farbe läuft ineinander. Mit JPEG geht das nicht: dort sind die Bytes
komprimiert, ein Echo zerstört die Datei, statt das Bild zu verschieben. Hier werden die Pixel deshalb erst
ausgepackt (getImageData), wie bei einem BMP.

### Fernsehsignal
Helligkeit Y und die Farbanteile U, V teilen sich einen Draht: s = Y + U·sin φ + V·cos φ, mit φ der Phase des
Farbträgers (4,43 MHz PAL, 3,58 MHz NTSC). Weil sin und cos senkrecht zueinander stehen (über eine Periode
gemittelt ist sin·cos = 0), kann der Fernseher sie wieder trennen: s·2 sin φ, gemittelt, ergibt U; s·2 cos φ
ergibt V (Quadratur-Demodulation). Die Helligkeit holt er, indem er über eine Trägerperiode mittelt (dort
verschwindet die Schwingung). An Kanten klappt beides nicht sauber: Farbe bleibt in der Helligkeit (Dot Crawl),
feine Muster in der Helligkeit werden zu Farbe (Regenbogen). Der Farbburst am Zeilenanfang ist die Referenz,
an der der Fernseher Phase und Stärke einstellt; das gleicht auch aus, was das Kabel dem Träger antut. PAL
dreht V jede Zeile um und mittelt zwei Zeilen: ein Phasenfehler dreht die Farbe in der einen Zeile nach links,
in der nächsten nach rechts, im Mittel bleibt sie richtig und nur etwas blasser.

### Klang für Effekte
Ein Effekt der Sammlung weiß nicht, welche Seite ihn benutzt. Darum ein kleiner gemeinsamer Briefkasten
(klang-signale.js): audioreaktiv.js legt jede Messung hinein, der Effekt liest sie. Für Videos ist „Takt“ der
sichere Weg: der Schlag kommt aus der Zeit des Bildes (Schlag = exp(−7 · Phase im Takt)), damit ist das
gerenderte Video genau wie die Vorschau. Das Mikrofon geht nur live.
