"""اختبارات السكريبت: الرفض الخارجي + شكل التقرير + أنماط الأمان."""
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scanner"))

import pytest
from local_scan import CHECKS, Session, build_report, text
from hostguard import assert_local

TEST_BASE = "http://127.0.0.1:5001/"


def _target_up() -> bool:
    try:
        urllib.request.urlopen(TEST_BASE, timeout=2).close()
        return True
    except Exception:
        return False


@pytest.mark.parametrize("bad", ["http://1.2.3.4/", "http://google.com/"])
def test_session_rejects_external(bad):
    s = Session()
    with pytest.raises(ValueError):
        s.get(bad)


def test_check_registry_shape():
    codes = {c["code"] for c in CHECKS}
    assert codes == {
        "SQLLOGIN", "SQLSEARCH", "XSSREFLECT", "IDOR", "PATH",
        "UPLOAD", "CMDI", "WEAKCOOKIE", "APIAUTH",
        "SQLBLIND", "XSSSTORED", "SSRF", "SSTI", "OPENREDIR",
        "CSRF", "SECHDRS", "SQLTIME",
        "JWTNONE", "JWTWEAK", "NOLOCK", "INFOLEAK",
        "AUTHENUM", "SESSFIX",
        "GRAPHQL", "NOSQLI", "FRAMING",
        "XSSATTR", "XSSJS", "XSSPOLY", "CSPWEAK",
        "XXE", "LFI", "MASSASSIGN", "CORSLAB",
    }
    for c in CHECKS:
        assert c["severity"] in {"critical", "high", "medium", "low", "info"}


def test_build_report_consistency():
    rows = [{
        "code": "X", "name": "n", "owasp": "A1:Injection", "severity": "high",
        "family": "injection", "sub_status": 1, "status": "ضعف مؤكد",
        "verdict": True, "note": "d", "evidence": "e", "mode": "verify",
    }]
    rep = build_report(rows, TEST_BASE, "127.0.0.1:5001", "verify",
                       __import__("datetime").datetime.now().astimezone())
    assert rep["summary"]["findings"] == 1
    assert rep["summary"]["score"] == 3  # high
    assert rep["summary"]["grade"] == "متوسطة"


def test_report_json_serializable():
    rows = [{
        "code": "X", "name": "n", "owasp": "A1", "severity": "critical",
        "family": "x", "sub_status": 1, "status": "y", "verdict": True,
        "note": "d", "evidence": "e", "mode": "full",
    }]
    rep = build_report(rows, TEST_BASE, "127.0.0.1:5001", "full",
                       __import__("datetime").datetime.now().astimezone())
    json.dumps(rep, ensure_ascii=False)


def test_live_scan_verify_mode():
    if not _target_up():
        pytest.skip("الهدف المحلي غير مفتوح — شغّل: python local-lab/target/app.py")
    from local_scan import run
    rep = run(TEST_BASE, mode="verify")
    # في verify نؤكد على الأقل فحص auth bypass + IDOR (وضع لاحق يعتمد على الأهداف)
    kills = {c["code"] for c in rep["all_checks"] if c["verdict"]}
    assert "SQLLOGIN" in kills  # admin/... يُثبَت عبر الاستعلام المكسور
    assert TEST_BASE in rep["meta"]["target"]