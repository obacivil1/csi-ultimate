"""
local-lab/scanner/generic.py — تدقيق عام لأي نطاق مصرّح.
==========================================================
يعكس كل قدرات البرنامج على هدف خارجي مصرّح عبر الاستكشاف:
يزحف الموقع، يستخرج المعاملات والنماذج والسكربتات، ثم يطبق
فحوصات غير مُدمِّرة بمعايير OWASP (نفس صفوف التقرير).

قواعد السلامة المهنية (Bug Bounty):
  - قراءة + GET حميد فقط. لا POST ولا رفع ولا حذف على هدف خارجي أبدًا.
  - الحمولات «كناري» حميدة: وسم مجهول لا يُنفَّذ، نص لا يضر.
  - سقف طلبات (زحف ≤25 صفحة + ~30 مسارًا + كناري محدود) — لا قصف.
  - detect: سلبي فقط (ترويسات/كوكيز/ملفات/تحليل ساكن).
  - verify: + كناري انعكاس واحد لكل معامل.

العقد: generic_audit(session, base, mode) — الاكتشاف يُخزَّن على
الجلسة نفسها (s._generic_ctx) لأن run_check يمررها للفحوصات.
"""
import random
import re
import time
import urllib.parse

# إيقاع مهذب بين طلبات الفحص الخارجي (ثانية) — لا قصف لمواقع حقيقية.
POLITE_DELAY = 0.15

try:
    from .local_scan import build_report, fetch_no_follow, run_check
    from .scoped import Scope
    from .session import Session
except ImportError:  # تشغيل مباشر/اختبارات خارج الحزمة
    from local_scan import build_report, fetch_no_follow, run_check
    from scoped import Scope
    from session import Session

try:
    from ..recon_lab.crawler import crawl, discover_common, fetch_robots
except ImportError:
    try:
        import sys as _sys
        from pathlib import Path as _Path
        _sys.path.insert(
            0, str(_Path(__file__).resolve().parents[1] / "recon_lab")
        )
        from crawler import crawl, discover_common, fetch_robots
    except ImportError:
        crawl = discover_common = fetch_robots = None

try:
    from ..recon_lab.js import extract_script_urls
    from ..recon_lab.jsharvest import find_secrets
except ImportError:
    try:
        from js import extract_script_urls
        from jsharvest import find_secrets
    except ImportError:
        extract_script_urls = find_secrets = None

try:
    from ..engine.domxss import analyze_js
except ImportError:
    try:
        import sys as _sys2
        from pathlib import Path as _Path2
        _sys2.path.insert(
            0, str(_Path2(__file__).resolve().parents[1] / "engine"))
        from domxss import analyze_js
    except ImportError:
        analyze_js = None

GENERIC_CHECKS: list = []

# سقوف الحماية من القصف
MAX_PARAMS = 12
MAX_SCRIPTS = 4
MAX_BYTES = 200 * 1024
#: dirbust-lite يرسل 11 مسارًا ثم يزحف 25 صفحة. على هدف مرخّص هذا قصف
#: بلا فاصل — كان بلا rate limiting إطلاقًا. المختبر الحلقي لا يُبطَّأ.
EXTERNAL_RPS = 4.0
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}


def _external_limiter(base: str | None = None):
    """محدّد معدّل للزحف على هدف خارجي، أو None للمختبر الحلقي."""
    try:
        host = urllib.parse.urlsplit(base or "").hostname or ""
        if not host or host.lower() in _LOOPBACK_HOSTS:
            return None
    except Exception:
        return None
    try:
        from ratelimit import RateLimiter
    except ImportError:
        try:
            from util.ratelimit import RateLimiter
        except Exception:
            return None
    return RateLimiter(EXTERNAL_RPS)


