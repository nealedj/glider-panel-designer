"""Import the reviewed parts the app's Review tab exports, into catalogue/parts/.

Checks before writing:
- each part has an id, a version, a maker and a model;
- every field marked verified has a source URL and its snippet;
- no source is the retailer (its address is only in the local config): committed values
  must cite manufacturer documents (rule 7);
- generic parametric parts are never overwritten.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse

from .config import REPO, Config

CATALOGUE = REPO / "catalogue" / "parts"


class ImportError_(ValueError):
    pass


def check_part(part: dict, retailer_host: str | None) -> list[str]:
    problems = []
    pid = part.get("id", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", pid):
        problems.append(f"bad id {pid!r}")
    if pid.startswith("generic."):
        problems.append(f"{pid}: generic parts are generated, not imported")
    for k in ("maker", "model", "version"):
        if not part.get(k):
            problems.append(f"{pid}: missing {k}")
    for path, src in (part.get("sources") or {}).items():
        url = src.get("url") or ""
        if retailer_host and urlparse(url).netloc.endswith(retailer_host):
            problems.append(f"{pid}: {path} cites the retailer; committed values must cite the maker's documents")
        if src.get("status") == "verified" and (not url or not src.get("snippet")):
            problems.append(f"{pid}: {path} is verified but has no source URL or snippet")
    ds = part.get("datasheet")
    if ds and retailer_host and urlparse(ds).netloc.endswith(retailer_host):
        problems.append(f"{pid}: datasheet link is on the retailer's site")
    return problems


def import_bundle(bundle_path: Path, config: Config, catalogue: Path = CATALOGUE, *, dry_run: bool = False) -> list[Path]:
    bundle = json.loads(bundle_path.read_text("utf-8"))
    if bundle.get("kind") != "gpd-reviewed-parts":
        raise ImportError_("not a reviewed-parts bundle from the Review tab")
    host = config.retailer.host if config.retailer else None
    problems = [p for part in bundle["parts"] for p in check_part(part, host)]
    if problems:
        raise ImportError_("refusing to import:\n  " + "\n  ".join(problems))
    written = []
    for part in bundle["parts"]:
        out = catalogue / f"{part['id']}.json"
        if not dry_run:
            catalogue.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(part, indent=2, ensure_ascii=False) + "\n", "utf-8")
        written.append(out)
    return written
