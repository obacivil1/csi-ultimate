"""اختبارات شهادة الجاهزية: معايرة المختبر + خصوصية المصلَّب + البوابات."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from certify import certify_all, certify_gates, certify_lab, certify_stub

LAB = "http://127.0.0.1:5001/"


def _lab_up():
    try:
        urllib.request.urlopen(LAB, timeout=2).close()
        return True
    except Exception:
        return False


def live(fn):
    return pytest.mark.skipif(not _lab_up(),
                              reason="المختبر غير مفتوح")(fn)


def test_gates_all_pass():
    g = certify_gates()
    assert g["pass"] is True, g["checks"]


def test_stub_zero_findings():
    s = certify_stub()
    assert s["pass"] is True, s["detail"]
    assert s["findings"] == 0


@live
def test_lab_calibration():
    lab = certify_lab(LAB)
    assert lab["pass"] is True, lab
    assert lab["errors"] == 0


@live
def test_full_certificate(tmp_path):
    cert = certify_all(LAB, outdir=tmp_path)
    assert cert["verdict"].startswith("جاهز"), cert
    assert Path(cert["file"]).exists()
    import json
    back = json.loads(Path(cert["file"]).read_text(encoding="utf-8"))
    assert back["verdict"] == cert["verdict"]
