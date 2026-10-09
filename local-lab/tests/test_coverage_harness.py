"""قياس تغطية الفاحص: كم ضعفًا موثّقًا في المختبر يرصده الفاحص؟

لماذا هذا الملف موجود
---------------------
`local_scan.py --certify` يقيس «عدد النتائج بلا أخطاء» (29/29)، أي أن
الأداة تعمل — ولا يقيس التغطية. لا يوجد في المشروع أي رقم يقول: من
الضعف الموثّق في `target/app.py`، كم يكتشفه الفاحص؟

هذا الملف يبني ذلك الرقم من مصدرين لا من قائمة مكتوبة بخط اليد:
  1. الحقيقة الأرضية: تُستخرج برمجيًا من تعليقات «ضعف مقصود» عبر ast،
     فكل ضعف موثّق في الكود محسوب تلقائيًا ولا يُنسى.
  2. ما رصده الفاحص فعليًا: يُشغَّل على المختبر الحي وتُطابق نواتجه.

المقياس
-------
  coverage = (weaknesses detected) / (weaknesses documented)

ليس مقياسًا لضعف الهدف: المختبر يبقى هشًا بالضبط. هذا مقياس جودة الفحص.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest

LAB = Path(__file__).resolve().parents[1]
APP = LAB / "target" / "app.py"
BASE = "http://127.0.0.1:5001/"


# ─────────────────────────── الحقيقة الأرضية ───────────────────────────
def documented_weaknesses() -> list[dict]:
    """كل ضعف موثّق في target/app.py، مستخرجًا من تعليقات «ضعف مقصود»."""
    src = APP.read_text(encoding="utf-8")
    lines = src.splitlines()
    out: list[dict] = []

    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        path = None
        for d in node.decorator_list:
            if (isinstance(d, ast.Call)
                    and getattr(d.func, "attr", "") == "route"
                    and d.args
                    and isinstance(d.args[0], ast.Constant)):
                path = d.args[0].value
        if not path:
            continue
        for i in range(node.lineno, (node.end_lineno or node.lineno) + 1):
            if "ضعف مقصود" not in lines[i - 1]:
                continue
            tail = lines[i - 1].split("ضعف مقصود", 1)[1].strip()
            cls = None
            m = re.match(r"\(([^)]+)\)", tail)
            if m:
                cls = m.group(1).strip()
            elif "مسار" in tail or "ملف" in tail or "CORS" in tail:
                cls = "غير مصنّف"
            out.append({"route": path, "func": node.name,
                        "line": i, "class": cls or "غير مصنّف",
                        "text": tail[:90]})
    return out


# ثغرات ليست داخل مسار: خطاف after_request وثابت عام.
GLOBAL_WEAKNESSES = [
    {"route": "(after_request hook)", "func": "_cors_lab", "line": 508,
     "class": "CORS", "text": "أي أصل يُقبَل على واجهات /api"},
    {"route": "(module constant)", "func": "JWT_SECRET", "line": 604,
     "class": "Secret Weak", "text": "سر JWT قصير قاموسي secret123"},
]


# عدّاد مقصود: كل ثغرة موثّقة جديدة في target/app.py ترفعه عمدًا،
# فيسقط الاختبار إن نُسي التحديث بدل أن يتوسّع الأرقام أيّ صمتًا.
EXPECTED_WEAKNESSES = 29


# ─────────────────────────── ما رصده الفاحص ───────────────────────────
def run_scanner() -> dict:
    """يشغّل خط الأنابيب الحقيقي: crawl -> active_scan.

    نستعمل crawl لا قائمة نقاط مكتوبة بخط اليد: القائمة اليدوية كانت
    ستحذف مسارات وتضخّم التغطية أو تنقصها بلا مرجع.
    """
    for p in ("scanner", "engine", "recon_lab", "util", "report"):
        sys.path.insert(0, str(LAB / p))
    from activescan import active_scan, extract_points   # noqa: E402
    from crawler import crawl                   # noqa: E402
    from session import Session                 # noqa: E402
    from scoped import Scope                    # noqa: E402

    sess = Session(Scope(mode="loopback"))
    cmap = crawl(sess, BASE, max_pages=25, max_depth=2,
                 scope=Scope(mode="loopback"), probe_common=False,
                 workers=1, limiter=None)
    out = active_scan(sess, cmap, BASE, timeout=6)
    if isinstance(out, dict):
        out["_discovered"] = [urlsplit(e).path for e in
                              (cmap.get("endpoints") or [])]
        out["_points"] = len(extract_points(cmap))
        return out
    return {"findings": out, "_discovered": [], "_points": 0}


def header_signals() -> list[str]:
    """إشارات فحص الترويسات (CORS/CSP) — تُقرأ من المختبر الحي."""
    import urllib.request
    req = urllib.request.Request(
        BASE + "api/data", headers={"Origin": "https://evil.example"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            acao = r.headers.get("Access-Control-Allow-Origin", "")
            creds = r.headers.get("Access-Control-Allow-Credentials", "")
            return [f"{acao}|{creds}"]
    except Exception:
        return []


# ─────────────────────────── المطابقة ───────────────────────────
#: (فئة موثّقة، code يصدره الفاحص، بادئة مسار) -> يطابق؟
MATCH = [
    #Since المسارات تحكم الآن، اتساع الأكواد آمن: الكود لا يُحسب إلا
    # إذا كان مساره الملاحظ يوافق هذا المسار. لذلك صنف واحد يغطي
    # عدة مسارات (غير مصنّف) يأخذ اتحاد أكوادها.
("SQLi", {"SQLBLIND", "SQLTIME", "SQLI", "SQLLOGIN"}, ("/login", "/search")),

    ("Reflected XSS",   {"XSSREFLECT"},                          ("/search",)),
("XSS سياق السمة",    {"XSSATTR"},                   ("/search",)),

    ("Stored XSS",      {"XSSSTORED"},                           ("/blog", "/settings")),
    ("IDOR",            {"IDOR"},                                ("/profile", "/api/me")),
    ("Command Injection", {"CMDI"},                              ("/api/ping",)),
    ("Path Traversal",  {"PATH", "traversal"},                     ("/static-view", "/download")),
    ("SSRF",            {"SSRF"},                                ("/api/fetch",)),
    ("SSTI",            {"SSTI"},                                ("/preview",)),
    ("Open Redirect",   {"OPENREDIR"},                           ("/go",)),
    ("Host Header",     {"HOSTHDR", "HOSTHEADER"},               ("/reset",)),
    ("XXE",             {"XXE"},                                 ("/api/xml",)),
    ("LFI",             {"PATH", "LFI"},                         ("/page",)),
    ("Mass Assignment", {"MASSASSIGN"},                          ("/api/profile",)),
    ("NoSQL Operator Injection", {"NOSQLI"},                      ("/directory",)),
    ("GraphQL", {"GRAPHQL"},                                     ("/graphql",)),
    ("Request Smuggling", {"FRAMING"},                           ("/api/xml",)),
    ("CORS",            {"CORSLAB"},                             ("/api/data", "/api")),
    ("DOM-XSS",         {"DOMXSS"},                              ("/dom",)),
    ("CSP ضعيفة",       {"CSPWEAK"},                             ("/csp-demo",)),
    ("XSS سياق JS",     {"XSSJS"},                               ("/greet",)),
    ("غير مصنّف",       {"UPLOAD", "APIAUTH", "JWTNONE", "JWTWEAK"},
     ("/upload", "/api/me", "/api/token", "/api/whoami")),
    ("Secret Weak",     {"JWTNONE", "JWTWEAK"},                  ("/api/token", "/api/whoami", "")),
]

RULES = {c: (codes, pfx) for c, codes, pfx in MATCH}


def route_prefix(route: str) -> str:
    """/blog/<int:pid> -> /blog/  (الفهرس يطابق المسارات الفعلية)."""
    r = route.split("<")[0].rstrip("/")
    return r or "/"


def _norm_path(p: str) -> str:
    """//login -> /login  (الـbase الممرَّر بشرطة مائلة يجعل //login)."""
    while p.startswith("//"):
        p = p[1:]
    return p or "/"


