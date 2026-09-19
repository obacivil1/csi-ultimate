"""اختبارات مرتب النهايات — بلا شبكة، على بيانات محفوظة وثابتة."""
from __future__ import annotations

import pathlib

from recon.brain.endpoint_ranker import rank_endpoints


def test_numeric_segment_scores_high():
    res = rank_endpoints(["https://example.com/user/123"])
    assert res[0]["score"] >= 3
    assert any("رقمي" in r for r in res[0]["reasons"])


def test_keyword_scores():
    res = rank_endpoints(["https://example.com/admin/panel"])
    assert res[0]["score"] >= 2
    assert any("مثيرة" in r for r in res[0]["reasons"])


def test_query_id_scores():
    res = rank_endpoints(["https://example.com/profile?id=7"])
    assert res[0]["score"] >= 3
    assert any("الاستعلام" in r for r in res[0]["reasons"])


def test_static_js_low():
    res = rank_endpoints(["https://example.com/app.js"])
    assert res[0]["score"] == 0  # -3 مقيدة بالصفر
    assert any("ثابت" in r for r in res[0]["reasons"])


def test_versioned_api_bonus():
    plain = rank_endpoints(["https://example.com/users"])[0]["score"]
    versioned = rank_endpoints(["https://example.com/api/v1/users"])[0]["score"]
    assert versioned > plain


def test_plain_page_zero():
    res = rank_endpoints(["https://example.com/about"])
    assert res[0]["score"] == 0


def test_mixed_sorted_descending():
    urls = [
        "https://example.com/style.css",
        "https://example.com/api/v1/user/123?uid=5",
        "https://example.com/about",
        "https://example.com/admin",
    ]
    res = rank_endpoints(urls)
    scores = [r["score"] for r in res]
    assert scores == sorted(scores, reverse=True)
    assert res[0]["url"] == "https://example.com/api/v1/user/123?uid=5"


def test_score_always_zero_to_ten():
    urls = [
        "https://example.com/api/v1/admin/user/123?id=1&uid=2",
        "https://example.com/a.js",
        "https://example.com/b.css",
    ]
    for r in rank_endpoints(urls):
        assert 0 <= r["score"] <= 10


def test_result_shape():
    res = rank_endpoints(["https://example.com/x"])
    assert set(res[0].keys()) == {"url", "score", "reasons"}
    assert isinstance(res[0]["reasons"], list)


def test_saved_httpbin_crawl_ranks_without_network(tmp_path=None):
    saved = pathlib.Path("recon/reports/raw/katana/katana.txt")
    if not saved.exists():
        import pytest

        pytest.skip("no saved crawl from previous local test")
    urls = [l.strip() for l in saved.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(urls) > 0
    res = rank_endpoints(urls)
    assert len(res) == len(urls)
    scores = [r["score"] for r in res]
    assert scores == sorted(scores, reverse=True)
    # ملفات التصميم كلها في مجموعة الدرجة الدنيا (الأسفل)
    min_score = min(scores)
    for r in res:
        if r["url"].endswith((".js", ".css")):
            assert r["score"] == min_score
