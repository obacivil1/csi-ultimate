"""decision_brain.py — مدخل طبقة القرار: من فروض العقل إلى خطة عمل.

التسلسل: خذ الفروض → طبّق ذاكرة التعلم (إن وجدت) → رتب بالقيمة →
ابن الخطط حسب الاستراتيجية → أعد القرار مع المرفوضات وأسبابها.
تخطيط فقط: لا شبكة، لا تنفيذ، القرار النهائي لك أنت.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .action_planner import build_plans
from .feedback_loop import FeedbackLoop
from .priority_engine import prioritize


def decide(
    brain_result: dict,
    strategy: str = "balanced",
    feedback: FeedbackLoop | None = None,
) -> dict:
    """حوّل نتيجة العقل إلى قرار: خطط مرتبة + مرفوضات معللة."""
    hypotheses = list((brain_result or {}).get("hypotheses", []) or [])

    # 1) الترتيب الأولي بالقيمة
    prioritized = prioritize(hypotheses)

    # 2) تعديل الذاكرة: اضرب القيمة بمعامل التعلم وأعد الفرز
    if feedback is not None:
        for h in prioritized:
            adj = feedback.confidence_adjustment(str(h.get("url", "")), str(h.get("category", "")))
            h["adjusted_value"] = round(float(h.get("value", 0)) * float(adj), 2)
        prioritized.sort(key=lambda r: (-r["adjusted_value"], str(r.get("url", ""))))

    # 3) بناء الخطط (ترفض الاستراتيجية المجهولة هنا)
    plans = build_plans(prioritized, strategy)

    # 4) المختار = ما دخل الخطط، والمرفوض = الباقي مع السبب
    selected_urls = [h.get("url") for p in plans for h in p.get("target_hypotheses", [])]
    selected_set = set(selected_urls)
    rejected = []
    for h in prioritized:
        if h.get("url") not in selected_set:
            item = dict(h)
            item["rejection_reason"] = "لم تدخل حد الاستراتيجية — قيمة أقل من المختار"
            rejected.append(item)

    total_minutes = sum(int(p.get("estimated_minutes", 0)) for p in plans)
    return {
        "strategy": strategy,
        "summary": {
            "hypotheses_considered": len(hypotheses),
            "hypotheses_selected": len(selected_urls),
            "plans_count": len(plans),
            "total_estimated_minutes": total_minutes,
        },
        "plans": plans,
        "rejected": rejected,
    }


def to_json(result: dict) -> str:
    """حوّل القرار إلى نص JSON جميل مع الحفاظ على العربية."""
    return json.dumps(result, indent=2, ensure_ascii=False)


def save(result: dict, path: str) -> str:
    """احفظ القرار في ملف بكتابة ذرية (مؤقت + استبدال). تعيد المسار المطلق."""
    dest = Path(path).resolve()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_text(to_json(result), encoding="utf-8")
    os.replace(tmp, dest)
    return str(dest)
