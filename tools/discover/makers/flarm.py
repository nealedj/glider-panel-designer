"""FLARM: manuals and documents page (listing not yet checked live), plus known PDFs."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="flarm",
    names=["FLARM", "PowerFLARM"],
    start_pages=["https://www.flarm.com/support/manuals-documents/"],
    hosts=["www.flarm.com", "flarm.com"],
    seed_manuals=[
        ManualLink(
            "https://www.flarm.com/wp-content/uploads/2024/03/FTD-077-PowerFLARM-Fusion-Installation-Manual.pdf",
            "PowerFLARM Fusion Installation Manual",
            ["PowerFLARM Fusion"],
            "English",
            "installation",
        ),
    ],
    models=["PowerFLARM Fusion", "PowerFLARM Core", "PowerFLARM Portable", "Fusion", "Core", "Atom", "AtomUAV"],
)
