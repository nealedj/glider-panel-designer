"""Becker Avionics: start from the maker's site. The AR6203 shares the 6200 series manual,
whose listing title names no model."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="becker",
    names=["Becker"],
    start_pages=["https://www.becker-avionics.com/"],
    hosts=["www.becker-avionics.com", "becker-avionics.com"],
    seed_manuals=[
        ManualLink(
            "https://becker-avionics.com/wp-content/uploads/00_Literature/6200_Series_IO_en.pdf",
            "AR/RT/RCU 6200 series Installation and Operation Manual",
            ["AR6201", "AR6203"],
            "English",
            "installation",
        ),
    ],
    models=["AR6201", "AR6203", "AR6201-(022)", "AR6203-(022)"],
)
