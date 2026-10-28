"""Trig Avionics: start from the maker's site (listing not yet checked live)."""

from .base import MakerAdapter

ADAPTER = MakerAdapter(
    id="trig",
    names=["Trig"],
    start_pages=["https://www.trig-avionics.com/"],
    hosts=["www.trig-avionics.com", "trig-avionics.com"],
    models=["TT21", "TT22", "TT31", "TY91", "TY92", "TY96", "TY97", "TN72", "TC20"],
)
