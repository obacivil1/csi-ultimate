"""action_planner.py — تجميع الفروض المرتبة في خطط عمل (تحليل فقط).

الفكرة: قائمة من 20 فرضية مخيفة. نجمعها حسب الفئة في خطط صغيرة
(كل خطة 1-5 فروض) مع تعليمات عربية خطوة بخطوة تنفذها أنت بيدك.
المخطط يكتب الخطة فقط — لا ينفذ شيئًا ولا يلمس الشبكة.
"""
from __future__ import annotations

# حدود الاستراتيجيات: كم فرضية نأخذ من الأعلى
_STRATEGY_LIMITS = {"fast": 5, "balanced": 15, "thorough": 50}

# أسماء الفئات بالعربية للخطط
_CATEGORY_AR = {
    "idor": "التحقق من التصريح (IDOR)",
    "auth": "الصلاحيات",
    "exposure": "الانكشاف",
    "logic": "المنطق",
}

# الفئات التي تحتاج حسابين للفحص اليدوي
_TWO_ACCOUNT_CATEGORIES = frozenset({"idor", "auth"})

# أهداف جاهزة لكل فئة
_CATEGORY_GOAL = {
    "idor": "التأكد أن كل مستخدم يرى بياناته فقط ولا يرى بيانات غيره",
    "auth": "التأكد أن الصلاحيات مطبقة على كل مسار يستخدم المعامل",
    "exposure": "فحص الردود الغريبة يدويًا وفهم سببها",
    "logic": "مقارنة سلوك النسخ والمسارات المتشابهة",
}


def build_plans(
    ranked_hypotheses: list[dict],
    strategy: str = "balanced",
) -> list[dict]:
    """ابن خطط عمل مرتبة من الفروض (المدخلات يفترض أنها مرتبة بالأولوية)."""
    # استراتيجية مجهولة → رفض صريح (فشل مغلق: لا نخمن)
    if strategy not in _STRATEGY_LIMITS:
        raise ValueError(f"استراتيجية مجهولة: {strategy!r} (المسموح: fast/balanced/thorough)")
    limit = _STRATEGY_LIMITS[strategy]
    selected = list(ranked_hypotheses or [])[:limit]

    # التجميع حسب الفئة مع الحفاظ على ترتيب الأولوية داخل كل مجموعة
    by_category: dict[str, list[dict]] = {}
    for h in selected:
        cat = str(h.get("category", "logic"))
        by_category.setdefault(cat, []).append(h)

    # ترتيب الخطط: الفئة التي فيها أعلى قيمة أولًا
    def group_value(items: list[dict]) -> int:
        return max(int(i.get("value", 0)) for i in items)

    ordered = sorted(by_category.items(), key=lambda kv: -group_value(kv[1]))

    plans: list[dict] = []
    for cat, items in ordered:
        cat_ar = _CATEGORY_AR.get(cat, cat)
        # كل خطة تحمل 5 فروض كحد أقصى — نقسم المجموعة الكبيرة
        for chunk_no, i in enumerate(range(0, len(items), 5), start=1):
            chunk = items[i:i + 5]
            suffix = f" ({chunk_no})" if len(items) > 5 else ""
            steps = [_prep_step(cat)] + [
                f"افحص {h.get('url', '')}: {h.get('what_to_test', '')}"
                for h in chunk
            ]
            plans.append({
                "name": f"خطة {cat_ar}{suffix}",
                "goal": _CATEGORY_GOAL.get(cat, "فحص الفروض المذكورة يدويًا"),
                "steps": steps,
                "estimated_minutes": 5 * len(chunk),
                "needs_two_accounts": cat in _TWO_ACCOUNT_CATEGORIES,
                "target_hypotheses": chunk,
            })
    return plans


def _prep_step(category: str) -> str:
    """خطوة التحضير الأولى حسب الفئة."""
    if category in _TWO_ACCOUNT_CATEGORIES:
        return "جهز حسابين مختلفين على الموقع (حسابك وحساب اختبار ثان)"
    return "جهز متصفحًا نظيفًا وسجل ملاحظاتك لكل خطوة"
