"""Registry of maker adapters. A new maker is a new module here."""

from __future__ import annotations

from . import airavionics, becker, borgelt, flarm, funke, krt, lxnav, naviter, pilotaware, stefly, trig, uavionix, winter, xcvario
from .base import MakerAdapter

ALL: list[MakerAdapter] = [m.ADAPTER for m in (lxnav, flarm, trig, funke, airavionics, naviter, winter, pilotaware, xcvario, krt, borgelt, becker, stefly, uavionix)]
BY_ID = {a.id: a for a in ALL}


def for_product(maker: str | None, name: str) -> MakerAdapter | None:
    for a in ALL:
        if a.matches_maker(maker, name):
            return a
    return None
