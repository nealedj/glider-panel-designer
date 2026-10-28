"""XCVario: the manual is an online HTML document; the downloadable versions come from a
print page. Both are read as text (no tables or drawings)."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="xcvario",
    names=["XCVario", "XC Vario"],
    start_pages=[],
    hosts=["xcvario.com", "www.xcvario.com"],
    seed_manuals=[
        ManualLink("https://xcvario.com/print/print-docs.php?category=pur", "XCVario Pur manual", ["XCVario Pur", "XCVario"], "English", "user"),
        ManualLink("https://xcvario.com/print/print-docs.php?category=vario", "XCVario manual (earlier models)", ["XCVario"], "English", "user"),
    ],
    verified_listing=True,
    models=["XCVario", "XCVario Pur", "XCFlarmView", "XCTouchNav"],
)
