#!/usr/bin/env python3
"""
Scans für eigene Projektseiten verkleinern und packen (Filip Winkler).

Ein CT als DICOM-Ordner hat oft 300 bis 600 Dateien und 150 bis 300 MB; das will kein Besucher laden. Dieses Skript
liest einen Scan, rechnet ihn auf eine handliche Größe herunter und schreibt EINE Datei .nrrd (gzip-gepackt), die der
Volumen-Viewer direkt lädt (projekte/volumen/js/laden.js). Dazu gibt es den Schnipsel für eine eigene Seite aus
(projekte/volumen/js/vorlage.js: baueSeite).

Gelesen wird:
  - ein DICOM-Ordner (braucht pydicom: pip install pydicom); die Schichten werden nach ihrer Lage im Raum sortiert
    (ImagePositionPatient entlang der Normalen der Schicht), die Werte mit RescaleSlope und RescaleIntercept in
    Hounsfield-Einheiten umgerechnet
  - NIfTI .nii / .nii.gz (braucht nibabel: pip install nibabel)
  - NRRD .nrrd (raw oder gzip, ohne Zusatzpakete)

Verkleinern: auf höchstens --groesse Zellen an der längsten Seite (Standard 256). Gemittelt über ganze Blöcke
(Faktor 2, 3, …), nicht nur jede n-te Zelle genommen: so bleibt das Rauschen klein und dünne Knochen verschwinden
nicht einfach. Die Voxelgröße wird mitgerechnet.

Werte: als int16 gespeichert (CT passt ganz hinein: −1024 bis 3071). Andere Daten (MRT, Float) werden auf
0 bis 4095 gestreckt (--strecken, Standard für alles, was nicht CT ist), damit int16 reicht.

Aufruf:
  python scan-packen.py PFAD_ZUM_DICOM_ORDNER -o kopf.nrrd
  python scan-packen.py gehirn.nii.gz -o gehirn.nrrd --groesse 192
Danach die .nrrd neben die Seite legen (z. B. projekte/scan-kopf/kopf.nrrd).
"""

import argparse
import gzip
import os
import sys

import numpy as np


def lies_dicom(ordner):
    try:
        import pydicom
    except ImportError:
        sys.exit("Für DICOM fehlt pydicom: pip install pydicom")
    schichten = []
    for wurzel, _, dateien in os.walk(ordner):
        for d in dateien:
            pfad = os.path.join(wurzel, d)
            try:
                ds = pydicom.dcmread(pfad, force=True)
                if not hasattr(ds, "PixelData"):
                    continue
                schichten.append(ds)
            except Exception:
                continue
    if not schichten:
        sys.exit(f"In {ordner} sind keine DICOM-Bilder.")
    # nur die häufigste Serie (ein Ordner hat manchmal mehrere)
    serien = {}
    for ds in schichten:
        serien.setdefault(getattr(ds, "SeriesInstanceUID", ""), []).append(ds)
    schichten = max(serien.values(), key=len)
    # Lage jeder Schicht entlang der Normalen (Kreuzprodukt der beiden Richtungen im Bild)
    o = np.array(schichten[0].ImageOrientationPatient, dtype=float)
    normale = np.cross(o[:3], o[3:])
    schichten.sort(key=lambda ds: float(np.dot(normale, np.array(ds.ImagePositionPatient, dtype=float))))
    lagen = [float(np.dot(normale, np.array(ds.ImagePositionPatient, dtype=float))) for ds in schichten]
    dz = float(np.median(np.diff(lagen))) if len(lagen) > 1 else float(getattr(schichten[0], "SliceThickness", 1))
    dy, dx = (float(x) for x in schichten[0].PixelSpacing)
    bilder = []
    for ds in schichten:
        a = ds.pixel_array.astype(np.float32)
        a = a * float(getattr(ds, "RescaleSlope", 1)) + float(getattr(ds, "RescaleIntercept", 0))
        bilder.append(a)
    vol = np.stack(bilder)  # z, y, x
    ist_ct = getattr(schichten[0], "Modality", "") == "CT"
    return vol, (dx, dy, abs(dz)), ist_ct


def lies_nifti(datei):
    try:
        import nibabel as nib
    except ImportError:
        sys.exit("Für NIfTI fehlt nibabel: pip install nibabel")
    bild = nib.load(datei)
    a = np.asarray(bild.dataobj, dtype=np.float32)
    if a.ndim == 4:
        a = a[..., 0]  # erstes Zeitvolumen
    abstand = tuple(float(x) for x in bild.header.get_zooms()[:3])
    vol = np.transpose(a, (2, 1, 0))  # x, y, z → z, y, x
    return vol, abstand, vol.min() <= -900 and vol.max() > 200


