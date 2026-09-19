"""اختبارات محرك الأولوية — بلا شبكة."""
from __future__ import annotations

from recon.decider.priority_engine import prioritize


def _h(url, category="idor", confidence="high"):
    return {
        "title": "عنوان",
        "what_to_test": "افحص",
        "url": url,
        "why": "سبب",
        "confidence": confidence,
        "category": category,
    }


def test_empty():
    assert prioritize([]) == []


def test_idor_high_value_27():
    res = prioritize([_h("https://example.com/a")])
    assert res[0]["value"] == 27  # 3 × 3 × 3


def test_logic_low_value_2():
    res = prioritize([_h("https://example.com/a", category="logic", confidence="low")])
    assert res[0]["value"] == 2  # 2 × 1 × 1


def test_auth_medium_value_12():
    res = prioritize([_h("https://example.com/a", category="auth", confidence="medium")])
    assert res[0]["value"] == 12  # 3 × 2 × 2


def test_exposure_high_value_18():
    res = prioritize([_h("https://example.com/a", category="exposure", confidence="high")])
    assert res[0]["value"] == 18  # 2 × 3 × 3


def test_sorted_descending():
    hyps = [
        _h("https://example.com/low", category="logic", confidence="low"),
        _h("https://example.com/high", category="idor", confidence="high"),
        _h("https://example.com/mid", category="exposure", confidence="medium"),
    ]
    res = prioritize(hyps)
    assert [r["url"] for r in res] == [
        "https://example.com/high",
        "https://example.com/mid",
        "https://example.com/low",
    ]


def test_tie_alphabetical():
    hyps = [_h("https://example.com/b"), _h("https://example.com/a")]
    res = prioritize(hyps)
    assert [r["url"] for r in res] == ["https://example.com/a", "https://example.com/b"]


def test_value_key_added():
    res = prioritize([_h("https://example.com/a")])
    assert "value" in res[0]
    assert isinstance(res[0]["value"], int)


def test_unknown_category_lowest():
    res = prioritize([_h("https://example.com/a", category="mystery", confidence="high")])
    assert res[0]["value"] == 9  # 1 × 3 × 3


def test_unknown_confidence_lowest():
    res = prioritize([_h("https://example.com/a", category="idor", confidence="unknown")])
    assert res[0]["value"] == 3  # 3 × 1 × 1


def test_input_not_mutated():
    hyps = [_h("https://example.com/a")]
    prioritize(hyps)
    assert "value" not in hyps[0]
