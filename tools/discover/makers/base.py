"""Maker adapters: each finds one maker's manuals. Most of the work is generic: walk the
maker's download pages (same site, two links deep), collect PDF links, and rank them for a
product by model name and manual type. A maker module only declares where to start and,
where its site is unusual, how to read its listing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from .. import html
from ..fetch import Fetcher, absolute
from ..specs import model_pattern


@dataclass
class ManualLink:
    url: str
    title: str
    #: Product names the listing ties this manual to (from a table or the link text).
    products: list[str] = field(default_factory=list)
    language: str | None = None
    kind: str | None = None  # installation, user, quick, other


TYPE_RANK = {"installation": 0, "user": 1, "other": 2, "quick": 3}
NON_ENGLISH = re.compile(r"\b(german|deutsch|french|fran[cç]ais|polish|italian|dutch|spanish|czech|hungarian)\b|_(de|fr|it|pl|nl|es|cz)\b|-(de|fr|it|pl)\.pdf", re.I)


def manual_kind(text: str) -> str:
    t = text.lower()
    if "install" in t:
        return "installation"
    if "quick" in t or "reference card" in t:
        return "quick"
    if "manual" in t or "user" in t or "handbook" in t or "operation" in t:
        return "user"
    return "other"


@dataclass
class MakerAdapter:
    #: Short id: the module name.
    id: str
    #: Names as they appear in product titles.
    names: list[str]
    #: Pages to start from. Listing pages marked unverified have not been checked against the live site yet.
    start_pages: list[str]
    #: Hosts the walker may visit (the maker's own sites).
    hosts: list[str]
    #: Manuals known by URL, for products the listing pages don't reach.
    seed_manuals: list[ManualLink] = field(default_factory=list)
    #: Model names in this maker's range, used to scope spec lines (S10 vs S100).
    models: list[str] = field(default_factory=list)
    verified_listing: bool = False
    #: Follow links whose URL or text matches this, when walking listing pages.
    follow: str = r"download|manual|document|support|product|instrument|avionic"
    depth: int = 2

    def matches_maker(self, maker: str | None, name: str) -> bool:
        hay = f"{maker or ''} {name}"
        return any(re.search(r"(?<![A-Za-z])" + re.escape(n) + r"(?![A-Za-z])", hay, re.I) for n in self.names)

    # -------------------------------------------------------------- listing

    def read_listing(self, url: str, doc: html.Node) -> list[ManualLink]:
        """PDF links on one page. Override for sites with structured tables."""
        out = []
        for href, text in html.links(doc):
            if re.search(r"\.pdf($|\?)", href, re.I):
                u = absolute(url, href)
                out.append(ManualLink(u, text or u.rsplit("/", 1)[-1], [text] if text else [], None, manual_kind(f"{text} {u}")))
        return out

    def listing(self, fetcher: Fetcher) -> list[ManualLink]:
        found: dict[str, ManualLink] = {m.url: m for m in self.seed_manuals}
        frontier = [(u, 0) for u in self.start_pages]
        seen = set(self.start_pages)
        follow = re.compile(self.follow, re.I)
        while frontier:
            url, d = frontier.pop(0)
            r = fetcher.get(url)
            if r is None or not r.ok or "html" not in (r.content_type or "text/html"):
                continue
            doc = html.parse(r.text())
            for m in self.read_listing(url, doc):
                found.setdefault(m.url, m)
            if d >= self.depth:
                continue
            for href, text in html.links(doc):
                nxt = absolute(url, href)
                if urlparse(nxt).netloc not in self.hosts or nxt in seen or re.search(r"\.(pdf|jpe?g|png|zip|exe|bin)($|\?)", nxt, re.I):
                    continue
                if not follow.search(nxt) and not follow.search(text):
                    continue
                seen.add(nxt)
                frontier.append((nxt, d + 1))
        return list(found.values())

    # -------------------------------------------------------------- ranking

    def manuals_for(self, model: str, links: list[ManualLink]) -> list[ManualLink]:
        """Manuals for a model, best first: English, installation before user, then newest-looking."""
        pat = model_pattern(model)
        hits = []
        for m in links:
            hay = " ".join([m.title, *m.products, m.url.rsplit("/", 1)[-1]])
            # A range name in a listing ("S8x, S10x") covers its models: S100 matches S10x.
            if pat.search(hay) or any(_range_covers(p, model) for p in m.products):
                if m.language and m.language.lower() not in ("english", "en"):
                    continue
                if not m.language and NON_ENGLISH.search(hay):
                    continue
                hits.append(m)
        return sorted(hits, key=lambda m: (TYPE_RANK.get(m.kind or "other", 2), -_version(m.url + " " + m.title)))


def _range_covers(product_cell: str, model: str) -> bool:
    """'S8x' covers S80; 'S10x' covers S100; 'LX80xx' covers LX8080."""
    for token in re.split(r"[,/;&]| and ", product_cell):
        t = token.strip()
        if "x" not in t.lower() or not re.search(r"\d", t):
            continue
        rx = "^" + "".join(r"\d" if ch in "xX" and i > 0 and (t[i - 1].isdigit() or t[i - 1] in "xX") else re.escape(ch) for i, ch in enumerate(t)) + "$"
        if re.match(rx, model.replace(" ", ""), re.I):
            return True
    return False


def _version(s: str) -> float:
    m = re.search(r"(?:ver|v|rev|r)[ _]?(\d+(?:[._]\d+)?)", s, re.I)
    return float(m[1].replace("_", ".")) if m else 0.0
