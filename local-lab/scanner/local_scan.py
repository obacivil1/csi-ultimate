"""
local-lab/scanner/local_scan.py — سكريبت فحص محمول (DETECT/VERIFY).
=================================================================
محمول بالكامل: يعتمد Python القياسي فقط. انسخ مجلد scanner إلى أي لابتوب،
غيّر --target فقط.

مبدأ الصندوق: قيد loopback صارم (hostguard) — لا يعمل على أي مضيف خارج جهازك.

الاستشارة (النمط security):
  - interactive (افتراضي): يسألك أنت أولًا — هذا نظير "شروط الموقع" في الثغرة الحقيقية.
  - detect: قراءة فقط + تقرير (لا يُرسل أي حمولة).
  - verify: يفيد "إثباتًا لطيفًا" (حمولات غير ضارة) لكتابة دليل، بلا أذى.
  - full  : إثبات كامل بأمثلة محلية فقط (تحميل ملف، أمر echo) — داخل جهازك.

المخرجات:
  - Terminal بجداول ملونة
  - reports/scan_report.json  (بمعايير OWASP + حرجية)
  - reports/scan_report.md    (نسخة سهلة التعلم)
  - reports/audit.jsonl       (سجل تدقيق متسلسل hash-chain)
"""
import argparse
import base64
import hashlib
import hmac
import json
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import socket
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hostguard import assert_local, parse_base

SEVERITY = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
REVERSE = {v: k for k, v in SEVERITY.items()}

# ------------------------------------------------------------------ HTTP
class _GuardedRedirect(urllib.request.HTTPRedirectHandler):
    """يمنع هروب loopback عبر التوجيه: كل قفزة تُفحص قبل اتباعها."""

    def __init__(self, guard):
        self._guard = guard

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = urllib.parse.urljoin(req.full_url, newurl)
        self._guard(new)  # يرفع ValueError فيُجهض الاتباع
        return super().redirect_request(req, fp, code, msg, headers,
                                        newurl)


class Session:
    """جلسة urllib مع ملفات cookie بسيطة — يبقى كل شيء loopback-limited."""

    def __init__(self, routes=None):
        self.jar = CookieJar()
        self.n_requests = 0
        # قائمة اختيارية لتدوين المسارات. الفحوص التي تحتاج جلسة نظيفة
        # تُنشئ Session() خاصة بها، فبدون هذا الحقل تختفي طلباتها عن
        # قياس المسارات وتصير الفحوص class-only بصمت.
        self.routes = routes
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            _GuardedRedirect(self._guard),
        )
        self.opener.addheaders = [("User-Agent", "LocalLab/1.0 (+local-only)")]

    def _guard(self, url):
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("بروتوكول غير معتمد")
        assert_local(parsed.hostname or "")  # الرفض قبل أي اتصال

    def request(self, method, url, data=None, headers=None, timeout=6):
        self._guard(url)
        self.n_requests += 1
        if self.routes is not None:
            p = urllib.parse.urlparse(url).path or "/"
            if p not in self.routes:
                self.routes.append(p)
        req = urllib.request.Request(url, data=data, method=method,
                                     headers=headers or {})
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                return resp.status, resp.getheaders(), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.items(), e.read()
        except urllib.error.URLError as e:
            return 0, [], str(e).encode()

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, fields=None, files=None, **kw):
        if files:
            boundary = "----LocalLab" + hashlib.md5(url.encode()).hexdigest()[:12]
            parts = []
            for k, v in (fields or {}).items():
                parts.append(
                    (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\""
                     f"\r\n\r\n{v}\r\n").encode()
                )
            for k, (fname, content) in files.items():
                parts.append(
                    (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; "
                     f"filename=\"{fname}\"\r\nContent-Type: text/plain\r\n\r\n").encode()
                    + content + b"\r\n"
                )
            parts.append(f"--{boundary}--\r\n".encode())
            body = b"".join(parts)
            headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
            return self.request("POST", url, data=body, headers=headers, **kw)
        body = urllib.parse.urlencode(fields or {}).encode()
        return self.request("POST", url, data=body, headers={
            "Content-Type": "application/x-www-form-urlencoded"}, **kw)

    def cookies(self):
        return [(c.name, c.value, c.secure, c.has_nonstandard_attr("HttpOnly"))
                for c in self.jar]


def text(resp):
    """status, headers, raw -> (status, str, headers)"""
    st, hdrs, raw = resp
    return st, raw.decode("utf-8", errors="replace"), hdrs


