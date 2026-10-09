"""
recon_lab/jsharvest.py — حصاد ملفات JS: مسارات API + أسرار مُسرَّبة.
==================================================================
يجلب سكربتات same-origin المكتشفة (بحد عدد/حجم) ويستخرج:
  - مسارات API المرشحة (يعيد استعمال js.extract_api_paths).
  - أسرار: api_key/secret/token/passwd مُسنَدة لقيم مقتبسة، مفاتيح AWS،
    كتل المفاتيح الخاصة — أعلى فئات مكافآت التسريبات.
كل الجلب عبر الجلسة الممررة (مقيّدة النطاق) — تحليل سلبي فقط.
"""
import re

try:
    from js import extract_api_paths
except ImportError:
    from .js import extract_api_paths

SECRET_RES = [
    ("api_key", re.compile(
        r'''(?i)(api[_-]?key|apikey)\s*[:=]\s*['"]([^'"]{8,})['"]''')),
    ("secret", re.compile(
        r'''(?i)(secret|client_secret)\s*[:=]\s*['"]([^'"]{8,})['"]''')),
    ("token", re.compile(
        r'''(?i)(auth[_-]?token|access[_-]?token)\s*[:=]\s*['"]([^'"]{12,})['"]''')),
    ("password", re.compile(
        r'''(?i)(passwd|password|pwd)\s*[:=]\s*['"]([^'"]{6,})['"]''')),
    ("aws", re.compile(r'''(AKIA[0-9A-Z]{16})''')),
    ("private_key", re.compile(r'''-----BEGIN [A-Z ]*PRIVATE KEY-----''')),
]

MAX_FILES = 5
MAX_BYTES = 200 * 1024


def find_secrets(js_text):
    """يعيد [{kind, line, snippet}] — المقتطف مبتور لحماية العرض."""
    out = []
    for i, line in enumerate((js_text or "").splitlines(), 1):
        for kind, pat in SECRET_RES:
            m = pat.search(line)
            if m:
                val = m.group(2) if m.lastindex and m.lastindex >= 2 \
                    else m.group(1)
                show = (val[:4] + "…" + val[-2:]) if len(val) > 8 else "…"
                out.append({"kind": kind, "line": i,
                            "snippet": line.strip()[:100].replace(val, show)})
                break
    return out


def harvest(session, scripts, base_url, scope=None, max_files=MAX_FILES):
    """scripts: [{page, src}] من الزاحف. يعيد {files, candidates}."""
    scope = scope or getattr(session, "scope", None)
    files, candidates = [], set()
    for item in (scripts or [])[:max_files]:
        src = item.get("src", "") if isinstance(item, dict) else item
        if not src:
            continue
        try:
            st, _, raw = session.get(src, timeout=6)
        except Exception:
            continue
        if st != 200:
            continue
        js = raw[:MAX_BYTES].decode("utf-8", "replace")
        paths = extract_api_paths(js, base_url, scope)
        candidates.update(paths)
        files.append({"url": src, "size": len(raw),
                      "api_paths": sorted(paths),
                      "secrets": find_secrets(js)})
    return {"files": files, "candidates": sorted(candidates)}
