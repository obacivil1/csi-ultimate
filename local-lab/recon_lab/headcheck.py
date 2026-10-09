"""
recon_lab/headcheck.py — فحص ترويسات الأمان وأعلام الكوكيز.
========================================================
يفحص غياب/ضعف: CSP, X-Frame-Options, HSTS, X-Content-Type-Options,
Referrer-Policy, Permissions-Policy + أعلام Secure/HttpOnly/SameSite.
"""
import urllib.parse

WANTED = [
    ("content-security-policy", "CSP", "يمنع تنفيذ سكربتات دخيلة (XSS)"),
    ("x-frame-options", "X-Frame-Options", "يمنع التضمين بـ iframe (Clickjacking)"),
    ("x-content-type-options", "X-Content-Type-Options", "يمنع تخمين نوع المحتوى"),
    ("referrer-policy", "Referrer-Policy", "يقيّد تسريب الروابط للخارج"),
    ("permissions-policy", "Permissions-Policy", "يقيّد مزايا المتصفح"),
]


def _jar_cookie_flags(session):
    """يقرأ أعلام الكوكيز المخزنة في الجلسة (Secure/HttpOnly/SameSite)."""
    out = []
    jar = getattr(session, "jar", None)
    if jar is None:
        return out
    for c in jar:
        rest = getattr(c, "_rest", {}) or {}
        present = set()
        if c.secure:
            present.add("Secure")
        try:
            if c.has_nonstandard_attr("HttpOnly"):
                present.add("HttpOnly")
        except Exception:
            pass
        if rest.get("SameSite"):
            present.add("SameSite")
        out.append((c.name, present))
    return out


def check_headers(session, url):
    st, hdrs, _ = session.get(url, timeout=6)
    h = {k.lower(): v for k, v in hdrs}
    findings = []
    for key, label, why in WANTED:
        v = h.get(key, "")
        if not v:
            findings.append({"item": label, "state": "ناقص",
                             "severity": "medium", "detail": why})
        elif key == "x-content-type-options" and v.strip().lower() != "nosniff":
            findings.append({"item": label, "state": "ضعيف",
                             "severity": "low", "detail": f"القيمة: {v}"})
        else:
            findings.append({"item": label, "state": "سليم",
                             "severity": "info", "detail": v[:80]})
    scheme = urllib.parse.urlsplit(url).scheme
    if scheme == "https":
        v = h.get("strict-transport-security", "")
        findings.append({"item": "HSTS",
                         "state": "سليم" if v else "ناقص",
                         "severity": "info" if v else "medium",
                         "detail": (v[:80] if v else "يفرض HTTPS دائمًا")})
    else:
        findings.append({"item": "HSTS", "state": "غير منطبق",
                         "severity": "info", "detail": "القناة HTTP محلية"})
    setcookies = [v for k, v in hdrs if k.lower() == "set-cookie"]
    seen_names = set()
    if not setcookies and not _jar_cookie_flags(session):
        findings.append({"item": "Cookie-Flags", "state": "لا كوكيز",
                         "severity": "info", "detail": "لم يضع الخادم كوكيز هنا"})
    for sc in setcookies:
        low = sc.lower()
        name = sc.split("=", 1)[0].strip()
        seen_names.add(name)
        missing = [f for f, tok in (("Secure", "secure"), ("HttpOnly", "httponly"),
                                    ("SameSite", "samesite")) if tok not in low]
        if missing:
            findings.append({"item": f"Cookie: {name}", "state": "ضعيف",
                             "severity": "medium",
                             "detail": "ينقص: " + "، ".join(missing)})
        else:
            findings.append({"item": f"Cookie: {name}", "state": "سليم",
                             "severity": "info", "detail": "الأعلام الثلاثة حاضرة"})
    for name, present in _jar_cookie_flags(session):
        if name in seen_names:
            continue
        missing = [f for f in ("Secure", "HttpOnly", "SameSite")
                   if f not in present]
        if missing:
            findings.append({"item": f"Cookie: {name}", "state": "ضعيف",
                             "severity": "medium",
                             "detail": "ينقص (من الجلسة): " + "، ".join(missing)})
        else:
            findings.append({"item": f"Cookie: {name}", "state": "سليم",
                             "severity": "info",
                             "detail": "الأعلام الثلاثة حاضرة (من الجلسة)"})
    return {"url": url, "status": st, "findings": findings}
