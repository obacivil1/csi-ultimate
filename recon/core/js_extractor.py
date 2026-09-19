"""js_extractor.py — Extract script URLs and candidate API paths."""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from recon.core.scope_validator import ScopeValidator

SCRIPT_SRC_RE = re.compile(
    r'<script[^>]+src=["\']([^"\']+\.js[^"\']*)["\']',
    re.IGNORECASE,
)

API_PATH_RES = [
    re.compile(r'["\'](/api/[A-Za-z0-9_/?=&.\-]+)["\']'),
    re.compile(r'["\'](/v[0-9]+/[A-Za-z0-9_/?=&.\-]+)["\']'),
]


def _in_scope(url: str, scope: ScopeValidator) -> bool:
    try:
        scope.assert_allowed(url)
        return True
    except Exception:
        return False


def extract_script_urls(html: str, base_url: str, scope: ScopeValidator) -> set[str]:
    """Return absolute same-origin script URLs from HTML."""
    out: set[str] = set()
    for m in SCRIPT_SRC_RE.finditer(html or ""):
        src = m.group(1).strip()
        if not src:
            continue
        abs_url = urljoin(base_url, src)
        if len(abs_url) > 512:
            abs_url = abs_url[:512]
        if _in_scope(abs_url, scope):
            out.add(abs_url)
    return out


def extract_api_paths(js_text: str, base_url: str, scope: ScopeValidator) -> set[str]:
    """Return absolute candidate API paths from JS source."""
    out: set[str] = set()
    if not js_text:
        return out
    for pat in API_PATH_RES:
        for m in pat.finditer(js_text):
            path = m.group(1).strip()
            if not path:
                continue
            if len(path) > 512:
                path = path[:512]
            abs_url = urljoin(base_url, path)
            if len(abs_url) > 512:
                abs_url = abs_url[:512]
            if _in_scope(abs_url, scope):
                out.add(abs_url)
    return out


def extract_from_html(html: str, base_url: str, scope: ScopeValidator) -> dict:
    """Return {'scripts': [...], 'candidates': [...]}."""
    scripts = sorted(extract_script_urls(html, base_url, scope))
    # For candidates we need to scan html itself for API paths as well
    candidates = sorted(extract_api_paths(html, base_url, scope))
    return {"scripts": scripts, "candidates": candidates}
