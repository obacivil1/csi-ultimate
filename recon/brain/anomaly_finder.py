"""anomaly_finder.py — كشف الردود الغريبة (تحليل فقط، لا شبكة).

الفكرة: الرد الطبيعي له شكل متوقع. رد يقول «موجود» لكنه فارغ،
أو صفحة أضخم من أخواتها بثلاث مرات، أو خادم يصرخ بخطأ 500 —
كلها إشارات تستحق الفحص اليدوي.
الدالة نقية: تأخذ ملخصات ردود جاهزة وتعيد قائمة شواذ، لا تلمس الإنترنت.
"""
from __future__ import annotations

import statistics

# أنواع المحتوى المتوقعة — غيرها مع حالة 200 يعتبر غريبًا
_EXPECTED_CONTENT_TYPES = frozenset({
    "text/html",
    "application/json",
    "text/plain",
    "application/xml",
    "text/xml",
})

# ترتيب الخطورة للفرز: العالي أولًا
_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _base_type(content_type: str) -> str:
    """استخرج النوع الأساسي بدون الإضافات (مثل ; charset=utf-8)."""
    return (content_type or "").split(";")[0].strip().lower()


def find_anomalies(responses: list[dict]) -> list[dict]:
    """ابحث عن الردود الشاذة في قائمة ملخصات جاهزة.

    كل نتيجة: {"url", "reason", "detail", "severity", "value"}.
    أقل من 5 ردود → [] (العينة صغيرة ولا تصلح للإحصاء).
    """
    # عينة صغيرة لا تكفي لحساب الوسيط بثقة
    if len(responses) < 5:
        return []

    lengths = [int(r.get("content_length", 0) or 0) for r in responses]
    times = [float(r.get("response_time_ms", 0) or 0) for r in responses]
    median_length = statistics.median(lengths)
    median_time = statistics.median(times)

    out: list[dict] = []
    for r in responses:
        url = str(r.get("url", ""))
        status = int(r.get("status", 0) or 0)
        length = int(r.get("content_length", 0) or 0)
        elapsed = float(r.get("response_time_ms", 0) or 0)
        ctype = _base_type(str(r.get("content_type", "")))

        # أ) رد أضخم من الوسيط بثلاث مرات → متوسط
        if median_length > 0 and length > 3 * median_length:
            out.append({
                "url": url,
                "reason": "unusually_large",
                "detail": f"الحجم {length} أكبر من 3 أضعاف الوسيط {median_length}",
                "severity": "medium",
                "value": length,
            })

        # ب) موجود لكن فارغ (200 وحجم أقل من 100) → عالٍ
        if status == 200 and length < 100:
            out.append({
                "url": url,
                "reason": "unusually_small_200",
                "detail": f"الحالة 200 لكن الحجم {length} فقط — رد فارغ مشبوه",
                "severity": "high",
                "value": length,
            })

        # ج) خطأ خادم (500+) → عالٍ
        if status >= 500:
            out.append({
                "url": url,
                "reason": "server_error",
                "detail": f"الخادم أعاد خطأ {status}",
                "severity": "high",
                "value": status,
            })

        # د) رد بطيء (أبطأ من 3 أضعاف الوسيط) → منخفض
        if median_time > 0 and elapsed > 3 * median_time:
            out.append({
                "url": url,
                "reason": "slow_response",
                "detail": f"الزمن {elapsed}ms أبطأ من 3 أضعاف الوسيط {median_time}ms",
                "severity": "low",
                "value": elapsed,
            })

        # هـ) نوع محتوى غير متوقع مع 200 → متوسط
        if status == 200 and ctype not in _EXPECTED_CONTENT_TYPES:
            out.append({
                "url": url,
                "reason": "unexpected_content_type",
                "detail": f"نوع المحتوى «{ctype}» غير متوقع مع حالة 200",
                "severity": "medium",
                "value": ctype,
            })

        # و) خطأ 500 مع جسم → عالٍ (احتمال تسرب تفاصيل)
        if status == 500 and length > 0:
            out.append({
                "url": url,
                "reason": "status_500_with_body",
                "detail": f"خطأ 500 مع جسم حجمه {length} — قد يسرب تفاصيل",
                "severity": "high",
                "value": length,
            })

    # الفرز: العالي ثم المتوسط ثم المنخفض، والثبات أبجديًا
    out.sort(key=lambda a: (_SEVERITY_ORDER[a["severity"]], a["url"], a["reason"]))
    return out
