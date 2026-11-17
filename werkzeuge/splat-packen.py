#!/usr/bin/env python3
"""
Gaussian-Splat-Scan fürs Web klein machen: .ply (3DGS, Postshot, Scaniverse, Polycam, SuperSplat …) → .splat oder .spz

Eine .ply aus dem Training hat pro Splat 62 Kommazahlen (248 Bytes): Lage, Normale, Farbe, 45 Zahlen dafür, wie sich
die Farbe mit dem Blickwinkel ändert (f_rest, Glanz), Deckkraft, Radien, Drehung. Für eine Website ist das zu viel:
ein Zimmer mit 1,5 Millionen Splats sind fast 400 MB.

Dieses Werkzeug
  1. lässt den Glanz weg (f_rest; der Unterschied ist bei matten Zimmern klein)
  2. wirft fast durchsichtige Splats weg (--min-deckkraft, Standard 0,5 %) und, wenn gewünscht, alles außerhalb einer
     Kiste (--kiste). Vorsicht mit höheren Werten: Brush baut Wände und Ecken aus vielen schwachen Splats übereinander.
     Mit 5 % fiel bei deinem Zimmer die Hälfte weg, die Wände wurden durchsichtig, dahinter kamen Nebel und dunkle
     Löcher zum Vorschein. Das ursprüngliche 3DGS räumt beim Training erst unter 0,5 % auf
  3. behält höchstens --anzahl Splats, die wichtigsten zuerst (Deckkraft × Volumen: große, deckende Flecken prägen
     das Bild, winzige, fast durchsichtige kaum)
     Achtung: Für starkes Ausdünnen (etwa von 3,8 auf 1,5 Millionen) taugt das nicht. Es behält gerade die großen,
     weichen Flecken und wirft die vielen kleinen weg, aus denen die Wände bestehen: Löcher, Nebel. Besser ist eine
     Obergrenze schon beim Training (Brush: --max-splats), dann passen sich die übrigen Splats an
  4. schreibt, je nach Endung der Ausgabe:
     .splat (antimatter15): 32 Bytes pro Splat, die wichtigsten vorn
       Lage 3 × float32, Radien 3 × float32, Farbe RGBA 4 × uint8, Drehung 4 × uint8 ((q · 128) + 128, w zuerst)
     .spz (Niantic, Version 3): alles auf 8 bis 24 Bit gerundet, nach Art sortiert und mit gzip gepackt: 20 Bytes pro
       Splat vor gzip (Lage 9, Deckkraft 1, Farbe 3, Radien 3, Drehung 4), danach gemessen etwa 16 bis 17, also gut
       die Hälfte von .splat (vorher stand hier 6 bis 8, das war falsch). Genauer erklärt in zimmer/js/laden.js. Die
       Datei können auch andere Programme lesen (SuperSplat, die spz-Bibliothek …).

Beispiele:  py splat-packen.py zimmer.ply zimmer_pc.spz --anzahl 4000000
            py splat-packen.py zimmer.ply zimmer_handy.spz --anzahl 1500000
Braucht nur numpy.
"""
import argparse
import gzip
import struct
import sys

import numpy as np

C0 = 0.28209479177387814
TYPEN = {"char": "i1", "uchar": "u1", "int8": "i1", "uint8": "u1", "short": "i2", "ushort": "u2", "int16": "i2",
         "uint16": "u2", "int": "i4", "uint": "u4", "int32": "i4", "uint32": "u4", "float": "f4", "float32": "f4",
         "double": "f8", "float64": "f8"}


def lies_ply(pfad):
    with open(pfad, "rb") as f:
        kopf = []
        while True:
            zeile = f.readline()
            if not zeile:
                sys.exit("Kein end_header gefunden.")
            zeile = zeile.decode("ascii", "replace").strip()
            kopf.append(zeile)
            if zeile == "end_header":
                break
        if not any(z.startswith("format binary_little_endian") for z in kopf):
            sys.exit("Nur binäre PLY (little endian).")
        anzahl, felder, im_vertex = 0, [], False
        for z in kopf:
            t = z.split()
            if t[:1] == ["element"]:
                im_vertex = t[1] == "vertex"
                if im_vertex:
                    anzahl = int(t[2])
            elif t[:1] == ["property"] and im_vertex:
                if t[1] == "list":
                    sys.exit("Listen in den Punkten gehen nicht.")
                felder.append((t[2], "<" + TYPEN[t[1]]))
        daten = np.fromfile(f, dtype=np.dtype(felder), count=anzahl)
    return daten


