"""Write fixtures/discovery/candidates.synthetic.json: the real pipeline run over the
synthetic shop and manual, for the app's Review tab tests. Run from tools/:

    .venv/bin/python tests/write_app_fixture.py
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from conftest import FakeClock, FakeTransport  # noqa: E402
from fakesite import MAKER, PAGES, SHOP, install_manual  # noqa: E402

from discover.config import REPO, Config, RetailerConfig  # noqa: E402
from discover.fetch import Fetcher  # noqa: E402
from discover.pipeline import Seed, run  # noqa: E402

pages = dict(PAGES)
pdf = install_manual()
pages[f"{MAKER}/wp-content/uploads/manuals/S8x-S10xInstallEnglish.pdf"] = ("application/pdf", pdf)
pages[f"{MAKER}/wp-content/uploads/manuals/S8x-S10xManualEnglish.pdf"] = ("application/pdf", pdf)
with tempfile.TemporaryDirectory() as tmp:
    config = Config(contact="maintainer@example.org", cache_dir=Path(tmp), retailer=RetailerConfig(base_url=SHOP + "/", start_pages=["/varios.html"], categories={"vario": "vario", "radio|krt": "radio"}))
    b = run(config, Fetcher(config, FakeTransport(pages), clock=FakeClock()), seeds=[Seed("TQ", "KRT2 Radio", "radio", "TQ KRT2 Radio", reference=True)])
    out = REPO / "fixtures" / "discovery" / "candidates.synthetic.json"
    b.write(out)
    print("wrote", out, out.stat().st_size, "bytes")