PROBE_PATHS = [
    "admin", "login", "upload", "robots.txt", "sitemap.xml", ".git/HEAD",
    "api", "wp-admin", "server-status", "backup.zip", ".env",
]
REDIRECT_NAMES = {
    "next", "redirect", "redirect_to", "redirectto", "url", "return",
    "return_to", "returnto", "dest", "destination", "continue", "target",
    "to", "redir", "relay", "forward", "r",
}
SQL_SIGNS = (
    "sql syntax", "mysql", "ora-", "sqlite", "psycopg2", "pg_query",
    "odbc", "jdbc", "adodb", "unterminated", "quoted string",
    "sqlstate", "conversion failed", "odbc driver", "warning: mysqli",
    "supplied argument", "fetch_array", "syntax error",
)


def gcheck(code, name, owasp, severity_key, family):
    def deco(fn):
        GENERIC_CHECKS.append({
            "code": code, "name": name, "owasp": owasp,
            "severity": severity_key, "family": family, "fn": fn,
        })
        return fn
    return deco


def _ctx(s) -> dict:
    return getattr(s, "_generic_ctx", None) or {}


def _text(resp):
    st, hdrs, raw = resp
    try:
        body = raw.decode("utf-8", "replace")
    except Exception:
        body = ""
    return st, body, hdrs


def _hmap(hdrs):
    return {k.lower(): v for k, v in (hdrs or [])}


# ------------------------------------------------------------- اكتشاف
def discover(session, base: str) -> dict:
    """زحف محدود + معاملات + سكربتات. يُستدعى مرة واحدة لكل تدقيق."""
    ctx: dict = {"params": [], "redirect_params": [],
                 "scripts": [], "pages": 0, "homepage": {},
                 "login_forms": [], "upload_forms": []}
    root = base.rstrip("/") + "/"
    try:
        st, body, hdrs = _text(session.get(root, timeout=6))
    except Exception:
        st, body, hdrs = 0, "", []
    ctx["homepage"] = {"status": st, "body": body, "headers": hdrs}
    seen_p = set()
    if crawl is not None:
        try:
            scope = getattr(session, "scope", None) or Scope()
            cmap = crawl(session, root, max_pages=25, max_depth=2,
                         scope=scope, probe_common=False, workers=1,
                                            limiter=_external_limiter(base))
        except Exception:
            cmap = {}
        for u in (cmap.get("endpoints") or [])[:60]:
            try:
                q = urllib.parse.parse_qsl(
                    urllib.parse.urlsplit(u).query, keep_blank_values=True)
            except Exception:
                continue
            for k, _ in q:
                if k and (u, k) not in seen_p:
                    seen_p.add((u, k))
                    ctx["params"].append((u, k))
                    if k.lower() in REDIRECT_NAMES:
                        ctx["redirect_params"].append((u, k))
        for f in cmap.get("forms") or []:
            names = {(i.get("name") or "").lower() for i in
                     f.get("inputs") or []}
            types = {(i.get("type") or "").lower() for i in
                     f.get("inputs") or []}
            if (f.get("method") or "GET").upper() != "GET":
                # نماذج POST تُحفَظ للفحص العميق فقط (بتصريح المالك):
                # دخول (حقل كلمة مرور) أو رفع (حقل ملف).
                entry = {"action": f["action"],
                         "inputs": [i.get("name") or "" for i in
                                    f.get("inputs") or []]}
                if names & {"password", "passwd", "pwd", "pass"}:
                    user = next((i.get("name") or "" for i in
                                 f.get("inputs") or []
                                 if (i.get("name") or "").lower() in
                                 {"username", "user", "email", "login"}),
                                "username")
                    entry["user_field"] = user
                    if entry not in ctx["login_forms"]:
                        ctx["login_forms"].append(entry)
                if "file" in types:
                    ffield = next((i.get("name") or "" for i in
                                   f.get("inputs") or []
                                   if (i.get("type") or "").lower()
                                   == "file"), "file")
                    entry["file_field"] = ffield
                    if entry not in ctx["upload_forms"]:
                        ctx["upload_forms"].append(entry)
                continue
            for inp in f.get("inputs") or []:
                nm = inp.get("name") or ""
                if nm and (f["action"], nm) not in seen_p:
                    seen_p.add((f["action"], nm))
                    ctx["params"].append((f["action"], nm))
        ctx["pages"] = len(cmap.get("pages") or [])
        for sc in cmap.get("scripts") or []:
            if sc.get("src") and len(ctx["scripts"]) < MAX_SCRIPTS:
                ctx["scripts"].append(sc["src"])
    if discover_common is not None:
        try:
            ctx["probed"] = discover_common(session, base,
                                            wordlist=PROBE_PATHS,
                         limiter=_external_limiter(root))
        except Exception:
            ctx["probed"] = []
    else:
        ctx["probed"] = []
    # سكربتات الصفحة الرئيسية أيضًا
    if extract_script_urls is not None and body:
        try:
            scope = getattr(session, "scope", None)
            for src in sorted(extract_script_urls(body, root, scope)):
                if src not in ctx["scripts"] and \
                        len(ctx["scripts"]) < MAX_SCRIPTS:
                    ctx["scripts"].append(src)
        except Exception:
            pass
    return ctx


