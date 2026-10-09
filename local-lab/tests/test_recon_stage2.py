"""اختبارات المرحلة 2: Crawler / JS Extractor / Fingerprint / Headers."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "recon_lab"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from js import extract_api_paths, extract_from_html, extract_script_urls
from crawler import crawl, discover_common, fetch_robots, fetch_sitemap
from fingerprint import fingerprint
from headcheck import check_headers
from session import Session
from scoped import Scope

BASE = "http://127.0.0.1:5001"


def _target_up():
    try:
        urllib.request.urlopen(BASE + "/", timeout=2).close()
        return True
    except Exception:
        return False


def _sess():
    return Session(Scope(mode="loopback"))


def live(fn):
    return pytest.mark.skipif(not _target_up(),
                              reason="الهدف غير مفتوح")(fn)


# ---------------------------------------------------------- js (وحدات بلا شبكة)
def test_js_extracts_api_and_versioned_paths():
    js = ('fetch("/api/users?page=1"); axios.get(\'/v2/items\'); '
          'var u = "https://evil.example/x";')
    scope = Scope(mode="loopback")
    got = extract_api_paths(js, BASE + "/", scope)
    assert BASE + "/api/users?page=1" in got
    assert BASE + "/v2/items" in got
    assert not any("evil.example" in u for u in got)


def test_js_script_urls_same_origin_only():
    html = ('<script src="/static/a.js"></script>'
            '<script src="https://cdn.example/lib.js"></script>')
    got = extract_script_urls(html, BASE + "/", Scope(mode="loopback"))
    assert got == {BASE + "/static/a.js"}


def test_js_extract_from_html_shape():
    r = extract_from_html('<script src="/s.js"></script>', BASE + "/",
                          Scope(mode="loopback"))
    assert r["scripts"] == [BASE + "/s.js"]
    assert isinstance(r["candidates"], list)


# ---------------------------------------------------------- crawler (حي)
@live
def test_crawl_maps_local_site():
    m = crawl(_sess(), BASE + "/", max_pages=25, max_depth=2)
    assert len(m["pages"]) >= 4
    for must in ("/login", "/search", "/blog", "/upload", "/api/me"):
        assert any(p == must or p.startswith(must + "?") or p == must
                   for p in m["paths"]) or any(must in e for e in m["endpoints"]), must
    logins = [f for f in m["forms"] if f["action"].endswith("/login")]
    assert logins, "نموذج الدخول يجب أن يُكتشَف"
    names = {i["name"] for i in logins[0]["inputs"]}
    assert {"username", "password"} <= names


@live
def test_robots_and_sitemap_do_not_crash():
    s = _sess()
    assert isinstance(fetch_robots(s, BASE), list)
    assert isinstance(fetch_sitemap(s, BASE), list)


# ---------------------------------------------------------- fingerprint (حي)
@live
def test_fingerprint_detects_lab_stack():
    fp = fingerprint(_sess(), BASE)
    assert fp["status"] == 200
    assert "werkzeug" in fp["server"].lower()
    assert any("Flask" in g or "Werkzeug" in g
               for g in fp["framework_guesses"])


# ---------------------------------------------------------- headers (حي)
@live
def test_headcheck_flags_missing_csp():
    rep = check_headers(_sess(), BASE + "/")
    by = {f["item"]: f for f in rep["findings"]}
    assert by["CSP"]["state"] == "ناقص"
    assert by["X-Frame-Options"]["state"] == "ناقص"


@live
def test_headcheck_flags_weak_session_cookie():
    s = _sess()
    s.post(BASE + "/login",
           fields={"username": "omari", "password": "user123"})
    rep = check_headers(s, BASE + "/dashboard")
    weak = [f for f in rep["findings"]
            if f["item"].startswith("Cookie:") and f["state"] == "ضعيف"]
    assert weak, "كوكي الجلسة بلا Secure يجب أن يُوسَم ضعيفًا"


# ══════════════════════════════════════════════════════════════════════
# إبطاء الزحف + أثره
# ══════════════════════════════════════════════════════════════════════
# dirbust-lite يرسل كل PROBE_PATHS بلا فاصل. المختبر الحلقي لا يُبطَّأ
# (اختبارات سريعة)، أما أي هدف مرخّص فيُبطَّأ افتراضيًا.
class _CountingLimiter:
    def __init__(self):
        self.waits = 0

    def wait(self):
        self.waits += 1


class _FakeAudit:
    def __init__(self):
        self.rows = []

    def log(self, row):
        self.rows.append(row)


def test_external_limiter_skipped_for_loopback():
    from generic import _external_limiter
    assert _external_limiter("http://127.0.0.1:5001/") is None
    assert _external_limiter("http://localhost:5001/") is None
    assert _external_limiter("") is None


def test_external_limiter_present_for_remote_target():
    from generic import _external_limiter
    lim = _external_limiter("https://target.example/")
    assert lim is not None, "هدف خارجي بلا إبطاء = قصف"


@live
def test_discover_common_waits_on_limiter():
    lim = _CountingLimiter()
    got = discover_common(_sess(), BASE, wordlist=["a", "b", "c"],
                          workers=1, limiter=lim)
    assert len(got) <= 3
    assert lim.waits == 3, f"الإبطاء لم يُستدعَ: {lim.waits}"


@live
def test_crawl_waits_and_logs():
    lim = _CountingLimiter()
    aud = _FakeAudit()
    m = crawl(_sess(), BASE + "/", max_pages=3, max_depth=1,
              probe_common=False, limiter=lim, audit=aud)
    assert lim.waits == len(m["pages"]), "كل صفحة تتطلب نداء الإبطاء"
    pages = [r for r in aud.rows if r["kind"] == "page"]
    assert len(pages) == len(m["pages"])
    assert all(r["event"] == "crawl" for r in aud.rows)


@live
def test_probe_paths_are_logged():
    aud = _FakeAudit()
    discover_common(_sess(), BASE, wordlist=["login", "zzz-not-here"],
                    workers=1, audit=aud)
    probes = [r for r in aud.rows if r["kind"] == "probe"]
    assert len(probes) == 2
    assert any(r["url"].endswith("/login") for r in probes)


@live
def test_limiter_does_not_change_results():
    """البوابة تبطئ فقط — يجب ألا تغيّر أي نتيجة."""
    words = ["login", "admin", "api", "zzz-not-here"]
    fast = discover_common(_sess(), BASE, wordlist=words, workers=1)
    slow = discover_common(_sess(), BASE, wordlist=words, workers=1,
                           limiter=_CountingLimiter())
    assert fast == slow, "الإبطاء غيّر النتائج — خطأ"
    assert "_CountingLimiter" not in repr(fast)


def test_audit_failure_does_not_break_crawl():
    """كاتب الأثر المعطوب يجب ألا يُسقط الزحف."""
    class _BrokenAudit:
        def log(self, row):
            raise RuntimeError("disk full")

    assert discover_common(_sess(), BASE, wordlist=["a"], workers=1,
                           audit=_BrokenAudit()) is not None
