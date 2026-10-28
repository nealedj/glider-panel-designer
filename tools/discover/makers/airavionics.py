"""Air Avionics: customer support page and the known traffic display installation manual."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="airavionics",
    names=["Air Avionics", "AIR Avionics"],
    start_pages=["https://www.air-avionics.com/customer-support/"],
    hosts=["www.air-avionics.com", "air-avionics.com"],
    seed_manuals=[
        ManualLink(
            "https://www.air-avionics.com/downloads/atd-air-traffic-displays/ATD_Installation-Manual_v5.1_EN.pdf",
            "AIR Traffic Displays Installation Manual v5.1",
            ["ATD-57", "ATD-80", "ATD-11"],
            "English",
            "installation",
        ),
    ],
    models=["ATD-57", "ATD-80", "ATD-11", "ACD-57", "AT-1", "XPDR", "TRX"],
)
