"""اختبارات ما بعد الاختراق: تنقيح + تغطية الأثر + إعادة التشغيل."""
import sys
import threading
import urllib.parse
import urllib.request
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "report"))
sys.path.insert(0, str(ROOT / "tests"))

import pytest
from postex import extract_links, render_text, replay
from impact import IMPACT, get as impact_of

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


def test_render_text_strips_and_unescapes():
    html = ("<html><head><title>T</title><style>.x{}</style></head>"
            "<body><h1>مرحبا &amp; أهلاً</h1>"
            "<script>alert(1)</script><p>نص</p></body></html>")
    t = render_text(html)
    assert "مرحبا & أهلاً" in t and "نص" in t
    assert "alert" not in t and ".x{}" not in t


def test_extract_links_resolves():
    html = '<a href="/a">واحد</a><a href="javascript:x">skip</a>'
    links = extract_links(html, "http://h/")
    assert links == [{"text": "واحد", "url": "http://h/a"}]


def test_impact_covers_everything():
    from local_scan import CHECKS
    from generic import GENERIC_CHECKS
    from deep import DEEP_CHECKS
    codes = [m["code"] for m in CHECKS + GENERIC_CHECKS + DEEP_CHECKS]
    codes += ["METHODS", "CORS", "HOSTHDR", "SECTXT", "DOMXSS",
              "JSSECRET"]
    missing = [c for c in codes if c not in IMPACT]
    assert missing == []
    for c in codes:
        im = impact_of(c)
        assert im["owns"] and im["next"] and im["bounty"], c
    assert impact_of("NOPE-X")["owns"]  # افتراضي آمن


def test_replay_authbypass_on_deepfake():
    from test_deep import DeepFake, deep_base  # noqa
    from session import Session
    from scoped import Scope
    from deep import deep_audit
    from targets import add_target, set_intrusive
    import tempfile, os
    DeepFake.FILES = {}
    srv = HTTPServer(("127.0.0.1", 0), DeepFake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % srv.server_address[1]
    try:
        p = os.path.join(tempfile.mkdtemp(), "t.json")
        add_target(base, confirm_text="أؤكد", path=p)
        set_intrusive(base, True, phrase="أصرّح", path=p)
        s = Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                          confirm=True))
        rows, _ = deep_audit(s, base, "verify", path=p)
        auth_row = next(r for r in rows if r["code"] == "D-AUTHBYPASS")
        assert auth_row["verdict"] is True
        page = replay(s, base, auth_row)
        assert page["status"] == 200 and "welcome owner" in page["text"]
        up = next(r for r in rows if r["code"] == "D-UPLOAD")
        page2 = replay(s, base, up)
        assert "GX9PROBE" in page2["text"]
        xss = {"code": "G-XSSPARAM", "note": "x /nope?q",
               "evidence": ""}
        page3 = replay(s, base, xss)
        assert page3["url"].startswith(base)
    finally:
        srv.shutdown()


@live
def test_replay_lab_login_shows_dashboard():
    from session import Session
    from scoped import Scope
    s = Session(Scope(mode="loopback"))
    row = {"code": "SQLLOGIN", "note": "x", "evidence": ""}
    page = replay(s, BASE, row)
    assert page["status"] == 200
    assert "لوحة التحكم" in page["text"]
    assert "session" in page["cookies"]


@live
def test_dash_mission_logic_end_to_end():
    from session import Session
    from scoped import Scope
    s = Session(Scope(mode="loopback"))
    st, _, body = s.post(BASE + "login",
                         fields={"username": "' OR '1'='1' --",
                                 "password": "x"})
    st2, _, b2 = s.get(BASE + "dashboard")
    assert st2 == 200 and \
        "لوحة التحكم" in b2.decode("utf-8", "replace")
    mark = "DASH-TEST-9"
    s.post(BASE + "settings", fields={"bio": mark})
    _, _, b3 = s.get(BASE + "profile/1")
    assert mark in b3.decode("utf-8", "replace")
    s.post(BASE + "settings", fields={"bio": "مدير الموقع"})
    _, _, b4 = s.get(BASE + "profile/1")
    assert mark not in b4.decode("utf-8", "replace")
