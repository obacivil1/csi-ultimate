"""اختبارات ملفات الجلسات + المراقبة (وحدات + حية)."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from profiles import (apply_profile, delete, list_profiles, load, save)
from watch import diff, history, load_latest, norm_note, snapshot, store
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


# ---------------------------------------------------------- profiles
def test_profile_crud_roundtrip(tmp_path):
    save("lab", BASE, "omari", "user123", base_data_dir=str(tmp_path))
    lst = list_profiles(base_data_dir=str(tmp_path))
    assert len(lst) == 1 and lst[0]["username"] == "omari"
    d = load("lab", base_data_dir=str(tmp_path))
    assert d["target"] == BASE and d["login_path"] == "/login"
    assert delete("lab", base_data_dir=str(tmp_path)) is True
    assert list_profiles(base_data_dir=str(tmp_path)) == []


def test_profile_rejects_empty_and_missing(tmp_path):
    with pytest.raises(ValueError):
        save(" ", BASE, "u", "p", base_data_dir=str(tmp_path))
    with pytest.raises(ValueError):
        load("ghost", base_data_dir=str(tmp_path))


@live
def test_profile_apply_good_and_bad(tmp_path):
    save("lab", BASE, "omari", "user123", base_data_dir=str(tmp_path))
    prof = load("lab", base_data_dir=str(tmp_path))
    ok, _ = apply_profile(Session(Scope(mode="loopback")), BASE, prof)
    assert ok is True
    prof["password"] = "bad-9"
    ok2, _ = apply_profile(Session(Scope(mode="loopback")), BASE, prof)
    assert ok2 is False


# ---------------------------------------------------------- watch
def _row(code, verdict, note="n", sev="high"):
    return {"code": code, "verdict": verdict, "note": note,
            "severity": sev}


def test_diff_new_fixed_changed_same():
    old = {"A": {"verdict": True, "severity": "high", "note": "x"},
           "B": {"verdict": True, "severity": "high", "note": "y"},
           "C": {"verdict": False, "severity": "low", "note": "z"}}
    new = {"A": {"verdict": True, "severity": "high", "note": "x"},
           "B": {"verdict": False, "severity": "high", "note": "y"},
           "C": {"verdict": True, "severity": "low", "note": "z"}}
    d = diff(old, new)
    assert d["new"] == ["C"] and d["fixed"] == ["B"] and d["same"] == 1


def test_norm_note_ignores_timings():
    assert norm_note("الثقيل 2.1s مقابل 0.02s") == \
        norm_note("الثقيل 3.7s مقابل 0.05s")
    d = diff(snapshot([_row("SQLTIME", True, "الثقيل 2.1s")]),
             snapshot([_row("SQLTIME", True, "الثقيل 3.7s")]))
    assert d["changed"] == [] and d["same"] == 1


def test_store_load_history_roundtrip(tmp_path):
    rows = [_row("A", True), _row("B", False)]
    p = store(BASE, rows, reports_dir=str(tmp_path))
    assert Path(p).exists()
    latest = load_latest(BASE, reports_dir=str(tmp_path))
    assert latest["target"] == BASE
    assert latest["snapshot"]["A"]["verdict"] is True
    h = history(BASE, reports_dir=str(tmp_path))
    assert len(h) == 1 and h[0]["findings"] == 1


@live
def test_watch_live_round_is_stable():
    from local_scan import CHECKS, run_check
    s = Session(Scope(mode="loopback"))
    rows = [run_check(m, s, BASE, "detect") for m in CHECKS]
    p1 = store(BASE, rows, reports_dir=str(Path(__file__).resolve().parents[1]
                                           / "reports"))
    s2 = Session(Scope(mode="loopback"))
    rows2 = [run_check(m, s2, BASE, "detect") for m in CHECKS]
    d = diff(snapshot(rows), snapshot(rows2))
    assert d["new"] == [] and d["fixed"] == []
    assert Path(p1).exists()
