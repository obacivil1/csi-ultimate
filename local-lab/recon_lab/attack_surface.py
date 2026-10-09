"""
recon_lab/attack_surface.py — محلل سطح الهجوم (تحليل بيانات الموقع).
===============================================================
من الخريطة + البصمة + الترويسات يبني تقرير سطح هجوم مُسجَّل:
  - جرد المعاملات (مواقعها ونقاطها) والمصارف الخطرة (file/url/host/…).
  - تغطية المصادقة: أي المسارات محمية (302 للogin / 401 / 403) وأيها مفتوح.
  - نماذج بلا رمز CSRF، نماذج رفع، حقول كلمات مرور.
  - انكشاف (robots/sitemap/نسخ احتياطية/بانر إصدار) وفجوات تصليب.
النتيجة: درجة تعرّض (أعلى = أسوأ) + تقدير + توصيات عربية مرتبة.
الأوزان حتمية وموثقة أدناه — أي تغيير فيها مقصود ومرئي.
"""
import re
import urllib.error
import urllib.parse
import urllib.request


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

SINK_CLASSES = {
    "file": "قراءة ملفات (LFI/Traversal)", "path": "قراءة ملفات",
    "read": "قراءة ملفات", "load": "قراءة ملفات",
    "template": "قوالب (SSTI)", "url": "جلب خادم (SSRF)",
    "host": "أوامر نظام (CMDI)", "cmd": "أوامر نظام",
    "next": "توجيه مفتوح", "redirect": "توجيه مفتوح",
    "q": "حقن (SQLi/XSS)", "query": "حقن", "search": "حقن",
    "name": "حقن", "email": "حقن/تسميم", "username": "مصادقة",
    "password": "مصادقة", "token": "مصادقة",
}
# الوزن: (الحدث، النقاط). المجموع = درجة التعرض.
W_UPLOAD_FORM = 10
W_SINK = 6
W_OPEN_STATE_CHANGE = 8
W_NO_CSRF = 4
W_MISSING_HEADER = 5
W_WEAK_COOKIE = 5
W_EXPOSURE = 4
W_VERSION_BANNER = 3
W_AUTH_BYPASS_EVIDENCE = 12


def _path_of(url):
    return urllib.parse.urlsplit(url).path or "/"


