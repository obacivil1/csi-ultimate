"""
plugins/checks/domxss.py — إضافة: تدفقات DOM-XSS في سكربتات الموقع.
====================================================================
يحصد سكربتات same-origin من الصفحة الرئيسية ويحلل تدفق مصدر→مصرف.
مرشّح استاتيكي (يؤكَّد في المتصفح) — لكن تدفق location.hash→innerHTML
على موقعك يستحق التقرير فورًا.
"""
import urllib.request
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "recon_lab"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

PLUGIN = {
    "code": "DOMXSS",
    "name": "تدفقات DOM-XSS في سكربتات الموقع",
    "owasp": "A3:Injection",
    "severity": "medium",
    "family": "xss",
}


def run(session, base, mode):
    session._guard(base)
    try:
        from js import extract_script_urls
        from domxss import analyze_js
    except ImportError:
        return 0, "خطأ", False, "وحدتا js/domxss غير متاحتين.", "/"
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
    flows = []
    for src in scripts[:4]:
        try:
            with session.opener.open(urllib.request.Request(src),
                                     timeout=6) as resp:
                js = resp.read()[:200 * 1024].decode("utf-8", "replace")
        except Exception:
            continue
        for f in analyze_js(js, src):
            flows.append(f"{src.split('/')[-1]}:{f['sink_line']}: "
                         f"{f['source']} → {f['sink']} ({f['flow']})")
    if flows:
        return 1, "ضعف مؤكد", True, \
            "تدفقات DOM خطرة: " + " | ".join(flows[:3]), \
            f"{len(flows)} تدفق"
    return 1, "سليم/غير مؤكد", False, \
        "لا تدفق مصدر→مصرف في السكربتات المحصودة.", "/"
