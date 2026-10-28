"""Winter Instrumente: start from the maker's site (address and listing not yet checked live)."""

from .base import MakerAdapter

ADAPTER = MakerAdapter(
    id="winter",
    names=["Winter"],
    start_pages=["https://www.winter-instruments.de/"],
    hosts=["www.winter-instruments.de", "winter-instruments.de"],
    models=["6 FMS", "7 FMS", "4 FGH", "5 FGH", "5 STVM", "6 STVM", "QM", "QR", "KS"],
)
