"""
plugins/checks/cors_origin.py — إضافة: سياسة CORS متساهلة على /api.
====================================================================
يرسل Origin خارجيًا؛ إن عاد Access-Control-Allow-Origin: * (أو عكس
الأصل) فأي موقع خبيث يقرأ استجابات الـ API بمتصفح الضحية.
"""
import urllib.request

PLUGIN = {
    "code": "CORS",
    "name": "سياسة CORS متساهلة على الواجهات",
    "owasp": "A5:Misconfiguration",
    "severity": "medium",
    "family": "config",
}


def run(session, base, mode):
    session._guard(base)
    req = urllib.request.Request(
        base.rstrip("/") + "/api/me",
        headers={"Origin": "https://evil.test"},
        method="GET")
    try:
        with session.opener.open(req, timeout=6) as resp:
            acao = resp.headers.get("Access-Control-Allow-Origin", "")
    except Exception as e:
        code = getattr(e, "code", 0)
        acao = ""
        if code not in (0, 403, 404):
            return 0, "خطأ", False, f"تعذّر الفحص: {e}", "/api/me"
    if acao == "*" or "evil.test" in acao:
        return 1, "ضعف مؤكد", True, \
            f"الخادم يجيب ACAO: {acao} — أي موقع يقرأ الـ API", \
            "Origin: https://evil.test"
    return 1, "سليم/غير مؤكد", False, \
        "لا انعكاس متساهل للأصل.", "Origin probe"
