"""اختبارات المرحلة 3: الفحوصات المتقدمة السبعة (حية ضد الهدف)."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from local_scan import CHECKS, fetch_no_follow, run_check, Session

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
    return run_check(meta, Session(), BASE, mode)


@live
def test_sqlblind_boolean_difference():
    assert _run("SQLBLIND")["verdict"] is True
    assert _run("SQLBLIND", "detect")["verdict"] is False


@live
def test_xss_stored_roundtrip():
    assert _run("XSSSTORED")["verdict"] is True


@live
def test_ssrf_self_fetch_and_inner_api():
    assert _run("SSRF", "detect")["verdict"] is True
    assert _run("SSRF")["verdict"] is True


@live
def test_ssti_computes_expression():
    assert _run("SSTI")["verdict"] is True
    assert _run("SSTI", "detect")["verdict"] is False


@live
def test_open_redirect_no_follow():
    st, hdrs, _ = fetch_no_follow(Session(), BASE + "go?next=https://example.com/")
    assert st in (301, 302, 303, 307, 308)
    assert any("example.com" in v for k, v in hdrs if k.lower() == "location")
    assert _run("OPENREDIR")["verdict"] is True


@live
def test_csrf_state_change_without_token():
    assert _run("CSRF")["verdict"] is True


@live
def test_sechdrs_missing_in_both_modes():
    assert _run("SECHDRS")["verdict"] is True
    assert _run("SECHDRS", "detect")["verdict"] is True


@live
def test_sqltime_delay_oracle():
    r = _run("SQLTIME")
    assert r["verdict"] is True, r["note"]
    assert _run("SQLTIME", "detect")["verdict"] is False