def _drop_marker_posts(marker: str) -> int:
    """يحذف مقالات الفحص من جدول posts (تنظيف مختبر).

    الضعف بطبيعته كتابة: لا يوجد مسار حذف في /blog، فبلا هذا ينمو
    الجدول صفًّا لكل تشغيل.Measured: 2 مزروعة ← 87 بعد تشغيلات متكررة.
    يعمل فقط إن كان ملف قاعدة المختبر موجودًا، وبلا مسارlabs على غيره.
    """
    db = Path(__file__).resolve().parents[1] / "data" / "lab.db"
    if not db.is_file():
        return 0
    try:
        conn = sqlite3.connect(db)
        cur = conn.execute("DELETE FROM posts WHERE title LIKE ?",
                           (f"%{marker}%",))
        conn.commit()
        n = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        conn.close()
        return n
    except sqlite3.Error:
        return 0


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """يمنع المتابعة التلقائية لنرى 302 ومكانها (لفحص التوجيه المفتوح)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_no_follow(session, url, timeout=6, data=None, headers=None,
                    method=None):
    """طلب بلا متابعة توجيه — عبر نفس حارس النطاق وجرة الجلسة.

    يقبل data/headers/method لأن إثبات «تجاوز الدخول» يحتاج POST
    مع بيانات نموذج. الافتراضي GET بلا ترويسات، فكل الاستعمالات
    القائمة تبقى كما هي بلا تغيير سلوكي.
    """
    session._guard(url)
    opener = urllib.request.build_opener(
        _NoRedirect, urllib.request.HTTPCookieProcessor(session.jar))
    req = urllib.request.Request(
        url, data=data,
        method=method or ("POST" if data else "GET"),
        headers=headers or {})
    t0 = time.time()
    try:
        with opener.open(req, timeout=timeout) as resp:
            out = (resp.status, resp.getheaders(), resp.read())
    except urllib.error.HTTPError as e:
        out = (e.code, list(e.headers.items()), e.read())
    except urllib.error.URLError as e:
        out = (0, [], str(e).encode())
    ms = round((time.time() - t0) * 1000, 1)
    # توثيق duck-typing: إن كانت الجلسة مسجِّلة (RecordingSession) أضف التبادل.
    rec = getattr(session, "exchanges", None)
    if isinstance(rec, list):
        rec.append({"method": "GET", "url": url, "headers": {},
                    "body": b"", "status": out[0],
                    "resp_headers": list(out[1]), "resp_body": out[2],
                    "time_ms": ms})
        del rec[:-6]
    return out


# ------------------------------------------------------------------ فحوصات
CHECKS: list = []


def check(code, name, owasp, severity_key, family, require=None, lab=None):
    def deco(fn):
        CHECKS.append({
            "code": code, "name": name, "owasp": owasp,
            "severity": severity_key, "family": family, "require": require,
            # lab="clean" يعني: هذا فحص تحصين، متوقَّع أن يبقى صامتًا
            # على المختبر السليم. تُحسب عتبة الشهادة من المتوقَّع لا من
            # «كل الفحوص تُطلق» — افتراض يتكسر بإضافة فحص نظيف.
            "lab": lab,
            "fn": fn,
        })
        return fn
    return deco


def declare_path(s, path: str) -> None:
    """يصرّح فحصٌ يتجاوز الجلسة بمساره الذي فحصه.

    المراقب الروحي في harness يشاهد الجلسات فقط، فمن يتجاوزها بغير
    تصريح يسقط من القياس بصمت ويظهر class-only. التصريح ادّعاء صريح
    يُقارَن بالمسار الموثّق للضعف — أشدّ صدقًا من إهماله.
    """
    routes = getattr(s, "routes", None)
    if routes is not None and path not in routes:
        routes.append(path)


def ok(resp, marker):
    st, body, _ = text(resp)
    return st == 200 and marker in body
def run_check(meta, s: Session, base: str, mode: str):
    # اصطلاح واحد للـbase: بلا شرطة أخيرة. الفحوص تكتب {base}/مسار.
    # قبل هذا كان 6 فحوص بـ{base}مسار و36 بـ{base}/مسار، والـCLI يضيف
    # الشرطة دائمًا — فكانت 36 فحصًا تطلب //login (تعمل بمحض)-> tolerant
    # Werkzeug)، وأي تعديل على قاعدة الـbase كان يكسر الستة بصمت.
    base = base.rstrip("/")
    st_code, st_name, verdict, note, evidence = meta["fn"](s, base, mode)
    return {
        "code": meta["code"], "name": meta["name"], "owasp": meta["owasp"],
        "severity": meta["severity"], "family": meta["family"],
        "sub_status": st_code, "status": st_name, "verdict": verdict,  # found/not/na
        "note": note, "evidence": evidence[:300], "mode": mode,
    }


def load_plugins(plugindir=None, enabled=None):
    """تحميل اختياري لإضافات plugins/checks/ (يتجاهل المكرر). يعيد (n, errors)."""
    plugindir = Path(plugindir) if plugindir else \
        Path(__file__).resolve().parents[1] / "plugins" / "checks"
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "plugins"))
    from loader import discover
    loaded, errors = discover(plugindir, enabled)
    have = {c["code"] for c in CHECKS}
    n = 0
    for meta in loaded:
        if meta["code"] not in have:
            CHECKS.append(meta)
            have.add(meta["code"])
            n += 1
    return n, errors


# -- A1: SQLi in login ------------------------------------------------
@check("SQLLOGIN", "حقن SQL في تسجيل الدخول", "A1:Injection", "critical", "injection")
def c_sql_login(s, base, mode):
    if mode == "detect":
        u = "admin"
    else:
        u = "' OR '1'='1' --"
    resp = s.post(f"{base}/login", {"username": u, "password": "x"})
    st, body, _ = text(resp)
    found = st == 302 or "/dashboard" in body or "لوحة التحكم" in body
    note = ("دخول دون كلمة مرور صحيحة عبر كسر الاستعلام" if found
            else "محاولة دخول اعتيادية (detect) — دليل غير كافٍ")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, f"POST /login body[-120:]"

# -- A1: SQLi in search ----------------------------------------------
@check("SQLSEARCH", "حقن SQL في البحث", "A1:Injection", "high", "injection")
def c_sql_search(s, base, mode):
    if mode == "detect":
        q = "أهلا"
    else:
        q = "' OR '1'='1' --"
    resp = s.get(f"{base}/search?q=" + urllib.parse.quote(q))
    st, body, _ = text(resp)
    found = st == 200 and "خارطة طريق" in body
    note = "مقالات كُشفت كلها بحقنة بسيطة" if found else "بحث عادي بلا دليل"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, f"q={q!r}"

# -- A3: XSS reflected (search) --------------------------------------
@check("XSSREFLECT", "XSS منعكسة في البحث", "A3:Injection", "medium", "xss")
def c_xss_reflect(s, base, mode):
    payload = "corona-xyz-123"
    q = f"<b>{payload}</b>"
    resp = s.get(f"{base}/search?q=" + urllib.parse.quote(q))
    st, body, _ = text(resp)
    found = payload in body and f"<b>{payload}</b>" in body
    note = "الموقع أعاد وسم <b> بدون معالجة (تأكيد انعكاس)" if found else "لا انعكاس"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, q

# -- A1: IDOR (profile URLs) -----------------------------------------
@check("IDOR", "قراءة ملفات مستخدمين بلا تحقق", "A1:BrokenAccessControl", "high", "access")
def c_idor(s, base, mode):
    resp = s.get(f"{base}/profile/4")
    st, body, _ = text(resp)
    found = st == 200 and "ملف خاص" in body
    note = ("ملف «privacy» (خاص) ظهر دون تسجيل دخول" if found
            else "لم يتسن الوصول للملف الخاص")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "/profile/4"

# -- A1: Path traversal (download) -----------------------------------
@check("PATH", "تجاوز المسار في التنزيل", "A1:Injection", "high", "injection")
def c_path(s, base, mode):
    resp = s.get(f"{base}/download?file=lab.db")
    st, body, _ = text(resp)
    found = st == 200 and b"SQLite format 3" in resp[2]
    note = "قاعدة البيانات كاملة تقرأ (lab.db)" if found else "لا قراءة قاعدة"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "/download?file=lab.db"

# -- A1: File upload باي امتداد --------------------------------------
@check("UPLOAD", "رفع ملف بأي امتداد (خبيث جائز)", "A1:Injection", "high", "upload")
def c_upload(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا يُرفع أي ملف.", "لم يُرسل"
    fname = "probe_local.htm"
    resp = s.post(f"{base}/upload", fields={}, files={"file": (fname, b"<b>LOCAL-OK</b>")})
    st, body, _ = text(resp)
    fetched = s.get(f"{base}/uploads/{fname}")
    fst, fbody, _ = text(fetched)
    found = st == 200 and "تم الرفع" in body and fst == 200 and "LOCAL-OK" in fbody
    note = "ملف HTML رُفع ونُفذ (محتواه ظهر) — دليل رفع خبيث" if found else "لم يُرفع"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, fname

# -- A7: Command injection (api/ping) --------------------------------
@check("CMDI", "حقن أوامر في /api/ping", "A7:Injection", "critical", "injection")
def c_cmdi(s, base, mode):
    if mode == "detect":
        host = "127.0.0.1"
    else:
        host = "127.0.0.1; echo PWN297"
    resp = s.get(f"{base}/api/ping?host=" + urllib.parse.quote(host))
    st, body, _ = text(resp)
    found = st == 200 and "PWN297" in body
    note = "أمر echo نُفّذ عبر المعلمة host (دليل RCE)" if found else "لا تنفيذ أوامر مؤكد"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, host

# -- A2: cookie جلسة ضعيفة/متنبأة ------------------------------------
@check("WEAKCOOKIE", "كلمة مرور نص صريح + جلسة بلا Secure", "A2:BrokenAuth", "high", "auth")
def c_weak_cookie(s, base, mode):
    resp = s.post(f"{base}/login", {"username": "omari", "password": "user123"})
    st, _, body = text(resp)
    cookies = s.cookies()
    has_session = any(n.lower() == "session" for n, _, _, _ in cookies)
    secure_ok = all(sec or n.lower() != "session" for n, _, sec, _ in cookies)
    plain_db = False
    if "dashboard" in body or "لوحة التحكم" in body:
        plain_db = True
    found = has_session and (not secure_ok or plain_db)
    note = ("جلسة نشطة بدون علم Secure (يُنقل نصًا) وببيانات نص صريح"
            if found else "لا دليل مؤكد")
    cookie_list = ", ".join(f"{n}=…({''})" for n, _, _, _ in cookies) or "لا كوكيز"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, cookie_list

# -- A5: API بلا مصادقة ----------------------------------------------
@check("APIAUTH", "API بلا تحقق من الهوية", "A5:BrokenAccessControl", "medium", "access")
def c_api_auth(s, base, mode):
    resp = s.get(f"{base}/api/me")
    st, body, _ = text(resp)
    found = st == 200 and ("admin_area" in body or "admin" in body)
    note = "المسار يفضي لبيانات وكشف منطقة إدارية بلا دخول" if found else "لا كشف"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "/api/me"


# -- المرحلة 3+: SQLi زمني (Time-based) ----------------------------------
@check("SQLTIME", "حقن SQL زمني (Time-based) في البحث", "A1:Injection", "high", "injection")
def c_sql_time(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا يُقاس زمن استجابة.", "لم يُرسل"
    # معايرة حية على SQLite: n=2500 يعطي ~2s مقابل ~0.02s للخفيف.
    # (مضمّنة هنا عمدًا ليبقى scanner/ محمولًا بمكتبات قياسية فقط.)
    slow_q = ("' UNION SELECT 1,1,'x',(SELECT count(hex(randomblob(30))) FROM "
              "(WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 "
              "FROM c WHERE x<2500) SELECT * FROM c, c AS c2)) -- ")
    fast_q = "' UNION SELECT 1,1,'x',2 -- "
    t0 = time.time()
    s.get(f"{base}/search?q=" + urllib.parse.quote(slow_q))
    slow = time.time() - t0
    t0 = time.time()
    s.get(f"{base}/search?q=" + urllib.parse.quote(fast_q))
    fast = time.time() - t0
    found = slow >= 1.2 and slow >= fast + 1.0
    note = (f"الثقيل {slow:.1f}s مقابل الخفيف {fast:.2f}s — حقن زمني مؤكد"
            if found else f"لا فرق زمني حاسم ({slow:.2f}s مقابل {fast:.2f}s)")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "time-oracle"


# -- المرحلة 3: SQLi أعمى (Boolean) ------------------------------------
@check("SQLBLIND", "حقن SQL أعمى (Boolean) في البحث", "A1:Injection", "high", "injection")
def c_sql_blind(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: استعلام حميد واحد بلا مقارنة.", "لم يُرسل"
    qt = "' OR '1'='1"
    qf = "' AND '1'='2"
    _, bt, _ = text(s.get(f"{base}/search?q=" + urllib.parse.quote(qt)))
    _, bf, _ = text(s.get(f"{base}/search?q=" + urllib.parse.quote(qf)))
    found = ("خارطة طريق" in bt) and ("لا نتائج" in bf) and ("خارطة طريق" not in bf)
    note = ("الاستجابة تتبدل صحيح/خطأ مع الشرط — حقن أعمى مؤكد"
            if found else "لا فرق boolean واضح")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, f"T={qt!r} F={qf!r}"


# -- المرحلة 3: XSS مخزنة (/settings -> /profile) -----------------------
@check("XSSSTORED", "XSS مخزنة (نبذة + مقالات)", "A3:Injection", "medium", "xss")
def c_xss_stored(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا يُخزَّن أي محتوى.", "لم يُرسل"
    s.post(f"{base}/login", {"username": "omari", "password": "user123"})

    mark = "STORED9"
    s.post(f"{base}/settings", {"bio": f"<b>{mark}</b>"})
    _, body, _ = text(s.get(f"{base}/profile/2"))
    bio = f"<b>{mark}</b>" in body

    bmark = "STORED9B"
    s.post(f"{base}/blog/new", {"title": f"probe {bmark}",
                               "content": f"<b>{bmark}</b>"})
    blog = False
    _, listing, _ = text(s.get(f"{base}/blog"))
    ids = re.findall(r"/blog/(\d+)", listing)
    if ids:
        _, view, _ = text(s.get(f"{base}/blog/{ids[0]}"))
        blog = f"<b>{bmark}</b>" in view
    dropped = _drop_marker_posts(bmark)

    found = bio or blog
    where = [w for w, hit in (("النبذة", bio), ("المقال", blog)) if hit]
    note = (f"تخزين خام في {' و'.join(where)} — يُنفَّذ عند كل زائر"
            if found else "لا تخزين خام مؤكد")
    ev = f"bio=<b>{mark}</b>={'hit' if bio else 'miss'} " \
         f"blog=<b>{bmark}</b>={'hit' if blog else 'miss'}" \
         f" (حُذف {dropped} مقال اختبار)"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, ev


# -- المرحلة 3: SSRF (/api/fetch) ---------------------------------------
@check("SSRF", "طلب مزوّر من الخادم (SSRF)", "A10:SSRF", "high", "ssrf")
def c_ssrf(s, base, mode):
    inner = "/api/me" if mode != "detect" else "/"
    resp = s.get(f"{base}/api/fetch?url=" + urllib.parse.quote(base.rstrip("/") + inner))
    st, body, _ = text(resp)
    if mode == "detect":
        # ملاحظة: Flask يهرّب العربية (\uXXXX) في JSON — نتحقق من بنية الجلب.
        found = st == 200 and '"sample"' in body and '"length"' in body
        note = ("الخادم جلب صفحته بنفسه — بدائية SSRF ظاهرة (قراءة فقط)"
                if found else "لا جلب من جهة الخادم")
    else:
        found = st == 200 and "admin_area" in body
        note = ("الخادم جلب نقطة داخلية حساسة (/api/me) — SSRF مؤكد"
                if found else "لا جلب داخلي مؤكد")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, f"url={inner}"


# -- المرحلة 3: SSTI (/preview) ------------------------------------------
@check("SSTI", "حقن قوالب (SSTI) في المعاينة", "A1:Injection", "critical", "injection")
def c_ssti(s, base, mode):
    tpl = "{{7*7}}" if mode != "detect" else "LocalLabStatic"
    resp = s.get(f"{base}/preview?template=" + urllib.parse.quote(tpl))
    st, body, _ = text(resp)
    if mode == "detect":
        found = False
        note = "وضع detect: قالب ساكن بلا تنفيذ — للقراءة فقط."
    else:
        found = st == 200 and body.strip() == "49"
        note = ("{{7*7}} نُفِّذت وأعادت 49 — القالب يُنفَّذ (RCE ممكن)"
                if found else "لا تنفيذ قوالب مؤكد")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, f"template={tpl}"


# -- المرحلة 3: Open Redirect (/go) ---------------------------------------
@check("OPENREDIR", "إعادة توجيه مفتوحة", "A10:Redirect", "medium", "access")
def c_openredir(s, base, mode):
    nxt = "https://example.com/" if mode != "detect" else "/"
    st, hdrs, _body = fetch_no_follow(
        s, f"{base}/go?next=" + urllib.parse.quote(nxt))
    loc = next((v for k, v in hdrs if k.lower() == "location"), "")
    if mode == "detect":
        found = False
        note = "وضع detect: توجيه داخلي حميد فقط — للقراءة."
    else:
        found = st in (301, 302, 303, 307, 308) and "example.com" in loc
        note = ("التوجيه يتبع وجهة خارجية بلا تحقق — تصيّد جاهز"
                if found else "لا توجيه خارجي مؤكد")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, f"next={nxt}"


# -- المرحلة 3: CSRF (/settings بلا رمز) -----------------------------------
@check("CSRF", "غياب حماية CSRF في تحديث الملف", "A1:BrokenAccessControl", "medium", "access")
def c_csrf(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا يُنفَّذ فعل مغيّر للحالة.", "لم يُرسل"
    s.post(f"{base}/login", {"username": "omari", "password": "user123"})
    probe = "CSRF-PROBE-7"
    # urllib لا يرسل Referer/Origin أصلًا — يحاكي طلبًا عبر-موقعيًا بلا رمز.
    s.post(f"{base}/settings", {"bio": probe})
    _, body, _ = text(s.get(f"{base}/profile/2"))
    found = probe in body
    note = ("فعل مغيّر نُفِّذ بلا رمز ولا تحقق مصدر — CSRF مؤكد"
            if found else "الطلب رُفض أو لم يُحفَظ")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "/settings بلا token"


# -- المرحلة 3: ترويسات أمان ناقصة ------------------------------------------
@check("SECHDRS", "ترويسات أمان ناقصة", "A5:Misconfiguration", "medium", "config")
def c_sechdrs(s, base, mode):
    _, _, hdrs = text(s.get(f"{base}/"))
    h = {k.lower() for k, _ in hdrs}
    missing = [k for k in ("content-security-policy", "x-frame-options",
                           "x-content-type-options") if k not in h]
    found = len(missing) >= 2
    note = ("ناقص: " + "، ".join(missing) if found
            else "الترويسات الأساسية حاضرة")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "GET /"

# -- المرحلة 8: JWT يقبل alg=none ------------------------------------------
def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


@check("JWTNONE", "قبول JWT بخوارزمية none (انتحال مدير)", "A2:BrokenAuth", "high", "auth")
def c_jwt_none(s, base, mode):
    if mode == "detect":
        resp = s.get(f"{base}/api/token?user=omari")
        st, body, _ = text(resp)
        found = False
        note = "وضع detect: بنية الرمز ظاهرة فقط — بلا تزوير."
        return 1, "مقروء", found, note, "/api/token"
    hb = _b64u(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    pb = _b64u(json.dumps({"user": "admin", "admin": True}).encode())
    resp = s.get(f"{base}/api/whoami?token=" + urllib.parse.quote(f"{hb}.{pb}."))
    st, body, _ = text(resp)
    compact = body.replace(" ", "")
    found = st == 200 and '"admin":true' in compact and '"via":"none"' in compact
    note = ("رمز مزور بخوارزمية none قُبِل كمدير — انتحال كامل"
            if found else "الـ none مرفوض")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "alg=none"


# -- المرحلة 8: كسر سر JWT الضعيف دون اتصال -------------------------------
@check("JWTWEAK", "سر JWT ضعيف يُكسَر بقاموس (تزوير موقع)", "A2:BrokenAuth", "high", "auth")
def c_jwt_weak(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا كسر دون اتصال.", "لم يُرسل"
    resp = s.get(f"{base}/api/token?user=omari")
    st, body, _ = text(resp)
    try:
        token = json.loads(body)["token"]
        hb, pb, sig = token.split(".")
    except Exception:
        return 1, "خطأ", False, "تعذّر قراءة الرمز.", "/api/token"
    dictionary = ["123456", "password", "secret", "secret123", "admin",
                  "letmein", "qwerty", "localab"]
    t0 = time.time()
    cracked = None
    for word in dictionary:
        expect = _b64u(hmac.new(word.encode(), f"{hb}.{pb}".encode(),
                                hashlib.sha256).digest())
        if hmac.compare_digest(expect, sig):
            cracked = word
            break
    ms = round((time.time() - t0) * 1000, 1)
    if not cracked:
        return 1, "سليم/غير مؤكد", False, \
            f"القاموس المصغر ({len(dictionary)}) لم يكسر السر.", "/api/token"
    nb = _b64u(json.dumps({"user": "admin", "admin": True}).encode())
    nsig = _b64u(hmac.new(cracked.encode(), f"{hb}.{nb}".encode(),
                          hashlib.sha256).digest())
    forged = f"{hb}.{nb}.{nsig}"
    st2, body2, _ = text(s.get(f"{base}/api/whoami?token=" +
                               urllib.parse.quote(forged)))
    found = st2 == 200 and '"admin":true' in body2.replace(" ", "")
    note = (f"كُسر السر «{cracked}» دون اتصال في {ms}ms ثم زُوِّر مدير — مؤكد"
            if found else "الكسر نجح لكن التزوير رُفض")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, \
        f"cracked={cracked} {ms}ms"


# -- المرحلة 8: بلا حد لمحاولات الدخول --------------------------------------
@check("NOLOCK", "لا حدّ لمحاولات الدخول (تخمين مفتوح)", "A2:BrokenAuth", "medium", "auth")
def c_nolock(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: محاولة واحدة فقط.", "لم يُرسل"
    oks = 0
    for i in range(6):
        st, body, _ = text(s.post(f"{base}/login",
                                  {"username": "omari",
                                   "password": f"bad-{i}"}))
        low = body.lower()
        if st == 200 and "captcha" not in low and "lock" not in low \
                and "429" not in low and "محظور" not in body:
            oks += 1
    found = oks >= 6
    note = (f"{oks}/6 محاولات فاشلة بلا حظر أو تحقق — التخمين مفتوح"
            if found else "ظهر حدّ أو حظر بعد محاولات")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "6×bad login"


# -- المرحلة 7ب: إساءة استخدام المصادقة ---------------------------------------
# NOLOCK يغطّي حدّ المحاولات. الغائب كان سؤالين اثنين: هل الخادم
# يفصل بين «مستخدم موجود» و«غير موجود»؟ وهل يدوّر معرّف الجلسة عند
# رفع الصلاحية؟ فحصا التنصّت على المصادقة هما المنهجان الفعليان.
def _mask(t: str) -> str:
    """يحجب القيم العشوائية الطويلة (csrf/nonce) قبل المقارنة."""
    t = re.sub(r"[A-Za-z0-9_\-+/=]{16,}", "X", t)
    return re.sub(r"\s+", " ", t).strip().lower()


@check("AUTHENUM", "عداد الحسابات بفرق الردّ", "A2:BrokenAuth", "low", "auth", lab="clean")
def c_auth_enum(s, base, mode):
    """يقارن ردّ دخول لمستخدم موجود بكلمة خاطئة بردّ مستخدم غير موجود.

    المقارنة على (الحالة + جسم مُقنَّع)، لا على التوقيت: قياس الزمن
    هنا не يثبت شيئًا على خادم سريع، وادّاؤه دليل كاذب.
    """
    real = s.post(f"{base}/login",
                  {"username": "omari", "password": "definitely-wrong-1"})
    ghost = s.post(f"{base}/login",
                   {"username": "zz-no-such-user-9183",
                    "password": "definitely-wrong-1"})
    st1, b1, _ = text(real)
    st2, b2, _ = text(ghost)
    d1, d2 = _mask(b1), _mask(b2)
    diffs = []
    if st1 != st2:
        diffs.append(f"الحالة {st1} مقابل {st2}")
    if d1 != d2:
        diffs.append(f"الجسم {len(d1)}B مقابل {len(d2)}B")
    for hint in ("لا يوجد", "غير موجود", "unknown user", "no such user",
                 "not found", "존재하지"):
        if hint in b1.lower() and hint not in b2.lower():
            diffs.append(f"رسالة فاضحة: «{hint}»")
    found = bool(diffs)
    note = ("الردّان متمايزان — التعداد ممكن: " + "؛ ".join(diffs) if found
            else "ردّ موحّد للمستخدم الموجود وغير الموجود — لا تعداد")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, \
        "2×POST /login (موجود × وهمي)"


@check("SESSFIX", "تثبيت الجلسة (معرّف يبقى بعد رفع الصلاحية)", "A2:BrokenAuth", "medium", "auth", lab="clean")
def c_sess_fix(s, base, mode):
    """يختبر تثبيت الجلسة بمعرّف يختاره المهاجم — على ثلاث محطات:

      1) جلسة نظيفة: دخول صحيح، واسم الكوكي يُقرأ من الـjar لا من
         الترويسات. (Set-Cookie يخرج مع 302، وبعد اتباع إعادة
         التوجيه لا يبقى في الترويسات — فقرأناه من هناك فرأينا
         «لا كوكي» وسببُه خطأ لا خلو.)
      2) جلسة نظيفة ثانية: هل يُصدر الخادم معرّفًا غير المزروع؟
      3) البرهان: بالمعرّف المزروع وحده، هل تتغيّر استجابة صفحة
         محميّة مقارنةً بزائر بلا كوكي؟ هذا هو تعريف التثبيت
         نفسه، وهو فارق غير مربوط بنصوص هذا المختبر.

    كل محطة بجلسة مستقلة، وإلا تسرّبت كوكي المحطة السابقة
    فصارت النتيجة «غير قابلة للقياس» دائمًا.
    """
    creds = {"username": "omari", "password": "user123"}

    def jar_of(p):
        return {c.name: c.value for c in p.jar}

    # (1) تعلُّم اسم كوكي الجلسة من تسجيل دخول حقيقي
    probe = Session(getattr(s, "routes", None))
    probe.post(f"{base}/login", dict(creds))
    names = list(jar_of(probe))
    if not names:
        return 1, "غير قابل للقياس", False, \
            "دخول بلا كوكي جلسة — لا معرّف لتثبيته", "/login"
    cname = names[0]
    planted = "fixprobe" + hashlib.sha256(
        (cname + str(time.time())).encode()).hexdigest()[:16]

    # (2) هل يُدوَّر المعرّف المزروع؟
    p2 = Session(getattr(s, "routes", None))
    data = urllib.parse.urlencode(creds).encode()
    p2.request("POST", f"{base}/login", data=data,
               headers={"Content-Type": "application/x-www-form-urlencoded",
                        "Cookie": f"{cname}={planted}"})
    after = jar_of(p2).get(cname)
    rotated = bool(after) and after != planted

    # (3) البرهان الفارق: زائر بلا كوكي مقابل حامل المعرّف المزروع
    anon = Session(getattr(s, "routes", None))
    st_a, body_a, _ = text(anon.get(f"{base}/dashboard"))
    p3 = Session(getattr(s, "routes", None))
    st_p, body_p, _ = text(p3.request("GET", f"{base}/dashboard",
                                      headers={"Cookie": f"{cname}={planted}"}))
    opened = st_p == 200 and body_p != body_a
    if opened:
        return 1, "ضعف مؤكد", True, \
            f"معرّف جلسة اختاره المهاجم غيّر استجابة {base}/dashboard " \
            "عمّن بلا كوكي — تثبيت جلسة", f"Cookie {cname}=<planted>"
    if rotated:
        return 1, "سليم/غير مؤكد", False, \
            "رُفض المعرّف المزروع وأُصدر بدله عند المصادقة — لا تثبيت", \
            f"Cookie {cname}=<planted>"
    return 1, "سليم/غير مؤكد", False, \
        f"معرّف المهاجم لم يغيّر استجابة الصفحة المحميّة (حالة {st_p})", \
        f"Cookie {cname}=<planted>"


# -- المرحلة 12: GraphQL — استكشاف + غياب تفويض على مستوى الحقل -----------------
@check("GRAPHQL", "GraphQL: استكشاف المخطط وقراءة حقول بلا صلاحية",
       "A1:BrokenAccess", "high", "api")
def c_graphql(s, base, mode):
    """فحص واحد يغطّي صنفين: الاستكشاف يكشف المخطط، وغياب التفويض
    على الحقل يحوّله إلى قراءة بيانات مستخدمين آخرين بلا مصادقة.
    """
    def ask(query):
        body = json.dumps({"query": query}).encode()
        req = urllib.request.Request(
            f"{base}/graphql", data=body, method="POST",
            headers={"Content-Type": "application/json"})
        try:
            with s.opener.open(req, timeout=6) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception:
            return 0, b""

    st_i, body_i = ask("{ __schema { queryType { name } } }")
    intro = st_i == 200 and b"__schema" in body_i

    st_u, body_u = ask('{ user(username:"omari") { username email bio } }')
    leak = st_u == 200 and b'"email"' in body_u and b"omari@local.test" in body_u

    if leak:
        return 1, "ضعف مؤكد", True, \
            ("حقل users يقرأ بريد مستخدم آخر بلا مصادقة"
             + (" مع استكشاف مخطط مفتوح" if intro else "")), \
            '{ user(username:"omari"){ email } } → 200 ببريده'
    if intro:
        return 1, "ضعف مؤكد", True, \
            "الاستكشاف مفتوح: __schema يكشف أنواع الحقول كاملة", \
            "{ __schema { types } } → 200"
    return 1, "سليم/غير مؤكد", False, \
        f"لا استكشاف ولا تسريب حقول (استكشاف {st_i}، حقل {st_u})", \
        "بلا تسريب"


# -- المرحلة 13: حقن عوامل NoSQL في مرشّح مستندات -------------------------------
@check("NOSQLI", "حقن عوامل استعلام في مرشّح مستندات (NoSQL-style)",
       "A3:Injection", "high", "inject")
def c_nosqli(s, base, mode):
    """المختبر لا يشغّل Mongo، لكنه يحاكي نمط بناء الترشيح من المُدخل.
    البرهان فرقي: قيمة نصية لا تطابق أحدًا ⇒ صفر نتائج، والعامل $ne
    يعيد سجلًا. لو أعاد العاملُ ما لم يعده النصّ، فالمُدخل يُنفَّذ كأمر.
    """
    ghost = "zz-nosql-ghost-9183"
    plain = f"{base}/directory?user=" + urllib.parse.quote(ghost)
    op = '{"username": {"$ne": null}}'
    operator = f"{base}/directory?user=" + urllib.parse.quote(op)

    st1, b1, _ = text(s.get(plain))
    st2, b2, _ = text(s.get(operator))

    def count(body):
        try:
            return int(json.loads(body).get("count", 0))
        except Exception:
            return -1

    n1, n2 = count(b1), count(b2)
    if n1 < 0 or n2 < 0:
        return 1, "غير قابل للقياس", False, \
            f"ردّ غير JSON من /directory ({st1}/{st2}) — لم يُقاس", \
            '{"username":{"$ne":null}}'

    found = n1 == 0 and n2 > 0
    if found:
        return 1, "ضعف مؤكد", True, \
            f"عامل $ne أعاد {n2} سجلًا حيث النصّ أعاد 0 — المُدخل يُنفَّذ كأمر", \
            op
    return 1, "سليم/غير مؤكد", False, \
        f"العامل لم يتجاوز النصّ (نصّ {n1}، عامل {n2}) — لا حقن عوامل", \
        op


# -- المرحلة 14: تأطير الطلبات المتعارض (بِدء smuggle) -------------------------
@check("FRAMING", "قبول ترويسات تأطير متعارضة (Content-Length + Transfer-Encoding)",
       "A5:Misconfiguration", "medium", "proto")
def c_framing(s, base, mode):
    """بِدء طلب مُزاح، لا desync مُثبت.

    المهلة (timeout) لا تميّز بين رفض مقصود وانتظار جسم، فالبرهان هنا
    يجعل الطلب كاملًا تحت التفسيرين معًا: الجسم `0\\r\\n\\r\\n` طوله
    5 بايتات، فهو مُنهي بثٍّ لتفسير chunked، ونصٌّ بطول 5 لتفسير
    Content-Length. فإن ردّ السيرفر فهو قبل التأطير المتعارض ولم
    يرفضه — وهذا هو البِدء (CWE-444). الرفض 4xx يعني تحصينًا سليمًا.
    """
    parsed = urllib.parse.urlparse(base)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    assert_local(host)                       # الرفض قبل أي اتصال
    declare_path(s, "/api/xml")     # مقبس خام: تصريح بالمسار
    req = (
        "POST /api/xml HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Content-Length: 5\r\n"
        "Transfer-Encoding: chunked\r\n"
        "\r\n"
        "0\r\n\r\n"
    ).encode()

    try:
        sock = socket.create_connection((host, port), timeout=6)
    except OSError as e:
        return 1, "غير قابل للقياس", False, \
            f"تعذّر الاتصال بـ{host}:{port} ({e})", "CL=5 + TE=chunked"
    try:
        sock.sendall(req)
        sock.settimeout(6)
        data = b""
        while b"\r\n" not in data and len(data) < 512:
            chunk = sock.recv(512)
            if not chunk:
                break
            data += chunk
    except OSError:
        data = b""
    finally:
        sock.close()

    line = data.split(b"\r\n", 1)[0].decode("latin-1", "replace")
    if not line:
        return 1, "غير قابل للقياس", False, \
            "صمت بلا رفض — لا حكم", "CL=5 + TE=chunked"
    status = 0
    parts = line.split()
    if len(parts) > 1 and parts[1].isdigit():
        status = int(parts[1])

    # 2xx/3xx = قُبل وعُولج ⇒ تأطير متعارض غير مرفوض. 4xx/5xx = رفض.
    found = 200 <= status < 400
    if found:
        return 1, "ضعف مؤكد", True, \
            (f"طلب بـCL وTE معًا قُبل وعُولج ({line.strip()}) بدل رفضه"
             " — بِدء smuggle محتمل"), \
            "CL=5 + TE=chunked + 0\\r\\n\\r\\n"
    return 1, "سليم/غير مؤكد", False, \
        f"التأطير المتعارض مرفوض ({line.strip()}) — لا بِدء smuggle", \
        "CL=5 + TE=chunked"


# -- المرحلة 8: رسائل خطأ تفضح المحرك -----------------------------------------
@check("INFOLEAK", "رسائل خطأ تفضح التقنية الخلفية", "A5:Misconfiguration", "low", "config")
def c_infoleak(s, base, mode):
    resp = s.get(f"{base}/preview?template=" + urllib.parse.quote("{{1/0}}"))
    st, body, _ = text(resp)
    found = st == 200 and ("division by zero" in body or "template error" in body)
    note = ("الخطأ يكشف Jinja/Python — بصمة مجانية للمهاجم"
            if found else "لا إفصاح واضح")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "{{1/0}}"


# -- المرحلة 9: XSS في سياق السمة --------------------------------------------
@check("XSSATTR", "XSS في سياق السمة (كسر value)", "A3:Injection", "medium", "xss")
def c_xss_attr(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا حقن سمات.", "لم يُرسل"
    pl = '" autofocus onfocus=ASATTR9 x="'
    resp = s.get(f"{base}/search?q=" + urllib.parse.quote(pl))
    st, body, _ = text(resp)
    found = st == 200 and pl in body and 'value="' in body
    note = ("الحمولة خام داخل value=\"…\" — السمة تُكسَر وتُنفَّذ عند التركيز"
            if found else "لا انعكاس خام في السمات")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, pl


# -- المرحلة 9: XSS في سياق جافاسكربت ------------------------------------------
@check("XSSJS", "XSS في سياق سلسلة JS (كسر السلسلة)", "A3:Injection", "medium", "xss")
def c_xss_js(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا حقن سلاسل.", "لم يُرسل"
    pl = "';alert(9)//"
    resp = s.get(f"{base}/greet?name=" + urllib.parse.quote(pl))
    st, body, _ = text(resp)
    found = st == 200 and pl in body and "<script>" in body and "var who" in body
    note = ("السلسلة تُكسَر والكود يدخل <script> — تنفيذ عند الزائر"
            if found else "لا انعكاس خام في السكربت")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, pl


# -- المرحلة 9: XSS متعددة السياقات ----------------------------------------------
@check("XSSPOLY", "XSS متعددة السياقات (polyglot)", "A3:Injection", "medium", "xss")
def c_xss_poly(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا حقن مركب.", "لم يُرسل"
    pl = '\'"`><svg/onload=oNcliCk=ASPL9()>'
    resp = s.get(f"{base}/search?q=" + urllib.parse.quote(pl))
    st, body, _ = text(resp)
    found = st == 200 and "oNcliCk=ASPL9()" in body
    note = ("الحمولة المركبة تُعكَس خامًا — تعمل في عدة سياقات معًا"
            if found else "الحمولة المركبة مُنقّاة/مهرّبة")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, pl


# -- المرحلة 9: سياسة CSP ضعيفة -----------------------------------------------------
@check("CSPWEAK", "سياسة CSP ضعيفة قابلة للتجاوز", "A5:Misconfiguration", "low", "config")
def c_cspweak(s, base, mode):
    weak = []
    for path in ("/", "/csp-demo"):
        try:
            st, _, hdrs = text(s.get(f"{base.rstrip('/')}{path}"))
        except Exception:
            continue
        h = {k.lower(): v for k, v in hdrs}
        csp = h.get("content-security-policy", "")
        if not csp:
            continue
        bad = [t for t in ("'unsafe-inline'", "'unsafe-eval'", "data:")
               if t in csp]
        if "*" in csp.replace(";", " ").split():
            bad.append("*")
        if bad:
            weak.append(f"{path}: {', '.join(sorted(set(bad)))}")
    found = bool(weak)
    note = ("توجيهات خطرة: " + " | ".join(weak) if found
            else "لا توجيهات CSP خطرة ظاهرة")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "CSP audit"


# -- المرحلة 10: XXE حقيقي (/api/xml) --------------------------------------
@check("XXE", "كيانات XML خارجية (قراءة ملفات)", "A4:XXE", "high",
       "injection")
def c_xxe(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا كيانات خارجية.", \
            "لم يُرسل"
    import tempfile
    import os as _os
    f = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                    encoding="utf-8")
    mark = "XXE9-" + f.name[-8:].replace(".", "X")
    f.write(mark)
    f.close()
    try:
        uri = "file:///" + f.name.replace("\\", "/")
        xxe = ('<?xml version="1.0"?>'
               '<!DOCTYPE r [<!ENTITY x SYSTEM "' + uri + '">]>'
               "<r>&x;</r>")
        st, body, _ = text(s.request(
            "POST", f"{base}/api/xml", data=xxe.encode(),
            headers={"Content-Type": "application/xml"}))
        found = st == 200 and mark in body
    finally:
        try:
            _os.unlink(f.name)
        except OSError:
            pass
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("الكيان الخارجي قرأ ملفًا من القرص — XXE حقيقي" if found
         else "لا حلّ للكيانات الخارجية"), "file://…"


# -- المرحلة 10: LFI (/page?lang=) ---------------------------------------------
@check("LFI", "تضمين ملف محلي (LFI)", "A1:Injection", "high", "injection")
def c_lfi(s, base, mode):
    probe = "../../target/png_util.py"
    resp = s.get(f"{base}/page?lang=" + urllib.parse.quote(probe))
    st, body, _ = text(resp)
    found = st == 200 and "default_logo" in body
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("ملف بايثون الخادم يُقرأ عبر ../ — تضمين محلي" if found
         else "لا اجتياز مسار"), f"lang={probe}"


# -- المرحلة 10: تعيين جماعي (POST /api/profile) --------------------------------
@check("MASSASSIGN", "تعيين جماعي: ترقية ذاتية لمدير", "A1:BrokenAccessControl",
       "high", "access")
def c_massassign(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا كتابة أدوار.", \
            "لم يُرسل"
    s.post(f"{base}/login", {"username": "omari", "password": "user123"})
    st, body, _ = text(s.request(
        "POST", f"{base}/api/profile",
        data=json.dumps({"is_admin": 1}).encode(),
        headers={"Content-Type": "application/json"}))
    try:
        admin = json.loads(body).get("user", {}).get("is_admin") == 1
    except Exception:
        admin = False
    found = st == 200 and admin
    if found:  # تنظيف فوري: إعادة الدور
        try:
            s.request("POST", f"{base}/api/profile",
                      data=json.dumps({"is_admin": 0}).encode(),
                      headers={"Content-Type": "application/json"})
        except Exception:
            pass
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("حقل is_admin قُبِل — رُقيت مديرًا ثم أُعيد الدور (نظّفنا)"
         if found else "التعيين الجماعي مرفوض"), '{"is_admin":1}'


# -- المرحلة 10: CORS عاكس (/api/data) ------------------------------------------
@check("CORSLAB", "انعكاس CORS مع اعتماد (مختبر)", "A5:Misconfiguration",
       "medium", "config")
def c_corslab(s, base, mode):
    evil = "https://gx9lab.invalid"
    try:
        st, hdrs, _ = s.request("GET", f"{base}/api/data",
                                headers={"Origin": evil})
    except Exception as e:
        return 1, "خطأ", False, f"تعذّر: {e}", evil
    h = {k.lower(): v for k, v in hdrs}
    found = h.get("access-control-allow-origin") == evil and \
        h.get("access-control-allow-credentials", "").lower() == "true"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("يعكس الأصل الأجنبي مع بيانات اعتماد — CORS مكسور" if found
         else "لا انعكاس"), evil


# ------------------------------------------------------------------ التقرير
def build_report(rows, base, target_host, mode, started):
    findings = [r for r in rows if r["verdict"]]
    stats = {}
    for r in rows:
        stats[r["family"]] = stats.get(r["family"], 0) + (1 if r["verdict"] else 0)
    criticals = sum(1 for r in findings if r["severity"] == "critical")
    highs = sum(1 for r in findings if r["severity"] == "high")
    meds = sum(1 for r in findings if r["severity"] == "medium")
    lows = sum(1 for r in findings if r["severity"] == "low")

    # درجة مخاطر إجمالية
    score = sum(SEVERITY[r["severity"]] for r in findings)
    if score >= 10:
        grade = "حرجة جدا"
    elif score >= 6:
        grade = "عالية"
    elif score >= 2:
        grade = "متوسطة"
    else:
        grade = "منخفضة"

    return {
        "meta": {
            "tool": "local_scan", "version": "5.0-stage9",
            "target": base, "host": target_host,
            "mode": mode, "generated_at": started.isoformat(),
            "snapshot": hashlib.sha256(json.dumps([r["code"] for r in rows], ensure_ascii=False).encode()).hexdigest()[:12],
        },
        "summary": {
            "checks_total": len(rows), "findings": len(findings),
            "by_severity": {"critical": criticals, "high": highs, "medium": meds, "low": lows},
            "by_family": stats, "score": score, "grade": grade,
        },
        "findings": findings,
        "all_checks": rows,
    }


def to_md(report):
    lines = ["# تقرير الفحص المحلي", ""]
    m = report["meta"]
    s = report["summary"]
    lines += [
        f"- **الأداة**: {m['tool']} v{m['version']}",
        f"- **الهدف**: `{m['target']}` (اسم: {m['host']})",
        f"- **النمط**: {m['mode']} — {('استشارة' if m['mode']=='interactive' else m['mode'])}",
        f"- **التاريخ**: {m['generated_at']}",
        f"- **الملخص**: {s['findings']}/{s['checks_total']} ثغرة · حرج: {s['by_severity']['critical']} · عالٍ: {s['by_severity']['high']} · وسط: {s['by_severity']['medium']} · منخفض: {s['by_severity']['low']}",
        f"- **المجالات**: {json.dumps(s['by_family'], ensure_ascii=False)}",
        "",
        "## النتائج",
        "",
        "| الثغرة | OWASP | الحرجة | الحالة | الدليل |",
        "|---|---|---|---|---|",
    ]
    for r in report["all_checks"]:
        verdict = "✅" if r["verdict"] else "—"
        lines.append(f"| {r['name']} | {r['owasp']} | {r['severity']} | {verdict} | {r['note']} |")
    lines += [
        "",
        "## درجة الخطر",
        f"**الدرجة**: {s['score']} → **{s['grade']}**",
        "",
        "> تعليمي: موقع محلي فقط (loopback). لا شيء في هذا التقرير خرج من جهازك.",
    ]
    return "\n".join(lines)


# ------------------------------------------------------------------ سجل التدقيق
_PATH_LOCKS: dict = {}
_PATH_LOCKS_GUARD = threading.Lock()


def _process_lock(path: Path):
    """قفل خيوط العملية الواحدة (مضمون ويثبت بالاختبار)."""
    key = str(path.resolve())
    with _PATH_LOCKS_GUARD:
        if key not in _PATH_LOCKS:
            _PATH_LOCKS[key] = threading.Lock()
        return _PATH_LOCKS[key]


def _lock_file(path: Path, timeout=15.0, stale=30.0):
    """Mutex عبر العمليات بمجلد (إنشاء mkdir ذري — لا حذف أثناء قراءة أبدًا).

    حذف الملفات على ويندوز يتعارض مع أي مقبض مفتوح، فيعلق القفل
    للأبد تحت التزامن؛ المجلد يُنشأ/يُزال ذريًا بلا ذلك السباق.
    ملف قديم بنفس الاسم (من نهج سابق) يُزال كحالة خاصة.
    """
    import os as _os
    import time as _t
    path = Path(path)
    lock = path.parent / (path.name + ".lock")
    try:
        if lock.is_file():
            lock.unlink()
    except OSError:
        pass
    deadline = _t.time() + timeout
    while True:
        try:
            _os.mkdir(lock)
            def _release(_lock=lock):
                for _ in range(8):
                    try:
                        _os.rmdir(_lock)
                        return
                    except OSError:
                        _t.sleep(0.02)
            return _release
        except FileExistsError:
            try:
                age = _t.time() - _os.stat(lock).st_mtime
            except OSError:
                age = 0
            if age > stale:
                try:
                    _os.rmdir(lock)
                except OSError:
                    pass
            if _t.time() > deadline:
                raise TimeoutError(f"تعذّر قفل السجل: {path}")
            _t.sleep(0.01)


class AuditLog:
    """hash-chain بسيط: كل سطر يُدخِل أثر السطر السابق — اقتبسه من recon."""

    def __init__(self, path):
        self.path = Path(path)  # يقبل str أو Path
        self.chain = []

    def append(self, entry: dict):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with _process_lock(self.path):
            release = _lock_file(self.path)
            try:
                prev = "0" * 64
                if self.path.exists():
                    lines = [l for l in self.path.read_text(
                        encoding="utf-8").splitlines() if l.strip()]
                    if lines:
                        try:
                            prev = json.loads(lines[-1])["hash"]
                        except Exception:
                            prev = "0" * 64
                payload = json.dumps(entry, ensure_ascii=False,
                                     sort_keys=True).encode()
                h = hashlib.sha256(prev.encode() + payload).hexdigest()
                rec = {**entry, "hash": h, "prev": prev}
                self.chain.append(h)
                with open(self.path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            finally:
                release()

    def verify_tail(self) -> bool:
        """هل السلسلة سليمة من أولها إلى ذيلها؟

        كان rec["prev"] يرفع KeyError على أي سطر بلا سلسلة (مثل سطر
        قديم أوsidecar) بدل أن يُبلغ عن خلل. الفحص يُفترض أن يُخبر
        بالعدم السليم لا أن ينهار.
        """
        if not self.path.exists() or not self.path.read_text(encoding="utf-8").strip():
            return True
        prev = "0" * 64
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except Exception:
                return False
            if not isinstance(rec, dict) or "prev" not in rec or "hash" not in rec:
                return False
            payload = json.dumps(
                {k: v for k, v in rec.items() if k not in ("hash", "prev")},
                ensure_ascii=False, sort_keys=True,
            ).encode()
            h = hashlib.sha256(prev.encode() + payload).hexdigest()
            if rec["prev"] != prev or rec["hash"] != h:
                return False
            prev = h
        return True


# ------------------------------------------------------------------ الاستشارة
def choose_mode() -> str:
    print("\n== استشارة أمنية (قبل أي تنفيذ) ==")
    print("  [1] كشف فقط (قراءة، لا حمولة) — للتعلم/استعراض")
    print("  [2] كشف + إثبات لطيف (دليل غير ضار)")
    print("  [3] كشف + إثبات كامل (تحميل/أمر — داخل جهازك فقط)")
    while True:
        a = input("ما الذي تسمح به الأداة؟ (1/2/3، أو Enter لـ [2]): ").strip() or "2"
        if a == "1":
            return "detect"
        if a == "2":
            return "verify"
        if a == "3":
            return "full"
        print("أدخل 1 أو 2 أو 3.")


# ------------------------------------------------------------------ المدخل
def run(target: str, mode: str, stop=None):
    started = datetime.now(timezone.utc)
    base = f"http://{parse_base(urllib.parse.urlparse(target if '://' in target else 'http://' + target).netloc or target)}/"
    assert_local(urllib.parse.urlparse(base).hostname)
    target_host = parse_base(target)

    s = Session()
    rows = []
    for meta in CHECKS:
        if stop is not None and stop():
            rows.append({
                "code": meta["code"], "name": meta["name"], "owasp": meta["owasp"],
                "severity": meta["severity"], "family": meta["family"],
                "sub_status": 0, "status": "موقوف", "verdict": False,
                "note": "أُوقف يدويًا ⏹", "evidence": "", "mode": mode,
            })
            continue
        if meta["require"] and mode not in meta["require"]:
            rows.append({
                "code": meta["code"], "name": meta["name"], "owasp": meta["owasp"],
                "severity": meta["severity"], "family": meta["family"],
                "sub_status": 0, "status": "موقوف", "verdict": False, "note": "لا يُطبق في هذا النمط.",
                "evidence": "", "mode": mode,
            })
            continue
        try:
            rows.append(run_check(meta, s, base, mode))
        except Exception as e:
            rows.append({
                "code": meta["code"], "name": meta["name"], "owasp": meta["owasp"],
                "severity": meta["severity"], "family": meta["family"],
                "sub_status": 0, "status": "خطأ", "verdict": False, "note": f"{e}", "evidence": "", "mode": mode,
            })

    report = build_report(rows, base, target_host, mode, started)

    aud = AuditLog(Path(__file__).resolve().parents[1] / "reports" / "audit.jsonl")
    aud.append({"event": "scan", "target": base, "mode": mode,
                "findings": report["summary"]["findings"],
                "score": report["summary"]["score"]})
    assert aud.verify_tail()

    outdir = Path(__file__).resolve().parents[1] / "reports"
    outdir.mkdir(exist_ok=True)
    (outdir / "scan_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (outdir / "scan_report.md").write_text(to_md(report), encoding="utf-8")

    # طباعة
    s_ = report["summary"]
    print("\n==== تقرير الفحص المحلي ====")
    print(f"الهدف: {base} ·  النمط: {mode}")
    print(f"فحوصات: {s_['checks_total']} ·  ثغرات مؤكدة: {s_['findings']} ·  الدرجة: {s_['score']} ({s_['grade']})")
    print(f"الحرج: {s_['by_severity']['critical']} ·  عالٍ: {s_['by_severity']['high']} ·  وسط: {s_['by_severity']['medium']} ·  منخفض: {s_['by_severity']['low']}")
    print("\n| الثغرة | OWASP | الحرجة | الحالة | الدليل |")
    print("|---|---|---|---|---|")
    for r in report["all_checks"]:
        flag = "✅" if r["verdict"] else "—"
        print(f"| {r['name']} | {r['owasp']} | {r['severity']} | {flag} | {r['note']} |")
    print(f"\nالتقارير: reports/scan_report.json + scan_report.md")
    return report


def run_external(allow: str, confirm_text: str, target: str, mode: str,
                 deep: bool = False):
    """فحص نطاق خارجي مصرّح: بوابة ثلاثية + تدقيق عام (+ عميق بتصريح)."""
    from targets import canonical
    from generic import audit_target
    if not confirm_text or "أؤكد" not in confirm_text:
        raise ValueError("دون كتابة «أؤكد» لا يعمل أي هدف خارجي.")
    canon = canonical(allow)  # يرفع للرابط الفاسد
    from scoped import Scope
    scope = Scope(mode="authorized", allow=[canon], confirm=True)
    base = (target or canon).rstrip("/") + "/"
    scope.check_url(base)  # الرفض قبل أي اتصال
    from targets import find_target, intrusive_granted
    rec = find_target(canon) or {
        "target": canon, "base": base, "note": "CLI --allow",
        "confirm": "أؤكد",
        "added_at": datetime.now(timezone.utc).isoformat()[:19] + "Z",
    }
    if deep:
        if mode != "verify":
            raise ValueError("الفحص العميق للتحقق (verify) فقط.")
        grant = intrusive_granted(canon)
        if not grant:
            raise ValueError(
                "الفحص العميق مرفوض: سجّل تصريح المالك أولًا "
                "(targets.py --url .. --grant --confirm 'أؤكد أصرّح').")
        from generic import generic_audit
        from deep import deep_audit
        from session import Session
        session = Session(scope)
        grows, disc = generic_audit(session, base, mode)
        drows, _ = deep_audit(session, base, mode)
        rows = grows + drows
        host = urllib.parse.urlsplit(base).hostname or base
        report = build_report(rows, base, host, mode,
                              datetime.now(timezone.utc))
        report["meta"]["scope"] = "authorized"
        report["meta"]["tool"] = "generic_audit+deep"
        report["meta"]["discovery"] = {**disc,
                                       "requests": session.n_requests}
        report["meta"]["authorization"] = {**rec, "intrusive": grant}
    else:
        report = audit_target(scope, base, mode, auth_record=rec)
    n_req = (report.get("meta") or {}).get("discovery", {}).get(
        "requests", "?")
    aud = AuditLog(Path(__file__).resolve().parents[1] / "reports" /
                   "audit.jsonl")
    aud.append({"event": "external-scan", "target": canon, "mode": mode,
                "deep": bool(deep),
                "findings": report["summary"]["findings"],
                "score": report["summary"]["score"],
                "requests": n_req,
                "auth": {"target": rec.get("target"),
                         "added_at": rec.get("added_at"),
                         "note": rec.get("note", "")[:120]}})
    assert aud.verify_tail()
    outdir = Path(__file__).resolve().parents[1] / "reports"
    outdir.mkdir(exist_ok=True)
    from generic import auth_md_block
    (outdir / "scan_report_external.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (outdir / "scan_report_external.md").write_text(
        to_md(report) + auth_md_block(report), encoding="utf-8")
    s_ = report["summary"]
    print("\n==== تقرير النطاق المرخّص ====")
    print(f"الهدف المرخص: {canon} ·  النمط: {mode}")
    print(f"فحوصات: {s_['checks_total']} ·  ثغرات مؤكدة: {s_['findings']} ·  الدرجة: {s_['score']} ({s_['grade']})")
    print("\n| الثغرة | OWASP | الحرجة | الحالة | الدليل |")
    print("|---|---|---|---|---|")
    for r in report["all_checks"]:
        flag = "✅" if r["verdict"] else "—"
        print(f"| {r['name']} | {r['owasp']} | {r['severity']} | {flag} | {r['note']} |")
    print("\nالتقارير: reports/scan_report_external.json + .md")
    print("المنهج: قراءة + GET حميد فقط — بلا POST/رفع/حذف.")
    print(f"الطلبات المرسلة: {n_req} · مسجلة بسلسلة التدقيق audit.jsonl ✓")
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description="سكريبت فحص محلي محمول")
    ap.add_argument("--target", default="",
                    help="الرابط المحلي (يدعم أي مضيف loopback)")
    ap.add_argument("--mode", choices=["detect", "verify", "full", "interactive"],
                    default="interactive",
                    help="نمط الأمان (وإلا يستشيرك تلقائيًا)")
    ap.add_argument("--plugins", default="",
                    help="مجلد إضافات plugins/checks (اختياري، يُدمَج مع الفحوصات)")
    ap.add_argument("--allow", default="",
                    help="نطاق خارجي مصرّح (ثلاثي دقيق) — يتطلب --confirm-text")
    ap.add_argument("--confirm-text", default="",
                    help="نص التوكيد (يجب أن يحوي «أؤكد») للهدف الخارجي")
    ap.add_argument("--deep", action="store_true",
                    help="فحص عميق (يتطلب تصريح المالك المسجل + verify)")
    ap.add_argument("--certify", action="store_true",
                    help="شهادة جاهزية البرنامج (معايرة + خصوصية + بوابات)")
    ap.add_argument("--lab", default="http://127.0.0.1:5001/",
                    help="قاعدة المختبر للمعايرة")
    args = ap.parse_args(argv)
    if args.certify:
        from certify import certify_all
        cert = certify_all(args.lab)
        print("\n==== شهادة جاهزية البرنامج ====")
        print(f"المعايرة (مختبر): {'✓' if cert['lab']['pass'] else '✗'} "
              f"{cert['lab']['detail']}")
        print(f"الخصوصية (مصلَّب): {'✓' if cert['stub']['pass'] else '✗'} "
              f"{cert['stub']['detail']}")
        print(f"البوابات: {'✓' if cert['gates']['pass'] else '✗'} "
              f"{sum(1 for v in cert['gates']['checks'].values() if v is True)}"
              f"/{len(cert['gates']['checks'])}")
        print(f"الحكم: {cert['verdict']}")
        print(f"الملف: {cert['file']}")
        for n in cert["notes"]:
            print(f"  · {n}")
        return 0 if cert["verdict"].startswith("جاهز") else 2
    if args.allow:
        mode = args.mode if args.mode != "interactive" else "verify"
        if mode not in ("detect", "verify"):
            raise ValueError("النطاق الخارجي: detect أو verify فقط.")
        run_external(args.allow, args.confirm_text, args.target, mode,
                     deep=args.deep)
        return 0
    if args.plugins:
        n, errs = load_plugins(args.plugins)
        print(f"إضافات: {n} محمّلة" + (f" · أخطاء: {len(errs)}" if errs else ""))
    mode = args.mode if args.mode != "interactive" else choose_mode()
    run(args.target or "http://127.0.0.1:5001/", mode)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
