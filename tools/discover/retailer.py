"""The generic retailer adapter: walk category pages to product pages and extract what each
product page says, using the shop's standard metadata (Open Graph, schema.org JSON-LD and
microdata) with optional selectors from the local config.

The retailer's address and rules come only from the git-ignored config.
"""

from __future__ import annotations

import json
import re
from collections import deque
from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse

from . import html
from .config import RetailerConfig
from .fetch import Fetcher, absolute

#: Makers we know, for spotting the maker in a product name when the page doesn't say.
KNOWN_MAKERS = [
    "LXNAV", "LX Navigation", "FLARM", "Trig", "f.u.n.k.e.", "Funke", "Air Avionics", "Naviter", "Winter", "PilotAware",
    "XCVario", "TQ", "Becker", "Garmin", "Dittel", "Filser", "Borgelt", "Cambridge", "Butterfly", "Kanardia",
    "Schaeffer", "Bohli", "Airglow", "Mountain High", "uAvionix", "Stratux", "ClearNav", "Oudie", "SoftRF", "Kobo",
]


@dataclass
class ProductPage:
    url: str
    name: str
    maker: str | None
    category: str | None
    price: float | None = None
    currency: str | None = None
    image: str | None = None
    spec_text: str = ""
    manual_links: list[tuple[str, str]] = field(default_factory=list)
    sku: str | None = None
    fetched_at: str = ""

    def to_json(self) -> dict:
        return asdict(self)


def _json_ld(doc: html.Node) -> list[dict]:
    out = []
    for s in doc.select("script[type=application/ld+json]"):
        raw = "".join(c for c in s.children if isinstance(c, str))
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        out.extend(i for i in items if isinstance(i, dict))
    return out


def _product_ld(doc: html.Node) -> dict | None:
    for item in _json_ld(doc):
        t = item.get("@type")
        if t == "Product" or (isinstance(t, list) and "Product" in t):
            return item
    return None


def _sel(doc: html.Node, cfg: RetailerConfig, key: str) -> str | None:
    s = cfg.selectors.get(key)
    if not s:
        return None
    v = doc.select_one(s)
    if v is None:
        return None
    return v if isinstance(v, str) else v.text()


def is_product(doc: html.Node) -> bool:
    og_type = html.meta(doc, "og:type")
    return bool(
        (og_type and "product" in og_type.lower())
        or _product_ld(doc)
        or html.meta(doc, "product:price:amount")
        or doc.select("[itemtype*=schema.org/Product]")
    )


def guess_maker(name: str, brand: str | None) -> str | None:
    if brand:
        return brand.strip()
    # The maker named first in the title wins ("TQ KRT2", not a product line further on).
    hits = []
    for m in KNOWN_MAKERS:
        f = re.search(r"(?<![A-Za-z])" + re.escape(m) + r"(?![A-Za-z])", name, re.I)
        if f:
            hits.append((f.start(), -len(m), m))
    return min(hits)[2] if hits else None


def category_for(cfg: RetailerConfig, url: str, crumbs: str, via: str | None) -> str | None:
    for rx, cat in cfg.categories.items():
        for hay in (url, crumbs, via or ""):
            if hay and re.search(rx, hay, re.I):
                return cat
    return None


def extract_product(cfg: RetailerConfig, url: str, doc: html.Node, via: str | None, fetched_at: str) -> ProductPage:
    ld = _product_ld(doc) or {}
    name = _sel(doc, cfg, "name") or ld.get("name") or html.meta(doc, "og:title") or (h.text() if (h := doc.select_one("h1")) and not isinstance(h, str) else "") or url
    brand = ld.get("brand")
    brand = brand.get("name") if isinstance(brand, dict) else brand
    offers = ld.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    price_s = _sel(doc, cfg, "price") or html.meta(doc, "product:price:amount") or offers.get("price") or html.meta(doc, "price")
    try:
        price = float(str(price_s).replace(",", "").replace("£", "").strip()) if price_s not in (None, "") else None
    except ValueError:
        price = None
    currency = html.meta(doc, "product:price:currency") or offers.get("priceCurrency")
    image = _sel(doc, cfg, "image") or html.meta(doc, "og:image") or (ld.get("image")[0] if isinstance(ld.get("image"), list) else ld.get("image"))
    # Spec text: configured block, else the description and the largest text block on the page.
    spec = _sel(doc, cfg, "spec")
    if not spec:
        parts = []
        if ld.get("description"):
            parts.append(str(ld["description"]))
        for s in ("[itemprop=description]", ".description", "#description", ".product-description", ".specifications", "#tab-description"):
            for n in doc.select(s):
                parts.append(n.text())
        if not parts:
            blocks = sorted((n.text() for n in doc.select("div, section, article")), key=len, reverse=True)
            parts = blocks[:1]
        spec = "\n".join(dict.fromkeys(p for p in parts if p))
    crumbs = " / ".join(n.text() for n in doc.select(".breadcrumb a, nav.breadcrumbs a, [itemtype*=BreadcrumbList] [itemprop=name]"))
    manuals = [(absolute(url, h), t) for h, t in html.links(doc) if re.search(r"\.pdf($|\?)", h, re.I)]
    return ProductPage(
        url=url,
        name=str(name).strip(),
        maker=guess_maker(str(name), brand),
        category=category_for(cfg, url, crumbs, via),
        price=price,
        currency=currency,
        image=absolute(url, image) if image else None,
        spec_text=spec,
        manual_links=manuals,
        sku=ld.get("sku") or ld.get("mpn"),
        fetched_at=fetched_at,
    )


def crawl(cfg: RetailerConfig, fetcher: Fetcher, log=print) -> list[ProductPage]:
    """Breadth-first from the start pages, staying on the shop's host."""
    host = cfg.host
    starts = [absolute(cfg.base_url, s) for s in cfg.start_pages]
    queue: deque[tuple[str, str | None]] = deque((s, s) for s in starts)
    seen: set[str] = set(starts)
    products: dict[str, ProductPage] = {}
    pages = 0
    follow = [re.compile(f, re.I) for f in cfg.follow]
    skip = [re.compile(s, re.I) for s in cfg.skip]
    while queue and pages < cfg.max_pages:
        url, via = queue.popleft()
        r = fetcher.get(url)
        pages += 1
        if r is None or not r.ok or "html" not in (r.content_type or "text/html"):
            continue
        doc = html.parse(r.text())
        if is_product(doc):
            p = extract_product(cfg, url, doc, via, r.fetched_at)
            products[url] = p
            continue
        for href, _text in html.links(doc):
            nxt = absolute(url, href)
            pu = urlparse(nxt)
            if pu.netloc != host or nxt in seen or re.search(r"\.(pdf|jpe?g|png|gif|zip)$", pu.path, re.I):
                continue
            if any(s.search(nxt) for s in skip):
                continue
            if follow and not any(f.search(nxt) for f in follow):
                continue
            if not follow and not pu.path.endswith((".html", "/")):
                continue
            seen.add(nxt)
            # Remember the page that linked here: its URL often names the category.
            queue.append((nxt, url))
    log(f"retailer: {pages} pages, {len(products)} products, {fetcher.requests} requests sent")
    return list(products.values())
