"""اختبارات حصاد JS + الفحص المتوازي."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "recon_lab"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "engine"))

import pytest
from jsharvest import find_secrets, harvest
from crawler import crawl, discover_common
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


# ---------------------------------------------------------- وحدات الأسرار
def test_find_secrets_patterns():
    js = ('const API_KEY = "LABKEY-9f2c";\n'
          'var x = "AKIAIOSFODNN7EXAMPLE";\n'
          'let pwd = "s3cret!";\n'
          'const clean = "hello";\n')
    got = find_secrets(js)
    kinds = {g["kind"] for g in got}
    assert {"api_key", "aws", "password"} <= kinds
    assert all("LABKEY-9f2c" not in g["snippet"] for g in got), \
        "القيمة الكاملة يجب ألا تظهر (تعتيم)"


def test_find_secrets_ignores_short():
    assert find_secrets('var k = "ab";') == []


# ---------------------------------------------------------- حي
@live
def test_harvest_lab_bundle():
    m = crawl(_sess(), BASE, max_pages=10, max_depth=1)
    assert any(s["src"].endswith("/static/app.js") for s in m["scripts"]), \
        "الحزمة يجب أن تُكتشَف من الصفحات"
    rep = harvest(_sess(), m["scripts"], BASE)
    assert rep["files"], "يجب جلب ملف واحد على الأقل"
    appjs = next(f for f in rep["files"] if f["url"].endswith("app.js"))
    assert any("/api/admin" in p for p in appjs["api_paths"]), \
        appjs["api_paths"]
    assert any(g["kind"] == "api_key" for g in appjs["secrets"]), \
        appjs["secrets"]
    assert any("/api/admin" in c for c in rep["candidates"])


@live
def test_parallel_probe_matches_sequential():
    s1, s2 = _sess(), _sess()
    seq = discover_common(s1, BASE, workers=1)
    par = discover_common(s2, BASE, workers=8)
    assert set(seq) == set(par) and len(seq) > 10
    assert any(u.endswith("/upload") for u in par)
