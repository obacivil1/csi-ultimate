"""اختبارات ضوابط الميدان: عدّاد + إيقاف + تدقيق + إيقاع."""
import sys
import threading
import urllib.request
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "tests"))

from test_authorized import FakeSite

LAB = "http://127.0.0.1:5001/"


def _lab_up():
    try:
        urllib.request.urlopen(LAB, timeout=2).close()
        return True
    except Exception:
        return False


import pytest


def live(fn):
    return pytest.mark.skipif(not _lab_up(),
                              reason="المختبر غير مفتوح")(fn)


@pytest.fixture(scope="module")
def fake_base():
    srv = HTTPServer(("127.0.0.1", 0), FakeSite)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d/" % srv.server_address[1]
    srv.shutdown()


def test_session_counts_requests(fake_base):
    from session import Session
    from scoped import Scope
    s = Session(Scope(mode="authorized", allow=[fake_base.rstrip("/")],
                      confirm=True))
    assert s.n_requests == 0
    s.get(fake_base)
    s.get(fake_base + "page")
    assert s.n_requests == 2


def test_local_session_counts_too():
    from local_scan import Session as LabSession
    s = LabSession()
    assert s.n_requests == 0


def test_generic_audit_stop(fake_base):
    from session import Session
    from scoped import Scope
    from generic import GENERIC_CHECKS, generic_audit
    s = Session(Scope(mode="authorized", allow=[fake_base.rstrip("/")],
                      confirm=True))
    rows, _ = generic_audit(s, fake_base, "verify",
                            stop=lambda: True)
    assert len(rows) == len(GENERIC_CHECKS)
    assert all(r["status"] == "موقوف" for r in rows)


def test_deep_audit_stop(fake_base, tmp_path):
    from session import Session
    from scoped import Scope
    from deep import deep_audit
    from targets import add_target, set_intrusive
    p = tmp_path / "t.json"
    add_target(fake_base, confirm_text="أؤكد", path=p)
    set_intrusive(fake_base, True, phrase="أصرّح", path=p)
    s = Session(Scope(mode="authorized", allow=[fake_base.rstrip("/")],
                      confirm=True))
    rows, info = deep_audit(s, fake_base, "verify", path=p,
                            stop=lambda: True)
    assert all(r["status"] == "موقوف" for r in rows)


def test_external_audit_log(tmp_path):
    from local_scan import AuditLog
    a = AuditLog(tmp_path / "audit.jsonl")
    a.append({"event": "external-scan", "target": "http://h:80/",
              "mode": "verify", "deep": False, "findings": 3,
              "score": 5, "requests": 41, "auth": {"target": "http://h:80/"}})
    assert a.verify_tail() is True


def test_polite_delay_declared():
    from generic import POLITE_DELAY as g
    from deep import POLITE_DELAY as d
    assert g == d == 0.15


@live
def test_lab_run_stop():
    from local_scan import CHECKS, run
    rep = run(LAB, "verify", stop=lambda: True)
    assert rep["summary"]["checks_total"] == len(CHECKS)
    assert all(r["status"] == "موقوف" for r in rep["all_checks"])
