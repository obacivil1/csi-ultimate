"""اختبارات محلل سطح الهجوم: وحدات + حي ضد المختبر."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "recon_lab"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "engine"))

import pytest
from attack_surface import analyze, probe_auth
from crawler import crawl
from fingerprint import fingerprint
from headcheck import check_headers
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


def test_empty_map_scores_zero():
    r = analyze({"endpoints": [], "forms": [], "robots": [], "sitemap": []})
    assert r["score"] == 0 and r["grade"] == "ضيق"
    assert r["recommendations"]


def test_sinks_and_forms_scored():
    m = {"endpoints": [BASE + "download?file=x", BASE + "api/ping?host=y"],
         "forms": [{"action": BASE + "upload", "method": "POST",
                    "inputs": [{"name": "file", "type": "file"}]},
                   {"action": BASE + "settings", "method": "POST",
                    "inputs": [{"name": "bio", "type": "text"}]}],
         "robots": [], "sitemap": []}
    r = analyze(m)
    assert any("مصرف خطر: file" in n for n in r["notes"])
    assert any("نموذج رفع" in n for n in r["notes"])
    assert any("بلا رمز" in n for n in r["notes"])
    assert r["score"] >= 6 + 6 + 10 + 4
    assert "q" not in r["params"]


@live
def test_live_lab_surface_is_wide_and_itemized():
    s = Session(Scope(mode="loopback"))
    m = crawl(s, BASE, max_pages=20, max_depth=2)
    fp = fingerprint(s, BASE)
    hc = check_headers(s, BASE)
    paths = ["/", "/dashboard", "/settings", "/upload", "/api/me"]
    full = [BASE.rstrip("/") + p for p in paths]
    am = probe_auth(Session(Scope(mode="loopback")), full)
    assert am[BASE.rstrip("/") + "/dashboard"] == "login-redirect"
    assert am[BASE.rstrip("/") + "/api/me"] == "open"
    from activescan import PARAM_HINTS
    r = analyze(m, fp, hc, am, hints=PARAM_HINTS)
    expect = {"q", "username", "password", "email", "file", "host",
              "template", "next", "url"}
    assert expect <= set(r["params"]), set(r["params"])
    assert any("file" in k for k in r["params"])
    assert any("مصرف خطر" in n for n in r["notes"])
    assert any("ترويسة ناقصة" in n for n in r["notes"])
    assert any("بانر إصدار" in n for n in r["notes"])
    assert any("مسار حساس مفتوح" in n for n in r["notes"])
    assert r["grade"] in ("واسع", "حرج")
    assert r["recommendations"]
    print(f"surface score={r['score']} grade={r['grade']}")
