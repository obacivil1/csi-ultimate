"""robots_cache.py — Fetch and cache robots.txt per origin. Fail closed."""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

logger = logging.getLogger(__name__)


class RobotsCache:
    """Cache robots.txt per origin with TTL and fail-closed semantics."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        user_agent: str,
        *,
        ttl_seconds: int = 3600,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._ua = user_agent
        self._ttl = int(ttl_seconds)
        self._clock = clock
        # origin -> {"parser": RobotFileParser|None, "expires": float, "allow_all": bool, "disallow_all": bool}
        self._cache: dict[str, dict] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _origin(self, url: str) -> str:
        p = urlparse(url)
        scheme = (p.scheme or "https").lower()
        host = (p.hostname or "").lower()
        port = p.port
        if port is None:
            return f"{scheme}://{host}"
        return f"{scheme}://{host}:{port}"

    def _lock_for(self, origin: str) -> asyncio.Lock:
        if origin not in self._locks:
            self._locks[origin] = asyncio.Lock()
        return self._locks[origin]

    async def can_fetch(self, url: str) -> bool:
        """Return True if url is allowed per robots.txt, False if disallowed."""
        origin = self._origin(url)
        now = self._clock()
        entry = self._cache.get(origin)
        if entry is not None and now < entry["expires"]:
            return self._check(entry, url)
        # need fetch, with per-origin lock to avoid double-fetch
        lock = self._lock_for(origin)
        async with lock:
            # double-check after acquiring lock
            entry = self._cache.get(origin)
            now = self._clock()
            if entry is not None and now < entry["expires"]:
                return self._check(entry, url)
            # fetch
            try:
                resp = await self._client.get(
                    f"{origin}/robots.txt",
                    headers={"User-Agent": self._ua},
                )
                status = resp.status_code
                if status == 200:
                    text = resp.text
                    rp = RobotFileParser()
                    # RobotFileParser expects url but we can parse directly
                    rp.parse(text.splitlines())
                    self._cache[origin] = {
                        "parser": rp,
                        "expires": self._clock() + self._ttl,
                        "allow_all": False,
                        "disallow_all": False,
                    }
                    logger.debug("robots 200 cached", extra={"origin": origin})
                elif status == 404:
                    # allow all
                    self._cache[origin] = {
                        "parser": None,
                        "expires": self._clock() + self._ttl,
                        "allow_all": True,
                        "disallow_all": False,
                    }
                    logger.debug("robots 404 allow-all", extra={"origin": origin})
                else:
                    # fail closed: disallow all
                    self._cache[origin] = {
                        "parser": None,
                        "expires": self._clock() + self._ttl,
                        "allow_all": False,
                        "disallow_all": True,
                    }
                    logger.debug("robots status %s disallow-all", status, extra={"origin": origin})
            except Exception as exc:  # network error, timeout, etc.
                logger.debug("robots fetch error disallow-all: %s", exc, extra={"origin": origin})
                self._cache[origin] = {
                    "parser": None,
                    "expires": self._clock() + self._ttl,
                    "allow_all": False,
                    "disallow_all": True,
                }
            entry = self._cache[origin]
            return self._check(entry, url)

    def _check(self, entry: dict, url: str) -> bool:
        if entry.get("allow_all"):
            return True
        if entry.get("disallow_all"):
            return False
        parser: RobotFileParser | None = entry.get("parser")
        if parser is None:
            return False
        try:
            return bool(parser.can_fetch(self._ua, url))
        except Exception:
            return False
