"""uAvionix: start from the maker's site. The site refused the crawler (403) on 2026-10-28."""

from .base import MakerAdapter

ADAPTER = MakerAdapter(
    id="uavionix",
    names=["uAvionix"],
    start_pages=["https://uavionix.com/products/skyecho/"],
    hosts=["uavionix.com", "www.uavionix.com"],
    models=["SkyEcho", "SkyEcho 2"],
)
