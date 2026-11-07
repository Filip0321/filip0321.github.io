# Portfolio, Runde 5 (Teil 7)

Nur geänderte und neue Dateien, Pfade wie im Portfolio. Drüberkopieren. Neu: projekte/photo-effects/echter-mosh.js.

## Datamosh-Imitat mit Video: jetzt echter Datamosh (`echter-mosh.js`, `mosh-imitat.js`)
Das Nachbauen mit geschätzter Bewegung ist raus. Es kam nie an das Projekt heran: Die Bewegung war geschätzt (Block Matching), und Strömung, Intra-Blöcke und Farbbluten haben zufällig dazugemischt. Jetzt rechnet es mit den Teilen des Projekts Datamosh selbst (`/projekte/datamosh/js/`):
- **Die zwei Clips:** Das Foto (oder das Bild, wo das Video gerade steht) wird ein Clip von einem Bild. Das Video, nur von–bis, wird ein zweiter Clip. Beide werden als VP8 kodiert, in der Größe des Fotos.
- **Der Schnitt:** Foto auf Bild 0, Video ab Bild 1. Am Schnitt ist das I-Frame des Videos gelöscht, also bewegen seine P-Frames das Foto: Bewegung und Rest, wie in einer echten Datei.
- **Der Browser dekodiert das wirklich.** Gezeigt wird das Bild an der gewählten Stelle, anfangs das letzte.
- **Zeitleiste wie im Projekt** (I-Zeile, P-Zeile, Auswahl, A und B, Pfeiltasten, solange der Zeiger darüber ist). Dazu Löschen, Wiederholen ×N (P-Frames verdoppeln), Umkehren und „Eingriffe zurücksetzen“.
- **Keine anderen Regler:** Solange das läuft, zeigt das Imitat nur dieses Ergebnis, und seine Regler verschwinden. Einstellbar sind nur Breite und Bitrate, wie beim Projekt (wenig Bitrate: gröbere Blöcke).
- Ohne Video ist das Imitat wie vorher, zum Beispiel für Videos als Quelle.

## Blob-Tracking
- Foto-Effekte: „erkannte weg, nur meine“ blendet alle erkannten Flecken aus. Es bleiben nur die selbst gezogenen Rechtecke.
- **Jetzt auch in den Fraktalen**, und in allen Projekten mit Effekt-Schicht (Attraktoren, Game of Life …). `effekt-schicht.js` kann jetzt auch Effekte, die auf der CPU rechnen: Blob-Tracking und die Linien-Effekte. Sie laufen nach den Shadern. Das Bild muss dafür einmal aus der Grafikkarte geholt werden (`getImageData`), das kostet bei großen Bildern etwas Zeit.

## Fraktale: Lampen
- **Hex-Code** vor jedem Farbfeld, auch bei den Lampen der Attraktoren. Dafür ist `mitHexFeld` in `script.js` jetzt eine Funktion, die auch später gebaute Felder bekommen.
- **Lage mit Reglern** wie bei den Attraktoren: Licht von (Grad rundherum), Höhe, Abstand von der Mitte. Das sind Kugelkoordinaten um den Ursprung; „Lampe hier abstellen“ rechnet die Werte aus dem Ort.

## Bild speichern aus der Zeit, auch hier
- **Foto-Effekte mit Video:** welches Bild des Videos.
- **Datamosh:** welches Bild der Folge.
- **Video zu Ton:** welche Stelle des Videos.
- `export.js` hat dafür die Optionen `bildLaenge` und `bildBei` für Projekte ohne `render`.
- Nicht dabei sind Zeitquader und Tiefe: Dort läuft nichts in der Zeit, was man auswählen könnte.
