from __future__ import annotations

import io
import json

import pytest
from PIL import Image, ImageDraw

from discover import html, makers
from discover.candidates import STANDARD_SIZE, Builder, core_model, split_variant
from discover.config import Config
from discover.fetch import Fetcher, NetworkRefused
from discover.images import extract_face
from discover.importer import ImportError_, check_part, import_bundle
from discover.pdf import analyse
from discover.pipeline import Seed, run
from discover.retailer import crawl
from discover.specs import Candidate, Context, extract, model_pattern, pinout_from_rows
from conftest import FakeClock
from fakesite import MAKER, S100_DESC, SHOP, install_manual

# ---------------------------------------------------------------- spec text


def ctx(model="S100", others=("S8", "S10", "S8D", "S80", "S100")):
    return Context("r:1", "https://shop.test/x", model, list(others), base=0.55)


def by_path(cands, path):
    return [c for c in cands if c.path == path]


def test_model_tokens_are_whole():
    assert model_pattern("S10").search("S10 current") and not model_pattern("S10").search("S100 current")
    assert model_pattern("LX 9070").search("the LX9070 needs")
    assert model_pattern("ATD-57").search("ATD 57 display")


def test_s100_trap_is_flagged_not_trusted():
    text = html.parse(S100_DESC).text()
    cands = extract(text, ctx())
    cur = by_path(cands, "power.currentA")
    assert sorted(c.value for c in cur) == [0.11, 0.14]
    for c in cur:
        assert c.confidence < 0.3
        assert "not S100" in c.note
        assert c.snippet.startswith(("S10 current", "S8D current"))
    hole = by_path(cands, "front.cutout")
    assert {"kind": "circle", "d": 57.0} in [c.value for c in hole]
    assert by_path(cands, "weightG")[0].value == 270
    depth = by_path(cands, "rear.depth")
    assert depth[0].value == 98 and "W × H × D" in depth[0].note
    assert by_path(cands, "front.bezel")[0].value == {"kind": "rect", "w": 61.0, "h": 61.0}
    assert by_path(cands, "power.supplyV")[0].value == {"min": 10.0, "max": 32.0}


def test_lines_for_several_models_are_split():
    cands = extract("Depth behind the panel: S100 98 mm, S80 101 mm.", ctx("S100", ("S80",)))
    depth = {c.value: c for c in by_path(cands, "rear.depth")}
    assert depth[98].confidence > 0.8 and depth[98].note is None
    assert depth[101].confidence < 0.3 and "S80" in depth[101].note
    # The snippet is still the whole line, verbatim.
    assert depth[98].snippet == "Depth behind the panel: S100 98 mm, S80 101 mm."


def test_unknown_siblings_are_spotted():
    # S8D is in no adapter's list, but it is clearly not the S100.
    cands = extract("S8D current consumption: 110 mA at 12 V", ctx("S100", ()))
    assert by_path(cands, "power.currentA")[0].confidence < 0.3


def test_units_and_derived_current():
    cands = extract("Power: 2.4 W at 13.8 V. Weight: 0.34 kg. Cut-out 158 x 100 mm.", ctx("KRT2", ()))
    assert by_path(cands, "power.currentA")[0].value == pytest.approx(0.1739, abs=1e-4)
    assert "2.4 W" in by_path(cands, "power.currentA")[0].note
    assert by_path(cands, "weightG")[0].value == 340
    assert by_path(cands, "front.cutout")[0].value == {"kind": "rect", "w": 158.0, "h": 100.0}


def test_connector_names():
    cands = extract("Connects with an RJ45 cable and a D-Sub 9 plug.", ctx("S80", ()))
    assert by_path(cands, "connectors.types")[0].value == ["DSUB 9", "RJ45"]


def test_pinout_table():
    pins = pinout_from_rows([["Pin", "Function"], ["1", "+12V"], ["2", "GND"], ["3", "RS232 TX"], ["4", "RS232 RX"], ["5", "Speaker +"]])
    assert [p["signal"] for p in pins] == ["power", "ground", "serial", "serial", "audio"]
    assert pins[2]["direction"] == "out" and pins[3]["direction"] == "in"
    assert pinout_from_rows([["Weight", "270 g"], ["Depth", "98 mm"], ["Colour", "black"]]) is None


# ---------------------------------------------------------------- html


