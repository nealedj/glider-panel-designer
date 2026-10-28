"""A polite, caching HTTP fetcher.

- Obeys robots.txt (cached per host), including Crawl-delay when it is longer than ours.
- At most one request per `interval_s` to each host.
- Every response is cached on disk with its fetch date; a cached URL is not requested again
  unless it is older than `refresh_days`. A re-run therefore makes no repeat requests, and an
  interrupted run resumes by replaying the cache.
- Live requests need a contact address in the config and an explicit `live=True`; tests pass
  a fake transport and never touch the network.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
import urllib.robotparser
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Protocol
from urllib.parse import urljoin, urlparse

from .config import Config

#: (url, headers) -> (status, response headers, body)
Transport = Callable[[str, dict[str, str]], tuple[int, dict[str, str], bytes]]


class Clock(Protocol):
    def now(self) -> float: ...
    def sleep(self, s: float) -> None: ...


class RealClock:
    def now(self) -> float:
        return time.monotonic()

    def sleep(self, s: float) -> None:
        time.sleep(s)


class NetworkRefused(RuntimeError):
    pass


@dataclass
class Response:
    url: str
    status: int
    content_type: str
    body: bytes
    fetched_at: str
    from_cache: bool

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


def urllib_transport(timeout: float = 30.0) -> Transport:
    def get(url: str, headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - http(s) only, checked below
                return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
        except urllib.error.HTTPError as e:
            return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read() if e.fp else b""

    return get


class Fetcher:
    def __init__(self, config: Config, transport: Transport | None = None, *, live: bool = False, clock: Clock | None = None):
        self.config = config
        self.live = live
        if transport is None:
            if live and not config.contact:
                raise NetworkRefused("No contact address in local/discovery.toml; the crawler must identify itself before making live requests.")
            transport = urllib_transport() if live else _offline
        self.transport = transport
        self.clock = clock or RealClock()
        self.dir = config.cache_dir / "http"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        #: Requests actually sent this run (cache hits are not counted).
        self.requests = 0
        self.skipped_robots: list[str] = []

    # -------------------------------------------------------------- cache

    def _paths(self, url: str) -> tuple[Path, Path]:
        h = hashlib.sha1(url.encode("utf-8")).hexdigest()
        return self.dir / f"{h}.bin", self.dir / f"{h}.json"

    def cached(self, url: str) -> Response | None:
        body_p, meta_p = self._paths(url)
        if not meta_p.exists():
            return None
        meta = json.loads(meta_p.read_text("utf-8"))
        if self.config.refresh_days is not None:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(meta["fetched_at"])
            if age.total_seconds() > self.config.refresh_days * 86400:
                return None
        return Response(meta["url"], meta["status"], meta.get("content_type", ""), body_p.read_bytes() if body_p.exists() else b"", meta["fetched_at"], True)

    def _store(self, url: str, status: int, content_type: str, body: bytes) -> Response:
        body_p, meta_p = self._paths(url)
        fetched = datetime.now(timezone.utc).isoformat(timespec="seconds")
        body_p.write_bytes(body)
        meta_p.write_text(json.dumps({"url": url, "status": status, "content_type": content_type, "fetched_at": fetched}), "utf-8")
        return Response(url, status, content_type, body, fetched, False)

    # -------------------------------------------------------------- politeness

    def _wait(self, host: str, interval: float) -> None:
        last = self._last.get(host)
        if last is not None:
            gap = self.clock.now() - last
            if gap < interval:
                self.clock.sleep(interval - gap)
        self._last[host] = self.clock.now()

    def _send(self, url: str) -> tuple[int, dict[str, str], bytes]:
        host = urlparse(url).netloc
        self._wait(host, max(self.config.interval_s, self._crawl_delay(host)))
        res = self.transport(url, {"User-Agent": self.config.user_agent, "Accept-Language": "en"})
        self.requests += 1
        return res

    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser | None:
        p = urlparse(url)
        host = p.netloc
        if host not in self._robots:
            robots_url = f"{p.scheme}://{host}/robots.txt"
            hit = self.cached(robots_url)
            if hit is None:
                status, headers, body = self._send(robots_url)
                hit = self._store(robots_url, status, headers.get("content-type", ""), body)
            rp = urllib.robotparser.RobotFileParser()
            if hit.status >= 400:
                # No robots.txt (4xx): everything is allowed. 5xx would be handled the same by most crawlers.
                rp.parse([])
            else:
                rp.parse(hit.text().splitlines())
            self._robots[host] = rp
        return self._robots[host]

    def _crawl_delay(self, host: str) -> float:
        rp = self._robots.get(host)
        if not rp:
            return 0.0
        d = rp.crawl_delay(self.config.user_agent)
        return float(d) if d else 0.0

    def allowed(self, url: str) -> bool:
        rp = self._robots_for(url)
        return rp is None or rp.can_fetch(self.config.user_agent, url)

    # -------------------------------------------------------------- public

    def get(self, url: str) -> Response | None:
        """The page at `url`, from the cache when there; None if robots.txt forbids it."""
        if urlparse(url).scheme not in ("http", "https"):
            raise ValueError(f"not an http(s) URL: {url}")
        hit = self.cached(url)
        if hit is not None:
            return hit
        if not self.allowed(url):
            self.skipped_robots.append(url)
            return None
        status, headers, body = self._send(url)
        return self._store(url, status, headers.get("content-type", ""), body)


def _offline(url: str, headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
    raise NetworkRefused(f"Offline: {url} is not in the cache. Run with --live (and a contact address) to fetch it.")


def absolute(base: str, href: str) -> str:
    return urljoin(base, href).split("#")[0]