def lies_nrrd(datei):
    with open(datei, "rb") as f:
        roh = f.read()
    ende = roh.find(b"\n\n")
    kopf = {}
    for zeile in roh[:ende].decode("latin-1").splitlines()[1:]:
        if ":" in zeile and not zeile.startswith("#"):
            k, v = zeile.split(":", 1)
            kopf[k.strip().lower()] = v.lstrip("=").strip()
    daten = roh[ende + 2:]
    if "gz" in kopf.get("encoding", "raw"):
        daten = gzip.decompress(daten)
    typen = {"short": "i2", "int16": "i2", "ushort": "u2", "uint16": "u2", "uchar": "u1", "uint8": "u1", "float": "f4", "int": "i4", "double": "f8"}
    t = typen.get(kopf["type"].lower())
    if not t:
        sys.exit(f"Typ {kopf['type']} kenne ich nicht.")
    reihe = "<" if kopf.get("endian", "little") == "little" else ">"
    b, h, tt = (int(x) for x in kopf["sizes"].split())
    vol = np.frombuffer(daten, dtype=reihe + t)[: b * h * tt].reshape(tt, h, b).astype(np.float32)
    abstand = (1.0, 1.0, 1.0)
    if "spacings" in kopf:
        abstand = tuple(float(x) for x in kopf["spacings"].split())
    return vol, abstand, vol.min() <= -900 and vol.max() > 200


def verkleinern(vol, abstand, groesse):
    # ganzzahliger Faktor je Achse, so dass die längste Seite höchstens „groesse“ Zellen hat (Würfel bleiben Würfel:
    # derselbe Faktor auf allen Achsen, sonst würde sich die Form verzerren)
    f = int(np.ceil(max(vol.shape) / groesse))
    if f <= 1:
        return vol, abstand
    z, y, x = (s // f * f for s in vol.shape)
    v = vol[:z, :y, :x].reshape(z // f, f, y // f, f, x // f, f).mean(axis=(1, 3, 5))
    return v, tuple(a * f for a in abstand)


def schreibe_nrrd(datei, vol, abstand):
    z, y, x = vol.shape
    kopf = (f"NRRD0004\n# Volumen-Viewer, gepackt mit scan-packen.py\ntype: int16\ndimension: 3\nsizes: {x} {y} {z}\n"
            f"spacings: {abstand[0]:.5g} {abstand[1]:.5g} {abstand[2]:.5g}\nendian: little\nencoding: gzip\n\n")
    with open(datei, "wb") as f:
        f.write(kopf.encode("latin-1"))
        f.write(gzip.compress(vol.astype("<i2").tobytes(), compresslevel=9))


def main():
    ap = argparse.ArgumentParser(description="Scan für eine Projektseite verkleinern und packen")
    ap.add_argument("eingabe", help="DICOM-Ordner, .nii/.nii.gz oder .nrrd")
    ap.add_argument("-o", "--ausgabe", default="scan.nrrd")
    ap.add_argument("--groesse", type=int, default=256, help="längste Seite höchstens so viele Zellen (Standard 256)")
    ap.add_argument("--strecken", choices=["auto", "ja", "nein"], default="auto", help="Werte auf 0 bis 4095 strecken (auto: alles außer CT)")
    a = ap.parse_args()

    e = a.eingabe
    if os.path.isdir(e):
        vol, abstand, ct = lies_dicom(e)
    elif e.endswith((".nii", ".nii.gz")):
        vol, abstand, ct = lies_nifti(e)
    elif e.endswith(".nrrd"):
        vol, abstand, ct = lies_nrrd(e)
    else:
        sys.exit("Ich kenne nur DICOM-Ordner, .nii(.gz) und .nrrd.")
    print(f"gelesen: {vol.shape[2]} × {vol.shape[1]} × {vol.shape[0]} Zellen, Voxel {abstand[0]:.3g} × {abstand[1]:.3g} × {abstand[2]:.3g} mm, "
          f"Werte {vol.min():.0f} bis {vol.max():.0f}{' (CT)' if ct else ''}")

    vol, abstand = verkleinern(vol, abstand, a.groesse)
    strecken = a.strecken == "ja" or (a.strecken == "auto" and not ct)
    if strecken:
        lo, hi = np.percentile(vol, [0.5, 99.9])
        vol = np.clip((vol - lo) / max(hi - lo, 1e-6), 0, 1) * 4095
    else:
        vol = np.clip(vol, -1024, 3071)
    vol = np.round(vol).astype(np.int16)
    schreibe_nrrd(a.ausgabe, vol, abstand)
    mb = os.path.getsize(a.ausgabe) / 1e6
    print(f"geschrieben: {a.ausgabe}, {vol.shape[2]} × {vol.shape[1]} × {vol.shape[0]}, {mb:.1f} MB")
    name = os.path.basename(a.ausgabe)
    print("\nFür eine eigene Seite (index.html neben der Datei, siehe vorlage.js):")
    print(f'  baueSeite({{ daten: ["{name}"], verstecke: ["daten"], einstellungen: {{ gewebe: "{"knochen" if ct else "mrtGewebe"}" }} }});')


if __name__ == "__main__":
    main()
