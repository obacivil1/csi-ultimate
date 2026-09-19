"""idor_probe.py — Two-session IDOR detection with hash-only evidence."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from recon.core.http_client import HttpClient


@dataclass(frozen=True)
class ProbeResult:
    url: str
    session_a_status: int
    session_b_status: int
    body_a_sha256: str
    body_b_sha256: str
    body_a_bytes: int
    body_b_bytes: int
    identifier_key: str | None
    flagged: bool
    reason: str


_UUID_V4_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
_NUMERIC_RE = re.compile(r"^\d+$")


def _identifier_key(url: str) -> str | None:
    parsed = urlparse(url)
    # path segments
    for seg in parsed.path.split("/"):
        seg = seg.strip()
        if not seg:
            continue
        if _NUMERIC_RE.match(seg):
            return "numeric"
        if _UUID_V4_RE.match(seg):
            return "uuid"
    # query params
    qs = parse_qs(parsed.query)
    for k in qs.keys():
        lk = k.lower()
        if any(tok in lk for tok in ("id", "user", "account", "uid")):
            return "param_id"
    return None


class IdorProbe:
    """Two-session IDOR probe — never stores bodies."""

    def __init__(self, http_client: HttpClient) -> None:
        self._client = http_client

    async def probe(
        self,
        url: str,
        *,
        session_a: str,
        session_b: str,
    ) -> ProbeResult | None:
        try:
            resp_a = await self._client.get(url, session_name=session_a)
        except Exception:
            return None
        try:
            resp_b = await self._client.get(url, session_name=session_b)
        except Exception:
            return None
        if resp_a is None or resp_b is None:
            return None
        # HTTP failure on either session (non-2xx? spec says failure → None, but tests show 401 → flagged False, not None)
        # Spec: "HTTP failure on either session → None." Means network failure (None) already handled. For 401 we continue but flagged False.
        # So we proceed even if status !=200, but flagged will be False due to status check.
        body_a = resp_a.content or b""
        body_b = resp_b.content or b""
        sha_a = hashlib.sha256(body_a).hexdigest()
        sha_b = hashlib.sha256(body_b).hexdigest()
        bytes_a = len(body_a)
        bytes_b = len(body_b)
        status_a = resp_a.status_code
        status_b = resp_b.status_code
        ident = _identifier_key(url)
        flagged = False
        reason = ""
        if status_a == 200 and status_b == 200 and sha_a != sha_b and ident is not None:
            flagged = True
            reason = "possible_idor: both 200, bodies differ, identifier present"
        else:
            # build reason
            parts = []
            if status_a != 200 or status_b != 200:
                parts.append(f"status {status_a}/{status_b} not both 200")
            if sha_a == sha_b:
                parts.append("bodies identical")
            if ident is None:
                parts.append("no identifier in URL")
            reason = "; ".join(parts) if parts else "not flagged"
            if flagged:
                reason = "flagged"
        # discard bodies
        return ProbeResult(
            url=url,
            session_a_status=status_a,
            session_b_status=status_b,
            body_a_sha256=sha_a,
            body_b_sha256=sha_b,
            body_a_bytes=bytes_a,
            body_b_bytes=bytes_b,
            identifier_key=ident,
            flagged=flagged,
            reason=reason,
        )
