"""Borgelt Instruments: start from the maker's site (listing not yet checked live), plus the
B50 manual known by URL."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="borgelt",
    names=["Borgelt"],
    start_pages=["https://www.borgeltinstruments.com/"],
    hosts=["www.borgeltinstruments.com", "borgeltinstruments.com"],
    seed_manuals=[ManualLink("http://www.borgeltinstruments.com/B50man.pdf", "B50 manual", ["B50"], "English", "user")],
    models=["B50", "B2000"],
)
