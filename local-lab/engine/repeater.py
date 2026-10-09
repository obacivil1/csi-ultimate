"""
engine/repeater.py — إعادة إرسال الطلبات (Burp Repeater).
=========================================================
أرسل أي طلب (معدّلًا) عبر جلسة مقيّدة النطاق، واحصل على الاستجابة
الخام + الزمن + البصمة. يدعم سلاسل الطلبات التي تشترك نفس الجلسة
(مفيد لتسجيل الدخول ثم تنفيذ فعل مصادق عليه).

الRepeater هو المسار الوحيد الذي يختار فيه المشغّل الطلب بنفسه، فكان
الأكثر خطرًا والأقل تحكّمًا: check_url يفحص العنوان ولا يعرف الـmethod،
فـDELETE على هدف داخل النطاق كان يمرّ بلا سؤال. ثلاث بوابات هنا:
تصريح للـmethods المغيّرة للحالة، سقف للجسم، وأثر اختياري في
audit.jsonl. كلها معاملات مضافة بقيم تحفظ السلوك السابق.
"""
import hashlib
import json
import sys
import time
from pathlib import Path

try:
    from raw import RawRequest, send
except ImportError:  # عند الاستيراد كحزمة local-lab.engine
    from .raw import RawRequest, send

#: methods لا تغيّر حالة الخادم. من أرسل غيرها فليست قراءة.
READ_ONLY_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

#: تغيّر الحالة: تحتاج تصريحًا صريحًا من سجل الأهداف.
STATE_CHANGING = frozenset({"POST", "PUT", "PATCH"})

#: تمسح أو تُنشئ موارد لا رجعة فيها: تأكيد ثانٍ في الواجهة.
DESTRUCTIVE = frozenset({"DELETE", "TRACE_X", "PROPFIND", "LOCK", "PURGE"})

#: سقف الجسم للطلب اليدوي. يمنع لصق حمولة ضخمة بالخطأ.
MAX_BODY_BYTES = 256 * 1024


class RepeaterRefused(RuntimeError):
    """طلب يدوي مرفوض قبل الإرسال: خطورة بلا تصريح، أو جسم ضخم."""


def method_risk(method: str) -> str:
    """يصنّف الـmethod: read_only / state / destructive / exotic."""
    m = (method or "GET").upper()
    if m in READ_ONLY_METHODS:
        return "read_only"
    if m in STATE_CHANGING:
        return "state"
    if m in DESTRUCTIVE:
        return "destructive"
    return "exotic"


def check_manual_request(rq, *, granted=None, confirm_destructive=False):
    """بوابة ما قبل الإرسال للطلب اليدوي. ترمي RepeaterRefused عند المنع.

    granted: سجل تصريح المالك (intrusive_granted) أو True، أو None بلا
    تصريح. confirm_destructive: تأكيد المشغّل في الواجهة.
    """
    risk = method_risk(rq.method)
    body = rq.body or ""
    n = len(body.encode("utf-8")) if isinstance(body, str) else len(body)
    if n > MAX_BODY_BYTES:
        raise RepeaterRefused(
            f"الجسم {n} بايت يتجاوز السقف {MAX_BODY_BYTES} بايت")
    if risk in ("state", "exotic") and granted is None:
        raise RepeaterRefused(
            f"{rq.method} يغيّر حالة الخادم — يحتاج تصريحًا. "
            f"امنح تصريحًا للهدف أولًا: python scanner/targets.py "
            f"--url <target> --grant --confirm 'I CONFIRM' --confirm2 'I GRANT'")
    if risk == "destructive" and granted is None:
        raise RepeaterRefused(
            f"{rq.method} تمسح موردًا — يلزم تصريحًا صريحًا للمالك")
    if risk == "destructive" and not confirm_destructive:
        raise RepeaterRefused(
            f"{rq.method} تمسح موردًا — يلزم تأكيد صريح منك")
    return risk


def _chain_head(path):
    """آخر بصمة في السلسلة، أو الصفر لبداية سلسلة جديدة."""
    try:
        if not path.exists():
            return "0" * 64
        lines = [l for l in path.read_text(encoding="utf-8").splitlines()
                 if l.strip()]
        if not lines:
            return "0" * 64
        return json.loads(lines[-1]).get("hash", "0" * 64)
    except Exception:
        return "0" * 64


