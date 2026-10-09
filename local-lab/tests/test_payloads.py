"""اختبارات مكتبة الحمولات وقوائم الكلمات."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "recon_lab"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from payloads import (PAYLOADS, boolean_pairs, categories, get,
                      load_wordlist, sqlite_fast_payload,
                      sqlite_time_payload)


def test_categories_nonempty_and_clean():
    assert len(categories()) >= 10
    for cat in categories():
        items = get(cat)
        assert items, cat
        for p in items:
            assert isinstance(p, str) and p.strip(), (cat, p)


def test_get_rejects_unknown():
    with pytest.raises(ValueError):
        get("nope")


def test_boolean_pairs_shape():
    pairs = boolean_pairs()
    assert pairs and all(len(p) == 2 for p in pairs)


def test_sqlite_time_payload_embeds_n():
    assert "300000" in sqlite_time_payload(300000)
    assert "UNION" in sqlite_time_payload() and "--" in sqlite_fast_payload()


def test_wordlist_loads_and_covers_lab():
    words = load_wordlist("common_paths")
    assert len(words) >= 50
    for must in ("login", "upload", "api/me", ".git/HEAD", "preview", "go"):
        assert must in words, must


def test_wordlist_missing_raises():
    with pytest.raises(ValueError):
        load_wordlist("nope")


def test_crawler_uses_wordlist_file(tmp_path=None):
    import urllib.request
    try:
        urllib.request.urlopen("http://127.0.0.1:5001/", timeout=2).close()
    except Exception:
        pytest.skip("الهدف غير مفتوح")
    from crawler import _wordlist_paths, discover_common
    from session import Session
    from scoped import Scope
    assert len(_wordlist_paths()) >= 50
    found = discover_common(Session(Scope(mode="loopback")),
                            "http://127.0.0.1:5001")
    assert any(u.endswith("/upload") for u in found)
