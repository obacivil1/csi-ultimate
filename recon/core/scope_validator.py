"""
scope_validator.py — Authorization enforcement before any network activity.

Principle
---------
No packet leaves the host until this module has proven:
    1. scope.json exists and is valid.
    2. The time window is active (not_before <= now < expires_at).
    3. The authorization document matches the declared SHA-256.
    4. The target URL is inside the declared allowlist (no wildcards).
    5. The path is not in the deny list.

This module knows nothing about scanning. It is a gate.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator


class ScopeError(PermissionError):
    """Raised when the scope is invalid or a URL is out of scope."""


class Scope(BaseModel):
    """Strict representation of scope.json. No missing fields. No wrong types."""

    program_name: str = Field(min_length=3, max_length=256)
    program_url: HttpUrl
    authorized_by: str = Field(min_length=2, max_length=256)
    authorization_document: str
    authorization_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    not_before: datetime
    expires_at: datetime
    contact_email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    allowed_hosts: list[str] = Field(min_length=1)
    allowed_schemes: list[str] = Field(default_factory=lambda: ["https"])
    allowed_ports: list[int] = Field(default_factory=lambda: [443])
    denied_paths: list[str] = Field(default_factory=list)

    max_requests_per_host: int = Field(ge=1, le=1_000_000)
    max_requests_per_second: float = Field(gt=0, le=100)

    user_agent: str = Field(min_length=10, max_length=512)

    @field_validator("not_before", "expires_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("must be timezone-aware (use Z or +00:00)")
        return v.astimezone(timezone.utc)

    @model_validator(mode="after")
    def _window(self) -> "Scope":
        if self.not_before >= self.expires_at:
            raise ValueError("not_before must be strictly before expires_at")
        return self

    @field_validator("allowed_hosts")
    @classmethod
    def _hosts(cls, v: list[str]) -> list[str]:
        cleaned: list[str] = []
        for h in v:
            h2 = h.strip().lower().rstrip(".")
            if not h2 or "/" in h2 or ":" in h2:
                raise ValueError(f"invalid host: {h!r} (no scheme, port, or path)")
            if "*" in h2:
                raise ValueError(
                    f"wildcards are not allowed in allowed_hosts: {h!r}. "
                    "List every hostname explicitly."
                )
            cleaned.append(h2)
        return sorted(set(cleaned))

    @field_validator("allowed_schemes")
    @classmethod
    def _schemes(cls, v: list[str]) -> list[str]:
        allowed = {"https", "http"}
        out = [s.strip().lower() for s in v]
        for s in out:
            if s not in allowed:
                raise ValueError(f"scheme not allowed: {s!r}")
        if "http" in out and "https" not in out:
            raise ValueError(
                "http-only scopes are rejected; include https to be safe"
            )
        return sorted(set(out))

    @field_validator("denied_paths")
    @classmethod
    def _paths(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for p in v:
            p2 = p.strip()
            if not p2.startswith("/"):
                raise ValueError(f"denied_paths entries must start with /: {p!r}")
            out.append(p2.rstrip("/") or "/")
        return sorted(set(out))

    @field_validator("user_agent")
    @classmethod
    def _ua(cls, v: str) -> str:
        if "@" not in v or "(" not in v or ")" not in v:
            raise ValueError(
                "user_agent must include contact: "
                "'Name/Version (+contact: email@domain)'"
            )
        return v.strip()


class ScopeValidator:
    """Validates scope.json and enforces it on every URL."""

    def __init__(self, scope_file: Path, *, now: datetime | None = None) -> None:
        self.scope_file = Path(scope_file)
        self._now = now or datetime.now(timezone.utc)

        if not self.scope_file.exists():
            raise ScopeError(f"scope file not found: {self.scope_file}")

        try:
            raw = json.loads(self.scope_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ScopeError(f"scope file is not valid JSON: {exc}") from exc

        try:
            self.scope = Scope(**raw)
        except Exception as exc:
            raise ScopeError(f"scope file failed validation: {exc}") from exc

        self._check_time_window()
        self._check_authorization_document()

    def _check_time_window(self) -> None:
        if self._now < self.scope.not_before:
            raise ScopeError(
                f"scope is not yet active: starts at "
                f"{self.scope.not_before.isoformat()}"
            )
        if self._now >= self.scope.expires_at:
            raise ScopeError(
                f"scope has expired at {self.scope.expires_at.isoformat()}"
            )

    def _check_authorization_document(self) -> None:
        doc_path = self.scope_file.parent / self.scope.authorization_document
        if not doc_path.exists():
            raise ScopeError(
                f"authorization document not found: {doc_path}. "
                "Place the signed program PDF next to scope.json."
            )
        digest = hashlib.sha256(doc_path.read_bytes()).hexdigest()
        if digest != self.scope.authorization_sha256:
            raise ScopeError(
                "authorization document hash mismatch. "
                f"expected {self.scope.authorization_sha256}, got {digest}"
            )

    def allows(self, url: str) -> bool:
        try:
            self._assert_allowed(url)
            return True
        except ScopeError:
            return False

    def _assert_allowed(self, url: str) -> None:
        parsed = urlparse(url)

        if parsed.scheme not in self.scope.allowed_schemes:
            raise ScopeError(f"scheme not allowed: {parsed.scheme!r}")

        host = (parsed.hostname or "").lower().rstrip(".")
        if not host:
            raise ScopeError("URL has no host")
        if host not in self.scope.allowed_hosts:
            raise ScopeError(f"host not in allowed_hosts: {host!r}")

        port = parsed.port
        if port is None:
            port = 443 if parsed.scheme == "https" else 80
        if port not in self.scope.allowed_ports:
            raise ScopeError(f"port not allowed: {port}")

        path = parsed.path or "/"
        for denied in self.scope.denied_paths:
            if path == denied or path.startswith(denied + "/"):
                raise ScopeError(f"path denied by scope: {denied}")

    def assert_allowed(self, url: str) -> None:
        self._assert_allowed(url)

    @property
    def user_agent(self) -> str:
        return self.scope.user_agent

    @property
    def max_requests_per_host(self) -> int:
        return self.scope.max_requests_per_host

    @property
    def max_requests_per_second(self) -> float:
        return self.scope.max_requests_per_second

    def summary(self) -> dict:
        return {
            "program": self.scope.program_name,
            "authorized_by": self.scope.authorized_by,
            "contact": self.scope.contact_email,
            "valid_until": self.scope.expires_at.isoformat(),
            "hosts": self.scope.allowed_hosts,
            "schemes": self.scope.allowed_schemes,
            "denied_paths": self.scope.denied_paths,
            "max_rps": self.scope.max_requests_per_second,
            "max_total": self.scope.max_requests_per_host,
        }


def require_operator_confirmation(
    scope: ScopeValidator, *, input_fn=input
) -> None:
    print("=" * 68)
    print("  AUTHORIZED BUG BOUNTY SCOPE — VERIFY BEFORE PROCEEDING")
    print("=" * 68)
    for k, v in scope.summary().items():
        print(f"  {k:16}: {v}")
    print("-" * 68)
    print("  By proceeding, you confirm that you are authorized to test")
    print("  the hosts listed above under the program referenced.")
    print("=" * 68)

    answer = input_fn("Type 'I CONFIRM' to continue: ").strip()
    if answer != "I CONFIRM":
        raise ScopeError("operator did not confirm; aborting")
