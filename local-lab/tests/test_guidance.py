"""اختبارات مدرسة النتائج: تغطية الدروس + التقدم + نص البطاقة."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "learn"))
sys.path.insert(0, str(ROOT / "gui"))
sys.path.insert(0, str(ROOT / "report"))
sys.path.insert(0, str(ROOT / "scanner"))

from guidance import GUIDE, LEVELS, TRACK, guide_for, load_progress, save_progress
from impact import card_text


def test_guide_covers_generic_and_deep():
    from generic import GENERIC_CHECKS
    from deep import DEEP_CHECKS
    codes = [m["code"] for m in GENERIC_CHECKS + DEEP_CHECKS]
    assert len(codes) == 19
    missing = [c for c in codes if c not in GUIDE]
    assert missing == []
    for c in codes:
        g = GUIDE[c]
        assert g["title"] and g["simple"] and g["why"] and g["fix"], c
        assert g["level"] in LEVELS, c
        assert len(g["verify"]) >= 2, c


def test_track_partitions_all_guides():
    in_track = [c for _, codes in TRACK for c in codes]
    assert sorted(in_track) == sorted(GUIDE)
    assert [t for t, _ in TRACK] and len(TRACK) == 3


def test_guide_for_lab_and_unknown():
    g = guide_for("SQLLOGIN")
    assert g["code"] == "SQLLOGIN" and g["fix"], g
    u = guide_for("NOPE-X")
    assert u["title"] and u["verify"]


def test_progress_roundtrip(tmp_path):
    p = tmp_path / "g.json"
    assert load_progress(path=p) == set()
    save_progress({"G-CSP", "D-SSTI"}, path=p)
    assert load_progress(path=p) == {"G-CSP", "D-SSTI"}
    save_progress(set(), path=p)
    assert load_progress(path=p) == set()


def test_card_text_complete():
    row = {"code": "G-XSSPARAM", "name": "انعكاس", "owasp": "A3",
           "severity": "medium", "verdict": True, "note": "ن",
           "evidence": "ش", "mode": "verify"}
    t = card_text(row)
    assert "G-XSSPARAM" in t and "ن" in t
    assert "تملك الآن" in t and "التالي ضمن التفويض" in t and "الباونتي" in t
    assert "غير مؤكدة" in card_text({**row, "verdict": False})