def _with_param(url: str, param: str, value: str) -> str:
    parts = list(urllib.parse.urlsplit(url))
    q = urllib.parse.parse_qsl(parts[3], keep_blank_values=True)
    q = [(k, value if k == param else v) for k, v in q]
    if not any(k == param for k, _ in q):
        q.append((param, value))
    parts[3] = urllib.parse.urlencode(q)
    return urllib.parse.urlunsplit(parts)


# ------------------------------------------------------------- فحوصات
@gcheck("G-SECHDRS", "ترويسات أمان ناقصة (عام)", "A5:Misconfiguration",
        "medium", "config")
def g_sechdrs(s, base, mode):
    h = _hmap(_ctx(s).get("homepage", {}).get("headers"))
    want = ("content-security-policy", "x-frame-options",
            "x-content-type-options", "referrer-policy",
            "permissions-policy")
    missing = [k for k in want if k not in h]
    if base.startswith("https://") and "strict-transport-security" not in h:
        missing.append("strict-transport-security")
    found = len(missing) >= 2
    note = ("ناقص: " + "، ".join(missing) if found
            else "الترويسات الأساسية حاضرة")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, "GET /"


@gcheck("G-CSP", "سياسة CSP ضعيفة (عام)", "A5:Misconfiguration",
        "low", "config")
def g_csp(s, base, mode):
    csp = _hmap(_ctx(s).get("homepage", {}).get("headers")).get(
        "content-security-policy", "")
    if not csp:
        return 1, "سليم/غير مؤكد", False, "لا CSP أصلًا (يغطيها G-SECHDRS).", \
            "CSP audit"
    bad = [t for t in ("'unsafe-inline'", "'unsafe-eval'", "data:")
           if t in csp]
    if "*" in csp.replace(";", " ").split():
        bad.append("*")
    found = bool(bad)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("توجيهات خطرة: " + ", ".join(sorted(set(bad))) if found
         else "لا توجيهات خطرة ظاهرة"), "CSP audit"


@gcheck("G-COOKIES", "أعلام كوكيز ناقصة (عام)", "A2:BrokenAuth",
        "medium", "auth")
def g_cookies(s, base, mode):
    probe = Session(getattr(s, "scope", None) or Scope())
    try:
        probe.get(base.rstrip("/") + "/", timeout=6)
    except Exception:
        pass
    weak = [n for n, _, sec, httponly in probe.cookies()
            if not sec or not httponly]
    rest = [getattr(c, "_rest", {}) or {} for c in probe.jar]
    no_samesite = sum(1 for r in rest
                      if "samesite" not in {k.lower() for k in r})
    found = bool(weak)
    note = ("بلا Secure/HttpOnly: " + ", ".join(weak[:4]) if found
            else "لا كوكيز ضعيفة ظاهرة")
    if no_samesite and not found:
        note += " (تنبيه: بلا SameSite)"
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, note, \
        f"{len(probe.cookies())} cookies"


@gcheck("G-SECTXT", "ملف security.txt مفقود (عام)", "A5:Misconfiguration",
        "low", "config")
