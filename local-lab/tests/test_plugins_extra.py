"""اختبارات الإضافتين الجديدتين + مساعد الدخول الآلي."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "plugins"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "engine"))

import pytest
from loader import discover
from local_scan import run_check
from auth import login_form
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


@live
def test_cors_plugin_confirms_wildcard():
    loaded, errs = discover(ROOT / "plugins" / "checks")
    assert not errs, errs
    m = next(x for x in loaded if x["code"] == "CORS")
    row = run_check(m, _sess(), BASE, "verify")
    assert row["verdict"] is True, row["note"]
    assert "*" in row["note"]


@live
def test_hostheader_plugin_confirms_poisoning():
    loaded, _ = discover(ROOT / "plugins" / "checks")
    m = next(x for x in loaded if x["code"] == "HOSTHDR")
    row = run_check(m, _sess(), BASE, "verify")
    assert row["verdict"] is True, row["note"]


@live
def test_auth_helper_good_and_bad_creds():
    ok, msg = login_form(_sess(), BASE, "omari", "user123")
    assert ok is True, msg
    ok2, msg2 = login_form(_sess(), BASE, "omari", "wrong-pass-9")
    assert ok2 is False, msg2
