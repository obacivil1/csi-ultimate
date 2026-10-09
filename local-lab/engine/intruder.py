"""
engine/intruder.py — محرك الحقن (Burp Intruder).
===============================================
يحقن قائمة كلمات (payloads) في أي موضع يحمل العلامة FUZZ داخل:
  - رابط URL
  - جسم الطلب body
  - قيم الترويسات headers
يعمل بخيوط متوازية مع حدّ معدّل (delay) وإعادة محاولة، ويصنّف النتائج
تلقائيًا: تغيّر الحالة/الحجم، انعكاس الحمولة، ظهور آثار أخطاء.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

try:
    from raw import RawRequest, send
except ImportError:  # عند الاستيراد كحزمة local-lab.engine
    from .raw import RawRequest, send

MARKER = "FUZZ"
ERROR_HINTS = ("exception", "traceback", "syntax error", "sqlite",
               "mysql", "ORA-", "stack trace", "warning:")


def inject(template, payload, marker=MARKER):
    """يستبدل كل occurrence للعلامة بالحمولة ويعيد RawRequest جديدًا."""
    rq = template if isinstance(template, RawRequest) else RawRequest(**template)
    hit = False

    def sub(s):
        nonlocal hit
        if isinstance(s, str) and marker in s:
            hit = True
            return s.replace(marker, str(payload))
        return s

    new_url = sub(rq.url)
    new_body = sub(rq.body) if isinstance(rq.body, str) else rq.body
    if isinstance(rq.body, bytes) and marker.encode() in rq.body:
        hit = True
        new_body = rq.body.replace(marker.encode(), str(payload).encode())
    new_headers = {k: sub(v) for k, v in (rq.headers or {}).items()}
    out = RawRequest(rq.method, new_url, new_headers, new_body,
                     name=f"{rq.name} :: {payload!r:.40}")
    return out, hit


def _score(row, base, base_err):
    """يصنّف الصف مقارنة بالأساس: تغيّر حالة/حجم شاذ/أثر خطأ/انعكاس HTML خام."""
    if row["status"] != base["status"]:
        return True, "status-changed"
    if abs(row["size"] - base["size"]) > max(64, int(base["size"] * 0.10)):
        return True, "size-outlier"
    low = row.get("text_low", "")
    if any(h in low for h in ERROR_HINTS) and not base_err:
        return True, "error-hint"
    if row.get("raw_reflect") and not base.get("raw_reflect"):
        return True, "raw-html-reflected"
    if row["reflected"] and not base["reflected"]:
        return True, "reflected"
    return False, ""


def fuzz(session, template, payloads, marker=MARKER, baseline="IntruderBase0",
         workers=5, delay=0.0, timeout=6, follow=False, retries=1,
         limiter=None):
    """يحقن كل حمولة ويعيد (base, rows). كل صف: payload/status/size/time/hash."""
    tpl = template if isinstance(template, RawRequest) else RawRequest(**template)
    lock = threading.Lock()

    def one(payload):
        rq, hit = inject(tpl, payload, marker)
        if not hit:
            return {"payload": payload, "status": -1, "size": 0,
                    "time_ms": 0.0, "hash": "", "reflected": False,
                    "interesting": False, "reason": "no-marker",
                    "text_low": ""}
        if delay:
            time.sleep(delay)
        if limiter is not None:
            limiter.wait()
        attempt, res = 0, None
        while True:
            with lock:  # الجلسة الواحدة تُستخدم بتسلسل آمن
                res = send(rq, session, follow=follow, timeout=timeout)
            if res.status != 0 or attempt >= retries:
                break
            attempt += 1
            time.sleep(0.3)
        txt = res.text()
        p = str(payload)
        row = {"payload": payload, "status": res.status, "size": res.size,
               "time_ms": res.time_ms, "hash": res.hashes(),
               "reflected": p in txt,
               "raw_reflect": (p in txt) and ("<" in p or ">" in p),
               "text_low": txt.lower()}
        return row

    base_rq, _ = inject(tpl, baseline, marker)
    base_res = send(base_rq, session, follow=follow, timeout=timeout)
    base_txt = base_res.text()
    base = {"status": base_res.status, "size": base_res.size,
            "reflected": str(baseline) in base_txt,
            "raw_reflect": (str(baseline) in base_txt)
                           and ("<" in str(baseline) or ">" in str(baseline))}
    base_err = any(h in base_txt.lower() for h in ERROR_HINTS)

    rows = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for row in pool.map(one, list(payloads)):
            if row["status"] == -1:
                row["interesting"], row["reason"] = False, "no-marker"
            else:
                row["interesting"], row["reason"] = _score(row, base, base_err)
            row.pop("text_low", None)
            rows.append(row)
    rows.sort(key=lambda r: (not r["interesting"], r["status"], r["size"]))
    return base, rows
