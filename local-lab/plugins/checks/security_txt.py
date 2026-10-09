"""
plugins/checks/security_txt.py — إضافة: سياسة الإفصاح الأمني (RFC 9116).
=========================================================================
منصات 2026 الناضجة تعلن /.well-known/security.txt (قناة تبليغ + انتهاء).
  - حاضرة بـ Contact صالح → توثيق نضج (info).
  - غائبة/ناقصة → توصية (info سلبي موثق، بلا درجة).
"""
import urllib.request

PLUGIN = {
    "code": "SECTXT",
    "name": "سياسة الإفصاح الأمني security.txt",
    "owasp": "A5:Misconfiguration",
    "severity": "info",
    "family": "config",
}


def run(session, base, mode):
    session._guard(base)
    url = base.rstrip("/") + "/.well-known/security.txt"
    req = urllib.request.Request(url, method="GET")
    try:
        with session.opener.open(req, timeout=6) as resp:
            st, body = resp.status, resp.read().decode("utf-8", "replace")
    except Exception as e:
        code = getattr(e, "code", 0)
        if code not in (0, 403, 404):
            return 0, "خطأ", False, f"تعذّر الفحص: {e}", url
        return 1, "توثيق", False, \
            "غائبة — يُنصح بإعلان قناة تبليغ (RFC 9116).", url
    has_contact = "contact:" in body.lower()
    has_expires = "expires:" in body.lower()
    if st == 200 and has_contact:
        return 1, "توثيق", True, \
            "حاضرة بقناة تبليغ" + (" وتاريخ انتهاء." if has_expires else "."), \
            url
    return 1, "توثيق", False, \
        "موجودة لكن بلا Contact صالح — تُستكمَل.", url
