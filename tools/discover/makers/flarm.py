"""FLARM: downloads page (found from the home page on 2026-10-28), plus known PDFs."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="flarm",
    names=["FLARM", "PowerFLARM"],
    start_pages=["https://www.flarm.com/support/downloads/"],
    hosts=["www.flarm.com", "flarm.com"],
    seed_manuals=[
        ManualLink(
            "https://www.flarm.com/wp-content/uploads/2024/03/FTD-077-PowerFLARM-Fusion-Installation-Manual.pdf",
            "PowerFLARM Fusion Installation Manual",
            ["PowerFLARM Fusion"],
            "English",
            "installation",
        ),
        ManualLink(
            "https://www.flarm.com/wp-content/uploads/2024/04/FLARM_InstallationManual_Legacy_v5.00_EN.pdf",
            "FLARM Installation Manual (legacy devices) 5.00",
            ["Classic FLARM"],
            "English",
            "installation",
        ),
    ],
    models=["PowerFLARM Flex", "Flex", "Classic FLARM", "PowerFLARM Fusion", "PowerFLARM Core", "PowerFLARM Portable", "Fusion", "Core", "Atom", "AtomUAV"],
)
