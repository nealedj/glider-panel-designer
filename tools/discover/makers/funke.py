"""f.u.n.k.e. AVIONICS: start from the maker's site (listing not yet checked live; some
documents may be behind a customer portal)."""

from .base import MakerAdapter

ADAPTER = MakerAdapter(
    id="funke",
    names=["f.u.n.k.e.", "funke", "FUNKE"],
    start_pages=["https://www.funkeavionics.de/"],
    hosts=["www.funkeavionics.de", "funkeavionics.de"],
    models=["ATR833", "ATR833-II", "ATR833S", "ATR833A", "TRT800", "TRT800H", "ATR500", "ACD57", "ASI57"],
)
