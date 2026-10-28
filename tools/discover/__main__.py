"""Command line: python -m discover <command>  (run from tools/, with the venv active).

  run                 crawl (cached), read maker manuals, write the candidates file
  check-adapters      show what each maker adapter finds on its listing pages
  import-reviewed F   write the Review tab's exported parts into catalogue/parts/
  status              what is in the cache

Nothing is fetched unless --live is given, and --live needs a contact address in
local/discovery.toml. Without --live, only cached pages are used.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config as cfg_mod
from . import makers
from .fetch import Fetcher, NetworkRefused
from .importer import ImportError_, import_bundle
from .pipeline import load_seeds, run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="discover")
    ap.add_argument("--config", type=Path, default=None, help="config file (default local/discovery.toml)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--live", action="store_true", help="fetch pages not yet cached (needs a contact address)")
    r.add_argument("--no-retailer", action="store_true")
    r.add_argument("--no-manuals", action="store_true")
    r.add_argument("--faces", action="store_true", help="cut face images from product photos (local only)")
    r.add_argument("--out", type=Path, default=None)
    c = sub.add_parser("check-adapters")
    c.add_argument("--live", action="store_true")
    i = sub.add_parser("import-reviewed")
    i.add_argument("bundle", type=Path)
    i.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    config = cfg_mod.load(a.config)

    if a.cmd == "run":
        try:
            fetcher = Fetcher(config, live=a.live)
        except NetworkRefused as e:
            print(e, file=sys.stderr)
            return 2
        b = run(config, fetcher, seeds=load_seeds(), crawl_retailer=not a.no_retailer, manuals=not a.no_manuals, faces=a.faces)
        out = a.out or config.cache_dir / "review" / "candidates.json"
        b.write(out)
        print(f"wrote {out} ({fetcher.requests} requests sent, {len(fetcher.skipped_robots)} pages skipped by robots.txt)")
        return 0
    if a.cmd == "check-adapters":
        fetcher = Fetcher(config, live=a.live)
        for ad in makers.ALL:
            try:
                links = ad.listing(fetcher)
                print(f"{ad.id:12} {'verified' if ad.verified_listing else 'unverified':10} {len(links):4} manuals")
            except NetworkRefused:
                print(f"{ad.id:12} not cached (use --live)")
        return 0
    if a.cmd == "import-reviewed":
        try:
            for p in import_bundle(a.bundle, config, dry_run=a.dry_run):
                print(("would write " if a.dry_run else "wrote ") + str(p))
        except ImportError_ as e:
            print(e, file=sys.stderr)
            return 1
        return 0
    if a.cmd == "status":
        http = config.cache_dir / "http"
        metas = list(http.glob("*.json")) if http.exists() else []
        hosts: dict[str, int] = {}
        for m in metas:
            from urllib.parse import urlparse

            h = urlparse(json.loads(m.read_text())["url"]).netloc
            hosts[h] = hosts.get(h, 0) + 1
        print(f"{len(metas)} cached responses")
        for h, n in sorted(hosts.items(), key=lambda x: -x[1]):
            print(f"  {n:5}  {h}")
        print(f"contact address: {'set' if config.contact else 'NOT SET (live runs refused)'}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
