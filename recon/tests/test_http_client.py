"""Tests for http_client.py — scope, robots, limiter, retry, session, audit, redirect."""
from __future__ import annotations

import asyncio
import hashlib
import json
import pathlib
import time

import httpx
import pytest

from recon.core.audit_log import AuditLog
from recon.core.rate_limiter import RateLimiter
from recon.core.robots_cache import RobotsCache
from recon.core.scope_validator import ScopeValidator
from recon.core.http_client import HttpClient


def _make_scope(tmp_path: pathlib.Path, extra=None):
    # use conftest helper logic inline
    import hashlib as hl
    from datetime import datetime, timedelta, timezone

    doc = tmp_path / "auth.pdf"
    doc.write_bytes(b"fake pdf")
    h = hl.sha256(b"fake pdf").hexdigest()
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
        "max_requests_per_host": 10,
        "max_requests_per_second": 100.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }
    if extra:
        data.update(extra)
    scope_file = tmp_path / "scope.json"
    scope_file.write_text(json.dumps(data), encoding="utf-8")
    scope = ScopeValidator(scope_file)
    # Simulate the operator having confirmed (the real gate is tested separately).
    scope.mark_confirmed()
    return scope


@pytest.mark.asyncio
async def test_out_of_scope_raises_zero_calls(tmp_path):
    scope = _make_scope(tmp_path)
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        calls[0] += 1
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            with pytest.raises(Exception):
                await hc.get("https://evil.com/secret")
        assert calls[0] == 0


@pytest.mark.asyncio
async def test_robots_disallow_returns_none_zero_calls(tmp_path):
    scope = _make_scope(tmp_path)
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")
        calls[0] += 1
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            # first call primes robots cache (1 fetch)
            # we need to allow the robots fetch; use separate client for robots? Actually robots uses raw client, not transport counting same?
            # For this test we isolate: robots cache fetch counts as one, but target request should not be sent
            # So we call can_fetch first implicitly via hc.get
            result = await hc.get("https://example.com/private/data")
            assert result is None
            # target handler should not have been called (only robots.txt)
            assert calls[0] == 0


@pytest.mark.asyncio
async def test_quota_exceeded_zero_calls(tmp_path):
    scope = _make_scope(tmp_path, extra={"max_requests_per_host": 1})
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        calls[0] += 1
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=1, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            r1 = await hc.get("https://example.com/a")
            assert r1 is not None
            assert calls[0] == 1
            from recon.core.rate_limiter import QuotaExceeded

            with pytest.raises(QuotaExceeded):
                await hc.get("https://example.com/b")
            # second call should not hit network
            assert calls[0] == 1


@pytest.mark.asyncio
async def test_429_retry_after_sleeps_then_succeeds(tmp_path, monkeypatch):
    scope = _make_scope(tmp_path)
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        calls[0] += 1
        if calls[0] == 1:
            return httpx.Response(429, headers={"retry-after": "2"}, text="rate")
        return httpx.Response(200, text="ok-after")

    sleeps = []

    async def fake_sleep(d):
        sleeps.append(d)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            resp = await hc.get("https://example.com/api")
            assert resp.status_code == 200
            assert sleeps == [2.0]
            assert calls[0] == 2
            # audit should have 2 entries
            entries = list(audit.entries())
            assert len(entries) == 2
            assert entries[0]["status"] == 429
            assert entries[1]["status"] == 200


@pytest.mark.asyncio
async def test_429_no_retry_after_exponential(monkeypatch, tmp_path):
    scope = _make_scope(tmp_path)
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        calls[0] += 1
        if calls[0] < 3:
            return httpx.Response(429, text="rate")
        return httpx.Response(200, text="ok")

    sleeps = []

    async def fake_sleep(d):
        sleeps.append(d)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            resp = await hc.get("https://example.com/api")
            assert resp.status_code == 200
            assert sleeps == [1.0, 2.0]
            assert len(list(audit.entries())) == 3


@pytest.mark.asyncio
async def test_session_cookies_attached(tmp_path):
    scope = _make_scope(tmp_path)
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        captured["cookie"] = req.headers.get("cookie")
        captured["ua"] = req.headers.get("user-agent")
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        sessions = {"user_a": {"session": "abc", "csrftoken": "xyz"}}
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, sessions=sessions, transport=transport)
        async with hc:
            await hc.get("https://example.com/api", session_name="user_a")
            assert "session=abc" in captured["cookie"]
            assert "csrftoken=xyz" in captured["cookie"]
            assert captured["ua"] == scope.user_agent


@pytest.mark.asyncio
async def test_audit_no_body_content(tmp_path):
    scope = _make_scope(tmp_path)

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        return httpx.Response(200, text="secret body that should not be logged")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            await hc.get("https://example.com/api")
            entries = list(audit.entries())
            assert len(entries) == 1
            e = entries[0]
            # should have sha256 but not body
            assert "resp_sha256" in e
            assert e["resp_sha256"] == hashlib.sha256(b"secret body that should not be logged").hexdigest()
            # ensure body not in audit
            audit_text = (tmp_path / "audit.jsonl").read_text(encoding="utf-8")
            assert "secret body" not in audit_text


@pytest.mark.asyncio
async def test_redirect_out_of_scope_not_followed(tmp_path):
    scope = _make_scope(tmp_path)

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        if str(req.url) == "https://example.com/a":
            return httpx.Response(302, headers={"location": "https://evil.com/b"}, text="redirect")
        return httpx.Response(200, text="should not be called for evil")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            resp = await hc.get("https://example.com/a")
            assert resp.status_code == 302
            # only one audit entry for the 302, not for evil
            entries = list(audit.entries())
            assert len(entries) == 1
            assert entries[0]["status"] == 302


def test_forbidden_no_randomization():
    src = (pathlib.Path(__file__).resolve().parent.parent / "core" / "http_client.py").read_text(encoding="utf-8")
    assert "random" not in src.lower()
    assert "dnt" not in src.lower() or '"dnt"' not in src.lower()
    # ensure UA rotation not present
    assert "rotate" not in src.lower()
    assert "user_agent" in src.lower()


@pytest.mark.asyncio
async def test_unconfirmed_scope_sends_zero_packets(tmp_path):
    """Regression: direct HttpClient construction must NOT bypass confirmation.

    An unconfirmed scope raises ScopeError from get()/head() before any
    scope/robots/limiter logic — zero HTTP calls reach the transport.
    """
    scope = _make_scope(tmp_path)
    # Simulate a fresh, never-confirmed scope (helper marks confirmed by default).
    scope._confirmed = False
    assert scope.confirmed is False
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        calls[0] += 1
        return httpx.Response(200, text="must never be reached")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            from recon.core.scope_validator import ScopeError

            with pytest.raises(ScopeError):
                await hc.get("https://example.com/")
            with pytest.raises(ScopeError):
                await hc.head("https://example.com/")
    assert calls[0] == 0


@pytest.mark.asyncio
async def test_confirmed_scope_sends_normally(tmp_path):
    """Sanity: after mark_confirmed, requests flow as before."""
    scope = _make_scope(tmp_path)
    scope.mark_confirmed()

    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        limiter = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        audit = AuditLog(tmp_path / "audit.jsonl")
        hc = HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, transport=transport)
        async with hc:
            resp = await hc.get("https://example.com/")
            assert resp is not None and resp.status_code == 200
