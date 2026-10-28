"""PilotAware: documents page (listing not yet checked live)."""

from .base import MakerAdapter

ADAPTER = MakerAdapter(
    id="pilotaware",
    names=["PilotAware"],
    start_pages=["https://www.pilotaware.com/documents"],
    hosts=["www.pilotaware.com", "pilotaware.com"],
    models=["Rosetta", "Rosetta FX", "Classic"],
)
