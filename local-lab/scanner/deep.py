"""
local-lab/scanner/deep.py — الفحص العميق للنطاقات المصرّحة فقط.
===============================================================
البوابات (لا يعمل دونها جميعًا):
  1) النطاق مسجل مع «أؤكد» (targets).
  2) تصريح المالك بالفحص العميق ممنوح ومسجل («أصرّح» + زر).
  3) نية التشغيل لهذا الفحص (صندوق الواجهة / --deep) + وضع verify.

الفحوصات الخمسة بكناري حميد وسقوف صارمة:
  D-AUTHBYPASS: تجاوز دخول SQLi على نماذج دخول مكتشفة (فرق استجابة).
  D-CMDI:      صدى echo على معاملات host-like مكتشفة.
  D-SSTI:      حساب {{7*7}} داخل سياج نصي على معاملات template-like.
  D-BLIND:     فرق صحيح/خطأ مستقر على معاملات id-like (بلا SLEEP أبدًا).
  D-UPLOAD:    ملف TXT كناري على نقطة رفع مكتشفة + إعادة جلبه.

حدود معلنة: لا XSS مخزنة خارجيًا أبدًا (تلويث دائم — يدويًا عبر Repeater)،
ولا SLEEP زمني (عبء على القاعدة)، ولا رش عشوائي — فقط ما اكتُشف.
"""
import hashlib
import random
import re
import time
import urllib.parse

# نفس الإيقاع المهذب للخارجي — لا قصف لمواقع حقيقية.
POLITE_DELAY = 0.15

try:
    from .generic import _text, _with_param, discover
    from .local_scan import run_check
    from .targets import intrusive_granted
except ImportError:  # تشغيل مباشر/اختبارات خارج الحزمة
    from generic import _text, _with_param, discover
    from local_scan import run_check
    from targets import intrusive_granted

DEEP_CHECKS: list = []

MAX_LOGIN_FORMS = 2
MAX_CANDIDATES = 4
CMD_NAMES = {"host", "ip", "hostname", "addr", "address", "ping", "target",
             "domain", "hostname_or_ip"}
TPL_NAMES = {"template", "tpl", "view", "page", "name"}
BLIND_NAMES = {"id", "item", "user", "uid", "page", "cat", "category", "pid"}


def dcheck(code, name, owasp, severity_key, family):
    def deco(fn):
        DEEP_CHECKS.append({
            "code": code, "name": name, "owasp": owasp,
            "severity": severity_key, "family": family, "fn": fn,
        })
        return fn
    return deco


def _ctx(s) -> dict:
    return getattr(s, "_generic_ctx", None) or {}


def _canary(seed: str) -> str:
    return "GX9" + hashlib.md5(seed.encode()).hexdigest()[:6].upper()


@dcheck("D-AUTHBYPASS", "تجاوز دخول SQLi (عميق)", "A2:BrokenAuth",
        "critical", "auth")
