"""The discovery run: retailer crawl, maker manuals, face images, candidates file."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from . import makers, retailer
from .candidates import Builder, core_model
from .config import REPO, Config
from .fetch import Fetcher, NetworkRefused
from .html import parse
from .images import extract_face
from .specs import Candidate, Context, extract

SEEDS = REPO / "tools" / "products.toml"


@dataclass
class Seed:
    maker: str
    model: str
    category: str | None = None
    name: str | None = None
    reference: bool = False


def load_seeds(path: Path = SEEDS) -> list[Seed]:
    if not path.exists():
        return []
    data = tomllib.loads(path.read_text("utf-8"))
    return [Seed(p["maker"], p["model"], p.get("category"), p.get("name"), bool(p.get("reference", False))) for p in data.get("product", [])]


def _bezel_mm(cands: list[Candidate]) -> float | None:
    best = None
    for c in cands:
        if c.path in ("front.bezel", "front.cutout") and isinstance(c.value, dict):
            v = c.value.get("w") or c.value.get("d")
            if v and (best is None or c.confidence > best[0]):
                best = (c.confidence, float(v))
    return best[1] if best else None


def run(
    config: Config,
    fetcher: Fetcher,
    *,
    seeds: list[Seed] | None = None,
    crawl_retailer: bool = True,
    manuals: bool = True,
    faces: bool = False,
    max_manuals: int = 2,
    log=print,
) -> Builder:
    b = Builder()

    # ---- the retailer: what is sold, and what the shop page says (local provenance)
    if crawl_retailer and config.retailer:
        for page in retailer.crawl(config.retailer, fetcher, log):
            adapter = makers.for_product(page.maker, page.name)
            maker = page.maker or (adapter.names[0] if adapter else "Unknown")
            known = adapter.models if adapter else []
            model = page.name
            p = b.product(maker, model.replace(maker, "").strip(" -") or model, page.name, page.category)
            p.retail = {"url": page.url, "price": page.price, "currency": page.currency, "image": page.image}
            sid = b.source("retailer", page.url, page.name, page.fetched_at)
            cands = extract(page.spec_text, Context(sid, page.url, core_model(page.name, maker, known), others=known, base=0.55))
            b.add(p, cands, sid)
            if faces and page.image:
                r = fetcher.get(page.image)
                if r is not None and r.ok:
                    f = extract_face(r.body, _bezel_mm(cands))
                    if f:
                        p.face = {"image": f.data_url(), "shape": f.shape, "pxPerMm": f.px_per_mm, "source": sid}

    # ---- products named directly (the reference panel's parts and others), without the retailer
    for s in seeds or []:
        b.product(s.maker, s.model, s.name or f"{s.maker} {s.model}", s.category, reference=s.reference)

    # ---- maker manuals: geometry, pinouts, current draw at first hand
    if manuals:
        listings: dict[str, list] = {}
        for p in list(b.products.values()):
            adapter = makers.for_product(p.maker, p.name)
            if adapter is None:
                continue
            try:
                if adapter.id not in listings:
                    listings[adapter.id] = adapter.listing(fetcher)
                    log(f"{adapter.id}: {len(listings[adapter.id])} manuals listed")
            except NetworkRefused as e:
                log(f"{adapter.id}: skipped ({e})")
                listings[adapter.id] = list(adapter.seed_manuals)
            model = core_model(p.name, p.maker, adapter.models)
            for m in adapter.manuals_for(model, listings[adapter.id])[:max_manuals]:
                try:
                    r = fetcher.get(m.url)
                except NetworkRefused as e:
                    log(f"{p.key}: {m.url} not cached ({e})")
                    continue
                if r is None or not r.ok:
                    continue
                maker_hosted = urlparse(m.url).netloc in adapter.hosts
                sid = b.source("manual", m.url, m.title, r.fetched_at, maker_hosted)
                ctx = Context(sid, m.url, model, adapter.models, base=0.75 if maker_hosted else 0.6)
                if r.body[:5] == b"%PDF-" or "pdf" in r.content_type:
                    from .pdf import analyse

                    res = analyse(r.body, ctx, title=m.title)
                    b.add(p, res.candidates, sid)
                    p.drawings.extend({"source": sid, **d} for d in res.drawings)
                    p.manuals.append({"source": sid, "url": m.url, "title": m.title, "pages": res.pages})
                else:
                    b.add(p, extract(parse(r.text()).text(), ctx), sid)
                    p.manuals.append({"source": sid, "url": m.url, "title": m.title, "pages": None})
                b.add(p, [Candidate("datasheet", m.url, m.title, sid, m.url, 0.8 if maker_hosted else 0.5, "manual-link", note=None if maker_hosted else "Not hosted by the maker.")], sid)
    log(f"candidates: {len(b.products)} products, {sum(len(p.candidates) for p in b.products.values())} candidate values, {fetcher.requests} requests sent")
    return b
