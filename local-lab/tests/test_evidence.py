"""اختبارات التقاط الأدلة: تفويض شفاف + دليل PoC حقيقي لكل فحص."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from evidence import RecordingSession, run_check_evidence
from local_scan import CHECKS
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


def test_wrapper_delegates_guard_jar_cookies():
    s = _sess()
    rec = RecordingSession(s)
    rec._guard(BASE)  # لا يرفع
    with pytest.raises(ValueError):
        rec._guard("http://example.com/")
    assert rec.jar is s.jar
    assert rec.cookies() == []


@live
def test_evidence_login_shows_post_and_redirect():
    meta = next(m for m in CHECKS if m["code"] == "SQLLOGIN")
    row, ev = run_check_evidence(meta, _sess(), BASE, "verify")
    assert row["verdict"] is True
    first_line = ev["request"].splitlines()[0]
    assert first_line.startswith("POST ") and "/login" in first_line
    assert "username=" in ev["request"]
    assert ev["exchanges"] >= 1 and ev["time_ms"] >= 0


@live
def test_evidence_xss_contains_payload_both_sides():
    meta = next(m for m in CHECKS if m["code"] == "XSSREFLECT")
    row, ev = run_check_evidence(meta, _sess(), BASE, "verify")
    assert row["verdict"] is True
    assert "search?q=" in ev["request"]
    assert "<b>" in ev["response"]


@live
def test_evidence_openredir_no_follow_path():
    meta = next(m for m in CHECKS if m["code"] == "OPENREDIR")
    row, ev = run_check_evidence(meta, _sess(), BASE, "verify")
    assert row["verdict"] is True
    first_line = ev["request"].splitlines()[0]
    assert first_line.startswith("GET ") and "/go?next=" in first_line
    assert "example.com" in ev["response"]


@live
def test_evidence_upload_multipart_documented():
    meta = next(m for m in CHECKS if m["code"] == "UPLOAD")
    row, ev = run_check_evidence(meta, _sess(), BASE, "verify")
    assert row["verdict"] is True
    assert "multipart" in ev["request"] and "probe_local.htm" in ev["request"]
    assert "LOCAL-OK" in ev["response"] and ev["exchanges"] >= 2
