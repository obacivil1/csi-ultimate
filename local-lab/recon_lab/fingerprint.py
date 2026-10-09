"""
recon_lab/fingerprint.py — بصمة الخادم والإطار من الترويسات والجسم.
================================================================
يكشف: خادم HTTP، X-Powered-By، أسماء الكوكيز الدالة (session=Flask...)،
مولّد <meta>، مكتبات JS بإصداراتها، وآثار أطر مشهورة في الجسم.
"""
import re
import urllib.parse

META_GEN_RE = re.compile(
    r'<meta\s[^>]*name=["\']generator["\'][^>]*content=["\']([^"\']+)["\']',
    re.IGNORECASE)
LIB_RE = re.compile(
    r'(jquery|bootstrap|angular|react|vue)[\-\.](\d+\.\d+(?:\.\d+)?)',
    re.IGNORECASE)
BODY_CLUES = [
    ("wp-content", "WordPress"),
    ("Joomla!", "Joomla"),
    ("drupal", "Drupal"),
    ("__NEXT_DATA__", "Next.js"),
    ("ng-version", "Angular"),
    ("_csrf", "CSRF-token-framework"),
    ("laravel_session", "Laravel"),
    ("PHPSESSID", "PHP"),
    ("JSESSIONID", "Java"),
    ("session", "Flask-session?"),
]

OLD_LIBS = {("jquery", 1): "قديمة ومعروفة بثغرات XSS",
            ("jquery", 2): "قديمة — حدّثها",
            ("bootstrap", 2): "قديمة",
            ("angular", 1): "قديمة جدًا (1.x)"}


def fingerprint(session, base_url):
    st, hdrs, raw = session.get(base_url.rstrip("/") + "/", timeout=6)
    h = {k.lower(): v for k, v in hdrs}
    body = raw.decode("utf-8", "replace")
    server = h.get("server", "")
    powered = h.get("x-powered-by", "")
    cookies = [c.name for c in session.jar] if hasattr(session, "jar") else []
    gen = (META_GEN_RE.search(body).group(1)
           if META_GEN_RE.search(body) else "")
    libs = sorted({(m.group(1).lower(), m.group(2))
                   for m in LIB_RE.finditer(body)})
    guesses = []
    low = (server + " " + powered + " " + gen + " " + body[:4000]).lower()
    if "werkzeug" in low:
        guesses.append("Werkzeug (خادم تطوير Flask غالبًا)")
    if "flask" in low or any(c.lower() == "session" for c in cookies):
        guesses.append("Flask (كوكي session المميزة)")
    for clue, name in BODY_CLUES:
        if clue.lower() in low and name not in guesses:
            guesses.append(name)
    notes = []
    for name, ver in libs:
        major = int(ver.split(".")[0]) if ver.split(".")[0].isdigit() else 99
        if (name, major) in OLD_LIBS:
            notes.append(f"{name} {ver}: {OLD_LIBS[(name, major)]}")
    return {"url": base_url, "status": st, "server": server,
            "powered_by": powered, "cookies": cookies, "generator": gen,
            "js_libs": [f"{n} {v}" for n, v in libs],
            "framework_guesses": guesses, "notes": notes}
