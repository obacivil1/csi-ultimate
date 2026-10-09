"""اختبارات تصدير PDF الأصلي."""
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "report"))

import pytest

try:
    from pdfexport import _ar, export_pdf
    HAVE_PDF = True
except Exception:
    HAVE_PDF = False

needs_pdf = pytest.mark.skipif(not HAVE_PDF, reason="لا توجد reportlab")


def _rep():
    rows = [{"code": "SQLLOGIN", "name": "حقن SQL في تسجيل الدخول",
             "owasp": "A1", "severity": "critical", "family": "x",
             "sub_status": 1, "status": "y", "verdict": True,
             "note": "دخول دون كلمة مرور", "evidence": "e",
             "mode": "verify"}]
    now = datetime.now(timezone.utc)
    return {"meta": {"tool": "t", "version": "1",
                     "target": "http://127.0.0.1:5001/", "host": "h",
                     "mode": "verify", "generated_at": now.isoformat(),
                     "snapshot": "x"},
            "summary": {"checks_total": 1, "findings": 1,
                        "by_severity": {"critical": 1, "high": 0,
                                        "medium": 0, "low": 0},
                        "by_family": {}, "score": 4, "grade": "x"},
            "findings": rows, "all_checks": rows}


@needs_pdf
def test_ar_shaping_changes_arabic_only():
    assert _ar("تقرير") != "تقرير"
    assert _ar("ABC-123") == "ABC-123"


@needs_pdf
def test_export_pdf_valid_file(tmp_path):
    out = export_pdf(_rep(), str(tmp_path / "r.pdf"), researcher="مختبر")
    data = Path(out).read_bytes()
    assert data.startswith(b"%PDF")
    assert len(data) > 8000, len(data)