def analyze(crawlmap, fingerprint=None, headreport=None, auth_map=None,
            hints=None):
    """hints: قاموس {path: [params]} لمسارات غير مربوطة (من المسح النشط)."""
    points = []
    score = 0
    notes = []

    def add(pts, note):
        nonlocal score
        score += pts
        notes.append(f"(-{pts}) {note}")

    # ---- 1) جرد المعاملات والمصارف ----
    params = {}  # name -> set(paths)
    for e in crawlmap.get("endpoints", []):
        p = urllib.parse.urlsplit(e)
        for k, _ in urllib.parse.parse_qsl(p.query, keep_blank_values=True):
            params.setdefault(k, set()).add(p.path or "/")
    for f in crawlmap.get("forms", []):
        for i in f.get("inputs", []):
            if i.get("name"):
                params.setdefault(i["name"], set()).add(
                    _path_of(f.get("action", "")) + f"[{f.get('method', 'GET')}]")
    for path, names in (hints or {}).items():
        for n in names:
            params.setdefault(n, set()).add(path + "[تلميح]")
    points.append(f"المعاملات: {len(params)} مميزة")
    for name, where in sorted(params.items()):
        if name.lower() in SINK_CLASSES:
            add(W_SINK, f"مصرف خطر: {name} ({SINK_CLASSES[name.lower()]}) "
                        f"في {len(where)} موضع")
    # ---- 2) النماذج: رفع/حالة/CSRF ----
    for f in crawlmap.get("forms", []):
        names = {i.get("name", "").lower() for i in f.get("inputs", [])}
        types = {i.get("type", "text").lower() for i in f.get("inputs", [])}
        if "file" in types:
            add(W_UPLOAD_FORM, f"نموذج رفع في {f.get('action')}")
        if f.get("method", "GET").upper() == "POST" and \
                not ({"csrf", "token", "nonce"} & names):
            add(W_NO_CSRF, f"نموذج POST بلا رمز حماية: {f.get('action')}")
    # ---- 3) تغطية المصادقة ----
    if auth_map:
        open_paths = [p for p, v in auth_map.items() if v == "open"]
        prot = [p for p, v in auth_map.items() if v != "open"]
        points.append(f"مسارات مفتوحة: {len(open_paths)} · محمية: {len(prot)}")
        for p in sorted(open_paths):
            if any(k in p for k in ("admin", "dashboard", "settings",
                                    "upload", "api/")):
                add(W_OPEN_STATE_CHANGE, f"مسار حساس مفتوح: {p}")
    # ---- 4) انكشاف ----
    for r in crawlmap.get("robots", []) + crawlmap.get("sitemap", []):
        add(0, f"انكشاف معلن: {r}")
        points.append(f"معلن: {r}")
    for e in crawlmap.get("endpoints", []):
        low = e.lower()
        if any(k in low for k in (".git/", ".env", "backup", ".bak",
                                  "db.sqlite", ".sql", "phpinfo")):
            add(W_EXPOSURE, f"ملف حساس مكشوف: {e}")
    # ---- 5) البصمة والتصليب ----
    if fingerprint:
        srv = fingerprint.get("server", "")
        m = re.search(r"[\d.]+", srv)
        if srv and m:
            add(W_VERSION_BANNER, f"بانر إصدار: {srv[:40]}")
        for g in fingerprint.get("framework_guesses", []):
            points.append(f"تخمين إطار: {g}")
        for n in fingerprint.get("notes", []):
            add(W_VERSION_BANNER, f"مكتبة قديمة: {n}")
    if headreport:
        for f in headreport.get("findings", []):
            if f.get("state") == "ناقص" and f.get("severity") == "medium":
                add(W_MISSING_HEADER, f"ترويسة ناقصة: {f['item']}")
            elif f.get("state") == "ضعيف" and f["item"].startswith("Cookie:"):
                add(W_WEAK_COOKIE, f"كوكي ضعيف: {f['item']}")
    grade = ("ضيق" if score <= 15 else "متوسط" if score <= 35
             else "واسع" if score <= 60 else "حرج")
    recs = []
    if any("مصرف خطر" in n for n in notes):
        recs.append("تحقق من كل مصرف خطر بحقن مصنف (المسح النشط يغطيها).")
    if any("بلا رمز" in n for n in notes):
        recs.append("أضف رموز CSRF لكل نماذج POST المغيرة للحالة.")
    if any("ترويسة ناقصة" in n for n in notes):
        recs.append("فعّل CSP وX-Frame-Options وnosniff.")
    if any("مفتوح" in n for n in notes):
        recs.append("راجع المسارات الحساسة المفتوحة بتحقق صلاحية.")
    if not recs:
        recs.append("السطح ضيق — حافظ عليه بالمراقبة الدورية.")
    return {"score": score, "grade": grade, "points": points,
            "notes": notes, "recommendations": recs,
            "params": {k: sorted(v) for k, v in params.items()}}


def probe_auth(session, paths, login_markers=("/login",), timeout=5):
    """يصنّف المسارات: open / login-redirect / denied / error (بحد 25).

    بلا متابعة توجيه عمدًا — المتابعة تُظهر المحمي كأنه مفتوح (302→200).
    """
    try:
        session._guard("http://127.0.0.1/")
    except Exception:
        pass
    opener = urllib.request.build_opener(
        _NoRedirect, urllib.request.HTTPCookieProcessor(session.jar))
    out = {}
    for p in list(paths)[:25]:
        try:
            session._guard(p)
        except Exception:
            out[p] = "out-of-scope"
            continue
        try:
            with opener.open(urllib.request.Request(p, method="GET"),
                             timeout=timeout) as resp:
                st, hdrs = resp.status, resp.getheaders()
        except urllib.error.HTTPError as e:
            st, hdrs = e.code, list(e.headers.items())
        except Exception as e:
            out[p] = f"error:{str(e)[:40]}"
            continue
        loc = next((v for k, v in hdrs if k.lower() == "location"), "")
        if st in (401, 403):
            out[p] = "denied"
        elif st in (301, 302, 303, 307, 308) and \
                any(m in loc for m in login_markers):
            out[p] = "login-redirect"
        elif 200 <= st < 300:
            out[p] = "open"
        else:
            out[p] = f"http-{st}"
    return out
