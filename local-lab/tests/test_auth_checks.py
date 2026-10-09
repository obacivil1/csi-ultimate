"""اختبارات فحوصات المصادقة والأخطاء (JWT/NOLOCK/INFOLEAK) — حية."""
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
def test_jwt_none_forges_admin():
    r = _run("JWTNONE")
    assert r["verdict"] is True, r["note"]
    assert r["severity"] == "high"
    assert _run("JWTNONE", "detect")["verdict"] is False


@live
def test_jwt_weak_cracked_offline():
    r = _run("JWTWEAK")
    assert r["verdict"] is True, r["note"]
    assert "secret123" in r["note"]
    assert _run("JWTWEAK", "detect")["verdict"] is False


@live
def test_nolock_open_guessing():
    r = _run("NOLOCK")
    assert r["verdict"] is True, r["note"]
    assert _run("NOLOCK", "detect")["verdict"] is False


@live
def test_infoleak_in_both_modes():
    assert _run("INFOLEAK")["verdict"] is True
    assert _run("INFOLEAK", "detect")["verdict"] is True


def test_new_codes_in_report_maps():
    sys.path.insert(0, str(ROOT / "report"))
    from bounty import CWE, FIXES
    from cvss import suggest
    for code in ("JWTNONE", "JWTWEAK", "NOLOCK", "INFOLEAK"):
        assert code in CWE and code in FIXES
        s, _, vec = suggest(code)
        assert 0.0 < s <= 10.0 and vec.startswith("CVSS:3.1/")