def _make_recorder(Session, holder: list[str]):
    """يسجّل كل طلب يمرّ عبر session — بأي باب.

    measurement pitfall: there are THREE doors, not one:
      1) Session.request  (get/post ترث منه)
      2) session.opener.open  (تستخدمه كل plug-ins)
      3) module-level fetch_no_follow  (OPENREDIR)
    Closing two of the three leaves silent gaps: the plug-ins were recording
    an empty list of routes even though they were passing.
    """
    class Recorder(Session):
        def __init__(self):
            super().__init__()
            # الفحوص التي تصنع جلسات نظيفة تقرأ هذا الحقل فتُدوّن
            # مساراتها هنا أيضًا؛ بدونه صارت class-only بصمت.
            self.routes = holder
            inner_open = self.opener.open

            def spy_open(req, *a, **kw):
                url = getattr(req, "full_url", "") or ""
                p = _norm_path(urlsplit(url).path)
                if p and p not in holder:
                    holder.append(p)
                return inner_open(req, *a, **kw)

            self.opener.open = spy_open

        def request(self, method, url, *a, **kw):
            p = _norm_path(urlsplit(url).path)
            if p not in holder:
                holder.append(p)
            return super().request(method, url, *a, **kw)
    return Recorder


def observe_check_routes() -> dict[str, list[str]]:
    """يشتق مسارات كل فحص مُسمّى بالملاحظة لا بالتخمين.

    ثلاث إصلاحات لازمة، كل واحد منها كان يُسقط التسجيل بصمت:
      1) الوراثة لا اللفّ: get/post يرثان ويناديان self.request.
      2) fetch_no_follow (يستخدمه OPENREDIR) يتجاوز request تمامًا،
         فنلتفّ عليه ببديل يسجّل ثم يمرّر.
      3) base بلا شرطة أخيرة، وإلا صار كل مسار //login.
    """
    sys.path.insert(0, str(LAB / "scanner"))
    import local_scan                                   # noqa: E402
    from local_scan import CHECKS, run_check, Session   # noqa: E402

    holder: list[str] = []
    Recorder = _make_recorder(Session, holder)
    real_nofollow = local_scan.fetch_no_follow

    def spy_nofollow(session, url, *a, **kw):
        p = _norm_path(urlsplit(url).path)
        if p not in holder:
            holder.append(p)
        return real_nofollow(session, url, *a, **kw)

    local_scan.fetch_no_follow = spy_nofollow
    base = BASE.rstrip("/")
    out: dict[str, list[str]] = {}
    try:
        for meta in CHECKS:
            holder.clear()
            try:
                run_check(meta, Recorder(), base, "verify")
            except Exception:
                pass
            out[meta["code"]] = list(holder)
    finally:
        local_scan.fetch_no_follow = real_nofollow
    return out


