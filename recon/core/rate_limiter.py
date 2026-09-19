"""rate_limiter.py — Async token bucket per host + global cap.

Enforces per-host rate (max_rps) and per-host hard cap (max_per_host).
No HTTP, no URL parsing. Deterministic via injectable clock/sleeper.
"""
from __future__ import annotations

import asyncio
import math
import time
from collections.abc import Awaitable, Callable


class QuotaExceeded(RuntimeError):
    """Raised when a host's max_per_host cap has been reached."""


class RateLimiter:
    """Async token bucket per host.

    Each host has independent bucket and counter. Refill is continuous
    at max_rps tokens/second. Burst defaults to max(1, ceil(max_rps)).
    """

    def __init__(
        self,
        *,
        max_rps: float,
        max_per_host: int,
        burst: int | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if max_rps <= 0 or max_rps > 100:
            raise ValueError("max_rps must be in (0, 100]")
        if max_per_host < 1 or max_per_host > 1_000_000:
            raise ValueError("max_per_host must be in [1, 1_000_000]")
        self._max_rps = float(max_rps)
        self._max_per_host = int(max_per_host)
        self._burst = int(burst) if burst is not None else max(1, math.ceil(self._max_rps))
        if self._burst < 1:
            raise ValueError("burst must be >= 1")
        self._clock = clock
        self._sleeper = sleeper
        # host -> {"tokens": float, "last": float, "used": int, "lock": asyncio.Lock}
        self._state: dict[str, dict] = {}

    def _get(self, host: str) -> dict:
        if host not in self._state:
            self._state[host] = {
                "tokens": float(self._burst),
                "last": self._clock(),
                "used": 0,
                "lock": asyncio.Lock(),
            }
        return self._state[host]

    def _refill(self, st: dict) -> None:
        now = self._clock()
        elapsed = now - st["last"]
        if elapsed > 0:
            st["tokens"] = min(float(self._burst), st["tokens"] + elapsed * self._max_rps)
            st["last"] = now

    async def acquire(self, host: str) -> None:
        """Acquire a token for host. Raises QuotaExceeded if cap reached."""
        st = self._get(host)
        async with st["lock"]:
            if st["used"] >= self._max_per_host:
                raise QuotaExceeded(f"cap {self._max_per_host} reached for {host!r}")
            # refill
            self._refill(st)
            if st["tokens"] >= 1.0:
                st["tokens"] -= 1.0
                st["used"] += 1
                return
            # need to wait
            needed = 1.0 - st["tokens"]
            wait = needed / self._max_rps
            # sleep outside? Must hold lock across sleep to avoid race
            # We sleep while holding lock so other waiters serialize.
            await self._sleeper(wait)
            # after sleep, refill again (clock has advanced)
            self._refill(st)
            # consume
            # tokens should now be >=1, clamp
            if st["tokens"] >= 1.0:
                st["tokens"] -= 1.0
            else:
                # edge: due to float, consume what we have
                st["tokens"] = 0.0
            st["used"] += 1

    def used(self, host: str) -> int:
        """Return number of acquires for host (0 if never seen)."""
        st = self._state.get(host)
        return int(st["used"]) if st else 0

    def snapshot(self) -> dict[str, type(0)]:
        """Return {host: used_count} snapshot."""
        return {h: int(v["used"]) for h, v in self._state.items()}
