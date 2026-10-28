"""Winter Instrumente: one page per instrument type, whose PDF links say only "Maßzeichnung" or
"Einbau-und Wartungsanweisung" and whose file names are hashes. Each PDF is tied to the models
the linking page names (6 FMS and 7 FMS on the airspeed page). Checked live on 2026-10-28."""

from __future__ import annotations

import re

from .. import html
from .base import MakerAdapter, ManualLink


class WinterAdapter(MakerAdapter):
    def read_listing(self, url: str, doc: html.Node) -> list[ManualLink]:
        out = super().read_listing(url, doc)
        text = doc.text()
        named = [m for m in self.models if re.search(r"(?<![\w])" + re.escape(m) + r"(?![\w])", text)]
        # A page naming every product (the download page) says nothing about any one PDF.
        if not named or len(named) > 2:
            return out
        # Most of these are only in German, so the language is left unset rather than filtered.
        return [ManualLink(m.url, m.title, [*m.products, *named], m.language, m.kind) for m in out]


ADAPTER = WinterAdapter(
    id="winter",
    names=["Winter"],
    start_pages=["https://www.winter-instruments.de/", "https://www.winter-instruments.de/fahrtmesser-airspeed-indicator"],
    hosts=["www.winter-instruments.de", "winter-instruments.de"],
    models=["6 FMS", "7 FMS", "4 FGH", "5 FGH", "5 STVM", "6 STVM", "QM", "QR", "KS"],
    max_manuals=6,
)
