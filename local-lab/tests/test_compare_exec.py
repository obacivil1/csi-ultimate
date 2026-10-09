"""اختبارات المقارنة + التقرير التنفيذي."""
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "report"))

from compare import compare_reports, to_html as cmp_html, to_markdown as cmp_md
from executive import to_html as exec_html


def _row(code, verdict, sev="high", note="n"):
    return {"code": code, "name": code, "owasp": "A1", "severity": sev,
            "family": "x", "sub_status": 1, "status": "y", "verdict": verdict,
            "note": note, "evidence": "e", "mode": "verify"}


def _rep(target, rows, score=0, grade="x"):
    by = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in rows:
        if r["verdict"] and r["severity"] in by:
            by[r["severity"]] += 1
    return {"meta": {"tool": "t", "version": "1", "target": target,
                     "host": "h", "mode": "verify",
                     "generated_at": datetime.now(timezone.utc).isoformat(),
                     "snapshot": "x"},
            "summary": {"checks_total": len(rows),
                        "findings": sum(1 for r in rows if r["verdict"]),
                        "by_severity": by,
                        "by_family": {}, "score": score, "grade": grade},
            "findings": [r for r in rows if r["verdict"]],
            "all_checks": rows}


def test_compare_new_fixed_persisting_changed():
    a = _rep("t", [_row("A", True), _row("B", True), _row("C", False),
                   _row("D", True, note="old")], score=9, grade="x")
    b = _rep("t", [_row("A", True), _row("B", False), _row("C", True),
                   _row("D", True, note="new")], score=6, grade="y")
    c = compare_reports(a, b, "v1", "v2")
    assert c["new"] == ["C"] and c["fixed"] == ["B"]
    assert c["persisting"] == ["A"] and c["changed"] == ["D"]
    assert c["delta"] == -3
    md = cmp_md(c)
    assert "أُصلح" in md and "v1" in md and "B" in md
    ht = cmp_html(c)
    assert "<table" in ht and "-3" in ht


def test_compare_empty_reports():
    c = compare_reports(_rep("t", []), _rep("t", []))
    assert c["delta"] == 0 and c["matrix"] == []


def test_executive_sections_and_risks():
    rep = _rep("http://x/", [_row("SQLLOGIN", True, "critical"),
                              _row("XSSSTORED", True, "medium")],
               score=7, grade="y")
    ht = exec_html(rep, researcher="tester")
    for marker in ("الملخص الإداري", "مستوى المخاطر", "المنهجية",
                   "جدول النتائج", "التفاصيل التقنية", "إخلاء النطاق",
                   "@media print", "tester", "SQLLOGIN"):
        assert marker in ht, marker
    assert "تتطلب تدخلًا فوريًا" in ht  # صياغة الحرجة


def test_executive_no_findings():
    ht = exec_html(_rep("http://x/", [_row("A", False)]))
    assert "لم تُؤكَّد ثغرات جوهرية" in ht
