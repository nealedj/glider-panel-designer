"""Synthetic websites and PDFs for the discovery tests. Nothing here is copied from a real
site: the shop, its pages and the manual are made up, with the shapes real ones have."""

from __future__ import annotations

import json
import zlib

SHOP = "https://shop.test"
MAKER = "https://gliding.lxnav.com"


def page(title: str, body: str, head: str = "") -> str:
    return f"<!doctype html><html><head><title>{title}</title>{head}</head><body>{body}</body></html>"


def product_page(name: str, price: str, desc: str, *, brand: str | None = None, extra: str = "", image: str = "/img/p.jpg") -> str:
    ld = {"@context": "https://schema.org", "@type": "Product", "name": name, "offers": {"@type": "Offer", "price": price, "priceCurrency": "GBP"}}
    if brand:
        ld["brand"] = {"@type": "Brand", "name": brand}
    head = (
        f'<meta property="og:type" content="product"><meta property="og:title" content="{name}">'
        f'<meta property="og:image" content="{SHOP}{image}"><meta property="product:price:amount" content="{price}">'
        f'<meta property="product:price:currency" content="GBP"><script type="application/ld+json">{json.dumps(ld)}</script>'
    )
    body = (
        f'<nav class="breadcrumb"><a href="/">Home</a><a href="/varios.html">Varios</a></nav><h1>{name}</h1>'
        f'<div class="description">{desc}</div>{extra}<a href="/basket.html?add=1">Add to basket</a>'
    )
    return page(name, body, head)


# The S100 trap, as on real shop pages: size and weight for the S100, then current draw for
# other models in the range.
S100_DESC = """
<p>The LXNAV S100 is a 57mm vario with a built-in FLARM display.</p>
<ul>
<li>Panel cut-out: 57 mm hole</li>
<li>Dimensions (WxHxD): 61 x 61 x 98 mm</li>
<li>Weight: 270 g</li>
<li>Power supply: 10-32 V DC</li>
<li>S10 current consumption: 140 mA at 12 V</li>
<li>S8D current consumption: 110 mA at 12 V</li>
</ul>
"""

S80_DESC = """
<p>LXNAV S80 vario, 80mm version.</p>
<p>Weight 280 g. Depth behind the panel: 101 mm. Current consumption 150 mA at 12 V.</p>
<p>Connects with an RJ45 cable and a D-Sub 9 plug.</p>
"""

KRT2_DESC = "<p>TQ KRT2 VHF transceiver, 57 mm. Weight: 340 g. Power: 2.4 W at 13.8 V.</p>"

PAGES: dict[str, tuple[str, str]] = {
    f"{SHOP}/robots.txt": ("text/plain", "User-agent: *\nDisallow: /basket.html\nDisallow: /private/\n"),
    f"{SHOP}/varios.html": (
        "text/html",
        page("Varios", '<a href="/lxnav-s100.html">LXNAV S100</a> <a href="/lxnav-s80.html">LXNAV S80</a> <a href="/varios-2.html">Next</a> <a href="/private/x.html">x</a> <a href="https://elsewhere.test/a.html">out</a>'),
    ),
    f"{SHOP}/varios-2.html": ("text/html", page("Varios page 2", '<a href="/varios.html">Prev</a> <a href="/krt2.html">KRT2</a>')),
    f"{SHOP}/lxnav-s100.html": ("text/html", product_page("LXNAV S100 Vario 57mm", "1950.00", S100_DESC, brand="LXNAV")),
    f"{SHOP}/lxnav-s80.html": (
        "text/html",
        product_page("LXNAV S80 Vario 80mm", "1720.00", S80_DESC, extra=f'<a href="{MAKER}/wp-content/uploads/manuals/S8x-S10xManualEnglish.pdf">Manual</a>'),
    ),
    f"{SHOP}/krt2.html": ("text/html", product_page("TQ KRT2 Radio", "1495.00", KRT2_DESC)),
    f"{SHOP}/img/p.jpg": ("image/jpeg", ""),
    f"{MAKER}/robots.txt": ("text/plain", "User-agent: *\nAllow: /\n"),
    f"{MAKER}/lxdownloads/manuals/": (
        "text/html",
        page(
            "Manuals",
            "<table><tr><th>Product</th><th>Manual Type</th><th>Language</th><th>Version</th><th>File</th></tr>"
            '<tr><td>S8x, S10x</td><td>User Manual</td><td>English</td><td>9.00</td><td><a href="/wp-content/uploads/manuals/S8x-S10xManualEnglish.pdf">pdf</a></td></tr>'
            '<tr><td>S8x, S10x</td><td>User Manual</td><td>German</td><td>9.00</td><td><a href="/wp-content/uploads/manuals/S8x-S10xManualGerman.pdf">pdf</a></td></tr>'
            '<tr><td>S8x, S10x</td><td>Installation Manual</td><td>English</td><td>2.00</td><td><a href="/wp-content/uploads/manuals/S8x-S10xInstallEnglish.pdf">pdf</a></td></tr>'
            '<tr><td>FlarmView57</td><td>User Manual</td><td>English</td><td>2.56</td><td><a href="/wp-content/uploads/manuals/FlarmView.pdf">pdf</a></td></tr>'
            "</table>",
        ),
    ),
}


