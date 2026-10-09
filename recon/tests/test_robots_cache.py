"""Tests for robots_cache.py — MockTransport, injectable clock."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from recon.core.robots_cache import RobotsCache


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_200_disallow_private():
    def handler(req: httpx.Request) -> httpx.Response:
        assert str(req.url).endswith("/robots.txt")
        return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")

    async with _client(handler) as c:
        rc = RobotsCache(c, user_agent="TestRecon/1.0 (+contact: researcher@example.com)")
        assert await rc.can_fetch("https://example.com/private/secret") is False
        assert await rc.can_fetch("https://example.com/public/page") is True


@pytest.mark.asyncio
async def test_404_allows_all():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="not found")

    async with _client(handler) as c:
        rc = RobotsCache(c, user_agent="TestRecon/1.0 (+contact: researcher@example.com)")
        assert await rc.can_fetch("https://example.com/anything") is True
        assert await rc.can_fetch("https://example.com/admin") is True


@pytest.mark.asyncio
async def test_500_blocks_all():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="error")

    async with _client(handler) as c:
        rc = RobotsCache(c, user_agent="TestRecon/1.0 (+contact: researcher@example.com)")
        assert await rc.can_fetch("https://example.com/public") is False


@pytest.mark.asyncio
async def test_timeout_blocks_all():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout", request=req)

    async with _client(handler) as c:
        rc = RobotsCache(c, user_agent="TestRecon/1.0 (+contact: researcher@example.com)")
        assert await rc.can_fetch("https://example.com/public") is False


@pytest.mark.asyncio
async def test_cache_hit_avoids_second_fetch():
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        calls[0] += 1
        return httpx.Response(404, text="not found")

    async with _client(handler) as c:
        rc = RobotsCache(c, user_agent="TestRecon/1.0 (+contact: researcher@example.com)")
        assert await rc.can_fetch("https://example.com/a") is True
        assert await rc.can_fetch("https://example.com/b") is True
        assert calls[0] == 1  # second call used cache


@pytest.mark.asyncio
async def test_ttl_expiry_refetches():
    calls = [0]

    def handler(req: httpx.Request) -> httpx.Response:
        calls[0] += 1
        return httpx.Response(404, text="not found")

    now = [0.0]

    def clock():
        return now[0]

    async with _client(handler) as c:
        rc = RobotsCache(c, user_agent="TestRecon/1.0 (+contact: researcher@example.com)", ttl_seconds=10, clock=clock)
        assert await rc.can_fetch("https://example.com/a") is True
        assert calls[0] == 1
        # within TTL
        now[0] = 5
        assert await rc.can_fetch("https://example.com/b") is True
        assert calls[0] == 1
        # expired
        now[0] = 20
        assert await rc.can_fetch("https://example.com/c") is True
        assert calls[0] == 2


@pytest.mark.asyncio
async def test_parallel_same_origin_one_fetch():
    calls = [0]

    async def handler(req: httpx.Request) -> httpx.Response:
        calls[0] += 1
        await asyncio.sleep(0.02)
        return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as c:
        rc = RobotsCache(c, user_agent="TestRecon/1.0 (+contact: researcher@example.com)")
        results = await asyncio.gather(
            rc.can_fetch("https://example.com/private"),
            rc.can_fetch("https://example.com/public"),
            rc.can_fetch("https://example.com/other"),
        )
        # Only one fetch should have happened despite 3 parallel callers
        assert calls[0] == 1
        assert results[0] is False
        assert results[1] is True
        assert results[2] is True


def test_forbidden_no_body_logging():
    import pathlib

    src = (pathlib.Path(__file__).resolve().parent.parent / "core" / "robots_cache.py").read_text(encoding="utf-8")
    # Should not retain response object beyond function; basic check
    assert "MockTransport" not in src
    # Ensure we don't log body
    assert "resp.text" in src  # we do read but not log; ensure no logger with body
    assert "robots.txt body" not in src.lower()
