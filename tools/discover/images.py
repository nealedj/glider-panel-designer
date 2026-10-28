"""Face images from product photos, for the maintainer's local use: remove a plain
background, crop to the bezel, decide round or rectangular, and scale to real size from a
known bezel dimension. Photos are other people's: they stay in the local cache and are never
committed or shipped (the app draws faces as vectors).
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

from PIL import Image, ImageChops, ImageFilter


@dataclass
class Face:
    image: Image.Image
    shape: str  # 'round' or 'rect'
    #: Pixels per mm, when the bezel size was known.
    px_per_mm: float | None
    box: tuple[int, int, int, int]

    def data_url(self, max_side: int = 400) -> str:
        im = self.image.copy()
        im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _background(im: Image.Image) -> tuple[int, int, int]:
    """The background colour: the median of the four corners."""
    w, h = im.size
    px = [im.getpixel((x, y)) for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    return tuple(sorted(c[i] for c in px)[1] for i in range(3))  # type: ignore[return-value]


def extract_face(data: bytes, bezel_mm: float | None = None, tolerance: int = 28) -> Face | None:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    bg = Image.new("RGB", im.size, _background(im))
    diff = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > tolerance else 0)
    # Close small gaps and drop specks.
    mask = diff.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MedianFilter(5))
    box = mask.getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w < 20 or h < 20:
        return None
    crop_mask = mask.crop(box)
    fill = sum(crop_mask.histogram()[1:]) / float(w * h)
    # A disc fills π/4 ≈ 0.785 of its box; a square bezel close to 1.
    shape = "round" if fill < 0.88 and abs(w - h) / max(w, h) < 0.08 else "rect"
    face = im.crop(box).convert("RGBA")
    face.putalpha(crop_mask)
    return Face(face, shape, (w / bezel_mm) if bezel_mm else None, box)