def observe_plugin_routes() -> dict[str, list[str]]:
    """نفس المنطق للـplug-ins، وإلا بقيت HOSTHDR وDOMXSS class-only."""
    for p in ("plugins", "scanner", "engine", "recon_lab"):
        sys.path.insert(0, str(LAB / p))
    try:
        from loader import discover                     # noqa: E402
        from local_scan import Session as LSession      # noqa: E402
    except Exception:
        return {}
    try:
        loaded, _ = discover(str(LAB / "plugins" / "checks"))
    except Exception:
        return {}
    holder: list[str] = []
    Recorder = _make_recorder(LSession, holder)
    out: dict[str, list[str]] = {}
    for meta in loaded or []:
        code, fn = meta.get("code"), meta.get("fn")
        if not code or not callable(fn):
            continue
        holder.clear()
        try:
            fn(Recorder(), BASE.rstrip("/"), "verify")
        except Exception:
            pass
        out[code] = list(holder)
    return out



def _route_agrees(code: str, weak_route: str, routes: dict[str, list[str]]):
    """هل مسار الفحص يوافق هذا الضعف؟ None = لا يمكن التحقق منه."""
    paths = routes.get(code) or []
    if not paths:
        return None
    if weak_route in ("", "(after_request hook)", "(module constant)"):
        return True
    target = route_prefix(weak_route)
    for p in paths:
        q = (p or "/").rstrip("/") or "/"
        if q == target or q.startswith(target + "/") or target.startswith(q + "/"):
            return True
    return False


