"""TQ (KRT2 radios): the known operation and installation manual. The KTX2 product and
download pages link no PDFs (checked 2026-10-28)."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="krt",
    names=["KRT", "TQ", "TQ-Avionics", "Dittel"],
    start_pages=[],
    hosts=["www.tq-group.com"],
    seed_manuals=[
        ManualLink(
            "https://www.tq-group.com/filedownloads/files/products/general_aviation/manuals/KRT2/en/TQ-KRT2-Manual-Englisch-2018.pdf",
            "KRT2 Operation and Installation Manual (2018)",
            ["KRT2", "KRT2-S", "KRT2-L"],
            "English",
            "installation",
        ),
    ],
    models=["KRT2", "KRT2-S", "KRT2-L", "KRT2-F", "KRT2-RC", "KTX2"],
)
