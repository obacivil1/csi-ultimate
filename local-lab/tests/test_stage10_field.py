"""اختبارات وحدات حقل التجارب (XXE/LFI/تعيين/CORS) حية على المختبر."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from local_scan import CHECKS, run_check
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


def _sess():
    return Session(Scope(mode="loopback"))


def _run(code, mode="verify"):
    m = next(x for x in CHECKS if x["code"] == code)
    return run_check(m, _sess(), BASE, mode)


@live
def test_xxe_reads_file():
    assert _run("XXE")["verdict"] is True


@live
def test_lfi_reads_source():
    assert _run("LFI")["verdict"] is True


@live
def test_massassign_escalates_and_cleans():
    assert _run("MASSASSIGN")["verdict"] is True
    # التنظيف مثبت من القرص: omari عاد مستخدمًا عاديًا
    import sqlite3
    conn = sqlite3.connect(str(ROOT / "data" / "lab.db"))
    try:
        flag = conn.execute("SELECT is_admin FROM users WHERE username=?",
                            ("omari",)).fetchone()[0]
    finally:
        conn.close()
    assert flag == 0


@live
def test_corslab_reflects():
    assert _run("CORSLAB")["verdict"] is True


@live
def test_detect_modes_stay_quiet():
    for code in ("XXE", "MASSASSIGN"):
        r = _run(code, mode="detect")
        assert r["verdict"] is False
