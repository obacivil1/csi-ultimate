"""اختبارات بانية الفروض — بلا شبكة، على مخرجات جاهزة."""
from __future__ import annotations

from recon.brain.hypothesis_builder import build_hypotheses


def _ranked(url, score=8):
    return {"url": url, "score": score, "reasons": ["سبب"]}


def _patterns(v=None, params=None):
    return {
        "repeated_query_params": params or [],
        "repeated_path_segments": [],
        "versioned_endpoints": v or {},
        "shared_prefixes": [],
    }


def _anomaly(url, reason):
    return {"url": url, "reason": reason, "detail": "تفصيل", "severity": "high", "value": 1}


def test_empty_inputs():
    assert build_hypotheses([], {}, []) == []
    assert build_hypotheses([], _patterns(), []) == []


def test_idor_numeric_segment():
    ranked = [_ranked("https://example.com/user/123", 8)]
    res = build_hypotheses(ranked, _patterns(), [])
    assert len(res) == 1
    assert res[0]["category"] == "idor"
    assert res[0]["confidence"] == "high"
    assert res[0]["url"] == "https://example.com/user/123"


def test_idor_numeric_query_value():
    ranked = [_ranked("https://example.com/profile?id=7", 6)]
    res = build_hypotheses(ranked, _patterns(), [])
    assert len(res) == 1
    assert res[0]["category"] == "idor"


def test_idor_low_score_no_hypothesis():
    ranked = [_ranked("https://example.com/user/123", 4)]
    assert build_hypotheses(ranked, _patterns(), []) == []


def test_idor_no_numeric_no_hypothesis():
    ranked = [_ranked("https://example.com/about", 9)]
    assert build_hypotheses(ranked, _patterns(), []) == []


def test_exposure_small_200():
    res = build_hypotheses([], _patterns(), [_anomaly("https://example.com/e", "unusually_small_200")])
    assert len(res) == 1
    assert res[0]["category"] == "exposure"
    assert res[0]["confidence"] == "medium"


def test_exposure_server_error():
    res = build_hypotheses([], _patterns(), [_anomaly("https://example.com/x", "server_error")])
    assert len(res) == 1
    assert res[0]["category"] == "exposure"


def test_no_exposure_on_clean_anomalies():
    res = build_hypotheses([], _patterns(), [_anomaly("https://example.com/s", "slow_response")])
    assert res == []


def test_versioning_v1_only():
    # users موجود في v1 فقط، وorders موجود في v2 فقط → فرضيتان
    p = _patterns(v={"v1": ["https://example.com/api/v1/users"], "v2": ["https://example.com/api/v2/orders"]})
    res = build_hypotheses([], p, [])
    assert len(res) == 2
    assert all(h["category"] == "logic" and h["confidence"] == "low" for h in res)
    assert {h["url"] for h in res} == {
        "https://example.com/api/v1/users",
        "https://example.com/api/v2/orders",
    }


def test_versioning_both_present_no_hypothesis():
    p = _patterns(v={
        "v1": ["https://example.com/api/v1/users"],
        "v2": ["https://example.com/api/v2/users"],
    })
    assert build_hypotheses([], p, []) == []


def test_repeated_param_sensitive():
    eps = [f"https://example.com/p{i}?id={i}" for i in range(3)]
    p = _patterns(params=[{"name": "id", "count": 3, "endpoints": eps}])
    res = build_hypotheses([], p, [])
    assert len(res) == 1
    assert res[0]["category"] == "auth"
    assert res[0]["confidence"] == "medium"


def test_repeated_param_below_threshold():
    eps = [f"https://example.com/p{i}?id={i}" for i in range(2)]
    p = _patterns(params=[{"name": "id", "count": 2, "endpoints": eps}])
    assert build_hypotheses([], p, []) == []


def test_repeated_param_not_sensitive():
    eps = [f"https://example.com/p{i}?lang=x" for i in range(5)]
    p = _patterns(params=[{"name": "lang", "count": 5, "endpoints": eps}])
    assert build_hypotheses([], p, []) == []


def test_dedup_same_category_url():
    # رقم في المسار وقيمة رقمية في الاستعلام معًا → فرضية واحدة فقط
    ranked = [_ranked("https://example.com/user/123?id=5", 9)]
    res = build_hypotheses(ranked, _patterns(), [])
    assert len(res) == 1


def test_sorting_high_first():
    ranked = [_ranked("https://example.com/user/9", 9)]
    anomalies = [_anomaly("https://example.com/e", "server_error")]
    p = _patterns(v={"v1": ["https://example.com/api/v1/only"]})
    res = build_hypotheses(ranked, p, anomalies)
    confs = [h["confidence"] for h in res]
    assert confs == ["high", "medium", "low"]


def test_limit_twenty():
    ranked = [_ranked(f"https://example.com/item/{i}?id={i}", 9) for i in range(30)]
    res = build_hypotheses(ranked, _patterns(), [])
    assert len(res) == 20


def test_no_false_positive_on_thin_data():
    ranked = [_ranked("https://example.com/about", 2)]
    p = _patterns(v={"unversioned": ["https://example.com/about"]})
    assert build_hypotheses(ranked, p, []) == []


def test_mixed_full_case():
    ranked = [
        _ranked("https://example.com/api/v1/user/42", 9),
        _ranked("https://example.com/about", 1),
    ]
    anomalies = [_anomaly("https://example.com/empty", "unusually_small_200")]
    eps = [f"https://example.com/r{i}?token=t{i}" for i in range(4)]
    p = _patterns(
        v={"v1": ["https://example.com/api/v1/legacy"], "v2": ["https://example.com/api/v2/other"]},
        params=[{"name": "token", "count": 4, "endpoints": eps}],
    )
    res = build_hypotheses(ranked, p, anomalies)
    cats = {h["category"] for h in res}
    assert {"idor", "exposure", "logic", "auth"} <= cats


def test_arabic_output():
    ranked = [_ranked("https://example.com/user/5", 8)]
    res = build_hypotheses(ranked, _patterns(), [])
    assert len(res) == 1
    import re

    arabic = re.compile(r"[\u0600-\u06FF]")
    assert arabic.search(res[0]["title"])
    assert arabic.search(res[0]["what_to_test"])
    assert arabic.search(res[0]["why"])


def test_structure():
    ranked = [_ranked("https://example.com/user/5", 8)]
    res = build_hypotheses(ranked, _patterns(), [])
    assert set(res[0].keys()) == {"title", "what_to_test", "url", "why", "confidence", "category"}
    assert res[0]["confidence"] in ("low", "medium", "high")
    assert res[0]["category"] in ("idor", "exposure", "logic", "auth")
