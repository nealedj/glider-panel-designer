from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from discover.config import Config, RetailerConfig  # noqa: E402
from fakesite import MAKER, PAGES, SHOP, install_manual  # noqa: E402


class FakeTransport:
    """Serves the synthetic sites; records every request. Unknown URLs are 404s."""

    def __init__(self, pages: dict[str, tuple[str, str | bytes]]):
        self.pages = pages
        self.calls: list[str] = []

    def __call__(self, url: str, headers: dict[str, str]):
        assert "User-Agent" in headers and "+" in headers["User-Agent"], "the crawler must identify itself"
        self.calls.append(url)
        if url not in self.pages:
            return 404, {"content-type": "text/html"}, b"not found"
        ctype, body = self.pages[url]
        return 200, {"content-type": ctype}, body if isinstance(body, bytes) else body.encode("utf-8")


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0
        self.slept: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.slept.append(s)
        self.t += s


@pytest.fixture
def site():
    pages = dict(PAGES)
    pdf = install_manual()
    pages[f"{MAKER}/wp-content/uploads/manuals/S8x-S10xInstallEnglish.pdf"] = ("application/pdf", pdf)
    pages[f"{MAKER}/wp-content/uploads/manuals/S8x-S10xManualEnglish.pdf"] = ("application/pdf", pdf)
    return FakeTransport(pages)


@pytest.fixture
def config(tmp_path):
    return Config(
        contact="maintainer@example.org",
        cache_dir=tmp_path / "cache",
        retailer=RetailerConfig(
            base_url=SHOP + "/",
            start_pages=["/varios.html"],
            categories={"vario": "vario", "radio|krt": "radio"},
        ),
    )