def _sink_covers(weak_route: str, paths: list[str]) -> list[str]:
    """هل صفحة الضعف تُحمّل أصلًا فحصه الكود؟ (المصرف في السكربت لا الصفحة)

    DOM-XSS ثغرته ليست في HTML بل في السكربت: /dom يحمّل vuln.js
    وحوض innerHTML هناك. فالفحص الذي حلّل vuln.js يغطي /dom فعلًا،
    لكن المطابقة بالمسار وحده تحسبه غير مغطّى. نتحقق من العلاقة
    بالقياس (نجلب الصفحة ونفحص إن كانت تشير للأصل) لا بالافتراض.
    """
    assets = [p for p in (paths or []) if p.endswith((".js", ".css"))]
    if not assets or not weak_route.startswith("/"):
        return []
    try:
        sys.path.insert(0, str(LAB / "scanner"))
        from session import Session as _S                # noqa: E402
        from scoped import Scope as _Sc                 # noqa: E402
        _, _, raw = _S(_Sc(mode="loopback")).get(
            BASE.rstrip("/") + weak_route)
        body = raw.decode("utf-8", "replace")
    except Exception:
        return []
    return [a for a in assets if a in body]


def evaluate(weak: dict, findings: list[dict],
             checks: dict[str, dict] | None = None,
             routes: dict[str, list[str]] | None = None
             ) -> tuple[bool, str, str]:
    """مطابقة على ضعف موثّق من أي مسار فحص.

    اتحاد المسارات مقصود: activescan عام بالحمولات، وlocal_scan.CHECKS
    مُسمّاة، وplugins. إن لم يكن للصنف أي كود، فهو بلا فاحص.
    """
    codes, _ = RULES.get(weak["class"], (set(), ()))
    checks = checks or {}
    routes = routes or {}
    pfx = route_prefix(weak["route"])

    # لا تتوقف عند أول كود إيجابي: SQLBLIND إيجابي على /search كان
    # يحجب SQLLOGIN الذي يغطي /login فعلًا. نجرّب الكل ونختار
    # الإيجابي الذي يوافق المسار، ثم نجرّب activescan، ولا نُعلن
    # wrong-route إلا بعد نفاد كليهما (PATH مثلًا يغطي /download
    # فقط، لكن activescan يغطي /static-view).
    mismatched = []
    for code in sorted(codes):
        if not checks.get(code, {}).get("verdict"):
            continue
        agree = _route_agrees(code, weak["route"], routes)
        if agree is False:
            sinks = _sink_covers(weak["route"], routes.get(code) or [])
            if sinks:
                return True, f"رُصد ({code} · الحوض في {','.join(sinks)})", \
                    "sink-verified"
            mismatched.append(f"{code}→{routes.get(code)}")
            continue
        state = "route-verified" if agree else "class-only"
        return True, f"رُصد ({code} · local_scan · {state})", state

    if not codes:
        return False, "مفقود — لا فاحص لهذا الصنف", "n/a"

    # المطابقة بـcategory فقط: كود الفاحص ليس هو الفئة. XSSPOLY مثلًا
    # ليس دليلًا على XSS منعكسة في سمة، وقبول code كان يعيد تبرُّر
    # الصنف عبر الفاحص. الفئة وحدها تُثبت الفئة، والطابق يثبت المسار.
    for f in findings:
        path = urlsplit(f.get("url") or "").path or "/"
        if not (path == weak["route"] or path.rstrip("/") == pfx
                or path.startswith(pfx + "/")):
            continue
        if f.get("category") in codes:
            return True, f"رُصد ({f.get('category')} · {f.get('code')} · activescan)", \
                "route-verified"
    if mismatched:
        return False, "كود إيجابي على مسار آخر: " + "; ".join(mismatched), \
            "wrong-route"
    return False, f"مفقود — المتوقَّع: {','.join(sorted(codes))}", "n/a"



