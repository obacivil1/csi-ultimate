"""اختبارات التصدير الجماعي: تقارير + مشاريع + CSV + فهرس."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "report"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "util"))

from bulk import export_bulk
from project import save as project_save


def _row(code, verdict, sev="high", note="d"):
    return {"code": code, "name": code, "owasp": "A1", "severity": sev,
            "family": "x", "sub_status": 1, "status": "y", "verdict": verdict,
            "note": note, "evidence": "e", "mode": "verify"}


def _rep(target, rows):
    return {"meta": {"tool": "t", "version": "1", "target": target,
                     "host": "h", "mode": "verify",
                     "generated_at": datetime.now(timezone.utc).isoformat(),
                     "snapshot": "x"},
            "summary": {"checks_total": len(rows),
                        "findings": sum(1 for r in rows if r["verdict"]),
                        "by_severity": {"critical": 0, "high": 1,
                                        "medium": 0, "low": 0},
                        "by_family": {}, "score": 3, "grade": "x"},
            "findings": [r for r in rows if r["verdict"]],
            "all_checks": rows}


def test_bulk_two_targets_index_csv_pages(tmp_path):
    r1 = _rep("http://a.test/", [_row("SQLLOGIN", True)])
    r2 = _rep("http://b.test/", [_row("XSSSTORED", True),
                                  _row("SECHDRS", False)])
    out = export_bulk(tmp_path / "bulk", [{"report": r1}, {"report": r2}],
                      researcher="tester")
    assert out["targets"] == 2 and out["findings"] == 2
    assert Path(out["index_html"]).exists() and Path(out["index_md"]).exists()
    csv_txt = Path(out["csv"]).read_text(encoding="utf-8")
    assert csv_txt.startswith("\ufeff"), "BOM للعربية في Excel"
    assert "SQLLOGIN" in csv_txt and "XSSSTORED" in csv_txt
    assert "SECHDRS" not in csv_txt  # غير المؤكدة لا تُصدَّر
    idx = Path(out["index_md"]).read_text(encoding="utf-8")
    assert "http://a.test/" in idx and "http://b.test/" in idx
    assert (tmp_path / "bulk").glob("target_*.html")


def test_bulk_from_project_file(tmp_path):
    rows = [_row("SQLLOGIN", True)]
    p = project_save(tmp_path / "p.json", "http://a.test/", "verify",
                     "loopback", rows, [])
    out = export_bulk(tmp_path / "bulk2", [{"report": str(p)}])
    assert out["targets"] == 1 and out["findings"] == 1


def test_bulk_rejects_garbage():
    import pytest
    with pytest.raises(ValueError):
        export_bulk(Path("."), [{"report": 123}])
