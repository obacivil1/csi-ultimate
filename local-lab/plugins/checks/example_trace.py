"""
plugins/checks/example_trace.py — إضافة مثال: فحص أساليب HTTP الخطرة.
====================================================================
يتحقق أن TRACE/TRACK مرفوضة (405/501/404). على المختبر: سليم (False).
انسخ هذا الملف كنموذج لإضافاتك: عدّل PLUGIN فقط.
"""
import urllib.parse

PLUGIN = {
    "code": "METHODS",
    "name": "أساليب HTTP الخطرة (TRACE/TRACK)",
    "owasp": "A5:Misconfiguration",
    "severity": "low",
    "family": "config",
}


def run(session, base, mode):
    """(session, base, mode) -> (sub_status, status, verdict, note, evidence)."""
    session._guard(base)
    import urllib.request
    findings = []
    for method in ("TRACE", "TRACK"):
        req = urllib.request.Request(base.rstrip("/") + "/", method=method)
        try:
            with session.opener.open(req, timeout=5) as resp:
                st = resp.status
        except Exception as e:
            code = getattr(e, "code", 0)
            st = code or 0
        if st == 200:
            findings.append(method)
    if findings:
        return 1, "ضعف مؤكد", True, \
            "مسموح: " + "، ".join(findings) + " — تُسرَّب الترويسات", \
            "TRACE/TRACK"
    return 1, "سليم/غير مؤكد", False, \
        "TRACE/TRACK مرفوضة — لا تسرّب عبر الأساليب.", "OPTIONS/GET فقط"
