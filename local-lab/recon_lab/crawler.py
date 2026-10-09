"""
recon_lab/crawler.py — زاحف محدود النطاق يبني خريطة الموقع.
=========================================================
BFS بنفس المضيف فقط + حدّ صفحات/عمق. يستخرج من كل صفحة HTML:
  links (a[href]) / forms (action+method+inputs) / scripts (src) / iframes
ويقرأ /robots.txt و /sitemap.xml كنقاط انطلاق إضافية.
"""
import re
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # لmypy: تعريف واحد صريح (وقت التشغيل يختار أدناه)
    from scoped import Scope
else:
    try:
        from ..scanner.scoped import Scope
    except ImportError:
        from scoped import Scope

HREF_RE = re.compile(r'<a\s[^>]*?href=["\']([^"\']+)["\']', re.IGNORECASE)
SRC_RE = re.compile(r'<(?:script|iframe)[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
FORM_RE = re.compile(r'<form\s([^>]*)>(.*?)</form>', re.IGNORECASE | re.DOTALL)
INPUT_RE = re.compile(r'<input\s([^>]*)>', re.IGNORECASE)
ATTR_RE = re.compile(r'(\w+)=["\']([^"\']*)["\']')
TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.IGNORECASE | re.DOTALL)
LOC_RE = re.compile(r'<loc[^>]*>(.*?)</loc>', re.IGNORECASE)
SKIP = ("javascript:", "mailto:", "tel:", "#", "data:")
#: روابط تُنهي الجلسة أو تحذف بلا رجعة — تُسجَّل ولا تُزور.
#: لماذا: زحف واحد يتبع رابط «تسجيل الخروج»存在于 كل صفحة، فتُفقد
#: الجلسة بعد أول صفحة، ثم يصمت كل فحص لاحق，因为它 يقيس صفحة
#: الدخول بدل صفحة الفحص (حادث DVWA: 0 نتائج على 30 مسارًا).
DESTRUCTIVE = ("logout", "logoff", "log-out", "log_out", "signout",
               "sign-out", "sign_out", "do_logout", "endsession",
               "end-session", "session/end", "sessiondestroy",
               "destroy_session")
#: مفاتيح اسمها فعل: تفعيل جدار، debug، تثبيت… تُسجَّل ولا تُزور.
STATE_KEYS = ("logout", "delete", "remove", "destroy", "reset", "purge",
              "wipe", "format", "shutdown", "reboot", "install", "upgrade",
              "unregister", "disable", "enable", "toggle", "debug",
              "phpids", "verbose", "admin", "cmd", "exec", "run")
#: مفاتيح تحكّم تحتاج قيمةً من STATE_VALUES لتُعتبر تغييرًا للحالة
#: (حتى لا نمنع `?action=view&id=1`).
CONTROL_KEYS = ("action", "do", "op", "task", "mode", "cmd", "submit",
                "set", "switch", "step", "state")
#: قيم تُحوّل state التطبيق.
STATE_VALUES = ("on", "off", "enable", "disable", "toggle", "true", "false",
                "yes", "no", "reset", "clear", "delete", "remove", "purge",
                "install", "upgrade", "run", "exec", "shutdown", "format",
                "logout", "signout", "logoff")


def _destructive(url: str) -> bool:
    """هل الرابط يُنهي الجلسة أو يغيّر حالة التطبيق؟ يُسجَّل ولا يُطلب.

    رابط GET يبدو آمنًا قد يكون زرًا خطيرًا: DVWA يتيح `?phpids=on`
    لتفعيل الجدار الواقي بلا كلمة مرور. زحف يتبعه **يُفعّل الحاجز على
    الهدف**، فيحجب كل حقن لاحق، فيصمت الفحص ويبدو التطبيق آمنًا —
    الأداة هي التي سبّبت الصمت. لذلك: تُسجَّل الروابط state's لقابلية
    الاكتشاف (قد يكون وجه open-redirect)، ولا تُزور.
    """
    parts = urllib.parse.urlsplit(url)
    low = (parts.path or "").lower()
    if any(tok in low for tok in DESTRUCTIVE):
        return True
    for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True):
        lk = k.lower()
        if lk in STATE_KEYS:
            return True
        if lk in CONTROL_KEYS and v.strip().lower() in STATE_VALUES:
            return True
    return False


