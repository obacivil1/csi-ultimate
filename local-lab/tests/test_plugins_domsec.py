"""اختبارات الإضافتين الجديدتين + ثبات المراوغة."""
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "plugins"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "engine"))

import pytest
from loader import discover
from local_scan import run_check
from payloads import get
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
def test_domxss_plugin_finds_lab_flow():
    loaded, errs = discover(ROOT / "plugins" / "checks")
    assert not errs, errs
    m = next(x for x in loaded if x["code"] == "DOMXSS")
    row = run_check(m, _sess(), BASE, "verify")
    assert row["verdict"] is True, row["note"]
    assert "innerHTML" in row["note"]


@live
def test_jssecrets_plugin_finds_lab_key():
    loaded, _ = discover(ROOT / "plugins" / "checks")
    m = next(x for x in loaded if x["code"] == "JSSECRET")
    row = run_check(m, _sess(), BASE, "verify")
    assert row["verdict"] is True, row["note"]
    assert "LABKEY" not in row["note"], "القيمة الكاملة يجب ألا تتسرب"


@live
def test_sqli_evasion_variants_still_bypass():
    for pl in get("sqli_evasion"):
        s = _sess()
        st, _, body = s.post(
            BASE + "login",
            fields={"username": pl, "password": "x"})
        txt = body.decode("utf-8", "replace")
        assert st in (200, 302) and \
            ("لوحة التحكم" in txt or "dashboard" in txt), pl


@live
def test_xss_evasion_variants_still_reflect():
    for pl in get("xss_evasion"):
        st, _, body = _sess().get(
            BASE + "search?q=" + urllib.parse.quote(pl))
        txt = body.decode("utf-8", "replace")
        assert st == 200 and pl in txt, pl
