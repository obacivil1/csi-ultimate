"""اختبارات XSS السياقات + CSP — حية ضد الهدف."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from local_scan import CHECKS, run_check
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


def _run(code, mode="verify"):
    meta = next(m for m in CHECKS if m["code"] == code)
    return run_check(meta, Session(Scope(mode="loopback")), BASE, mode)


@live
def test_xss_attr_breaks_value():
    r = _run("XSSATTR")
    assert r["verdict"] is True, r["note"]
    assert _run("XSSATTR", "detect")["verdict"] is False


@live
def test_xss_js_breaks_string():
    r = _run("XSSJS")
    assert r["verdict"] is True, r["note"]
    assert _run("XSSJS", "detect")["verdict"] is False


@live
def test_xss_polyglot_raw():
    r = _run("XSSPOLY")
    assert r["verdict"] is True, r["note"]
    assert _run("XSSPOLY", "detect")["verdict"] is False


@live
def test_cspweak_flags_unsafe_inline():
    r = _run("CSPWEAK")
    assert r["verdict"] is True, r["note"]
    assert "unsafe-inline" in r["note"]
    assert _run("CSPWEAK", "detect")["verdict"] is True


def test_maps_cover_new_codes():
    sys.path.insert(0, str(ROOT / "report"))
    from bounty import CWE, FIXES
    from cvss import suggest
    for code in ("XSSATTR", "XSSJS", "XSSPOLY", "CSPWEAK"):
        assert code in CWE and code in FIXES
        s, _, vec = suggest(code)
        assert 0.0 < s <= 10.0 and vec.startswith("CVSS:3.1/")
