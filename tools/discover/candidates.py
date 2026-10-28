"""Build the candidates file the app's Review tab opens: one entry per product, merging the
retailer page (local provenance only) with what the maker's manuals say.

Sources are tagged by kind. Values whose only source is the retailer can be reviewed, but
the app never exports them to the committed catalogue (rule 7: committed values cite
manufacturer documents).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .specs import Candidate

SCHEMA_VERSION = 1

CATEGORY_WORDS = [
    (r"\bvario|variometer", "vario"),
    (r"flight\s*computer|navigator|nav\s*system|xctouch|oudie|hyper", "flight-computer"),
    (r"flarm\s*view|traffic\s*display|flarm\s*display|\bATD\b", "display"),
    (r"flarm", "flarm"),
    (r"transponder|\bmode\s*s\b|\bTT2\d", "transponder"),
    (r"radio|transceiver|\bcom\b|KRT2|ATR833|TY9\d", "radio"),
    (r"compass", "compass"),
    (r"airspeed|altimeter|\bASI\b|turn\s*(and|&)\s*slip|slip\s*ball|inclinometer", "instrument"),
    (r"switch", "switch"),
    (r"breaker", "breaker"),
    (r"fuse", "fuse"),
    (r"connector|plug|socket", "connector"),
    (r"mount|holder|bracket", "mount"),
    (r"antenna", "antenna"),
    (r"speaker|audio", "audio"),
    (r"battery|charger|power\s*supply", "power"),
    (r"pitot|static|tube|tubing|probe", "pneumatic"),
]

VARIANT = re.compile(r"\b(57|58|80|81)\s?mm\b", re.I)


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def guess_category(name: str) -> str | None:
    for rx, cat in CATEGORY_WORDS:
        if re.search(rx, name, re.I):
            return cat
    return None


def split_variant(model: str) -> tuple[str, str | None]:
    m = VARIANT.search(model)
    if not m:
        return model.strip(), None
    base = (model[: m.start()] + model[m.end() :]).strip(" -,()")
    return re.sub(r"\s{2,}", " ", base), f"{m[1]} mm"


def core_model(name: str, maker: str | None, known: list[str]) -> str:
    """The model token for scoping and manual matching: the longest known model name in the
    product name, else the name without the maker."""
    from .specs import model_pattern

    best = ""
    for k in known:
        if model_pattern(k).search(name) and len(k) > len(best):
            best = k
    if best:
        return best
    n = name
    if maker:
        n = re.sub(re.escape(maker), "", n, flags=re.I)
    return split_variant(n.strip(" -"))[0] or name


def source_id(kind: str, url: str) -> str:
    return f"{kind[0]}:{hashlib.sha1(url.encode()).hexdigest()[:10]}"


@dataclass
class ProductEntry:
    key: str
    maker: str
    model: str
    name: str
    category: str | None
    variant: str | None = None
    reference: bool = False
    candidates: list[dict] = field(default_factory=list)
    drawings: list[dict] = field(default_factory=list)
    face: dict | None = None
    retail: dict | None = None
    manuals: list[dict] = field(default_factory=list)

    def to_json(self) -> dict:
        d = {
            "key": self.key,
            "maker": self.maker,
            "model": self.model,
            "name": self.name,
            "category": self.category,
            "variant": self.variant,
            "reference": self.reference,
            "candidates": self.candidates,
            "drawings": self.drawings,
            "manuals": self.manuals,
        }
        if self.face:
            d["face"] = self.face
        if self.retail:
            d["retail"] = self.retail
        return d


class Builder:
    def __init__(self) -> None:
        self.sources: dict[str, dict] = {}
        self.products: dict[str, ProductEntry] = {}

    def source(self, kind: str, url: str, title: str = "", fetched_at: str | None = None, maker_hosted: bool = False) -> str:
        sid = source_id(kind, url)
        self.sources.setdefault(sid, {"id": sid, "kind": kind, "url": url, "title": title or url, "fetchedAt": fetched_at, "makerHosted": maker_hosted})
        return sid

    def product(self, maker: str, model: str, name: str, category: str | None, *, reference: bool = False) -> ProductEntry:
        base, variant = split_variant(model)
        key = f"{slug(maker)}.{slug(base)}" + (f".{slug(variant)}" if variant else "")
        p = self.products.get(key)
        if p is None:
            p = ProductEntry(key, maker, base, name, category or guess_category(name), variant, reference)
            self.products[key] = p
        else:
            p.reference = p.reference or reference
            p.category = p.category or category or guess_category(name)
        return p

    def add(self, p: ProductEntry, cands: list[Candidate], source: str) -> None:
        for c in cands:
            d = c.to_json()
            d["source"] = source
            p.candidates.append(d)

    def to_json(self) -> dict[str, Any]:
        products = sorted(self.products.values(), key=lambda p: (not p.reference, p.maker.lower(), p.model.lower(), p.variant or ""))
        for p in products:
            p.candidates.sort(key=lambda c: (c["path"], -c["confidence"]))
        return {
            "kind": "gpd-candidates",
            "schemaVersion": SCHEMA_VERSION,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sources": list(self.sources.values()),
            "products": [p.to_json() for p in products],
        }

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_json(), indent=1, ensure_ascii=False), "utf-8")
