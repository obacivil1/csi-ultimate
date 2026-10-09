"""اختبارات تدقيق الحد الأمني: هروب التوجيه + دقة المنفذ."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from scoped import Scope, assert_target_allowed, split_target
from session import Session

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


# ---------------------------------------------------------- المنفذ جزء من النطاق
def test_split_target_ports():
    assert split_target("http://127.0.0.1:5001/x") == ("http", "127.0.0.1", 5001)
    assert split_target("https://a.test/") == ("https", "a.test", 443)
    assert split_target("http://[::1]:5001/") == ("http", "127.0.0.1", 5001)
    with pytest.raises(ValueError):
        split_target("http://a.test:abc/")


def test_authorized_rejects_other_port():
    sc = Scope(mode="authorized", allow=["http://127.0.0.1:5001/"],
               confirm=True)
    sc.check_url("http://127.0.0.1:5001/api/me")  # نفسه مسموح
    with pytest.raises(ValueError):
        sc.check_url("http://127.0.0.1:5002/")  # منفذ آخر مرفوض
    with pytest.raises(ValueError):
        sc.check_url("https://127.0.0.1:5001/")  # مخطط آخر مرفوض


def test_authorized_default_ports():
    assert_target_allowed("http://example.test:80/", ["http://example.test"],
                          True)
    with pytest.raises(ValueError):
        assert_target_allowed("http://example.test:9000/",
                              ["http://example.test"], True)


# ---------------------------------------------------------- هروب التوجيه
@live
def test_redirect_out_of_scope_is_blocked():
    s = Session(Scope(mode="authorized", allow=[BASE], confirm=True))
    with pytest.raises(ValueError):
        s.get(BASE + "go?next=http://127.0.0.1:5002/")


@live
def test_redirect_inside_scope_still_followed():
    s = Session(Scope(mode="authorized", allow=[BASE], confirm=True))
    st, _, body = s.post(BASE + "login",
                         fields={"username": "' OR '1'='1' --",
                                 "password": "x"})
    assert st == 200 and "لوحة التحكم" in body.decode("utf-8", "replace")


@live
def test_loopback_session_blocks_external_redirect():
    from local_scan import Session as LoopSession
    s = LoopSession()
    with pytest.raises(ValueError):
        s.get(BASE + "go?next=https://example.com/")
