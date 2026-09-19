"""brain.py — مدخل العقل: يشغّل الوحدات الأربع بالترتيب ويعيد تقريرًا واحدًا.

التسلسل: ترتيب العناوين → كشف الأنماط → كشف الشواذ → بناء الفروض.
تحليل فقط: لا شبكة، لا اختبار حي، فقط قراءة بيانات جاهزة وإنتاج تقرير.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .anomaly_finder import find_anomalies
from .endpoint_ranker import rank_endpoints
from .hypothesis_builder import build_hypotheses
from .pattern_finder import find_patterns

# ترتيب الثقة: العالية أولًا
_CONFIDENCE_ORDER = {"high": 0, "medium": 1, "low": 2}


def analyze(
    endpoints: list[str],
    responses: list[dict],
) -> dict:
    """حلّل العناوين والردود وأعد تقرير العقل الكامل."""
    ranked = rank_endpoints(endpoints or [])
    patterns = find_patterns(endpoints or [])
    anomalies = find_anomalies(responses or [])
    hypotheses = build_hypotheses(ranked, patterns, anomalies)

    # أعلى ثقة موجودة: high إن وجدت، وإلا medium، وإلا low، وإلا None
    top_confidence: str | None = None
    for h in hypotheses:
        c = h.get("confidence")
        if top_confidence is None or _CONFIDENCE_ORDER.get(c, 9) < _CONFIDENCE_ORDER[top_confidence]:
            top_confidence = c

    return {
        "summary": {
            "endpoints_count": len(endpoints or []),
            "responses_count": len(responses or []),
            "hypotheses_count": len(hypotheses),
            "top_confidence": top_confidence,
        },
        "top_hypotheses": hypotheses[:5],
        "hypotheses": hypotheses,
        "ranked": ranked,
        "patterns": patterns,
        "anomalies": anomalies,
    }


def to_json(result: dict) -> str:
    """حوّل التقرير إلى نص JSON جميل مع الحفاظ على العربية."""
    return json.dumps(result, indent=2, ensure_ascii=False)


def save(result: dict, path: str) -> str:
    """احفظ التقرير في ملف بكتابة ذرية (مؤقت + استبدال). تعيد المسار المطلق."""
    dest = Path(path).resolve()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_text(to_json(result), encoding="utf-8")
    os.replace(tmp, dest)
    return str(dest)
