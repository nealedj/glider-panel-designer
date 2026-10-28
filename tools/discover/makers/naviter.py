"""Naviter: downloads, manuals and support page. The site refused the crawler (403) on 2026-10-28."""

from .base import MakerAdapter

ADAPTER = MakerAdapter(
    id="naviter",
    names=["Naviter", "Oudie", "Hyper"],
    start_pages=["https://naviter.com/download-manual-support/", "https://naviter.com/oudie-n/"],
    hosts=["naviter.com", "www.naviter.com", "download.naviter.com"],
    models=["Oudie", "Oudie 4", "Oudie 5", "Oudie N", "Hyper", "Omni"],
)
