"""اختبارات الفحص العميق: البوابات + الكشوفات الخمسة.

الموقع الوهمي: دخول يُتجاوَز، صدى أوامر، حساب قوالب، فرق boolean،
نقطة رفع — كلها بكناري حميد وتحت تصريح مسجل فقط.
"""
import re
import sys
import threading
import urllib.parse
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "tests"))

import pytest
from deep import DEEP_CHECKS, deep_audit, deep_gates
from scoped import Scope
from session import Session
from targets import (add_target, intrusive_granted, remove_target,
                     set_intrusive)
from test_authorized import FakeSite

DEEP_HOME = """<html><body>
<form action="/login" method="post">
<input name="username"><input name="password" type="password"></form>
<form action="/upload" method="post" enctype="multipart/form-data">
<input name="f" type="file"></form>
<a href="/ping?host=127.0.0.1">ping</a>
<a href="/tpl?tpl=hello">tpl</a>
<a href="/item?id=5">item</a>
</body></html>"""


class DeepFake(FakeSite):
    FILES: dict = {}

    def _home(self):
        self._send(200, DEEP_HOME)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query, keep_blank_values=True))
        if url.path == "/":
            return self._home()
        if url.path == "/login":
            return self._send(200, "<form>login</form>")
        if url.path == "/dashboard":
            return self._send(200, "welcome owner")
        if url.path == "/ping":
            return self._send(200, f"PING {q.get('host', '')}")
        if url.path == "/tpl":
            t = q.get("tpl", "")
            return self._send(200, "GX49QZ" if t == "GX{{7*7}}QZ" else t)
        if url.path == "/item":
            i = q.get("id", "")
            if "1'='2" in i:
                return self._send(404, "not found")
            return self._send(200, "item 5 price 20")
        if url.path.startswith("/files/"):
            body = type(self).FILES.get(url.path.split("/")[-1])
            if body is None:
                return self._send(404, "no")
            return self._send(200, body, ctype="text/plain")
        return super().do_GET()

    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace")
        if url.path == "/login":
            q = dict(urllib.parse.parse_qsl(raw, keep_blank_values=True))
            u = q.get("username", "")
            if "' OR '1'='1" in u or (u == "owner" and
                                      q.get("password") == "s3cret"):
                self.send_response(302)
                self.send_header("Location", "/dashboard")
                self.send_header("Set-Cookie", "session=deep-ok; Path=/")
                self.send_header("Content-Length", "0")
                return self.end_headers()
            return self._send(200, "<form>login خطأ</form>")
        if url.path == "/upload":
            m = re.search(r'filename="([^"]+)"', raw)
            if not m:
                return self._send(400, "no file")
            type(self).FILES[m.group(1)] = raw
            return self._send(200, f"saved /files/{m.group(1)}")
        return self._send(404, "no")


@pytest.fixture(scope="module")
def deep_base():
    DeepFake.FILES = {}
    srv = HTTPServer(("127.0.0.1", 0), DeepFake)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{port}/"
    srv.shutdown()


def _sess(base):
    return Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                         confirm=True))


def test_consent_gates(tmp_path, deep_base):
    p = tmp_path / "t.json"
    add_target(deep_base, confirm_text="أؤكد", path=p)
    assert deep_gates(deep_base, path=p)["allowed"] is False
    with pytest.raises(ValueError):
        set_intrusive(deep_base, True, phrase="موافق", path=p)
    with pytest.raises(ValueError):
        set_intrusive("http://127.0.0.1:1/", True, phrase="أصرّح",
                      path=p)
    rec = set_intrusive(deep_base, True, phrase="أصرّح بالفحص العميق",
                        path=p)
    assert rec["intrusive"]["granted"] is True
    assert intrusive_granted(deep_base, path=p)["granted"] is True
    set_intrusive(deep_base, False, path=p)
    assert intrusive_granted(deep_base, path=p) is None
    assert deep_gates(deep_base, path=p)["allowed"] is False
    remove_target(deep_base, path=p)


def test_deep_blocked_without_consent(deep_base, tmp_path):
    p = tmp_path / "t.json"
    add_target(deep_base, confirm_text="أؤكد", path=p)
    rows, info = deep_audit(_sess(deep_base), deep_base, "verify", path=p)
    assert info["ran"] is False
    assert all(r["status"] == "موقوف" for r in rows)
    assert len(rows) == len(DEEP_CHECKS) == 5


def test_deep_blocked_in_detect_mode(deep_base, tmp_path):
    p = tmp_path / "t.json"
    add_target(deep_base, confirm_text="أؤكد", path=p)
    set_intrusive(deep_base, True, phrase="أصرّح", path=p)
    rows, info = deep_audit(_sess(deep_base), deep_base, "detect", path=p)
    assert info["ran"] is False
    assert all(r["verdict"] is False for r in rows)


def test_deep_finds_all_planted(deep_base, tmp_path):
    p = tmp_path / "t.json"
    add_target(deep_base, confirm_text="أؤكد", path=p)
    set_intrusive(deep_base, True, phrase="أصرّح", path=p)
    rows, info = deep_audit(_sess(deep_base), deep_base, "verify", path=p)
    assert info["ran"] is True
    got = {r["code"]: r for r in rows}
    for code in ("D-AUTHBYPASS", "D-CMDI", "D-SSTI", "D-BLIND",
                 "D-UPLOAD"):
        assert got[code]["verdict"] is True, (code, got[code]["note"])
    assert "/files/gx9probe_" in got["D-UPLOAD"]["note"]
    assert "GX9CMDI" in got["D-CMDI"]["evidence"] or \
        "echo GX9" in got["D-CMDI"]["evidence"]
