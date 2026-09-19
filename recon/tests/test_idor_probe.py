"""Tests for idor_probe.py — two-session, hash-only."""
from __future__ import annotations

import hashlib
import json
import pathlib
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from recon.core.audit_log import AuditLog
from recon.core.http_client import HttpClient
from recon.core.idor_probe import IdorProbe
from recon.core.rate_limiter import RateLimiter
from recon.core.robots_cache import RobotsCache
from recon.core.scope_validator import ScopeValidator


def _scope(tmp_path):
    doc = tmp_path / "auth.pdf"
    doc.write_bytes(b"fake pdf")
    h = hashlib.sha256(b"fake pdf").hexdigest()
    now = datetime.now(timezone.utc)
    data = {
        "program_name": "Test Program",
        "program_url": "https://hackerone.com/test",
        "authorized_by": "Team",
        "authorization_document": "auth.pdf",
        "authorization_sha256": h,
        "not_before": (now - timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "contact_email": "r@example.com",
        "allowed_hosts": ["example.com"],
        "allowed_schemes": ["https"],
        "allowed_ports": [443],
        "denied_paths": [],
        "max_requests_per_host": 100,
        "max_requests_per_second": 100.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    return ScopeValidator(sf)


def _make_probe(tmp_path, handler):
    scope = _scope(tmp_path)
    transport = httpx.MockTransport(handler)
    # We need separate raw client for robots but share transport
    raw = httpx.AsyncClient(transport=transport)
    robots = RobotsCache(raw, user_agent=scope.user_agent)
    limiter = RateLimiter(max_rps=100, max_per_host=100, burst=10)
    audit = AuditLog(tmp_path / "audit.jsonl")
    hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
    probe = IdorProbe(hc)
    return probe, hc, raw


@pytest.mark.asyncio
async def test_identical_bodies_not_flagged(tmp_path):
    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        return httpx.Response(200, text="same body")

    probe, hc, raw = _make_probe(tmp_path, handler)
    async with hc:
        async with raw:
            res = await probe.probe("https://example.com/api/123", session_a="user_a", session_b="user_b")
            assert res is not None
            assert res.flagged is False
            assert res.identifier_key == "numeric"
            assert res.body_a_sha256 == res.body_b_sha256


@pytest.mark.asyncio
async def test_different_bodies_numeric_flagged(tmp_path):
    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        # differentiate by cookie
        cookie = req.headers.get("cookie", "")
        if "session=a" in cookie:
            return httpx.Response(200, text="body for A")
        return httpx.Response(200, text="body for B different")

    # Use sessions to differentiate
    scope = _scope(tmp_path)
    transport = httpx.MockTransport(handler)
    raw = httpx.AsyncClient(transport=transport)
    robots = RobotsCache(raw, user_agent=scope.user_agent)
    limiter = RateLimiter(max_rps=100, max_per_host=100, burst=10)
    audit = AuditLog(tmp_path / "audit.jsonl")
    sessions = {"user_a": {"session": "a"}, "user_b": {"session": "b"}}
    hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, sessions=sessions, transport=transport)
    probe = IdorProbe(hc)
    async with hc:
        async with raw:
            res = await probe.probe("https://example.com/api/123", session_a="user_a", session_b="user_b")
            assert res is not None
            assert res.flagged is True
            assert res.identifier_key == "numeric"
            assert res.body_a_sha256 != res.body_b_sha256


@pytest.mark.asyncio
async def test_one_session_401_not_flagged(tmp_path):
    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        cookie = req.headers.get("cookie", "")
        if "user_a" in cookie or "a" in cookie:
            return httpx.Response(200, text="ok")
        return httpx.Response(401, text="unauth")

    scope = _scope(tmp_path)
    transport = httpx.MockTransport(handler)
    raw = httpx.AsyncClient(transport=transport)
    robots = RobotsCache(raw, user_agent=scope.user_agent)
    limiter = RateLimiter(max_rps=100, max_per_host=100, burst=10)
    audit = AuditLog(tmp_path / "audit.jsonl")
    sessions = {"user_a": {"session": "a"}, "user_b": {"session": "b"}}
    hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, sessions=sessions, transport=transport)
    probe = IdorProbe(hc)
    async with hc:
        async with raw:
            res = await probe.probe("https://example.com/api/123", session_a="user_a", session_b="user_b")
            assert res is not None
            assert res.flagged is False


@pytest.mark.asyncio
async def test_url_without_identifier_not_flagged(tmp_path):
    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        return httpx.Response(200, text="different" if "user_b" in req.headers.get("cookie", "") else "body")

    scope = _scope(tmp_path)
    transport = httpx.MockTransport(handler)
    raw = httpx.AsyncClient(transport=transport)
    robots = RobotsCache(raw, user_agent=scope.user_agent)
    limiter = RateLimiter(max_rps=100, max_per_host=100, burst=10)
    audit = AuditLog(tmp_path / "audit.jsonl")
    sessions = {"user_a": {"session": "a"}, "user_b": {"session": "b"}}
    hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, sessions=sessions, transport=transport)
    probe = IdorProbe(hc)
    async with hc:
        async with raw:
            res = await probe.probe("https://example.com/api/profile", session_a="user_a", session_b="user_b")
            assert res is not None
            assert res.flagged is False
            assert res.identifier_key is None


@pytest.mark.asyncio
async def test_http_failure_returns_none(tmp_path):
    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        raise httpx.ConnectError("fail", request=req)

    probe, hc, raw = _make_probe(tmp_path, handler)
    async with hc:
        async with raw:
            res = await probe.probe("https://example.com/api/123", session_a="user_a", session_b="user_b")
            assert res is None


def test_probe_result_contains_no_body():
    src = pathlib.Path("recon/core/idor_probe.py").read_text(encoding="utf-8")
    # ensure ProbeResult does not have body field
    assert "body_a_sha256" in src
    assert "body_b_sha256" in src
    # should not store body text
    assert "response.text" not in src
    # check that probe discards body after hashing
    assert "hashlib.sha256" in src