def g_sectxt(s, base, mode):
    try:
        st, _, _ = s.get(base.rstrip("/") + "/.well-known/security.txt",
                         timeout=6)
    except Exception:
        st = 0
    found = st != 200
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("لا قناة تواصل معلنة للباحثين" if found else "موجود ✓"), \
        "/.well-known/security.txt"


@gcheck("G-TECHLEAK", "بصمة تقنية مكشوفة (عام)", "A5:Misconfiguration",
        "low", "config")
def g_techleak(s, base, mode):
    hp = _ctx(s).get("homepage", {})
    h = _hmap(hp.get("headers"))
    leaks = []
    for k in ("server", "x-powered-by", "x-aspnet-version", "x-generator"):
        v = h.get(k, "")
        if v and re.search(r"php|asp|python|nginx/|apache/|iis|node|django|flask",
                           v, re.IGNORECASE):
            leaks.append(f"{k}: {v[:40]}")
    body = hp.get("body", "")
    m = re.search(r'<meta\s[^>]*name=["\']generator["\'][^>]*>',
                  body, re.IGNORECASE)
    if m:
        leaks.append("meta generator")
    found = bool(leaks)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("يكشف: " + " | ".join(leaks[:3]) if found else "لا بصمة واضحة"), \
        "headers+meta"


@gcheck("G-ROBOTS", "مسارات حساسة في robots (عام)", "A5:Misconfiguration",
        "low", "config")
def g_robots(s, base, mode):
    paths = []
    if fetch_robots is not None:
        try:
            paths = fetch_robots(s, base)
        except Exception:
            pass
    hot = [p for p in paths if re.search(
        r"admin|backup|config|\.git|private|test|dev|dump|\.sql|\.bak|old|tmp|secret|internal",
        p, re.IGNORECASE)]
    found = bool(hot)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("مسارات لافتة: " + ", ".join(hot[:5]) if found
         else f"robots عادي ({len(paths)} مسارًا)"), "/robots.txt"


@gcheck("G-CORS", "انعكاس Origin (CORS)", "A5:Misconfiguration",
        "medium", "config")
