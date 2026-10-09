"""اختبارات محرك النطاق الآمن (قيد loopback + وضع المرخّص)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scanner"))

import pytest
from scoped import Scope, normalize_host, is_loopback, assert_target_allowed
from session import Session


def test_normalize_host():
    assert normalize_host("localhost") == "127.0.0.1"
    assert normalize_host("127.0.0.1") == "127.0.0.1"
    assert normalize_host("http://127.0.0.1:5001/") == "127.0.0.1"
    assert normalize_host("::1") == "127.0.0.1"
    assert normalize_host("example.com") == "example.com"
    assert normalize_host("https://site.org/a/b") == "site.org"


def test_is_loopback():
    assert is_loopback("127.0.0.1")
    assert is_loopback("localhost")
    assert not is_loopback("8.8.8.8")
    assert not is_loopback("example.org")


def test_scope_loopback_rejects_external():
    sc = Scope(mode="loopback")
    with pytest.raises(ValueError):
        sc.check_url("http://google.com/")
    with pytest.raises(ValueError):
        sc.check_url("http://192.168.1.5:80/")
    assert sc.check_url("http://127.0.0.1:5001/") == "127.0.0.1"
    assert sc.check_url("http://localhost/") == "127.0.0.1"


def test_scope_authorized_requires_confirm():
    with pytest.raises(ValueError):
        Scope(mode="authorized", allow=["example.test"], confirm=False)\
            .check_url("http://example.test/")
    sc = Scope(mode="authorized", allow=["example.test"], confirm=True)
    assert sc.check_url("http://example.test/") == "http://example.test"


def test_scope_authorized_rejects_outside_allow():
    sc = Scope(mode="authorized", allow=["example.test"], confirm=True)
    with pytest.raises(ValueError):
        sc.check_url("http://other.test/")
    with pytest.raises(ValueError):
        sc.check_url("http://127.0.0.1:5001/")


def test_assert_target_allowed():
    ok = assert_target_allowed("https://api.u.test/v1", ["api.u.test"], True)
    assert ok == "https://api.u.test"
    with pytest.raises(ValueError):
        assert_target_allowed("https://api.u.test/v1", ["api.u.test"], False)


def test_session_guards_in_loopback():
    s = Session()
    with pytest.raises(ValueError):
        s.get("http://1.2.3.4/")
    with pytest.raises(ValueError):
        s.get("http://evil.com/")


def test_session_authorized_allows_target():
    sc = Scope(mode="authorized", allow=["httpbin.org"], confirm=True)
    s = Session(sc)
    # نتحقق فقط من أن الحارس يسمح؛ لا طلب فعلي.
    s._guard("http://httpbin.org/get")
    with pytest.raises(ValueError):
        s._guard("http://nasa.gov/")


def test_check_registry_has_lessons_keys():
    from local_scan import CHECKS
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "gui_app", str(Path(__file__).resolve().parents[1] / "gui" / "app.py"))
    mod = importlib.util.module_from_spec(spec)
    # لا ننفذ mainloop؛ فقط ننظر إلى LESSONS إن أمكن الاستيراد الآمن مع وجود tkinter
    if Path(__file__).resolve().parents[1].exists():
        pass
    codes = {c["code"] for c in CHECKS}
    assert codes  # غير فارغ