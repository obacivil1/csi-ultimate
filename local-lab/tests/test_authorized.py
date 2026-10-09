"""اختبارات النطاق المرخّص: مخزن + تدقيق عام على موقع وهمي.

الموقع الوهمي يعمل على loopback لكنه يُعامَل كنطاق خارجي مصرّح
(ثلاثي دقيق + «أؤكد») — يثبت الآلية دون إنترنت.
"""
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from generic import GENERIC_CHECKS, audit_target, generic_audit
from scoped import Scope
from session import Session
from targets import (add_target, canonical, find_target, make_scope,
                     remove_target)

FAKE_JS = ("var h = window.location.hash.slice(1);\n"
           "document.getElementById('x').innerHTML = h;\n"
           'var k = "AKIAIOSFODNN7EXAMPLE";\n')

HOME = """<html><head><title>Shop</title></head><body>
<form action="/s" method="get"><input name="q" type="text"></form>
<a href="/page?a=1&b=2">page</a>
<a href="/go?next=/">go</a>
<script src="/a.js"></script>
<!-- host: XFH -->
</body></html>"""


class FakeSite(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="text/html", extra=()):
        raw = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        for k, v in extra:
            self.send_header(k, v)
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query, keep_blank_values=True))
        if url.path == "/":
            body = HOME.replace("<!-- host: XFH -->",
                                f"<!-- {self.headers.get('X-Forwarded-Host', '')} -->")
            self._send(200, body, extra=[
                ("X-Powered-By", "PHP/7.4.1"),
                ("Set-Cookie", "sid=abc123; Path=/")])
        elif url.path == "/page":
            self._send(200, "<html><body>page</body></html>")
        elif url.path == "/s":
            v = q.get("q", "")
            if "'" in v:
                self._send(200, f"<html><body>sqlite3.OperationalError: "
                                f"near \"gx9\": {v}</body></html>")
            else:
                self._send(200, f"<html><body>نتائج: {v}</body></html>")
        elif url.path == "/go":
            self.send_response(302)
            self.send_header("Location", q.get("next", "/"))
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif url.path == "/a.js":
            self._send(200, FAKE_JS, ctype="application/javascript")
        elif url.path == "/robots.txt":
            self._send(200, "User-agent: *\nDisallow: /admin\n"
                            "Disallow: /backup.zip\n", ctype="text/plain")
        else:
            self._send(404, "nope")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Allow", "GET, POST, PUT, DELETE")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_TRACE(self):
        self._send(200, f"TRACE {self.path} echo")


@pytest.fixture(scope="module")
def fake_base():
    srv = HTTPServer(("127.0.0.1", 0), FakeSite)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}/"
    srv.shutdown()


def _authz_session(base):
    scope = Scope(mode="authorized", allow=[base.rstrip("/")], confirm=True)
    return Session(scope), scope


def test_store_requires_confirm(tmp_path):
    p = tmp_path / "t.json"
    with pytest.raises(ValueError):
        add_target("https://example.com/", note="x", confirm_text="نعم",
                   path=p)
    with pytest.raises(ValueError):
        add_target("::::bad::::", confirm_text="أؤكد", path=p)


def test_store_roundtrip_and_scope(tmp_path, fake_base):
    p = tmp_path / "t.json"
    rec = add_target(fake_base, note="https://hackerone.com/x",
                     confirm_text="أؤكد بشدة", path=p)
    assert rec["confirm"] == "أؤكد"
    assert find_target(fake_base, path=p)["target"] == rec["target"]
    # إضافة مكررة لا تكرر
    add_target(fake_base, confirm_text="أؤكد", path=p)
    from targets import list_targets
    assert len(list_targets(path=p)) == 1
    scope, rec2 = make_scope(fake_base, path=p)
    assert scope.mode == "authorized" and rec2["target"] == rec["target"]
    # منفذ مختلف = ثلاثي مختلف = مرفوض
    with pytest.raises(ValueError):
        make_scope("http://127.0.0.1:1/", path=p)
    assert remove_target(fake_base, path=p) is True
    assert remove_target(fake_base, path=p) is False
    with pytest.raises(ValueError):
        make_scope(fake_base, path=p)


def test_port_aware_enforcement(fake_base):
    s, _ = _authz_session(fake_base)
    st, _, _ = s.get(fake_base)
    assert st == 200
    other = "http://127.0.0.1:1/"
    with pytest.raises(ValueError):
        s.get(other)
    no_confirm = Session(Scope(mode="authorized", allow=[fake_base],
                               confirm=False))
    with pytest.raises(ValueError):
        no_confirm.get(fake_base)


def test_generic_audit_finds_planted_issues(fake_base):
    s, _ = _authz_session(fake_base)
    rows, disc = generic_audit(s, fake_base, "verify")
    assert len(rows) == len(GENERIC_CHECKS) == 14
    got = {r["code"]: r["verdict"] for r in rows}
    for code in ("G-SECHDRS", "G-COOKIES", "G-CORS", "G-HOSTHDR",
                 "G-XSSPARAM", "G-OPENREDIR", "G-SQLIERR", "G-METHODS",
                 "G-ROBOTS", "G-TECHLEAK", "G-DOMXSS", "G-JSSECRET",
                 "G-SECTXT"):
        assert got[code] is True, code
    assert got["G-CSP"] is False  # لا CSP أصلًا
    assert disc["params"] >= 3 and disc["scripts"] >= 1
    xss = next(r for r in rows if r["code"] == "G-XSSPARAM")
    assert "/s?q" in xss["note"]


def test_detect_mode_is_passive_only(fake_base):
    s, _ = _authz_session(fake_base)
    rows, _ = generic_audit(s, fake_base, "detect")
    got = {r["code"]: r["verdict"] for r in rows}
    for code in ("G-CORS", "G-HOSTHDR", "G-XSSPARAM", "G-OPENREDIR",
                 "G-SQLIERR", "G-METHODS"):
        assert got[code] is False, code
    assert got["G-SECHDRS"] is True  # السلبي يعمل دائمًا


def test_audit_target_carries_authorization(fake_base):
    s, scope = _authz_session(fake_base)
    rec = {"target": canonical(fake_base), "base": fake_base,
           "note": "prog", "confirm": "أؤكد", "added_at": "2026-01-01Z"}
    rep = audit_target(scope, fake_base, "verify", auth_record=rec)
    assert rep["meta"]["scope"] == "authorized"
    assert rep["meta"]["authorization"]["target"] == rec["target"]
    assert rep["summary"]["findings"] >= 10
    from generic import auth_md_block
    assert rec["target"] in auth_md_block(rep)
