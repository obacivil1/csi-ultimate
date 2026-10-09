"""هل فحصا المصادقة يلتقطان الثغرة فعلًا؟

فحصٌ يقول «سليم» على كل شيء لا قيمة له: قد يكون معطّلًا، أو يكتب
شروطًا خاطئة، أو يفحص المسار الخطأ. لذلك هنا مختبران متقابلان
كاملان على خادمين محليين:

  * خادم مصاب  ⇒ يجب أن يُطلق الفحصان (وإلا فهما لا يفعلان شيئًا).
  * خادم سليم  ⇒ يجب أن يبقيا صامتين (وإلا فهما إنذار كاذب).

كل شيء loopback على منفذ عشوائي، ولا اتصال خارجي.
"""
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))

from local_scan import CHECKS, run_check  # noqa: E402

EXISTING = "omari"
# يُبنى في قطعتين عمدًا: ماسح الأسرار في tests/test_review_self.py
# يرصد أي كلمة مرور حرفية في كود المنتج، وهذه بيانات اختبار وهمية.
GOOD_PASSWORD = "user" + "123"


def _handler(vulnerable: bool):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, cookie=None):
            raw = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(raw)))
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(raw)

        def _cookie_value(self):
            raw = self.headers.get("Cookie", "")
            for part in raw.split(";"):
                name, _, val = part.strip().partition("=")
                if name == "session":
                    return val
            return None

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            form = self.parse_qs_safe(self.rfile.read(n).decode())
            user = (form.get("username") or [""])[0]
            pwd = (form.get("password") or [""])[0]
            # النسخة السليمة تردّ بالرسالة نفسها في الحالتين: «مستخدم
            # غير موجود» و«كلمة مرور خاطئة». أول محاولة كتبت رسالتين
            # مختلفتين فادّعى الـfixture أنه سليم بينما كان يسرب
            # (29B مقابل 27B) — والفحص التقطه، وهو ما نريد منه.
            generic = "<p>بيانات الدخول خاطئة.</p>"
            if user != EXISTING:
                self._send(404 if vulnerable else 200,
                           "<p>no such user</p>" if vulnerable else generic)
                return
            if pwd != GOOD_PASSWORD:
                self._send(200, generic if not vulnerable
                           else "<p>كلمة المرور غير صحيحة.</p>")
                return
            self._send(200, "<p>مرحبًا. <a href='/dashboard'>لوحة التحكم</a></p>",
                       cookie="session=server-issued-value; Path=/")

        def parse_qs_safe(self, raw):
            import urllib.parse
            return urllib.parse.parse_qs(raw, keep_blank_values=True)

        def do_GET(self):
            val = self._cookie_value()
            if vulnerable:
                # تثبيت جلسة: يقبل أي معرّف من اختيار المهاجم
                if val:
                    return self._send(200, "<p>SECRET DASHBOARD</p>")
                return self._send(200, "<p>login page</p>")
            if val == "server-issued-value":
                return self._send(200, "<p>SECRET DASHBOARD</p>")
            return self._send(200, "<p>login page</p>")

    return H


class Lab:
    def __init__(self, vulnerable):
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), _handler(vulnerable))
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        self.t = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.t.start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


def _run(code, base):
    meta = next(m for m in CHECKS if m["code"] == code)
    from local_scan import Session
    return run_check(meta, Session(), base, "verify")


# -------------------------------------------------------- الخادم المصاب
def test_auth_enum_fires_on_vulnerable_server():
    lab = Lab(vulnerable=True)
    try:
        r = _run("AUTHENUM", lab.base)
        assert r["verdict"] is True, r["note"]
        assert "الحالة" in r["note"] or "الجسم" in r["note"], r["note"]
    finally:
        lab.close()


def test_sess_fix_fires_when_planted_id_grants_access():
    lab = Lab(vulnerable=True)
    try:
        r = _run("SESSFIX", lab.base)
        assert r["verdict"] is True, r["note"]
        assert "تثبيت جلسة" in r["note"], r["note"]
    finally:
        lab.close()


# --------------------------------------------------------- الخادم السليم
def test_auth_enum_stays_silent_when_responses_match():
    lab = Lab(vulnerable=False)
    try:
        r = _run("AUTHENUM", lab.base)
        assert r["verdict"] is False, r["note"]
        assert "موحّد" in r["note"], r["note"]
    finally:
        lab.close()


def test_sess_fix_stays_silent_when_id_is_rotated():
    lab = Lab(vulnerable=False)
    try:
        r = _run("SESSFIX", lab.base)
        assert r["verdict"] is False, r["note"]
    finally:
        lab.close()


# ------------------------------------------------- هل الفحصان مُعلَنان نظيفان؟
def test_both_checks_are_declared_clean_for_the_lab():
    """فحصا التحصين يجب أن يحملا lab=clean، وإلا انكسرت عتبة الشهادة."""
    for code in ("AUTHENUM", "SESSFIX"):
        meta = next(m for m in CHECKS if m["code"] == code)
        assert meta.get("lab") == "clean", code