def _norm(url):
    p = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path or "/", p.query, ""))


def _same_netloc(a, b):
    return urllib.parse.urlsplit(a).netloc.lower() == \
        urllib.parse.urlsplit(b).netloc.lower()


def _parse_forms(html):
    forms = []
    for m in FORM_RE.finditer(html or ""):
        attrs = dict((k.lower(), v) for k, v in ATTR_RE.findall(m.group(1)))
        inputs = [dict((k.lower(), v) for k, v in ATTR_RE.findall(im.group(1)))
                  for im in INPUT_RE.finditer(m.group(2))]
        forms.append({"action": attrs.get("action", ""),
                      "method": attrs.get("method", "get").upper(),
                      "inputs": [{"name": i.get("name", ""),
                                  "type": i.get("type", "text")} for i in inputs]})
    return forms


def fetch_robots(session, base):
    """يقرأ /robots.txt ويعيد مسارات Disallow/Allow (قد تكون فارغة)."""
    try:
        st, _, raw = session.get(base.rstrip("/") + "/robots.txt", timeout=5)
    except Exception:
        return []
    if st != 200:
        return []
    out = []
    for line in raw.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if line.lower().startswith(("disallow:", "allow:")):
            path = line.split(":", 1)[1].strip()
            if path and path != "/":
                out.append(path)
    return out


def fetch_sitemap(session, base):
    """يقرأ /sitemap.xml ويعيد روابط <loc> (قد تكون فارغة)."""
    try:
        st, _, raw = session.get(base.rstrip("/") + "/sitemap.xml", timeout=5)
    except Exception:
        return []
    if st != 200:
        return []
    return [m.group(1).strip()
            for m in LOC_RE.finditer(raw.decode("utf-8", "replace"))]


COMMON_PATHS = [
    "login", "register", "logout", "dashboard", "admin", "upload",
    "search", "blog", "api", "api/me", "api/admin", "api/ping",
    "profile/1", "settings", "robots.txt", "sitemap.xml", ".git/HEAD",
    "static/", "uploads/", "download", "logo",
]


def _wordlist_paths():
    """يحمّل قائمة المسارات من engine/wordlists (مع بديل مضمّن)."""
    try:
        from payloads import load_wordlist
        words = load_wordlist("common_paths")
        if words:
            return words
    except Exception:
        pass
    return COMMON_PATHS


def _wait(limiter):
    """يبطئ قبل كل طلب إن وُجد محدّد. آمن للخيوط (token-bucket)."""
    if limiter is not None:
        try:
            limiter.wait()
        except Exception:
            pass


def _log(audit, url, kind, status=None):
    if audit is None:
        return
    try:
        audit.log({"event": "crawl", "url": url, "kind": kind,
                   "status": status})
    except Exception:
        pass


def discover_common(session, base, wordlist=None, workers=1, limiter=None,
                    audit=None):
    """يفحص مسارات شائعة (dirbust-lite) ويعيد الموجودة (status < 400).

    workers>1: جلسة معزولة لكل خيط (لا تشارك الجرة) — نفس النتائج بسرعة أعلى.
    limiter: RateLimiter اختياري. بدونه dirbust-lite يرسل كل المسارات
    بلا فاصل — مقبول على المختبر، غير مقبول على هدف مرخّص.
    """
    words = wordlist or _wordlist_paths()
    root = base.rstrip("/") + "/"
    scope = getattr(session, "scope", None)
    tls, lock = threading.local(), threading.Lock()

    def sess():
        s = getattr(tls, "s", None)
        if s is None:
            try:
                from session import Session as _S
                s = _S(scope) if scope is not None else session
            except Exception:
                s = session
            tls.s = s
        return s

    def fetch(w):
        url = root + w
        if _destructive(url):
            return None          # dirbust-lite لا يطلب logout أيضًا
        try:
            s = sess()
            _wait(limiter)
            if s is session:
                with lock:  # احتياط الجلسة المشتركة
                    st, _, _ = s.get(url, timeout=4)
            else:
                st, _, _ = s.get(url, timeout=4)
        except Exception:
            return None
        _log(audit, url, "probe", st)
        return url if st and st < 400 else None

    found = []
    if workers and workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for url in pool.map(fetch, list(words)):
                if url:
                    found.append(url)
    else:
        for w in words:
            url = fetch(w)
            if url:
                found.append(url)
    return found