def classify(weak: dict, detected: bool, crawled: set[str],
             checks: dict[str, dict] | None = None) -> str:
    """لماذا مُنعت؟ الأنواع الثلاثة عالجتها مختلفة تمامًا:
    discovery = الزاحف لم يصل  → إصلاح في crawl
    detector  = وُجد ولم يُصدر → إصلاح في الفحص
    no-det    = لا فاحص أصلًا  → فاحص جديد
    """
    if detected:
        return "detected"
    codes, _ = RULES.get(weak["class"], (set(), ()))
    if not codes:
        return "no-det"
    checks = checks or {}
    # فحص مُسمًّى موجود ولم يُصدر = فجوة كشف لا غياب فاحص
    if any(c in checks for c in codes):
        return "detector"
    route = weak["route"]
    seen = route in crawled or route_prefix(route) in crawled or any(
        c.rstrip("/") == route_prefix(route) for c in crawled)
    return "detector" if seen else "discovery"


def run_local_checks() -> dict[str, dict]:
    """يشغّل كل فحوص local_scan.CHECKS (29 فحصًا مُسمًّى) على المختبر.

    هذا المسار كان مُهمَلًا في أول نسخة من هذا الـharness، فقِسنا
    activescan وحده وقلنا «13 بلا فاحص» — بينما 13 منها مكتوبة أصلًا في
    local_scan.CHECKS (JWTNONE, MASSASSIGN, XXE, LFI, IDOR, XSSSTORED...).
    تغطية الأداة = اتحاد المسارين، لا أحدهما.
    """
    sys.path.insert(0, str(LAB / "scanner"))
    from local_scan import CHECKS, run_check          # noqa: E402
    from local_scan import Session as LSession        # noqa: E402

    out: dict[str, dict] = {}
    for meta in CHECKS:
        try:
            res = run_check(meta, LSession(), BASE.rstrip("/"), "verify")
            out[meta["code"]] = res
        except Exception as e:                        # فحص واحد معطوب
            out[meta["code"]] = {"verdict": False, "note": str(e)[:80]}
    return out


def run_plugins() -> dict[str, dict]:
    """المسار الثالث: plug-ins الفحص (HOSTHDR, DOMXSS, CORS, ...).

    أُهمل في أول نسختين من هذا الـharness — كان يُقاس activescan وحده،
    فظهرت 13 فجوة وهمية. ثلاثة مسارات لا واحد.
    """
    for p in ("plugins", "scanner", "engine", "recon_lab"):
        sys.path.insert(0, str(LAB / p))
    try:
        from loader import discover                     # noqa: E402
        from local_scan import Session as LSession      # noqa: E402
    except Exception as e:
        print(f"  plugin import failed: {str(e)[:80]}")
        return {}
    out: dict[str, dict] = {}
    try:
        # discover يعيد (loaded, errors) لا قائمة، والمفتاح للتنفيذ
        # "fn" لا "run" والتوقيع (session, base, mode) لا (base).
        # ثلاثة أخطاء مجتمعة = 0/6 بصمت دون أي رسالة خطأ.
        loaded, errors = discover(str(LAB / "plugins" / "checks"))
        if errors:
            print(f"  plugin load errors: {errors[:2]}")
        sess = LSession()
        for meta in loaded or []:
            code = meta.get("code")
            fn = meta.get("fn")
            if not code or not callable(fn):
                continue
            try:
                out[code] = fn(sess, BASE.rstrip("/"), "verify")
            except Exception as e:
                out[code] = {"findings": False, "note": str(e)[:80]}
    except Exception as e:
        print(f"  plugin discovery failed: {str(e)[:80]}")
        return {}
    return out


