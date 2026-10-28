"""LXNAV: one manuals library, a table of Product, Manual Type, Language, … File.
Checked against the live page on 2026-10-11."""

from __future__ import annotations

from .. import html
from ..fetch import absolute
from .base import MakerAdapter, ManualLink, manual_kind


class LxnavAdapter(MakerAdapter):
    def read_listing(self, url: str, doc: html.Node) -> list[ManualLink]:
        out: list[ManualLink] = []
        for table in doc.select("table"):
            heads = [th.text().strip().lower() for th in table.select("th")]
            if not heads or "product" not in heads[0]:
                continue
            col = {h: i for i, h in enumerate(heads)}
            for tr in table.select("tr"):
                cells = tr.select("td")
                if len(cells) < 2:
                    continue
                link = next((a for c in cells for a in c.select("a[href]") if ".pdf" in a.attrs["href"].lower()), None)
                if link is None:
                    continue
                text = [c.text().strip() for c in cells]
                product = text[0]
                kind_txt = text[col["manual type"]] if "manual type" in col and col["manual type"] < len(text) else ""
                lang_cell = cells[col["language"]] if "language" in col and col["language"] < len(cells) else None
                lang = None
                if lang_cell is not None:
                    lang = lang_cell.text().strip() or next((i.attrs.get("alt") or i.attrs.get("title") for i in lang_cell.select("img")), None)
                u = absolute(url, link.attrs["href"])
                out.append(ManualLink(u, f"{product} {kind_txt}".strip(), [p.strip() for p in product.split(",")], lang, manual_kind(kind_txt or u)))
        return out or super().read_listing(url, doc)


ADAPTER = LxnavAdapter(
    id="lxnav",
    names=["LXNAV", "LX Navigation", "LX nav"],
    start_pages=["https://gliding.lxnav.com/lxdownloads/manuals/"],
    hosts=["gliding.lxnav.com"],
    verified_listing=True,
    depth=0,
    models=[
        "S7", "S8", "S80", "S10", "S100", "S8x", "S10x", "LX9000", "LX9050", "LX9070", "LX8000", "LX8080",
        "LX90xx", "LX80xx", "FlarmView", "FlarmView2", "FlarmView57", "FlarmAce", "FlarmLED", "V8", "V80",
        "Nano", "Nano3", "Nano4", "ADI", "AHRS", "SxHAWK", "HAWK", "FlarmACL", "FlarmMouse",
    ],
)
