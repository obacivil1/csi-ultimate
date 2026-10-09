"""
local-lab/scanner/certify.py — شهادة جاهزية البرنامج قبل أي موقع حقيقي.
=======================================================================
منهجية من 4 أبعاد (لا يكفي أن «الاختبارات خضراء»):
  1) المعايرة calibration: المختبر مليء بثغرات مقصودة — الأداة
     السليمة يجب أن تجدها كلها (الكشف ديناميكي من len(CHECKS)) بلا صفوف خطأ.
  2) الخصوصية specificity: موقع مُصلَّب وهمي (ترويسات/كوكيز/هروب كامل)
     يجب أن يعطي صفر ثغرات عالية/حرجة — وإلا فعندنا إنذارات كاذبة.
  3) البوابات gates: رفض غير المسجل، ورفض العميق بلا تصريح، ودقة المنفذ،
     وتوجيه API الخارجي لـgeneric فقط، وطبقة intrusive في أدوات GUI.
  4) الآثار artifacts: شهادة JSON محفوظة ومؤرخة في reports/.

الاستعمال: python scanner/local_scan.py --certify [--lab URL]
"""
import json
import threading
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

try:
    from .generic import generic_audit
    from .local_scan import CHECKS, run_check
    from .scoped import Scope
    from .session import Session
except ImportError:  # تشغيل مباشر/اختبارات خارج الحزمة
    from generic import generic_audit
    from local_scan import CHECKS, run_check
    from scoped import Scope
    from session import Session

VERSION = "1.1"
# العتبة تُحسب من الفحوص المتوقَّع أن تُطلق (غير المصنّفة clean)،
# لا من «كل الفحوص تقريبًا». الافتراض القديم max(24, len-1) كان
# ينكسر بإضافة فحص تحصين صحيح لا يُطلق في المختبر: شهادة وهمية
# فاشلة، فيف ضغطُها إلى إسقاط الفحص بدل تصنيفه. الآن الفحص النظيف
# يُحاسَب صمتًا **ويتحقق أيضًا من أنه لم يُطلق** (الإنذار الكاذب مرفوض).
LAB_EXPECTED_FIRES = sum(1 for c in CHECKS if c.get("lab") != "clean")
LAB_MIN_FINDINGS = max(24, LAB_EXPECTED_FIRES - 1)
LAB_MIN_CRITICAL = 3


# ---------------------------------------------------------- الموقع المصلَّب
class HardenedHandler(BaseHTTPRequestHandler):
    """موقع سليم تمامًا: كل دفاع حاضر، كل مخرجات مهرَّبة."""

    def log_message(self, *a):
        pass

    def _sec(self):
        self.send_header("Content-Security-Policy", "default-src 'self'")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=()")
        self.send_header("Server", "hardened")

    def _send(self, code, body=b"", ctype="text/html", extra=()):
        raw = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        for k, v in extra:
            self.send_header(k, v)
        self._sec()
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        import html as _h
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query, keep_blank_values=True))
        if url.path == "/":
            self._send(200,
                        b"<html><body>"
                        b"<form action=\"/s\" method=\"get\">"
                        b"<input name=\"q\"></form>"
                        b"<a href=\"/page?x=1\">p</a>"
                        b"<script src=\"/app.js\"></script>"
                        b"</body></html>",
                        extra=[("Set-Cookie", "sid=ok; Path=/; Secure; "
                                             "HttpOnly; SameSite=Lax")])
        elif url.path == "/s":
            self._send(200, "<html><body>res: %s</body></html>"
                            % _h.escape(q.get("q", "")))
        elif url.path == "/page":
            self._send(200, "<html><body>page</body></html>")
        elif url.path == "/login":
            self._send(200, "<html><body><form action=\"/login\" "
                            "method=\"post\"><input name=\"username\">"
                            "<input name=\"password\" type=\"password\">"
                            "</form></body></html>")
        elif url.path == "/app.js":
            self._send(200, "document.getElementById('t').textContent='hi';",
                       ctype="application/javascript")
        elif url.path == "/robots.txt":
            self._send(200, "User-agent: *\nDisallow: /assets\n",
                       ctype="text/plain")
        elif url.path == "/.well-known/security.txt":
            self._send(200, "Contact: mailto:security@example.com\n",
                       ctype="text/plain")
        elif url.path == "/go":
            nxt = q.get("next", "/")
            if nxt.startswith("/"):
                self.send_response(302)
                self.send_header("Location", nxt)
                self.send_header("Content-Length", "0")
                self._sec()
                self.end_headers()
            else:
                self._send(400, "bad target")
        else:
            self._send(404, "no")

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        self._send(200, "<html><body>login خطأ</body></html>")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self._sec()
        self.end_headers()

    def do_TRACE(self):
        self._send(405, "no")