def _plugin_hit(res) -> bool:
    """حكم على نتيجة plug-in: 여러 أشكال، فنقبل أي إشارة إيجابية صريحة."""
    if isinstance(res, bool):
        return res
    if isinstance(res, dict):
        for k in ("findings", "hit", "found", "detected", "vulnerable"):
            if k in res:
                return bool(res[k])
        if res.get("severity") and res.get("detail"):
            return True
    return bool(res)


def measure() -> dict:
    """يقيس التغطية ويعيد النتيجة دون طباعة — المصدر الوحيد للحقيقة.

    main() وpytest يقرآن هذه الدالة، فلا يمكن أن يمرّ أحدهما while
    the other rots.
    """
    weak = documented_weaknesses() + GLOBAL_WEAKNESSES
    res = run_scanner()
    findings = res.get("findings") or []
    sig = header_signals()
    crawled = set(res.get("_discovered") or [])

    checks = run_local_checks()
    plugs = run_plugins()
    phits = sorted(k for k, v in plugs.items() if _plugin_hit(v))
    checks = {**checks, **{k: {"verdict": True} for k in phits}}

    # تفكيك مهم: «مفقود» نوعان مختلفان تمامًا، وخلطهما يخفي الأولاد الجدد.
    #   discovery = الزاحف لم يصل للمسار أصلًا  -> إصلاح في crawl
    #   detector  = الفاحص موجود ولم يُصدر      -> إصلاح في الفحص
    #   no-det    = لا فاحص لهذا الصنف          -> إصلاح جديد
    tally = {"detected": 0, "discovery": 0, "detector": 0, "no-det": 0}
    routes = {**observe_check_routes(), **observe_plugin_routes()}

    rows, wrong_route = [], 0
    for w in weak:
        ok, why, state = evaluate(w, findings, checks, routes)
        if w["class"] == "CORS" and sig and "evil.example" in sig[0]:
            ok, why, state = True, "رُصد (ACAO يعكسOrigins)", "route-verified"
        kind = classify(w, ok, crawled, checks)
        if state == "wrong-route":
            wrong_route += 1
            kind = "detector"
        tally[kind] += 1
        rows.append({"class": w["class"], "route": w["route"],
                     "line": w["line"], "detected": ok, "kind": kind,
                     "route_state": state, "note": why})

    pct = 100.0 * tally["detected"] / len(weak) if weak else 0.0
    return {"weak": weak, "findings": findings, "points": res.get("_points", 0),
            "crawled": sorted(crawled), "sig": sig, "checks": checks,
            "plugins": plugs, "plugin_hits": phits, "routes": routes,
            "rows": rows, "tally": tally, "wrong_route": wrong_route,
            "total": len(weak), "pct": round(pct, 1)}


def main() -> int:
    m = measure()
    weak, rows, tally = m["weak"], m["rows"], m["tally"]

    print(f"Truth: {len(weak)} documented weaknesses in target/app.py")
    print(f"Scan: {len(m['findings'])} findings over {m['points']}"
          f" points from {len(m['crawled'])} crawled endpoints")
    print(f"Codes: {sorted({f.get('code', '?') for f in m['findings']})}\n")
    if m["sig"]:
        print(f"Header probe: {m['sig'][0]}\n")

    hits = sorted(k for k, v in m["checks"].items() if v.get("verdict"))
    print(f"local_scan.CHECKS: {len(hits)}/{len(m['checks'])} positive")
    print(f"  {hits}")
    print(f"\nplugins: {len(m['plugin_hits'])}/{len(m['plugins'])} positive"
          f" -> {m['plugin_hits']}\n")

    print("Observed check routes (by observation, not by hand):")
    for c in sorted(m["routes"]):
        print(f"  {c:<11} {m['routes'][c]}")
    print()

    label = {"detected": "OK  ", "discovery": "DISC", "detector": "MISS",
             "no-det": "NONE"}
    for r in rows:
        print(f"  {label[r['kind']]} {r['class']:<22}{r['route']:<24}{r['note']}")

    print(f"\nCOVERAGE: {tally['detected']}/{m['total']} = {m['pct']:.1f}%")
    print(f"  discovery gaps: {tally['discovery']}  "
          f"detector misses: {tally['detector']}  "
          f"no detector: {tally['no-det']}")
    unverified = [r["class"] for r in rows if r["route_state"] == "class-only"]
    print(f"  route-verified: "
          f"{sum(1 for r in rows if r['route_state'] == 'route-verified')}"
          f"  sink-verified: "
          f"{sum(1 for r in rows if r['route_state'] == 'sink-verified')}"
          f"  class-only (unverified): {len(unverified)} {unverified}")
    print(f"  positive code on the wrong route: {m['wrong_route']}")

    out = LAB / "reports" / "coverage.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"base": BASE, "total": m["total"], **tally,
         "coverage_pct": m["pct"],
         "check_routes": m["routes"],
         "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Written: {out}")
    return 0


