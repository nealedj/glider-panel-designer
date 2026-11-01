"""Fetch one maker document politely, into cache/http/ (robots.txt, contact address, rate limit).

Usage (from tools/): .venv/bin/python -I <this> <url> [<url> ...]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tools"))
from discover.config import load  # noqa: E402
from discover.fetch import Fetcher  # noqa: E402

f = Fetcher(load(), live=True)
for url in sys.argv[1:]:
    r = f.get(url)
    body, _ = f._paths(url)
    if r is None:
        print(f"refused by robots.txt: {url}")
    else:
        print(f"{r.status} {r.content_type} {len(r.body)} bytes -> {body}")
for url, reason in getattr(f, "failed", []):
    print(f"failed: {url}: {reason}")
