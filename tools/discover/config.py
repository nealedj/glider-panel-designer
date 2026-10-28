"""Discovery configuration, read from a git-ignored TOML file (default: local/discovery.toml).

The retailer's address and page rules live only there, so nothing committed names it.
`tools/discovery.example.toml` shows the format with a placeholder site.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = REPO / "local" / "discovery.toml"
DEFAULT_CACHE = REPO / "cache"

#: Never faster than this, whatever the config says (seconds between requests to one host).
MIN_INTERVAL_S = 1.0


@dataclass
class RetailerConfig:
    base_url: str
    #: Category pages to start from (absolute, or relative to base_url).
    start_pages: list[str]
    #: Regexes for links worth following (category and product pages). Empty: any same-site .html page.
    follow: list[str] = field(default_factory=list)
    #: Regexes for links never to follow (basket, login, search, ...).
    skip: list[str] = field(default_factory=lambda: [r"basket", r"cart", r"login", r"account", r"search", r"\?"])
    #: Map from a regex on the category page URL or breadcrumb text to a catalogue category.
    categories: dict[str, str] = field(default_factory=dict)
    #: Optional CSS selectors that override the generic extraction.
    selectors: dict[str, str] = field(default_factory=dict)
    #: Stop after this many pages per run.
    max_pages: int = 2000

    @property
    def host(self) -> str:
        from urllib.parse import urlparse

        return urlparse(self.base_url).netloc


@dataclass
class Config:
    #: Contact address or URL for the User-Agent. Live requests are refused without it.
    contact: str | None = None
    interval_s: float = MIN_INTERVAL_S
    cache_dir: Path = DEFAULT_CACHE
    #: Re-fetch cached pages older than this many days; None means never (a re-run makes no requests).
    refresh_days: float | None = None
    retailer: RetailerConfig | None = None
    #: Maker adapters to run; empty means all.
    makers: list[str] = field(default_factory=list)

    @property
    def user_agent(self) -> str:
        return f"GliderPanelDesigner-discovery/0.1 (+{self.contact}; catalogue research, 1 req/s, honours robots.txt)"


def load(path: Path | None = None) -> Config:
    path = path or DEFAULT_CONFIG
    if not path.exists():
        return Config()
    data = tomllib.loads(path.read_text("utf-8"))
    r = data.get("retailer")
    retailer = None
    if r:
        retailer = RetailerConfig(
            base_url=r["base_url"],
            start_pages=list(r.get("start_pages", [])),
            follow=list(r.get("follow", [])),
            skip=list(r.get("skip", RetailerConfig.__dataclass_fields__["skip"].default_factory())),  # type: ignore[misc]
            categories=dict(r.get("categories", {})),
            selectors=dict(r.get("selectors", {})),
            max_pages=int(r.get("max_pages", 2000)),
        )
    cache = Path(data["cache_dir"]) if "cache_dir" in data else DEFAULT_CACHE
    return Config(
        contact=data.get("contact"),
        interval_s=max(MIN_INTERVAL_S, float(data.get("interval_s", MIN_INTERVAL_S))),
        cache_dir=cache if cache.is_absolute() else REPO / cache,
        refresh_days=data.get("refresh_days"),
        retailer=retailer,
        makers=list(data.get("makers", [])),
    )
