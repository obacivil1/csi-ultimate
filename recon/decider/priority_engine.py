"""priority_engine.py — ترتيب الفروض حسب القيمة المتوقعة (تحليل فقط).

الفكرة: ليست كل فرضية تستحق نفس الوقت. فرضية IDOR بثقة عالية
تستحق أن تُفحص قبل فرضية منطقية بثقة منخفضة.
القيمة = الأثر × قابلية الاستغلال × وزن الثقة. لا شبكة، لا تنفيذ.
"""
from __future__ import annotations

# الأثر حسب الفئة: تسرب البيانات (idor/auth) أغلى من غيره
_IMPACT = {"idor": 3, "auth": 3, "exposure": 2, "logic": 2}
# قابلية الاستغلال: نقدّرها من ثقة الفرضية (لا بيانات أخرى عندنا)
_EXPLOITABILITY = {"high": 3, "medium": 2, "low": 1}
# وزن الثقة: الفرضية الأكيدة أثقل
_CONFIDENCE_WEIGHT = {"high": 3, "medium": 2, "low": 1}


def prioritize(hypotheses: list[dict]) -> list[dict]:
    """رتب الفروض من الأعلى قيمة إلى الأقل (لا تعدّل المدخلات).

    كل نتيجة هي نسخة من الفرضية مع مفتاح إضافي "value" (عدد صحيح).
    """
    out: list[dict] = []
    for h in hypotheses or []:
        category = str(h.get("category", ""))
        confidence = str(h.get("confidence", ""))
        # الفئة المجهولة = أقل أثر (تفسير مقيّد: لا نرفع ما لا نعرفه)
        impact = _IMPACT.get(category, 1)
        exploitability = _EXPLOITABILITY.get(confidence, 1)
        weight = _CONFIDENCE_WEIGHT.get(confidence, 1)
        value = int(impact * exploitability * weight)
        item = dict(h)
        item["value"] = value
        out.append(item)
    # الفرز: القيمة تنازليًا، ثم العنوان أبجديًا للثبات
    out.sort(key=lambda r: (-r["value"], str(r.get("url", ""))))
    return out
