"""Packs rendered PNGs into the platform icon files.
    python3 pack.py ico  <png-dir> <out.ico>
    python3 pack.py icns <png-dir> <out.icns>
Each size comes from its own rendering (rasterize.cjs), not a resize."""
import os
import sys

from PIL import Image

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]

kind, src, out = sys.argv[1:4]
sizes = ICO_SIZES if kind == "ico" else ICNS_SIZES
images = [Image.open(os.path.join(src, f"{s}.png")).convert("RGBA") for s in sizes]
largest = images[-1]
if kind == "ico":
    largest.save(out, format="ICO", sizes=[(s, s) for s in sizes], append_images=images[:-1])
else:
    largest.save(out, format="ICNS", append_images=images[:-1])
print(out, os.path.getsize(out), "bytes")
