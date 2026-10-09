"""مراجعة ذاتية: أداتنا تدقق كودنا (لا أسرار خارج الهدف المقصود)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "recon_lab"))
sys.path.insert(0, str(ROOT / "scanner"))

from jsharvest import find_secrets

# بيانات اختبار مقصودة لكاشف الأسرار نفسه (ليست أسرارًا حقيقية).
ALLOW = {
    ("tests/test_jsharvest.py", "api_key"),
    ("tests/test_jsharvest.py", "aws"),
    ("tests/test_jsharvest.py", "password"),
    ("tests/test_authorized.py", "aws"),  # مفتاح AWS المثال الرسمي (غير حقيقي)
}


def test_no_secrets_outside_target():
    bad = []
    for p in sorted((ROOT).rglob("*.py")):
        if "target" in p.parts or "__pycache__" in p.parts:
            continue
        rel = p.relative_to(ROOT).as_posix()
        for g in find_secrets(p.read_text(encoding="utf-8")):
            if (rel, g["kind"]) not in ALLOW:
                bad.append((rel, g["kind"], g["line"]))
    assert bad == [], f"أسرار مكتشفة في كود المنتج: {bad}"


def test_html_reports_escape_injection():
    sys.path.insert(0, str(ROOT / "report"))
    from bounty import to_html, build_cards
    from datetime import datetime, timezone
    evil = '<script>alert(9)</script>'
    rep = {"meta": {"tool": "t", "version": "1",
                    "target": "http://x/?q=" + evil,
                    "host": "h", "mode": "verify",
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "snapshot": "x"},
           "summary": {"checks_total": 1, "findings": 1,
                       "by_severity": {"critical": 1, "high": 0,
                                       "medium": 0, "low": 0},
                       "by_family": {}, "score": 4, "grade": "x"},
           "findings": [{"code": "X", "name": evil, "owasp": "A1",
                         "severity": "critical", "family": "x",
                         "sub_status": 1, "status": "y", "verdict": True,
                         "note": evil, "evidence": "e", "mode": "verify"}],
           "all_checks": []}
    rep["all_checks"] = rep["findings"]
    ht = to_html(rep, build_cards(rep), researcher=evil)
    assert "<script>alert(9)</script>" not in ht
    assert "&lt;script&gt;" in ht
