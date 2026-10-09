"""هل الفحوص الثلاثة الجديدة تلتقط الثغرات فعلًا؟

القاعدة التي اعتمدتها earlier مع AUTHENUM/SESSFIX: فحصٌ يصمت على كل
شيء لا قيمة له. لذلك نبني لكل صنف خادمًا مصابًا وخادمًا سليمًا:

  * مصاب  ⇒ يجب أن يُطلق الفحص
  * سليم  ⇒ يجب أن يصمت الفحص

الكل loopback على منافذ عشوائية، ولا اتصال خارجي. خادم التأطير مقبس
خام لأن الحاذ هنا على مستوى HTTP لا على مستوى Flask.
"""
import json
import socket
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

from local_scan import CHECKS, Session, run_check  # noqa: E402

STUB_USERS = [
    {"username": "admin", "email": "admin@local.test"},
    {"username": "omari", "email": "omari@local.test"},
]


def _http_handler(vuln: bool):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *a):
            pass

        def _json(self, code, obj):
            raw = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            if not self.path.startswith("/graphql"):
                return self._json(404, {"error": "not found"})
            try:
                q = (json.loads(raw or b"{}") or {}).get("query", "")
            except Exception:
                return self._json(400, {"errors": [{"message": "bad body"}]})
            if "__schema" in q:
                # المصاب: استكشاف مفتوح. السليم: ممنوع.
                if vuln:
                    return self._json(200, {"data": {"__schema": {
                        "queryType": {"name": "Query"},
                        "types": [{"name": "User"}]}}})
                return self._json(403, {"errors": [
                    {"message": "introspection disabled"}]})
            if 'user(username:"omari")' in q:
                # المصاب: يعيد بريد غير المصادَق له. السليم: يرفض.
                if vuln:
                    return self._json(200, {"data": {"user": {
                        "username": "omari", "email": "omari@local.test",
                        "bio": ""}}})
                return self._json(401, {"errors": [{"message": "unauthorized"}]})
            return self._json(400, {"errors": [{"message": "bad field"}]})

        def do_GET(self):
            if not self.path.startswith("/directory"):
                return self._json(404, {"error": "not found"})
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            value = (qs.get("user") or [""])[0]
            if not vuln:
                # سليم: القيمة سلسلة معتمة، والمطابقة نصّية بحتة.
                rows = [u for u in STUB_USERS if u["username"] == value]
                return self._json(200, {"criteria": {"username": value},
                                        "count": len(rows), "results": rows})
            # مصاب: القيمة تُحلَّل كـ JSON وتُدمج عواملها في الترشيح.
            crit = {"username": value}
            if value.startswith("{"):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, dict):
                        crit = parsed
                except Exception:
                    pass
            rows = []
            for u in STUB_USERS:
                want = crit.get("username")
                if isinstance(want, dict) and "$ne" in want:
                    keep = u["username"] != want["$ne"]
                else:
                    keep = str(u["username"]) == str(want)
                if keep:
                    rows.append(u)
            return self._json(200, {"criteria": crit,
                                    "count": len(rows), "results": rows})

    return H


class HttpLab:
    def __init__(self, vuln):
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), _http_handler(vuln))
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


class FramingLab:
    """خادم تأطير: يقبل تعارض CL+TE أو يرفضه حسب vuln."""

    def __init__(self, vuln):
        self.vuln = vuln
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(8)
        self.port = self.srv.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._one, args=(conn,), daemon=True).start()

    def _one(self, conn):
        try:
            conn.settimeout(4)
            data = b""
            while b"\r\n\r\n" not in data and len(data) < 4096:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                data += chunk
            head = data.split(b"\r\n\r\n", 1)[0].decode("latin-1").lower()
            ambiguous = ("transfer-encoding" in head
                         and "content-length" in head)
            if ambiguous and not self.vuln:
                status = "400 Bad Request"
            else:
                status = "200 OK"
            body = b"ok"
            conn.sendall(("HTTP/1.1 %s\r\nContent-Length: %d\r\n\r\n"
                          % (status, len(body))).encode() + body)
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def close(self):
        try:
            self.srv.close()
        except OSError:
            pass


def _run(code, base):
    meta = next(m for m in CHECKS if m["code"] == code)
    return run_check(meta, Session(), base, "verify")


# ------------------------------------------------------------- الصنف 1: GraphQL
def test_graphql_fires_when_field_leaks_and_introspection_open():
    lab = HttpLab(vuln=True)
    try:
        r = _run("GRAPHQL", lab.base)
        assert r["verdict"] is True, r["note"]
        assert "استكشاف" in r["note"], r["note"]
    finally:
        lab.close()


def test_graphql_silent_when_introspection_disabled_and_field_authorized():
    lab = HttpLab(vuln=False)
    try:
        r = _run("GRAPHQL", lab.base)
        assert r["verdict"] is False, r["note"]
    finally:
        lab.close()


# --------------------------------------------------------------- الصنف 2: NoSQL
def test_nosqli_fires_when_operator_widens_the_filter():
    lab = HttpLab(vuln=True)
    try:
        r = _run("NOSQLI", lab.base)
        assert r["verdict"] is True, r["note"]
        assert "$ne" in r["note"], r["note"]
    finally:
        lab.close()


def test_nosqli_silent_when_input_is_an_opaque_string():
    lab = HttpLab(vuln=False)
    try:
        r = _run("NOSQLI", lab.base)
        assert r["verdict"] is False, r["note"]
    finally:
        lab.close()


# ------------------------------------------------------------ الصنف 3: التأطير
def test_framing_fires_when_conflicting_framing_is_accepted():
    lab = FramingLab(vuln=True)
    try:
        r = _run("FRAMING", f"http://127.0.0.1:{lab.port}")
        assert r["verdict"] is True, r["note"]
        assert "200" in r["note"], r["note"]
    finally:
        lab.close()


def test_framing_silent_when_conflict_is_rejected():
    lab = FramingLab(vuln=False)
    try:
        r = _run("FRAMING", f"http://127.0.0.1:{lab.port}")
        assert r["verdict"] is False, r["note"]
        assert "مرفوض" in r["note"], r["note"]
    finally:
        lab.close()


# ------------------------------------------- الفحوص المزروعة تُتوقّع أن تُطلق
def test_new_checks_are_planted_expectations_not_clean():
    """الفحوص المزروعة يجب ألا تحمل lab=clean، وإلا انكسرت الشهادة
    في الاتجاه المعاكس: ستُحسب صامتة ومطلوب إطلاقها."""
    for code in ("GRAPHQL", "NOSQLI", "FRAMING"):
        meta = next(m for m in CHECKS if m["code"] == code)
        assert meta.get("lab") is None, code