def drehmatrix(ax, ay, az):
    ax, ay, az = np.radians([ax, ay, az])
    rx = np.array([[1, 0, 0], [0, np.cos(ax), -np.sin(ax)], [0, np.sin(ax), np.cos(ax)]])
    ry = np.array([[np.cos(ay), 0, np.sin(ay)], [0, 1, 0], [-np.sin(ay), 0, np.cos(ay)]])
    rz = np.array([[np.cos(az), -np.sin(az), 0], [np.sin(az), np.cos(az), 0], [0, 0, 1]])
    return rz @ ry @ rx


def quat_aus_matrix(m):
    # Drehmatrix → Quaternion (w, x, y, z)
    w = np.sqrt(max(0.0, 1 + m[0, 0] + m[1, 1] + m[2, 2])) / 2
    x = np.copysign(np.sqrt(max(0.0, 1 + m[0, 0] - m[1, 1] - m[2, 2])) / 2, m[2, 1] - m[1, 2])
    y = np.copysign(np.sqrt(max(0.0, 1 - m[0, 0] + m[1, 1] - m[2, 2])) / 2, m[0, 2] - m[2, 0])
    z = np.copysign(np.sqrt(max(0.0, 1 - m[0, 0] - m[1, 1] + m[2, 2])) / 2, m[1, 0] - m[0, 1])
    return np.array([w, x, y, z])


def quat_mal(a, b):
    # a · b für Quaternionen (w, x, y, z); a einzeln, b viele (n × 4)
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b.T
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], axis=1)


def schreibe_splat(pfad, lage, radien, farbe, deck, quat):
    m = len(lage)
    aus = np.zeros(m, dtype=[("lage", "<f4", 3), ("radien", "<f4", 3), ("farbe", "u1", 4), ("quat", "u1", 4)])
    aus["lage"] = lage
    aus["radien"] = radien
    aus["farbe"][:, :3] = np.clip(farbe * 255, 0, 255).round()
    aus["farbe"][:, 3] = np.clip(deck * 255, 0, 255).round()
    aus["quat"] = np.clip(quat * 128 + 128, 0, 255).round()
    aus.tofile(pfad)


