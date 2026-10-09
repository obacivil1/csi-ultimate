"""
recon_lab/js.py — استخراج السكربتات ومسارات API (port من recon/core/js_extractor.py).
===============================================================================
نفس التعابير النظامية، لكن بوابة النطاق هي Scope الخاص بالمختبر
(loopback افتراضيًا — أي رابط خارج النطاق يُستبعَد قبل أي اتصال).
"""
import re
from typing import TYPE_CHECKING
from urllib.parse import urljoin

if TYPE_CHECKING:  # لmypy: تعريف واحد صريح (وقت التشغيل يختار أدناه)
    from scoped import Scope
else:
    try:
        from ..scanner.scoped import Scope  # عند الاستيراد كحزمة local-lab.recon
    except ImportError:
        from scoped import Scope  # standalone: يتطلب scanner/ على sys.path

SCRIPT_SRC_RE = re.compile(
    r'<script[^>]+src=["\']([^"\']+\.js[^"\']*)["\']',
    re.IGNORECASE,
)
API_PATH_RES = [
    re.compile(r'["\'](/api/[A-Za-z0-9_/?=&.\-]+)["\']'),
    re.compile(r'["\'](/v[0-9]+/[A-Za-z0-9_/?=&.\-]+)["\']'),
    re.compile(r'(?:fetch|axios\.(?:get|post)|open)\(\s*["\']([^"\']+)["\']'),
]


def _allowed(url, scope):
    try:
        scope.check_url(url)
        return True
    except Exception:
        return False


def extract_script_urls(html, base_url, scope=None):
    """روابط <script src> المطلقة داخل النطاق فقط."""
    scope = scope or Scope()
    out = set()
    for m in SCRIPT_SRC_RE.finditer(html or ""):
        src = m.group(1).strip()
        if not src:
            continue
        abs_url = urljoin(base_url, src[:512])
        if _allowed(abs_url, scope):
            out.add(abs_url)
    return out


def extract_api_paths(js_text, base_url, scope=None):
    """مسارات API المرشحة من نص JS (أو HTML) — داخل النطاق فقط."""
    scope = scope or Scope()
    out = set()
    if not js_text:
        return out
    for pat in API_PATH_RES:
        for m in pat.finditer(js_text):
            path = (m.group(1) or "").strip()
            if not path or path.startswith(("javascript:", "mailto:", "#")):
                continue
            abs_url = urljoin(base_url, path[:512])
            if _allowed(abs_url, scope):
                out.add(abs_url)
    return out


def extract_from_html(html, base_url, scope=None):
    """يعيد {'scripts': [...], 'candidates': [...]}."""
    return {
        "scripts": sorted(extract_script_urls(html, base_url, scope)),
        "candidates": sorted(extract_api_paths(html, base_url, scope)),
    }
