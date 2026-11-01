"""Write (or extend) a candidates file with a product that has no candidates yet, so its
documents can be reviewed with manual entries and built like any other product.

Usage: python3 -I <this> <candidates.json> --maker LXNAV --model ADI2 --category instrument \
         --doc <maker url> [--doc <maker url>=<local file> ...] [--name ...] [--variant ...] [--reference]

A --doc without a local file must already be in cache/http/ (fetch it with fetch_one.py). A
--doc with a local file (one the user supplied) becomes a `user` source citing the maker URL.
An existing candidates file is extended, not replaced.
"""
import argparse, hashlib, json, re
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("--maker", required=True); ap.add_argument("--model", required=True)
ap.add_argument("--category", required=True); ap.add_argument("--name"); ap.add_argument("--variant")
ap.add_argument("--reference", action="store_true"); ap.add_argument("--doc", action="append", default=[])
a = ap.parse_args()

cached = {json.loads(m.read_text())["url"]: json.loads(m.read_text()) for m in (REPO / "cache/http").glob("*.json")}
out = Path(a.out)
d = json.loads(out.read_text("utf-8")) if out.exists() else {
    "kind": "gpd-candidates", "schemaVersion": 1, "generated": datetime.now(timezone.utc).isoformat(), "sources": [], "products": []}
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
key = ".".join(filter(None, [slug(a.maker), slug(a.model), slug(a.variant or "")]))
if any(p["key"] == key for p in d["products"]):
    raise SystemExit(f"{key} is already in {out}")

manuals = []
for doc in a.doc:
    url, _, local = doc.partition("=")
    url = re.sub(r"\?v=[^&]*$", "", url)
    sid = ("u:" if local else "m:") + hashlib.sha1(url.encode()).hexdigest()[:10]
    if not local and url not in cached:
        raise SystemExit(f"not cached; fetch it first: {url}")
    title = Path(url).name
    src = {"id": sid, "kind": "user" if local else "manual", "url": url, "title": title, "makerHosted": True,
           "fetchedAt": None if local else cached[url].get("fetched_at")}
    if local:
        src["localFile"] = str(Path(local).resolve())
    if sid not in {s["id"] for s in d["sources"]}:
        d["sources"].append(src)
    manuals.append({"source": sid, "url": url, "title": title, "pages": None})

d["products"].append({"key": key, "maker": a.maker, "model": a.model, "name": a.name or f"{a.maker} {a.model}",
                      "category": a.category, "variant": a.variant, "reference": a.reference,
                      "candidates": [], "drawings": [], "manuals": manuals})
out.write_text(json.dumps(d, indent=1, ensure_ascii=False))
print(f"{key}: {len(manuals)} documents -> {out}")