def d_authbypass(s, base, mode):
    forms = _ctx(s).get("login_forms", [])[:MAX_LOGIN_FORMS]
    if not forms:
        return 1, "سليم/غير مؤكد", False, \
            "لا نماذج دخول مكتشفة — لا سطح للاختبار.", "لا سطح"
    hit = []
    for f in forms:
        act, uf = f["action"], f.get("user_field", "username")
        pf = next((n for n in f.get("inputs", [])
                   if n.lower() in ("password", "passwd", "pwd", "pass")),
                  "password")
        try:
            before = {c[0] for c in s.cookies()}
            st0, b0, _ = _text(s.post(act, fields={uf: "gx9bad",
                                                   pf: "gx9bad"},
                                      timeout=6))
            st1, b1, h1 = _text(s.post(act, fields={uf: "' OR '1'='1' --",
                                                    pf: "x"}, timeout=6))
            fresh = {c[0] for c in s.cookies()} - before
        except Exception:
            continue
        h = {k.lower(): v for k, v in h1}
        loc = h.get("location", "")
        new_cookie = bool(fresh) or "session" in loc.lower() or \
            "dashboard" in loc.lower()
        changed = st1 != st0 or abs(len(b1) - len(b0)) > max(200, len(b0) // 2)
        keyword = bool(re.search(r"welcome|logout|dashboard|لوحة|مرحب|أهلاً",
                                 b1, re.IGNORECASE))
        # كوكي جلسة جديد بعد الحقنة (وليس بعد الفاشلة) = دخول فعلي،
        # حتى لو اتُبع التوجيه وضاعت حالة 302.
        if new_cookie or (changed and keyword):
            p = urllib.parse.urlsplit(act).path or "/"
            hit.append(f"{p} ({uf})")
            if len(hit) >= 2:
                break
    found = bool(hit)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("تجاوز دخول مؤكد في: " + " ، ".join(hit) if found
         else "نماذج الدخول صمدت أمام حقنة التفافية"), "' OR '1'='1' --"


@dcheck("D-CMDI", "حقن أوامر echo (عميق)", "A7:Injection",
        "critical", "injection")
def d_cmdi(s, base, mode):
    mark = _canary(base + "cmdi")
    cands = [(u, p) for u, p in _ctx(s).get("params", [])
             if p.lower() in CMD_NAMES][:MAX_CANDIDATES]
    if not cands:
        return 1, "سليم/غير مؤكد", False, \
            "لا معاملات host-like مكتشفة — لا سطح للاختبار.", "لا سطح"
    hit = []
    for url, param in cands:
        try:
            st, body, _ = _text(s.get(_with_param(
                url, param, f"127.0.0.1; echo {mark}"), timeout=6))
        except Exception:
            continue
        if st == 200 and mark in body:
            hit.append(f"{urllib.parse.urlsplit(url).path or '/'}?{param}")
            if len(hit) >= 2:
                break
    found = bool(hit)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        (f"صدى الأمر ظهر في: " + " ، ".join(hit) if found
         else "لا تنفيذ أوامر (صدى حميد فقط)"), f"echo {mark}"


@dcheck("D-SSTI", "حساب قوالب {{7*7}} (عميق)", "A1:Injection",
        "critical", "injection")
def d_ssti(s, base, mode):
    cands = [(u, p) for u, p in _ctx(s).get("params", [])
             if p.lower() in TPL_NAMES][:MAX_CANDIDATES + 2]
    if not cands:
        return 1, "سليم/غير مؤكد", False, \
            "لا معاملات template-like مكتشفة — لا سطح للاختبار.", "لا سطح"
    hit = []
    for url, param in cands:
        try:
            st, body, _ = _text(s.get(_with_param(
                url, param, "GX{{7*7}}QZ"), timeout=6))
        except Exception:
            continue
        if st == 200 and "GX49QZ" in body:
            hit.append(f"{urllib.parse.urlsplit(url).path or '/'}?{param}")
            if len(hit) >= 2:
                break
    found = bool(hit)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("القالب حُسب في: " + " ، ".join(hit) if found
         else "لا حساب قوالب"), "GX{{7*7}}QZ"


@dcheck("D-BLIND", "حقن أعمى صحيح/خطأ (عميق)", "A1:Injection",
        "high", "injection")
def d_blind(s, base, mode):
    cands = [(u, p) for u, p in _ctx(s).get("params", [])
             if p.lower() in BLIND_NAMES][:MAX_CANDIDATES]
    if not cands:
        return 1, "سليم/غير مؤكد", False, \
            "لا معاملات id-like مكتشفة — لا سطح للاختبار.", "لا سطح"
    hit = []
    for url, param in cands:
        try:
            parts = list(urllib.parse.urlsplit(url))
            q0 = urllib.parse.parse_qsl(parts[3], keep_blank_values=True)
            base_q = [(k, v if k != param else "5") for k, v in q0]
            if not any(k == param for k in dict(q0)):
                base_q.append((param, "5"))
            parts[3] = urllib.parse.urlencode(base_q)
            u0 = urllib.parse.urlunsplit(parts)
            st_a, ba, _ = _text(s.get(u0, timeout=6))
            time.sleep(0.2)
            st_b, bb, _ = _text(s.get(u0, timeout=6))
            if st_a != st_b or len(ba) != len(bb):
                continue  # خط أساس غير مستقر — لا حكم
            st_t, bt, _ = _text(s.get(_with_param(
                u0, param, "5' AND '1'='1"), timeout=6))
            st_f, bf, _ = _text(s.get(_with_param(
                u0, param, "5' AND '1'='2"), timeout=6))
            same_true = (st_t == st_a and len(bt) == len(ba))
            diff_false = (st_f != st_a or
                          abs(len(bf) - len(ba)) > max(50, len(ba) // 5))
            if same_true and diff_false:
                hit.append(f"{urllib.parse.urlsplit(url).path or '/'}?{param}")
                if len(hit) >= 2:
                    break
        except Exception:
            continue
    found = bool(hit)
    return 1, "ضعف مؤكد" if found else "سليم/غير مؤكد", found, \
        ("فرق صحيح/خطأ مستقر في: " + " ، ".join(hit) if found
         else "لا فرق boolean مستقر"), "AND '1'='1/2'"


@dcheck("D-UPLOAD", "رفع ملف كناري TXT (عميق)", "A1:Injection",
        "high", "upload")
def d_upload(s, base, mode):
    targets = list(_ctx(s).get("upload_forms", [])[:1])
    for probed in _ctx(s).get("probed", []):
        if probed.rstrip("/").endswith("/upload") and \
                len(targets) < 1:  # ملاذ أخير واحد فقط
            targets.append({"action": probed, "file_field": "file",
                            "inputs": []})
    if not targets:
        return 1, "سليم/غير مؤكد", False, \
            "لا نقطة رفع مكتشفة — لا سطح للاختبار.", "لا سطح"
    fname = f"gx9probe_{_canary(base + 'up')}.txt"
    proof_token = getattr(s, "_proof_token", None)
    if proof_token:
        # رمز عملية الإثبات في اسم الملف = بصمة «كنت هنا» لاحقًا.
        safe = "".join(c for c in str(proof_token)
                       if c.isalnum() or c in "-_")[:24]
        fname = f"gx9probe_{safe}.txt"
    marker = f"GX9PROBE-{_canary(fname)}"
    t = targets[0]
    try:
        st, body, _ = _text(s.post(t["action"], fields={},
                                   files={t.get("file_field", "file"):
                                          (fname, marker.encode())},
                                   timeout=8))
    except Exception as e:
        return 1, "خطأ", False, f"تعذّر الرفع: {e}", fname
    cands = set()
    for m in re.finditer(r"((?:/[\w\-.]+){1,4}/" + re.escape(fname) + r")",
                         body):
        cands.add(m.group(1))
    root = base.rstrip("/")
    for guess in (f"/uploads/{fname}", f"/files/{fname}",
                  f"/upload/{fname}", f"/tmp/{fname}"):
        cands.add(guess)
    for path in sorted(cands)[:6]:
        try:
            st2, b2, _ = _text(s.get(
                urllib.parse.urljoin(root + "/", path.lstrip("/")),
                timeout=6))
        except Exception:
            continue
        if st2 == 200 and marker in b2:
            return 1, "ضعف مؤكد", True, \
                f"ملف الكناري رُفع وأُعيد جلبه من {path} — كتابة اعتباطية", \
                fname
    return 1, "سليم/غير مؤكد", False, \
        "رُفع (أو رُفض) لكن الكناري لم يُسترجَع من أي مسار", fname


# ------------------------------------------------------------- التشغيل
def deep_gates(base: str, path=None) -> dict:
    """يفحص البوابات الثلاث ويعيد السبب. فارغ = مسموح."""
    rec = intrusive_granted(base, path)
    if not rec:
        return {"allowed": False,
                "reason": "الفحص العميق مرفوض: سجّل تصريح المالك "
                          "(«أصرّح» + زر الموافقة) أولًا."}
    return {"allowed": True, "grant": rec}


def deep_audit(session, base: str, mode: str = "verify", path=None,
               stop=None):
    """يطبق DEEP_CHECKS بعد البوابات. يعيد (rows, info).

    خارج verify: لا يعمل (يعيد صفوفًا موقوفة) — العميق للتحقق فقط.
    stop: دالة إيقاف اختيارية تُفحَص قبل كل فحص.
    """
    base = base.rstrip("/") + "/"
    gates = deep_gates(base, path)
    if mode != "verify" or not gates["allowed"]:
        why = "وضع detect: العميق للتحقق فقط." if mode != "verify" \
            else gates["reason"]
        rows = [{
            "code": m["code"], "name": m["name"], "owasp": m["owasp"],
            "severity": m["severity"], "family": m["family"],
            "sub_status": 0, "status": "موقوف", "verdict": False,
            "note": why, "evidence": "", "mode": mode,
        } for m in DEEP_CHECKS]
        return rows, {"ran": False, "reason": why}
    if not getattr(session, "_generic_ctx", None):
        session._generic_ctx = discover(session, base)
    rows = []
    for meta in DEEP_CHECKS:
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
    return rows, {"ran": True, "grant": gates["grant"]}
