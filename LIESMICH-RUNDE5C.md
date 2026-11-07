# Portfolio, Runde 5 (Teil 3: Fraktale, kleine Shader, Datamosh-Nachtrag)

Nur geänderte Dateien, Pfade wie im Portfolio. Drüberkopieren.
**Löschen:** `lib/effekte/mosh-maske.js` (das Malen beim Datamosh-Imitat ist weg, nichts lädt die Datei mehr).

## Fraktale
Fahrt aufnehmen und Bild für Bild rendern mit Klang, Lampe und Blick getrennt, Flackern, Staub nur im Licht,
Boden mit Schatten. Erklärt im Fraktale-Repo, LIESMICH.md, „Runde 5“.

## Kleine Shader (lib/effekte)
- **Datamosh-Imitat** (`mosh-imitat.js`, `photo-effects/main.js`): Malen und Radieren sind raus, das Rechteck bleibt.
- **Pixel Sorting** (`pixelsort.js`):
  - **Wo sortiert wird:** das ganze Bild oder bis zu drei Rechtecke. Außerhalb ist jeder Pixel sein eigener Abschnitt, am Rechteckrand endet der Streifen.
  - **Lücken überbrücken (längere Streifen):** Ein Pixel außerhalb des Helligkeitsbereichs zählt trotzdem dazu, wenn links UND rechts innerhalb von g Pixeln einer drin ist. Vorher brach jedes einzelne Rauschpixel den Streifen ab.
- **Feedback** (`licht.js`), wie echtes Video-Feedback:
  - **Drehpunkt:** wohin die Mitte des Objektivs zeigt. Außerhalb der Mitte wandert der Tunnel zur Seite.
  - **Versatz pro Bild:** die Kamera steht neben dem Bildschirm. Mit Zoom und Drehung zusammen entstehen Bögen und Schnecken.
  - **Rand:** schwarz oder gespiegelt (`abs(mod(p − 1, 2) − 1)`: ein Spiegel an jedem Rand).
  - Die Formel steht oben im Abschnitt Feedback.
- **CRT** (`crt.js`, `effekt-schicht.js`) und **Fisheye** (`raum.js`): „Ränder wegzoomen“.
  - CRT: Erst nur die Mitte nehmen (−s bis s), dann wölben; s löst `s · (1 + w · s²) = 1`, mit Newton im Shader. Die Ecke landet genau auf der Bildecke.
  - Fisheye: mindestens um `1 + k · r_Ecke²` zoomen.
  - Beides in voller Auflösung, anders als das Abschneiden im Export.
- **Export** (`export.js`): Option `dauer` für richteExportEin, damit ein gerendertes Video so lang wird wie die aufgenommene Fahrt.
- **Export-Fenster** (`export-dialog.js`): Wird CRT erst im Fenster eingeschaltet, kommt das Häkchen „Rahmen über die gewölbten Ränder“ jetzt sofort dazu. Vorher wurde das nur beim Öffnen geprüft.

## Datamosh
„I durch Bild ersetzen“ heißt jetzt **„Fremdes Bild als I-Frame“** und geht an jeder Stelle (Anfang der Auswahl, sonst die blaue Linie), nicht nur an einem Schnitt. Danach steht auf der Seite, was passiert ist.