def test_selectors():
    doc = html.parse('<div class="a b"><p id="x">One <b>two</b></p><meta property="og:image" content="/i.png"></div><span data-k="v">s</span>')
    assert doc.select_one("div.b p#x").text() == "One two"
    assert doc.select_one("meta[property=og:image]@content") == "/i.png"
    assert [n.tag for n in doc.select("[data-k=v], p")] == ["p", "span"]


# ---------------------------------------------------------------- fetching


def test_refuses_live_without_contact(tmp_path):
    with pytest.raises(NetworkRefused):
        Fetcher(Config(cache_dir=tmp_path), live=True)


def test_offline_by_default(config):
    with pytest.raises(NetworkRefused):
        Fetcher(config).get(SHOP + "/varios.html")


def test_robots_rate_limit_and_cache(config, site):
    from conftest import FakeClock

    clock = FakeClock()
    f = Fetcher(config, site, clock=clock)
    assert f.get(SHOP + "/private/x.html") is None
    assert f.skipped_robots == [SHOP + "/private/x.html"]
    a = f.get(SHOP + "/varios.html")
    b = f.get(SHOP + "/varios-2.html")
    assert a.ok and b.ok and not a.from_cache
    # robots.txt, then two pages: at least a second between each request to the host.
    assert clock.slept == [1.0, 1.0]
    f2 = Fetcher(config, site, clock=FakeClock())
    assert f2.get(SHOP + "/varios.html").from_cache
    assert f2.requests == 0


def test_failed_requests_are_skipped_not_cached(config, site):
    # A URL with spaces is encoded before it is requested.
    site.pages[SHOP + "/files/Install%20Manual.pdf"] = ("application/pdf", b"%PDF-1.4")
    real = site.__call__

    def flaky(url, headers):
        if url.endswith("/varios.html"):
            raise TimeoutError("The read operation timed out")
        return real(url, headers)

    f = Fetcher(config, flaky, clock=FakeClock())
    assert f.get(SHOP + "/files/Install Manual.pdf").ok
    assert f.get(SHOP + "/varios.html") is None
    assert f.failed == [(SHOP + "/varios.html", "TimeoutError: The read operation timed out")]
    # Not cached: the next run asks again.
    assert Fetcher(config, site, clock=FakeClock()).get(SHOP + "/varios.html").ok


# ---------------------------------------------------------------- retailer


def test_crawl_finds_products_and_respects_limits(config, site):
    products = crawl(config.retailer, Fetcher(config, site, clock=FakeClock()), log=lambda *_: None)
    names = sorted(p.name for p in products)
    assert names == ["LXNAV S100 Vario 57mm", "LXNAV S80 Vario 80mm", "TQ KRT2 Radio"]
    s100 = next(p for p in products if "S100" in p.name)
    assert (s100.maker, s100.price, s100.currency, s100.category) == ("LXNAV", 1950.0, "GBP", "vario")
    assert s100.image == SHOP + "/img/p.jpg"
    krt = next(p for p in products if "KRT2" in p.name)
    assert krt.maker == "TQ"
    s80 = next(p for p in products if "S80" in p.name)
    assert s80.manual_links[0][0].startswith(MAKER)
    # Never off-site, never the basket, never disallowed pages.
    assert not any("elsewhere" in u or "basket" in u or "/private/" in u for u in site.calls)


# ---------------------------------------------------------------- makers and manuals


def test_lxnav_listing_and_ranking(config, site):
    ad = makers.BY_ID["lxnav"]
    links = ad.listing(Fetcher(config, site, clock=FakeClock()))
    # Four from the synthetic listing page, plus the V8/V80 manual the adapter seeds.
    assert len(links) == 5
    best = ad.manuals_for("S100", links)
    # English only; installation before user manual; the range "S8x, S10x" covers the S100.
    assert [m.url.rsplit("/", 1)[1] for m in best] == ["S8x-S10xInstallEnglish.pdf", "S8x-S10xManualEnglish.pdf"]
    assert ad.manuals_for("FlarmView57", links)[0].url.endswith("FlarmView.pdf")
    assert ad.manuals_for("LX9070", links) == []


