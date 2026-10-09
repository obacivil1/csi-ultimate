"""اختبارات غرفة التحكم: البوابات + الأفعال + التوثيق."""
import sys
import threading
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "tests"))

import pytest
from control import (log_control, read_url, require_deep, submit_form,
                     upload_canary)
from test_deep import DeepFake


@pytest.fixture(scope="module")
def deep_base():
    DeepFake.FILES = {}
    srv = HTTPServer(("127.0.0.1", 0), DeepFake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d/" % srv.server_address[1]
    srv.shutdown()


def _sess(base, path=None):
    from session import Session
    from scoped import Scope
    return Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                         confirm=True))


def test_read_refused_outside_scope():
    from session import Session
    from scoped import Scope
    s = Session(Scope(mode="loopback"))
    page = read_url(s, "https://example.com/")  # رفض قبل أي اتصال
    assert page["status"] == 0
    assert "مرفوض" in page["text"]
    assert s.n_requests == 0  # صفر حزم خرجت فعلًا


def test_changing_needs_grant(deep_base, tmp_path, monkeypatch):
    import control
    monkeypatch.setattr(control, "intrusive_granted",
                        lambda url, path=None: None)
    s = _sess(deep_base)
    with pytest.raises(ValueError):
        submit_form(s, deep_base, deep_base + "login",
                    {"username": "x"}, path=tmp_path)
    with pytest.raises(ValueError):
        upload_canary(s, deep_base, deep_base + "upload", "f",
                      "T", path=tmp_path)


def test_submit_and_upload_with_grant(deep_base, tmp_path, monkeypatch):
    import control
    grant = {"granted": True}
    monkeypatch.setattr(control, "intrusive_granted",
                        lambda url, path=None: grant)
    s = _sess(deep_base)
    out = submit_form(s, deep_base, deep_base + "login",
                      {"username": "owner", "password": "s3cret"},
                      path=tmp_path)
    assert out["status"] == 200
    up = upload_canary(s, deep_base, deep_base + "upload", "f",
                       "ENGT9", path=tmp_path)
    assert up["ok"] is True
    assert "ENGT9" in up["file"]


def test_log_control_appends_and_verifies():
    from local_scan import AuditLog
    log_control("http://h:80/", "read", "http://h:80/")
    a = AuditLog(ROOT / "reports" / "audit.jsonl")
    assert a.verify_tail() is True