def _audit(audit_path, rq, risk, out):
    """سطر أثر بسلسلة hash — نفس خوارزمية local_scan.AuditLog.

    كان هذا السطر يُكتب بلا prev/hash، فكان أثر الطلبات اليدوية (أدق
    سجل في الأداة: المشغّل يختار الطلب بنفسه) قابلًا للحذف والتعديل
    دون أي أثر. الآن السطر مُقيَّد، والحذف من وسط السلسلة يكسرها.

    حدود الأداة:
      · التعديل والتكرار بين السطور يُكتشفان.
      · حذف السطر *الأخير* لا يُكتشف: سلسلة بلا مرساة خارجية لا ترى
        اقتطاع ذيلها. لا أدّعي غير ذلك.
    """
    entry = {
        "event": "manual-request",
        "method": rq.method,
        "url": rq.url,
        "risk": risk,
        "status": out.get("status"),
        "size": out.get("size"),
        #بصمة جسم الاستجابة سُمّيت body_hash لا hash: مفتاح hash
        # محجوز لسلسلة التدقيق، ولو استُعمل هنا لابتلعته البصمة
        # وأصبح التحقق مستحيلًا دائمًا (payload يُحسب قبل الإضافة).
        "body_hash": out.get("hash"),
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    try:
        audit_path = Path(audit_path)
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        prev = _chain_head(audit_path)
        # نفس الترتيب والضبط في local_scan: بلاهما لا تتقاطع الصيغتان.
        payload = json.dumps(entry, ensure_ascii=False, sort_keys=True).encode()
        rec = {**entry,
               "hash": hashlib.sha256(prev.encode() + payload).hexdigest(),
               "prev": prev}
        with audit_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        # تعطّل صامت كان يخفي أن الأثر لم يُكتب أصلًا. الآن يُقال.
        sys.stderr.write(f"تعذّر كتابة سجل الأثر: {e}\n")


def verify_audit(audit_path):
    """يتحقق من سلامة سلسلة الأثر. يعيد (ok, سبب).

    نفس حساب local_scan.verify_tail مع سبب الصف الذي فشل.
    """
    p = Path(audit_path)
    if not p.exists() or not p.read_text(encoding="utf-8").strip():
        return True, "لا سجل"
    prev = "0" * 64
    for i, raw in enumerate(p.read_text(encoding="utf-8").splitlines()):
        if not raw.strip():
            continue
        try:
            rec = json.loads(raw)
        except Exception:
            return False, f"سطر تالف {i}"
        if "prev" not in rec or "hash" not in rec:
            return False, f"سطر {i} بلا سلسلة (مكتوب قبل الترقية)"
        payload = json.dumps(
            {k: v for k, v in rec.items() if k not in ("hash", "prev")},
            ensure_ascii=False, sort_keys=True,
        ).encode()
        h = hashlib.sha256(prev.encode() + payload).hexdigest()
        if rec["prev"] != prev:
            return False, f"كسر prev عند السطر {i}"
        if rec["hash"] != h:
            return False, f"بصمة مزيّفة عند السطر {i}"
        prev = h
    return True, "سلسلة سليمة"


def replay(session, template, follow=False, timeout=6, *, granted=None,
           confirm_destructive=False, audit_path=None):
    """يرسل طلبًا واحدًا ويعيد قاموسًا موحّدًا بالنتيجة الكاملة."""
    rq = template if isinstance(template, RawRequest) else RawRequest(**template)
    risk = check_manual_request(rq, granted=granted,
                                confirm_destructive=confirm_destructive)
    res = send(rq, session, follow=follow, timeout=timeout)
    out = {
        "name": rq.name,
        "request_raw": rq.to_raw_text(),
        "risk": risk,
        "status": res.status,
        "headers": res.headers,
        "body": res.body,
        "text": res.text(),
        "size": res.size,
        "time_ms": res.time_ms,
        "hash": res.hashes(),
    }
    if audit_path is not None:
        _audit(audit_path, rq, risk, out)
    return out


def replay_chain(session, templates, follow=False, timeout=6, **kw):
    """يرسل سلسلة طلبات بالتتابع على نفس الجلسة (تُحفَظ الكوكيز بينها)."""
    return [replay(session, t, follow=follow, timeout=timeout, **kw)
            for t in templates]
