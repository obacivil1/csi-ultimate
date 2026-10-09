"""
local-lab/engine/control.py — غرفة التحكم: أفعال داخل النطاق فقط.
===============================================================
قراءة (GET) تتطلب نطاقًا مصرّحًا/محليًا. أي فعل مُغيّر (POST/رفع/
زرع) يتطلب تصريح المالك العميق — يُرفَض برمجيًا بدونه. كل فعل
يُسجَّل في audit.jsonl (حدث control) بسلسلة التجزئة.

ليس هنا: لا تحكم بأجهزة أخرى، لا وكلاء عن بُعد، لا RAT —
التحكم بأجهزتك الخاصة عبر أدوات ويندوز نفسها (RDP/SSH).
"""
import urllib.parse

try:
    from .postex import fetch_page
    from .targets import intrusive_granted
except ImportError:  # تشغيل مباشر/اختبارات خارج الحزمة
    from postex import fetch_page
    from targets import intrusive_granted


def require_deep(url: str, path=None) -> dict:
    """بوابة الأفعال المغيّرة: تصريح مالك ممنوح وإلا ValueError."""
    grant = intrusive_granted(url, path)
    if not grant:
        raise ValueError("فعل مُغيّر مرفوض: سجّل تصريح المالك "
                         "(«أصرّح») أولًا.")
    return grant


def read_url(session, url: str, timeout: int = 8) -> dict:
    """قراءة صفحة عبر الجلسة — حارس النطاق يرفض الخارج قبل الاتصال."""
    return fetch_page(session, url, timeout=timeout)


def submit_form(session, base: str, action: str, fields: dict,
                path=None, timeout: int = 8) -> dict:
    """POST لنموذج مكتشف داخل النطاق — بتصريح عميق فقط."""
    require_deep(base, path)
    try:
        st, hdrs, raw = session.post(action, fields=fields or {},
                                     timeout=timeout)
    except Exception as e:
        return {"action": action, "status": 0, "text": f"تعذّر: {e}",
                "cookies": []}
    try:
        body = raw.decode("utf-8", "replace")
    except Exception:
        body = ""
    from postex import extract_links, render_text
    return {"action": action, "status": st,
            "headers": {k.lower(): v for k, v in (hdrs or [])},
            "text": render_text(body)[:4000],
            "links": extract_links(body, action),
            "cookies": [c[0] for c in session.cookies()]}


def upload_canary(session, base: str, action: str, field: str,
                  token: str, path=None, timeout: int = 10) -> dict:
    """رفع TXT كناري موسوم برمز العملية + إعادة جلبه — بتصريح عميق."""
    require_deep(base, path)
    import re
    safe = "".join(c for c in str(token) if c.isalnum() or c in "-_")[:24]
    fname = f"gx9ctl_{safe}.txt"
    marker = f"GX9CTL-{safe}"
    try:
        st, _, raw = session.post(
            action, fields={},
            files={field: (fname, marker.encode())}, timeout=timeout)
        posted = (raw.decode("utf-8", "replace")
                  if raw else "")
    except Exception as e:
        return {"ok": False, "action": action,
                "detail": f"تعذّر الرفع: {e}"}
    cands = set()
    for m in re.finditer(r"((?:/[\w\-.]+){1,4}/" + re.escape(fname) + r")",
                         posted):
        cands.add(m.group(1))
    root = base.rstrip("/")
    for guess in (f"/uploads/{fname}", f"/files/{fname}",
                  f"/upload/{fname}"):
        cands.add(guess)
    for p in sorted(cands)[:6]:
        url = urllib.parse.urljoin(root + "/", p.lstrip("/"))
        try:
            page = fetch_page(session, url, timeout=timeout)
        except Exception:
            continue
        if page.get("status") == 200 and marker in (page.get("text") or ""):
            try:
                from proof import record_plant
                eng = _eng_for_token(token, path)
                if eng:
                    record_plant(eng, "CONTROL-UPLOAD", p, marker, path)
            except Exception:
                pass
            return {"ok": True, "action": action, "url": url,
                    "file": fname, "marker": marker,
                    "detail": f"الكناري حي في {p} ✓"}
    return {"ok": False, "action": action, "file": fname,
            "detail": "رُفع (أو رُفض) لكن الكناري لم يُسترجَع"}


def _eng_for_token(token: str, path=None):
    try:
        from proof import list_engagements
        for e in list_engagements(path):
            if e.get("token") == token:
                return e.get("id")
    except Exception:
        pass
    return None


def log_control(target: str, action: str, detail: str = "",
                extra: dict | None = None) -> None:
    """يوثق كل فعل تحكم في سجل التدقيق (سلسلة تجزئة)."""
    from pathlib import Path
    try:
        from local_scan import AuditLog
    except ImportError:
        from scanner.local_scan import AuditLog
    aud = AuditLog(Path(__file__).resolve().parents[1] / "reports" /
                   "audit.jsonl")
    entry = {"event": "control", "target": target, "action": action,
             "detail": (detail or "")[:200]}
    if extra:
        entry["extra"] = extra
    aud.append(entry)
