"""اختبارات جسر PortSwigger: روابط صالحة وتغطية كاملة."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "learn"))
sys.path.insert(0, str(ROOT / "scanner"))

from portswigger import ACADEMY, ORDER_STUDY, academy_for
from local_scan import CHECKS


def test_links_wellformed():
    for code, (url, lab) in ACADEMY.items():
        assert lab, code
        if url is not None:
            assert url.startswith("https://portswigger.net/web-security"), \
                (code, url)


def test_covers_all_checks():
    codes = {c["code"] for c in CHECKS}
    assert set(ACADEMY) >= codes, codes - set(ACADEMY)
    for code in codes:
        url, lab = academy_for(code)
        assert lab


def test_study_order_matches_checks():
    codes = {c["code"] for c in CHECKS}
    assert set(ORDER_STUDY) >= codes


def test_unmapped_have_reason():
    bare = [c for c, (u, _) in ACADEMY.items() if u is None]
    assert bare, "يجب توثيق سبب واحد على الأقل"
    for code in ("OPENREDIR", "METHODS"):
        assert code in bare


def test_unknown_code_rejected():
    import pytest
    with pytest.raises(ValueError):
        academy_for("NOPE")