def test_manual_pages_values_pinout_and_drawings():
    res = analyse(install_manual(), Context("m:1", MAKER + "/m.pdf", "S100", ["S8", "S80", "S10", "S100"], base=0.75), title="S8x/S10x Installation")
    assert res.pages == 3
    hole = [c for c in res.candidates if c.path == "front.cutout" and c.value == {"kind": "circle", "d": 57.0}]
    assert hole and all(c.page == 2 for c in hole)
    s80hole = [c for c in res.candidates if c.path == "front.cutout" and c.value == {"kind": "circle", "d": 80.0}]
    assert s80hole and all(c.confidence < 0.3 for c in s80hole)
    depth = {c.value: c.confidence for c in res.candidates if c.path == "rear.depth"}
    assert depth[98] > 0.8 and depth[101] < 0.3
    cur = [c for c in res.candidates if c.path == "power.currentA"]
    assert cur[0].value == 0.165 and cur[0].confidence > 0.8
    pin = next(c for c in res.candidates if c.path == "connectors.pinout")
    assert pin.page == 3
    assert pin.value["name"].startswith("Connector X1")
    assert [p["number"] for p in pin.value["pins"]] == ["1", "2", "3", "4", "5", "6"]
    assert [p["signal"] for p in pin.value["pins"]] == ["power", "power", "serial", "serial", "ground", "ground"]
    assert {d["page"] for d in res.drawings} == {2, 3}
    assert all(d["image"].startswith("data:image/jpeg;base64,") for d in res.drawings)


# ---------------------------------------------------------------- the whole run


def test_run_builds_candidates_and_a_rerun_sends_nothing(config, site):
    seeds = [Seed("LXNAV", "FlarmView57", "display")]
    b = run(config, Fetcher(config, site, clock=FakeClock()), seeds=seeds, log=lambda *_: None)
    data = b.to_json()
    assert data["kind"] == "gpd-candidates" and data["schemaVersion"] == 1
    keys = [p["key"] for p in data["products"]]
    assert keys == ["lxnav.flarmview57", "lxnav.s100-vario.57-mm", "lxnav.s80-vario.80-mm", "tq.krt2-radio"]
    s100 = next(p for p in data["products"] if p["key"] == "lxnav.s100-vario.57-mm")
    kinds = {s["id"]: s["kind"] for s in data["sources"]}
    assert {kinds[c["source"]] for c in s100["candidates"]} == {"retailer", "manual"}
    # The manual's value outranks the shop's for the same field.
    cur = [c for c in s100["candidates"] if c["path"] == "power.currentA"]
    assert cur[0]["value"] == 0.165 and kinds[cur[0]["source"]] == "manual"
    assert s100["retail"]["price"] == 1950.0
    assert any(c["path"] == "datasheet" for c in s100["candidates"])
    assert s100["drawings"]
    sent = len(site.calls)
    assert sent > 0
    again = Fetcher(config, site, clock=FakeClock())
    run(config, again, seeds=seeds, log=lambda *_: None)
    assert again.requests == 0 and len(site.calls) == sent


def test_variants_and_models():
    assert split_variant("S100 Vario 57mm") == ("S100 Vario", "57 mm")
    assert core_model("LXNAV S100 Vario 57mm", "LXNAV", ["S10", "S100"]) == "S100"
    b = Builder()
    p1 = b.product("LXNAV", "S100 57mm", "x", None)
    p2 = b.product("LXNAV", "S100 80 mm", "x", None)
    assert p1.key != p2.key and p1.model == p2.model == "S100"


def test_sizes_named_in_one_sentence_make_variants():
    b = Builder()
    sid = b.source("manual", MAKER + "/s.pdf", "S8x/S10x installation manual")

    def cand(path, value, snippet, conf=0.5):
        return Candidate(path, value, snippet, sid, MAKER + "/s.pdf", conf, "test", page=4)

    s100 = b.product("LXNAV", "S100", "LXNAV S100", "vario")
    b.add(s100, [cand("front.cutout", {"kind": "circle", "d": 80.0}, "The LXNAV S8x/10x requires a standard 57 or 80mm cut-out."), cand("weightG", 270, "Weight 270 g")], sid)
    # A range manual lists other models' sizes one per line: not variants of this product.
    lx = b.product("LXNAV", "LX9070", "LXNAV LX9070", "flight-computer")
    b.add(lx, [cand("front.bezel", {"kind": "rect", "w": 61.0, "h": 61.0}, "Vario indicator (57mm V5) 61 x 61 x 42 mm 200 g"), cand("front.bezel", {"kind": "rect", "w": 81.0, "h": 81.0}, "Vario indicator (80mm V80) 81 x 81 x 44 mm 270 g")], sid)
    # Already a variant: left alone.
    b.product("XCVario", "XCVario 57mm", "XCVario", "vario")

    assert b.split_sizes() == [("lxnav.s100", ["lxnav.s100.57-mm", "lxnav.s100.80-mm"])]
    assert set(b.products) == {"lxnav.s100.57-mm", "lxnav.s100.80-mm", "lxnav.lx9070", "xcvario.xcvario.57-mm"}
    v = b.products["lxnav.s100.57-mm"]
    assert v.model == "S100" and v.variant == "57 mm" and len(v.candidates) == 2
    assert "S8x/S10x installation manual, page 4" in v.variant_note and "57 or 80mm" in v.variant_note
    assert next(x for x in b.to_json()["products"] if x["key"] == "lxnav.s100.80-mm")["variantNote"]
    # Both sizes in a bezel line count too.
    assert {int(m[1]) for m in STANDARD_SIZE.finditer("Case dimensions 64x68x35 mm (57 mm) 80x80x35 mm (80 mm)")} == {57, 80}


