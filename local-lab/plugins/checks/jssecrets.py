"""
plugins/checks/jssecrets.py — إضافة: أسرار مُسرَّبة في سكربتات الموقع.
=======================================================================
مفاتيح API ورموز في JS عام = اختراق حسابات/فواتير سحابية (تدفع عنها
المكافآت العالية). يكتفي بالتبليغ عن النوع والسطر — لا يعرض القيمة.
"""
import urllib.request
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "recon_lab"))

PLUGIN = {
    "code": "JSSECRET",
    "name": "أسرار مُسرَّبة في ملفات JS",
    "owasp": "A5:Misconfiguration",
    "severity": "high",
    "family": "config",
}


def run(session, base, mode):
    session._guard(base)
    try:
        from js import extract_script_urls
        from jsharvest import find_secrets
    except ImportError:
        return 0, "خطأ", False, "وحدتا js/jsharvest غير متاحتين.", "/"
    root = base.rstrip("/") + "/"
    try:
        with session.opener.open(urllib.request.Request(root),
                                 timeout=6) as resp:
            html = resp.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, "خطأ", False, f"تعذّر قراءة الرئيسية: {e}", "/"
    try:
        scope = getattr(session, "scope", None)
        scripts = sorted(extract_script_urls(html, root, scope))
    except Exception:
        scripts = []
    found = []
    for src in scripts[:4]:
        try:
            with session.opener.open(urllib.request.Request(src),
                                     timeout=6) as resp:
                js = resp.read()[:200 * 1024].decode("utf-8", "replace")
        except Exception:
            continue
        for g in find_secrets(js):
            found.append(f"{src.split('/')[-1]}:{g['line']}:{g['kind']}")
    if found:
        return 1, "ضعف مؤكد", True, \
            "أسرار في JS عام: " + " | ".join(found[:4]), \
            f"{len(found)} سر"
    return 1, "سليم/غير مؤكد", False, \
        "لا أسرار في السكربتات المحصودة.", "/"
