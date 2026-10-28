# 0011. Asset discovery: candidates, review and provenance

- Status: accepted
- Date: 2026-10-11

## Context

The catalogue needs real geometry, pinouts and current draw for many parts. Sources:

- a retailer's product pages: what is sold, with free-text specs, photos and prices;
- the makers' manuals: dimension drawings, pinout tables and current draw.

Both are unreliable when read naively. The brief's example is a retailer page for the S100
that quotes current draw for the S10 and S8D. The repo is public:

- the retailer must not be named in it;
- scraped pages and photos must not be committed;
- committed values must cite the maker's documents.

Nothing may count as verified until a person has checked it.

## Decision

- **Two halves joined by a file.** Python tools (maintainers only, offline-capable) write a
  candidates file. The app's Review tab reads it, records decisions in the browser, and
  exports reviewed parts. A Python importer writes those into `catalogue/parts/`. Both
  formats are zod schemas exported to JSON Schema (`schemas/candidates.schema.json`,
  `schemas/reviewed-parts.schema.json`).
- **Polite fetching** (`fetch.py`):
  - obeys robots.txt (cached), including any longer Crawl-delay;
  - waits at least one second between requests to a host;
  - caches every response with its fetch date and never re-requests a cached URL unless
    `refresh_days` says so. A re-run sends nothing, and an interrupted run resumes from the
    cache.
  - Live requests need `--live` and a contact address in the git-ignored config. Without
    them, the fetcher raises before any network call.
- **A generic retailer adapter.** It reads standard metadata (Open Graph `og:*`,
  `product:price:*`, schema.org JSON-LD and microdata) and walks same-site category pages,
  skipping basket, login and search links. Site-specific selectors and the category mapping
  live in `local/discovery.toml`. The committed example uses `retailer.example`.
- **Maker adapters** are small modules. Each declares:
  - where its manuals are listed;
  - its known model names;
  - any seed PDFs.

  A generic walker visits listing pages (same site, limited depth) and ranks PDF links by
  model match: range names like "S10x" cover the S100, English only, installation before
  user manuals. LXNAV overrides the listing reader for its manuals table. Listings not yet
  checked against the live site are marked unverified, and `check-adapters --live` reports
  what each one finds.
- **Rule-based extraction with snippets** (`specs.py`). Every candidate keeps:
  - its verbatim source line;
  - the source and page;
  - an extraction method and a confidence;
  - a note where relevant.

  **Model scoping** handles the S100 trap:
  - A line that names another model (from the adapter's list, or any code sharing our
    prefix, such as S8D on an S100 page) drops to under 0.3 confidence, with a note saying
    which model it names.
  - A line that lists figures for several models ("Depth: S100 98 mm, S80 101 mm") is split
    per model.
- **Manuals** (`pdf.py`, pdfplumber and pypdfium2):
  - pages with dimension or pinout words are mined for candidates;
  - ruled tables with a pin-number column become pinouts, with signal types guessed from the
    function text;
  - those pages are rendered as images in the candidates file, so the reviewer can read
    drawings and type values with a page reference.
- **Review** (the app):
  - The reviewer accepts or rejects each candidate, or enters a value from a named document
    and page with a quoted or described snippet. Pinouts can accept several connectors.
  - Decisions are saved in IndexedDB per candidates file.
  - A product counts as reviewed when every field with candidates has a decision, or when
    the reviewer marks it done.
- **Provenance at export.** Only accepted values are exported, each with its URL and
  snippet, marked verified. A value whose source is on a retailer host is kept for local
  review but left out of the export, and listed as excluded with the reason. The Python
  importer checks this again against the local config's retailer host. It also refuses
  verified values with no snippet, and never overwrites generic parts.
- **Faces** (`images.py`): background removal, crop, round or rectangular, pixels per mm from
  the bezel size. These are local only; the app keeps drawing faces as vectors.

## Alternatives considered

- **An LLM to read specs.** The brief allows it as a fallback. Rules with snippets are
  deterministic and testable, and the reviewer sees exactly where each value came from. An
  LLM fallback for unparsed text is parked.
- **Scrapy or Requests with BeautifulSoup.** These are heavier than this needs. The standard
  library's HTTP client, `robotparser` and `html.parser` cover it, with a 150-line selector
  engine.
- **Camelot or Tabula for tables:** they need Java or Ghostscript. pdfplumber reads ruled
  tables directly and is MIT-licensed.
- **Reviewing in a separate tool.** Reviewing in the app reuses its schemas and part drawing,
  and keeps the decisions out of the repo.

## Consequences

- The acceptance numbers (every reference-panel part reviewed, 20 or more overall) need a live run
  with a contact address and a person reviewing. The tools are ready; see
  `docs/questions.md`.
- Seven of the ten maker listings are still unverified. The first live run with
  `check-adapters` will show which ones need their start pages adjusting.
- Parked: an LLM fallback, a local catalogue overlay so reviewed parts can be used before
  they are merged, and a photo-face display mode.
