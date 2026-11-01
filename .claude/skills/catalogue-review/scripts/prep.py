"""Split a candidates file into one review folder per product.

Usage: python3 -I <this> <candidates.json> <out dir> [--only key1,key2]

Each folder gets product.json (indexed candidates, the sources it uses, manuals with a
`localFile`), drawing-*.jpg (pages pre-rendered by the discovery tools) and links to the
cached documents in cache/http/.
"""
import argparse, base64, json, os, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ap = argparse.ArgumentParser()
ap.add_argument("candidates"); ap.add_argument("out"); ap.add_argument("--only", default="")
a = ap.parse_args()
only = {k for k in a.only.split(",") if k}

d = json.loads(Path(a.candidates).read_text("utf-8"))
bodies = {}
for meta in (REPO / "cache/http").glob("*.json"):
    m = json.loads(meta.read_text()); b = meta.with_suffix(".bin")
    if b.exists():
        bodies[m["url"]] = (b, m.get("content_type") or "")
srcs = {s["id"]: s for s in d["sources"]}

for p in d["products"]:
    if only and p["key"] not in only:
        continue
    slug = re.sub(r"[^a-z0-9]+", "-", f"{p['key']}-{p.get('variant') or ''}".lower()).strip("-")
    pd = Path(a.out) / slug; pd.mkdir(parents=True, exist_ok=True)
    drawings = []
    for dr in p.get("drawings", []):
        f = pd / f"drawing-{dr['source'].replace(':', '_')}-p{dr['page']}.jpg"
        f.write_bytes(base64.b64decode(dr["image"].split(",", 1)[1]))
        drawings.append({k: v for k, v in dr.items() if k != "image"} | {"file": str(f)})
    manuals = []
    for m in p.get("manuals", []):
        local = srcs.get(m["source"], {}).get("localFile")
        if not local and m["url"] in bodies:
            b, ct = bodies[m["url"]]
            link = pd / f"manual-{m['source'].replace(':', '_')}{'.pdf' if 'pdf' in ct else '.html'}"
            if not link.exists():
                os.symlink(b.resolve(), link)
            local = str(link)
        manuals.append(m | {"localFile": local})
    used = {c["source"] for c in p["candidates"]} | {m["source"] for m in p.get("manuals", [])}
    info = {k: p.get(k) for k in ("key", "maker", "model", "name", "category", "variant", "variantNote", "reference")}
    info |= {"candidates": [{"index": i, **c} for i, c in enumerate(p["candidates"])],
             "drawings": drawings, "manuals": manuals, "sources": [srcs[s] for s in sorted(used) if s in srcs]}
    (pd / "product.json").write_text(json.dumps(info, indent=1, ensure_ascii=False))
    missing = [m["url"] for m in manuals if not m["localFile"]]
    print(f"{slug}: {len(p['candidates'])} candidates, {len(drawings)} drawings" + (f", NOT CACHED: {missing}" if missing else ""))
