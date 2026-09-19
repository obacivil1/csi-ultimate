"""اختبارات الاستراتيجيات — بلا شبكة."""
from __future__ import annotations

import pytest

from recon.decider.strategy import STRATEGIES, get_strategy, list_strategies


def test_fast_values():
    assert get_strategy("fast") == {"max_hypotheses": 5, "max_minutes": 30}


def test_balanced_values():
    assert get_strategy("balanced") == {"max_hypotheses": 15, "max_minutes": 180}


def test_thorough_values():
    assert get_strategy("thorough") == {"max_hypotheses": 50, "max_minutes": 480}


def test_unknown_raises():
    with pytest.raises(ValueError):
        get_strategy("turbo")


def test_list_strategies():
    assert list_strategies() == ["fast", "balanced", "thorough"]


def test_returns_copy_not_reference():
    s = get_strategy("fast")
    s["max_hypotheses"] = 999
    assert STRATEGIES["fast"]["max_hypotheses"] == 5
    assert get_strategy("fast")["max_hypotheses"] == 5


def test_shape_keys():
    for name in list_strategies():
        assert set(get_strategy(name).keys()) == {"max_hypotheses", "max_minutes"}


def test_minutes_grow_with_depth():
    assert get_strategy("fast")["max_minutes"] < get_strategy("balanced")["max_minutes"]
    assert get_strategy("balanced")["max_minutes"] < get_strategy("thorough")["max_minutes"]
