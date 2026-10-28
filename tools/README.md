# Discovery tools (maintainers only)

Python tools that build catalogue **candidates** for review:

- a generic retailer crawler, configured from a git-ignored file in `local/`;
- an adapter for each maker that finds its manuals;
- spec-text and manual parsers.

They write a candidates file that the app's **Review** tab opens. A person accepts or rejects
every value against its source snippet. The Review tab then exports the reviewed parts, and
`import-reviewed` writes them into `catalogue/parts/` for a pull request. See ADR 0011.

## Rules

- **Polite crawling.** Obey robots.txt and site terms, send at most one request a second per
  host, identify with a contact address, and cache everything in `cache/` (git-ignored). A
  re-run sends no requests.
- **What may be committed.** Never commit scraped pages or third-party photos, and never name
  the retailer anywhere committed. Committed catalogue values cite the maker's own documents.
- **Tests** use synthetic fixtures only. Nothing in CI touches a live site.

## Setup

```sh
cd tools
python3 -m venv .venv
.venv/bin/pip install -e '.[test]'
cp discovery.example.toml ../local/discovery.toml   # then fill in contact and retailer
```

## Use

```sh
.venv/bin/python -m discover status              # what is cached; is a contact address set?
.venv/bin/python -m discover check-adapters --live   # what each maker adapter finds
.venv/bin/python -m discover run --live          # crawl, read manuals, write cache/review/candidates.json
.venv/bin/python -m discover run                 # the same from the cache only (no requests)
.venv/bin/python -m discover import-reviewed reviewed-parts-YYYY-MM-DD.json
.venv/bin/python -m pytest -q
```

- `run` reads products from the retailer crawl and from `products.toml`, a committed list
  of names with no values.
- `--no-retailer` skips the shop. Only the maker manuals are read.
- `--faces` cuts face images from product photos into the candidates file. They are for
  local use only.

## Layout

| Module | What it does |
| --- | --- |
| `discover/fetch.py` | Polite, caching HTTP fetcher. It refuses live requests without a contact address. |
| `discover/html.py` | Small HTML tree with a CSS-subset selector. |
| `discover/retailer.py` | Generic shop adapter: Open Graph, schema.org JSON-LD and microdata, plus optional selectors. |
| `discover/specs.py` | Rule-based extraction with snippets, plus model scoping (the S100 trap). |
| `discover/pdf.py` | Manual pages: dimension and pinout pages, pinout tables, and page renders for review. |
| `discover/makers/*.py` | One adapter per maker. A new maker is a new file. |
| `discover/candidates.py`, `pipeline.py` | Product merging, variants and the candidates file. |
| `discover/images.py` | Face crops from product photos (local only). |
| `discover/importer.py` | Checks the reviewed bundle and writes catalogue files. |

`schemas/candidates.schema.json` and `schemas/reviewed-parts.schema.json` are generated from
the app's zod schemas and define the two file formats.