def crawl(session, start_url, max_pages=30, max_depth=2, scope=None,
          probe_common=True, workers=8, limiter=None, audit=None):
    """يزحف من start_url داخل نفس المضيف فقط. يعيد خريطة الموقع."""
    scope = scope or Scope()
    start = _norm(start_url)
    queue = [(start, 0)]
    seen = {start}
    pages, forms, scripts = [], [], []
    found = set()

    def consider(raw_link, page_url):
        if not raw_link or raw_link.startswith(SKIP):
            return None
        absu = _norm(urllib.parse.urljoin(page_url, raw_link))
        if not _same_netloc(absu, start):
            return None
        try:
            scope.check_url(absu)
        except Exception:
            return None
        found.add(absu)
        if _destructive(absu):
            return None          # اكتشاف بلا تنفيذ
        return absu

    while queue and len(pages) < max_pages:
        url, depth = queue.pop(0)
        try:
            _wait(limiter)
            st, hdrs, raw = session.get(url, timeout=6)
        except Exception:
            continue
        _log(audit, url, "page", st)
        ctype = next((v for k, v in hdrs if k.lower() == "content-type"), "")
        html = raw.decode("utf-8", "replace") if "html" in ctype else ""
        title = (TITLE_RE.search(html).group(1).strip()
                 if TITLE_RE.search(html) else "")
        links = []
        if html:
            for m in HREF_RE.finditer(html):
                nxt = consider(m.group(1).strip(), url)
                if nxt:
                    links.append(nxt)
                    if depth < max_depth and nxt not in seen and len(pages) < max_pages:
                        seen.add(nxt)
                        queue.append((nxt, depth + 1))
            for m in SRC_RE.finditer(html):
                s = consider(m.group(1).strip(), url)
                if s:
                    scripts.append({"page": url, "src": s})
            for f in _parse_forms(html):
                act = f["action"] or url
                absa = consider(act, url) or url
                forms.append({"page": url, "action": absa,
                              "method": f["method"], "inputs": f["inputs"]})
        pages.append({"url": url, "depth": depth, "status": st,
                      "title": title[:80], "links": len(links)})

    base = f"{urllib.parse.urlsplit(start).scheme}://{urllib.parse.urlsplit(start).netloc}"

    def _in_scope(u):
        """مسارات robots/sitemap كانت تُضاف بلا فحص نطاق — الآن مثل consider."""
        try:
            scope.check_url(u)
            return True
        except Exception:
            return False

    robots = [u for u in
              (urllib.parse.urljoin(base + "/", p) for p in fetch_robots(session, base))
              if _in_scope(u)]
    sitemap = [u for u in fetch_sitemap(session, base)
               if _same_netloc(u, start) and _in_scope(u)]
    probed = discover_common(session, base, workers=workers, limiter=limiter,
                             audit=audit) \
        if probe_common else []
    endpoints = sorted(set(found) | set(robots) | set(sitemap) | set(probed) | {start})
    paths = sorted({urllib.parse.urlsplit(e).path or "/" for e in endpoints})
    return {"start": start, "pages": pages, "endpoints": endpoints,
            "paths": paths, "forms": forms, "scripts": scripts,
            "robots": robots, "sitemap": sitemap, "probed": sorted(set(probed))}
