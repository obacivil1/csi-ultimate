"""اختبارات العقل القراري — بلا شبكة."""
from __future__ import annotations

import json
import pathlib

import pytest

from recon.decider import decide, save, to_json
from recon.decider.feedback_loop import FeedbackLoop


def _h(url, category="idor", confidence="high"):
    return {
        "title": "عنوان",
        "what_to_test": "افحص",
        "url": url,
        "why": "سبب",
        "confidence": confidence,
        "category": category,
    }


def _brain(hyps):
    return {"hypotheses": hyps}


def test_empty():
    res = decide(_brain([]))
    assert res["summary"] == {
        "hypotheses_considered": 0,
        "hypotheses_selected": 0,
        "plans_count": 0,
        "total_estimated_minutes": 0,
    }
    assert res["plans"] == []
    assert res["rejected"] == []


def test_basic_decide():
    hyps = [_h("https://example.com/user/1"), _h("https://example.com/about", "logic", "low")]
    res = decide(_brain(hyps))
    assert res["strategy"] == "balanced"
    assert res["summary"]["hypotheses_considered"] == 2
    assert res["summary"]["hypotheses_selected"] == 2
    assert res["summary"]["plans_count"] >= 1
    assert res["summary"]["total_estimated_minutes"] == 10


def test_fast_selects_five():
    hyps = [_h(f"https://example.com/{i}") for i in range(10)]
    res = decide(_brain(hyps), "fast")
    assert res["summary"]["hypotheses_selected"] == 5
    assert len(res["rejected"]) == 5
    assert all("rejection_reason" in r for r in res["rejected"])


def test_rejected_have_reason():
    hyps = [_h(f"https://example.com/{i}") for i in range(8)]
    res = decide(_brain(hyps), "fast")
    assert len(res["rejected"]) == 3
    import re

    arabic = re.compile(r"[\u0600-\u06FF]")
    assert all(arabic.search(r["rejection_reason"]) for r in res["rejected"])


def test_feedback_flips_order(tmp_path):
    hyps = [
        _h("https://example.com/exp", "exposure", "high"),  # القيمة 18
        _h("https://example.com/logic", "logic", "high"),  # القيمة 18 أيضًا
    ]
    plain = decide(_brain(hyps))
    first_plain = plain["plans"][0]["target_hypotheses"][0]["url"]
    # عاقب exposure ثلاث مرات → 18×0.5=9 فيسقط تحت logic
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    for i in range(3):
        fb.record(f"https://example.com/f{i}", "exposure", False, "وهم")
    adj = decide(_brain(hyps), feedback=fb)
    first_adj = adj["plans"][0]["target_hypotheses"][0]["url"]
    assert first_plain == "https://example.com/exp"
    assert first_adj == "https://example.com/logic"


def test_unknown_strategy_raises():
    with pytest.raises(ValueError):
        decide(_brain([_h("https://example.com/a")]), "turbo")


def test_summary_shape():
    res = decide(_brain([_h("https://example.com/a")]))
    assert set(res.keys()) == {"strategy", "summary", "plans", "rejected"}
    assert set(res["summary"].keys()) == {
        "hypotheses_considered", "hypotheses_selected", "plans_count", "total_estimated_minutes",
    }


def test_json_roundtrip_arabic():
    res = decide(_brain([_h("https://example.com/user/1")]))
    text = to_json(res)
    assert "خطة" in text  # العربية غير مهربة
    assert json.loads(text)["summary"] == res["summary"]


def test_save_atomic(tmp_path):
    res = decide(_brain([_h("https://example.com/a")]))
    out = tmp_path / "decision.json"
    dest = save(res, str(out))
    assert pathlib.Path(dest).is_absolute()
    assert json.loads(pathlib.Path(dest).read_text(encoding="utf-8"))["strategy"] == "balanced"
    assert list(tmp_path.glob("*.tmp")) == []


def test_public_api():
    import recon.decider as d

    for name in ["prioritize", "build_plans", "DecisionLog", "FeedbackLoop",
                 "get_strategy", "list_strategies", "decide", "to_json", "save"]:
        assert hasattr(d, name), name
