"""اختبارات حلقة التعلم — بلا شبكة."""
from __future__ import annotations

from recon.decider.feedback_loop import FeedbackLoop


def test_default_neutral(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    assert fb.confidence_adjustment("https://example.com/a", "idor") == 1.0


def test_three_false_is_penalty(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    for i in range(3):
        fb.record(f"https://example.com/{i}", "idor", False, "وهم")
    assert fb.confidence_adjustment("https://example.com/x", "idor") == 0.5


def test_three_real_is_boost(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    for i in range(3):
        fb.record(f"https://example.com/{i}", "idor", True, "حقيقي")
    assert fb.confidence_adjustment("https://example.com/x", "idor") == 1.5


def test_partial_false_interpolates(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    fb.record("https://example.com/a", "idor", False, "وهم واحد")
    adj = fb.confidence_adjustment("https://example.com/x", "idor")
    assert 0.5 < adj < 1.0


def test_partial_real_interpolates(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    for i in range(2):
        fb.record(f"https://example.com/{i}", "auth", True, "حقيقي")
    adj = fb.confidence_adjustment("https://example.com/x", "auth")
    assert 1.0 < adj < 1.5


def test_categories_independent(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    for i in range(3):
        fb.record(f"https://example.com/{i}", "idor", False, "وهم")
    assert fb.confidence_adjustment("https://example.com/x", "idor") == 0.5
    assert fb.confidence_adjustment("https://example.com/x", "logic") == 1.0


def test_bounds_never_exceeded(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    for i in range(10):
        fb.record(f"https://example.com/f{i}", "idor", False, "وهم")
    for i in range(10):
        fb.record(f"https://example.com/r{i}", "auth", True, "حقيقي")
    assert fb.confidence_adjustment("https://example.com/x", "idor") == 0.5
    assert fb.confidence_adjustment("https://example.com/x", "auth") == 1.5


def test_stats_shape(tmp_path):
    fb = FeedbackLoop(tmp_path / "fb.jsonl")
    fb.record("https://example.com/a", "idor", True, "حقيقي")
    fb.record("https://example.com/b", "idor", False, "وهم")
    fb.record("https://example.com/c", "logic", True, "حقيقي")
    s = fb.stats()
    assert s["per_category"]["idor"] == {"real": 1, "false": 1, "total": 2}
    assert s["per_category"]["logic"] == {"real": 1, "false": 0, "total": 1}
    assert (s["total_real"], s["total_false"], s["total"]) == (2, 1, 3)


def test_persists_across_instances(tmp_path):
    p = tmp_path / "fb.jsonl"
    FeedbackLoop(p).record("https://example.com/a", "idor", True, "حقيقي")
    fb2 = FeedbackLoop(p)
    assert fb2.stats()["total"] == 1
