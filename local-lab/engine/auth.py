"""
engine/auth.py — مساعد الدخول الآلي قبل الفحص (للأهداف الحقيقية أيضًا).
========================================================================
login_form(session, base, username, password, ...): يملأ نموذج الدخول
ويرسل البيانات ويتحقق من علامات النجاح. يعيد (ناجح, رسالة).
"""
import urllib.parse


def login_form(session, base: str, username: str, password: str,
               login_path: str = "/login", user_field: str = "username",
               pass_field: str = "password",
               success_markers=("dashboard", "لوحة التحكم", "logout", "خروج"),
               timeout: float = 6) -> tuple:
    base = base.rstrip("/") + "/"
    login_url = base[:-1] + login_path
    try:
        session.get(login_url, timeout=timeout)  # تحميل النموذج (كوكيز أولية)
    except Exception:
        pass
    try:
        st, _, body = session.post(
            login_url,
            fields={user_field: username, pass_field: password},
            timeout=timeout)
    except Exception as e:
        return False, f"تعذّر الاتصال: {e}"
    text = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
    if st in (200, 302) and any(m in text for m in success_markers):
        try:
            n = len(session.cookies())
        except Exception:
            n = 0
        return True, f"دخول ناجح ({n} كوكيز جلسة)."
    if "خاطئة" in text or "invalid" in text.lower():
        return False, "بيانات الدخول مرفوضة."
    return False, f"نتيجة غير حاسمة (HTTP {st})."
