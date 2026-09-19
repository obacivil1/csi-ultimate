"""اختبارات كاشف الأنماط — بلا شبكة، على بيانات ثابتة."""
from __future__ import annotations

from recon.brain.pattern_finder import find_patterns


def test_empty_list():
    res = find_patterns([])
    assert res["repeated_query_params"] == []
    assert res["repeated_path_segments"] == []
    assert res["versioned_endpoints"] == {}
    assert res["shared_prefixes"] == []


def test_single_endpoint_no_repeats():
    res = find_patterns(["https://example.com/user/123?id=5"])
    assert res["repeated_query_params"] == []
    assert res["repeated_path_segments"] == []
    assert res["versioned_endpoints"] == {"unversioned": ["https://example.com/user/123?id=5"]}
    assert res["shared_prefixes"] == []


def test_repeated_params():
    urls = [
        "https://example.com/a?id=1",
        "https://example.com/b?id=2",
        "https://example.com/c?name=x",
    ]
    res = find_patterns(urls)
    names = {r["name"]: r["count"] for r in res["repeated_query_params"]}
    assert names.get("id") == 2
    assert "name" not in names  # ظهر مرة واحدة فقط


def test_repeated_segments():
    urls = [
        "https://example.com/users/1",
        "https://example.com/users/2",
        "https://example.com/orders/3",
    ]
    res = find_patterns(urls)
    segs = {r["segment"]: r["count"] for r in res["repeated_path_segments"]}
    assert segs.get("users") == 2
    assert "orders" not in segs


def test_numeric_segments_excluded():
    urls = [
        "https://example.com/a/123",
        "https://example.com/b/123",
    ]
    res = find_patterns(urls)
    segs = [r["segment"] for r in res["repeated_path_segments"]]
    assert "123" not in segs


def test_versioned_grouping():
    urls = [
        "https://example.com/api/v1/users",
        "https://example.com/api/v1/orders",
        "https://example.com/api/v2/users",
        "https://example.com/about",
    ]
    res = find_patterns(urls)
    assert sorted(res["versioned_endpoints"]["v1"]) == [
        "https://example.com/api/v1/orders",
        "https://example.com/api/v1/users",
    ]
    assert res["versioned_endpoints"]["v2"] == ["https://example.com/api/v2/users"]
    assert res["versioned_endpoints"]["unversioned"] == ["https://example.com/about"]


def test_unversioned_only():
    res = find_patterns(["https://example.com/a", "https://example.com/b"])
    assert list(res["versioned_endpoints"].keys()) == ["unversioned"]


def test_static_files_ignored():
    urls = [
        "https://example.com/app.js",
        "https://example.com/app.js",
        "https://example.com/style.css",
        "https://example.com/api/data",
    ]
    res = find_patterns(urls)
    assert res["versioned_endpoints"] == {"unversioned": ["https://example.com/api/data"]}
    assert res["repeated_query_params"] == []
    assert res["shared_prefixes"] == []


def test_shared_prefixes():
    urls = [
        "https://example.com/api/v1/user/1",
        "https://example.com/api/v1/user/2",
        "https://example.com/api/v1/user/3",
        "https://example.com/other/page",
    ]
    res = find_patterns(urls)
    prefixes = {r["prefix"]: r["count"] for r in res["shared_prefixes"]}
    assert prefixes.get("/api/v1/user") == 3


def test_mixed_case():
    urls = [
        "https://example.com/api/v1/users/1?uid=10",
        "https://example.com/api/v1/users/2?uid=20",
        "https://example.com/api/v2/users/3?uid=30",
        "https://example.com/static/app.js",
    ]
    res = find_patterns(urls)
    assert {r["name"]: r["count"] for r in res["repeated_query_params"]} == {"uid": 3}
    assert "v1" in res["versioned_endpoints"]
    assert "v2" in res["versioned_endpoints"]
    prefixes = {r["prefix"]: r["count"] for r in res["shared_prefixes"]}
    assert prefixes.get("/api/v1/users") == 2


def test_complex_case_saved_crawl_shape():
    urls = [
        "https://example.com/api/v1/users/1",
        "https://example.com/api/v1/users/2",
        "https://example.com/api/v1/orders/5?user_id=9",
        "https://example.com/api/v1/orders/6?user_id=9",
        "https://example.com/api/v2/users/1",
        "https://example.com/help",
    ]
    res = find_patterns(urls)
    # معامل user_id مكرر
    assert {r["name"]: r["count"] for r in res["repeated_query_params"]} == {"user_id": 2}
    # مقطع users مكرر في 3 عناوين
    segs = {r["segment"]: r["count"] for r in res["repeated_path_segments"]}
    assert segs["users"] == 3
    assert segs["orders"] == 2
    # بادئة مشتركة
    prefixes = {r["prefix"]: r["count"] for r in res["shared_prefixes"]}
    assert prefixes["/api/v1/users"] == 2
    assert prefixes["/api/v1/orders"] == 2
    # النسخ
    assert len(res["versioned_endpoints"]["v1"]) == 4
    assert len(res["versioned_endpoints"]["v2"]) == 1


def test_result_keys_present():
    res = find_patterns(["https://example.com/a"])
    assert set(res.keys()) == {
        "repeated_query_params",
        "repeated_path_segments",
        "versioned_endpoints",
        "shared_prefixes",
    }