# ---------------------------------------------------------- الأبعاد الأربعة
def certify_lab(lab_base: str = "http://127.0.0.1:5001/") -> dict:
    s = Session(Scope(mode="loopback"))
    rows = []
    for m in CHECKS:
        try:
            rows.append(run_check(m, s, lab_base, "verify"))
        except Exception as e:
            rows.append({"code": m["code"], "verdict": False,
                         "status": "خطأ", "note": str(e)[:120],
                         "severity": m["severity"], "family": m["family"]})
    found = [r for r in rows if r.get("verdict")]
    errors = [r for r in rows if r.get("status") == "خطأ"]
    crit = sum(1 for r in found if r.get("severity") == "critical")
    fams = {r.get("family") for r in found}
    # فحص محسوب أنه نظيف، إنطلق ⇒ إنذار كاذب. الشهادة ترفضه.
    spurious = [m["code"] for m, r in zip(CHECKS, rows)
                if m.get("lab") == "clean" and r.get("verdict")]
    silent = [m["code"] for m, r in zip(CHECKS, rows)
              if m.get("lab") != "clean" and not r.get("verdict")]
    ok = (len(found) >= LAB_MIN_FINDINGS and not errors and
          not spurious and
          crit >= LAB_MIN_CRITICAL and
          {"injection", "xss", "auth", "access", "config"} <= fams)
    detail = (f"{len(found)}/{len(rows)} بلا أخطاء" if ok else
              f"ناقص/خطأ: وجد {len(found)} وأخطاء {len(errors)}"
              + (f" وإنذارات كاذبة {spurious}" if spurious else "")
              + (f" وصامتة {silent}" if silent else ""))
    return {"pass": ok, "findings": len(found), "total": len(rows),
            "errors": len(errors), "critical": crit,
            "families": sorted(fams), "spurious": spurious,
            "silent": silent, "expected_fires": LAB_EXPECTED_FIRES,
            "detail": detail}


def certify_stub() -> dict:
    from deep import deep_audit
    from targets import add_target, remove_target, set_intrusive
    import tempfile
    srv = HTTPServer(("127.0.0.1", 0), HardenedHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % srv.server_address[1]
    tmp = Path(tempfile.mkdtemp()) / "t.json"
    try:
        s = Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                          confirm=True))
        grows, _ = generic_audit(s, base, "verify")
        add_target(base, confirm_text="أؤكد", path=tmp)
        set_intrusive(base, True, phrase="أصرّح", path=tmp)
        drows, _ = deep_audit(s, base, "verify", path=tmp)
        rows = grows + drows
        bad = [r for r in rows if r.get("verdict") and
               r.get("severity") in ("critical", "high")]
        total = sum(1 for r in rows if r.get("verdict"))
        ok = not bad and total == 0
        return {"pass": ok, "findings": total, "total": len(rows),
                "high_critical": len(bad),
                "detail": "صفر إنذارات" if ok else
                          f"إنذارات كاذبة: {[r['code'] for r in rows if r.get('verdict')]}"}
    finally:
        try:
            remove_target(base, path=tmp)
        except Exception:
            pass
        srv.shutdown()


def certify_gates() -> dict:
    from deep import deep_gates
    from targets import (add_target, intrusive_granted, make_scope,
                         remove_target, set_intrusive)
    import tempfile
    tmp = Path(tempfile.mkdtemp()) / "t.json"
    checks = {}
    try:
        sc = Scope(mode="loopback")
        try:
            sc.check_url("https://example.com/")
            checks["loopback_rejects_external"] = False
        except ValueError:
            checks["loopback_rejects_external"] = True
        try:
            Scope(mode="authorized", allow=["https://example.com"],
                  confirm=False).check_url("https://example.com/")
            checks["authz_requires_confirm"] = False
        except ValueError:
            checks["authz_requires_confirm"] = True
        base = "http://127.0.0.1:59999/"
        add_target(base, confirm_text="أؤكد", path=tmp)
        scope, _ = make_scope(base, path=tmp)
        try:
            scope.check_url("http://127.0.0.1:59998/")
            checks["port_exact"] = False
        except ValueError:
            checks["port_exact"] = True
        checks["deep_refused_default"] = \
            deep_gates(base, path=tmp)["allowed"] is False
        set_intrusive(base, True, phrase="أصرّح", path=tmp)
        checks["deep_granted_after_consent"] = \
            intrusive_granted(base, path=tmp) is not None
        set_intrusive(base, False, path=tmp)
        checks["deep_revoked"] = \
            intrusive_granted(base, path=tmp) is None
        remove_target(base, path=tmp)
        # بوابة API (انحدار P0): الفحص الخارجي يجب أن يمر عبر generic
        # للقراءة فقط، لا عبر فحوص المختبر invasive. نستدعي _run_scan مباشرة
        # مع audit_target مزيّف (بلا شبكة) ونراقب أي مسار اختار.
        checks.update(_certify_api_gate())
        # بوابة GUI: طبقة intrusive تسمح للمختبر وتمنع الخارجي بلا تصريح.
        checks.update(_certify_gui_gate())
    except Exception as e:
        checks["harness_error"] = str(e)[:120]
    ok = all(v is True for v in checks.values())
    return {"pass": ok, "checks": checks}


