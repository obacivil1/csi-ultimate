"""اختبارات منسق العقل — بلا شبكة."""
from __future__ import annotations

import json
import pathlib

from recon.brain import analyze, find_anomalies, save, to_json
from recon.brain import build_hypotheses, find_patterns, rank_endpoints


def _responses(n=6):
    return [
        {
            "url": f"https://example.com/p{i}",
            "status": 200,
            "content_length": 1000,
            "response_time_ms": 100.0,
            "content_type": "text/html",
        }
        for i in range(n)
    ]


def test_empty_inputs():
    res = analyze([], [])
    assert res["summary"] == {
        "endpoints_count": 0,
        "responses_count": 0,
        "hypotheses_count": 0,
        "top_confidence": None,
    }
    assert res["top_hypotheses"] == []
    assert res["hypotheses"] == []


def test_endpoints_only():
    res = analyze(["https://example.com/user/7", "https://example.com/about"], [])
    assert res["summary"]["endpoints_count"] == 2
    assert res["summary"]["responses_count"] == 0
    assert len(res["ranked"]) == 2
    assert res["anomalies"] == []


def test_responses_only():
    res = analyze([], _responses(6))
    assert res["summary"]["endpoints_count"] == 0
    assert res["summary"]["responses_count"] == 6
    assert res["ranked"] == []


def test_both_empty():
    res = analyze([], [])
    assert res["hypotheses"] == []
    assert res["patterns"]["repeated_query_params"] == []


def test_full_combined():
    endpoints = [
        "https://example.com/api/v1/user/42",
        "https://example.com/api/v1/user/43",
        "https://example.com/about",
    ]
    responses = _responses(5) + [{
        "url": "https://example.com/api/v1/user/42",
        "status": 200,
        "content_length": 10,
        "response_time_ms": 100.0,
        "content_type": "text/html",
    }]
    res = analyze(endpoints, responses)
    assert res["summary"]["endpoints_count"] == 3
    assert res["summary"]["responses_count"] == 6
    assert res["summary"]["hypotheses_count"] == len(res["hypotheses"])
    cats = {h["category"] for h in res["hypotheses"]}
    assert "idor" in cats  # الرقم + الدرجة العالية
    assert "exposure" in cats  # الرد الفارغ


def test_summary_shape():
    res = analyze(["https://example.com/a"], _responses(5))
    assert set(res["summary"].keys()) == {
        "endpoints_count", "responses_count", "hypotheses_count", "top_confidence",
    }
    assert set(res.keys()) == {
        "summary", "top_hypotheses", "hypotheses", "ranked", "patterns", "anomalies",
    }


def test_top_confidence_high():
    res = analyze(["https://example.com/user/9"], [])
    assert res["summary"]["top_confidence"] == "high"


def test_top_confidence_none_when_empty():
    res = analyze([], [])
    assert res["summary"]["top_confidence"] is None


def test_top_hypotheses_limited_to_five():
    endpoints = [f"https://example.com/item/{i}?id={i}" for i in range(30)]
    res = analyze(endpoints, [])
    assert len(res["hypotheses"]) == 20  # حد بانية الفروض
    assert len(res["top_hypotheses"]) == 5
    assert res["top_hypotheses"] == res["hypotheses"][:5]


def test_json_serialization():
    res = analyze(["https://example.com/user/3"], [])
    text = to_json(res)
    back = json.loads(text)
    assert back["summary"]["endpoints_count"] == 1
    # العربية محفوظة غير مهربة
    assert "احتمال" in text or "المعامل" in text or "فرق" in text or "رد" in text


def test_file_save(tmp_path):
    res = analyze(["https://example.com/user/3"], [])
    dest = save(res, str(tmp_path / "sub" / "brain.json"))
    assert pathlib.Path(dest).is_absolute()
    assert pathlib.Path(dest).exists()
    back = json.loads(pathlib.Path(dest).read_text(encoding="utf-8"))
    assert back["summary"] == res["summary"]


def test_atomic_write_leaves_no_tmp(tmp_path):
    res = analyze([], [])
    out_dir = tmp_path / "reports"
    out_dir.mkdir()
    save(res, str(out_dir / "brain.json"))
    leftovers = list(out_dir.glob("*.tmp"))
    assert leftovers == []
    assert (out_dir / "brain.json").exists()


def test_public_api_imports():
    assert callable(rank_endpoints)
    assert callable(find_patterns)
    assert callable(find_anomalies)
    assert callable(build_hypotheses)
    assert callable(analyze)
    assert callable(to_json)
    assert callable(save)
