"""Naviter: downloads, manuals and support page (listing not yet checked live)."""

from .base import MakerAdapter

ADAPTER = MakerAdapter(
    id="naviter",
    names=["Naviter", "Oudie", "Hyper"],
    start_pages=["https://naviter.com/download-manual-support/"],
    hosts=["naviter.com", "www.naviter.com", "download.naviter.com"],
    models=["Oudie", "Oudie 4", "Oudie 5", "Oudie N", "Hyper", "Omni"],
)