# ---------------------------------------------------------------- pytest
# كان هذا الملف اسمُه test_* ولا يحوي ولا اختبارًا واحدًا: القياس لم
# يكن محميًا بشيء، فكان 46.2% قد ينهار دون أن يصرخ أحد. الآن
# القياس نفسه مُختبَر، وحارسٌ لكل صنف انهيار صامت ظهر في هذه الجلسة:
# 0/6 plug-ins و3 من 29 مسارات مُسجّلة — كلها كانت تمرّ بصمت.


def _target_up() -> bool:
    import urllib.request
    try:
        urllib.request.urlopen(BASE, timeout=3).close()
        return True
    except Exception:
        return False


live = pytest.mark.skipif(not _target_up(), reason="الهدف غير مفتوح")


def test_weakness_extraction_is_deterministic():
    """بلا شبكة: استخراج العلامات يجب أن يكون ثابتًا."""
    a = documented_weaknesses()
    b = documented_weaknesses()
    assert a == b
    assert len(a) + len(GLOBAL_WEAKNESSES) == EXPECTED_WEAKNESSES
    assert all(w["class"] and w["route"] for w in a)


@pytest.fixture(scope="module")
def measured():
    if not _target_up():
        pytest.skip("الهدف غير مفتوح")
    return measure()


@live
def test_every_pipeline_actually_loads(measured):
    """حارس صمت: مسارات الفحص صفر أو plug-ins صفر = قياس فارغ.

    هذا بالضبط ما حدث: discover أعاد tuple، والمفتاح fn لا run،
    والتوقيع (session, base, mode) — فكانت 0/6 بلا رسالة.
    """
    assert len(measured["checks"]) >= 29, "local_scan.CHECKS لم تُحمَّل"
    assert len(measured["plugins"]) >= 6, "plug-ins لم تُحمَّل"
    assert measured["plugin_hits"], "لا plug-in إيجابي"


@live
def test_observed_routes_cover_every_check(measured):
    for code, paths in measured["routes"].items():
        assert paths, f"{code} لم يُسجَّل له أي مسار"
        for p in paths:
            assert not p.startswith("//"), f"{code}: مسار مشوَّه {p}"


@live
def test_coverage_has_no_misses(measured):
    t = measured["tally"]
    assert t["no-det"] == 0, [r for r in measured["rows"] if r["kind"] == "no-det"]
    assert t["detector"] == 0, [r for r in measured["rows"] if r["kind"] == "detector"]
    assert t["discovery"] == 0, [r for r in measured["rows"] if r["kind"] == "discovery"]
    assert measured["wrong_route"] == 0
    assert t["detected"] == measured["total"] == EXPECTED_WEAKNESSES


@live
def test_no_detection_is_class_only(measured):
    """كل رصد يجب أن يكون مثبَّتًا بمساره، لا بالصنف فقط.

    هذا ما كان ينقص: كود إيجابي على /profile يُحسب تغطية لـ
    /settings. الآن يُرفض، أو يُقبل فقط بحوض مُقاس.
    """
    weak_states = [r["route_state"] for r in measured["rows"]
                   if r["route_state"] not in ("route-verified", "sink-verified")]
    assert not weak_states, weak_states


if __name__ == "__main__":
    raise SystemExit(main())
