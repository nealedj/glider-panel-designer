"""Manual parsing: find the dimension and pinout pages of a maker's PDF, extract candidate
values with their snippets and page numbers, read pinout tables, and render those pages as
images for the reviewer. Rendered pages stay in the local cache and candidates file.
"""

from __future__ import annotations

import base64
import io
import re
from dataclasses import dataclass, field

import pdfplumber
import pypdfium2 as pdfium

from .specs import Candidate, Context, extract, pinout_from_rows

DIMENSION_WORDS = re.compile(r"dimension|cut-?\s?out|panel\s+cut|panel\s+hole|mounting\s+hole|installation\s+drawing|hole\s+pattern|front\s+view|side\s+view", re.I)
PINOUT_WORDS = re.compile(r"pin-?\s?out|pin\s+assignment|pin\s+no|connector|wiring|harness", re.I)


@dataclass
class ManualResult:
    url: str
    title: str
    pages: int
    candidates: list[Candidate] = field(default_factory=list)
    #: Rendered pages for review: {page, kind, image (data URL)}
    drawings: list[dict] = field(default_factory=list)


def _thumb(pdf: pdfium.PdfDocument, index: int, width: int = 1400) -> str:
    page = pdf[index]
    scale = width / page.get_width()
    img = page.render(scale=scale).to_pil().convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=78, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def connector_name(text_above: str) -> str | None:
    """The connector a pinout table belongs to, from the nearest heading-like line above it."""
    for line in reversed(text_above.splitlines()[-6:]):
        m = re.search(r"((?:connector|plug|socket|port)\s*[\w./-]*(?:\s*\([^)]*\))?|X\d+\b[^\n]{0,30}|RJ-?\d+|D-?Sub\s?\d+|DB-?\d+)", line, re.I)
        if m:
            return m[1].strip()
    return None


def analyse(data: bytes, ctx: Context, *, title: str = "", render: bool = True, max_pages: int = 200) -> ManualResult:
    res = ManualResult(url=ctx.url, title=title, pages=0)
    pdf_r = pdfium.PdfDocument(data) if render else None
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        res.pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages[:max_pages]):
            text = page.extract_text() or ""
            dims = bool(DIMENSION_WORDS.search(text))
            pins = bool(PINOUT_WORDS.search(text))
            if not (dims or pins):
                continue
            pctx = Context(ctx.source, ctx.url, ctx.model, ctx.others, page=i + 1, base=ctx.base)
            res.candidates.extend(extract(text, pctx))
            found_table = False
            for t in page.find_tables():
                rows = t.extract()
                pins_ = pinout_from_rows(rows)
                if not pins_:
                    continue
                found_table = True
                above = page.crop((0, 0, page.width, max(1, t.bbox[1]))).extract_text() or ""
                name = connector_name(above)
                snippet = "\n".join(" | ".join(c or "" for c in r) for r in rows[:4])
                res.candidates.append(
                    Candidate(
                        "connectors.pinout",
                        {"name": name, "pins": pins_},
                        snippet,
                        ctx.source,
                        ctx.url,
                        round(min(0.95, ctx.base + 0.1), 2),
                        "table:pinout",
                        page=i + 1,
                        note=f"{len(pins_)} pins read from a table{'' if name else '; connector name not found'}.",
                    )
                )
            if render and pdf_r is not None and (dims or found_table):
                res.drawings.append({"page": i + 1, "kind": "pinout" if found_table and not dims else "dimensions", "image": _thumb(pdf_r, i)})
    return res