def schreibe_spz(pfad, lage, radien, farbe, deck, quat):
    """SPZ Version 3 (gzip): Kopf, dann Lagen, Deckkräfte, Farben, Radien, Drehungen; Felder wie in laden.js."""
    m = len(lage)
    bits = 12
    # PLY liegt in RDF, SPZ in RUB: y und z umdrehen (180° um x). Die Quaternion dreht dabei mit: x bleibt, y und z
    # wechseln das Vorzeichen (wie die spz-Bibliothek beim Umwandeln)
    lage = lage * np.array([1, -1, -1])
    q = quat * np.array([1, 1, -1, -1])  # (w, x, y, z)
    q = np.stack([q[:, 1], q[:, 2], q[:, 3], q[:, 0]], axis=1)  # → (x, y, z, w)
    fest = np.round(lage * (1 << bits)).astype(np.int64)
    if np.abs(fest).max() >= 1 << 23:
        sys.exit("Die Szene ist größer als ±2048 m: das passt nicht in SPZ mit 12 Nachkommabits.")
    fest &= 0xFFFFFF
    pos = np.stack([fest & 0xFF, (fest >> 8) & 0xFF, (fest >> 16) & 0xFF], axis=-1).astype(np.uint8).reshape(m, 9)
    alpha = np.clip(np.round(deck * 255), 0, 255).astype(np.uint8)
    dc = (farbe - 0.5) / C0
    farb = np.clip(np.round(dc * (0.15 * 255) + 127.5), 0, 255).astype(np.uint8)
    rad = np.clip(np.round((np.log(np.maximum(radien, 1e-12)) + 10) * 16), 0, 255).astype(np.uint8)
    # Drehung „kleinste drei“: größte Komponente weglassen (positiv machen, q und −q sind dieselbe Drehung)
    groesste = np.abs(q).argmax(axis=1)
    vorz = np.where(q[np.arange(m), groesste] < 0, -1.0, 1.0)[:, None]
    q = q * vorz
    c = groesste.astype(np.uint64)
    for k in range(4):
        hier = groesste != k
        betrag = np.round(511 * np.abs(q[:, k]) / np.sqrt(0.5)).clip(0, 511).astype(np.uint64)
        minus = (q[:, k] < 0).astype(np.uint64)
        c = np.where(hier, (c << np.uint64(10)) | (minus << np.uint64(9)) | betrag, c)
    rot = np.stack([(c >> np.uint64(8 * j)) & np.uint64(0xFF) for j in range(4)], axis=1).astype(np.uint8)
    kopf = struct.pack("<IIIBBBB", 0x5053474E, 3, m, 0, bits, 0, 0)
    daten = kopf + pos.tobytes() + alpha.tobytes() + farb.tobytes() + rad.tobytes() + rot.tobytes()
    with gzip.open(pfad, "wb", compresslevel=9) as f:
        f.write(daten)


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("eingabe")
    a.add_argument("ausgabe")
    a.add_argument("--anzahl", type=int, default=800000, help="höchstens so viele Splats (Standard 800000, als .spz etwa 13 MB)")
    a.add_argument("--min-deckkraft", type=float, default=0.005, help="durchsichtigere weg (0 bis 1, Standard 0,005)")
    a.add_argument("--kiste", type=float, nargs=6, metavar=("X0", "Y0", "Z0", "X1", "Y1", "Z1"),
                   help="nur Splats in dieser Kiste behalten (Koordinaten nach dem Drehen)")
    a.add_argument("--drehen", type=float, nargs=3, metavar=("X", "Y", "Z"), default=[0, 0, 0],
                   help="Grad um x, dann y, dann z (viele Scans brauchen 180 0 0: sie liegen auf dem Kopf)")
    arg = a.parse_args()

    d = lies_ply(arg.eingabe)
    namen = d.dtype.names
    n = len(d)
    print(f"{n} Splats gelesen")
    lage = np.stack([d["x"], d["y"], d["z"]], axis=1).astype(np.float64)
    if "scale_0" in namen:
        radien = np.exp(np.stack([d["scale_0"], d["scale_1"], d["scale_2"]], axis=1).astype(np.float64))
        quat = np.stack([d["rot_0"], d["rot_1"], d["rot_2"], d["rot_3"]], axis=1).astype(np.float64)
        deck = 1 / (1 + np.exp(-d["opacity"].astype(np.float64)))
        farbe = 0.5 + C0 * np.stack([d["f_dc_0"], d["f_dc_1"], d["f_dc_2"]], axis=1)
    else:
        # reine Punktwolke: runde Flecken, Größe aus dem mittleren Abstand
        ausdehnung = np.ptp(lage, axis=0).max()
        radien = np.full((n, 3), ausdehnung / np.cbrt(n) * 0.5)
        quat = np.tile([1.0, 0, 0, 0], (n, 1))
        deck = np.ones(n)
        farbe = np.stack([d["red"], d["green"], d["blue"]], axis=1) / 255.0
    quat /= np.linalg.norm(quat, axis=1, keepdims=True) + 1e-12

    if any(arg.drehen):
        r = drehmatrix(*arg.drehen)
        lage = lage @ r.T
        quat = quat_mal(quat_aus_matrix(r), quat)  # erst die eigene Drehung, dann die neue

    behalten = deck >= arg.min_deckkraft
    if arg.kiste:
        lo, hi = np.array(arg.kiste[:3]), np.array(arg.kiste[3:])
        behalten &= np.all((lage >= lo) & (lage <= hi), axis=1)
    print(f"{behalten.sum()} nach Deckkraft und Kiste")
    wichtig = np.where(behalten, deck * radien.prod(axis=1), -1)
    reihenfolge = np.argsort(-wichtig)[: min(arg.anzahl, int(behalten.sum()))]

    m = len(reihenfolge)
    teile = (lage[reihenfolge], radien[reihenfolge], np.asarray(farbe)[reihenfolge], deck[reihenfolge], quat[reihenfolge])
    if arg.ausgabe.lower().endswith(".spz"):
        schreibe_spz(arg.ausgabe, *teile)
    else:
        schreibe_splat(arg.ausgabe, *teile)
    import os
    print(f"{m} Splats geschrieben: {arg.ausgabe} ({os.path.getsize(arg.ausgabe) / 1e6:.1f} MB)")
    if any(arg.drehen):
        print("Gedreht ist schon: in zimmer.json dann \"drehung\": [0, 0, 0]")


if __name__ == "__main__":
    main()
