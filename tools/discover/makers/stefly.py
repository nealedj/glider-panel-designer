"""SteFly: navigation computers, OpenVario hardware, the LARUS vario and cockpit controls.
Start from the downloads page; the manuals below are known by URL (listing not yet checked live)."""

from .base import MakerAdapter, ManualLink

ADAPTER = MakerAdapter(
    id="stefly",
    names=["SteFly"],
    start_pages=["https://stefly.aero/en/downloads/"],
    hosts=["stefly.aero", "www.stefly.aero"],
    seed_manuals=[
        ManualLink(
            "https://stefly.aero/wp-content/uploads/2026/02/SteFly-Nav_Installation_Operating_Manual_Version1.41_en.pdf",
            "SteFly NAV Installation and Operating Manual 1.41",
            ["NAV 57", "NAV 70"],
            "English",
            "installation",
        ),
        ManualLink(
            "https://stefly.aero/wp-content/uploads/2025/06/Larus_Installation_Operating_Manual_Version1.8_en.pdf",
            "LARUS Installation and Operating Manual 1.8",
            ["LARUS", "LARUS Sensor Unit"],
            "English",
            "installation",
        ),
        ManualLink(
            "https://stefly.aero/wp-content/uploads/2026/05/manual_en_v0-4-1-0.pdf",
            "LARUS Vario Display manual 0.4.1",
            ["LARUS Vario Display"],
            "English",
            "user",
        ),
    ],
    models=["NAV 57", "NAV 70", "OpenVario", "LARUS", "LARUS Sensor Unit", "LARUS Vario Display", "Sensor Board", "Remote Stick", "Rotary Module"],
)
