"""
plugins/checks/host_header.py — إضافة: تسميم ترويسة Host.
=============================================================
إن بُنيت روابط حساسة (استعادة كلمة المرور) من Host دون تحقق،
فالمهاجم يزرع رابطًا خبيثًا يصل الضحية عبر البريد.
"""
import urllib.request

PLUGIN = {
    "code": "HOSTHDR",
    "name": "تسميم ترويسة Host في روابط الاستعادة",
    "owasp": "A1:BrokenAccessControl",
    "severity": "medium",
    "family": "access",
}


def run(session, base, mode):
    session._guard(base)
    url = base.rstrip("/") + "/reset?email=victim@local.test"
    req = urllib.request.Request(url, headers={"Host": "evil.test"},
                                 method="GET")
    try:
        with session.opener.open(req, timeout=6) as resp:
            body = resp.read().decode("utf-8", "replace")
            st = resp.status
    except Exception as e:
        return 0, "خطأ", False, f"تعذّر الفحص: {e}", url
    if st == 200 and "evil.test" in body and "reset?token=" in body:
        return 1, "ضعف مؤكد", True, \
            "رابط الاستعادة بُني بمضيف المهاجم — تسميم كامل", \
            "Host: evil.test"
    return 1, "سليم/غير مؤكد", False, \
        "المضيف لا ينعكس في الروابط الحساسة.", url
