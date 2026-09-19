"""pattern_finder.py — كشف الأشياء المتكررة (تحليل فقط، لا شبكة).

الفكرة: الشيء الذي يتكرر في أماكن كثيرة مهم. معامل id في 20 عنوانًا
يعني بابًا واحدًا مفتوحًا على 20 غرفة — افحص الباب مرة واحدة تكسب كثيرًا.
الدالة نقية: تقرأ قائمة عناوين وتعيد خريطة تكرار، لا تلمس الإنترنت.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

# نسخة API في المسار، مثل /v1/ أو /v2/
_VERSION_RE = re.compile(r"/v(\d+)/", re.IGNORECASE)
# مقطع رقمي كامل، مثل /123 — نستثنيه من المقاطع المتكررة
_NUMERIC_RE = re.compile(r"^\d+$")
# ملفات ثابتة نتجاهلها (تصميم وصور)
_STATIC_SUFFIXES = (".js", ".css", ".png", ".jpg")


def _is_static(url: str, path: str) -> bool:
    """هل العنوان ملف ثابت نتجاهله؟"""
    return path.lower().endswith(_STATIC_SUFFIXES)


def find_patterns(endpoints: list[str]) -> dict:
    """ابحث عن التكرار في قائمة العناوين.

    تعيد قاموسًا بأربعة مفاتيح: معاملات الاستعلام المتكررة،
    مقاطع المسار المتكررة، التجميع حسب النسخة، البادئات المشتركة.
    """
    # نتجاهل الملفات الثابتة من البداية
    urls: list[str] = []
    for url in endpoints:
        path = urlparse(url).path or "/"
        if not _is_static(url, path):
            urls.append(url)

    # 1) معاملات الاستعلام المتكررة: الاسم يظهر في عنوانين أو أكثر
    param_hits: dict[str, list[str]] = {}
    for url in urls:
        keys = set(parse_qs(urlparse(url).query).keys())
        for k in keys:
            param_hits.setdefault(k, []).append(url)
    repeated_query_params = [
        {"name": name, "count": len(sorted(set(eps))), "endpoints": sorted(set(eps))}
        for name, eps in param_hits.items()
        if len(set(eps)) >= 2
    ]
    repeated_query_params.sort(key=lambda r: (-r["count"], r["name"]))

    # 2) مقاطع المسار المتكررة: مقطع غير رقمي وغير فارغ في عنوانين أو أكثر
    segment_hits: dict[str, list[str]] = {}
    for url in urls:
        segments = {s for s in (urlparse(url).path or "/").split("/") if s and not _NUMERIC_RE.match(s)}
        for s in segments:
            segment_hits.setdefault(s, []).append(url)
    repeated_path_segments = [
        {"segment": seg, "count": len(sorted(set(eps))), "endpoints": sorted(set(eps))}
        for seg, eps in segment_hits.items()
        if len(set(eps)) >= 2
    ]
    repeated_path_segments.sort(key=lambda r: (-r["count"], r["segment"]))

    # 3) التجميع حسب النسخة: /v1/ أو /v2/ ... والباقي غير مُنسخ
    versioned: dict[str, list[str]] = {}
    for url in urls:
        m = _VERSION_RE.search(urlparse(url).path or "/")
        if m:
            key = f"v{m.group(1)}"
        else:
            key = "unversioned"
        versioned.setdefault(key, []).append(url)
    versioned_endpoints = {k: sorted(v) for k, v in sorted(versioned.items())}

    # 4) البادئات المشتركة: أول 3 مقاطع بعد المضيف، تظهر في عنوانين أو أكثر
    prefix_hits: dict[str, list[str]] = {}
    for url in urls:
        segments = [s for s in (urlparse(url).path or "/").split("/") if s]
        prefix = "/" + "/".join(segments[:3])
        prefix_hits.setdefault(prefix, []).append(url)
    shared_prefixes = [
        {"prefix": p, "count": len(sorted(set(eps))), "endpoints": sorted(set(eps))}
        for p, eps in prefix_hits.items()
        if len(set(eps)) >= 2
    ]
    shared_prefixes.sort(key=lambda r: (-r["count"], r["prefix"]))

    return {
        "repeated_query_params": repeated_query_params,
        "repeated_path_segments": repeated_path_segments,
        "versioned_endpoints": versioned_endpoints,
        "shared_prefixes": shared_prefixes,
    }
