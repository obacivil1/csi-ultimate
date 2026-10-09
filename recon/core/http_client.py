"""http_client.py — The only place that issues HTTP requests."""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import httpx

from recon.core.audit_log import AuditLog
from recon.core.rate_limiter import RateLimiter
from recon.core.robots_cache import RobotsCache
from recon.core.scope_validator import ScopeValidator

logger = logging.getLogger(__name__)


def _parse_retry_after(value: str | None, now_ts: float | None = None) -> float | None:
    if not value:
        return None
    value = value.strip()
    # try integer seconds
    try:
        sec = int(value)
        if sec >= 0:
            return float(sec)
    except ValueError:
        pass
    # try HTTP-date
    try:
        dt = parsedate_to_datetime(value)
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            # compute delta vs now
            if now_ts is not None:
                delta = dt.timestamp() - now_ts
            else:
                delta = (dt - datetime.now(timezone.utc)).total_seconds()
            if delta > 0:
                return float(delta)
            return 0.0
    except Exception:
        pass
    return None


class HttpClient:
    """HTTP client with safety envelope: scope → robots → limiter → audit."""

    def __init__(
        self,
        *,
        scope: ScopeValidator,
        limiter: RateLimiter,
        robots: RobotsCache,
        audit: AuditLog,
        sessions: dict[str, dict[str, str]] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._scope = scope
        self._limiter = limiter
        self._robots = robots
        self._audit_log = audit
        self._sessions = sessions or {}
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._own_client = False

    async def __aenter__(self) -> HttpClient:
        if self._transport is not None:
            self._client = httpx.AsyncClient(transport=self._transport, follow_redirects=False)
        else:
            self._client = httpx.AsyncClient(follow_redirects=False)
        self._own_client = True
        return self

    async def __aexit__(self, *exc) -> None:
        if self._client is not None and self._own_client:
            await self._client.aclose()
            self._client = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            # lazy create if not used as context manager (for tests)
            if self._transport is not None:
                self._client = httpx.AsyncClient(transport=self._transport, follow_redirects=False)
            else:
                self._client = httpx.AsyncClient(follow_redirects=False)
        return self._client

    def _build_headers(self, session_name: str | None) -> dict[str, str]:
        headers = {
            "User-Agent": self._scope.user_agent,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        }
        if session_name is not None and session_name in self._sessions:
            cookies = self._sessions[session_name]
            if cookies:
                cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
                headers["Cookie"] = cookie_str
        return headers

    def _do_audit(self, method: str, url: str, status: int | None, body: bytes | None, session_name: str | None) -> None:
        host = urlparse(url).hostname or ""
        sha = hashlib.sha256(body).hexdigest() if body is not None else None
        # spec says bytes = len? Use bytes field
        b_len = len(body) if body is not None else 0
        entry = {
            "method": method,
            "url": url,
            "status": status,
            "resp_sha256": sha,
            "bytes": b_len,
            "host": host,
            "session": session_name,
        }
        self._audit_log.log(entry)
        logger.debug("http audit", extra=entry)

    async def _request_with_retries(
        self, method: str, url: str, headers: dict[str, str], session_name: str | None
    ) -> httpx.Response | None:
        client = self._get_client()
        retries = 0
        backoff = 1.0
        last_resp: httpx.Response | None = None
        current_url = url
        # redirect loop limit
        redirects_followed = 0
        max_redirects = 5
        while True:
            # scope check for current_url (for redirects)
            self._scope.assert_allowed(current_url)
            host = urlparse(current_url).hostname or ""
            # robots check already done by caller for initial url; for redirects we check again
            if redirects_followed > 0:
                # robots gate for redirect target
                if not await self._robots.can_fetch(current_url):
                    # audit the 3xx? caller already audited; we just return None per spec? Actually spec says out-of-scope redirect: log 3xx and return it
                    # For robots blocked redirect, we return None (blocked)
                    return None
                try:
                    await self._limiter.acquire(host)
                except Exception:
                    raise
            # send request
            try:
                resp = await client.request(method, current_url, headers=headers)
            except Exception as exc:
                # network error: audit with status None
                self._do_audit(method, current_url, None, None, session_name)
                logger.debug("http request error %s", exc, extra={"url": current_url})
                return None
            body = resp.content
            status = resp.status_code
            self._do_audit(method, current_url, status, body, session_name)
            last_resp = resp
            # handle redirects manually
            if status in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                if redirects_followed >= max_redirects:
                    return resp
                loc = resp.headers["location"]
                # resolve relative
                from urllib.parse import urljoin

                next_url = urljoin(current_url, loc)
                # check if redirect target in scope
                try:
                    self._scope.assert_allowed(next_url)
                except Exception:
                    # out-of-scope: log 3xx already, return it
                    logger.debug("redirect out-of-scope %s", next_url, extra={"from": current_url})
                    return resp
                # follow redirect: change method to GET for 303, per spec allow_redirects
                current_url = next_url
                redirects_followed += 1
                if status == 303:
                    method = "GET"
                continue
            # handle 429/503 retry
            if status in (429, 503) and retries < 3:
                ra = _parse_retry_after(resp.headers.get("retry-after"))
                if ra is not None:
                    wait = ra
                else:
                    wait = backoff
                    backoff = min(backoff * 2, 60.0)
                # sleep
                await asyncio.sleep(wait)
                retries += 1
                continue
            # any other status: return
            return resp

    def _require_confirmation(self) -> None:
        """Fail closed: no packet leaves without operator confirmation.

        The confirmation lives on the scope (set only by
        require_operator_confirmation after a correct 'I CONFIRM'), so
        constructing HttpClient directly can no longer bypass the gate —
        every public request method calls this first.
        """
        from recon.core.scope_validator import ScopeError

        if not getattr(self._scope, "confirmed", False):
            raise ScopeError(
                "operator confirmation required before any request; "
                "call require_operator_confirmation(scope) first"
            )

    async def get(
        self,
        url: str,
        *,
        session_name: str | None = None,
        allow_redirects: bool = True,
    ) -> httpx.Response | None:
        self._require_confirmation()
        # scope gate
        self._scope.assert_allowed(url)
        # robots gate
        if not await self._robots.can_fetch(url):
            # audit? spec says audit + return None; but we need to audit even when blocked? Spec says audit every attempt including retries; but for robots blocked, audit + return None and zero HTTP calls is expected. We'll audit with status None? Actually tests expect zero HTTP calls but we still need audit entry? Let's audit with None.
            # However spec behavior: "if not await robots.can_fetch(url): audit + return None."
            # We'll audit a blocked entry
            self._do_audit("GET", url, None, None, session_name)
            return None
        # limiter gate
        host = urlparse(url).hostname or ""
        await self._limiter.acquire(host)
        headers = self._build_headers(session_name)
        if not allow_redirects:
            # single request without following redirects
            client = self._get_client()
            try:
                resp = await client.get(url, headers=headers, follow_redirects=False)
            except Exception:
                self._do_audit("GET", url, None, None, session_name)
                return None
            body = resp.content
            self._do_audit("GET", url, resp.status_code, body, session_name)
            # handle 429 retry even without redirects
            retries = 0
            backoff = 1.0
            while resp.status_code in (429, 503) and retries < 3:
                ra = _parse_retry_after(resp.headers.get("retry-after"))
                wait = ra if ra is not None else backoff
                if ra is None:
                    backoff = min(backoff * 2, 60.0)
                await asyncio.sleep(wait)
                retries += 1
                try:
                    resp = await client.get(url, headers=headers, follow_redirects=False)
                except Exception:
                    self._do_audit("GET", url, None, None, session_name)
                    return None
                body = resp.content
                self._do_audit("GET", url, resp.status_code, body, session_name)
            return resp
        # allow redirects: use shared loop
        return await self._request_with_retries("GET", url, headers, session_name)

    async def head(
        self,
        url: str,
        *,
        session_name: str | None = None,
    ) -> httpx.Response | None:
        self._require_confirmation()
        self._scope.assert_allowed(url)
        if not await self._robots.can_fetch(url):
            self._do_audit("HEAD", url, None, None, session_name)
            return None
        host = urlparse(url).hostname or ""
        await self._limiter.acquire(host)
        headers = self._build_headers(session_name)
        client = self._get_client()
        try:
            resp = await client.head(url, headers=headers, follow_redirects=False)
        except Exception:
            self._do_audit("HEAD", url, None, None, session_name)
            return None
        body = resp.content
        self._do_audit("HEAD", url, resp.status_code, body, session_name)
        return resp