# ---------------------------------------------------------------- faces


def test_face_from_product_photo():
    im = Image.new("RGB", (400, 300), (250, 250, 250))
    ImageDraw.Draw(im).ellipse((120, 60, 280, 220), fill=(20, 20, 20))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    f = extract_face(buf.getvalue(), bezel_mm=80)
    assert f.shape == "round"
    assert f.px_per_mm == pytest.approx(161 / 80, rel=0.03)
    im2 = Image.new("RGB", (400, 300), (250, 250, 250))
    ImageDraw.Draw(im2).rectangle((100, 50, 260, 210), fill=(30, 30, 30))
    buf = io.BytesIO()
    im2.save(buf, "PNG")
    assert extract_face(buf.getvalue()).shape == "rect"


# ---------------------------------------------------------------- import


def test_import_refuses_retailer_sources(config, tmp_path):
    part = {"id": "lxnav.s100", "version": 1, "maker": "LXNAV", "model": "S100", "sources": {"weightG": {"url": SHOP + "/lxnav-s100.html", "snippet": "Weight: 270 g", "status": "verified"}}}
    assert any("cites the retailer" in p for p in check_part(part, "shop.test"))
    bundle = tmp_path / "b.json"
    bundle.write_text(json.dumps({"kind": "gpd-reviewed-parts", "parts": [part]}))
    with pytest.raises(ImportError_):
        import_bundle(bundle, config, tmp_path / "cat")
    part["sources"]["weightG"]["url"] = MAKER + "/m.pdf"
    bundle.write_text(json.dumps({"kind": "gpd-reviewed-parts", "parts": [part]}))
    out = import_bundle(bundle, config, tmp_path / "cat")
    assert json.loads(out[0].read_text())["id"] == "lxnav.s100"


def test_range_names_cover_the_base_model_and_its_siblings():
    from discover.makers.base import _range_covers

    assert _range_covers("S8x, S10x", "S8") and _range_covers("S8x, S10x", "S80") and _range_covers("S8x, S10x", "S100")
    assert not _range_covers("S8x, S10x", "S7") and not _range_covers("S8x", "S800")
    assert _range_covers("LX80xx", "LX8080")


def test_winter_ties_pdfs_to_the_models_their_page_names():
    from discover.makers.winter import ADAPTER

    ugd = "https://www.winter-instruments.de/_files/ugd/"
    asi = html.parse(f'<h1>Fahrtmesser / Airspeed indicator</h1><p>6 FMS 4 and 7 FMS 4</p><a href="{ugd}a1.pdf">Maßzeichnung</a><a href="{ugd}a2.pdf">Einbau-und Wartungsanweisung</a>')
    every = html.parse(f'<p>4 FGH, 6 FMS, 7 FMS</p><a href="{ugd}b1.pdf">Tabelle</a>')
    links = ADAPTER.read_listing("https://www.winter-instruments.de/fahrtmesser-airspeed-indicator", asi) + ADAPTER.read_listing("https://www.winter-instruments.de/download-service", every)
    hits = ADAPTER.manuals_for("7 FMS", links)
    assert [m.url.rsplit("/", 1)[-1] for m in hits] == ["a1.pdf", "a2.pdf"]
    assert [m.kind for m in hits] == ["drawing", "installation"]
    assert ADAPTER.manuals_for("4 FGH", links) == []