def _certify_api_gate() -> dict:
    """بوابة API: خارجي → generic فقط. فشل مغلق: أي تعذر = سجل نصي (يفشل الكل)."""
    out = {}
    try:
        import sys as _sys
        import uuid as _uuid
        _lab = Path(__file__).resolve().parents[1]
        for _d in ("api", "scanner", "engine"):
            _p = str(_lab / _d)
            if _p not in _sys.path:
                _sys.path.insert(0, _p)
        import server as _api
        import generic as _generic
        calls = {"generic": 0, "lab": 0}
        _orig_audit = _generic.audit_target
        _orig_run_check = None
        try:
            import local_scan as _ls
            _orig_run_check = _ls.run_check
        except Exception:
            _ls = None

        def _fake_audit(scope, base, mode="verify", auth_record=None, started=None):
            calls["generic"] += 1
            return {"summary": {"findings": 0, "checks_total": 0},
                    "findings": [], "meta": {}}

        def _never_lab(*a, **kw):
            calls["lab"] += 1
            raise AssertionError("invasive lab check on external target")

        _generic.audit_target = _fake_audit
        if _ls is not None:
            _ls.run_check = _never_lab
        try:
            jid = _api._new_job("scan", "http://external.invalid/", "verify")
            _api._set_job(jid, status="running")
            _api._run_scan(jid, "http://external.invalid/", "verify", "أؤكد")
            job = _api.JOBS.get(jid, {})
        finally:
            _generic.audit_target = _orig_audit
            if _ls is not None and _orig_run_check is not None:
                _ls.run_check = _orig_run_check
        out["api_external_uses_generic"] = (
            calls["generic"] == 1 and calls["lab"] == 0
            and job.get("status") == "done"
            and "GENERIC_CHECKS" in str(job.get("result", {}).get("check_set", ""))
        )
    except Exception as e:
        out["api_external_uses_generic"] = f"gate error: {e}"[:120]
    return out


def _certify_gui_gate() -> dict:
    """بوابة GUI: المختبر مسموح، الخارجي بلا تصريح مرفوض. فشل مغلق."""
    out = {}
    try:
        import sys as _sys
        _lab = Path(__file__).resolve().parents[1]
        _p = str(_lab / "gui")
        if _p not in _sys.path:
            _sys.path.insert(0, _p)
        import tools as _tools
        # المختبر: لا رفع
        try:
            _tools._require_intrusive_grant("http://127.0.0.1:5001/")
            out["gui_lab_allowed"] = True
        except PermissionError:
            out["gui_lab_allowed"] = False
        # خارجي بلا تصريح: يجب الرفض
        try:
            _tools._require_intrusive_grant("http://external.invalid/")
            out["gui_external_blocked"] = False
        except PermissionError:
            out["gui_external_blocked"] = True
    except Exception as e:
        out["gui_intrusive_tier"] = f"gate error: {e}"[:120]
    return out


def certify_all(lab_base: str = "http://127.0.0.1:5001/",
                outdir=None) -> dict:
    started = datetime.now(timezone.utc)
    lab, stub, gates = certify_lab(lab_base), certify_stub(), \
        certify_gates()
    verdict = "جاهز ✅" if (lab["pass"] and stub["pass"] and
                            gates["pass"]) else "غير جاهز ❌"
    cert = {
        "tool": "certify", "version": VERSION,
        "at": started.isoformat()[:19] + "Z", "lab_base": lab_base,
        "lab": lab, "stub": stub, "gates": gates, "verdict": verdict,
        "notes": [
            "الشهادة تثبت سلامة الأداة لا سلامة هدفك.",
            "حدود معروفة: بلا محرك JS (إدارات SPA تُعرَض نصًا)، "
            "بلا OOB عام، بلا قياس تجاوز WAF.",
            "منهجية الميدان: شهادة → detect → راجع → verify → "
            "عميق بتصريح المالك.",
        ],
    }
    outdir = Path(outdir) if outdir else \
        Path(__file__).resolve().parents[1] / "reports"
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / ("readiness_%s.json"
                     % started.strftime("%Y%m%d_%H%M%S"))
    path.write_text(json.dumps(cert, ensure_ascii=False, indent=2),
                    encoding="utf-8")
    cert["file"] = str(path)
    return cert