def g_cors(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا اختبار انعكاس.", "لم يُرسل"
    evil = "https://gx9lab.invalid"
    try:
        st, body, hdrs = _text(s.request(
            "GET", base.rstrip("/") + "/", headers={"Origin": evil},
            timeout=6))
    except Exception as e:
        return 1, "خطأ", False, f"تعذّر: {e}", evil
    h = _hmap(hdrs)
    acao, acac = h.get("access-control-allow-origin", ""), \
        h.get("access-control-allow-credentials", "").lower()
    found = (acao == evil) or (acao == "*" and acac == "true")
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        (f"يعكس Origin الأجنبي ({acao})" if found else "لا انعكاس"), evil


@gcheck("G-HOSTHDR", "تسميم Host عبر X-Forwarded-Host", "A5:Misconfiguration",
        "medium", "config")
def g_hosthdr(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا ترويسة مزيفة.", "لم يُرسل"
    mark = "gx9.invalid"
    try:
        st, body, _ = _text(s.request(
            "GET", base.rstrip("/") + "/",
            headers={"X-Forwarded-Host": mark,
                     "X-Forwarded-Proto": "https"}, timeout=6))
    except Exception as e:
        return 1, "خطأ", False, f"تعذّر: {e}", mark
    found = mark in body
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("الترويسة المزيفة تنعكس — تسميم روابط/إعادة ضبط محتمل" if found
         else "لا انعكاس"), "X-Forwarded-Host"


@gcheck("G-XSSPARAM", "انعكاس خام في معاملات (XSS)", "A3:Injection",
        "medium", "xss")
def g_xssparam(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا كناري.", "لم يُرسل"
    hit = []
    for url, param in _ctx(s).get("params", [])[:MAX_PARAMS]:
        pl = "<gx9qz7t>"
        try:
            st, body, _ = _text(s.get(_with_param(url, param, pl),
                                     timeout=6))
        except Exception:
            continue
        if st == 200 and pl in body:
            label = f"{urllib.parse.urlsplit(url).path or '/'}?{param}"
            if label not in hit:
                hit.append(label)
            if len(hit) >= 3:
                break
    found = bool(hit)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("انعكاس خام في: " + " ، ".join(hit) if found
         else "لا انعكاس خام في المعاملات المكتشفة"), "<gx9qz7t>"


@gcheck("G-OPENREDIR", "توجيه مفتوح في معاملات (عام)", "A10:Redirect",
        "medium", "access")
def g_openredir(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا كناري.", "لم يُرسل"
    dest = "https://example.com/gx9"
    hit = []
    for url, param in _ctx(s).get("redirect_params", [])[:MAX_PARAMS]:
        try:
            st, hdrs, _ = fetch_no_follow(
                s, _with_param(url, param, dest), timeout=6)
        except Exception:
            continue
        loc = next((v for k, v in hdrs if k.lower() == "location"), "")
        if st in (301, 302, 303, 307, 308) and "example.com/gx9" in loc:
            hit.append(f"{urllib.parse.urlsplit(url).path or '/'}?{param}")
            if len(hit) >= 3:
                break
    found = bool(hit)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("يتبع وجهة خارجية: " + " ، ".join(hit) if found
         else "لا توجيه خارجي في المعاملات المكتشفة"), dest


@gcheck("G-SQLIERR", "رسائل خطأ قواعد بيانات (عام)", "A1:Injection",
        "high", "injection")
def g_sqlierr(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا فاصلة.", "لم يُرسل"
    hit = []
    for url, param in _ctx(s).get("params", [])[:MAX_PARAMS]:
        try:
            st, body, _ = _text(s.get(_with_param(url, param, "gx9'"),
                                     timeout=6))
        except Exception:
            continue
        low = body.lower()
        if st == 200 and any(sig in low for sig in SQL_SIGNS):
            hit.append(f"{urllib.parse.urlsplit(url).path or '/'}?{param}")
            if len(hit) >= 3:
                break
    found = bool(hit)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("الفاصلة تُظهر خطأ قاعدة بيانات في: " + " ، ".join(hit) if found
         else "لا بصمة قواعد بيانات"), "gx9'"


@gcheck("G-METHODS", "طرق HTTP خطرة (PUT/DELETE/TRACE)", "A5:Misconfiguration",
        "low", "config")
def g_methods(s, base, mode):
    if mode == "detect":
        return 1, "مقروء", False, "وضع detect: لا اختبار طرق.", "لم يُرسل"
    bad = []
    try:
        st, hdrs, _ = s.request("OPTIONS", base.rstrip("/") + "/",
                                timeout=6)
        allow = next((v for k, v in hdrs if k.lower() == "allow"), "")
        bad += [m for m in ("PUT", "DELETE") if m in allow.upper()]
    except Exception:
        pass
    try:
        st2, body2, _ = _text(s.request("TRACE", base.rstrip("/") + "/",
                                        timeout=6))
        if st2 == 200:
            bad.append("TRACE(200)")
    except Exception:
        pass
    found = bool(bad)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("طرق لافتة: " + ", ".join(bad) if found else "طرق محافظة"), \
        "OPTIONS+TRACE"


@gcheck("G-DOMXSS", "تدفقات DOM-XSS (عام)", "A3:Injection",
        "medium", "xss")
def g_domxss(s, base, mode):
    if analyze_js is None:
        return 0, "خطأ", False, "وحدة domxss غير متاحة.", "/"
    flows = []
    for src in _ctx(s).get("scripts", [])[:MAX_SCRIPTS]:
        try:
            st, _, raw = s.get(src, timeout=6)
        except Exception:
            continue
        if st != 200:
            continue
        try:
            js = raw[:MAX_BYTES].decode("utf-8", "replace")
        except Exception:
            continue
        for f in analyze_js(js, src)[:4]:
            flows.append(f"{src.split('/')[-1]}:{f['sink_line']}: "
                         f"{f['source']} → {f['sink']}")
            if len(flows) >= 3:
                break
    found = bool(flows)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("تدفقات خطرة: " + " | ".join(flows) if found
         else "لا تدفق مصدر→مصرف في السكربتات"), f"{len(flows)} تدفق"


@gcheck("G-JSSECRET", "أسرار في JS عام (عام)", "A5:Misconfiguration",
        "high", "config")
def g_jssecret(s, base, mode):
    if find_secrets is None:
        return 0, "خطأ", False, "وحدة jsharvest غير متاحة.", "/"
    found_kinds = []
    for src in _ctx(s).get("scripts", [])[:MAX_SCRIPTS]:
        try:
            st, _, raw = s.get(src, timeout=6)
        except Exception:
            continue
        if st != 200:
            continue
        try:
            js = raw[:MAX_BYTES].decode("utf-8", "replace")
        except Exception:
            continue
        for g in find_secrets(js)[:4]:
            label = f"{src.split('/')[-1]}:{g['line']}:{g['kind']}"
            if label not in found_kinds:
                found_kinds.append(label)
            if len(found_kinds) >= 4:
                break
    found = bool(found_kinds)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("أسرار في JS عام: " + " | ".join(found_kinds) if found
         else "لا أسرار في السكربتات"), f"{len(found_kinds)} سر"


# ------------------------------------------------------------- التشغيل
def generic_audit(session, base: str, mode: str = "verify", stop=None):
    """يزحف مرة واحدة ثم يطبق GENERIC_CHECKS. يعيد (rows, discovery).

    stop: دالة اختيارية توقف الحلقة (زر الإيقاف) — تُفحَص قبل كل فحص.
    """
    base = base.rstrip("/") + "/"
    session._generic_ctx = discover(session, base)
    rows = []
    for meta in GENERIC_CHECKS:
        if stop is not None and stop():
            rows.append({
                "code": meta["code"], "name": meta["name"],
                "owasp": meta["owasp"], "severity": meta["severity"],
                "family": meta["family"], "sub_status": 0,
                "status": "موقوف", "verdict": False,
                "note": "أُوقف يدويًا ⏹", "evidence": "", "mode": mode,
            })
            continue
        try:
            rows.append(run_check(meta, session, base, mode))
        except Exception as e:
            rows.append({
                "code": meta["code"], "name": meta["name"],
                "owasp": meta["owasp"], "severity": meta["severity"],
                "family": meta["family"], "sub_status": 0, "status": "خطأ",
                "verdict": False, "note": str(e)[:200], "evidence": "",
                "mode": mode,
            })
        time.sleep(POLITE_DELAY + random.uniform(0, 0.10))
    return rows, {"pages": session._generic_ctx.get("pages", 0),
                  "params": len(session._generic_ctx.get("params", [])),
                  "scripts": len(session._generic_ctx.get("scripts", [])),
                  "probed": session._generic_ctx.get("probed", []),
                  "requests": getattr(session, "n_requests", 0)}


def audit_target(scope, base: str, mode: str = "verify",
                 auth_record: dict | None = None, started=None):
    """تدقيق كامل لهدف مصرّح: جلسة + فحوصات + تقرير بسجل تفويض."""
    from datetime import datetime, timezone
    started = started or datetime.now(timezone.utc)
    session = Session(scope)
    rows, discovery = generic_audit(session, base, mode)
    host = urllib.parse.urlsplit(base).hostname or base
    report = build_report(rows, base, host, mode, started)
    report["meta"]["scope"] = getattr(scope, "mode", "authorized")
    report["meta"]["tool"] = "generic_audit"
    report["meta"]["discovery"] = discovery
    report["meta"]["authorization"] = auth_record
    return report


def auth_md_block(report) -> str:
    """كتلة تفويض تُلحَق بملف MD (لا نمسّ to_md الأصلي)."""
    a = (report.get("meta") or {}).get("authorization") or {}
    if not a:
        return ""
    return ("\n## التفويض\n\n"
            f"- **الهدف المرخص**: `{a.get('target', '')}`\n"
            f"- **أُضيف بتفويض**: {a.get('added_at', '')}\n"
            f"- **البيان**: {a.get('note', '—')}\n"
            "- **المنهج**: قراءة + GET حميد فقط — بلا POST/رفع/حذف.\n")
