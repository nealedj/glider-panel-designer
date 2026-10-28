"""A small HTML tree and CSS-subset selector on the standard library's parser.

Supports: `tag`, `.class`, `#id`, `[attr]`, `[attr=value]`, `[attr*=value]`, `[attr^=value]`,
compound selectors (`div.price[itemprop=price]`), descendant combinators (`div p`) and
comma lists. `select_one('meta[property=og:image]@content')` returns an attribute.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
BLOCK = {"p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "section", "article", "dd", "dt"}


@dataclass(eq=False)
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["Node | str"] = field(default_factory=list)
    parent: "Node | None" = None

    def text(self) -> str:
        """Visible text, with line breaks at block elements, whitespace collapsed per line."""
        parts: list[str] = []

        def walk(n: Node | str) -> None:
            if isinstance(n, str):
                parts.append(n)
                return
            if n.tag in ("script", "style", "noscript"):
                return
            if n.tag in BLOCK:
                parts.append("\n")
            for c in n.children:
                walk(c)
            if n.tag in BLOCK:
                parts.append("\n")

        walk(self)
        lines = [re.sub(r"[ \t\r\f\v ]+", " ", ln).strip() for ln in "".join(parts).split("\n")]
        return "\n".join(ln for ln in lines if ln)

    def iter(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.iter()

    def select(self, selector: str) -> list["Node"]:
        chains = [[_parse_simple(s) for s in part.split()] for part in selector.split(",")]
        chains = [c for c in chains if c]
        # Document order, each node once.
        return [n for n in self.iter() if any(_match_chain(n, c) for c in chains)]

    def select_one(self, selector: str) -> "Node | str | None":
        """First match; with a trailing `@attr`, that attribute's value instead."""
        attr = None
        if "@" in selector:
            selector, attr = selector.rsplit("@", 1)
        found = self.select(selector)
        if not found:
            return None
        return found[0].attrs.get(attr) if attr else found[0]


_SIMPLE = re.compile(r"^(?P<tag>[a-zA-Z0-9*-]+)?(?P<rest>.*)$")
_PART = re.compile(r"\.(?P<cls>[\w-]+)|#(?P<id>[\w-]+)|\[(?P<attr>[\w:-]+)(?:(?P<op>[*^$]?=)\"?(?P<val>[^\]\"]*)\"?)?\]")


def _parse_simple(s: str):
    m = _SIMPLE.match(s)
    assert m
    tag = (m.group("tag") or "*").lower()
    conds = []
    for p in _PART.finditer(m.group("rest")):
        if p.group("cls"):
            conds.append(("class", "~=", p.group("cls")))
        elif p.group("id"):
            conds.append(("id", "=", p.group("id")))
        else:
            conds.append((p.group("attr").lower(), p.group("op"), p.group("val")))
    return tag, conds


def _match_simple(n: Node, simple) -> bool:
    tag, conds = simple
    if tag != "*" and n.tag != tag:
        return False
    for attr, op, val in conds:
        v = n.attrs.get(attr)
        if v is None:
            return False
        if op == "~=" and val not in v.split():
            return False
        if op == "=" and v != val:
            return False
        if op == "*=" and val not in v:
            return False
        if op == "^=" and not v.startswith(val):
            return False
        if op == "$=" and not v.endswith(val):
            return False
    return True


def _match_chain(n: Node, chain) -> bool:
    if not _match_simple(n, chain[-1]):
        return False
    rest = chain[:-1]
    p = n.parent
    while rest and p is not None:
        if _match_simple(p, rest[-1]):
            rest = rest[:-1]
        p = p.parent
    return not rest


class _Builder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#document")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = Node(tag.lower(), {k.lower(): (v or "") for k, v in attrs}, [], self.cur)
        self.cur.children.append(n)
        if tag.lower() not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag.lower(), {k.lower(): (v or "") for k, v in attrs}, [], self.cur))

    def handle_endtag(self, tag):
        tag = tag.lower()
        n = self.cur
        # Close up to the matching open tag; ignore stray end tags.
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse(html: str) -> Node:
    b = _Builder()
    b.feed(html)
    b.close()
    return b.root


def meta(doc: Node, name: str) -> str | None:
    """A <meta> value by property or name (og:title, product:price:amount, description)."""
    for n in doc.select("meta"):
        if n.attrs.get("property") == name or n.attrs.get("name") == name or n.attrs.get("itemprop") == name:
            return n.attrs.get("content")
    return None


def links(doc: Node) -> list[tuple[str, str]]:
    """(href, link text) for every <a href>."""
    return [(a.attrs["href"], a.text()) for a in doc.select("a[href]")]
