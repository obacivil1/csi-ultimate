"""endpoint_ranker.py — ترتيب العناوين حسب الأهمية (تحليل فقط، لا شبكة).

الفكرة: ليس كل عنوان متساويًا. العنوان الذي فيه رقم (مثل /user/123)
مرشح لفاحص الأبواب، وملفات التصميم (.js) أقل أهمية.
الدالة نقية: تأخذ قائمة عناوين وتعيد قائمة مرتبة، لا تلمس الإنترنت.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

# مقطع رقمي كامل في المسار، مثل /123
_NUMERIC_SEGMENT_RE = re.compile(r"^\d+$")
# كلمات مثيرة في العنوان
_KEYWORD_RE = re.compile(r"admin|user|account|api", re.IGNORECASE)
# نسخة API في المسار، مثل /v1/ أو /v2/ أو /api/
_VERSIONED_RE = re.compile(r"/v\d+/|/api/", re.IGNORECASE)
# أسماء معاملات مثيرة في الاستعلام
_QUERY_KEY_RE = re.compile(r"id|user|uid", re.IGNORECASE)
# ملفات ثابتة (تصميم وصور) — منخفضة الأهمية
_STATIC_SUFFIXES = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2")


def rank_endpoints(endpoints: list[str]) -> list[dict]:
    """رتب العناوين من الأهم إلى الأقل أهمية.

    كل نتيجة: {"url": العنوان, "score": درجة 0-10, "reasons": أسباب الدرجة}
    """
    ranked: list[dict] = []
    for url in endpoints:
        score = 0
        reasons: list[str] = []
        parsed = urlparse(url)
        path = parsed.path or "/"
        lowered = url.lower()

        # مقطع رقمي في المسار → +3 (مرشح IDOR)
        segments = [s for s in path.split("/") if s]
        if any(_NUMERIC_SEGMENT_RE.match(s) for s in segments):
            score += 3
            reasons.append("مقطع رقمي في المسار (مرشح IDOR)")

        # كلمة مثيرة في العنوان → +2
        if _KEYWORD_RE.search(lowered):
            score += 2
            reasons.append("كلمة مثيرة (admin/user/account/api)")

        # معامل مثير في الاستعلام → +3
        query_keys = parse_qs(parsed.query).keys()
        if any(_QUERY_KEY_RE.search(k) for k in query_keys):
            score += 3
            reasons.append("معامل مثير في الاستعلام (id/user/uid)")

        # نسخة API في المسار → +1
        if _VERSIONED_RE.search(path):
            score += 1
            reasons.append("مسار API بنسخة")

        # ملف ثابت → -3 (منخفض الأهمية)
        if path.lower().endswith(_STATIC_SUFFIXES):
            score -= 3
            reasons.append("ملف ثابت (تصميم/صورة) — منخفض الأهمية")

        # صفحة عادية بلا إشارات → تبقى 0
        if not reasons:
            reasons.append("صفحة عادية بلا إشارات")

        # الدرجة بين 0 و 10 دائمًا
        score = max(0, min(10, score))
        ranked.append({"url": url, "score": score, "reasons": reasons})

    # مرتبة من الأهم إلى الأقل، والمتساوية مرتبة أبجديًا للثبات
    ranked.sort(key=lambda r: (-r["score"], r["url"]))
    return ranked
