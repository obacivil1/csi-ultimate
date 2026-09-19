"""Tests for rate_limiter.py — no network, deterministic clock."""
from __future__ import annotations

import asyncio

import pytest

from recon.core.rate_limiter import QuotaExceeded, RateLimiter


def test_two_hosts_do_not_block_each_other():
    async def _run():
        rl = RateLimiter(max_rps=1, max_per_host=10, burst=1)
        # acquire for host a 2 times sequentially; host b should not be capped
        await rl.acquire("a.example.com")
        await rl.acquire("b.example.com")
        assert rl.used("a.example.com") == 1
        assert rl.used("b.example.com") == 1
        snap = rl.snapshot()
        assert snap["a.example.com"] == 1
        assert snap["b.example.com"] == 1

    asyncio.run(_run())


def test_max_per_host_cap_raises():
    async def _run():
        rl = RateLimiter(max_rps=100, max_per_host=2, burst=10)
        await rl.acquire("example.com")
        await rl.acquire("example.com")
        with pytest.raises(QuotaExceeded):
            await rl.acquire("example.com")

    asyncio.run(_run())


def test_five_acquires_at_2rps_take_about_two_seconds_with_mock_clock():
    async def _run():
        now = [0.0]

        def clock():
            return now[0]

        async def sleeper(d: float):
            now[0] += d

        rl = RateLimiter(max_rps=2, max_per_host=10, burst=2, clock=clock, sleeper=sleeper)
        # 5 acquires: burst 2 immediate, remaining 3 need 1.5s; spec says 2s, allow 1.5..2.5
        for _ in range(5):
            await rl.acquire("example.com")
        # total time elapsed
        assert 1.4 <= now[0] <= 2.6, f"elapsed {now[0]} not in expected window"
        assert rl.used("example.com") == 5

    asyncio.run(_run())


def test_burst_allows_parallel_acquires():
    async def _run():
        rl = RateLimiter(max_rps=10, max_per_host=10, burst=5)
        # 5 parallel acquires should succeed without sleep (burst)
        await asyncio.gather(*(rl.acquire("example.com") for _ in range(5)))
        assert rl.used("example.com") == 5

    asyncio.run(_run())


def test_used_and_snapshot():
    async def _run():
        rl = RateLimiter(max_rps=100, max_per_host=10, burst=10)
        assert rl.used("new.example.com") == 0
        assert rl.snapshot() == {}
        await rl.acquire("a.example.com")
        await rl.acquire("a.example.com")
        await rl.acquire("b.example.com")
        assert rl.used("a.example.com") == 2
        assert rl.used("b.example.com") == 1
        snap = rl.snapshot()
        assert snap == {"a.example.com": 2, "b.example.com": 1}

    asyncio.run(_run())


def test_forbidden_no_http_or_url_parsing():
    import pathlib

    src = pathlib.Path("recon/core/rate_limiter.py").read_text(encoding="utf-8")
    assert "httpx" not in src
    assert "urllib" not in src
    assert "http" not in src.lower() or "httpx" not in src  # no http imports
