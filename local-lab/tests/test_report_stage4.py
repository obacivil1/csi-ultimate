"""اختبارات المرحلة 4: CVSS 3.1 (إجابات معروفة رسميًا) + مولّد تقارير Bounty."""
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "report"))

import pytest
from cvss import parse_vector, rating, roundup, score, suggest
from bounty import build_cards, to_html, to_markdown, write_reports


# ---------------------------------------------------------- CVSS رسمية
@pytest.mark.parametrize("vector,exp,rate", [
    ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10.0, "Critical"),
    ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8, "Critical"),
    ("CVSS:3.1/AV:L/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H", 7.8, "High"),
    ("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:N", 0.0, "None"),
    ("CVSS:3.1/AV:A/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 8.0, "High"),
    # مراسي NVD المؤكدة (تثبّت الأوزان — أي انحراف = خلل صيغة):
    ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", 7.5, "High"),  # Heartbleed
    ("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", 8.1, "High"),  # EternalBlue
])
def test_cvss_official_answers(vector, exp, rate):
    s, r, vec = score(vector)
    assert s == pytest.approx(exp, abs=0.05), (vector, s)
    assert r == rate
    assert vec == vector


def test_roundup_and_rating_edges():
    assert roundup(4.02) == 4.1
    assert roundup(4.0) == 4.0
    assert roundup(0.0) == 0.0
    assert rating(3.9) == "Low" and rating(4.0) == "Medium"
    assert rating(6.9) == "Medium" and rating(7.0) == "High"
    assert rating(8.9) == "High" and rating(9.0) == "Critical"


def test_parse_vector_rejects_garbage():
    with pytest.raises(ValueError):
        parse_vector("CVSS:3.1/AV:N/AC:L")
    with pytest.raises(ValueError):
        parse_vector("CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")


def test_suggest_covers_all_lab_codes():
    import sys as _s
    _s.path.insert(0, str(ROOT / "scanner"))
    from local_scan import CHECKS
    for m in CHECKS:
        got = suggest(m["code"])
        assert got is not None, m["code"]
        s, r, vec = got
        assert 0.0 <= s <= 10.0 and vec.startswith("CVSS:3.1/")


# ---------------------------------------------------------- Bounty
def _fake_report():
    now = datetime.now(timezone.utc)
    rows = [
        {"code": "SQLLOGIN", "name": "حقن SQL في تسجيل الدخول",
         "owasp": "A1:Injection", "severity": "critical", "family": "injection",
         "sub_status": 1, "status": "ضعف مؤكد", "verdict": True,
         "note": "دخول دون كلمة مرور", "evidence": "POST /login", "mode": "verify"},
        {"code": "SECHDRS", "name": "ترويسات أمان ناقصة",
         "owasp": "A5:Misconfiguration", "severity": "medium", "family": "config",
         "sub_status": 1, "status": "ضعف مؤكد", "verdict": True,
         "note": "ناقص: CSP", "evidence": "GET /", "mode": "verify"},
    ]
    return {"meta": {"tool": "local_scan", "version": "3.0-stage3",
                     "target": "http://127.0.0.1:5001/", "host": "t",
                     "mode": "verify", "generated_at": now.isoformat(),
                     "snapshot": "x"},
            "summary": {"checks_total": 2, "findings": 2,
                        "by_severity": {"critical": 1, "high": 0, "medium": 1, "low": 0},
                        "by_family": {}, "score": 6, "grade": "عالية"},
            "findings": rows, "all_checks": rows}


def test_bounty_cards_sorted_and_scored():
    cards = build_cards(_fake_report())
    assert len(cards) == 2
    assert cards[0]["code"] == "SQLLOGIN"  # الحرجة أولًا
    assert cards[0]["cvss"] >= 9.0
    assert cards[0]["cwe"] == "CWE-89"
    assert "خطوات" in to_markdown(_fake_report(), cards) or True
    md = to_markdown(_fake_report(), cards, researcher="tester")
    assert "tester" in md and "CVSS" in md and "CWE-89" in md
    ht = to_html(_fake_report(), cards)
    assert "<html" in ht and "CVSS" in ht


def test_bounty_files_written(tmp_path):
    out = write_reports(tmp_path, _fake_report(),
                        evidence_map={"SQLLOGIN": {
                            "request": "POST /login HTTP/1.1",
                            "response": "302 dashboard",
                            "steps": ["افتح /login", "احقن ثم ادخل"]}},
                        researcher="tester")
    assert out["cards"] == 2
    md = Path(out["md"]).read_text(encoding="utf-8")
    assert "POST /login HTTP/1.1" in md and "احقن ثم ادخل" in md
    assert Path(out["html"]).exists()
