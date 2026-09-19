"""اختبارات كاشف الشواذ — بلا شبكة، على ملخصات ثابتة."""
from __future__ import annotations

from recon.brain.anomaly_finder import find_anomalies


def _resp(url, status=200, length=1000, time_ms=100.0, ctype="text/html"):
    return {
        "url": url,
        "status": status,
        "content_length": length,
        "response_time_ms": time_ms,
        "content_type": ctype,
    }


def _normal(n=5):
    return [_resp(f"https://example.com/p{i}") for i in range(n)]


def test_empty_input():
    assert find_anomalies([]) == []


def test_single_response_returns_empty():
    assert find_anomalies([_resp("https://example.com/a")]) == []


def test_fewer_than_five_returns_empty():
    assert find_anomalies(_normal(4)) == []


def test_exactly_five_is_enough():
    res = find_anomalies(_normal(5))
    assert res == []  # طبيعية كلها → لا شواذ


def test_large_response():
    urls = _normal(5)
    urls.append(_resp("https://example.com/big", length=10000))
    res = find_anomalies(urls)
    reasons = {(r["url"], r["reason"]) for r in res}
    assert ("https://example.com/big", "unusually_large") in reasons


def test_small_200():
    urls = _normal(5)
    urls.append(_resp("https://example.com/empty", length=20))
    res = find_anomalies(urls)
    hit = [r for r in res if r["url"] == "https://example.com/empty"]
    assert any(r["reason"] == "unusually_small_200" and r["severity"] == "high" for r in hit)


def test_server_error():
    urls = _normal(5)
    urls.append(_resp("https://example.com/broken", status=503, length=0))
    res = find_anomalies(urls)
    hit = [r for r in res if r["url"] == "https://example.com/broken"]
    assert any(r["reason"] == "server_error" and r["severity"] == "high" for r in hit)


def test_slow_response():
    urls = _normal(5)
    urls.append(_resp("https://example.com/slow", time_ms=5000.0))
    res = find_anomalies(urls)
    hit = [r for r in res if r["url"] == "https://example.com/slow"]
    assert any(r["reason"] == "slow_response" and r["severity"] == "low" for r in hit)


def test_wrong_content_type():
    urls = _normal(5)
    urls.append(_resp("https://example.com/file", ctype="application/octet-stream"))
    res = find_anomalies(urls)
    hit = [r for r in res if r["url"] == "https://example.com/file"]
    assert any(r["reason"] == "unexpected_content_type" for r in hit)


def test_content_type_with_charset_ok():
    urls = _normal(5)
    urls.append(_resp("https://example.com/page", ctype="text/html; charset=utf-8"))
    res = find_anomalies(urls)
    assert all(r["reason"] != "unexpected_content_type" for r in res if r["url"] == "https://example.com/page")


def test_500_with_body():
    urls = _normal(5)
    urls.append(_resp("https://example.com/crash", status=500, length=2000))
    res = find_anomalies(urls)
    hit = [r for r in res if r["url"] == "https://example.com/crash"]
    assert any(r["reason"] == "status_500_with_body" and r["severity"] == "high" for r in hit)


def test_mixed_sorted_by_severity():
    urls = _normal(5)
    urls.append(_resp("https://example.com/slow", time_ms=5000.0))  # low
    urls.append(_resp("https://example.com/big", length=10000))  # medium
    urls.append(_resp("https://example.com/empty", length=10))  # high
    res = find_anomalies(urls)
    order = {"high": 0, "medium": 1, "low": 2}
    seq = [order[r["severity"]] for r in res]
    assert seq == sorted(seq)
    assert res[0]["severity"] == "high"
    assert res[-1]["severity"] == "low"


def test_result_shape():
    urls = _normal(5)
    urls.append(_resp("https://example.com/empty", length=5))
    res = find_anomalies(urls)
    assert len(res) > 0
    for r in res:
        assert set(r.keys()) == {"url", "reason", "detail", "severity", "value"}
        assert r["severity"] in ("low", "medium", "high")