# ---------------------------------------------------------------- a tiny PDF writer for fixtures


def _pdf_string(s: str) -> str:
    return "(" + s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")"


def make_pdf(pages: list[list[tuple]]) -> bytes:
    """Pages of drawing commands: ('text', x, y, size, str) and ('line', x1, y1, x2, y2). A4."""
    objs: list[bytes] = []

    def add(b: bytes) -> int:
        objs.append(b)
        return len(objs)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    kids = []
    pages_id = len(objs) + 1 + 2 * len(pages)
    for cmds in pages:
        ops = []
        for c in cmds:
            if c[0] == "text":
                _, x, y, size, s = c
                ops.append(f"BT /F1 {size} Tf {x} {y} Td {_pdf_string(s)} Tj ET")
            else:
                _, x1, y1, x2, y2 = c
                ops.append(f"0.8 w {x1} {y1} m {x2} {y2} l S")
        content = zlib.compress("\n".join(ops).encode("latin-1"))
        cid = add(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(content) + content + b"\nendstream")
        kids.append(add(f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {font} 0 R >> >> /Contents {cid} 0 R >>".encode()))
    assert add(f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()) == pages_id
    cat = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode())
    out = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs):
        offs.append(len(out))
        out += f"{i + 1} 0 obj\n".encode() + o + b"\nendobj\n"
    x = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offs:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root {cat} 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
    return out


def table(x: float, y_top: float, col_w: list[float], rows: list[list[str]], row_h: float = 18) -> list[tuple]:
    """A ruled table, so pdfplumber finds it from its lines."""
    cmds: list[tuple] = []
    width = sum(col_w)
    for r in range(len(rows) + 1):
        y = y_top - r * row_h
        cmds.append(("line", x, y, x + width, y))
    cx = x
    for w in [0, *col_w]:
        cx += w
        cmds.append(("line", cx, y_top, cx, y_top - len(rows) * row_h))
    for r, row in enumerate(rows):
        cx = x
        for w, cell in zip(col_w, row):
            cmds.append(("text", cx + 4, y_top - (r + 1) * row_h + 5, 9, cell))
            cx += w
    return cmds


def install_manual() -> bytes:
    """An installation manual for the S8x/S10x range: a cover, a dimensions page and a pinout."""
    cover = [("text", 72, 760, 20, "S8x / S10x Installation Manual"), ("text", 72, 730, 11, "Version 2.00")]
    dims = [
        ("text", 72, 760, 14, "2 Installation"),
        ("text", 72, 740, 11, "2.1 Dimensions"),
        ("text", 72, 720, 10, "The S100 needs a standard 57 mm panel cut-out: 57 mm hole, four M4 screws."),
        ("text", 72, 705, 10, "The S80 needs an 80 mm hole."),
        ("text", 72, 690, 10, "Depth behind the panel: S100 98 mm, S80 101 mm."),
        ("text", 72, 675, 10, "S100 current consumption: 165 mA at 12 V."),
        ("line", 200, 400, 400, 400),
        ("line", 200, 400, 200, 600),
    ]
    pins = [
        ("text", 72, 760, 14, "2.4 Wiring"),
        ("text", 72, 740, 11, "Connector X1 (RJ45) pin assignment"),
        *table(72, 720, [60, 200], [["Pin", "Function"], ["1", "+12V supply"], ["2", "+12V supply"], ["3", "RS232 TX (output)"], ["4", "RS232 RX (input)"], ["5", "GND"], ["6", "GND"]]),
    ]
    return make_pdf([cover, dims, pins])
