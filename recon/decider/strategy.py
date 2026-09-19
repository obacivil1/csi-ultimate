"""strategy.py — أساليب العمل الثلاثة (تحليل فقط).

الفكرة: ليس كل يوم مثل غيره. يوم مستعجل تأخذ أهم 5 فروض فقط،
ويوم متفرغ تفحص كل شيء. الاستراتيجية تحدد: كم فرضية؟ وكم دقيقة؟
"""
from __future__ import annotations

# الأساليب الجاهزة: الحد الأقصى للفروض والدقائق
STRATEGIES = {
    "fast": {"max_hypotheses": 5, "max_minutes": 30},
    "balanced": {"max_hypotheses": 15, "max_minutes": 180},
    "thorough": {"max_hypotheses": 50, "max_minutes": 480},
}


def get_strategy(name: str) -> dict:
    """أعد نسخة من استراتيجية مسماة (اسم مجهول → رفض صريح)."""
    if name not in STRATEGIES:
        raise ValueError(f"استراتيجية مجهولة: {name!r} (المسموح: fast/balanced/thorough)")
    return dict(STRATEGIES[name])


def list_strategies() -> list[str]:
    """أعد أسماء الاستراتيجيات المتاحة بالترتيب."""
    return list(STRATEGIES.keys())
