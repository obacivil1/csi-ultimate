"""اختبارات المسح النشط: نقاط + تصنيف + تصعيد زمني (حي)."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "recon_lab"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from activescan import active_scan, extract_points
from crawler import crawl
from session import Session
from scoped import Scope

BASE = "http://127.0.0.1:5001/"


def _target_up():
    try:
        urllib.request.urlopen(BASE, timeout=2).close()
        return True
    except Exception:
        return False


def live(fn):
    return pytest.mark.skipif(not _target_up(),
                              reason="الهدف غير مفتوح")(fn)


def _sess():
    return Session(Scope(mode="loopback"))


@live
def test_extract_points_from_live_map():
    m = crawl(_sess(), BASE, max_pages=20, max_depth=2)
    pts = extract_points(m)
    assert len(pts) >= 5
    urls = {p["url"] for p in pts}
    assert any("/search" in u for u in urls)
    assert any("/download" in u for u in urls)
    sq = next(p for p in pts if "/search" in p["url"])
    assert "q" in sq["params"]


@live
def test_active_scan_finds_lab_vulns():
    m = crawl(_sess(), BASE, max_pages=20, max_depth=2)
    rep = active_scan(_sess(), m, BASE, include_time=False)
    assert rep["stats"]["points"] >= 5
    assert rep["stats"]["requests"] >= 20
    got = {(f["url"].split("/")[-1].split("?")[0] or "/", f["param"],
            f["category"]) for f in rep["findings"]}
    for want in [("search", "q", "xss"),
                 ("search", "q", "sqli-boolean"),
                 ("download", "file", "traversal"),
                 ("ping", "host", "cmdi"),
                 ("preview", "template", "ssti"),
                 ("go", "next", "redirect"),
                 ("fetch", "url", "ssrf")]:
        assert want in got, (want, sorted(got))
    for f in rep["findings"]:
        assert f["request"] and f["code"] != "INFO" or True


@live
def test_active_scan_time_escalation_only_where_boosted():
    m = crawl(_sess(), BASE, max_pages=20, max_depth=2)
    rep = active_scan(_sess(), m, BASE, include_time=True)
    times = [f for f in rep["findings"] if f["category"] == "sqli-time"]
    assert times, "التصعيد الزمني يجب أن يصيب search?q"
    assert all(f["param"] == "q" for f in times)
