"""اختبارات مخطط العمل — بلا شبكة."""
from __future__ import annotations

import pytest

from recon.decider.action_planner import build_plans


def _h(url, category="idor", value=27):
    return {
        "title": "عنوان",
        "what_to_test": "افحص الرقم",
        "url": url,
        "why": "سبب",
        "confidence": "high",
        "category": category,
        "value": value,
    }


def test_empty():
    assert build_plans([]) == []


def test_fast_limit_five():
    hyps = [_h(f"https://example.com/{i}") for i in range(10)]
    plans = build_plans(hyps, "fast")
    total = sum(len(p["target_hypotheses"]) for p in plans)
    assert total == 5


def test_balanced_limit_fifteen():
    hyps = [_h(f"https://example.com/{i}") for i in range(20)]
    plans = build_plans(hyps, "balanced")
    total = sum(len(p["target_hypotheses"]) for p in plans)
    assert total == 15


def test_thorough_all_max_fifty():
    hyps = [_h(f"https://example.com/{i}") for i in range(60)]
    plans = build_plans(hyps, "thorough")
    total = sum(len(p["target_hypotheses"]) for p in plans)
    assert total == 50


def test_group_by_category():
    hyps = [_h("https://example.com/a", "idor"), _h("https://example.com/b", "exposure")]
    plans = build_plans(hyps)
    assert len(plans) == 2
    names = " ".join(p["name"] for p in plans)
    assert "IDOR" in names


def test_plan_max_five_split():
    hyps = [_h(f"https://example.com/{i}") for i in range(7)]
    plans = build_plans(hyps)
    assert len(plans) == 2
    assert all(len(p["target_hypotheses"]) <= 5 for p in plans)
    assert [len(p["target_hypotheses"]) for p in plans] == [5, 2]


def test_idor_needs_two_accounts():
    plans = build_plans([_h("https://example.com/a", "idor")])
    assert plans[0]["needs_two_accounts"] is True


def test_exposure_no_two_accounts():
    plans = build_plans([_h("https://example.com/a", "exposure")])
    assert plans[0]["needs_two_accounts"] is False


def test_estimated_minutes():
    plans = build_plans([_h(f"https://example.com/{i}") for i in range(3)])
    assert plans[0]["estimated_minutes"] == 15


def test_unknown_strategy_raises():
    with pytest.raises(ValueError):
        build_plans([_h("https://example.com/a")], "turbo")


def test_arabic_steps():
    import re

    plans = build_plans([_h("https://example.com/a")])
    arabic = re.compile(r"[\u0600-\u06FF]")
    assert arabic.search(plans[0]["name"])
    assert arabic.search(plans[0]["goal"])
    assert all(arabic.search(s) for s in plans[0]["steps"])
